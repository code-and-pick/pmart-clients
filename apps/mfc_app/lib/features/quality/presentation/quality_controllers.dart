import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../../shared/field_repositories.dart';
import '../../inbound/presentation/inbound_controller.dart'
    show applyPollPolicyProvider;
import '../../packing/presentation/packing_controller.dart'
    show mfcClockProvider;
import '../../stock_move/domain/stock_move.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../domain/quality.dart';

// ───────────────────────── 입고 품질검사 ─────────────────────────
// 역할(2026-11-10 사용자 결정): 입고는 박스·수량·겉보기 파손, 품질검사는 상품 대조·소비기한·제조일·
// 기준 판정(정상/격리)·사유·사진. 같은 물건을 두 번 판정하지 않는다. 수량은 입고 결과(작업 잔량)를 그대로.

/// 격리 사유(화면). 계약 검사 결과에는 사유 필드가 없다 — BR-52 R18.
enum QuarantineReason { expiry, manufacture, damaged, temperature, other }

/// 결과 한 줄 입력값. 판정은 기본값이 없다(null = 아직 안 고름).
@immutable
class InspectRow {
  const InspectRow({
    this.id = 0,
    this.qty = 0,
    this.expiry = '',
    this.manufacture = '',
    this.quarantined,
    this.reason,
    this.evidence,
    this.lotRef = '',
    this.noLot = false,
  });

  /// 화면 입력칸 식별(줄을 지워도 다른 줄 입력이 섞이지 않게).
  final int id;
  final int qty;

  /// 소비기한·제조일(yyyy-MM-dd, 달력으로만 고른다).
  final String expiry;
  final String manufacture;

  /// 격리 판정. null = 아직 안 고름.
  final bool? quarantined;
  final QuarantineReason? reason;

  /// 증빙 사진 참조(격리 줄 필수).
  final String? evidence;

  /// 포장에 찍힌 제조사 LOT 원문(스캔) — LOT 번호는 시스템이 정한다(채번 지침 G-06).
  final String lotRef;
  final bool noLot;

  InspectRow copyWith({
    int? qty,
    String? expiry,
    String? manufacture,
    bool? Function()? quarantined,
    QuarantineReason? Function()? reason,
    String? Function()? evidence,
    String? lotRef,
    bool? noLot,
  }) => InspectRow(
    id: id,
    qty: qty ?? this.qty,
    expiry: expiry ?? this.expiry,
    manufacture: manufacture ?? this.manufacture,
    quarantined: quarantined != null ? quarantined() : this.quarantined,
    reason: reason != null ? reason() : this.reason,
    evidence: evidence != null ? evidence() : this.evidence,
    lotRef: lotRef ?? this.lotRef,
    noLot: noLot ?? this.noLot,
  );
}

/// 판정 기준(상품 정보). minRemainingDays 가 null 이면 기준 정보 없음 — 정상 판정을 막는다.
@immutable
class InspectCriteria {
  const InspectCriteria({
    this.minRemainingDays,
    this.maxDaysSinceManufacture,
    this.zone,
  });

  factory InspectCriteria.of(InboundTaskView t) => InspectCriteria(
    minRemainingDays: t.minRemainingDays,
    maxDaysSinceManufacture: t.maxDaysSinceManufacture,
    zone: t.zone,
  );

  final int? minRemainingDays;
  final int? maxDaysSinceManufacture;
  final TempZone? zone;

  bool get known => minRemainingDays != null;
  bool get needsManufacture => maxDaysSinceManufacture != null;
  bool get needsTemperature =>
      zone == TempZone.chilled || zone == TempZone.frozen;
}

enum InspectIssue {
  zeroQty,
  needExpiry,
  needManufacture,

  /// 제조일이 오늘 이후거나 소비기한 이후.
  badManufacture,
  needVerdict,
  needReason,
  needEvidence,

  /// 정상 줄 — LOT 표기 스캔 또는 "표기 없음".
  needLot,

  /// 합계가 검사할 수량과 다르다.
  totalMismatch,

  /// 같은 판정·LOT 표기·소비기한 줄이 둘 이상.
  duplicate,

  /// 냉장·냉동 — 온도 확인을 안 했다.
  needTemperature,
}

