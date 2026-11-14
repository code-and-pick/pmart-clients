import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/codes.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/issue_report.dart';
import '../../../shared/product_hints.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../stock_move/presentation/stock_move_controllers.dart' show LocScan;
import '../../stock_move/presentation/stock_move_screens.dart' show locScanText;
import '../../work/domain/work.dart';
import '../../work/presentation/work_controller.dart' show autoNextAllowed;
import '../../work/presentation/work_screens.dart' show backToSession;
import '../data/task_repository.dart';
import '../domain/task_list.dart';
import 'task_controllers.dart';

/// 지금 옮길 한 조각(줄·LOT·포장 위치).
@immutable
class ReturnPiece {
  const ReturnPiece({
    required this.line,
    required this.lotId,
    required this.from,
    required this.left,
    this.suggested = const [],
  });

  final TaskLineView line;
  final String lotId;

  /// 복귀 대상이 놓인 포장 위치.
  final String from;

  /// 더 옮길 양(접수만 된 것 제외).
  final int left;
  final List<String> suggested;
}

/// 남은 첫 조각. 없으면 null(다 옮김 또는 확정 대기).
ReturnPiece? nextReturnPiece(TaskDetailView t) {
  for (final l in t.lines) {
    final left = l.remainingQty - l.pendingQty;
    if (left <= 0) continue;
    final p = l.picks.where((p) => (p.remainingQty ?? 0) > 0).firstOrNull;
    final from = p?.locations.where((c) => (c.qty ?? 0) > 0).firstOrNull?.code;
    final lot = p?.lotId ?? l.lotId;
    if (from == null || lot == null) continue;
    return ReturnPiece(
      line: l,
      lotId: lot,
      from: from,
      left: left,
      suggested: p?.suggestedToLocations ?? const [],
    );
  }
  return null;
}

@immutable
class ReturnFlowState {
  const ReturnFlowState({
    this.atFrom = false,
    this.loaded = false,
    this.to,
    this.qty = 0,
    this.coldOk,
    this.reported = false,
    this.lastScan,
    this.syncing = false,
  });

  final bool atFrom;

  /// 상품을 세어 실었다고 눌렀다 — 이제 돌려놓을 선반으로 간다(화면 안의 단계. 서버 호출 없음).
  final bool loaded;
  final String? to;

  /// 옮길 수량 — 상품을 스캔해 센다(0부터). 바코드를 모르면 직접 넣는다.
  final int qty;

  /// 냉장·냉동 취소품이 포장대에서 온도를 지켰는지(작업자 답). 상온이면 묻지 않는다.
  /// 기준은 업무 문서에 없다(BR-52 R19 8).
  final bool? coldOk;

  /// 문제를 보고했다(복귀하지 않음).
  final bool reported;
  final LocScan? lastScan;
  final bool syncing;

  ReturnFlowState copyWith({
    bool? atFrom,
    bool? loaded,
    String? Function()? to,
    int? qty,
    bool? Function()? coldOk,
    bool? reported,
    LocScan? Function()? lastScan,
    bool? syncing,
  }) => ReturnFlowState(
    atFrom: atFrom ?? this.atFrom,
    loaded: loaded ?? this.loaded,
    to: to != null ? to() : this.to,
    qty: qty ?? this.qty,
    coldOk: coldOk != null ? coldOk() : this.coldOk,
    reported: reported ?? this.reported,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
    syncing: syncing ?? this.syncing,
  );
}

final returnFlowProvider = NotifierProvider.autoDispose
    .family<ReturnFlowController, ReturnFlowState, String>(
      ReturnFlowController.new,
    );

/// 취소품 복귀(RETURN 작업): 포장 위치 확인 → 선반 칸 스캔 → 수량 → 실적(큐에 넣고 같은 키로 보냄·확정 조회).
class ReturnFlowController extends Notifier<ReturnFlowState> {
  ReturnFlowController(this.taskId);

  final String taskId;

  @override
  ReturnFlowState build() => const ReturnFlowState();

  ReturnFlowState get current => state;

  /// 줄 상품 바코드(작업 줄 → 상품 정보). 모르면 null.
  String? barcodeOf(TaskLineView l) =>
      l.barcode ?? ref.read(productHintsProvider).bySku(l.sku)?.barcode;

