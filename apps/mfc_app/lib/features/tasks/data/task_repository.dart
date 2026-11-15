import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/task_list.dart';

abstract interface class TaskRepository {
  /// 내 작업. [blocked] 면 막힌 작업만(기본 조회에 BLOCKED 가 없다). 실패는 [PmartFailure].
  Future<TaskList> myTasks(String mfcId, {bool blocked = false});

  /// 센터 작업 목록(센터 관리자 — 사용자 2026-11-16 "작업 현황"). `assignee` 없이 그 센터 전체.
  Future<TaskList> centerTasks(String mfcId, {required List<TaskState> states});

  Future<TaskDetailView> task(String taskId);

  /// `POST /tasks/{id}/starts`. 결과 불명이면 같은 [key] 로 다시 부른다.
  Future<StartOutcome> start(
    String taskId, {
    required String workerId,
    required int assignmentVersion,
    String? deviceId,
    required IdempotencyKey key,
  });

  /// 큐에 저장된 피킹 실행을 같은 키로 보낸다.
  Future<SendResult> sendExecution(QueueItem item);

  /// 실행 결과(재고 반영) 조회.
  Future<ConfirmResult> execution(String taskId, String executionId);
}

/// 실서버 구현. `assignee=me`·작업자 ID 는 BR-02(점원 로그인) 전에는 실제로 동작하지 않는다.
final class ApiTaskRepository implements TaskRepository {
  ApiTaskRepository(Dio dio)
    : _tasks = api.PmartApiMfcFulfillment(dio: dio).getTasksApi();

  final api.TasksApi _tasks;

  @override
  Future<TaskList> myTasks(String mfcId, {bool blocked = false}) async {
    final res = await pmartGuard(
      () => _tasks.listTasks(
        mfcId: mfcId,
        assignee: 'me',
        state: blocked ? [api.TaskState.BLOCKED] : null,
      ),
    );
    final body = res.data;
    if (body == null) throw const ContractViolationFailure('listTasks 본문 없음');
    return taskListFromContract(body);
  }

  @override
  Future<TaskList> centerTasks(
    String mfcId, {
    required List<TaskState> states,
  }) async {
    final res = await pmartGuard(
      () => _tasks.listTasks(
        mfcId: mfcId,
        state: [for (final s in states) ?taskStateToContract(s)],
      ),
    );
    final body = res.data;
    if (body == null) throw const ContractViolationFailure('listTasks 본문 없음');
    return taskListFromContract(body);
  }

  @override
  Future<TaskDetailView> task(String taskId) async {
    final res = await pmartGuard(() => _tasks.getTask(taskId: taskId));
    return taskDetailFromContract(
      res.data ?? (throw const ContractViolationFailure('TaskDetail 본문 없음')),
    );
  }