final _datePattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');
DateTime? _date(String s) =>
    _datePattern.hasMatch(s) ? DateTime.tryParse(s) : null;
DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

/// 기준으로 정해지는 강제 격리 사유(정상을 고를 수 없다). 없으면 null.
QuarantineReason? forcedReason(
  InspectRow r,
  InspectCriteria c,
  DateTime today, {
  required bool temperatureBad,
}) {
  if (temperatureBad) return QuarantineReason.temperature;
  final exp = _date(r.expiry);
  final min = c.minRemainingDays;
  if (exp != null && min != null && exp.difference(_day(today)).inDays < min) {
    return QuarantineReason.expiry;
  }
  final mfg = _date(r.manufacture);
  final max = c.maxDaysSinceManufacture;
  if (mfg != null && max != null && _day(today).difference(mfg).inDays > max) {
    return QuarantineReason.manufacture;
  }
  return null;
}

/// 줄마다의 문제(없으면 빈 집합).
Set<InspectIssue> inspectRowIssues(
  InspectRow r,
  InspectCriteria c,
  DateTime today,
) {
  final out = <InspectIssue>{};
  if (r.qty < 1) out.add(InspectIssue.zeroQty);
  if (r.expiry.isEmpty) out.add(InspectIssue.needExpiry);
  if (c.needsManufacture && r.manufacture.isEmpty) {
    out.add(InspectIssue.needManufacture);
  }
  final exp = _date(r.expiry);
  final mfg = _date(r.manufacture);
  if (mfg != null &&
      (mfg.isAfter(_day(today)) || (exp != null && mfg.isAfter(exp)))) {
    out.add(InspectIssue.badManufacture);
  }
  switch (r.quarantined) {
    case null:
      out.add(InspectIssue.needVerdict);
    case true:
      if (r.reason == null) out.add(InspectIssue.needReason);
      if (r.evidence == null) out.add(InspectIssue.needEvidence);
    case false:
      if (r.lotRef.isEmpty && !r.noLot) out.add(InspectIssue.needLot);
  }
  return out;
}

/// 단계: 위치 확인 → 상품 대조 → 판정.
enum InspectPhase {
  loading,
  locate,
  product,
  judge,
  applied,
  notFound,
  loadError,
}

enum InspectScan { ok, wrong }

@immutable
class InspectState {
  const InspectState({
    this.phase = InspectPhase.loading,
    this.task,
    this.rows = const [],
    this.temperatureOk,
    this.busy = false,
    this.unknown = false,
    this.code,
    this.result,
    this.lastScan,
  });

  final InspectPhase phase;
  final InboundTaskView? task;
  final List<InspectRow> rows;

  /// 냉장·냉동 온도 확인. null = 아직, false = 이탈(전부 격리).
  final bool? temperatureOk;
  final bool busy;
  final bool unknown;
  final String? code;
  final InboundTaskExecutionView? result;
  final InspectScan? lastScan;

  int get total => rows.fold(0, (s, r) => s + r.qty);
  InspectCriteria get criteria =>
      task == null ? const InspectCriteria() : InspectCriteria.of(task!);

  InspectState copyWith({
    InspectPhase? phase,
    InboundTaskView? task,
    List<InspectRow>? rows,
    bool? Function()? temperatureOk,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    InboundTaskExecutionView? result,
    InspectScan? Function()? lastScan,
  }) => InspectState(
    phase: phase ?? this.phase,
    task: task ?? this.task,
    rows: rows ?? this.rows,
    temperatureOk: temperatureOk != null ? temperatureOk() : this.temperatureOk,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    result: result ?? this.result,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
  );
}

final inspectFlowProvider = NotifierProvider.autoDispose
    .family<InspectController, InspectState, String>(InspectController.new);

class InspectController extends Notifier<InspectState> {
  InspectController(this.taskId);

  final String taskId;
  IdempotencyKey? _key;
  int _rowSeq = 0;

  @override
  InspectState build() {
    Future.microtask(load);
    return const InspectState();
  }

  DateTime get today => ref.read(mfcClockProvider)();

  /// 화면의 테스트 동작이 현재 상태를 읽는다.
  InspectState get current => state;