  /// 냉장·냉동이면 온도 확인을 묻는다(상품 정보 온도대). 모르면 묻지 않는다.
  bool needsCold(TaskLineView l) =>
      switch (ref.read(productHintsProvider).bySku(l.sku)?.zone) {
        StorageZone.chilled || StorageZone.frozen => true,
        _ => false,
      };

  void setCold(bool ok) => state = state.copyWith(coldOk: () => ok);

  void reported() => state = state.copyWith(reported: true);

  /// 이동·보충과 같은 순서(사용자 2026-11-13): 포장 위치 → 상품(1개씩) → (실었어요) → 선반 칸.
  LocScan scan(ReturnPiece p, String code) {
    final c = code.trim();
    final bc = barcodeOf(p.line);
    final LocScan r;
    if (!state.atFrom) {
      // ① 위치 확인: 포장 위치만 받는다.
      if (!isMfcLocation(c)) {
        r = bc != null ? LocScan.needFrom : LocScan.notLocation;
      } else if (c == p.from) {
        state = state.copyWith(atFrom: true);
        r = LocScan.ok;
      } else {
        r = LocScan.wrongPlace;
      }
    } else if (!state.loaded) {
      // ② 상품 싣기: 상품만 센다. 선반은 "실었어요" 뒤에 받는다.
      if (isMfcLocation(c)) {
        r = c == p.from ? LocScan.ok : LocScan.needLoad;
      } else if (bc == null) {
        r = LocScan.notLocation;
      } else if (c != bc) {
        r = LocScan.wrongItem;
      } else if (state.qty >= p.left) {
        r = LocScan.over;
      } else {
        state = state.copyWith(qty: state.qty + 1);
        r = LocScan.ok;
      }
    } else if (!isMfcLocation(c)) {
      r = LocScan.notLocation;
    } else if (c == p.from || c.startsWith('PAK-')) {
      r = LocScan.wrongPlace;
    } else {
      // ③ 내려놓기: 추천 칸이 아니어도 받는다 — 진열 규칙 판정은 서버(재고).
      state = state.copyWith(to: () => c);
      r = LocScan.ok;
    }
    state = state.copyWith(lastScan: () => r);
    return r;
  }

  void setQty(int q) => state = state.copyWith(qty: q);

  /// 상품을 다 실었다 → 돌려놓을 선반으로(화면 안의 단계).
  void markLoaded() {
    if (!state.atFrom || state.qty < 1) return;
    state = state.copyWith(loaded: true, lastScan: () => null);
  }

  /// 수량을 다시 센다 → 상품 싣기로 돌아간다.
  void recount() => state = state.copyWith(
    loaded: false,
    to: () => null,
    lastScan: () => null,
  );

  /// 복귀할 수 있는지 — 칸·수량, 냉장·냉동이면 온도 확인 "예".
  bool canSubmit(ReturnPiece p) =>
      state.atFrom &&
      state.loaded &&
      state.to != null &&
      state.qty > 0 &&
      (!needsCold(p.line) || state.coldOk == true);

  Future<void> submit(TaskDetailView t, ReturnPiece p) async {
    final to = state.to;
    final qty = state.qty;
    if (!canSubmit(p) || to == null) return;
    await ref
        .read(fieldQueueProvider)
        .enqueue(
          kind: FieldCommandKind.pickExecution,
          targetId: taskId,
          payload: returnPayload(
            workerId: ref.read(currentWorkerIdProvider),
            assignmentVersion: t.assignmentVersion,
            line: p.line,
            lotId: p.lotId,
            fromLocation: p.from,
            toLocation: to,
            qty: qty,
          ),
        );
    if (!ref.mounted) return;
    state = const ReturnFlowState();
    await sync();
  }

  /// 전송 대기·확인 중을 같은 키로 보내고, 확정 대기를 조회한다(피킹과 같은 큐).
  Future<void> sync() async {
    if (state.syncing) return;
    state = state.copyWith(syncing: true);
    final repo = ref.read(taskRepositoryProvider);
    final queue = ref.read(fieldQueueProvider);
    await queue.flush(repo.sendExecution);
    await queue.confirm(
      (item) => item.resultId == null
          ? Future.value(ConfirmResult.unknown)
          : repo.execution(item.targetId, item.resultId!),
    );
    if (!ref.mounted) return;
    state = state.copyWith(syncing: false);
    ref
      ..invalidate(taskQueueProvider(taskId))
      ..invalidate(taskDetailProvider(taskId));
  }
}

