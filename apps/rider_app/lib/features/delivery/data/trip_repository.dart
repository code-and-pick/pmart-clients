import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_center_master/pmart_api_center_master.dart' as cm;
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart'
    as dp;
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as tk;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/location.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/providers.dart';
import '../domain/delivery.dart';
import '../domain/trip.dart';

/// 배송의 주문·픽업지 요약.
abstract interface class TripRepository {
  Future<TripInfo?> forDelivery(String deliveryId);
}

/// 제안에서 받은 요약(배송 ID 별). 수락 뒤 배송 조회에는 좌표·소요가 없어 제안 때 값을 이어 쓴다.
final _offerTrips = <String, TripInfo>{};

/// 제안 요약(dispatch 0.4.5~ `summary.order`·`dropEtaSeconds`·`pickupPoint`·`dropAreaPoint`) →
/// 화면 요약. 예정 시각은 서버 값이 없어 "지금 + 소요"로 잡는다(백엔드 회신 2026-11-16 §3 — 수락
/// 시각 + pickupEtaSeconds / + dropEtaSeconds). 제안이 보일 때마다 새로 적으므로 수락 직전 값이 남는다.
void rememberOfferTrip(String deliveryId, dp.OfferSummary s, {DateTime? now}) {
  final at = now ?? DateTime.now();
  final order = s.order;
  if ((s.mfcId, order?.mfcName) case (final id?, final name?)) {
    serverStoreNames[id] = name;
  }
  final pickupDue = s.pickupEtaSeconds == null
      ? null
      : at.add(Duration(seconds: s.pickupEtaSeconds!));
  final dropDue = pickupDue == null || s.dropEtaSeconds == null
      ? null
      : pickupDue.add(Duration(seconds: s.dropEtaSeconds!));
  _offerTrips[deliveryId] = TripInfo(
    orderNo: order?.orderNumber ?? order?.orderId ?? '',
    store: _serverStore(
      s.mfcId,
      name: order?.mfcName,
      address: order?.mfcAddress,
      point: switch (s.pickupPoint) {
        final p? => (lat: p.lat.toDouble(), lng: p.lng.toDouble()),
        null => null,
      },
      phone: order?.mfcPhone,
    ),
    items: [
      for (final i in order?.items ?? const <dp.OfferOrderInfoItemsInner>[])
        OrderLine(
          name: [?i.name, ?i.optionLabel].join(' '),
          qty: i.qty ?? 0,
          amount: i.lineAmount ?? 0,
        ),
    ],
    menuTotal: order?.itemAmount,
    deliveryRequest: order?.deliveryNote,
    dropLabel: s.dropAreaLabel,
    drop: switch (s.dropAreaPoint) {
      final p? => (lat: p.lat, lng: p.lng),
      null => null,
    },
    pickupDueAt: pickupDue,
    dropDueAt: dropDue,
    dropEtaSeconds: s.dropEtaSeconds,
  );
}

/// 서버 값으로 만든 픽업지. 가게 전화는 서버 값만(dispatch 0.5.2 `order.mfcPhone`·execution `mfcPhone` —
/// 등록 안 됐으면 null 이라 버튼을 숨긴다, 앱 목 번호는 쓰지 않는다). 좌표가 없으면 앱 지점표 좌표.
MfcBranch _serverStore(
  String? mfcId, {
  String? name,
  String? address,
  GeoPoint? point,
  String? phone,
}) {
  final known = mfcById(mfcId);
  return MfcBranch(
    id: mfcId ?? '',
    name: name ?? known?.name ?? '',
    region: known?.region ?? MfcRegion.gyeongsang,
    address: address ?? known?.address ?? '',
    phone: phone,
    // 좌표는 서버 값 → 앱 지점표. 둘 다 없으면 null(모름) — 지어내지 않는다.
    lat: point?.lat ?? known?.lat,
    lng: point?.lng ?? known?.lng,
  );
}

