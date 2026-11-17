import 'package:flutter/foundation.dart';

import '../../../shared/order_status.dart';
import '../../checkout/domain/checkout.dart'
    show ArrivalWindow, OutOfStockPreference, Quote, ShippingAddress;

@immutable
class OrderListItem {
  const OrderListItem({
    required this.orderId,
    required this.status,
    this.orderNumber,
    this.orderedAt,
    this.totalAmount,
    this.itemCount,
  });

  final String orderId;

  /// 화면용 주문번호(숫자 8자리, order 0.11.0). 없으면 [orderId] 를 보인다.
  final String? orderNumber;
  final OrderStatus status;
  final DateTime? orderedAt;
  final int? totalAmount;
  final int? itemCount;
}

@immutable
class OrderPage {
  const OrderPage({required this.items, this.nextCursor});

  final List<OrderListItem> items;
  final String? nextCursor;
}

/// 주문 품목. 이름·옵션 라벨·단가는 주문 당시 사본(BR-35, 초안 때 고정)이다. 수량은 서버가 나눠 준 값만 쓴다.
/// 이름이 없으면(사본 조회 실패·2026-11-02 이전 주문) 그때만 sku 로 대신 보인다.
@immutable
class OrderLineView {
  const OrderLineView({
    required this.orderLineId,
    required this.sku,
    this.productName,
    this.optionLabel,
    this.unitPrice,
    this.originalQty,
    this.cancelledBeforeShipQty,
    this.handedOverQty,
    this.deliveredQty,
    this.returnedQty,
    this.unfulfilledQty,
  });

  final String orderLineId;
  final String sku;
  final String? productName;

  /// 옵션 라벨 사본. 단일 옵션 상품은 null 일 수 있다(상세 화면의 옵션 숨김 정책과 같다).
  final String? optionLabel;
  final int? unitPrice;

  /// 화면 제목: 상품명(+ 옵션). 이름이 없을 때만 sku.
  String get title => [
    productName ?? sku,
    if (productName != null && optionLabel != null) optionLabel!,
  ].join(' · ');
  final int? originalQty;
  final int? cancelledBeforeShipQty;
  final int? handedOverQty;
  final int? deliveredQty;
  final int? returnedQty;
  final int? unfulfilledQty;
}

enum ShipmentState {
  planned,
  preparing,
  ready,
  handedOver,
  inDelivery,
  delivered,
  failed,
  cancelled,
  unknown,
}

@immutable
class ShipmentView {
  const ShipmentView({
    required this.shipmentId,
    required this.state,
    required this.lines,
    this.deliveryId,
    this.eta,
  });

  final String shipmentId;
  final String? deliveryId;
  final ShipmentState state;

  /// (orderLineId, 수량)
  final List<({String orderLineId, int qty})> lines;
  final DateTime? eta;
}

/// 원천별 기준시각. STALE·UNAVAILABLE 이면 화면에 "늦을 수 있음"을 붙인다.
enum Freshness { current, stale, unavailable, unknown }

@immutable
class SourceStamp {
  const SourceStamp({required this.system, required this.freshness, this.asOf});

  final String system;
  final DateTime? asOf;
  final Freshness freshness;
}

@immutable
class OrderDetail {
  const OrderDetail({
    required this.orderId,
    required this.version,
    required this.status,
    required this.lines,
    required this.shipments,
    required this.sources,
    this.orderNumber,
    this.deliveryMode,
    this.mfcId,
    this.window,
    this.quote,
    this.paymentState,
    this.paymentAttemptId,
    this.refundedAmount,
    this.deliveryNote,
    this.outOfStock,
    this.claims = const [],
    this.shippingAddress,
  });

  final String orderId;

  /// 화면용 주문번호(숫자 8자리, order 0.11.0 — 고객·라이더·MFC·상담원이 같은 번호를 본다). 시스템 키는 [orderId].
  /// 서버가 비워 주면 null — 그때는 [orderId] 를 보인다.
  final String? orderNumber;

  /// 고객에게 보일 주문번호: [orderNumber], 없으면 [orderId].
  String get displayNumber => orderNumber ?? orderId;
  final int version;
  final OrderStatus status;
  final String? mfcId;

  /// 주문 당시 배송지 사본(BR-37). null 이면 "배송지 정보 없음" — 주소록을 다시 부르지 않는다.
  final ShippingAddress? shippingAddress;
  final String? deliveryMode;
  final ArrivalWindow? window;
  final Quote? quote;
  final List<OrderLineView> lines;
  final List<ShipmentView> shipments;
  final String? paymentState;

  /// 결제 시도 ID(`Order.payment.paymentAttemptId`). 결제 수단은 이것으로 `GET /payments/{id}` 를 묻는다. 없으면 null.
  final String? paymentAttemptId;

  /// 고객이 남긴 배달 요청사항(`Order.deliveryNote`). 없으면 null.
  final String? deliveryNote;

  /// 품절 시 처리(`Order.outOfStockPreference`). 값이 없으면 null(표시하지 않음).
  final OutOfStockPreference? outOfStock;

  /// 서버가 준 환불 성공액. 앱이 계산하지 않는다.
  final int? refundedAmount;
  final List<({String claimId, String type, String state})> claims;
  final List<SourceStamp> sources;

  bool get isSplit => shipments.length > 1;

  List<SourceStamp> get staleSources => [
    for (final s in sources)
      if (s.freshness != Freshness.current) s,
  ];
}

/// 배송 진행 단계(고객 노출).
enum DeliveryStage {
  unassigned,
  toStore,
  atStore,
  toCustomer,
  atCustomer,
  done,
  unknown,
}

/// 도착 예상 상태. LOCATING·ETA_PENDING 이면 수치가 없다(위치 실패 ≠ 배송 실패).
enum EtaStatus { available, locating, pending, finalized, unknown }

@immutable
class DeliveryEtaView {
  const DeliveryEtaView({
    required this.deliveryId,
    required this.stage,
    required this.status,
    this.etaAt,
    this.remainingSeconds,
    this.delayedBySeconds,
    this.window,
    this.delayAlert = false,
    this.asOf,
    this.freshness = Freshness.unknown,
  });

  final String deliveryId;
  final DeliveryStage stage;
  final EtaStatus status;
  final DateTime? etaAt;
  final int? remainingSeconds;
  final int? delayedBySeconds;
  final ArrivalWindow? window;
  final bool delayAlert;
  final DateTime? asOf;
  final Freshness freshness;

  /// 실시간 구독의 STAGE_CHANGED(단계만 옴)를 반영한 사본. 도착 예상 수치는 그대로 둔다.
  DeliveryEtaView withStage(DeliveryStage next) => DeliveryEtaView(
    deliveryId: deliveryId,
    stage: next,
    status: status,
    etaAt: etaAt,
    remainingSeconds: remainingSeconds,
    delayedBySeconds: delayedBySeconds,
    window: window,
    delayAlert: delayAlert,
    asOf: asOf,
    freshness: freshness,
  );
}
