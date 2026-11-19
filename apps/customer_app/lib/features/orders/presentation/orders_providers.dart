import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart' show toSeoulWallClock;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/order_status.dart';
import '../../../shared/providers.dart';
import '../../address/presentation/map_pick_screen.dart'
    show GeoPoint, geocodingRepositoryProvider;
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../checkout/data/mock_checkout_repository.dart';
import '../../checkout/presentation/checkout_controller.dart';
import '../../payment/domain/payment.dart' show PaymentSummary;
import '../../payment/presentation/payment_controller.dart'
    show paymentRepositoryProvider;
import '../data/mock_orders_repository.dart';
import '../data/orders_repository.dart';
import '../domain/orders.dart';

final ordersRepositoryProvider = Provider<OrdersRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockOrdersRepository(
      checkout: switch (ref.watch(checkoutRepositoryProvider)) {
        final MockCheckoutRepository m => m,
        _ => null,
      },
      now: ref.watch(clockProvider),
      // 목 앱: 라이더 위치가 5초마다 구독으로 온다(실서버 라이더 앱 올리기 간격).
      liveRiderInterval: const Duration(seconds: 5),
    ),
    PmartEnv.local => ApiOrdersRepository(ref.watch(dioProvider)),
  },
);

/// 배송 도착 예상 주기 조회 간격. 실시간 구독(SSE)이 끊긴 동안만 쓴다.
final etaRefreshIntervalProvider = Provider<Duration>(
  (_) => const Duration(seconds: 30),
);

/// 라이더 위치 다시 읽기 간격(사용자 2026-11-19 "10초"). 위치는 실시간 구독(SSE `ETA_UPDATED` 의 `eta.riderLocation`)
/// 으로 받고, 구독이 끊겼거나 다시 붙는 동안 배달 중(TO_CUSTOMER·AT_CUSTOMER)이면 `GET /deliveries/{id}/eta` 를 이 간격으로 읽는다.
final riderLocationRefreshIntervalProvider = Provider<Duration>(
  (_) => const Duration(seconds: 10),
);

/// 배송현황 지도의 내 배송지 좌표 — 주문 사본에 핀이 없을 때만, 사본 도로명을 서버 주소 변환(`/address-geocodes`)으로.
/// 못 찾거나 조회가 실패하면 null(지도 가운데를 지어내지 않는다).
final trackingHomeProvider = FutureProvider.autoDispose
    .family<GeoPoint?, String>((ref, road) async {
      try {
        final found = await ref
            .watch(geocodingRepositoryProvider)
            .geocode(road);
        return switch (found.firstOrNull) {
          final c? => (lat: c.lat, lng: c.lng),
          null => null,
        };
      } on PmartFailure {
        return null;
      }
    });

/// 주문 단위 배송 현황에서 배송 ID 가 생겼는지 주문을 다시 읽는 간격(배차 전 → 배송 생성, BR-61).
final orderLinkPollIntervalProvider = Provider<Duration>(
  (_) => const Duration(seconds: 10),
);

/// 실시간 구독 재연결 대기([attempt] 는 1부터). 1·2·4·…초, 최대 60초.
final trackingReconnectDelayProvider = Provider<Duration Function(int attempt)>(
  (_) => (attempt) {
    final seconds = 1 << (attempt - 1).clamp(0, 6);
    return Duration(seconds: seconds > 60 ? 60 : seconds);
  },
);

/// 예약 시간 변경 요청 진입을 보일지. 계약: 예약배달이고 상품 준비 전(CONFIRMED)만 받는다. 가능 여부는 서버가 최종 판정한다.
bool canRequestTimeChange(OrderDetail o) =>
    o.deliveryMode == 'SCHEDULED' && o.status == OrderStatus.confirmed;

/// 주문 취소(`POST /claims`) 진입을 보일지. 고객 취소는 상품 준비 전(CONFIRMED)만 받는다 —
/// 피킹이 시작되면(PREPARING~) 422 ORDER_NOT_CANCELLABLE(claim 계약, ADR-0060). 가능 여부는 서버가 최종 판정한다.
bool canRequestCancel(OrderDetail o) => o.status == OrderStatus.confirmed;

