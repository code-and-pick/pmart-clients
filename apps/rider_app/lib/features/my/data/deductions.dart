import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 오배송 정산 차감(execution 0.41.0, DE-9 · ADR-0086 — 2026-11-24 사용자 "PR이 합쳐지면 라이더 앱과 라이더 백오피스 화면 만들어").
/// 라이더 귀책 오배송의 회수가 상품 없이 끝나면 차감 예정이 생긴다. 이의 기간 5일 → 이의 → 지원센터 결정(취소·확정),
/// 이의가 없으면 기한 뒤 확정. 확정된 차감은 다음 지급 묶음에서 뺀다. 금액·기한·남은 금액은 서버 값만 보인다.
enum DeductionState { pendingObjection, objected, confirmed, cancelled }

DeductionState deductionStateFromWire(ex.RiderDeductionState s) => switch (s) {
  ex.RiderDeductionState.PENDING_OBJECTION => DeductionState.pendingObjection,
  ex.RiderDeductionState.OBJECTED => DeductionState.objected,
  ex.RiderDeductionState.CONFIRMED => DeductionState.confirmed,
  ex.RiderDeductionState.CANCELLED => DeductionState.cancelled,
};

@immutable
class Deduction {
  const Deduction({
    required this.id,
    required this.deliveryLabel,
    required this.amount,
    required this.remaining,
    required this.state,
    required this.objectionDeadline,
    required this.createdAt,
    this.objectionNote,
    this.objectedAt,
    this.decisionAccepted,
    this.decisionNote,
    this.decidedAt,
    this.confirmedAt,
    this.applied = const [],
    this.manual = false,
    this.reason,
  });

  final String id;

  /// 화면 배송 번호(없으면 배송 ID).
  final String deliveryLabel;
  final int amount;

  /// 아직 정산에서 빼지 않은 금액(취소면 0).
  final int remaining;
  final DeductionState state;
  final DateTime objectionDeadline;
  final DateTime createdAt;
  final String? objectionNote;
  final DateTime? objectedAt;

  /// 지원센터 결정 — true 받아들임(차감 취소), false 거절(확정), null 결정 없음.
  final bool? decisionAccepted;
  final String? decisionNote;
  final DateTime? decidedAt;
  final DateTime? confirmedAt;

  /// (execution 0.43.0) 직원이 직접 만든 차감(source MANUAL)이면 true, [reason] 은 그 사유(라이더도 본다).
  final bool manual;
  final String? reason;

  /// 정산에서 뺀 기록(지급 예정일 YYYY-MM-DD, 금액).
  final List<({String payoutDate, int amount})> applied;

  /// 이의 단추를 보일지(표시만 — 기한·한 번은 서버가 막는다, 409 OBJECTION_CLOSED).
  bool objectableAt(DateTime now) =>
      state == DeductionState.pendingObjection &&
      now.isBefore(objectionDeadline);
}

@immutable
class DeductionList {
  const DeductionList({
    required this.items,
    this.remainingTotal,
    this.pendingTotal,
  });

  final List<Deduction> items;

  /// 앞으로 정산에서 뺄 확정 금액(서버). null 이면 서버가 주지 않음.
  final int? remainingTotal;

  /// 이의 기간·이의 중 금액(서버).
  final int? pendingTotal;
}

/// 이의 기한이 지났거나 이미 이의했다(409 OBJECTION_CLOSED).
class ObjectionClosedFailure implements Exception {
  const ObjectionClosedFailure();
}

const objectionClosedCode = 'OBJECTION_CLOSED';

abstract interface class DeductionsRepository {
  Future<DeductionList> mine();
  Future<Deduction> object({
    required String deductionId,
    required String note,
    required IdempotencyKey key,
  });
}

Deduction deductionFromContract(ex.RiderDeduction d) => Deduction(
  id: d.deductionId,
  deliveryLabel: d.deliveryNumber ?? d.deliveryId,
  amount: d.amount,
  remaining: d.remaining,
  state: deductionStateFromWire(d.state),
  objectionDeadline: d.objectionDeadline,
  createdAt: d.createdAt,
  objectionNote: d.objection?.note,
  objectedAt: d.objection?.objectedAt,
  decisionAccepted: switch (d.decision?.result) {
    ex.RiderDeductionDecisionResultEnum.ACCEPT => true,
    ex.RiderDeductionDecisionResultEnum.REJECT => false,
    null => null,
  },
  decisionNote: d.decision?.note,
  decidedAt: d.decision?.decidedAt,
  confirmedAt: d.confirmedAt,
  manual: d.source_ == ex.RiderDeductionSource_Enum.MANUAL,
  reason: d.reason,
  applied: [
    for (final a
        in d.applications ?? const <ex.RiderDeductionApplicationsInner>[])
      (payoutDate: a.payoutDate, amount: a.amount),
  ],
);

final class ApiDeductionsRepository implements DeductionsRepository {
  ApiDeductionsRepository(Dio dio)
    : _api = ex.PmartApiDeliveryExecution(dio: dio).getDeductionsApi();

