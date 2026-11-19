import 'dart:async';

import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_api_order/pmart_api_order.dart' as api;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart' show toSeoulWallClock;

import '../../checkout/data/mock_checkout_repository.dart';
import '../../checkout/domain/checkout.dart'
    show ArrivalWindow, OutOfStockPreference;
import '../../../shared/order_status.dart';
import '../../claims/domain/claims.dart'
    show RequestState, TimeChangeCode, TimeChangeResult;
import '../domain/orders.dart';
import '../domain/tracking.dart';
import 'orders_repository.dart';

/// 목 구현. 지난 주문 3건(분할배송 진행 중·완료·취소)과, 목 결제로 확정된 주문을 함께 보여 준다.
base class MockOrdersRepository implements OrdersRepository {
  MockOrdersRepository({
    this.checkout,
    this.latency = const Duration(milliseconds: 300),
    DateTime Function()? now,
    this.liveRiderInterval,
  }) : now = now ?? DateTime.now;

  /// 배달 중 목 배송(dlv-s2)의 구독에 이 간격으로 라이더 위치가 바뀐 `ETA_UPDATED` 를 흘린다(실서버 흉내 —
  /// 라이더 앱 5초 올리기, PC 5 요청 2026-11-19). null 이면 흘리지 않는다(시험은 [emitTracking] 으로 직접).
  final Duration? liveRiderInterval;

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
      // 라이더앱 목 배송 dlv-1 과 같은 주문(번호·배송 ID·지점 — PC 5 요청, 목 전용).
      'orderNumber': '48213075',
      'version': 2,
      'status': 'CONFIRMED',
      'mfcId': 'MFC-BSJ-01',
      'mfcName': '부산진구점',
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
          'deliveryId': 'dlv-1',
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
      'mfcId': 'MFC-BSJ-01',
      'mfcName': '부산진구점',
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

  /// 목록 조회에 쓴 기간·검색 조건(순서대로).
  final listQueries = <({String? from, String? q})>[];

  /// 숨긴 주문(서버가 목록에서 뺀 것).
  final hidden = <String>{};

  /// 숨기기에 보낸 키(주문 ID → 키).
  final hideKeys = <String, String>{};

  /// 다음 목록 조회를 실패시킨다(시험용).
  bool failNextList = false;

  @override
  Future<OrderPage> list({
    String? cursor,
    OrderStatus? status,
    String? from,
    String? q,
  }) async {
    await _wait();
    listStatuses.add(status);
    listQueries.add((from: from, q: q));
    if (failNextList) {
      failNextList = false;
      throw const UnknownResultFailure();
    }
    final all = _all();
    // 서버 흉내: status 를 주면 그 상태만(계약 `GET /orders?status=`).
    final wire = orderStatusToWire(status)?.value;
    // 서버 흉내(order 0.12.0): from 이 없으면 최근 3개월(확정 시각, Asia/Seoul 날짜), q 는 상품명 부분 일치.
    final seoul = toSeoulWallClock(now());
    final fromDate = switch (from) {
      final f? => DateTime.parse(f),
      null => DateTime(seoul.year, seoul.month - 3, seoul.day),
    };
    final needle = q?.trim().toLowerCase();
    bool matches(Map<String, Object?> o) =>
        needle == null ||
        needle.isEmpty ||
        (o['lines']! as List).any(
          (l) =>
              ((l as Map)['productName'] as String?)?.toLowerCase().contains(
                needle,
              ) ??
              false,
        );
    String orderedAt(String id) =>
        _orderedAt[id] ?? now().toUtc().toIso8601String();
    return orderPageFromContract(
      api.ListOrders200Response.fromJson({
        'items': [
          for (final e in all.entries)
            if ((wire == null || e.value['status'] == wire) &&
                !hidden.contains(e.key) &&
                !toSeoulWallClock(DateTime.parse(orderedAt(e.key)))
                    .isBefore(fromDate) &&
                matches(e.value))
              {
                'orderId': e.key,
                'orderNumber': e.value['orderNumber'],
                'status': e.value['status'],
                'orderedAt': orderedAt(e.key),
                'totalAmount': (e.value['quote']! as Map)['totalAmount'],
                'itemCount': [
                  for (final l in e.value['lines']! as List)
                    (l as Map)['originalQty'] as int? ?? 0,
                ].fold<int>(0, (a, b) => a + b),
                'deliveryMode': e.value['deliveryMode'],
                if ((e.value['lines']! as List).firstOrNull
                    case final Map<String, Object?> first)
                  'representativeItem': {
                    'productId': first['productId'],
                    'sku': first['sku'],
                    'productName': first['productName'],
                    'quantity': first['originalQty'],
                  },
              },
        ],
        'page': {'nextCursor': null, 'size': 50},
      }),
    );
  }

  @override
  Future<CommandStatus> hide(
    String orderId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    final json = _all()[orderId];
    if (json == null) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    hideKeys[orderId] = key.value;
    // 서버 흉내: 끝난 주문(COMPLETED·CANCELLED·EXPIRED)만.
    if (!const {'COMPLETED', 'CANCELLED', 'EXPIRED'}.contains(json['status'])) {
      throw const ProblemFailure(
        Problem(status: 409, code: 'ORDER_NOT_FINISHED'),
      );
    }
    hidden.add(orderId);
    return CommandStatus.applied;
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
    return orderFromContract(api.Order.fromJson(_withReceipts(json)));
  }

  /// 고객이 "받았어요"를 누른 배송(서버가 전달 완료로 바꾼 것).
  final received = <String>{};

  /// 수령 확인에 보낸 키(배송 ID → 키). 같은 키 재전송은 같은 결과.
  final receiptKeys = <String, String>{};

  /// 다음 수령 확인 응답(시험용). null 이면 APPLIED.
  CommandStatus? nextReceiptStatus;

  /// 다음 수령 확인을 이 오류로 실패시킨다(시험용 — 409·결과 불명 등).
  PmartFailure? failNextReceipt;

  Map<String, Object?> _withReceipts(Map<String, Object?> json) {
    final shipments = json['shipments'] as List<Object?>?;
    if (shipments == null || received.isEmpty) return json;
    return {
      ...json,
      'shipments': [
        for (final sh in shipments.cast<Map<String, Object?>>())
          received.contains(sh['deliveryId'])
              ? {...sh, 'state': 'DELIVERED'}
              : sh,
      ],
    };
  }

  @override
  Future<CommandStatus> confirmReceipt(
    String deliveryId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (failNextReceipt case final f?) {
      failNextReceipt = null;
      throw f;
    }
    if (receiptKeys[deliveryId] == key.value) return CommandStatus.applied;
    if (received.contains(deliveryId)) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
    }
    final status = nextReceiptStatus ?? CommandStatus.applied;
    nextReceiptStatus = null;
    receiptKeys[deliveryId] = key.value;
    // 접수(ACCEPTED)도 곧 반영된다고 흉내 낸다 — 다시 읽으면 완료.
    if (status == CommandStatus.applied || status == CommandStatus.accepted) {
      received.add(deliveryId);
    }
    return status;
  }

  /// 배송별 ETA 조회 횟수(목 라이더 위치를 한 칸씩 옮기는 데 쓴다).
  final _etaCalls = <String, int>{};

  /// ETA 조회 횟수(시험이 10초 위치 갱신을 확인한다).
  int etaCallsOf(String deliveryId) => _etaCalls[deliveryId] ?? 0;

  /// 배달 중이어도 서버가 아직 라이더 위치를 주지 않는 경우 흉내.
  bool hideRiderLocation = false;

  /// 목 라이더 위치의 `staleSeconds`(서버가 받은 뒤 지난 초). 60 을 넘기면 앱이 "확인 중"으로 보인다.
  int riderStaleSeconds = 4;

  /// 목 라이더 위치: 출발점에서 목 배송지 좌표(35.1565, 129.0665)까지 20칸 중 [step] 번째.
  static Map<String, Object?> _riderTowardHome(int step) {
    const from = (lat: 35.1495, lng: 129.0590);
    const to = (lat: 35.1565, lng: 129.0665);
    final f = (step.clamp(0, 20)) / 20;
    return {
      'lat': from.lat + (to.lat - from.lat) * f,
      'lng': from.lng + (to.lng - from.lng) * f,
    };
  }

  @override
  Future<DeliveryEtaView> eta(String deliveryId) async {
    await _wait();
    if (etaFails) {
      throw const NetworkFailure(DioExceptionType.connectionTimeout);
    }
    return etaFromContract(
      deliveryId,
      trk.DeliveryEta.fromJson(_etaJson(deliveryId)),
    );
  }

  /// 목 서버의 지금 도착 예상(조회·구독이 같은 값을 쓴다). 배달 중 배송은 부를 때마다 라이더가 한 칸 다가온다.
  Map<String, Object?> _etaJson(String deliveryId) {
    final current = now().toUtc();
    return switch (deliveryId) {
      final id when received.contains(id) => {
        'deliveryId': deliveryId,
        'stage': 'DONE',
        'dropEta': {'status': 'FINAL'},
        'asOf': {'asOf': current.toIso8601String(), 'freshness': 'CURRENT'},
      },
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
        // 부를 때마다 배송지(목 배송지 geo) 쪽으로 한 칸씩 다가온다 — 지도 마커가 움직이는지 본다.
        if (!hideRiderLocation)
          'riderLocation': {
            ..._riderTowardHome(
              _etaCalls[deliveryId] = (_etaCalls[deliveryId] ?? 0) + 1,
            ),
            'recordedAt': current
                .subtract(Duration(seconds: riderStaleSeconds))
                .toIso8601String(),
            'staleSeconds': riderStaleSeconds,
          },
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
        // 배달 중 배송: 라이더가 움직일 때마다 서버가 ETA_UPDATED(eta.riderLocation)를 보낸다.
        if (liveRiderInterval case final every? when deliveryId == 'dlv-s2') {
          _riderTimers[c] = Timer.periodic(every, (_) {
            if (c.isClosed) return;
            final eta = etaFromContract(
              deliveryId,
              trk.DeliveryEta.fromJson(_etaJson(deliveryId)),
            );
            c.add(
              TrackingEvent(
                type: TrackingEventType.etaUpdated,
                id: 'evt-${++_eventSeq}',
                eta: eta,
                stage: eta.stage,
              ),
            );
          });
        }
      },
      onCancel: () => _forget(deliveryId, c),
    );
    c.done.then((_) => _forget(deliveryId, c));
    return c.stream;
  }

  final _riderTimers = <StreamController<TrackingEvent>, Timer>{};
  int _eventSeq = 0;

  void _forget(String deliveryId, StreamController<TrackingEvent> c) {
    _riderTimers.remove(c)?.cancel();
    final list = openTracks[deliveryId];
    list?.remove(c);
    if (list != null && list.isEmpty) openTracks.remove(deliveryId);
  }

  final _timeChanges =
      <String, ({String orderId, Map<String, String> window, int polls})>{};

  /// 다음 시간 변경을 서버가 거절하게 한다(정원 소진 등).
  bool rejectNextTimeChange = false;

  /// [rejectNextTimeChange] 때의 원인 코드(계약 `reason`).
  String rejectReason = TimeChangeCode.capacityExceeded;

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
    // 서버 흉내(order 0.10.0): 예약배달만, 지금과 다른 시간대만, 진행 중인 변경이 없을 때만.
    if (order['deliveryMode'] != 'SCHEDULED') {
      throw const ProblemFailure(
        Problem(status: 422, code: TimeChangeCode.notScheduled),
      );
    }
    final current = order['arrivalWindow'] as Map<String, Object?>?;
    if (current != null &&
        current['date'] == window.date &&
        current['start'] == window.start &&
        current['end'] == window.end) {
      throw const ProblemFailure(
        Problem(status: 422, code: TimeChangeCode.sameSlot),
      );
    }
    if (_timeChanges.values.any((r) => r.orderId == orderId)) {
      throw const ProblemFailure(
        Problem(status: 409, code: TimeChangeCode.inProgress),
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
  Future<TimeChangeResult> timeChange(
    String orderId,
    IdempotencyKey key,
  ) async {
    await _wait();
    final r = _timeChanges[key.value];
    if (r == null) {
      return TimeChangeResult(
        _confirmed.contains(key.value)
            ? RequestState.confirmed
            : RequestState.unknown,
      );
    }
    if (r.polls == 0) {
      _timeChanges[key.value] = (
        orderId: r.orderId,
        window: r.window,
        polls: 1,
      );
      return const TimeChangeResult(RequestState.pending);
    }
    if (rejectNextTimeChange) {
      rejectNextTimeChange = false;
      _timeChanges.remove(key.value);
      return TimeChangeResult(RequestState.rejected, reason: rejectReason);
    }
    final order = orderJson(orderId)!;
    overrides[orderId] = {
      ...order,
      'arrivalWindow': r.window,
      'version': (order['version']! as int) + 1,
    };
    _timeChanges.remove(key.value);
    _confirmed.add(key.value);
    return const TimeChangeResult(RequestState.confirmed);
  }

  final _confirmed = <String>{};
}
