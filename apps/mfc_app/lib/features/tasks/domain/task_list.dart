import 'package:flutter/foundation.dart';

/// returnToShelf = 취소품 복귀(RETURN, fulfillment 0.4.6). 실행 화면은 아직 없다.
enum TaskKind { pick, pack, dispatch, returnToShelf }

/// 계약 TaskState. 종료 상태(완료·부분 종결·실패·취소)에서는 다시 시작할 수 없다.
enum TaskState {
  waiting,
  ready,
  assigned,
  inProgress,
  completed,
  blocked,
  failed,
  cancelled,
  closedPartial,
  unknown;

  static TaskState fromWire(String? w) => switch (w) {
    'WAITING' => waiting,
    'READY' => ready,
    'ASSIGNED' => assigned,
    'IN_PROGRESS' => inProgress,
    'COMPLETED' => completed,
    'BLOCKED' => blocked,
    'FAILED' => failed,
    'CANCELLED' => cancelled,
    'CLOSED_PARTIAL' => closedPartial,
    _ => unknown,
  };
}

/// `GET /tasks` 결과(화면용).
@immutable
class TaskList {
  const TaskList({required this.tasks, required this.assignmentFresh});

  final List<TaskItem> tasks;

  /// 담당자 정보 사본이 CURRENT 인지. 아니면 "최신이 아닐 수 있음"을 표시한다.
  /// 시작 가능 여부는 목록이 아니라 `POST /tasks/{id}/starts` 판정만 믿는다(BR-05 회신).
  final bool assignmentFresh;
}

@immutable
class TaskItem {
  const TaskItem({
    required this.taskId,
    required this.kind,
    required this.state,
    required this.remainingQty,
    this.lineCount,
    this.promisedReadyAt,
    this.headlineProduct,
    this.otherLineCount,
    this.assigneeId,
    this.late = false,
    this.idle = false,
    this.plannedQty,
    this.completedQty,
    this.lastActivityAt,
  });

  /// 지시·처리 수량(서버 값 그대로 — 업무 내역 표시).
  final int? plannedQty;
  final int? completedQty;

  /// (fulfillment 0.4.8) 시작 또는 마지막 실적 시각. 업무 내역의 "오늘"은 이 시각으로 고른다.
  final DateTime? lastActivityAt;

  final String taskId;
  final TaskKind kind;
  final TaskState state;
  final int? remainingQty;
  final int? lineCount;
  final DateTime? promisedReadyAt;

  /// 목록 표시용 첫 줄 상품명과 나머지 줄 수("상품명 외 N건", fulfillment 0.4.9).
  final String? headlineProduct;
  final int? otherLineCount;

  /// 담당(mfc-capacity 배정 투영). 목록 사본이라 늦을 수 있다.
  final String? assigneeId;

  /// (fulfillment 0.4.8) 예상 시간의 2배를 넘김 · 30분 동안 실적 없음 — 센터 관리자 화면 표시만.
  final bool late;
  final bool idle;
}

/// 피킹 칸 상태(0.4.9, 화면 표시용 — 서버 값 그대로).
enum PickStatus { ok, partial, notFound, done, unknown }

/// 한 줄의 LOT 조각별 피킹 지시(0.2.0~0.4.10). 줄·조각은 서버가 방문 순서로 준다.
@immutable
class PickInstruction {
  const PickInstruction({
    required this.locations,
    this.lotId,
    this.expiresOn,
    this.remainingQty,
    this.visitSeq,
    this.unallocatedQty,
    this.status,
    this.notice,
    this.suggestedToLocations = const [],
  });

  final String? lotId;
  final String? expiresOn;

  /// 이 LOT 조각에서 더 집을 양.
  final int? remainingQty;

  /// 방문 순서(1부터). 냉장 → 냉동 → 상온, 칸 사이 최단 거리(서버 계산).
  final int? visitSeq;
  final List<PickLocation> locations;

  /// 칸을 못 정한 양.
  final int? unallocatedQty;
  final PickStatus? status;

  /// 서버가 준 짧은 안내. 화면에 그대로 보인다.
  final String? notice;

  /// RETURN(취소품 복귀)만 — 돌려놓을 추천 선반(그 상품이 있던 칸 먼저).
  final List<String> suggestedToLocations;
}

@immutable
class PickLocation {
  const PickLocation({required this.code, this.qty, this.allocatedQty});

  final String code;

  /// 그 칸의 LOT 선반 잔량(이 주문 몫만이 아님).
  final int? qty;

  /// 그 칸에서 이 주문 몫으로 배정된 남은 양.
  final int? allocatedQty;
}

