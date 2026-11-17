import 'package:flutter/foundation.dart';

/// 오배송 다시 배송비 결제 상태(order-orchestration 0.3.0 `RedeliveryPayment.status`, ADR-0065).
enum RedeliveryPaymentStatus {
  /// 결제 대기 — 기한([RedeliveryPayment.deadlineAt]) 안에 결제하거나 "회수 후 환불"을 고를 수 있다.
  waitingPayment,

  /// 결제됨 — 서버가 실제 주소로 다시 배송을 배차한다.
  paid,

  /// 고객이 결제하지 않고 회수 후 환불을 골랐다.
  declined,

  /// 기한(30분)이 지나 회수 후 환불로 바뀌었다.
  timedOut,
}

/// 고객 잘못(주소 오입력) 오배송의 다시 배송비 결제 건. 주소·좌표는 없다.
@immutable
class RedeliveryPayment {
  const RedeliveryPayment({
    required this.id,
    required this.orderId,
    required this.amount,
    required this.status,
    required this.deadlineAt,
    this.orderName,
    this.paymentAttemptId,
  });

  final String id;
  final String orderId;

  /// 고객 부담액(원) — 서버 값만 쓴다(지금 9,000).
  final int amount;
  final RedeliveryPaymentStatus status;

  /// 결제 기한. 지나면 서버가 회수 후 환불로 바꾼다(앱은 기한으로 상태를 정하지 않고 표시·결제창 열기 판단에만 쓴다).
  final DateTime deadlineAt;

  /// 결제위젯 주문명. 없으면 앱 문구.
  final String? orderName;

  /// 결제위젯 `orderId` 로 그대로 쓴다. 비었으면 결제 시도 준비 중 — 잠시 뒤 다시 읽는다.
  final String? paymentAttemptId;

  @override
  String toString() => 'RedeliveryPayment($id, ${status.name})';
}
