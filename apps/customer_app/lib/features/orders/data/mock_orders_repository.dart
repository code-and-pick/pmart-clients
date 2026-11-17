import 'dart:async';

import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_api_order/pmart_api_order.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../checkout/data/mock_checkout_repository.dart';
import '../../checkout/domain/checkout.dart'
    show ArrivalWindow, OutOfStockPreference;
import '../../../shared/order_status.dart';
import '../../claims/domain/claims.dart' show RequestState;
import '../domain/orders.dart';
import '../domain/tracking.dart';
import 'orders_repository.dart';

/// 목 구현. 지난 주문 3건(분할배송 진행 중·완료·취소)과, 목 결제로 확정된 주문을 함께 보여 준다.
base class MockOrdersRepository implements OrdersRepository {
  MockOrdersRepository({
    this.checkout,
    this.latency = const Duration(milliseconds: 300),
    DateTime Function()? now,
  }) : now = now ?? DateTime.now;

  final MockCheckoutRepository? checkout;
  final Duration latency;
  final DateTime Function() now;

  /// 목록 조회에 쓴 상태 조건(순서대로). 시험이 "어떤 status 로 물었는지"를 본다.
  final listStatuses = <OrderStatus?>[];

  /// 배송 위치 조회 실패 시연(주문·배송 상태와 별개).
  bool etaFails = false;

  /// 주문 JSON 을 직접 바꿔 진행을 흉내 낸다(테스트·취소 단계에서 쓴다).
  final overrides = <String, Map<String, Object?>>{};

  Future<void> _wait() => Future<void>.delayed(latency);

  static const _quoteSeed = {
    'quoteVersion': 1,
    'itemAmount': 31780,
    'deliveryTip': 0,
    'deliveryTipReason': 'OVER_30000',
    'bagFee': 100,
    'totalAmount': 31880,
    'minOrderSatisfied': true,
    'plannedShipments': 2,
  };

  Map<String, Map<String, Object?>> _seeded() => {
    'order-seed-4': {
      'orderId': 'order-seed-4',
      'orderNumber': '61842093',
      'version': 2,
      'status': 'CONFIRMED',
      'mfcId': 'MFC-MOCK-01',
      'deliveryMode': 'SCHEDULED',
      'arrivalWindow': {'date': '2026-10-24', 'start': '18:00', 'end': '19:00'},
      'shippingAddress': {
        ...mockShippingAddressJson,
        'capturedAt': '2026-10-24T00:59:00Z',
      },
      // order-seed-1 은 사본 없음(배포 전 주문) → "배송지 정보 없음".
      'quote': {
        ..._quoteSeed,
        'itemAmount': 17940,
        'deliveryTip': 3000,
        'deliveryTipReason': 'STANDARD',
        'totalAmount': 21040,
        'plannedShipments': 1,
      },
      'lines': [
        {
          'orderLineId': 'ol-5',
          'sku': 'E-00000002',
          'productName': '그릭요거트 플레인 400g',
          'unitPrice': 5980,
          'originalQty': 3,
          'handedOverQty': 0,
          'cancelledBeforeShipQty': 0,
          'deliveredQty': 0,
          'unfulfilledQty': 3,
        },
      ],
      'shipments': [
        {
          'shipmentId': 'sh-5',
          'deliveryId': 'dlv-s5',
          'lines': [
            {'orderLineId': 'ol-5', 'qty': 3},
          ],
          'state': 'PLANNED',
        },
      ],
      'outOfStockPreference': 'CANCEL_OOS_ONLY',
      'deliveryNote': '문 앞에 두고 벨은 누르지 말아 주세요',
      'payment': {
        'paymentAttemptId': 'pa-4',
        'state': 'APPROVED',
        'refundedAmount': 0,
      },
      'claims': <Object?>[],
      'sources': [
        {
          'system': 'order-service',
          'asOf': {'asOf': '2026-10-24T02:58:00Z', 'freshness': 'CURRENT'},
        },
      ],
    },
    'order-seed-1': {
      'orderId': 'order-seed-1',
      'orderNumber': '48213907',
      'version': 7,
      'status': 'PARTIALLY_DELIVERED',
      'mfcId': 'MFC-MOCK-01',
      'deliveryMode': 'SINGLE',
      'quote': _quoteSeed,
      'lines': [
        {
          'orderLineId': 'ol-1',
          'sku': 'E-00000001',
          'productName': '서울우유 1L',
          'unitsPerSku': 1,
          'unitPrice': 2980,
          'originalQty': 10,
          'handedOverQty': 10,
          'deliveredQty': 10,
          'cancelledBeforeShipQty': 0,
          'returnedQty': 0,
          'unfulfilledQty': 0,
        },
        {
          'orderLineId': 'ol-2',
          'sku': 'E-00000005',
          'productName': '감자칩 오리지널 110g',
          'unitsPerSku': 1,
          'unitPrice': 1980,
          'originalQty': 1,
          'handedOverQty': 1,
          'deliveredQty': 0,
          'cancelledBeforeShipQty': 0,
          'returnedQty': 0,
          'unfulfilledQty': 0,
        },
      ],
      'shipments': [
        {
          'shipmentId': 'sh-1',
          'deliveryId': 'dlv-s1',
          'lines': [
            {'orderLineId': 'ol-1', 'qty': 10},
          ],
          'weightG': 10300,
          'state': 'DELIVERED',
        },
        {
          'shipmentId': 'sh-2',
          'deliveryId': 'dlv-s2',
          'lines': [
            {'orderLineId': 'ol-2', 'qty': 1},
          ],
          'weightG': 110,
          'state': 'IN_DELIVERY',
        },
      ],
      'payment': {
        'paymentAttemptId': 'pa-1',
        'state': 'APPROVED',
        'refundedAmount': 0,
      },
      'claims': [],
      'sources': [
        {
          'system': 'order-service',
          'asOf': {'asOf': '2026-10-24T02:58:00Z', 'freshness': 'CURRENT'},
        },
        {
          'system': 'delivery-execution-service',
          'asOf': {'asOf': '2026-10-24T02:40:00Z', 'freshness': 'STALE'},
        },
      ],
    },
    'order-seed-2': {
      'orderId': 'order-seed-2',
      'orderNumber': '73015562',
      'version': 9,
      'status': 'COMPLETED',
      'deliveryMode': 'BUNDLED',
      'quote': {
        ..._quoteSeed,
        'itemAmount': 16880,
        'deliveryTip': 3000,
        'deliveryTipReason': 'STANDARD',
        'totalAmount': 19980,
        'plannedShipments': 1,
      },
      'lines': [
        {
          'orderLineId': 'ol-3',
          'sku': 'E-00000002',
          'productName': '그릭요거트 플레인 400g',
          'unitPrice': 5980,
          'originalQty': 2,
          'deliveredQty': 2,
        },
      ],
      'shipments': [
        {
          'shipmentId': 'sh-3',
          'deliveryId': 'dlv-s3',
          'lines': [
            {'orderLineId': 'ol-3', 'qty': 2},
          ],
          'state': 'DELIVERED',
        },
      ],
      'outOfStockPreference': 'CANCEL_ALL',
      'payment': {
        'paymentAttemptId': 'pa-2',
        'state': 'APPROVED',
        'refundedAmount': 0,
      },
      'sources': [
        {
          'system': 'order-service',
          'asOf': {'asOf': '2026-10-22T09:00:00Z', 'freshness': 'CURRENT'},
        },
      ],
    },
    'order-seed-3': {
      'orderId': 'order-seed-3',
      // 주문번호(order 0.11.0)가 생기기 전 주문 — 화면은 orderId 를 보인다.
      'version': 4,
      'status': 'CANCELLED',
      'deliveryMode': 'SCHEDULED',
      'arrivalWindow': {'date': '2026-10-20', 'start': '18:00', 'end': '19:00'},
      'quote': {
        ..._quoteSeed,
        'itemAmount': 15800,
        'deliveryTip': 3000,
        'deliveryTipReason': 'STANDARD',
        'totalAmount': 18900,
        'plannedShipments': 1,
      },
      'lines': [
        {
          'orderLineId': 'ol-4',
          'sku': 'E-00000003',
          'productName': '제주 감귤 1kg',
          'unitPrice': 7900,
          'originalQty': 2,
          'cancelledBeforeShipQty': 2,
        },
      ],
      'shipments': [
        {'shipmentId': 'sh-4', 'state': 'CANCELLED', 'lines': <Object?>[]},
      ],
      'payment': {'state': 'REFUNDED', 'refundedAmount': 18900},
      'claims': [
        {'claimId': 'clm-1', 'type': 'CANCEL', 'state': 'CLOSED'},
      ],
      'sources': [
        {
          'system': 'order-service',
          'asOf': {'asOf': '2026-10-20T07:00:00Z', 'freshness': 'CURRENT'},
        },
      ],
    },
  };

  static const _orderedAt = {
    'order-seed-4': '2026-10-24T01:00:00Z',
    'order-seed-1': '2026-10-24T02:30:00Z',
    'order-seed-2': '2026-10-22T08:10:00Z',
    'order-seed-3': '2026-10-20T06:00:00Z',
  };

  /// 목 결제로 확정된 주문. 상품 준비 중, 배송 1건.
  Map<String, Object?> _fromCheckout(String orderId, MockDraft d) {
    final quote = d.json['quote']! as Map<String, Object?>;
    var i = 0;
    final lines = [
      for (final l in d.request.lines)
        {
          'orderLineId': '$orderId-l${++i}',
          'sku': l.sku,
          // 확정 때 초안의 상품명 사본을 그대로 옮긴다(BR-35).
          'productName': MockCheckoutRepository.nameOf(l.sku),
          'unitPrice': MockCheckoutRepository.priceOf(l.sku),
          'originalQty': l.quantity,
          'handedOverQty': 0,
          'deliveredQty': 0,
          'cancelledBeforeShipQty': 0,
          'returnedQty': 0,
          'unfulfilledQty': l.quantity,
        },
    ];
    return {
      'orderId': orderId,
      // 서버: 숫자 8자리 무작위(order 0.11.0). 목은 주문 ID 로 정한다.
      'orderNumber': '${10000000 + orderId.hashCode.abs() % 90000000}',
      'version': 1,
      'status': 'CONFIRMED',
      'mfcId': d.request.expectedMfcId,
      'deliveryMode': d.request.mode.name.toUpperCase(),
      if (d.request.window case final w?)
        'arrivalWindow': {'date': w.date, 'start': w.start, 'end': w.end},
      'quote': quote,
      // 확정 때 초안의 배송지 사본을 그대로 옮긴다(BR-37).
      'shippingAddress':
          (d.json['delivery'] as Map<String, Object?>?)?['shippingAddress'],
      'lines': lines,
      'shipments': [
        {
          'shipmentId': '$orderId-sh1',
          'deliveryId': 'dlv-$orderId',
          'lines': [
            for (final l in lines)
              {'orderLineId': l['orderLineId'], 'qty': l['originalQty']},
          ],
          'state': 'PLANNED',
        },
      ],
      'outOfStockPreference': switch (d.request.outOfStock) {
        OutOfStockPreference.cancelOutOfStockOnly => 'CANCEL_OOS_ONLY',
        OutOfStockPreference.cancelAll => 'CANCEL_ALL',
      },
      'deliveryNote': ?d.request.deliveryNote,
      'payment': {
        'paymentAttemptId': ?checkout?.approvedAttemptOf(orderId),
        'state': 'APPROVED',
        'refundedAmount': 0,
      },
      'claims': [],
      'sources': [
        {
          'system': 'order-service',
          'asOf': {
            'asOf': now().toUtc().toIso8601String(),
            'freshness': 'CURRENT',
          },
        },
      ],
    };
  }

  Map<String, Map<String, Object?>> _all() => {
    for (final e
        in (checkout?.confirmedOrders ?? const <String, MockDraft>{}).entries)
      e.key: _fromCheckout(e.key, e.value),
    ..._seeded(),
    ...overrides,
  };

  /// 현재 주문 JSON(취소 목 등에서 고쳐 쓴다).
  Map<String, Object?>? orderJson(String orderId) => _all()[orderId];

  @override
  Future<OrderPage> list({String? cursor, OrderStatus? status}) async {
    await _wait();
    listStatuses.add(status);
    final all = _all();
    // 서버 흉내: status 를 주면 그 상태만(계약 `GET /orders?status=`).
    final wire = orderStatusToWire(status)?.value;
    return orderPageFromContract(
      api.ListOrders200Response.fromJson({
        'items': [
          for (final e in all.entries)
            if (wire == null || e.value['status'] == wire)
              {
                'orderId': e.key,
                'orderNumber': e.value['orderNumber'],
                'status': e.value['status'],
                'orderedAt':
                    _orderedAt[e.key] ?? now().toUtc().toIso8601String(),
                'totalAmount': (e.value['quote']! as Map)['totalAmount'],
                'itemCount': (e.value['lines']! as List).length,
              },
        ],
        'page': {'nextCursor': null, 'size': 50},
      }),
    );
  }

  @override
  Future<OrderDetail> get(String orderId) async {
    await _wait();
    final json = _all()[orderId];
    if (json == null) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    return orderFromContract(api.Order.fromJson(json));
  }

  @override
  Future<DeliveryEtaView> eta(String deliveryId) async {
    await _wait();
    if (etaFails) {
      throw const NetworkFailure(DioExceptionType.connectionTimeout);
    }
    final current = now().toUtc();
    final json = switch (deliveryId) {
      'dlv-s2' => {
        'deliveryId': deliveryId,
        'stage': 'TO_CUSTOMER',
        'dropEta': {
          'status': 'AVAILABLE',
          'etaAt': current.add(const Duration(minutes: 12)).toIso8601String(),
          'remainingSeconds': 720,
          'delayedBySeconds': 300,
          'calculatedAt': current.toIso8601String(),
        },
        'delayAlertTriggered': true,
        'riderLocationQuality': 'GOOD',
        'asOf': {'asOf': current.toIso8601String(), 'freshness': 'CURRENT'},
      },
      'dlv-s1' || 'dlv-s3' => {
        'deliveryId': deliveryId,
        'stage': 'DONE',
        'dropEta': {'status': 'FINAL'},
        'asOf': {'asOf': current.toIso8601String(), 'freshness': 'CURRENT'},
      },
      _ => {
        'deliveryId': deliveryId,
        'stage': 'UNASSIGNED',
        'dropEta': {'status': 'LOCATING'},
        'riderLocationQuality': 'UNKNOWN',
        'asOf': {'asOf': current.toIso8601String(), 'freshness': 'CURRENT'},
      },
    };
    return etaFromContract(deliveryId, trk.DeliveryEta.fromJson(json));
  }

  /// 실시간 구독 실패 시연(연결 즉시 오류). 주기 조회로 넘어가는지 본다.
  bool trackFails = false;

  /// 배송별 열린 구독. 시험이 [emitTracking] 으로 이벤트를 흘리고, 화면을 닫으면 비는지 본다.
  final openTracks = <String, List<StreamController<TrackingEvent>>>{};

  /// 지금까지 연 구독 수(재연결 확인용).
  int trackOpens = 0;

  /// 열린 구독 수.
  int get openTrackCount =>
      openTracks.values.fold(0, (n, list) => n + list.length);

  /// 열린 구독에 이벤트를 흘린다.
  void emitTracking(String deliveryId, TrackingEvent e) {
    for (final c in [...?openTracks[deliveryId]]) {
      c.add(e);
    }
  }

  /// 열린 구독을 끊는다(서버·망 끊김 흉내). [error] 가 있으면 오류로 끝낸다.
  Future<void> dropTracking(String deliveryId, {Object? error}) async {
    for (final c in [...?openTracks[deliveryId]]) {
      if (error != null) c.addError(error);
      await c.close();
    }
  }

  @override
  Stream<TrackingEvent> track(String deliveryId, {String? lastEventId}) {
    trackOpens++;
    late final StreamController<TrackingEvent> c;
    c = StreamController<TrackingEvent>(
      onListen: () {
        if (trackFails) {
          c
            ..addError(const NetworkFailure(DioExceptionType.connectionError))
            ..close();
          return;
        }
        (openTracks[deliveryId] ??= []).add(c);
        // 연결되면 서버가 HEARTBEAT 를 보낸다(목은 바로 한 번).
        c.add(const TrackingEvent(type: TrackingEventType.heartbeat));
      },
      onCancel: () => _forget(deliveryId, c),
    );
    c.done.then((_) => _forget(deliveryId, c));
    return c.stream;
  }

  void _forget(String deliveryId, StreamController<TrackingEvent> c) {
    final list = openTracks[deliveryId];
    list?.remove(c);
    if (list != null && list.isEmpty) openTracks.remove(deliveryId);
  }

  final _timeChanges =
      <String, ({String orderId, Map<String, String> window, int polls})>{};

  /// 다음 시간 변경을 서버가 거절하게 한다(정원 소진 등).
  bool rejectNextTimeChange = false;

  @override
  Future<void> requestTimeChange(
    String orderId,
    ArrivalWindow window, {
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_timeChanges.containsKey(key.value)) return;
    final order = orderJson(orderId);
    if (order == null) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    if (order['status'] != 'CONFIRMED') {
      // 상품 준비에 들어가면 바꿀 수 없다.
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
    }
    if (order['version'] != expectedVersion) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.versionConflict),
      );
    }
    _timeChanges[key.value] = (
      orderId: orderId,
      window: {'date': window.date, 'start': window.start, 'end': window.end},
      polls: 0,
    );
  }

  @override
  Future<RequestState> timeChange(String orderId, IdempotencyKey key) async {
    await _wait();
    final r = _timeChanges[key.value];
    if (r == null) return RequestState.unknown;
    if (r.polls == 0) {
      _timeChanges[key.value] = (
        orderId: r.orderId,
        window: r.window,
        polls: 1,
      );
      return RequestState.pending;
    }
    if (rejectNextTimeChange) {
      rejectNextTimeChange = false;
      _timeChanges.remove(key.value);
      return RequestState.rejected;
    }
    final order = orderJson(orderId)!;
    overrides[orderId] = {
      ...order,
      'arrivalWindow': r.window,
      'version': (order['version']! as int) + 1,
    };
    _timeChanges.remove(key.value);
    _confirmed.add(key.value);
    return RequestState.confirmed;
  }

  final _confirmed = <String>{};
}