/// 상품 준비가 시작돼 앱에서 취소할 수 없는 주문(받은 뒤 고객센터 반품 안내를 보인다).
bool cancelClosedByPreparing(OrderDetail o) => switch (o.status) {
  OrderStatus.preparing || OrderStatus.partiallyHandedOver => true,
  _ => false,
};

/// 본인 주문 목록(조건 [OrderListQuery] — 상태·기간·상품명). 비회원이면 null(빈 목록과 구분).
/// 조건 없는 기본(최근 3개월)은 `const OrderListQuery()`.
final orderListProvider = FutureProvider.autoDispose
    .family<OrderPage?, OrderListQuery>((ref, query) async {
      if (ref.watch(sessionProvider) is! MemberSession) return null;
      return ref
          .watch(ordersRepositoryProvider)
          .list(
            status: query.status,
            from: orderPeriodFrom(
              query.period,
              toSeoulWallClock(ref.read(clockProvider)()),
            ),
            q: query.q,
          );
    });

/// 주문 목록의 상태 필터(앞에서부터 "전체" 다음 차례). 계약 `status` 는 하나만 받으므로 묶음 필터(진행 중 등)는 두지 않는다.
const orderListFilters = <OrderStatus>[
  OrderStatus.confirmed,
  OrderStatus.preparing,
  OrderStatus.inDelivery,
  OrderStatus.completed,
  OrderStatus.cancelled,
];

/// 주문의 결제 수단(`GET /payments/{paymentAttemptId}`). 실패는 오류로 남는다("정보 없음"으로 바꾸지 않는다).
final orderPaymentProvider = FutureProvider.autoDispose
    .family<PaymentSummary, String>(
      (ref, paymentAttemptId) =>
          ref.watch(paymentRepositoryProvider).payment(paymentAttemptId),
    );

final orderDetailProvider = FutureProvider.autoDispose
    .family<OrderDetail, String>(
      (ref, orderId) => ref.watch(ordersRepositoryProvider).get(orderId),
    );

final deliveryEtaProvider = FutureProvider.autoDispose
    .family<DeliveryEtaView, String>(
      (ref, deliveryId) => ref.watch(ordersRepositoryProvider).eta(deliveryId),
    );

/// 주문 상태 → 고객 문구(잠정, BR-12).
String orderStatusText(AppLocalizations l10n, OrderStatus s) => switch (s) {
  OrderStatus.draft || OrderStatus.resourcePending => l10n.osChecking,
  OrderStatus.paymentPending => l10n.osPaymentPending,
  OrderStatus.paymentUnknown => l10n.osPaymentUnknown,
  OrderStatus.confirmed => l10n.osConfirmed,
  OrderStatus.preparing => l10n.osPreparing,
  OrderStatus.partiallyHandedOver => l10n.osPartiallyHandedOver,
  OrderStatus.inDelivery => l10n.osInDelivery,
  OrderStatus.partiallyDelivered => l10n.osPartiallyDelivered,
  OrderStatus.completed => l10n.osCompleted,
  OrderStatus.cancelled => l10n.osCancelled,
  OrderStatus.expired => l10n.osExpired,
  OrderStatus.unknown => l10n.osUnknown,
};

String shipmentStateText(AppLocalizations l10n, ShipmentState s) => switch (s) {
  ShipmentState.planned => l10n.shPlanned,
  ShipmentState.preparing => l10n.shPreparing,
  ShipmentState.ready => l10n.shReady,
  ShipmentState.handedOver => l10n.shHandedOver,
  ShipmentState.inDelivery => l10n.shInDelivery,
  ShipmentState.delivered => l10n.shDelivered,
  ShipmentState.failed => l10n.shFailed,
  ShipmentState.cancelled => l10n.shCancelled,
  ShipmentState.unknown => l10n.shUnknown,
};

String stageText(AppLocalizations l10n, DeliveryStage s) => switch (s) {
  DeliveryStage.unassigned => l10n.stUnassigned,
  DeliveryStage.toStore => l10n.stToStore,
  DeliveryStage.atStore => l10n.stAtStore,
  DeliveryStage.toCustomer => l10n.stToCustomer,
  DeliveryStage.atCustomer => l10n.stAtCustomer,
  DeliveryStage.done => l10n.stDone,
  DeliveryStage.unknown => l10n.stUnknown,
};
