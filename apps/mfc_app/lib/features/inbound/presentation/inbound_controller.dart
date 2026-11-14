import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../packing/presentation/packing_controller.dart'
    show mfcClockProvider;
import '../../tasks/presentation/task_controllers.dart';
import '../data/inbound_repository.dart';
import '../data/mock_inbound_repository.dart';
import '../domain/inbound.dart';

final inboundRepositoryProvider = Provider<InboundRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockInboundRepository(),
    PmartEnv.local => ApiInboundRepository(ref.watch(dioProvider)),
  },
);

/// 재고 반영 조회 간격·횟수. 다 돌아도 안 끝나면 "반영 대기"로 두고 다시 확인한다.
final applyPollPolicyProvider = Provider<({Duration interval, int attempts})>(
  (_) => (interval: const Duration(seconds: 1), attempts: 5),
);

enum InboundPhase {
  loading,

  /// 1단계: 도착 등록·하차.
  arrival,

  /// 2단계(박스가 있으면): 박스 검수 — 예정 박스가 다 왔는지, 박스째 파손인지.
  boxCheck,

  /// 3단계(박스가 있으면): 박스를 하나씩 열어 안의 낱개 검수.
  boxInspect,

  /// 2단계(박스 목록이 없을 때 — 계약 그대로): 상품별 수령 계수.
  counting,

  /// 3단계: 확인 후 수령 등록.
  review,

  /// 4단계: 접수됨, 재고 반영 기다림.
  applying,

  /// 반영 완료(TIN_POSTED / APPLIED).
  applied,

  /// 재고 반영이 거절됐다.
  applyRejected,
  cancelled,
  loadError,
}

/// 스캔 결과.
enum InboundScan { counted, otherLine, unknownCode }

/// 박스 스캔 결과.
enum BoxScan { ok, already, notThisTruck }

@immutable
class InboundState {
  const InboundState({
    this.phase = InboundPhase.loading,
    this.promise,
    this.counts = const {},
    this.index = 0,
    this.busy = false,
    this.unknown = false,
    this.code,
    this.receiptId,
    this.lastScan,
    this.arrived = const {},
    this.damaged = const {},
    this.boxCounts = const {},
    this.selectedBox,
    this.lastBox,
    this.lastBoxScan,
    this.expandedLine,
  });

  /// 박스 검수에서 박스 번호를 펼친 상품(행 key).
  final String? expandedLine;

  /// 박스 검수: 확인한 박스 ID.
  final Set<String> arrived;

  /// 박스째 파손 — 열지 않고 입수 전부 격리.
  final Set<String> damaged;

  /// 박스별 낱개 검수 결과(있으면 그 박스는 검수 끝).
  final Map<String, ReceiptCount> boxCounts;

  /// 지금 열어 보는 박스.
  final String? selectedBox;

  /// 마지막으로 확인한 박스(파손 표시용).
  final String? lastBox;
  final BoxScan? lastBoxScan;

  final InboundPhase phase;
  final InboundPromiseView? promise;

  /// 행 key → 현장 계수.
  final Map<String, ReceiptCount> counts;

  /// 계수 중인 행.
  final int index;
  final bool busy;

  /// 보낸 명령의 결과를 모른다 — "다시 확인"은 같은 키로만.
  final bool unknown;

  /// 거절 코드 등 안내용.
  final String? code;
  final String? receiptId;
  final InboundScan? lastScan;

  InboundLine? get line {
    final ls = promise?.lines ?? const <InboundLine>[];
    return index < ls.length ? ls[index] : null;
  }

  ReceiptCount countOf(InboundLine l) => counts[l.key] ?? const ReceiptCount();

