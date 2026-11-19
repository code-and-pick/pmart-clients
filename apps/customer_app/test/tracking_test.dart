import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart'
    show mockShippingAddressJson;
import 'package:customer_app/features/orders/data/mock_orders_repository.dart';
import 'package:customer_app/features/orders/data/orders_repository.dart';
import 'package:customer_app/features/orders/data/sse_parser.dart';
import 'package:customer_app/features/orders/domain/orders.dart';
import 'package:customer_app/features/orders/domain/tracking.dart';
import 'package:customer_app/features/orders/presentation/orders_screens.dart';
import 'package:customer_app/features/orders/presentation/tracking_map.dart';
import 'package:customer_app/shared/order_status.dart';
import 'package:customer_app/shared/providers.dart' show sourceSystem;

import 'support/app_harness.dart';

/// SSE 본문을 조각으로 흘리는 어댑터. 요청과 본문 구독 취소 여부를 기록한다.
final class _SseAdapter implements HttpClientAdapter {
  _SseAdapter(this.chunks, {this.status = 200, this.endStream = true});

  final List<List<int>> chunks;
  final int status;
  final bool endStream;
  final requests = <RequestOptions>[];
  var bodyCancelled = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final c = StreamController<Uint8List>(onCancel: () => bodyCancelled = true);
    for (final ch in chunks) {
      c.add(Uint8List.fromList(ch));
    }
    if (endStream) unawaited(c.close());
    return ResponseBody(
      c.stream,
      status,
      headers: {
        Headers.contentTypeHeader: ['text/event-stream'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _dio(HttpClientAdapter adapter) => createPmartDio(
  baseUrl: 'http://test.invalid/api/v1',
  sourceSystem: sourceSystem,
  tokens: TokenStore(MemoryKeyValueStore()),
  refresher: (_) async => null,
  adapter: adapter,
  delay: (_) async {},
);

Map<String, Object?> _etaJson({
  String stage = 'TO_CUSTOMER',
  String status = 'AVAILABLE',
}) => {
  'deliveryId': 'dlv-s2',
  'stage': stage,
  'dropEta': {
    'status': status,
    if (status == 'AVAILABLE') 'etaAt': '2026-10-24T03:20:00Z',
    if (status == 'AVAILABLE') 'remainingSeconds': 600,
  },
  'asOf': {'asOf': '2026-10-24T03:00:00Z', 'freshness': 'CURRENT'},
};

void main() {
  setUpAll(initPmartFormatting);

  group('4단계 대응(서버 상태만)', () {
    test('주문 상태별 단계. 결제 전·모르는 값은 확인 중(null)', () {
      final expected = <OrderStatus, TrackStep?>{
        OrderStatus.draft: null,
        OrderStatus.resourcePending: null,
        OrderStatus.paymentPending: null,
        OrderStatus.paymentUnknown: null,
        OrderStatus.confirmed: TrackStep.confirmed,
        OrderStatus.preparing: TrackStep.preparing,
        OrderStatus.partiallyHandedOver: TrackStep.preparing,
        OrderStatus.inDelivery: TrackStep.delivering,
        OrderStatus.partiallyDelivered: TrackStep.delivering,
        OrderStatus.completed: TrackStep.delivered,
        OrderStatus.cancelled: null,
        OrderStatus.expired: null,
        OrderStatus.unknown: null,
      };
      expect(expected.keys.toSet(), OrderStatus.values.toSet());
      for (final e in expected.entries) {
        expect(trackStepOfOrder(e.key), e.value, reason: '${e.key}');
      }
    });

    test('배송 상태별 단계. FAILED·CANCELLED·모르는 값은 단계 없음', () {
      final expected = <ShipmentState, TrackStep?>{
        ShipmentState.planned: TrackStep.confirmed,
        ShipmentState.preparing: TrackStep.preparing,
        ShipmentState.ready: TrackStep.preparing,
        ShipmentState.handedOver: TrackStep.delivering,
        ShipmentState.inDelivery: TrackStep.delivering,
        ShipmentState.delivered: TrackStep.delivered,
        ShipmentState.failed: null,
        ShipmentState.cancelled: null,
        ShipmentState.unknown: null,
      };
      expect(expected.keys.toSet(), ShipmentState.values.toSet());
      for (final e in expected.entries) {
        expect(trackStepOfShipment(e.key), e.value, reason: '${e.key}');
      }
    });

    test('배달 단계(stage)별. DONE 만으로는 배달 완료가 아니다', () {
      final expected = <DeliveryStage, TrackStep?>{
        DeliveryStage.unassigned: TrackStep.confirmed,
        DeliveryStage.toStore: TrackStep.confirmed,
        DeliveryStage.atStore: TrackStep.confirmed,
        DeliveryStage.toCustomer: TrackStep.delivering,
        DeliveryStage.atCustomer: TrackStep.delivering,
        DeliveryStage.done: null,
        DeliveryStage.unknown: null,
      };
      expect(expected.keys.toSet(), DeliveryStage.values.toSet());
      for (final e in expected.entries) {
        expect(trackStepOfStage(e.key), e.value, reason: '${e.key}');
      }
    });

    test('모르는 값만 있으면 확인 중, 단계를 앞당기지 않는다', () {
      expect(trackProgressOf(), const TrackProgress());
      expect(
        trackProgressOf(
          order: OrderStatus.unknown,
          shipment: ShipmentState.unknown,
          stage: DeliveryStage.unknown,
        ),
        const TrackProgress(),
      );
      expect(
        trackProgressOf(stage: DeliveryStage.done).step,
        isNull,
        reason: '종료(DONE)는 완료·실패·취소를 가르지 않는다',
      );
    });

    test('배달 완료는 배송 DELIVERED 또는 주문 COMPLETED 일 때만', () {
      expect(
        trackProgressOf(
          order: OrderStatus.inDelivery,
          shipment: ShipmentState.inDelivery,
          stage: DeliveryStage.done,
        ).step,
        TrackStep.delivering,
      );
      expect(
        trackProgressOf(shipment: ShipmentState.delivered).step,
        TrackStep.delivered,
      );
      expect(
        trackProgressOf(order: OrderStatus.completed).step,
        TrackStep.delivered,
      );
    });

    test('배송 실패·취소는 멈춤(단계 없음), 완료로 보이지 않는다', () {
      final failed = trackProgressOf(
        order: OrderStatus.inDelivery,
        shipment: ShipmentState.failed,
        stage: DeliveryStage.done,
      );
      expect(failed.halted, isTrue);
      expect(failed.step, isNull);
      expect(trackProgressOf(order: OrderStatus.cancelled).halted, isTrue);
    });

    test('PARTIALLY_* 는 부분 표시, 주문 전체 단계는 앞당기지 않는다', () {
      final p = trackProgressOf(order: OrderStatus.partiallyDelivered);
      expect(p.partial, isTrue);
      expect(p.step, TrackStep.delivering);
      final h = trackProgressOf(order: OrderStatus.partiallyHandedOver);
      expect(h.partial, isTrue);
      expect(h.step, TrackStep.preparing);
      // 이 배송이 끝났다는 서버 값이 있으면 이 배송은 완료로 보인다.
      expect(
        trackProgressOf(
          order: OrderStatus.partiallyDelivered,
          shipment: ShipmentState.delivered,
        ),
        const TrackProgress(step: TrackStep.delivered, partial: true),
      );
    });
  });

  group('SSE 파서', () {
    List<SseMessage> parse(String text) {
      final p = SseParser();
      return [
        for (final line in const LineSplitter().convert(text)) ?p.add(line),
      ];
    }

    test('빈 줄에서 내보내고, data 여러 줄은 줄바꿈으로 잇는다', () {
      final m = parse('event: ETA_UPDATED\nid: 7\ndata: {"a":\ndata: 1}\n\n');
      expect(m, hasLength(1));
      expect(m.single.event, 'ETA_UPDATED');
      expect(m.single.id, '7');
      expect(m.single.data, '{"a":\n1}');
    });

    test('주석·data 없는 메시지는 건너뛰고, id 는 다음 메시지로 이어진다', () {
      final m = parse(
        ': keep-alive\n\nid: 3\nevent: X\n\ndata: a\n\ndata:b\r\n\r\n',
      );
      expect(m.map((e) => e.data), ['a', 'b']);
      expect(m.map((e) => e.id), ['3', '3']);
      expect(m.first.event, isNull, reason: 'data 없는 메시지의 event 는 버린다');
    });

    test('마지막 빈 줄이 없으면 내보내지 않는다(끊긴 메시지)', () {
      expect(parse('data: half'), isEmpty);
    });

    test('StreamEvent 변환: 계약 값만, 읽을 수 없으면 unknown', () {
      SseMessage msg(Object? body) =>
          SseMessage(data: jsonEncode(body), id: '9');
      final eta = trackingEventFromSse(
        'dlv-s2',
        msg({
          'id': '10',
          'type': 'ETA_UPDATED',
          'deliveryId': 'dlv-s2',
          'sentAt': '2026-10-24T03:00:00Z',
          'eta': _etaJson(),
        }),
      );
      expect(eta.type, TrackingEventType.etaUpdated);
      expect(eta.id, '10');
      expect(eta.eta?.stage, DeliveryStage.toCustomer);
      expect(eta.eta?.remainingSeconds, 600);

      final stage = trackingEventFromSse(
        'dlv-s2',
        msg({
          'type': 'STAGE_CHANGED',
          'deliveryId': 'dlv-s2',
          'sentAt': '2026-10-24T03:00:00Z',
          'stage': 'AT_CUSTOMER',
        }),
      );
      expect(stage.type, TrackingEventType.stageChanged);
      expect(stage.id, '9', reason: '본문에 id 가 없으면 SSE id');
      expect(stage.stage, DeliveryStage.atCustomer);

      expect(
        trackingEventFromSse(
          'd',
          msg({
            'type': 'RIDER_MOVED',
            'deliveryId': 'd',
            'sentAt': '2026-10-24T03:00:00Z',
          }),
        ).type,
        TrackingEventType.unknown,
      );
      expect(
        trackingEventFromSse('d', const SseMessage(data: 'not json')).type,
        TrackingEventType.unknown,
      );
    });
  });

  group('API 구독', () {
    test('스트림 응답을 줄로 읽어 이벤트로, Accept·Last-Event-ID 를 보낸다', () async {
      final text =
          ': ping\n\n'
          'id: 1\nevent: ETA_UPDATED\ndata: ${jsonEncode({'type': 'ETA_UPDATED', 'deliveryId': 'dlv-s2', 'sentAt': '2026-10-24T03:00:00Z', 'eta': _etaJson()})}\n\n'
          'id: 2\nevent: STREAM_END\ndata: {"type":"STREAM_END","deliveryId":"dlv-s2","sentAt":"2026-10-24T03:30:00Z"}\n\n';
      final bytes = utf8.encode(text);
      // 줄·글자 중간에서 잘라 보낸다.
      final adapter = _SseAdapter([
        bytes.sublist(0, 7),
        bytes.sublist(7, 61),
        bytes.sublist(61),
      ]);
      final repo = ApiOrdersRepository(_dio(adapter));
      final events = await repo.track('dlv-s2', lastEventId: '0').toList();

      expect(events.map((e) => e.type), [
        TrackingEventType.etaUpdated,
        TrackingEventType.streamEnd,
      ]);
      expect(events.first.eta?.status, EtaStatus.available);
      final req = adapter.requests.single;
      expect(req.uri.path, '/api/v1/deliveries/dlv-s2/stream');
      expect(req.headers['Accept'], 'text/event-stream');
      expect(req.headers['Last-Event-ID'], '0');
      expect(req.responseType, ResponseType.stream);
    });

    test('구독을 취소하면 연결 본문도 닫힌다', () async {
      final adapter = _SseAdapter([
        utf8.encode(
          'data: {"type":"HEARTBEAT","deliveryId":"d","sentAt":"2026-10-24T03:00:00Z"}\n\n',
        ),
      ], endStream: false);
      final repo = ApiOrdersRepository(_dio(adapter));
      final first = Completer<TrackingEvent>();
      final sub = repo.track('d').listen(first.complete);
      expect((await first.future).type, TrackingEventType.heartbeat);
      await sub.cancel();
      expect(adapter.bodyCancelled, isTrue);
    });

    test('연결 실패는 PmartFailure 오류(배송 실패 아님)', () async {
      final adapter = _SseAdapter(const [], status: 503);
      final repo = ApiOrdersRepository(_dio(adapter));
      await expectLater(repo.track('d').toList(), throwsA(isA<PmartFailure>()));
    });
  });

  group('배송현황 화면', () {
    Future<void> openTracking(
      WidgetTester t,
      MockOrdersRepository orders, {
      required String orderId,
      required String deliveryId,
      List<Override> overrides = const [],
    }) async {
      t.view
        ..physicalSize = const Size(800, 2400)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(testApp(overrides, orders: orders));
      await t.pumpAndSettle();
      await t.tap(find.text('마이페이지').last);
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('my-login')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('login-kakao')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('my-orders')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(ValueKey('order-$orderId')));
      await t.pumpAndSettle();
      await t.ensureVisible(find.byKey(ValueKey('track-$deliveryId')));
      await t.tap(find.byKey(ValueKey('track-$deliveryId')));
      await t.pumpAndSettle();
      expect(find.byType(TrackingScreen), findsOneWidget);
    }

    Finder key(String k) => find.byKey(ValueKey(k));

    testWidgets('예약배달: 서버 도착 구간·취소/시간 변경 진입, 단계는 주문 확인', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-4',
        deliveryId: 'dlv-1',
      );
      expect(key('track-reserved'), findsOneWidget);
      // 서버 도착 구간(18:00~19:00, 서울 시각)을 그대로 보인다.
      expect(
        t.widget<Text>(key('track-reserved')).data,
        allOf(contains('6:00'), contains('7:00'), endsWith('예약')),
      );
      expect(key('track-cancel'), findsOneWidget);
      expect(key('track-reschedule'), findsOneWidget);
      expect(key('track-step-current-confirmed'), findsOneWidget);
      expect(key('track-step-current-delivered'), findsNothing);

      // 시간 변경 화면에 다녀오는 동안 연결을 닫고, 돌아오면 다시 붙는다.
      await t.tap(key('track-reschedule'));
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 0);
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 1);
    });

    testWidgets('실시간 이벤트로 갱신하고, 종료(DONE)만으로는 배달 완료가 아니다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(orders.openTrackCount, 1);
      expect(key('track-step-current-delivering'), findsOneWidget);
      expect(key('track-partial'), findsOneWidget);
      expect(key('track-live-fallback'), findsNothing);

      orders.emitTracking(
        'dlv-s2',
        TrackingEvent(
          type: TrackingEventType.etaUpdated,
          id: '1',
          eta: etaFromContract(
            'dlv-s2',
            trk.DeliveryEta.fromJson(_etaJson(stage: 'AT_CUSTOMER')),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('곧 도착해요'), findsOneWidget);

      // 단계만 DONE 으로 바뀜: 주문을 다시 묻지만 배송은 아직 IN_DELIVERY → 완료 아님.
      orders.emitTracking(
        'dlv-s2',
        const TrackingEvent(
          type: TrackingEventType.stageChanged,
          stage: DeliveryStage.done,
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('배송이 끝났어요'), findsOneWidget);
      expect(key('track-step-current-delivered'), findsNothing);
      expect(key('track-step-current-delivering'), findsOneWidget);

      // 서버가 배송 DELIVERED 를 주고 스트림을 끝내면 그때 완료.
      final o = orders.orderJson('order-seed-1')!;
      orders.overrides['order-seed-1'] = {
        ...o,
        'status': 'COMPLETED',
        'shipments': [
          for (final s
              in (o['shipments']! as List).cast<Map<String, Object?>>())
            {...s, 'state': 'DELIVERED'},
        ],
      };
      orders.emitTracking(
        'dlv-s2',
        const TrackingEvent(type: TrackingEventType.streamEnd),
      );
      await orders.dropTracking('dlv-s2');
      await t.pumpAndSettle();
      expect(key('track-step-current-delivered'), findsOneWidget);
      expect(
        key('track-live-fallback'),
        findsNothing,
        reason: '정상 종료는 끊김이 아니다',
      );
      expect(orders.trackOpens, 1, reason: '종료 뒤 다시 붙지 않는다');
    });

    testWidgets('구독 실패 → 주기 조회 안내, 재연결되면 안내를 걷는다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero)
        ..trackFails = true;
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(key('track-live-fallback'), findsOneWidget);
      expect(find.text('실시간 연결이 끊겨 주기적으로 확인하고 있어요'), findsOneWidget);
      // 끊김은 배송 실패·완료가 아니다.
      expect(find.text('배송하지 못함'), findsNothing);
      expect(key('track-step-current-delivered'), findsNothing);
      expect(key('track-step-current-delivering'), findsOneWidget);

      orders.trackFails = false;
      await t.pump(const Duration(seconds: 1));
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 1);
      expect(key('track-live-fallback'), findsNothing);
    });

    testWidgets('구독·위치 조회가 모두 실패해도 배송 실패·완료로 보이지 않는다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero)
        ..trackFails = true
        ..etaFails = true;
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(key('eta-failed'), findsOneWidget);
      expect(key('track-live-fallback'), findsOneWidget);
      expect(find.text('배송하지 못함'), findsNothing);
      expect(find.text('배달 완료'), findsNothing);
    });