class ReturnShelfScreen extends ConsumerWidget {
  const ReturnShelfScreen({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(returnFlowProvider(taskId));
    final ctl = ref.read(returnFlowProvider(taskId).notifier);
    final queue = ref.watch(taskQueueProvider(taskId)).value ?? const [];
    final waiting = queue.where(
      (q) =>
          q.state == QueueItemState.queued ||
          q.state == QueueItemState.awaitingConfirm ||
          q.state == QueueItemState.checking,
    );
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.typeReturn),
        actions: [
          IconButton(
            key: const ValueKey('return-sync'),
            tooltip: l10n.sync,
            onPressed: s.syncing ? null : ctl.sync,
            icon: const Icon(Icons.sync),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: UiStateView<TaskDetailView>(
            state: uiStateOf(ref.watch(taskDetailProvider(taskId))),
            onRetry: () => ref.invalidate(taskDetailProvider(taskId)),
            ready: (context, t) {
              final p = nextReturnPiece(t);
              final allDone = t.lines.every((l) => l.done);
              if (s.reported) {
                return ResultView(
                  key: const ValueKey('return-reported'),
                  icon: Icons.report_problem_outlined,
                  text: l10n.issueReported,
                  action: l10n.nextTask,
                  onAction: () async =>
                      backToSession(context, WorkArea.stockMove),
                );
              }
              if (p == null) {
                return allDone
                    // 서버가 모든 줄을 끝났다고 답한 뒤에만 나온다.
                    ? TaskDoneView(
                        key: const ValueKey('return-done'),
                        title: l10n.returnShelfDoneTitle,
                        message: l10n.returnShelfDone,
                        rows: [
                          for (final l in t.lines)
                            (l10n.moveDoneProduct, l.productName ?? l.sku),
                        ],
                        onNext: () async =>
                            backToSession(context, WorkArea.stockMove),
                        autoNext: autoNextAllowed(ref),
                      )
                    : ResultView(
                        key: const ValueKey('return-waiting'),
                        icon: Icons.hourglass_top,
                        busy: s.syncing,
                        text: waiting.isEmpty
                            ? l10n.returnShelfWaiting
                            : l10n.doNotRedo,
                        action: l10n.checkAgain,
                        onAction: ctl.sync,
                      );
              }
              final qty = s.qty;
              final bc = ctl.barcodeOf(p.line);
              final cold = ctl.needsCold(p.line);
              // ① 위치 확인(포장 위치) ② 상품 싣기 ③ 내려놓기(선반) — 이동·보충과 같은 순서.
              final step = !s.atFrom
                  ? 0
                  : !s.loaded
                  ? 1
                  : 2;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  StepHeader(
                    names: [
                      l10n.moveStepLocate,
                      l10n.moveStepLoad,
                      l10n.moveStepDrop,
                    ],
                    current: step,
                  ),
                  const SizedBox(height: 12),
                  Card(
                    margin: EdgeInsets.zero,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p.line.productName ?? p.line.sku,
                            style: theme.textTheme.titleLarge,
                          ),
                          Text(l10n.lot(p.lotId)),
                          Text(l10n.returnShelfLeft(p.left)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (step < 2)
                    TargetLine(
                      key: const ValueKey('return-from'),
                      label: l10n.moveFrom,
                      code: p.from,
                      confirmed: s.atFrom,
                    )
                  else ...[
                    if (s.to == null)
                      GoBanner(
                        key: const ValueKey('return-go'),
                        text: l10n.returnShelfGo,
                      ),
                    TargetLine(
                      key: const ValueKey('return-to'),
                      label: l10n.moveTo,
                      code: s.to ?? l10n.returnShelfScanShelf,
                      confirmed: s.to != null,
                    ),
                    if (p.suggested.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          l10n.returnShelfSuggested(p.suggested.join(', ')),
                          key: const ValueKey('return-suggested'),
                        ),
                      ),
                    if (s.to case final to?
                        when p.suggested.isNotEmpty &&
                            !p.suggested.contains(to))
                      Text(
                        l10n.returnShelfNotSuggested,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                  ],
                  const SizedBox(height: 8),
                  ScanInput(
                    id: 'return-scan',
                    reprint: step == 1
                        ? [
                            ReprintTarget(
                              sku: p.line.sku,
                              name: p.line.productName,
                              barcode: bc,
                            ),
                          ]
                        : null,
                    testValues: switch (step) {
                      0 => [
                        TestScan(l10n.tsFrom, p.from),
                        TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                      ],
                      1 => [
                        if (bc != null) TestScan(l10n.tsProduct, bc),
                        TestScan(l10n.tsWrongProduct, '0000000000000'),
                      ],
                      _ => [
                        for (final x in p.suggested) TestScan(l10n.tsShelf, x),
                        TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                      ],
                    },
                    testActions: [
                      if (step == 1 && bc != null)
                        TestAction('fill', l10n.testFillMove, () {
                          while (ctl.current.qty < p.left &&
                              ctl.scan(p, bc) == LocScan.ok) {}
                        }),
                    ],
                    label: switch (step) {
                      0 => l10n.returnShelfScanFrom,
                      1 => l10n.moveScanItem,
                      _ => l10n.moveScanDrop,
                    },
                    cameraTitle: l10n.typeReturn,
                    autofocus: false,
                    onScan: (code) => switch (ctl.scan(p, code)) {
                      LocScan.ok => const ScanFeedback.ok(),
                      final r => ScanFeedback.error(locScanText(l10n, r)),
                    },
                  ),
                  if (s.lastScan case final r? when r != LocScan.ok)
                    Text(
                      locScanText(l10n, r),
                      key: const ValueKey('return-scan-error'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  if (step == 0)
                    Text(
                      l10n.returnShelfLocateFrom,
                      key: const ValueKey('return-locate-hint'),
                      style: theme.textTheme.bodyMedium,
                    )
                  else if (step == 1) ...[
                    Text(
                      bc != null ? l10n.moveScanned(qty) : l10n.moveNoBarcode,
                      key: const ValueKey('product-check'),
                    ),
                    QtyStepper(
                      id: 'return-qty',
                      label: l10n.moveQtyDrop,
                      value: qty,
                      max: bc != null ? qty : p.left,
                      onChanged: ctl.setQty,
                    ),
                  ] else
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.moveLoadedQty(qty),
                            key: const ValueKey('return-loaded-qty'),
                            style: theme.textTheme.titleMedium,
                          ),
                        ),
                        TextButton(
                          key: const ValueKey('return-recount'),
                          onPressed: s.syncing ? null : ctl.recount,
                          child: Text(l10n.moveRecount),
                        ),
                      ],
                    ),
                  // 온도 확인은 내려놓기 직전에 묻는다(복귀 조건).
                  if (cold && step == 2) ...[
                    const SizedBox(height: 8),
                    Text(
                      l10n.returnColdQuestion,
                      style: theme.textTheme.titleSmall,
                    ),
                    SegmentedButton<bool>(
                      key: const ValueKey('return-cold'),
                      emptySelectionAllowed: true,
                      segments: [
                        ButtonSegment(
                          value: true,
                          label: Text(l10n.returnColdYes),
                        ),
                        ButtonSegment(
                          value: false,
                          label: Text(l10n.returnColdNo),
                        ),
                      ],
                      selected: {?s.coldOk},
                      onSelectionChanged: (v) {
                        if (v.isNotEmpty) ctl.setCold(v.first);
                      },
                    ),
                    if (s.coldOk == false)
                      Text(
                        l10n.returnColdNoHelp,
                        key: const ValueKey('return-cold-no'),
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                  ],
                  const Spacer(),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IssueButton(
                      id: 'return-issue',
                      area: 'return',
                      targetId: taskId,
                      location: p.from,
                      qty: p.left,
                      issues: const [
                        FieldIssue.temperature,
                        FieldIssue.damaged,
                        FieldIssue.sourceEmpty,
                        FieldIssue.targetUnusable,
                      ],
                      onReported: (_) => ctl.reported(),
                    ),
                  ),
                  if (waiting.isNotEmpty)
                    Text(
                      l10n.returnShelfPending(waiting.length),
                      key: const ValueKey('return-pending'),
                    ),
                  const SizedBox(height: 8),
                  if (step == 1)
                    // 화면 안의 단계 — 서버에는 돌려놓을 때 한 번만 보낸다.
                    CommandButton(
                      key: const ValueKey('return-load'),
                      busy: false,
                      label: l10n.moveLoaded,
                      onPressed: qty > 0 ? () async => ctl.markLoaded() : null,
                    )
                  else if (step == 2)
                    CommandButton(
                      key: const ValueKey('return-submit'),
                      busy: s.syncing,
                      label: l10n.returnShelfSubmit,
                      onPressed: ctl.canSubmit(p)
                          ? () => ctl.submit(t, p)
                          : null,
                    ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