  InboundState copyWith({
    InboundPhase? phase,
    InboundPromiseView? promise,
    Map<String, ReceiptCount>? counts,
    int? index,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    String? Function()? receiptId,
    InboundScan? Function()? lastScan,
    Set<String>? arrived,
    Set<String>? damaged,
    Map<String, ReceiptCount>? boxCounts,
    String? Function()? selectedBox,
    String? Function()? lastBox,
    BoxScan? Function()? lastBoxScan,
    String? Function()? expandedLine,
  }) => InboundState(
    phase: phase ?? this.phase,
    promise: promise ?? this.promise,
    counts: counts ?? this.counts,
    index: index ?? this.index,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    receiptId: receiptId != null ? receiptId() : this.receiptId,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
    arrived: arrived ?? this.arrived,
    damaged: damaged ?? this.damaged,
    boxCounts: boxCounts ?? this.boxCounts,
    selectedBox: selectedBox != null ? selectedBox() : this.selectedBox,
    lastBox: lastBox != null ? lastBox() : this.lastBox,
    lastBoxScan: lastBoxScan != null ? lastBoxScan() : this.lastBoxScan,
    expandedLine: expandedLine != null ? expandedLine() : this.expandedLine,
  );

  bool get usesBoxes => promise?.boxList.isNotEmpty ?? false;

  InboundBox? boxById(String id) =>
      promise?.boxList.where((b) => b.boxId == id).firstOrNull;

  /// 열어 볼 박스 = 확인했고 박스째 파손이 아닌 것.
  List<InboundBox> get openable => [
    for (final b in promise?.boxList ?? const <InboundBox>[])
      if (arrived.contains(b.boxId) && !damaged.contains(b.boxId)) b,
  ];

  bool get allBoxesInspected =>
      openable.every((b) => boxCounts.containsKey(b.boxId));

  /// 박스 결과를 상품(행)별로 합친다. 미도착 박스는 0, 박스째 파손은 입수 전부 격리(파손).
  Map<String, ReceiptCount> get aggregated {
    final out = <String, ReceiptCount>{};
    for (final l in promise?.lines ?? const <InboundLine>[]) {
      var n = 0;
      var q = 0;
      var pend = 0;
      DiscrepancyReason? reason;
      for (final b in promise!.boxesOf(l)) {
        if (!arrived.contains(b.boxId)) continue;
        if (damaged.contains(b.boxId)) {
          q += b.unitsPerBox;
          reason ??= DiscrepancyReason.damaged;
          continue;
        }
        final c = boxCounts[b.boxId];
        if (c == null) continue;
        n += c.normal;
        q += c.quarantined;
        pend += c.pending;
        if (c.quarantined > 0) {
          reason = reason == DiscrepancyReason.temperature
              ? reason
              : (c.quarantineReason ?? reason);
        }
      }
      out[l.key] = ReceiptCount(
        normal: n,
        quarantined: q,
        pending: pend,
        quarantineReason: q > 0 ? (reason ?? DiscrepancyReason.damaged) : null,
      );
    }
    return out;
  }
}

/// 입고 1건(TRF). 서버가 준 입고 작업을 단계별로 진행한다.
final inboundFlowProvider = NotifierProvider.autoDispose
    .family<InboundFlowController, InboundState, String>(
      InboundFlowController.new,
    );

class InboundFlowController extends Notifier<InboundState> {
  InboundFlowController(this.trfId);

  final String trfId;
  IdempotencyKey? _arrivalKey;
  IdempotencyKey? _receiptKey;

  InboundRepository get _repo => ref.read(inboundRepositoryProvider);
  String get _me => ref.read(currentWorkerIdProvider);
  DateTime _now() => ref.read(mfcClockProvider)();

  @override
  InboundState build() {
    Future.microtask(load);
    return const InboundState();
  }

