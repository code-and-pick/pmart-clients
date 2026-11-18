import 'package:flutter/foundation.dart';

/// 크루 업무(2026-11-10 사용자 결정 — `docs/apps/mfc-app.md` §0). 업무를 고르고 "작업 준비 완료"를 누르면
/// 서버가 그 업무 안의 가장 급한 작업을 하나씩 준다.
/// 작업 유형 묶음: 계약 TaskType 이 있는 것은 그 값, 없는 것(회수품 반입·회수품 검수·실사)은
/// 이 앱의 임시 값(`RETURN_RECEIPT`·`RETURN_INSPECT`·`CYCLE_COUNT`)이다 — 확정은 BR-52.
enum WorkArea {
  /// 입고: 입고 등록·하차 → 수령(계수, 정상/격리/미판정 수량).
  inbound({'RECEIVE'}),

  /// 품질검사: 정상/격리 판정, LOT 분리(제조 LOT·소비기한), 환불·불량으로 들어온 회수품 검사.
  inspection({'INSPECT', 'RETURN_INSPECT'}),

  /// 재고 이동: 입고 → 보관 라인(적치), 회수품 반입, 보충·지시 이동·취소품 복귀 등 재고가 움직이는 모든 흐름.
  stockMove({'PUTAWAY', 'REPLENISH', 'MOVE', 'RETURN', 'RETURN_RECEIPT'}),

  /// 재고 실사: 실사 입력 → 차이 승인.
  stockCount({'CYCLE_COUNT'}),

  /// 피패킹: 피킹·패킹.
  pickPack({'PICK', 'PACK'});

  const WorkArea(this.taskTypes);

  /// 이 업무로 받는 작업 유형.
  final Set<String> taskTypes;

  static WorkArea? fromName(String? n) =>
      WorkArea.values.where((a) => a.name == n).firstOrNull;
}

/// 메인 화면의 업무 외 메뉴. 볼 수 있는 자격은 가정이다(BR-52).
enum PdaMenu {
  /// 인계 확인(포장대) — 패킹 자격.
  handoverCheck({'PACK'}),

  /// 프린터 설정 — 패킹 자격.
  printerSettings({'PACK'}),

  /// 휴게 — 누구나.
  rest(<String>{});

  const PdaMenu(this.requires);

  /// 이 중 하나라도 있으면 쓸 수 있다. 비어 있으면 누구나.
  final Set<String> requires;
}

/// 작업자 본인. 권한은 서버의 유효 작업 유형(업무 ∩ 자격)이다.
@immutable
class WorkerProfile {
  const WorkerProfile({
    required this.workerId,
    required this.allowedTaskTypes,
    this.workAreas,
    this.displayName,
    this.active = true,
    this.onBreak = false,
  });

  final String workerId;
  final String? displayName;
  final Set<String> allowedTaskTypes;

  /// 서버가 준 "고를 수 있는 업무"(mfc-capacity 0.13.0 `Worker.workAreas` — BR-52 R3·R4 회신).
  /// 서버가 주지 않았으면 null(0.12.0 이하 서버·목) — 그때만 작업 유형 겹침으로 본다.
  final Set<WorkArea>? workAreas;
  final bool active;
  final bool onBreak;

  /// 이 업무를 고를 수 있는지(안내용 — 판정은 서버). 서버 값이 있으면 그 값만 따른다.
  bool can(WorkArea a) =>
      active &&
      (workAreas?.contains(a) ?? a.taskTypes.any(allowedTaskTypes.contains));

  bool canUse(PdaMenu m) =>
      m.requires.isEmpty || m.requires.any(allowedTaskTypes.contains);
}

/// 서버가 준 작업 한 줄(다음 작업 받기 상세 — 시작 전 사본).
@immutable
class AssignedLine {
  const AssignedLine({
    this.productName,
    this.sku,
    this.qty,
    this.fromLocation,
    this.toLocation,
    this.notice,
    this.boxes,
  });