  final ex.DeductionsApi _api;

  @override
  Future<DeductionList> mine() async {
    final res = await pmartGuard(() => _api.listMyDeductions());
    final d = res.data ?? (throw const ContractViolationFailure('차감 목록 본문 없음'));
    return DeductionList(
      items: [for (final x in d.items) deductionFromContract(x)],
      remainingTotal: d.remainingTotal,
      pendingTotal: d.pendingTotal,
    );
  }

  @override
  Future<Deduction> object({
    required String deductionId,
    required String note,
    required IdempotencyKey key,
  }) async {
    final Response<ex.RiderDeduction> res;
    try {
      res = await pmartGuard(
        () => _api.objectMyDeduction(
          deductionId: deductionId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          objectMyDeductionRequest: ex.ObjectMyDeductionRequest(note: note),
          extra: commandOptions(key).extra,
        ),
      );
    } on ProblemFailure catch (f) {
      if (f.problem.code == objectionClosedCode) {
        throw const ObjectionClosedFailure();
      }
      rethrow;
    }
    return deductionFromContract(
      res.data ?? (throw const ContractViolationFailure('이의 응답 본문 없음')),
    );
  }
}

final class MockDeductionsRepository implements DeductionsRepository {
  MockDeductionsRepository({
    this.latency = const Duration(milliseconds: 250),
    DateTime? now,
  }) : _now = now ?? DateTime.now() {
    _items = [
      Deduction(
        id: 'DED-mock-1',
        deliveryLabel: 'D48213110',
        amount: 9800,
        remaining: 9800,
        state: DeductionState.pendingObjection,
        objectionDeadline: _now.add(const Duration(days: 4)),
        createdAt: _now.subtract(const Duration(days: 1)),
      ),
      Deduction(
        id: 'DED-mock-2',
        deliveryLabel: 'D48213075',
        amount: 15500,
        remaining: 12000,
        state: DeductionState.confirmed,
        objectionDeadline: DateTime.utc(2026, 11, 15, 3),
        createdAt: DateTime.utc(2026, 11, 10, 3),
        confirmedAt: DateTime.utc(2026, 11, 15, 3),
        applied: const [(payoutDate: '2026-11-19', amount: 3500)],
        manual: true,
        reason: '회수품이 상해 폐기 — 결제 금액만큼 차감',
      ),
      Deduction(
        id: 'DED-mock-0',
        deliveryLabel: 'D48212990',
        amount: 7000,
        remaining: 0,
        state: DeductionState.cancelled,
        objectionDeadline: DateTime.utc(2026, 11, 12, 3),
        createdAt: DateTime.utc(2026, 11, 7, 3),
        objectionNote: '회수하러 갔는데 고객이 이미 버렸대요.',
        objectedAt: DateTime.utc(2026, 11, 9, 5),
        decisionAccepted: true,
        decisionNote: '고객 확인 결과 라이더 귀책 아님 — 차감 취소',
        decidedAt: DateTime.utc(2026, 11, 10, 2),
      ),
    ];
  }

  final Duration latency;
  final DateTime _now;
  late List<Deduction> _items;

  /// 시험용: 목록 읽기 실패.
  bool failList = false;

  /// 시험용: 이의가 마감됐다고 답한다.
  bool closeObjection = false;

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<DeductionList> mine() async {
    await _wait();
    if (failList) throw const NetworkFailure(DioExceptionType.connectionError);
    return DeductionList(
      items: List.unmodifiable(_items),
      remainingTotal: _items
          .where((d) => d.state == DeductionState.confirmed)
          .fold<int>(0, (n, d) => n + d.remaining),
      pendingTotal: _items
          .where(
            (d) =>
                d.state == DeductionState.pendingObjection ||
                d.state == DeductionState.objected,
          )
          .fold<int>(0, (n, d) => n + d.amount),
    );
  }

  @override
  Future<Deduction> object({
    required String deductionId,
    required String note,
    required IdempotencyKey key,
  }) async {
    await _wait();
    final i = _items.indexWhere((d) => d.id == deductionId);
    final d = _items[i];
    if (closeObjection || d.state != DeductionState.pendingObjection) {
      throw const ObjectionClosedFailure();
    }
    final next = Deduction(
      id: d.id,
      deliveryLabel: d.deliveryLabel,
      amount: d.amount,
      remaining: d.remaining,
      state: DeductionState.objected,
      objectionDeadline: d.objectionDeadline,
      createdAt: d.createdAt,
      objectionNote: note,
      objectedAt: DateTime.now().toUtc(),
    );
    _items = [..._items]..[i] = next;
    return next;
  }
}

final deductionsRepositoryProvider = Provider<DeductionsRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockDeductionsRepository(),
    PmartEnv.local => ApiDeductionsRepository(ref.watch(dioProvider)),
  },
);

final myDeductionsProvider = FutureProvider.autoDispose<DeductionList>(
  (ref) => ref.watch(deductionsRepositoryProvider).mine(),
);