  Future<void> load() async {
    final repo = ref.read(qualityRepositoryProvider);
    final mfc = ref.read(currentMfcIdProvider);
    try {
      // 단건 조회가 계약에 없어 목록에서 찾는다(BR-53 R8).
      final open = await repo.inboundTasks(mfc, kind: InboundTaskKind.inspect);
      final t = open.where((t) => t.taskId == taskId).firstOrNull;
      if (!ref.mounted) return;
      if (t != null) {
        state = state.copyWith(
          phase: state.phase == InspectPhase.loading
              ? InspectPhase.locate
              : state.phase,
          task: t,
          rows: state.rows.isEmpty
              ? [InspectRow(id: ++_rowSeq, qty: t.remainingQty)]
              : state.rows,
        );
        return;
      }
      final done = await repo.inboundTasks(
        mfc,
        kind: InboundTaskKind.inspect,
        completed: true,
      );
      if (!ref.mounted) return;
      final d = done.where((t) => t.taskId == taskId).firstOrNull;
      state = d == null
          ? state.copyWith(phase: InspectPhase.notFound)
          : state.copyWith(phase: InspectPhase.applied, task: d);
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: InspectPhase.loadError);
    }
  }

  /// 1단계: 검사 위치 스캔.
  InspectScan scanLocation(String code) {
    final ok = code.trim() == state.task?.locationCode;
    state = state.copyWith(
      lastScan: () => ok ? InspectScan.ok : InspectScan.wrong,
      phase: ok ? InspectPhase.product : state.phase,
    );
    return ok ? InspectScan.ok : InspectScan.wrong;
  }

  /// 2단계: 상품 바코드 대조. 바코드 정보가 없으면(계약 공백) [confirmProductWithoutBarcode].
  InspectScan scanProduct(String code) {
    final ok = state.task?.matchesBarcode(code) ?? false;
    state = state.copyWith(
      lastScan: () => ok ? InspectScan.ok : InspectScan.wrong,
      phase: ok ? InspectPhase.judge : state.phase,
    );
    return ok ? InspectScan.ok : InspectScan.wrong;
  }

  void confirmProductWithoutBarcode() {
    if (state.task?.barcode != null) return;
    state = state.copyWith(phase: InspectPhase.judge, lastScan: () => null);
  }

  void setTemperature({required bool ok}) {
    if (state.unknown) return;
    state = state.copyWith(temperatureOk: () => ok);
    _applyForced();
  }

  void setRow(int i, InspectRow r) {
    if (state.unknown) return; // 결과를 모르는 동안은 보낸 내용을 바꾸지 않는다.
    state = state.copyWith(rows: [...state.rows]..[i] = r);
    _applyForced();
  }

  /// 기준 미달·온도 이탈 줄은 격리로 고정하고 사유를 채운다.
  void _applyForced() {
    final c = state.criteria;
    final bad = state.temperatureOk == false;
    state = state.copyWith(
      rows: [
        for (final r in state.rows)
          switch (forcedReason(r, c, today, temperatureBad: bad)) {
            final f? => r.copyWith(quarantined: () => true, reason: () => f),
            null => r,
          },
      ],
    );
  }

  /// 이 줄에서 정상을 고를 수 있는지(기준 정보 있음·강제 격리 아님).
  bool canBeNormal(InspectRow r) =>
      state.criteria.known &&
      forcedReason(
            r,
            state.criteria,
            today,
            temperatureBad: state.temperatureOk == false,
          ) ==
          null;

  void addRow() {
    if (state.unknown) return;
    final t = state.task;
    final left = t == null ? 0 : t.remainingQty - state.total;
    state = state.copyWith(
      rows: [
        ...state.rows,
        InspectRow(id: ++_rowSeq, qty: left > 0 ? left : 0),
      ],
    );
  }

  void removeRow(int i) {
    if (state.unknown || state.rows.length < 2) return;
    state = state.copyWith(rows: [...state.rows]..removeAt(i));
  }

  Set<InspectIssue> issues() {
    final t = state.task;
    final out = <InspectIssue>{
      for (final r in state.rows) ...inspectRowIssues(r, state.criteria, today),
    };
    if (t != null && state.total != t.remainingQty) {
      out.add(InspectIssue.totalMismatch);
    }
    if (state.criteria.needsTemperature && state.temperatureOk == null) {
      out.add(InspectIssue.needTemperature);
    }
    final seen = <String>{};
    for (final r in state.rows) {
      if (r.expiry.isEmpty || r.quarantined == null) continue;
      if (!seen.add('${r.quarantined}|${r.lotRef}|${r.expiry}')) {
        out.add(InspectIssue.duplicate);
      }
    }
    return out;
  }

  Future<void> submit() async {
    if (state.busy || state.task == null) return;
    if (!state.unknown && issues().isNotEmpty) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await ref.read(qualityRepositoryProvider).inspect(taskId, [
      for (final r in state.rows)
        InspectionResult(
          qty: r.qty,
          quarantined: r.quarantined ?? true,
          // LOT 번호(lotId)는 시스템이 정한다. 보내는 것은 포장에 찍힌 제조사 LOT 원문뿐.
          sourceLotRef: r.lotRef.isEmpty ? null : r.lotRef,
          expiryDate: r.expiry.isEmpty ? null : r.expiry,
          manufactureDate: r.manufacture.isEmpty ? null : r.manufacture,
        ),
    ], key: key);
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          phase: InspectPhase.applied,
          result: value,
          task: value.task,
        );
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }
}