  /// 서버 상태로 단계를 정한다. 계수는 화면에만 있으므로 유지한다.
  Future<void> load() async {
    InboundPromiseView p;
    try {
      p = await _repo.promise(trfId);
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: InboundPhase.loadError);
      return;
    }
    if (!ref.mounted) return;
    final open = p.receipts.where((r) => !r.applyStatus.finished).lastOrNull;
    final phase = switch (p.state) {
      PromiseState.expected => InboundPhase.arrival,
      PromiseState.receiving when open != null => InboundPhase.applying,
      PromiseState.receiving when state.phase == InboundPhase.review =>
        InboundPhase.review,
      PromiseState.receiving when state.phase == InboundPhase.boxInspect =>
        InboundPhase.boxInspect,
      PromiseState.receiving when p.boxList.isNotEmpty => InboundPhase.boxCheck,
      PromiseState.receiving => InboundPhase.counting,
      PromiseState.tinPosted => InboundPhase.applied,
      PromiseState.cancelled => InboundPhase.cancelled,
      PromiseState.unknown => InboundPhase.loadError,
    };
    state = state.copyWith(
      phase: phase,
      promise: p,
      receiptId: open == null ? null : () => open.receiptId,
    );
  }

  /// 1단계: 도착 등록. 접수 뒤 예정 상태를 다시 읽어 RECEIVING 이어야 다음 단계다.
  Future<void> arrive() async {
    final p = state.promise;
    if (p == null || state.busy) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _arrivalKey ??= IdempotencyKey.generate();
    final outcome = await _repo.recordArrival(
      trfId,
      version: p.version,
      arrivedAt: _now(),
      recordedBy: _me,
      key: key,
    );
    if (!ref.mounted) return;
    switch (outcome) {
      case InboundAccepted():
        _arrivalKey = null;
        state = state.copyWith(busy: false, unknown: false);
        await load();
      case InboundRejected(:final code):
        _arrivalKey = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
        // 이미 도착 등록됐을 수 있다 — 서버 상태로 다시 정한다.
        await load();
      case InboundUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }

  /// 화면의 테스트 일괄 동작이 현재 상태를 읽는다.
  InboundState get current => state;

  // ───── 박스 검수 ─────

  /// 박스 바코드(박스 번호). 이 송장 박스면 확인.
  BoxScan scanBox(String code) {
    final id = code.trim();
    final b = state.boxById(id);
    final BoxScan r;
    if (b == null) {
      r = BoxScan.notThisTruck;
    } else if (state.arrived.contains(id)) {
      r = BoxScan.already;
    } else {
      state = state.copyWith(arrived: {...state.arrived, id});
      r = BoxScan.ok;
    }
    state = state.copyWith(
      lastBoxScan: () => r,
      lastBox: b == null ? null : () => id,
    );
    return r;
  }

  /// 상품 줄을 눌러 박스 번호를 펼치거나 접는다.
  void toggleLine(String lineKey) => state = state.copyWith(
    expandedLine: () => state.expandedLine == lineKey ? null : lineKey,
  );

  /// 박스째 파손 표시/해제(확인한 박스만).
  void toggleDamaged(String boxId) {
    if (!state.arrived.contains(boxId)) return;
    final d = {...state.damaged};
    if (!d.remove(boxId)) d.add(boxId);
    state = state.copyWith(damaged: d);
  }

  /// 박스 검수 끝 → 박스 열기. 안 온 박스는 미도착으로 남는다.
  void finishBoxCheck() {
    if (state.arrived.isEmpty) return;
    state = state.copyWith(phase: InboundPhase.boxInspect);
  }

  void backToBoxCheck() => state = state.copyWith(
    phase: InboundPhase.boxCheck,
    selectedBox: () => null,
  );

  // ───── 박스별 낱개 검수 ─────

  /// 박스를 연다(목록에서 누르거나 박스 바코드 스캔).
  bool openBox(String code) {
    final id = code.trim();
    final ok = state.openable.any((b) => b.boxId == id);
    if (ok) state = state.copyWith(selectedBox: () => id);
    return ok;
  }

  void closeBox() => state = state.copyWith(selectedBox: () => null);

  /// 지금 박스의 검수 결과(아직이면 0).
  ReceiptCount boxCountOf(String id) =>
      state.boxCounts[id] ?? const ReceiptCount();

  void setBoxCount(String id, ReceiptCount c) =>
      state = state.copyWith(boxCounts: {...state.boxCounts, id: c});

  /// 박스 검수 저장 — 격리가 있으면 사유를 골라야 한다.
  void saveBox() {
    final id = state.selectedBox;
    if (id == null) return;
    final c = boxCountOf(id);
    if (!c.complete) return;
    state = state.copyWith(
      boxCounts: {...state.boxCounts, id: c},
      selectedBox: () => null,
    );
  }

  /// 모든 박스를 열어 봤으면 상품별로 합쳐 확인 단계로.
  void boxesToReview() {
    if (!state.allBoxesInspected) return;
    state = state.copyWith(
      counts: state.aggregated,
      phase: InboundPhase.review,
    );
  }

  /// 상품 스캔: 지금 행의 바코드면 정상 +1.
  InboundScan scan(String code) {
    final l = state.line;
    final c = code.trim();
    final InboundScan r;
    if (l != null && l.matchesBarcode(c)) {
      _set(l, state.countOf(l).copyWith(normal: state.countOf(l).normal + 1));
      r = InboundScan.counted;
    } else if (state.promise?.lines.any((x) => x.matchesBarcode(c)) ?? false) {
      r = InboundScan.otherLine;
    } else {
      r = InboundScan.unknownCode;
    }
    state = state.copyWith(lastScan: () => r);
    return r;
  }

  void setCount(InboundLine l, ReceiptCount c) => _set(l, c);

  /// 박스째 정상 +입수(박스 바코드가 계약에 없어 버튼으로 — BR-53 R17).
  void addBox(InboundLine l) {
    final per = l.unitsPerBox;
    if (per == null) return;
    _set(l, state.countOf(l).copyWith(normal: state.countOf(l).normal + per));
  }

  void _set(InboundLine l, ReceiptCount c) =>
      state = state.copyWith(counts: {...state.counts, l.key: c});

  void next() {
    final p = state.promise;
    final l = state.line;
    if (p == null || l == null || !state.countOf(l).complete) return;
    state = state.index + 1 < p.lines.length
        ? state.copyWith(index: state.index + 1, lastScan: () => null)
        : state.copyWith(phase: InboundPhase.review, lastScan: () => null);
  }

  void back() {
    if (state.phase == InboundPhase.review) {
      state = state.copyWith(
        phase: state.usesBoxes
            ? InboundPhase.boxInspect
            : InboundPhase.counting,
      );
    } else if (state.index > 0) {
      state = state.copyWith(index: state.index - 1, lastScan: () => null);
    }
  }

  /// 3단계: 수령 등록. 접수(202) ≠ 반영 — 반영은 수령 결과 조회로 확인한다.
  Future<void> submit() async {
    final p = state.promise;
    if (p == null || state.busy) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _receiptKey ??= IdempotencyKey.generate();
    final outcome = await _repo.recordReceipt(
      trfId,
      version: p.version,
      counts: [for (final l in p.lines) (l, state.countOf(l))],
      receivedAt: _now(),
      receivedBy: _me,
      key: key,
    );
    if (!ref.mounted) return;
    switch (outcome) {
      case InboundAccepted(:final resultId):
        _receiptKey = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          phase: InboundPhase.applying,
          receiptId: () => resultId,
        );
        await pollApply();
      case InboundRejected(:final code):
        _receiptKey = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
        if (code == InboundProblemCode.versionConflict ||
            code == InboundProblemCode.invalidState) {
          await load();
        }
      case InboundUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }

  /// 4단계: 재고 반영 확인. 끝나지 않으면 "반영 대기"로 두고 다시 확인한다.
  Future<void> pollApply() async {
    final id = state.receiptId;
    if (id == null) {
      // 접수 응답에 receiptId 가 없으면 예정의 수령 목록으로 확인한다.
      await load();
      return;
    }
    state = state.copyWith(busy: true);
    final policy = ref.read(applyPollPolicyProvider);
    ReceiptView? last;
    for (var i = 0; i < policy.attempts; i++) {
      if (i > 0) await Future<void>.delayed(policy.interval);
      if (!ref.mounted) return;
      try {
        last = await _repo.receipt(trfId, id);
      } on PmartFailure {
        continue;
      }
      if (last.applyStatus.finished) break;
    }
    if (!ref.mounted) return;
    state = state.copyWith(
      busy: false,
      phase: switch (last?.applyStatus) {
        ApplyStatus.applied => InboundPhase.applied,
        ApplyStatus.rejected => InboundPhase.applyRejected,
        _ => InboundPhase.applying,
      },
    );
  }
}