/// 실서버: 배송 조회의 주문 요약(execution `orderSummary`) + 제안 때 받은 좌표·소요.
/// 배정 전(제안만 있는 배송)은 배송 조회가 안 되므로 제안 요약만 쓴다.
final class ApiTripRepository implements TripRepository {
  ApiTripRepository(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi(),
      _eta = tk.PmartApiDeliveryTracking(dio: dio).getEtaApi(),
      _offers = dp.PmartApiDeliveryDispatch(dio: dio).getOffersApi(),
      _centers = cm.PmartApiCenterMaster(dio: dio).getCentersApi();

  final ex.ExecutionApi _exec;
  final tk.EtaApi _eta;
  final dp.OffersApi _offers;
  final cm.CentersApi _centers;

  /// 서버 픽업지 좌표(center-master `GET /mfc-pickup-points`) — 한 번 읽어 둔다. 못 읽으면 다음에 다시.
  Map<String, GeoPoint>? _pickupPoints;

  Future<GeoPoint?> _pickupPointOf(String? mfcId) async {
    if (mfcId == null) return null;
    if (_pickupPoints == null) {
      try {
        final items =
            (await pmartGuard(() => _centers.listMfcPickupPoints()))
                .data
                ?.items ??
            const <cm.PickupPoint>[];
        _pickupPoints = {
          for (final p in items)
            if ((p.coordinates?.lat, p.coordinates?.lng) case (
              final a?,
              final b?,
            ))
              p.centerId: (lat: a.toDouble(), lng: b.toDouble()),
        };
      } on PmartFailure {
        return null;
      }
    }
    return _pickupPoints![mfcId];
  }

  /// 앱을 새로 켜면 제안 때 받은 좌표(메모리)가 없다 — 수락한 내 제안(dispatch `GET /offers?state=ACCEPTED`)을
  /// 다시 읽어 같은 요약(픽업지 좌표·전달지 대략 좌표·소요)을 되살린다. 못 읽으면 없이 간다(지어내지 않는다).
  Future<void> _recoverOffer(String deliveryId) async {
    try {
      final items =
          (await pmartGuard(() => _offers.listMyOffers(state: 'ACCEPTED')))
              .data
              ?.items ??
          const <dp.Offer>[];
      for (final o in items) {
        if (o.deliveryId == deliveryId && o.summary != null) {
          rememberOfferTrip(deliveryId, o.summary!);
          return;
        }
      }
    } on PmartFailure {
      // 복구 못 함 — 배송 조회 값만으로 보인다.
    }
  }

  /// 수락 뒤 예정 시각(delivery-tracking 0.7.0 `GET /deliveries/{id}/eta` — 라이더 본인 배송, 백엔드 회신
  /// 2026-11-17 reply-rider-eta). 계산 전·위치 끊김(ETA_PENDING·LOCATING)·못 읽음이면 null —
  /// 그때는 제안 때 잡은 예정을 그대로 쓴다.
  Future<({DateTime? pickup, DateTime? drop})> _serverEta(String id) async {
    try {
      final e = (await pmartGuard(() => _eta.getDeliveryEta(deliveryId: id)))
          .data;
      DateTime? at(tk.EtaLeg? l) => switch (l?.status?.value) {
        'AVAILABLE' || 'FINAL' => l?.etaAt?.toLocal(),
        _ => null,
      };
      return (pickup: at(e?.pickupEta), drop: at(e?.dropEta));
    } on PmartFailure {
      return (pickup: null, drop: null);
    }
  }

  @override
  Future<TripInfo?> forDelivery(String deliveryId) async {
    if (!_offerTrips.containsKey(deliveryId)) await _recoverOffer(deliveryId);
    final hint = _offerTrips[deliveryId];
    ex.DeliveryExecution? d;
    try {
      d = (await pmartGuard(
        () => _exec.getDeliveryExecution(deliveryId: deliveryId),
      )).data;
    } on PmartFailure {
      if (hint == null) rethrow;
    }
    final summary = d?.orderSummary;
    // 배정된 배송이면 서버 예정 시각을 먼저 쓴다(1분마다 다시 계산된다).
    final eta = d == null
        ? (pickup: null, drop: null)
        : await _serverEta(deliveryId);
    if (summary == null) {
      if (hint == null) return null;
      return _withEta(hint, eta.pickup, eta.drop);
    }
    final items = [
      for (final i
          in summary.items ??
              const <ex.DeliveryExecutionOrderSummaryItemsInner>[])
        OrderLine(
          name: [?i.name, ?i.optionLabel].join(' '),
          qty: i.qty ?? 0,
          amount: i.lineAmount ?? 0,
        ),
    ];
    final base =
        hint?.store ??
        _serverStore(d?.mfcId, name: d?.mfcName, phone: d?.mfcPhone);
    // 픽업지 좌표: 제안 때 받은 값 → 앱 지점표 → 서버 픽업지 목록. 모두 없으면 null(핀을 안 그린다).
    final point = base.point ?? await _pickupPointOf(d?.mfcId ?? base.id);
    return TripInfo(
      orderNo:
          summary.orderNumber ??
          (hint?.orderNo.isNotEmpty == true ? hint!.orderNo : d?.orderId ?? ''),
      // 배송 조회의 지점 전화가 더 새 값이다.
      store: MfcBranch(
        id: base.id,
        name: base.name,
        region: base.region,
        address: base.address,
        phone: d?.mfcPhone ?? base.phone,
        lat: point?.lat,
        lng: point?.lng,
      ),
      items: items.isEmpty ? hint?.items ?? const [] : items,
      menuTotal: summary.itemAmount ?? hint?.menuTotal,
      deliveryRequest: summary.deliveryNote ?? hint?.deliveryRequest,
      dropLabel: hint?.dropLabel,
      drop: hint?.drop,
      pickupDueAt: eta.pickup ?? hint?.pickupDueAt,
      dropDueAt: eta.drop ?? hint?.dropDueAt,
      dropEtaSeconds: hint?.dropEtaSeconds,
    );
  }

  static TripInfo _withEta(TripInfo t, DateTime? pickup, DateTime? drop) =>
      TripInfo(
        orderNo: t.orderNo,
        store: t.store,
        items: t.items,
        menuTotal: t.menuTotal,
        storeRequest: t.storeRequest,
        deliveryRequest: t.deliveryRequest,
        dropLabel: t.dropLabel,
        drop: t.drop,
        pickupDueAt: pickup ?? t.pickupDueAt,
        dropDueAt: drop ?? t.dropDueAt,
        dropEtaSeconds: t.dropEtaSeconds,
      );
}

/// 목 주문(부산진구지점). 이름·전화·주소는 모두 가짜다.
final class MockTripRepository implements TripRepository {
  MockTripRepository({DateTime? now}) : _now = now ?? DateTime.now();