// ───────────────────────── 회수품(반품) 검수 ─────────────────────────
// 온도대·신선 여부는 상품 정보 값(작업자가 고르지 않는다). 작업자는 개봉·파손·기한 지남과 사진만.
// 판정은 자동: 상온·신선 아님·미개봉·파손 없음·기한 지남 아님이면 재판매, 아니면 폐기(사유 자동).

TempZone? _zone(String? w) => switch (w) {
  'AMBIENT' => TempZone.ambient,
  'CHILLED' => TempZone.chilled,
  'FROZEN' => TempZone.frozen,
  _ => null,
};

@immutable
class ReturnDecision {
  const ReturnDecision({
    this.zone,
    this.fresh,
    this.opened = false,
    this.damaged = false,
    this.expired = false,
    this.evidence,
  });

  factory ReturnDecision.of(ReturnedLine l) =>
      ReturnDecision(zone: _zone(l.zone), fresh: l.fresh);

  /// 상품 정보 값. null 이면 정보 없음 — 판정할 수 없다(관리자 확인).
  final TempZone? zone;
  final bool? fresh;

  /// 작업자 확인.
  final bool opened;
  final bool damaged;
  final bool expired;
  final String? evidence;

  bool get known => zone != null && fresh != null;

  /// 폐기 사유(재판매면 null). 조건에서 자동.
  DisposeReason? get disposeReason => switch (this) {
    ReturnDecision(zone: TempZone.chilled || TempZone.frozen) =>
      DisposeReason.temperatureZone,
    ReturnDecision(fresh: true) => DisposeReason.fresh,
    ReturnDecision(opened: true) => DisposeReason.opened,
    ReturnDecision(damaged: true) => DisposeReason.damaged,
    ReturnDecision(expired: true) => DisposeReason.expired,
    _ => null,
  };

  ReturnVerdict get verdict =>
      disposeReason == null ? ReturnVerdict.resale : ReturnVerdict.dispose;

  /// 정보가 있고, 폐기면 사진이 있어야 한다.
  bool get complete =>
      known && (verdict == ReturnVerdict.resale || evidence != null);

  ReturnDecision copyWith({
    bool? opened,
    bool? damaged,
    bool? expired,
    String? Function()? evidence,
  }) => ReturnDecision(
    zone: zone,
    fresh: fresh,
    opened: opened ?? this.opened,
    damaged: damaged ?? this.damaged,
    expired: expired ?? this.expired,
    evidence: evidence != null ? evidence() : this.evidence,
  );
}

enum ReturnPhase {
  loading,
  editing,

  /// 접수됨, 재고 반영 기다림.
  applying,
  applied,
  alreadyInspected,
  loadError,
}

@immutable
class ReturnInspectState {
  const ReturnInspectState({
    this.phase = ReturnPhase.loading,
    this.receipt,
    this.decisions = const [],
    this.busy = false,
    this.unknown = false,
    this.code,
    this.inspectionId,
  });