    testWidgets('화면을 닫으면 구독을 닫는다, 앱이 가려져도 닫는다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(orders.openTrackCount, 1);

      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      await t.pump();
      expect(orders.openTrackCount, 0);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 1);

      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(find.byType(TrackingScreen), findsNothing);
      expect(orders.openTrackCount, 0);
    });

    testWidgets('배달 중 + 서버 라이더 위치 → 지도와 아래 시트(남은 시간·위치 시각)', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(key('track-map-mode'), findsOneWidget);
      // 목 모드는 카카오 지도를 쓰지 않는다(지도 대신 안내 칸).
      expect(key('track-map-unavailable'), findsOneWidget);
      expect(find.text('12분 남음'), findsOneWidget);
      expect(key('track-rider-at'), findsOneWidget);
      expect(key('track-step-current-delivering'), findsOneWidget);
      expect(key('track-map-inquiry'), findsOneWidget);
      // 지도 화면에서도 "배달 완료"로 앞당기지 않는다.
      expect(key('track-step-current-delivered'), findsNothing);
    });

    // PC 5 요청 2026-11-19(clients/all/2026-11-19-notice-live-rider-location.md): 위치는 SSE ETA_UPDATED 로.
    TrackingEvent riderAt(double lat, double lng, {int stale = 3}) =>
        TrackingEvent(
          type: TrackingEventType.etaUpdated,
          eta: etaFromContract(
            'dlv-s2',
            trk.DeliveryEta.fromJson({
              ..._etaJson(),
              'riderLocation': {
                'lat': lat,
                'lng': lng,
                'recordedAt': '2026-10-24T03:00:00Z',
                'staleSeconds': stale,
              },
            }),
          ),
        );
    TrackingMap map(WidgetTester t) =>
        t.widget<TrackingMap>(find.byType(TrackingMap));

    testWidgets('구독이 붙어 있으면 다시 읽지 않고, ETA_UPDATED 의 위치로 마커를 옮긴다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      final before = orders.etaCallsOf('dlv-s2');
      await t.pump(const Duration(seconds: 30));
      await t.pumpAndSettle();
      expect(orders.etaCallsOf('dlv-s2'), before, reason: '구독 중에는 주기 조회 없음');

      orders.emitTracking('dlv-s2', riderAt(35.1500, 129.0600));
      await t.pumpAndSettle();
      expect(map(t).rider, (lat: 35.1500, lng: 129.0600));
      expect(map(t).riderStale, isFalse);
      orders.emitTracking('dlv-s2', riderAt(35.1510, 129.0610));
      await t.pumpAndSettle();
      expect(map(t).rider, (lat: 35.1510, lng: 129.0610));
      expect(TrackingMap.glide, const Duration(seconds: 1));
    });

    testWidgets('목 서버: 5초마다 구독으로 새 위치가 와서 마커가 움직인다', (t) async {
      final orders = MockOrdersRepository(
        latency: Duration.zero,
        liveRiderInterval: const Duration(seconds: 5),
      );
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      final first = map(t).rider;
      await t.pump(const Duration(seconds: 5));
      await t.pumpAndSettle();
      final second = map(t).rider;
      expect(second, isNot(first));
      await t.pump(const Duration(seconds: 5));
      await t.pumpAndSettle();
      expect(map(t).rider, isNot(second));
      // 화면을 닫으면 구독(과 목 타이머)도 닫힌다.
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 0);
    });

    testWidgets('구독이 끊긴 동안만 10초마다 위치를 읽고, 다시 붙으면 멈춘다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      orders.trackFails = true;
      await orders.dropTracking(
        'dlv-s2',
        error: const NetworkFailure(DioExceptionType.connectionError),
      );
      await t.pumpAndSettle();
      expect(key('track-live-fallback'), findsOneWidget);
      final dropped = orders.etaCallsOf('dlv-s2');
      await t.pump(const Duration(seconds: 10));
      await t.pumpAndSettle();
      expect(orders.etaCallsOf('dlv-s2'), greaterThan(dropped));

      orders.trackFails = false;
      await t.pump(const Duration(seconds: 60));
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 1);
      final live = orders.etaCallsOf('dlv-s2');
      await t.pump(const Duration(seconds: 30));
      await t.pumpAndSettle();
      expect(orders.etaCallsOf('dlv-s2'), live, reason: '다시 붙으면 주기 조회 멈춤');

      // 앱이 가려지면 구독을 닫고 읽지도 않는다.
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      await t.pump();
      expect(orders.openTrackCount, 0);
      final paused = orders.etaCallsOf('dlv-s2');
      await t.pump(const Duration(seconds: 30));
      expect(orders.etaCallsOf('dlv-s2'), paused);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      expect(orders.openTrackCount, 1);
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
    });

    testWidgets('받은 지 60초 넘은 위치는 흐리게 + 확인 중, 새 위치가 오면 되돌린다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero)
        ..riderStaleSeconds = 90;
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(map(t).riderStale, isTrue);
      expect(key('track-rider-locating'), findsOneWidget);
      expect(key('track-rider-at'), findsNothing);

      orders.emitTracking('dlv-s2', riderAt(35.1520, 129.0620, stale: 2));
      await t.pumpAndSettle();
      expect(map(t).riderStale, isFalse);
      expect(key('track-rider-locating'), findsNothing);
      expect(key('track-rider-at'), findsOneWidget);
    });

    testWidgets('구독이 위치 없이(null) 오면 라이더 마커만 숨긴다 — 내 배송지 지도·도착 예정은 그대로', (
      t,
    ) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      // 내 배송지 핀이 있는 주문(사본 geo).
      orders.overrides['order-seed-1'] = {
        ...orders.orderJson('order-seed-1')!,
        'shippingAddress': mockShippingAddressJson,
      };
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(map(t).rider, isNotNull);
      expect(map(t).home, (lat: 35.1565, lng: 129.0665));

      orders.emitTracking(
        'dlv-s2',
        TrackingEvent(
          type: TrackingEventType.etaUpdated,
          eta: etaFromContract('dlv-s2', trk.DeliveryEta.fromJson(_etaJson())),
        ),
      );
      await t.pumpAndSettle();
      expect(key('track-map-mode'), findsOneWidget);
      expect(map(t).rider, isNull, reason: '예전 위치로 채우지 않는다');
      expect(map(t).home, isNotNull);
      expect(key('track-rider-locating'), findsOneWidget);
      expect(find.text('10분 남음'), findsOneWidget);
    });

    testWidgets('배송지 좌표 없이 라이더 위치가 사라져도 지도는 그대로 — 마커만 숨기고 확인 중(지어내지 않음)', (
      t,
    ) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      orders.emitTracking(
        'dlv-s2',
        TrackingEvent(
          type: TrackingEventType.etaUpdated,
          eta: etaFromContract('dlv-s2', trk.DeliveryEta.fromJson(_etaJson())),
        ),
      );
      await t.pumpAndSettle();
      // order-seed-1 은 배송지 사본이 없다(배포 전 주문). 한 번 그린 지도는 다시 만들지 않는다(카메라가 튀지 않게) —
      // 라이더 마커만 숨기고 "확인하고 있어요".
      expect(key('track-map-mode'), findsOneWidget);
      expect(key('track-map-pending'), findsNothing);
      expect(map(t).rider, isNull);
      expect(key('track-rider-locating'), findsOneWidget);
    });

    testWidgets('배달 중인데 위치가 아직 없어도 지도 화면 — 라이더 마커 없이 확인 중', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero)
        ..hideRiderLocation = true;
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-1',
        deliveryId: 'dlv-s2',
      );
      expect(key('track-map-mode'), findsOneWidget);
      expect(key('track-rider-locating'), findsOneWidget);
      expect(key('track-step-current-delivering'), findsOneWidget);
    });

    // BR-61: 실서버 주문 응답은 shipments 가 비어 배송 ID 를 모른다 — 그래도 주문 상세에서 지도가 바로 뜬다.
    Future<void> openOrder(
      WidgetTester t,
      MockOrdersRepository orders,
      String id,
    ) async {
      t.view
        ..physicalSize = const Size(800, 2400)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(testApp(const [], orders: orders));
      await t.pumpAndSettle();
      await t.tap(find.text('마이페이지').last);
      await t.pumpAndSettle();
      await t.tap(key('my-login'));
      await t.pumpAndSettle();
      await t.tap(key('login-kakao'));
      await t.pumpAndSettle();
      await t.tap(key('my-orders'));
      await t.pumpAndSettle();
      await t.tap(key('order-$id'));
      await t.pumpAndSettle();
    }

    testWidgets('배송 ID 가 없는 주문도 "배송현황 보기" → 지도(내 배송지)·주문 단계', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      orders.overrides['order-seed-4'] = {
        ...orders.orderJson('order-seed-4')!,
        'shipments': <Object?>[],
      };
      await openOrder(t, orders, 'order-seed-4');
      expect(key('order-track'), findsOneWidget);
      await t.tap(key('order-track'));
      await t.pumpAndSettle();

      expect(key('track-map-mode'), findsOneWidget);
      expect(find.byType(TrackingScreen), findsNothing);
      expect(map(t).home, (lat: 35.1565, lng: 129.0665));
      expect(map(t).rider, isNull);
      expect(key('track-no-delivery'), findsOneWidget);
      expect(key('track-step-current-confirmed'), findsOneWidget);
      expect(orders.trackOpens, 0, reason: '배송 ID 없이는 구독하지 않는다');

      // 레퍼런스: 배달정보 자세히(주소·요청사항), 센터·상세내역, 주문 상품, 총 결제금액.
      await t.ensureVisible(key('track-total'));
      expect(key('track-store'), findsOneWidget);
      // 센터 이름(order 0.15.0 mfcName — BR-62).
      expect(find.text('PMart 부산진구점'), findsOneWidget);
      expect(key('track-order-detail'), findsOneWidget);
      expect(find.text('21,040원'), findsOneWidget);
      await t.ensureVisible(key('track-delivery-info'));
      await t.tap(key('track-delivery-info'));
      await t.pumpAndSettle();
      expect(key('track-delivery-info-body'), findsOneWidget);
      expect(key('track-request'), findsOneWidget);
    });

    testWidgets('배차 전에 열어 두면 배송이 생기는 대로(10초마다 주문 확인) 실시간 화면으로 넘어간다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      final o = orders.orderJson('order-seed-4')!;
      orders.overrides['order-seed-4'] = {...o, 'shipments': <Object?>[]};
      await openOrder(t, orders, 'order-seed-4');
      await t.tap(key('order-track'));
      await t.pumpAndSettle();
      expect(key('track-no-delivery'), findsOneWidget);
      expect(find.byType(TrackingScreen), findsNothing);

      // 서버: 배차로 배송이 생겼다(shipments 에 deliveryId).
      orders.overrides['order-seed-4'] = o;
      await t.pump(const Duration(seconds: 10));
      await t.pumpAndSettle();
      expect(find.byType(TrackingScreen), findsOneWidget);
      expect(orders.openTrackCount, 1);
      await t.tap(find.byType(BackButton).first);
      await t.pumpAndSettle();
    });

    testWidgets('배차 전에 열어 두면 배송이 생기는 대로(10초마다 주문 확인) 실시간 화면으로 넘어간다', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      final o = orders.orderJson('order-seed-4')!;
      orders.overrides['order-seed-4'] = {...o, 'shipments': <Object?>[]};
      await openOrder(t, orders, 'order-seed-4');
      await t.tap(key('order-track'));
      await t.pumpAndSettle();
      expect(key('track-no-delivery'), findsOneWidget);
      expect(find.byType(TrackingScreen), findsNothing);

      // 서버: 배차로 배송이 생겼다(shipments 에 deliveryId).
      orders.overrides['order-seed-4'] = o;
      await t.pump(const Duration(seconds: 10));
      await t.pumpAndSettle();
      expect(find.byType(TrackingScreen), findsOneWidget);
      expect(orders.openTrackCount, 1);
      await t.tap(find.byType(BackButton).first);
      await t.pumpAndSettle();
    });

    testWidgets('배송 ID 가 있으면 "배송현황 보기"가 실시간 화면으로', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openOrder(t, orders, 'order-seed-4');
      await t.tap(key('order-track'));
      await t.pumpAndSettle();
      expect(find.byType(TrackingScreen), findsOneWidget);
      expect(key('track-map-mode'), findsOneWidget);
      expect(orders.openTrackCount, 1);
    });

    testWidgets('픽업 전에도 지도가 바로 뜬다 — 내 배송지 마커만, 라이더 위치 문구 없음', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-4',
        deliveryId: 'dlv-1',
      );
      expect(key('track-map-mode'), findsOneWidget);
      expect(find.byType(TrackingMap), findsOneWidget);
      expect(map(t).rider, isNull);
      expect(map(t).home, (lat: 35.1565, lng: 129.0665));
      expect(key('track-rider-locating'), findsNothing);
      expect(key('track-reserved'), findsOneWidget);
    });

    testWidgets('사본에 핀이 없으면 배송지 도로명을 주소 변환해 지도 가운데로', (t) async {
      final orders = MockOrdersRepository(latency: Duration.zero);
      final o = orders.orderJson('order-seed-4')!;
      final ship = {...(o['shippingAddress']! as Map<String, Object?>)}
        ..remove('geo');
      orders.overrides['order-seed-4'] = {...o, 'shippingAddress': ship};
      await openTracking(
        t,
        orders,
        orderId: 'order-seed-4',
        deliveryId: 'dlv-1',
      );
      expect(find.byType(TrackingMap), findsOneWidget);
      expect(map(t).home, isNotNull);
    });
  });

  group('라이더 위치 변환', () {
    test('좌표가 있으면 위치, 빠지면 null(0,0 으로 그리지 않음)', () {
      final ok = etaFromContract(
        'd',
        trk.DeliveryEta.fromJson({
          ..._etaJson(),
          'riderLocation': {
            'lat': 35.15,
            'lng': 129.06,
            'recordedAt': '2026-10-24T03:00:00Z',
            'staleSeconds': 7,
          },
        }),
      );
      expect(ok.riderLocation?.lat, 35.15);
      expect(ok.riderLocation?.lng, 129.06);
      expect(ok.riderLocation?.staleSeconds, 7);
      expect(
        ok.riderLocation.toString(),
        isNot(contains('35.15')),
        reason: '좌표를 toString 으로 흘리지 않는다',
      );
      expect(
        ok.withStage(DeliveryStage.atCustomer).riderLocation,
        ok.riderLocation,
      );

      final missing = etaFromContract(
        'd',
        trk.DeliveryEta.fromJson({
          ..._etaJson(),
          'riderLocation': {'lat': 35.15},
        }),
      );
      expect(missing.riderLocation, isNull);
      expect(
        etaFromContract(
          'd',
          trk.DeliveryEta.fromJson(_etaJson()),
        ).riderLocation,
        isNull,
      );
    });
  });
}
