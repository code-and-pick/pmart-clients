import 'package:pmart_api_order_orchestration/pmart_api_order_orchestration.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';

import '../../checkout/data/mock_checkout_repository.dart'
    show MockExternalPayments;
import '../../payment/domain/payment.dart';
import '../domain/redelivery_payment.dart';
import 'redelivery_payments_repository.dart';

/// 목 결제 서비스가 다시 배송비 결제를 승인할 때의 결과.
enum MockRedeliveryApproval {
  /// 승인 → 결제됨(PAID).
  approve,

  /// 승인 실패 → 결제 대기 그대로, 이번 결제 시도는 실패(다시 시도하면 새 시도).
  decline,

  /// 넘겼지만 결과가 아직 없다 → 결제 대기 그대로(앱은 "확인 중").
  pending,
}

/// 목 구현. 계약 JSON → 생성 모델 → 실서버와 같은 변환을 거친다.
/// 기본 시드: 배송 중인 목 주문(order-seed-1)에 결제 대기 1건(기한 = 만든 시각 + 30분).
base class MockRedeliveryPaymentsRepository
    implements RedeliveryPaymentsRepository, MockExternalPayments {
  MockRedeliveryPaymentsRepository({
    this.latency = const Duration(milliseconds: 300),
    DateTime Function()? now,
    bool seeded = true,
  }) : now = now ?? DateTime.now {
    if (seeded) {
      seed(orderId: 'order-seed-1');
    }
  }

  final Duration latency;
  final DateTime Function() now;

  final _items = <String, Map<String, Object?>>{};
  final _keys = <String, Map<String, Object?>>{};

  /// 실패한 결제 시도(다시 시도하면 새 시도를 만든다).
  final _failedAttempts = <String>{};
  int _seq = 0;

  MockRedeliveryApproval approval = MockRedeliveryApproval.approve;

  /// 목록을 이만큼 더 읽어야 결제 시도(paymentAttemptId)가 생긴다(준비 중 시연).
  int attemptReadyAfter = 0;

  /// 목록 조회를 실패시킨다(조회 실패 ≠ 결제 건 없음 시연).
  bool listFails = false;

  /// 받은 명령(시험용): ('retry'|'decline', id, key).
  final commands = <(String, String, String)>[];

  Future<void> _wait() => Future<void>.delayed(latency);

  /// 결제 대기 한 건을 만든다.
  String seed({
    required String orderId,
    String status = 'WAITING_PAYMENT',
    Duration left = const Duration(minutes: 30),
  }) {
    final id = 'rdp-${++_seq}';
    final created = now().toUtc();
    _items[id] = {
      'redeliveryPaymentId': id,
      'orderId': orderId,
      'caseId': 'case-mock-$_seq',
      'amount': 9000,
      'orderName': '오배송 다시 배송비',
      'paymentAttemptId': 'PAY-RDL-$id-1',
      'status': status,
      'deadlineAt': created.add(left).toIso8601String(),
      'createdAt': created.toIso8601String(),
    };
    return id;
  }

  /// 시험용: 서버 상태를 바로 바꾼다(기한 지남 등).
  void setStatus(String id, String status) => _items[id]!['status'] = status;

  RedeliveryPayment _out(Map<String, Object?> json) =>
      redeliveryPaymentFromContract(api.RedeliveryPayment.fromJson(json));

  @override
  Future<List<RedeliveryPayment>> list(String orderId) async {
    await _wait();
    if (listFails) {
      throw const ProblemFailure(
        Problem(status: 503, code: ProblemCode.dependencyUnavailable),
      );
    }
    final ready = attemptReadyAfter <= 0;
    if (!ready) attemptReadyAfter--;
    return [
      for (final j in _items.values.toList().reversed)
        if (j['orderId'] == orderId)
          _out({...j, if (!ready) 'paymentAttemptId': null}),
    ];
  }

  @override
  Future<RedeliveryPayment> retry(
    String id, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    commands.add(('retry', id, key.value));
    final prev = _keys['retry:${key.value}'];
    if (prev != null) return _out(prev);
    final j = _find(id);
    if (j['status'] != 'WAITING_PAYMENT') {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
    }
    final attempt = j['paymentAttemptId'] as String?;
    if (attempt == null || _failedAttempts.contains(attempt)) {
      j['paymentAttemptId'] = 'PAY-RDL-$id-${++_seq}';
    }
    return _out(_keys['retry:${key.value}'] = Map.of(j));
  }

  @override
  Future<RedeliveryPayment> decline(
    String id, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    commands.add(('decline', id, key.value));
    final prev = _keys['decline:${key.value}'];
    if (prev != null) return _out(prev);
    final j = _find(id);
    switch (j['status']) {
      case 'PAID':
        throw const ProblemFailure(
          Problem(status: 409, code: RedeliveryProblemCode.alreadyPaid),
        );
      case 'WAITING_PAYMENT':
        j['status'] = 'DECLINED';
    }
    return _out(_keys['decline:${key.value}'] = Map.of(j));
  }

  Map<String, Object?> _find(String id) =>
      _items[id] ??
      (throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      ));

  Map<String, Object?>? _byAttempt(String attemptId) => _items.values
      .where((j) => j['paymentAttemptId'] == attemptId)
      .firstOrNull;

  @override
  AuthSubmitResult? submitAuth(PgAuthenticated auth) {
    final j = _byAttempt(auth.pgOrderId);
    if (j == null) return null;
    // 서버 검증 흉내: 금액이 다르거나 결제 대기가 아니면 승인하지 않는다.
    if (j['amount'] != auth.amount || j['status'] != 'WAITING_PAYMENT') {
      return AuthSubmitResult.rejected;
    }
    switch (approval) {
      case MockRedeliveryApproval.approve:
        j['status'] = 'PAID';
        return AuthSubmitResult.accepted;
      case MockRedeliveryApproval.decline:
        _failedAttempts.add(auth.pgOrderId);
        approval = MockRedeliveryApproval.approve;
        return AuthSubmitResult.rejected;
      case MockRedeliveryApproval.pending:
        return AuthSubmitResult.accepted;
    }
  }

  @override
  bool reportAuthFailure(String pgOrderId, String errorCode) {
    if (_byAttempt(pgOrderId) == null) return false;
    _failedAttempts.add(pgOrderId);
    return true;
  }
}
