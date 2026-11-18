import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_capacity/pmart_api_mfc_capacity.dart' as cap;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/work.dart';

abstract interface class WorkRepository {
  /// 작업자 본인(권한·휴게). `GET /mfcs/{mfcId}/workers/{workerId}` 를 본인 토큰으로 부른다
  /// (workerId = 토큰 subject — BR-52 R3 회신, mfc-capacity 0.13.0). 고를 수 있는 업무는 `workAreas`.
  Future<WorkerProfile> me(String mfcId, String workerId);

  /// 센터 작업자 목록(센터 관리자 — 사용자 2026-11-16 "작업자 현황"). 기본 ACTIVE·SUSPENDED(퇴사 제외).
  Future<List<WorkerProfile>> workers(String mfcId);

  /// 다음 작업 받기 — 고른 업무를 본문 `workArea` 로 보낸다(BR-52 R1 회신, 0.13.0).
  /// 들고 있는 작업이 있으면 **고른 업무와 상관없이** 그것을 돌려준다(한 번에 하나).
  /// 고른 업무에 유효 작업 유형이 없으면 422 `WORK_AREA_NOT_ALLOWED`.
  Future<NextTaskOutcome> next(
    String mfcId,
    String workerId,
    WorkArea area, {
    required IdempotencyKey key,
  });

  Future<void> startBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  });

  Future<void> endBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  });
}

final class ApiWorkRepository implements WorkRepository {
  ApiWorkRepository(Dio dio)
    : _workers = cap.PmartApiMfcCapacity(dio: dio).getWorkersApi();

  final cap.WorkersApi _workers;

  @override
  Future<WorkerProfile> me(String mfcId, String workerId) async {
    final res = await pmartGuard(
      () => _workers.getWorker(mfcId: mfcId, workerId: workerId),
    );
    final w =
        res.data ?? (throw const ContractViolationFailure('WorkerDetail 없음'));
    return WorkerProfile(
      workerId: w.workerId ?? workerId,
      displayName: w.displayName,
      allowedTaskTypes: {
        for (final t in w.effectiveTaskTypes ?? const <cap.TaskType>[]) t.value,
      },
      // 서버가 필드를 주지 않으면(0.12.0 이하) null — 빈 목록("고를 업무 없음")과 구별한다.
      workAreas: w.workAreas?.map(workAreaFromContract).toSet(),
      active: w.state == null || w.state!.value == 'ACTIVE',
      onBreak: w.onBreak ?? false,
    );
  }

  @override
  Future<List<WorkerProfile>> workers(String mfcId) async {
    final res = await pmartGuard(() => _workers.listWorkers(mfcId: mfcId));
    final items =
        res.data?.items ??
        (throw const ContractViolationFailure('listWorkers.items 없음'));
    return [
      for (final w in items)
        WorkerProfile(
          workerId:
              w.workerId ??
              (throw const ContractViolationFailure('workerId 없음')),
          displayName: w.displayName,
          allowedTaskTypes: {
            for (final t in w.effectiveTaskTypes ?? const <cap.TaskType>[])
              t.value,
          },
          workAreas: w.workAreas?.map(workAreaFromContract).toSet(),
          active: w.state == null || w.state!.value == 'ACTIVE',
          onBreak: w.onBreak ?? false,
        ),
    ];
  }

  @override
  Future<NextTaskOutcome> next(
    String mfcId,
    String workerId,
    WorkArea area, {
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _workers.pullNextTask(
          mfcId: mfcId,
          workerId: workerId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          pullNextTaskRequest: cap.PullNextTaskRequest(
            workArea: workAreaToContract(area),
          ),
          extra: commandOptions(key).extra,
        ),
      );
      final a = res.data;
      if (a == null) return const NextUnknown();
      return NextAssigned(assignedTaskFromContract(a));
    } on PmartFailure catch (f) {
      return switch (f) {
        UnknownResultFailure() => const NextUnknown(),
        ProblemFailure(:final problem)
            when problem.code == ProblemCode.idempotencyConflict &&
                problem.retryable =>
          const NextUnknown(),
        ProblemFailure(:final problem) => NextUnavailable(problem.code),
        _ => throw f,
      };
    }
  }

  @override
  Future<void> startBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  }) => pmartGuard(
    () => _workers.startWorkerBreak(
      mfcId: mfcId,
      workerId: workerId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<void> endBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  }) => pmartGuard(
    () => _workers.endWorkerBreak(
      mfcId: mfcId,
      workerId: workerId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      extra: commandOptions(key).extra,
    ),
  );
}

/// 앱의 업무 ↔ 계약 `WorkArea`(다섯 값이 하나씩 대응 — 회신 §1).
cap.WorkArea workAreaToContract(WorkArea a) => switch (a) {
  WorkArea.inbound => cap.WorkArea.INBOUND,
  WorkArea.inspection => cap.WorkArea.INSPECTION,
  WorkArea.stockMove => cap.WorkArea.STOCK_MOVE,
  WorkArea.stockCount => cap.WorkArea.STOCK_COUNT,
  WorkArea.pickPack => cap.WorkArea.PICK_PACK,
};

WorkArea workAreaFromContract(cap.WorkArea a) => switch (a) {
  cap.WorkArea.INBOUND => WorkArea.inbound,
  cap.WorkArea.INSPECTION => WorkArea.inspection,
  cap.WorkArea.STOCK_MOVE => WorkArea.stockMove,
  cap.WorkArea.STOCK_COUNT => WorkArea.stockCount,
  cap.WorkArea.PICK_PACK => WorkArea.pickPack,
};

AssignedTask assignedTaskFromContract(cap.Assignment a) {
  final d = a.detail;
  return AssignedTask(
    taskId: a.taskId ?? (throw const ContractViolationFailure('taskId 없음')),
    taskType:
        a.taskType ?? (throw const ContractViolationFailure('taskType 없음')),
    detailAvailable: d?.available ?? false,
    assignmentVersion: a.assignmentVersion,
    promisedReadyAt: d?.promisedReadyAt,
    urgent: d?.urgent ?? false,
    lines: [
      for (final l in d?.lines ?? const <cap.NextTaskDetailLinesInner>[])
        AssignedLine(
          productName: l.productName,
          sku: l.sku,
          qty: l.qty,
          fromLocation: l.fromLocation,
          toLocation: l.toLocation,
          notice: l.notice,
        ),
    ],
  );
}