  /// 입고: 예정 박스 수(목만 — BR-53 R17).
  final int? boxes;
  final String? productName;
  final String? sku;
  final int? qty;
  final String? fromLocation;
  final String? toLocation;
  final String? notice;
}

/// 서버가 배정한 작업 하나. 한 번에 하나만 들고 있다.
@immutable
class AssignedTask {
  const AssignedTask({
    required this.taskId,
    required this.taskType,
    this.promisedReadyAt,
    this.urgent = false,
    this.lines = const [],
    this.detailAvailable = true,
    this.assignmentVersion,
  });

  final String taskId;

  /// capacity 배정 버전(다음 작업 받기 응답) — 작업 시작에 보낸다. fulfillment 작업 상세는 배정 사건을 받기 전이라
  /// 비어 있거나 옛 값일 수 있다(2026-11-18 실서버 — 패킹 시작이 VERSION_CONFLICT).
  final int? assignmentVersion;

  /// 계약 TaskType 값(PICK·PACK·RETURN·REPLENISH·MOVE·RECEIVE·INSPECT·PUTAWAY).
  final String taskType;
  final DateTime? promisedReadyAt;
  final bool urgent;
  final List<AssignedLine> lines;

  /// 상세를 못 읽었으면 false — 화면은 작업 상세를 직접 읽는다.
  final bool detailAvailable;

  /// 이 앱의 실행 화면 경로. 없으면 null.
  /// RECEIVE 의 taskId 는 입고 예정 trfId 로 본다 — 계약에 없음(BR-52).
  String? get route => switch (taskType) {
    'PICK' || 'PACK' || 'RETURN' => '/tasks/$taskId',
    'RECEIVE' => '/inbound/$taskId',
    // INSPECT taskId = 입고 작업 ID, RETURN_INSPECT taskId = 반입 ID(가정 — BR-52 R2·R12).
    'INSPECT' => '/quality/inspect/$taskId',
    'RETURN_INSPECT' => '/quality/return/$taskId',
    // MOVE·REPLENISH taskId = moveId(capacity 공지 2026-11-08), PUTAWAY = 입고 작업 ID,
    // CYCLE_COUNT = 실사 세션 ID(가정 — BR-52 R14).
    'MOVE' || 'REPLENISH' => '/stock/move/$taskId',
    'PUTAWAY' => '/stock/putaway/$taskId',
    'CYCLE_COUNT' => '/stock/count/$taskId',
    _ => null,
  };

  bool get runnable => route != null;
}

/// 다음 작업 받기 결과.
@immutable
sealed class NextTaskOutcome {
  const NextTaskOutcome();
}

final class NextAssigned extends NextTaskOutcome {
  const NextAssigned(this.task);

  final AssignedTask task;
}

/// 받을 수 없음(확정). code 로 안내한다 — NO_TASK_AVAILABLE·ON_BREAK·OFF_SHIFT 등.
final class NextUnavailable extends NextTaskOutcome {
  const NextUnavailable(this.code);

  final String code;
}

/// 응답을 못 받았다. 같은 키로 다시 받으면 서버가 들고 있는 작업을 돌려준다.
final class NextUnknown extends NextTaskOutcome {
  const NextUnknown();
}

abstract final class WorkProblemCode {
  static const noTaskAvailable = 'NO_TASK_AVAILABLE';
  static const onBreak = 'ON_BREAK';
  static const offShift = 'OFF_SHIFT';
  static const dailyNotEnrolled = 'DAILY_NOT_ENROLLED';

  /// 고른 업무에 유효 작업 유형이 하나도 없다(422 — mfc-capacity 0.13.0).
  static const workAreaNotAllowed = 'WORK_AREA_NOT_ALLOWED';
  static const workerNotActive = 'WORKER_NOT_ACTIVE';
  static const workerNotRegistered = 'WORKER_NOT_REGISTERED';
  static const configRequired = 'CONFIG_REQUIRED';
}