/// 작업 지시 행. 수량은 서버 확정값(계획 = 확정 + 승인취소 + 잔량)이다.
@immutable
class TaskLineView {
  const TaskLineView({
    required this.taskLineId,
    required this.orderLineId,
    required this.sku,
    required this.plannedQty,
    required this.completedQty,
    required this.cancelledQty,
    required this.remainingQty,
    this.pendingQty = 0,
    this.productName,
    this.barcode,
    this.locationId,
    this.lotId,
    this.expiresOn,
    this.picks = const [],
  });

  final String taskLineId;
  final String orderLineId;
  final String sku;
  final String? productName;

  /// 필수 스캔 대조값. 다른 바코드는 실적 0 + 원인 안내.
  final String? barcode;
  final String? locationId;
  final String? lotId;
  final String? expiresOn;
  final int plannedQty;
  final int completedQty;
  final int cancelledQty;
  final int remainingQty;

  /// 접수됐지만 재고 확정 대기인 수량("확정 대기"로 따로 보인다).
  final int pendingQty;

  /// LOT 조각별 지시. 재고 조회가 안 되면 빈 목록일 수 있다(그때는 locationId 만).
  final List<PickInstruction> picks;

  bool get done => remainingQty == 0 && pendingQty == 0;
}

@immutable
class TaskDetailView {
  const TaskDetailView({
    required this.taskId,
    required this.kind,
    required this.state,
    required this.version,
    required this.lines,
    this.assignedWorkerId,
    this.assignmentVersion,
    this.activeStartWorkerId,
    this.activeStartRequestId,
    this.pendingExecutionIds = const [],
    this.blockReason,
    this.shipmentId,
  });

  final String taskId;
  final TaskKind kind;
  final TaskState state;
  final int version;
  final String? assignedWorkerId;
  final int? assignmentVersion;

  /// 성공한 시작 점유(IN_PROGRESS 일 때). 키를 잃었을 때 본인 시작인지 확인한다.
  final String? activeStartWorkerId;
  final String? activeStartRequestId;
  final List<String> pendingExecutionIds;
  final String? blockReason;
  final String? shipmentId;
  final List<TaskLineView> lines;

  int get totalPlanned => lines.fold(0, (s, l) => s + l.plannedQty);
  int get totalCompleted => lines.fold(0, (s, l) => s + l.completedQty);
}

/// 작업 시작 판정(BR-05, `docs/apps/mfc-app.md` §3-1).
@immutable
sealed class StartOutcome {
  const StartOutcome();
}

/// 시작 점유 성공. 이때만 피킹 화면으로 간다.
final class StartApplied extends StartOutcome {
  const StartApplied({this.taskVersion});

  final int? taskVersion;
}

/// 거절 확정(ALREADY_STARTED·NOT_ASSIGNEE·PREDECESSOR_NOT_COMPLETED·INVALID_STATE·VERSION_CONFLICT).
final class StartRejected extends StartOutcome {
  const StartRejected(this.code);

  final String code;
}

/// 503 DEPENDENCY_UNAVAILABLE: 시작 안 됨 확정(판정 기록 없음). 같은 키로 다시 시도할 수 있다.
final class StartNotStarted extends StartOutcome {
  const StartNotStarted();
}

/// 응답을 받지 못했거나 같은 키의 앞선 요청이 처리 중. 같은 키 재전송으로 확정한다.
final class StartUnknown extends StartOutcome {
  const StartUnknown();
}

/// 같은 키에 다른 본문(IDEMPOTENCY_CONFLICT, retryable=false). 클라이언트 오류라 자동 재시도하지 않는다.
final class StartClientError extends StartOutcome {
  const StartClientError();
}

/// 결품·파손·차단 보고 사유.
enum ShortageReason { short, damaged, blocked }

abstract final class TaskProblemCode {
  static const alreadyStarted = 'ALREADY_STARTED';
  static const notAssignee = 'NOT_ASSIGNEE';
  static const predecessorNotCompleted = 'PREDECESSOR_NOT_COMPLETED';
  static const invalidState = 'INVALID_STATE';
  static const versionConflict = 'VERSION_CONFLICT';
  static const idempotencyConflict = 'IDEMPOTENCY_CONFLICT';
  static const dependencyUnavailable = 'DEPENDENCY_UNAVAILABLE';
}

/// 큐에 넣는 실행 명령 종류.
abstract final class FieldCommandKind {
  static const pickExecution = 'pick-execution';
  static const packExecution = 'pack-execution';
}
