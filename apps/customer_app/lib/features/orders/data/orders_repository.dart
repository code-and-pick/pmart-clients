import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_api_order/pmart_api_order.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/order_status.dart';
import '../../checkout/data/checkout_repository.dart'
    show quoteFromContract, shippingAddressFromContract;
import '../../checkout/domain/checkout.dart'
    show ArrivalWindow, OutOfStockPreference;
import '../../../shared/providers.dart' show sourceSystem;
import '../../claims/data/claims_repository.dart' show requestStateOf;
import '../../claims/domain/claims.dart' show RequestState;
import '../domain/orders.dart';
import '../domain/tracking.dart';
import 'sse_parser.dart';

/// 주문 조회·배송 도착 예상. 실패는 [PmartFailure] 로 던진다(빈 목록·배송 실패로 바꾸지 않는다).
abstract interface class OrdersRepository {
  /// `GET /orders`. [status] 를 주면 그 상태의 주문만(계약 `status` 쿼리, 하나만 받는다).
  Future<OrderPage> list({String? cursor, OrderStatus? status});

  Future<OrderDetail> get(String orderId);

  /// `GET /deliveries/{id}/eta`. 실시간 구독이 끊겼을 때 주기 조회에도 쓴다.
  Future<DeliveryEtaView> eta(String deliveryId);

  /// `GET /deliveries/{id}/stream`(SSE). 구독을 취소하면 연결을 닫는다.
  /// 연결 실패·끊김은 오류 또는 완료로 끝난다(배송 실패가 아니다). [lastEventId] 로 이어 받는다.
  Stream<TrackingEvent> track(String deliveryId, {String? lastEventId});

  /// `POST /orders/{id}/reservation-time-changes`(202). 상품 준비 전만 받는다(INVALID_STATE).
  Future<void> requestTimeChange(
    String orderId,
    ArrivalWindow window, {
    required int expectedVersion,
    required IdempotencyKey key,
  });

  /// 시간 변경 결과 조회. 불명이면 [RequestState.unknown].
  Future<RequestState> timeChange(String orderId, IdempotencyKey key);
}

final class ApiOrdersRepository implements OrdersRepository {
  ApiOrdersRepository(Dio dio)
    : _dio = dio,
      _orders = api.PmartApiOrder(dio: dio).getOrdersApi(),
      _eta = trk.PmartApiDeliveryTracking(dio: dio).getEtaApi();

  final Dio _dio;
  final api.OrdersApi _orders;
  final trk.EtaApi _eta;

  /// 이벤트 사이 최대 대기. 서버 HEARTBEAT 보다 길게 둔다(그 안에 아무것도 안 오면 끊긴 것으로 본다).
  static const streamIdleTimeout = Duration(seconds: 60);

  @override
  Stream<TrackingEvent> track(String deliveryId, {String? lastEventId}) {
    final cancel = CancelToken();
    StreamSubscription<String>? lines;
    late final StreamController<TrackingEvent> out;

    Future<void> fail(Object error, [StackTrace? st]) async {
      if (out.isClosed) return;
      if (!(error is DioException && CancelToken.isCancel(error))) {
        out.addError(
          error is DioException ? PmartFailure.fromDioException(error) : error,
          st,
        );
      }
      await out.close();
    }

    out = StreamController<TrackingEvent>(
      onListen: () async {
        try {
          // 생성 클라이언트(`EtaApi.streamDeliveryTracking`)는 본문을 JSON 하나로 읽어 스트림을 받을 수 없다.
          // 같은 계약 경로를 스트림 응답으로 직접 연다(operationId streamDeliveryTracking).
          final res = await _dio.get<ResponseBody>(
            '/deliveries/${Uri.encodeComponent(deliveryId)}/stream',
            options: Options(
              responseType: ResponseType.stream,
              receiveTimeout: streamIdleTimeout,
              headers: {
                'Accept': 'text/event-stream',
                'Last-Event-ID': ?lastEventId,
              },
            ),
            cancelToken: cancel,
          );
          final body = res.data;
          if (body == null) {
            return await fail(const ContractViolationFailure('배송 구독 본문 없음'));
          }
          if (out.isClosed) return;
          final parser = SseParser();
          lines = body.stream
              .cast<List<int>>()
              .transform(utf8.decoder)
              .transform(const LineSplitter())
              .listen(
                (line) {
                  final m = parser.add(line);
                  if (m != null && !out.isClosed) {
                    out.add(trackingEventFromSse(deliveryId, m));
                  }
                },
                onError: fail,
                onDone: () async {
                  if (!out.isClosed) await out.close();
                },
                cancelOnError: true,
              );
        } catch (e, st) {
          await fail(e, st);
        }
      },
      onCancel: () async {
        cancel.cancel();
        await lines?.cancel();
      },
    );
    return out.stream;
  }

  @override
  Future<OrderPage> list({String? cursor, OrderStatus? status}) async {
    final res = await pmartGuard(
      () =>
          _orders.listOrders(cursor: cursor, status: orderStatusToWire(status)),
    );
    return orderPageFromContract(
      res.data ?? (throw const ContractViolationFailure('주문 목록 본문 없음')),
    );
  }

