import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';

import '../domain/handover.dart';
import 'handover_repository.dart';

/// 목 구현.
/// - pkg-chk-1·2: 라이더가 찍은 뒤 확정 없이 허가가 만료됨 → 점원 확인 필요
/// - pkg-live-1: 허가가 아직 살아 있음(확인하면 FENCE_ACTIVE)
/// - pkg-unk-1: 인계 확정 요청 뒤 재고 반영 결과 모름
/// - pkg-rej-1: 재고가 인계를 거절(대사 필요)
/// - pkg-done-1: 인계 완료
/// - 그 밖(패킹 화면의 포장 등): 인계 전(READY)
base class MockHandoverRepository implements HandoverRepository {
  MockHandoverRepository({this.latency = const Duration(milliseconds: 300)}) {
    for (final r in _seed()) {
      _byId[r['packageId']! as String] = r;
    }
  }

  final Duration latency;
  final _byId = <String, Map<String, Object?>>{};
  final _byKey = <String, Map<String, Object?>>{};

  /// 다음 확인 응답을 1회 잃는다(서버는 반영함).
  bool loseNextCheckResponse = false;

  /// "포장대에 없음" 확인 뒤 재고 반영을 처리 중으로 둔다.
  bool inventoryProcessingOnTake = false;

  int checkCalls = 0;

  Future<void> _wait() => Future<void>.delayed(latency);

  /// 목 라이더 표기. rider-mock-3 은 탈퇴(이름 지워짐), 목록에 없는 ID 는 응답에서 빠진다.
  static const riderNames = {
    'rider-mock-1': RiderLabel(riderNumber: '482913', nameMasked: '김*수'),
    'rider-mock-2': RiderLabel(riderNumber: '503217', nameMasked: '박*민'),
    'rider-mock-3': RiderLabel(riderNumber: '611045'),
    // 반납 인증번호 목(return_handover)의 라이더.
    'r-7': RiderLabel(riderNumber: '482913', nameMasked: '김*수'),
    'r-9': RiderLabel(riderNumber: '377102', nameMasked: '이*진'),
  };

  /// 라이더 표기 조회를 실패시킨다.
  bool failRiderLabels = false;

  /// 라이더 표기 조회에 넘어온 ID 묶음(시험이 "한 화면 한 번"을 확인).
  final riderLabelRequests = <List<String>>[];

  @override
  Future<Map<String, RiderLabel>> riderLabels(List<String> riderIds) async {
    riderLabelRequests.add(List.of(riderIds));
    await _wait();
    if (failRiderLabels) {
      throw const ProblemFailure(Problem(status: 503, code: 'UNAVAILABLE'));
    }
    return {for (final id in riderIds) id: ?riderNames[id]};
  }

  static const _asOf = {
    'asOf': '2026-11-10T03:00:00Z',
    'sourceVersion': 1,
    'freshness': 'CURRENT',
  };

  static Map<String, Object?> _expired({
    required String id,
    required String rider,
    required String location,
    required String expiresAt,
    required String order,
    required String code,
  }) => {
    'packageId': id,
    'packageVersion': 1,
    'packageState': 'SEALED',
    'verdict': 'HANDOVER_IN_PROGRESS',
    'fence': {
      'state': 'EXPIRED',
      'handoverAuthorizationId': 'hauth-$id',
      'fenceVersion': 1,
      'expiresAt': expiresAt,
    },
    'inventoryApplyStatus': 'NOT_REQUESTED',
    'checkRequired': true,
    'shipmentId': 'shp-$id',
    'orderId': order,
    'orderNumber': '2000000${order.substring(order.length - 1)}',
    'handoverCode': code,
    'packingLocation': location,
    'riderId': rider,
    'asOf': _asOf,
  };

  static List<Map<String, Object?>> _seed() => [
    _expired(
      id: 'pkg-chk-1',
      rider: 'rider-mock-2',
      location: 'PAK-C-03',
      expiresAt: '2026-11-10T02:48:00Z',
      order: 'order-seed-7',
      code: '3817',
    ),
    _expired(
      id: 'pkg-chk-2',
      rider: 'rider-mock-3',
      location: 'PAK-C-01',
      expiresAt: '2026-11-10T02:57:00Z',
      order: 'order-seed-8',
      code: '5902',
    ),
    {
      'packageId': 'pkg-live-1',
      'packageVersion': 1,
      'packageState': 'SEALED',
      'verdict': 'HANDOVER_IN_PROGRESS',
      'fence': {
        'state': 'HANDOVER_IN_PROGRESS',
        'handoverAuthorizationId': 'hauth-live-1',
        'fenceVersion': 1,
        'expiresAt': '2026-11-10T03:05:00Z',
      },
      'inventoryApplyStatus': 'NOT_REQUESTED',
      'checkRequired': false,
      'shipmentId': 'shp-live-1',
      'orderId': 'order-seed-9',
      'riderId': 'rider-mock-1',
      'asOf': _asOf,
    },
    {
      'packageId': 'pkg-unk-1',
      'packageVersion': 1,
      'packageState': 'SEALED',
      'verdict': 'HANDOVER_IN_PROGRESS',
      'fence': {
        'state': 'HANDOVER_IN_PROGRESS',
        'handoverAuthorizationId': 'hauth-unk-1',
        'fenceVersion': 1,
      },
      'handoverId': 'ho-unk-1',
      'inventoryApplyStatus': 'UNKNOWN_RESULT',
      'checkRequired': false,
      'shipmentId': 'shp-unk-1',
      'riderId': 'rider-mock-1',
      'asOf': _asOf,
    },
    {
      'packageId': 'pkg-rej-1',
      'packageVersion': 1,
      'packageState': 'SEALED',
      'verdict': 'HANDOVER_IN_PROGRESS',
      'fence': {
        'state': 'HANDOVER_IN_PROGRESS',
        'handoverAuthorizationId': 'hauth-rej-1',
        'fenceVersion': 1,
      },
      'handoverId': 'ho-rej-1',
      'inventoryApplyStatus': 'REJECTED',
      'checkRequired': false,
      'shipmentId': 'shp-rej-1',
      'riderId': 'rider-mock-1',
      'asOf': _asOf,
    },
    {
      'packageId': 'pkg-done-1',
      'packageVersion': 1,
      'packageState': 'HANDED_OVER',
      'verdict': 'HANDED_OVER',
      'fence': {'state': 'COMMITTED', 'fenceVersion': 1},
      'handoverId': 'ho-done-1',
      'inventoryApplyStatus': 'APPLIED',
      'checkRequired': false,
      'shipmentId': 'shp-done-1',
      'riderId': 'rider-mock-1',
      'asOf': _asOf,
    },
  ];

  Map<String, Object?> _ready(String id) => {
    'packageId': id,
    'packageVersion': 1,
    'packageState': 'SEALED',
    'verdict': 'READY',
    'fence': {'state': 'NONE', 'fenceVersion': 0},
    'inventoryApplyStatus': 'NOT_REQUESTED',
    'checkRequired': false,
    'shipmentId': 'shp-2',
    'orderId': 'order-seed-4',
    'asOf': _asOf,
  };

  HandoverView _view(Map<String, Object?> r) =>
      handoverFromContract(api.HandoverResolution.fromJson(r));

  @override
  Future<HandoverCheckList> toCheck(String mfcId) async {
    await _wait();
    final items = _byId.values.where((r) => r['checkRequired'] == true).toList()
      ..sort(
        (a, b) => ((a['fence']! as Map)['expiresAt']! as String).compareTo(
          (b['fence']! as Map)['expiresAt']! as String,
        ),
      );
    return HandoverCheckList(
      items: [for (final r in items) _view(r)],
      fresh: true,
    );
  }

  @override
  Future<HandoverView> resolution(String packageId) async {
    await _wait();
    return _view(_byId[packageId] ?? _ready(packageId));
  }

  @override
  Future<CheckOutcome> check(
    String packageId,
    HandoverCheck result, {
    String? note,
    required IdempotencyKey key,
  }) async {
    await _wait();
    checkCalls++;
    final done = _byKey[key.value];
    if (done != null) return CheckDone(_view(done));
    final r = _byId[packageId];
    if (r == null || r['checkRequired'] != true) {
      final live =
          (r?['fence'] as Map?)?['state'] == 'HANDOVER_IN_PROGRESS' &&
          r?['handoverId'] == null;
      return CheckRejected(
        live
            ? HandoverProblemCode.fenceActive
            : HandoverProblemCode.invalidState,
      );
    }
    final fence = Map<String, Object?>.from(r['fence']! as Map);
    final lastCheck = {
      'result': switch (result) {
        HandoverCheck.atStation => 'AT_STATION',
        HandoverCheck.takenByRider => 'TAKEN_BY_RIDER',
      },
      'checkedBy': 'OP-mock-1',
      'checkedAt': '2026-11-10T03:01:00Z',
    };
    switch (result) {
      case HandoverCheck.atStation:
        // 허가 해제. 다른 라이더가 다시 찍을 수 있다.
        r
          ..['verdict'] = 'READY'
          ..['fence'] = {...fence, 'state': 'EXPIRED'};
      case HandoverCheck.takenByRider:
        r
          ..['verdict'] = 'HANDED_OVER'
          ..['packageState'] = 'HANDED_OVER'
          ..['fence'] = {...fence, 'state': 'COMMITTED'}
          ..['handoverId'] = 'ho-$packageId'
          ..['inventoryApplyStatus'] = inventoryProcessingOnTake
              ? 'PROCESSING'
              : 'APPLIED';
    }
    r
      ..['checkRequired'] = false
      ..['lastCheck'] = lastCheck;
    _byKey[key.value] = r;
    if (loseNextCheckResponse) {
      loseNextCheckResponse = false;
      return checkFailureToOutcome(
        UnknownResultFailure(requestId: key.value, httpStatus: 504),
      );
    }
    return CheckDone(_view(r));
  }

  /// 재고 반영을 끝낸다(처리 중 → 반영).
  void applyInventory(String packageId) =>
      _byId[packageId]?['inventoryApplyStatus'] = 'APPLIED';

  @override
  Future<PickupEtaView> pickupEta(String deliveryId) async {
    await _wait();
    return etaFromContract(
      trk.DeliveryEta.fromJson({
        'deliveryId': deliveryId,
        'stage': 'TO_STORE',
        'pickupEta': {
          'status': 'AVAILABLE',
          'etaAt': '2026-11-10T03:06:00Z',
          'remainingSeconds': 240,
        },
        'asOf': _asOf,
      }),
    );
  }
}