  @override
  Future<StartOutcome> start(
    String taskId, {
    required String workerId,
    required int assignmentVersion,
    String? deviceId,
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _tasks.startTask(
          taskId: taskId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          startTaskRequest: api.StartTaskRequest(
            workerId: workerId,
            assignmentVersion: assignmentVersion,
            deviceId: deviceId,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      return switch (res.data?.status) {
        api.StartTask201ResponseStatusEnum.APPLIED => StartApplied(
          taskVersion: res.data!.version,
        ),
        api.StartTask201ResponseStatusEnum.REJECTED => StartRejected(
          res.data!.nextAction ?? ProblemCode.domainRejected,
        ),
        _ => const StartUnknown(),
      };
    } on PmartFailure catch (f) {
      return startFailureToOutcome(f);
    }
  }

  @override
  Future<SendResult> sendExecution(QueueItem item) async {
    final p = item.payload;
    try {
      final res = await pmartGuard(
        () => _tasks.recordTaskExecution(
          taskId: item.targetId,
          idempotencyKey: item.id,
          xSourceSystem: sourceSystem,
          taskExecutionRequest: executionRequestFromPayload(p),
          extra: commandOptions(item.key).extra,
        ),
      );
      return switch (res.data?.status) {
        api.StartTask201ResponseStatusEnum.APPLIED => SendApplied(
          resultId: res.data!.resultId,
        ),
        api.StartTask201ResponseStatusEnum.REJECTED => SendRejected(
          res.data!.nextAction ?? ProblemCode.domainRejected,
        ),
        api.StartTask201ResponseStatusEnum.ACCEPTED => SendAccepted(
          resultId: res.data!.resultId,
        ),
        _ => const SendUnknown(),
      };
    } on PmartFailure catch (f) {
      return executionFailureToSend(f);
    }
  }

  @override
  Future<ConfirmResult> execution(String taskId, String executionId) async {
    try {
      final res = await pmartGuard(
        () => _tasks.getTaskExecution(taskId: taskId, executionId: executionId),
      );
      return executionStateToConfirm(res.data?.state?.value);
    } on PmartFailure {
      return ConfirmResult.unknown;
    }
  }
}

/// 시작 실패 분류(§3-1). 503 DEPENDENCY_UNAVAILABLE 은 "시작 안 됨" 확정이다.
StartOutcome startFailureToOutcome(PmartFailure f) => switch (f) {
  UnknownResultFailure(:final problem)
      when problem?.code == TaskProblemCode.dependencyUnavailable =>
    const StartNotStarted(),
  UnknownResultFailure() => const StartUnknown(),
  ProblemFailure(:final problem)
      when problem.code == TaskProblemCode.idempotencyConflict =>
    problem.retryable ? const StartUnknown() : const StartClientError(),
  ProblemFailure(:final problem) when problem.status == 409 => StartRejected(
    problem.code,
  ),
  _ => throw f,
};

/// 실행 전송 실패 분류. 연결 자체가 안 됐으면 전송 대기, 응답이 없으면 확인 중.
SendResult executionFailureToSend(PmartFailure f) => switch (f) {
  UnknownResultFailure(:final transport)
      when transport == DioExceptionType.connectionError =>
    const SendOffline(),
  UnknownResultFailure() => const SendUnknown(),
  NetworkFailure() => const SendOffline(),
  ProblemFailure(:final problem)
      when problem.code == TaskProblemCode.idempotencyConflict &&
          problem.retryable =>
    const SendUnknown(),
  ProblemFailure(:final problem) => SendRejected(problem.code),
  _ => const SendUnknown(),
};

ConfirmResult executionStateToConfirm(String? wire) => switch (wire) {
  'APPLIED' => ConfirmResult.applied,
  'REJECTED' => ConfirmResult.rejected,
  'RECORDED' || 'INVENTORY_PENDING' => ConfirmResult.pending,
  _ => ConfirmResult.unknown,
};

/// 큐 payload → 계약 본문. payload 는 [pickPayload] 가 만든다.
api.TaskExecutionRequest executionRequestFromPayload(
  Map<String, Object?> p,
) => api.TaskExecutionRequest(
  executionType: p['executionType'] == 'RETURN'
      ? api.TaskExecutionRequestExecutionTypeEnum.RETURN
      : api.TaskExecutionRequestExecutionTypeEnum.PICK,
  workerId: p['workerId']! as String,
  assignmentVersion: p['assignmentVersion'] as int?,
  fromLocation: p['fromLocation'] as String?,
  toLocation: p['toLocation'] as String?,
  lines: [
    for (final l in (p['lines']! as List).cast<Map<String, Object?>>())
      api.TaskExecutionRequestLinesInner(
        orderLineId: l['orderLineId']! as String,
        sku: l['sku']! as String,
        lotId: l['lotId'] as String?,
        pickedQty: l['pickedQty']! as int,
        shortage: switch (l['shortage']) {
          final Map<String, Object?> s =>
            api.TaskExecutionRequestLinesInnerShortage(
              qty: s['qty'] as int?,
              reason: switch (s['reason']) {
                'DAMAGED' =>
                  api.TaskExecutionRequestLinesInnerShortageReasonEnum.DAMAGED,
                'BLOCKED' =>
                  api.TaskExecutionRequestLinesInnerShortageReasonEnum.BLOCKED,
                _ => api.TaskExecutionRequestLinesInnerShortageReasonEnum.SHORT,
              },
              note: s['note'] as String?,
            ),
          _ => null,
        },
      ),
  ],
);

/// 피킹 실행 1건(지시 행 1개)의 큐 payload. 개인정보를 넣지 않는다.
Map<String, Object?> pickPayload({
  required String workerId,
  required int? assignmentVersion,
  required TaskLineView line,
  required int pickedQty,
  ({int qty, ShortageReason reason, String? note})? shortage,

  /// 실제로 집은 칸(스캔한 값)·LOT 조각. 없으면 줄의 첫 지시 사본.
  String? fromLocation,
  String? lotId,
}) => {
  'workerId': workerId,
  'assignmentVersion': ?assignmentVersion,
  'fromLocation': ?(fromLocation ?? line.locationId),
  'lines': [
    {
      'orderLineId': line.orderLineId,
      'sku': line.sku,
      'lotId': ?(lotId ?? line.lotId),
      'pickedQty': pickedQty,
      if (shortage case final s?)
        'shortage': {
          'qty': s.qty,
          'reason': s.reason.name.toUpperCase(),
          'note': ?s.note,
        },
    },
  ],
};

/// 취소품 복귀 실행 1건의 큐 payload — 포장 위치 → 선반, LOT 필수(fulfillment 0.3.0).
Map<String, Object?> returnPayload({
  required String workerId,
  required int? assignmentVersion,
  required TaskLineView line,
  required String lotId,
  required String fromLocation,
  required String toLocation,
  required int qty,
}) => {
  'executionType': 'RETURN',
  'workerId': workerId,
  'assignmentVersion': ?assignmentVersion,
  'fromLocation': fromLocation,
  'toLocation': toLocation,
  'lines': [
    {
      'orderLineId': line.orderLineId,
      'sku': line.sku,
      'lotId': lotId,
      'pickedQty': qty,
    },
  ],
};

TaskKind _kind(api.TaskType? t) => switch (t) {
  api.TaskType.PICK => TaskKind.pick,
  api.TaskType.PACK => TaskKind.pack,
  api.TaskType.DISPATCH => TaskKind.dispatch,
  api.TaskType.RETURN => TaskKind.returnToShelf,
  null => throw const ContractViolationFailure('taskType 없음'),
};

TaskList taskListFromContract(api.ListTasks200Response body) {
  final items = body.items;
  if (items == null) {
    throw const ContractViolationFailure('listTasks.items 없음');
  }
  return TaskList(
    assignmentFresh:
        body.asOf?.freshness ==
        api.ListTasks200ResponseAsOfFreshnessEnum.CURRENT,
    tasks: [
      for (final t in items)
        TaskItem(
          taskId:
              t.taskId ??
              (throw const ContractViolationFailure('TaskSummary.taskId 없음')),
          kind: _kind(t.taskType),
          state: t.state == null
              ? (throw const ContractViolationFailure('TaskSummary.state 없음'))
              : TaskState.fromWire(t.state!.value),
          remainingQty: t.remainingQty,
          lineCount: t.lineCount,
          promisedReadyAt: t.promisedReadyAt,
          headlineProduct: t.headline?.productName,
          otherLineCount: t.headline?.otherLineCount,
          assigneeId: t.assignment?.workerId,
          late: t.late_ ?? false,
          idle: t.idle ?? false,
        ),
    ],
  );
}

TaskDetailView taskDetailFromContract(api.TaskDetail d) => TaskDetailView(
  taskId: d.taskId ?? (throw const ContractViolationFailure('taskId 없음')),
  kind: _kind(d.taskType),
  state: TaskState.fromWire(d.state?.value),
  version: d.version ?? 0,
  assignedWorkerId: d.assignment?.workerId,
  assignmentVersion: d.assignment?.assignmentVersion,
  activeStartWorkerId: d.activeStart?.workerId,
  activeStartRequestId: d.activeStart?.requestId,
  pendingExecutionIds: [
    for (final p in d.pendingExecutions ?? const <api.TaskPendingExecution>[])
      ?p.executionId,
  ],
  blockReason: d.blockReason,
  shipmentId: d.shipmentId,
  lines: [
    for (final l in d.lines ?? const <api.TaskLine>[])
      TaskLineView(
        taskLineId: l.taskLineId,
        orderLineId: l.orderLineId,
        sku: l.sku,
        productName: l.productName,
        barcode: l.barcode,
        locationId: l.locationId,
        lotId: l.lotId,
        expiresOn: l.expiresOn,
        plannedQty: l.plannedQty,
        completedQty: l.completedQty,
        cancelledQty: l.cancelledQty,
        remainingQty: l.remainingQty,
        pendingQty: l.pendingQty ?? 0,
        picks: [
          for (final p in l.picks ?? const <api.TaskLinePicksInner>[])
            PickInstruction(
              lotId: p.lotId,
              expiresOn: p.expiresOn,
              remainingQty: p.remainingQty,
              visitSeq: p.visitSeq,
              unallocatedQty: p.unallocatedQty,
              status: switch (p.pickStatus?.value) {
                null => null,
                'OK' => PickStatus.ok,
                'PARTIAL' => PickStatus.partial,
                'NOT_FOUND' => PickStatus.notFound,
                'DONE' => PickStatus.done,
                _ => PickStatus.unknown,
              },
              notice: p.notice,
              suggestedToLocations: p.suggestedToLocations ?? const [],
              locations: [
                for (final c
                    in p.locations ??
                        const <api.TaskLinePicksInnerLocationsInner>[])
                  if (c.locationCode case final code?)
                    PickLocation(
                      code: code,
                      qty: c.qty,
                      allocatedQty: c.allocatedQty,
                    ),
              ],
            ),
        ],
      ),
  ],
);

/// 패킹 완료 실행의 큐 payload. 담은 수량은 밀봉된 포장 기준이다.
Map<String, Object?> packPayload({
  required String workerId,
  required int? assignmentVersion,
  required List<({String orderLineId, String sku, int qty})> lines,
  required int durationSec,
}) => {
  'executionType': 'PACK',
  'workerId': workerId,
  'assignmentVersion': ?assignmentVersion,
  'durationSec': durationSec,
  'lines': [
    for (final l in lines)
      {'orderLineId': l.orderLineId, 'sku': l.sku, 'pickedQty': l.qty},
  ],
};

api.TaskState? taskStateToContract(TaskState s) => switch (s) {
  TaskState.waiting => api.TaskState.WAITING,
  TaskState.ready => api.TaskState.READY,
  TaskState.assigned => api.TaskState.ASSIGNED,
  TaskState.inProgress => api.TaskState.IN_PROGRESS,
  TaskState.completed => api.TaskState.COMPLETED,
  TaskState.blocked => api.TaskState.BLOCKED,
  TaskState.failed => api.TaskState.FAILED,
  TaskState.cancelled => api.TaskState.CANCELLED,
  TaskState.closedPartial => api.TaskState.CLOSED_PARTIAL,
  TaskState.unknown => null,
};