  @override
  Future<OrderDetail> get(String orderId) async {
    final res = await pmartGuard(() => _orders.getOrder(orderId: orderId));
    return orderFromContract(
      res.data ?? (throw const ContractViolationFailure('주문 본문 없음')),
    );
  }

  @override
  Future<DeliveryEtaView> eta(String deliveryId) async {
    final res = await pmartGuard(
      () => _eta.getDeliveryEta(deliveryId: deliveryId),
    );
    return etaFromContract(
      deliveryId,
      res.data ?? (throw const ContractViolationFailure('ETA 본문 없음')),
    );
  }

  @override
  Future<void> requestTimeChange(
    String orderId,
    ArrivalWindow window, {
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    await pmartGuard(
      () => _orders.requestReservationTimeChange(
        orderId: orderId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        requestReservationTimeChangeRequest:
            api.RequestReservationTimeChangeRequest(
              newArrivalWindow: api.ArrivalWindow(
                date: window.date,
                start: window.start,
                end: window.end,
              ),
            ),
        extra: commandOptions(key, expectedVersion: expectedVersion).extra,
      ),
    );
  }

  @override
  Future<RequestState> timeChange(String orderId, IdempotencyKey key) async {
    try {
      final res = await pmartGuard(
        () => _orders.getReservationTimeChange(
          orderId: orderId,
          requestId: key.value,
        ),
      );
      return requestStateOf(res.data?.state?.value);
    } on ProblemFailure catch (f) {
      if (f.problem.code == ProblemCode.notFound) return RequestState.unknown;
      rethrow;
    }
  }
}

/// 앱 상태 → 계약 enum(생성 코드의 값만 쓴다). null·unknown 은 조건 없음.
api.OrderStatus? orderStatusToWire(OrderStatus? s) => switch (s) {
  null || OrderStatus.unknown => null,
  final s =>
    api.OrderStatus.values
        .where((v) => OrderStatus.fromWire(v.value) == s)
        .firstOrNull,
};

T _need<T>(T? v, String field) =>
    v ?? (throw ContractViolationFailure('$field 없음'));

Freshness _freshness(String? wire) => switch (wire) {
  'CURRENT' => Freshness.current,
  'STALE' => Freshness.stale,
  'UNAVAILABLE' => Freshness.unavailable,
  _ => Freshness.unknown,
};

OrderPage orderPageFromContract(api.ListOrders200Response r) => OrderPage(
  items: [
    for (final o in r.items ?? const <api.OrderSummary>[])
      OrderListItem(
        orderId: _need(o.orderId, 'OrderSummary.orderId'),
        orderNumber: o.orderNumber,
        status: OrderStatus.fromWire(o.status?.value),
        orderedAt: o.orderedAt,
        totalAmount: o.totalAmount,
        itemCount: o.itemCount,
      ),
  ],
  nextCursor: r.page?.nextCursor,
);

OrderDetail orderFromContract(api.Order o) => OrderDetail(
  orderId: _need(o.orderId, 'Order.orderId'),
  orderNumber: o.orderNumber,
  version: o.version ?? 0,
  status: OrderStatus.fromWire(o.status?.value),
  deliveryMode: o.deliveryMode,
  mfcId: o.mfcId,
  window: switch (o.arrivalWindow) {
    final w? => ArrivalWindow(date: w.date, start: w.start, end: w.end),
    null => null,
  },
  quote: o.quote == null ? null : quoteFromContract(o.quote!),
  shippingAddress: shippingAddressFromContract(o.shippingAddress),
  lines: [
    for (final l in o.lines ?? const <api.OrderLine>[])
      OrderLineView(
        orderLineId: _need(l.orderLineId, 'OrderLine.orderLineId'),
        sku: _need(l.sku, 'OrderLine.sku'),
        productName: l.productName,
        optionLabel: l.optionLabel,
        unitPrice: l.unitPrice,
        originalQty: l.originalQty,
        cancelledBeforeShipQty: l.cancelledBeforeShipQty,
        handedOverQty: l.handedOverQty,
        deliveredQty: l.deliveredQty,
        returnedQty: l.returnedQty,
        unfulfilledQty: l.unfulfilledQty,
      ),
  ],
  shipments: [
    for (final s in o.shipments ?? const <api.Shipment>[])
      ShipmentView(
        shipmentId: _need(s.shipmentId, 'Shipment.shipmentId'),
        deliveryId: s.deliveryId,
        state: switch (s.state?.value) {
          'PLANNED' => ShipmentState.planned,
          'PREPARING' => ShipmentState.preparing,
          'READY' => ShipmentState.ready,
          'HANDED_OVER' => ShipmentState.handedOver,
          'IN_DELIVERY' => ShipmentState.inDelivery,
          'DELIVERED' => ShipmentState.delivered,
          'FAILED' => ShipmentState.failed,
          'CANCELLED' => ShipmentState.cancelled,
          _ => ShipmentState.unknown,
        },
        lines: [
          for (final l in s.lines ?? const <api.ShipmentLinesInner>[])
            if (l.orderLineId != null)
              (orderLineId: l.orderLineId!, qty: l.qty ?? 0),
        ],
        eta: s.eta,
      ),
  ],
  paymentState: o.payment?.state,
  paymentAttemptId: o.payment?.paymentAttemptId,
  refundedAmount: o.payment?.refundedAmount,
  deliveryNote: switch (o.deliveryNote?.trim()) {
    final n? when n.isNotEmpty => n,
    _ => null,
  },
  outOfStock: switch (o.outOfStockPreference) {
    api.OrderOutOfStockPreferenceEnum.CANCEL_OOS_ONLY =>
      OutOfStockPreference.cancelOutOfStockOnly,
    api.OrderOutOfStockPreferenceEnum.CANCEL_ALL =>
      OutOfStockPreference.cancelAll,
    null => null,
  },
  claims: [
    for (final c in o.claims ?? const <api.OrderClaimsInner>[])
      if (c.claimId != null)
        (claimId: c.claimId!, type: c.type ?? '', state: c.state ?? ''),
  ],
  sources: [
    for (final s in o.sources ?? const <api.OrderSourcesInner>[])
      SourceStamp(
        system: s.system ?? '',
        asOf: s.asOf?.asOf,
        freshness: _freshness(s.asOf?.freshness?.value),
      ),
  ],
);

/// 계약 `DeliveryEta.stage` 값 → 단계. 모르는 값은 unknown.
DeliveryStage deliveryStageOf(String? wire) => switch (wire) {
  'UNASSIGNED' => DeliveryStage.unassigned,
  'TO_STORE' => DeliveryStage.toStore,
  'AT_STORE' => DeliveryStage.atStore,
  'TO_CUSTOMER' => DeliveryStage.toCustomer,
  'AT_CUSTOMER' => DeliveryStage.atCustomer,
  'DONE' => DeliveryStage.done,
  _ => DeliveryStage.unknown,
};

/// SSE 메시지 → 이벤트(계약 `StreamEvent`). 읽을 수 없는 본문·모르는 type 은 [TrackingEventType.unknown]
/// (연결이 살아 있다는 뜻으로만 쓰고 화면 값은 바꾸지 않는다).
TrackingEvent trackingEventFromSse(String deliveryId, SseMessage m) {
  final trk.StreamEvent e;
  try {
    final json = jsonDecode(m.data);
    if (json is! Map<String, dynamic>) {
      return TrackingEvent(type: TrackingEventType.unknown, id: m.id);
    }
    e = trk.StreamEvent.fromJson(json);
  } catch (_) {
    return TrackingEvent(type: TrackingEventType.unknown, id: m.id);
  }
  return TrackingEvent(
    id: e.id ?? m.id,
    type: switch (e.type) {
      trk.StreamEventTypeEnum.ETA_UPDATED => TrackingEventType.etaUpdated,
      trk.StreamEventTypeEnum.STAGE_CHANGED => TrackingEventType.stageChanged,
      trk.StreamEventTypeEnum.LOCATION_STALE => TrackingEventType.locationStale,
      trk.StreamEventTypeEnum.DELAY_ALERT => TrackingEventType.delayAlert,
      trk.StreamEventTypeEnum.STREAM_END => TrackingEventType.streamEnd,
      trk.StreamEventTypeEnum.HEARTBEAT => TrackingEventType.heartbeat,
    },
    eta: switch (e.eta) {
      final eta? => etaFromContract(deliveryId, eta),
      null => null,
    },
    stage: e.stage == null ? null : deliveryStageOf(e.stage),
  );
}

DeliveryEtaView etaFromContract(String deliveryId, trk.DeliveryEta e) {
  final drop = e.dropEta;
  return DeliveryEtaView(
    deliveryId: e.deliveryId ?? deliveryId,
    stage: deliveryStageOf(e.stage?.value),
    status: switch (drop?.status) {
      trk.EtaStatus.AVAILABLE => EtaStatus.available,
      trk.EtaStatus.LOCATING => EtaStatus.locating,
      trk.EtaStatus.ETA_PENDING => EtaStatus.pending,
      trk.EtaStatus.FINAL => EtaStatus.finalized,
      null => EtaStatus.unknown,
    },
    // 수치는 AVAILABLE 일 때만 쓴다(위치 확인 중에 이전 값이 남아 있어도 보이지 않는다).
    etaAt: drop?.status == trk.EtaStatus.AVAILABLE ? drop?.etaAt : null,
    remainingSeconds: drop?.status == trk.EtaStatus.AVAILABLE
        ? drop?.remainingSeconds
        : null,
    delayedBySeconds: drop?.delayedBySeconds,
    window: switch (e.arrivalWindow) {
      final w? when w.date != null && w.start != null && w.end != null =>
        ArrivalWindow(date: w.date!, start: w.start!, end: w.end!),
      _ => null,
    },
    delayAlert: e.delayAlertTriggered ?? false,
    asOf: e.asOf?.asOf,
    freshness: _freshness(e.asOf?.freshness?.value),
  );
}
