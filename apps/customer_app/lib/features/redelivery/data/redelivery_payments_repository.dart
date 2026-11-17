import 'package:dio/dio.dart';
import 'package:pmart_api_order_orchestration/pmart_api_order_orchestration.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/redelivery_payment.dart';

/// 오배송 다시 배송비 결제(order-orchestration 0.3.0 `/redelivery-payments`). 실패는 [PmartFailure] 로 던진다.
abstract interface class RedeliveryPaymentsRepository {
  /// `GET /redelivery-payments?orderId=` — 이 주문의 결제 건(최근 순).
  Future<List<RedeliveryPayment>> list(String orderId);

  /// `POST …/{id}/payment-attempts` — 앞 시도가 실패·취소됐으면 새 결제 시도(paymentAttemptId 가 바뀜).
  /// 쓸 수 있는 시도가 있으면 그대로 준다. 결제 대기가 아니면 409 INVALID_STATE.
  Future<RedeliveryPayment> retry(String id, {required IdempotencyKey key});

  /// `POST …/{id}/declines` — 결제하지 않고 회수 후 환불. 이미 결제됐으면 409 ALREADY_PAID.
  Future<RedeliveryPayment> decline(String id, {required IdempotencyKey key});
}

abstract final class RedeliveryProblemCode {
  static const alreadyPaid = 'ALREADY_PAID';
}

final class ApiRedeliveryPaymentsRepository
    implements RedeliveryPaymentsRepository {
  ApiRedeliveryPaymentsRepository(Dio dio)
    : _api = api.RedeliveryPaymentApi(dio);

  final api.RedeliveryPaymentApi _api;

  @override
  Future<List<RedeliveryPayment>> list(String orderId) async {
    final res = await pmartGuard(
      () => _api.listRedeliveryPayments(orderId: orderId),
    );
    final body =
        res.data ?? (throw const ContractViolationFailure('다시 배송 결제 목록 본문 없음'));
    return [for (final p in body.items) redeliveryPaymentFromContract(p)];
  }

  @override
  Future<RedeliveryPayment> retry(
    String id, {
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _api.retryRedeliveryPayment(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        redeliveryPaymentId: id,
        extra: commandOptions(key).extra,
      ),
    );
    return redeliveryPaymentFromContract(
      res.data ?? (throw const ContractViolationFailure('결제 다시 시도 본문 없음')),
    );
  }

  @override
  Future<RedeliveryPayment> decline(
    String id, {
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _api.declineRedeliveryPayment(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        redeliveryPaymentId: id,
        extra: commandOptions(key).extra,
      ),
    );
    return redeliveryPaymentFromContract(
      res.data ?? (throw const ContractViolationFailure('환불 고르기 본문 없음')),
    );
  }
}

RedeliveryPayment redeliveryPaymentFromContract(api.RedeliveryPayment p) =>
    RedeliveryPayment(
      id: p.redeliveryPaymentId,
      orderId: p.orderId,
      amount: p.amount,
      status: switch (p.status) {
        api.RedeliveryPaymentStatusEnum.WAITING_PAYMENT =>
          RedeliveryPaymentStatus.waitingPayment,
        api.RedeliveryPaymentStatusEnum.PAID => RedeliveryPaymentStatus.paid,
        api.RedeliveryPaymentStatusEnum.DECLINED =>
          RedeliveryPaymentStatus.declined,
        api.RedeliveryPaymentStatusEnum.TIMED_OUT =>
          RedeliveryPaymentStatus.timedOut,
      },
      deadlineAt: p.deadlineAt,
      orderName: switch (p.orderName?.trim()) {
        final n? when n.isNotEmpty => n,
        _ => null,
      },
      paymentAttemptId: switch (p.paymentAttemptId?.trim()) {
        final a? when a.isNotEmpty => a,
        _ => null,
      },
    );