  final DateTime _now;

  @override
  Future<TripInfo?> forDelivery(String deliveryId) async =>
      mockTrip(deliveryId, now: _now);
}

typedef _Seed = ({
  String orderNo,
  String dropLabel,
  double lat,
  double lng,
  List<OrderLine> items,
  String? storeRequest,
  String deliveryRequest,
  String road,
  String detail,
  int dropEtaMin,
});

const _seeds = <String, _Seed>{
  'dlv-1': (
    orderNo: '48213075',
    dropLabel: '부산진구 전포동',
    lat: 35.1565,
    lng: 129.0665,
    // 고객앱 목의 진행 중 주문과 같은 주문(품목·금액·요청사항) — 두 앱 목 맞추기(사용자 요청 2026-11-16).
    items: [OrderLine(name: '그릭요거트 플레인 400g', qty: 3, amount: 17940)],
    storeRequest: null,
    deliveryRequest: '문 앞에 두고 벨은 누르지 말아 주세요',
    road: '부산 부산진구 전포대로 210',
    detail: '전포 한빛아파트 103동 1203호',
    dropEtaMin: 12,
  ),
  'dlv-b1': (
    orderNo: '33017524',
    dropLabel: '부산진구 부전동',
    lat: 35.1620,
    lng: 129.0585,
    items: [
      OrderLine(name: '삼다수 2L × 6', qty: 1, amount: 6900),
      OrderLine(name: '계란 30구', qty: 1, amount: 8990),
    ],
    storeRequest: null,
    deliveryRequest: '경비실에 맡겨 주세요',
    road: '부산 부산진구 중앙대로 750',
    detail: '부전 서면타워 1205호',
    dropEtaMin: 14,
  ),
  'dlv-b2': (
    orderNo: '33017561',
    dropLabel: '부산진구 범천동',
    lat: 35.1455,
    lng: 129.0615,
    items: [
      OrderLine(name: '두부 300g', qty: 2, amount: 3600),
      OrderLine(name: '양파 1.5kg', qty: 1, amount: 4290),
    ],
    storeRequest: '두부는 유통기한 긴 것으로 부탁드려요',
    deliveryRequest: '도착하면 전화 주세요',
    road: '부산 부산진구 범일로 120',
    detail: '범천 그린아파트 301동 1104호',
    dropEtaMin: 20,
  ),
  'dlv-l1': (
    orderNo: '59102438',
    dropLabel: '부산진구 양정동',
    lat: 35.1705,
    lng: 129.0725,
    items: [OrderLine(name: '컵라면 6입', qty: 1, amount: 5980)],
    storeRequest: null,
    deliveryRequest: '문 앞에 두고 문자 주세요',
    road: '부산 부산진구 중앙대로 900',
    detail: '양정빌 202호',
    dropEtaMin: 9,
  ),
  'dlv-l2': (
    orderNo: '59102466',
    dropLabel: '부산진구 연지동',
    lat: 35.1685,
    lng: 129.0530,
    items: [
      OrderLine(name: '맥주 500ml × 4', qty: 1, amount: 11000),
      OrderLine(name: '감자칩 대용량', qty: 2, amount: 6980),
    ],
    storeRequest: null,
    deliveryRequest: '공동현관 호출 후 올라오세요',
    road: '부산 부산진구 신천대로 50',
    detail: '연지 스카이뷰 1501호',
    dropEtaMin: 11,
  ),
};

/// 목 주문 요약. 표에 없는 배송은 첫 배송 값을 쓴다.
TripInfo mockTrip(String deliveryId, {DateTime? now}) {
  final s = _seeds[deliveryId] ?? _seeds['dlv-1']!;
  final base = now ?? DateTime.now();
  return TripInfo(
    orderNo: s.orderNo,
    store: demoMfc,
    items: s.items,
    menuTotal: s.items.fold<int>(0, (a, l) => a + l.amount),
    storeRequest: s.storeRequest,
    deliveryRequest: s.deliveryRequest,
    dropLabel: s.dropLabel,
    drop: (lat: s.lat, lng: s.lng),
    pickupDueAt: base.add(const Duration(minutes: 6)),
    dropDueAt: base.add(Duration(minutes: 6 + s.dropEtaMin)),
    dropEtaSeconds: s.dropEtaMin * 60,
  );
}

/// 목 전달지(BR-24 모양). 개인정보 흉내 — 가짜 값이다.
DropInfo mockDropInfo(String deliveryId) {
  final s = _seeds[deliveryId] ?? _seeds['dlv-1']!;
  return DropInfo(
    roadAddress: s.road,
    detailAddress: s.detail,
    // 고객앱 목 배송지의 받는 분과 같게.
    receiverName: '김피마',
    receiverPhone: '01000000000',
    entranceMethod: EntranceMethod.password,
    entranceNote: '공동현관 #1234',
    deliveryNote: s.deliveryRequest,
    lat: s.lat,
    lng: s.lng,
  );
}

final tripRepositoryProvider = Provider<TripRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockTripRepository(),
    PmartEnv.local => ApiTripRepository(ref.watch(dioProvider)),
  },
);

/// 배송의 주문 요약(서버 값이 없으면 null — 화면은 계약에 있는 값만).
final tripInfoProvider = FutureProvider.autoDispose.family<TripInfo?, String>(
  (ref, id) => ref.watch(tripRepositoryProvider).forDelivery(id),
);