  final ReturnPhase phase;
  final ReturnReceiptView? receipt;
  final List<ReturnDecision> decisions;
  final bool busy;
  final bool unknown;
  final String? code;
  final String? inspectionId;

  bool get complete =>
      decisions.isNotEmpty && decisions.every((d) => d.complete);

  ReturnInspectState copyWith({
    ReturnPhase? phase,
    ReturnReceiptView? receipt,
    List<ReturnDecision>? decisions,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    String? Function()? inspectionId,
  }) => ReturnInspectState(
    phase: phase ?? this.phase,
    receipt: receipt ?? this.receipt,
    decisions: decisions ?? this.decisions,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    inspectionId: inspectionId != null ? inspectionId() : this.inspectionId,
  );
}

final returnInspectFlowProvider = NotifierProvider.autoDispose
    .family<ReturnInspectController, ReturnInspectState, String>(
      ReturnInspectController.new,
    );

class ReturnInspectController extends Notifier<ReturnInspectState> {
  ReturnInspectController(this.returnReceiptId);

  final String returnReceiptId;
  IdempotencyKey? _key;

  @override
  ReturnInspectState build() {
    Future.microtask(load);
    return const ReturnInspectState();
  }

  Future<void> load() async {
    try {
      final r = await ref
          .read(stockMoveRepositoryProvider)
          .returnReceipt(returnReceiptId);
      if (!ref.mounted) return;
      state = state.copyWith(
        phase: r.inspected ? ReturnPhase.alreadyInspected : ReturnPhase.editing,
        receipt: r,
        decisions: state.decisions.length == r.lines.length
            ? state.decisions
            : [for (final l in r.lines) ReturnDecision.of(l)],
      );
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: ReturnPhase.loadError);
    }
  }

  void decide(int i, ReturnDecision d) {
    if (state.unknown) return;
    state = state.copyWith(decisions: [...state.decisions]..[i] = d);
  }

  Future<void> submit() async {
    final r = state.receipt;
    if (r == null || state.busy) return;
    if (!state.unknown && !state.complete) return;
    final claimId = r.claimId;
    if (claimId == null) {
      state = state.copyWith(code: () => 'CLAIM_MISSING');
      return;
    }
    state = state.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await ref
        .read(qualityRepositoryProvider)
        .inspectReturn(
          mfcId: ref.read(currentMfcIdProvider),
          claimId: claimId,
          returnReceiptId: returnReceiptId,
          inspectedBy: ref.read(currentWorkerIdProvider),
          lines: [
            for (final (i, l) in r.lines.indexed)
              ReturnInspectionLine(
                sku: l.sku,
                orderLineId: l.orderLineId,
                lotId: l.lotId,
                qty: l.qty,
                verdict: state.decisions[i].verdict,
                zone: state.decisions[i].zone!,
                fresh: state.decisions[i].fresh!,
                opened: state.decisions[i].opened,
                disposeReason: state.decisions[i].disposeReason,
                evidenceRef: state.decisions[i].evidence,
              ),
          ],
          key: key,
        );
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          phase: ReturnPhase.applying,
          inspectionId: () => value,
        );
        await pollApply();
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }

  /// 접수(202) ≠ 반영. 검수 조회의 재고 반영 상태가 APPLIED 여야 끝.
  Future<void> pollApply() async {
    final id = state.inspectionId;
    if (id == null) return;
    state = state.copyWith(busy: true);
    final policy = ref.read(applyPollPolicyProvider);
    String? status;
    for (var i = 0; i < policy.attempts; i++) {
      if (i > 0) await Future<void>.delayed(policy.interval);
      if (!ref.mounted) return;
      try {
        status =
            (await ref.read(qualityRepositoryProvider).returnInspection(id))
                .applyStatus;
      } on PmartFailure {
        continue;
      }
      if (status == 'APPLIED' || status == 'REJECTED') break;
    }
    if (!ref.mounted) return;
    state = state.copyWith(
      busy: false,
      phase: status == 'APPLIED' ? ReturnPhase.applied : ReturnPhase.applying,
      code: status == 'REJECTED' ? () => 'APPLY_REJECTED' : null,
    );
  }
}
