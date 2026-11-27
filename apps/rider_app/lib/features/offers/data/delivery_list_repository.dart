import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/demo.dart';
import '../../../shared/providers.dart' show sourceSystem;
import '../domain/offer_list.dart';
import 'offer_repository.dart';

/// 배달리스트(일반 배차모드)의 배차 대기 배송 한 건. 목록에서 고르는 것 ≠ 확정(원문 §2.4).
@immutable
class WaitingDelivery {
  const WaitingDelivery({
    required this.deliveryId,
    this.mfcId,
    this.dropAreaLabel,
    this.mode,
    this.distanceKm,
    this.estimatedFee,
    this.weightG,
    this.bagCount,
    this.containsAlcohol,
  });

  final String deliveryId;
  final String? mfcId;
  final String? dropAreaLabel;
  final DeliveryMode? mode;

  /// MFC → 고객 도로 거리.
  final num? distanceKm;
  final int? estimatedFee;
  final int? weightG;
  final int? bagCount;
  final bool? containsAlcohol;
}

@immutable
class WaitingList {
  const WaitingList({required this.items, required this.pollAfter});

  /// 비어 있으면: 대기 배송이 없거나, 위치가 2분 넘게 안 왔거나 위치 품질이 나쁘다(서버가 구분해 주지 않는다).
  final List<WaitingDelivery> items;
  final Duration? pollAfter;
}

/// `GET /delivery-list`·`POST /delivery-list/{id}/acceptances`(dispatch 0.3.x).
/// 게이트웨이 경로 `/api/v1/delivery-list/**` 는 PC 1 이 추가해야 열린다(백엔드 안내 2026-11-13).
abstract interface class DeliveryListRepository {
  Future<WaitingList> list();

  /// 같은 키 재전송은 같은 판정. 이미 배정·최대 건수 초과면 [OfferLate].
  Future<OfferOutcome> accept(String deliveryId, {required IdempotencyKey key});
}

final class ApiDeliveryListRepository implements DeliveryListRepository {
  ApiDeliveryListRepository(Dio dio)
    : _api = PmartApiDeliveryDispatch(dio: dio).getDeliveryListApi();

  final DeliveryListApi _api;

  @override
  Future<WaitingList> list() async {
    final res = await pmartGuard(() => _api.listDeliveryList());
    final body =
        res.data ??
        (throw const ContractViolationFailure('listDeliveryList 본문 없음'));
    return WaitingList(
      items: [
        for (final i in body.items ?? const <DeliveryListItem>[])
          if (i.deliveryId != null)
            WaitingDelivery(
              deliveryId: i.deliveryId!,
              mfcId: i.mfcId,
              dropAreaLabel: i.dropAreaLabel,
              mode: deliveryModeFromWire(i.deliveryMode?.value),
              distanceKm: i.distanceKm,
              estimatedFee: i.estimatedFee,
              weightG: i.weightG,
              bagCount: i.bagCount,
              containsAlcohol: i.containsAlcohol,
            ),
      ],
      pollAfter: switch (body.pollAfterSec) {
        final int s => Duration(seconds: s),
        null => null,
      },
    );
  }

  @override
  Future<OfferOutcome> accept(
    String deliveryId, {
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _api.acceptFromDeliveryList(
          deliveryId: deliveryId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          extra: commandOptions(key).extra,
        ),
      );
      final r = res.data;
      return r == null ? const OfferUnknown() : offerOutcomeFromContract(r);
    } on UnknownResultFailure {
      return const OfferUnknown();
    }
  }
}

/// 목: 시연용 대기 배송 두 건.
final class MockDeliveryListRepository implements DeliveryListRepository {
  MockDeliveryListRepository({
    this.latency = const Duration(milliseconds: 300),
    this.onAssigned,
    DemoScenario? demo,
  }) {
    if (demo != null) _holdForDemo(demo);
  }

  /// 시연 빌드: 대기 배송을 처음부터 다 보이지 않고 8초마다 하나씩 올린다(최대 3건 보이게).
  final _held = <WaitingDelivery>[];
  DateTime? _nextAt;

  void _holdForDemo(DemoScenario demo) {
    WaitingDelivery single(String id, String area, num km, int fee) =>
        WaitingDelivery(
          deliveryId: id,
          mfcId: 'MFC-BSJ-01',
          dropAreaLabel: area,
          mode: DeliveryMode.single,
          distanceKm: km,
          estimatedFee: fee,
          weightG: 2100,
          bagCount: 1,
          containsAlcohol: false,
        );
    final singles = [
      single('dlv-s1', '부산진구 양정동', 1.5, 4000),
      single('dlv-s2', '부산진구 연지동', 2.1, 4300),
      single('dlv-s3', '부산진구 초읍동', 2.7, 4600),
    ];
    _held.addAll(switch (demo) {
      DemoScenario.single || DemoScenario.bundle => singles,
      DemoScenario.all => [..._items, ...singles],
    });
    _items.clear();
  }

  void _drip() {
    if (_held.isEmpty) return;
    final now = DateTime.now();
    final next = _nextAt;
    if (next == null) {
      _nextAt = now.add(const Duration(seconds: 4));
      return;
    }
    if (now.isBefore(next) || _items.length >= 3) return;
    _items.add(_held.removeAt(0));
    _nextAt = now.add(const Duration(seconds: 8));
  }

  final Duration latency;

  /// 수락되면 배송 ID 를 알린다(목 배송 저장소가 진행 목록에 보이게).
  final void Function(String deliveryId)? onAssigned;

  final _items = <WaitingDelivery>[
    const WaitingDelivery(
      deliveryId: 'dlv-l1',
      mfcId: 'MFC-BSJ-01',
      dropAreaLabel: '부산진구 양정동',
      mode: DeliveryMode.single,
      distanceKm: 1.2,
      estimatedFee: 3200,
      weightG: 1800,
      bagCount: 1,
      containsAlcohol: false,
    ),
    const WaitingDelivery(
      deliveryId: 'dlv-l2',
      mfcId: 'MFC-BSJ-01',
      dropAreaLabel: '부산진구 연지동',
      mode: DeliveryMode.scheduled,
      distanceKm: 2.4,
      estimatedFee: 4100,
      weightG: 5200,
      bagCount: 3,
      containsAlcohol: true,
    ),
  ];
  final _accepted = <String, OfferOutcome>{};

  @override
  Future<WaitingList> list() async {
    await Future<void>.delayed(latency);
    _drip();
    return WaitingList(
      items: List.unmodifiable(_items),
      pollAfter: const Duration(seconds: 5),
    );
  }

  @override
  Future<OfferOutcome> accept(
    String deliveryId, {
    required IdempotencyKey key,
  }) async {
    await Future<void>.delayed(latency);
    final previous = _accepted[key.value];
    if (previous != null) return previous;
    final found = _items.any((i) => i.deliveryId == deliveryId);
    final OfferOutcome outcome = found
        ? OfferAssigned(deliveryId: deliveryId)
        : const OfferLate(LateReason.alreadyAssigned);
    _items.removeWhere((i) => i.deliveryId == deliveryId);
    _accepted[key.value] = outcome;
    if (found) onAssigned?.call(deliveryId);
    return outcome;
  }
}
