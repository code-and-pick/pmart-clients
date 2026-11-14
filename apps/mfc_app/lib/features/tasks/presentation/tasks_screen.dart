import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../packing/presentation/packing_screen.dart';
import '../../work/domain/work.dart';
import '../../work/presentation/work_screens.dart' show backToSession;
import '../../work/presentation/work_controller.dart' show continueToPack;
import 'return_screen.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../domain/task_list.dart';
import 'task_controllers.dart';

String taskKindText(AppLocalizations l10n, TaskKind k) => switch (k) {
  TaskKind.pick => l10n.taskTypePick,
  TaskKind.pack => l10n.taskTypePack,
  TaskKind.dispatch => l10n.taskTypeDispatch,
  TaskKind.returnToShelf => l10n.taskTypeReturn,
};

String taskStateText(AppLocalizations l10n, TaskState s) => switch (s) {
  TaskState.waiting => l10n.tsWaiting,
  TaskState.ready => l10n.tsReady,
  TaskState.assigned => l10n.tsAssigned,
  TaskState.inProgress => l10n.tsInProgress,
  TaskState.completed => l10n.tsCompleted,
  TaskState.blocked => l10n.tsBlocked,
  TaskState.failed => l10n.tsFailed,
  TaskState.cancelled => l10n.tsCancelled,
  TaskState.closedPartial => l10n.tsClosedPartial,
  TaskState.unknown => l10n.tsUnknown,
};

/// 작업 종류별 실행 화면 경로(작업 상세 아래).
String taskRoute(TaskKind? k) => switch (k) {
  TaskKind.pack => 'pack',
  TaskKind.returnToShelf => 'return',
  _ => 'pick',
};

String startRejectText(AppLocalizations l10n, String? code) => switch (code) {
  TaskProblemCode.alreadyStarted => l10n.startAlreadyStarted,
  TaskProblemCode.notAssignee => l10n.startNotAssignee,
  TaskProblemCode.predecessorNotCompleted => l10n.startPredecessor,
  TaskProblemCode.versionConflict => l10n.startVersionConflict,
  _ => l10n.startInvalidState,
};

/// 작업 실행 입구. 근무 화면의 "작업 시작" 한 번으로 시작 판정을 받고 바로 실행 화면을 그린다
/// (작업 상세 화면을 거치지 않는다). 시작 확정 전에는 실행 화면을 보이지 않는다.
class TaskRunScreen extends ConsumerStatefulWidget {
  const TaskRunScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<TaskRunScreen> createState() => _TaskRunScreenState();
}

class _TaskRunScreenState extends ConsumerState<TaskRunScreen> {
  bool _requested = false;
  bool _running = false;

  void _start(TaskDetailView t) {
    if (_requested) return;
    _requested = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(startFlowProvider(widget.taskId).notifier).start(t);
    });
  }

  WorkArea _areaOf(TaskKind k) =>
      k == TaskKind.returnToShelf ? WorkArea.stockMove : WorkArea.pickPack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final id = widget.taskId;
    final detail = ref.watch(taskDetailProvider(id));
    final flow = ref.watch(startFlowProvider(id));
    final me = ref.watch(currentWorkerIdProvider);
    final t = detail.value;
    // 한 번 실행 화면을 열면 끝(완료) 단계까지 그 화면에 머문다.
    if (t != null &&
        (_running ||
            t.state == TaskState.inProgress && t.activeStartWorkerId == me)) {
      _running = true;
      return switch (t.kind) {
        TaskKind.pack => PackingScreen(taskId: id),
        TaskKind.returnToShelf => ReturnShelfScreen(taskId: id),
        _ => PickingScreen(taskId: id),
      };
    }
    return Scaffold(
      appBar: AppBar(title: Text(l10n.taskStarting)),
      body: UiStateView<TaskDetailView>(
        state: uiStateOf(detail),
        onRetry: () => ref.invalidate(taskDetailProvider(id)),
        ready: (context, t) {
          if (t.state == TaskState.assigned && t.kind != TaskKind.dispatch) {
            if (flow.phase == StartPhase.idle) _start(t);
          }
          final message = switch (flow.phase) {
            StartPhase.rejected => startRejectText(l10n, flow.rejectCode),
            StartPhase.notStarted => l10n.startNotStarted,
            StartPhase.unknown => l10n.startUnknown,
            StartPhase.clientError => l10n.startClientError,
            _
                when t.state != TaskState.assigned &&
                    t.state != TaskState.inProgress =>
              l10n.taskNotRunnable(taskStateText(l10n, t.state)),
            _ when t.state == TaskState.inProgress => l10n.startAlreadyStarted,
            _ => null,
          };
          if (message == null) {
            return const Center(child: CircularProgressIndicator());
          }
          final retry =
              flow.phase == StartPhase.unknown ||
              flow.phase == StartPhase.notStarted;
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  message,
                  key: const ValueKey('start-message'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (t.blockReason case final r?)
                  Text(
                    l10n.taskBlocked(r),
                    key: const ValueKey('block-reason'),
                  ),
                const Spacer(),
                if (retry)
                  CommandButton(
                    key: const ValueKey('start'),
                    busy: flow.phase == StartPhase.starting,
                    label: flow.phase == StartPhase.unknown
                        ? l10n.checkAgain
                        : l10n.retry,
                    onPressed: () =>
                        ref.read(startFlowProvider(id).notifier).start(t),
                  )
                else
                  FilledButton(
                    key: const ValueKey('next-task'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(56),
                    ),
                    onPressed: () => backToSession(context, _areaOf(t.kind)),
                    child: Text(l10n.nextTask),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

String queueStateText(AppLocalizations l10n, QueueItemState s) => switch (s) {
  QueueItemState.queued => l10n.qQueued,
  QueueItemState.awaitingConfirm => l10n.qAwaiting,
  QueueItemState.applied => l10n.qApplied,
  QueueItemState.rejected => l10n.qRejected,
  QueueItemState.checking => l10n.qChecking,
};

/// 피킹: 장바구니 → [칸 스캔 → 상품 스캔 × 수량] 을 칸마다. 한 칸 몫을 다 집으면 바로 보낸다.
/// 스캔 수량은 "이번 칸"이고, 서버 확정분만 완료로 보인다.
class PickingScreen extends ConsumerStatefulWidget {
  const PickingScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<PickingScreen> createState() => _PickingScreenState();
}

String pickScanText(AppLocalizations l10n, ScanResult r) => switch (r) {
  ScanResult.matched => '',
  ScanResult.wrongItem => l10n.scanWrongItem,
  ScanResult.overRemaining => l10n.scanOver,
  ScanResult.noTarget => l10n.scanNoTarget,
  ScanResult.needLocation => l10n.pickNeedLocation,
};

String pickLocText(AppLocalizations l10n, PickLocScan r) => switch (r) {
  PickLocScan.ok => '',
  PickLocScan.wrongPlace => l10n.moveWrongPlace,
  PickLocScan.notLocation => l10n.moveNotLocation,
};

class _PickingScreenState extends ConsumerState<PickingScreen> {
  PickingController get _ctl =>
      ref.read(pickingProvider(widget.taskId).notifier);

  ScanFeedback _onScan(TaskDetailView task, String code) {
    final l10n = AppLocalizations.of(context);
    final r = _ctl.scan(task, code);
    if (r == ScanResult.matched) {
      _ctl.submitIfFull(task);
      return const ScanFeedback.ok();
    }
    return ScanFeedback.error(pickScanText(l10n, r));
  }

  Future<void> _shortage(TaskDetailView task, PickStop stop) async {
    final l10n = AppLocalizations.of(context);
    final picking = ref.read(pickingProvider(widget.taskId));
    final missing =
        stop.line.remainingQty -
        stop.line.pendingQty -
        picking.capturedFor(stop.line.orderLineId);
    if (missing <= 0) return;
    final reason = await showDialog<ShortageReason>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(l10n.shortageTitle(missing)),
        children: [
          for (final r in ShortageReason.values)
            SimpleDialogOption(
              key: ValueKey('shortage-${r.name}'),
              onPressed: () => Navigator.of(context).pop(r),
              child: Text(switch (r) {
                ShortageReason.short => l10n.shortageShort,
                ShortageReason.damaged => l10n.shortageDamaged,
                ShortageReason.blocked => l10n.shortageBlocked,
              }),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    await _ctl.submitStop(
      task,
      shortage: (qty: missing, reason: reason, note: null),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final detail = ref.watch(taskDetailProvider(widget.taskId));
    final picking = ref.watch(pickingProvider(widget.taskId));
    final queue = ref.watch(taskQueueProvider(widget.taskId)).value ?? const [];
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.pickingTitle),
        actions: [
          IconButton(
            key: const ValueKey('sync'),
            tooltip: l10n.sync,
            onPressed: picking.syncing ? null : _ctl.sync,
            icon: const Icon(Icons.sync),
          ),
        ],
      ),
      body: UiStateView<TaskDetailView>(
        state: uiStateOf(detail),
        onRetry: () => ref.invalidate(taskDetailProvider(widget.taskId)),
        ready: (context, task) {
          final stop = nextPickStop(task);
          final checking = queue.any((q) => q.state == QueueItemState.checking);
          final step = picking.cart == null
              ? 0
              : picking.at == null
              ? 1
              : 2;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (stop != null)
                StepHeader(
                  names: [
                    l10n.pickStepCart,
                    l10n.pickStepLocation,
                    l10n.pickStepItem,
                  ],
                  current: step,
                ),
              const SizedBox(height: 8),
              Text(
                l10n.taskProgress(task.totalCompleted, task.totalPlanned),
                key: const ValueKey('pick-progress'),
                style: theme.textTheme.titleMedium,
              ),
              if (checking)
                Card(
                  key: const ValueKey('do-not-redo'),
                  color: theme.colorScheme.errorContainer,
                  child: ListTile(
                    leading: const Icon(Icons.warning_amber_rounded),
                    title: Text(l10n.doNotRedo),
                  ),
                ),
              if (stop != null && picking.cart == null) ...[
                // 1. 장바구니 — 주문과 장바구니를 잇는다(업무 문서 §7-6).
                TargetLine(
                  key: const ValueKey('target-cart'),
                  label: l10n.moveCart,
                  code: l10n.moveCartScan,
                  confirmed: false,
                ),
                ScanInput(
                  id: 'cart-scan',
                  testValues: [
                    TestScan(l10n.tsCart, 'CRT-C-01'),
                    TestScan(l10n.tsWrong, 'C-S1-01-1-01'),
                  ],
                  label: l10n.moveCartScan,
                  cameraTitle: l10n.pickCameraTitle,
                  continuous: false,
                  autofocus: false,
                  onScan: (code) =>
                      _ctl.scanCart(code, shipmentId: task.shipmentId)
                      ? const ScanFeedback.ok()
                      : ScanFeedback.error(l10n.pickNotCart),
                ),
              ] else if (stop != null) ...[
                if (picking.cart case final cart?)
                  TargetLine(label: l10n.moveCart, code: cart, confirmed: true),
                Card(
                  key: ValueKey('current-${stop.line.orderLineId}'),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          picking.at ?? stop.location,
                          key: const ValueKey('pick-location'),
                          style: theme.textTheme.headlineSmall,
                        ),
                        Text(
                          stop.line.productName ?? stop.line.sku,
                          style: theme.textTheme.titleMedium,
                        ),
                        Text(
                          [
                            if (stop.pick?.visitSeq case final n?)
                              l10n.pickVisit(n),
                            if (stop.lotId case final lot?) l10n.lot(lot),
                            if (stop.expiresOn case final e?) l10n.expiresOn(e),
                          ].join(' · '),
                        ),
                        Text(
                          l10n.pickStopQty(
                            stop.qty,
                            picking.capturedFor(stop.line.orderLineId),
                          ),
                          key: const ValueKey('pick-counts'),
                          style: theme.textTheme.titleLarge,
                        ),
                        if (stop.pick case final p?) ...[
                          if (switch (p.status) {
                                PickStatus.partial => l10n.pickStatusPartial,
                                PickStatus.notFound => l10n.pickStatusNotFound,
                                _ => null,
                              }
                              case final w?)
                            Text(
                              w,
                              key: const ValueKey('pick-status-warning'),
                              style: TextStyle(color: theme.colorScheme.error),
                            ),
                          if (p.notice case final n?)
                            Text(n, key: const ValueKey('pick-notice')),
                        ],
                        if (stop.otherLocations.isNotEmpty)
                          Text(
                            l10n.pickOtherLocations(
                              stop.otherLocations.join(', '),
                            ),
                            key: const ValueKey('pick-other-locations'),
                            style: theme.textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ),
                if (picking.at == null) ...[
                  // 2. 칸 — 같은 상품이 여러 칸·LOT 에 있어도 지시 LOT 을 집게(IV-07 오로트 차단).
                  ScanInput(
                    id: 'pick-loc-scan',
                    testValues: [
                      TestScan(l10n.tsLocation, stop.location),
                      for (final o in stop.otherLocations)
                        TestScan(l10n.tsOtherLocation, o),
                      TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                    ],
                    label: l10n.pickScanLocation,
                    cameraTitle: l10n.pickCameraTitle,
                    continuous: false,
                    autofocus: false,
                    onScan: (code) => switch (_ctl.scanLocation(task, code)) {
                      PickLocScan.ok => const ScanFeedback.ok(),
                      final r => ScanFeedback.error(pickLocText(l10n, r)),
                    },
                  ),
                  if (picking.lastLocScan case final r?
                      when r != PickLocScan.ok)
                    Text(
                      pickLocText(l10n, r),
                      key: const ValueKey('pick-loc-error'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                ] else ...[
                  // 3. 상품 — 한 번에 하나씩. 다 차면 바로 보낸다.
                  ScanInput(
                    id: 'scan-field',
                    reprint: [
                      ReprintTarget(
                        sku: stop.line.sku,
                        name: stop.line.productName,
                        barcode: stop.line.barcode,
                      ),
                    ],
                    testValues: [
                      for (final l in task.lines)
                        if (l.barcode case final bc?)
                          TestScan(l.productName ?? l.sku, bc),
                      TestScan(l10n.tsWrong, '0000000000000'),
                    ],
                    label: l10n.scanHint,
                    cameraTitle: l10n.pickCameraTitle,
                    onScan: (code) => _onScan(task, code),
                  ),
                  if (picking.lastScan case final s?
                      when s != ScanResult.matched)
                    Text(
                      pickScanText(l10n, s),
                      key: const ValueKey('scan-error'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    key: const ValueKey('report-shortage'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                    onPressed: () => _shortage(task, stop),
                    child: Text(l10n.reportShortage),
                  ),
                ],
              ] else if (task.state == TaskState.blocked) ...[
                // 결품 보고로 막혔다 — 고객 확인 전에는 패킹하지 않는다(WK-06).
                Text(
                  l10n.pickBlocked(task.blockReason ?? '-'),
                  key: const ValueKey('pick-blocked'),
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const ValueKey('next-task'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                  ),
                  onPressed: () => backToSession(context, WorkArea.pickPack),
                  child: Text(l10n.nextTask),
                ),
              ] else if (task.lines.every((l) => l.done)) ...[
                // 4. 피킹 끝 — 장바구니를 들고 패킹대로(피킹·패킹 같은 사람, 업무 문서 §7-6).
                const SizedBox(height: 24),
                const Icon(Icons.shopping_cart_checkout, size: 64),
                Text(
                  l10n.pickToPack,
                  key: const ValueKey('pick-finished'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleLarge,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  key: const ValueKey('to-pack'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                  ),
                  onPressed: () => continueToPack(context, ref),
                  child: Text(l10n.pickStartPacking),
                ),
              ] else ...[
                // 보낸 실적이 아직 확정되지 않았다 — 다시 집지 않는다.
                Text(
                  l10n.pickWaitingConfirm,
                  key: const ValueKey('pick-finished'),
                ),
                const SizedBox(height: 8),
                CommandButton(
                  key: const ValueKey('check-again'),
                  busy: picking.syncing,
                  label: l10n.checkAgain,
                  onPressed: _ctl.sync,
                ),
              ],
              if (queue.any((q) => q.state == QueueItemState.rejected))
                Text(
                  l10n.pickRejectedSome,
                  key: const ValueKey('pick-rejected'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// 지금 갈 칸: 남은 첫 지시의 배정 칸(없으면 첫 칸), 지시가 없으면 줄의 지시 로케이션.
String? firstPickLocation(TaskLineView l) {
  for (final p in l.picks) {
    if (p.status == PickStatus.done) continue;
    final allocated = p.locations
        .where((c) => (c.allocatedQty ?? 0) > 0)
        .firstOrNull;
    final c = allocated ?? p.locations.firstOrNull;
    if (c != null) return c.code;
  }
  return l.locationId;
}

/// LOT 조각 하나의 피킹 지시. 칸 상태·안내는 서버 값 그대로 보인다.
class PickInstructionTile extends StatelessWidget {
  const PickInstructionTile({super.key, required this.pick});

  final PickInstruction pick;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final warn = switch (pick.status) {
      PickStatus.partial => l10n.pickStatusPartial,
      PickStatus.notFound => l10n.pickStatusNotFound,
      PickStatus.unknown => l10n.tsUnknown,
      _ => null,
    };
    return Padding(
      key: ValueKey('pick-${pick.lotId ?? pick.visitSeq}'),
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              if (pick.visitSeq case final n?) l10n.pickVisit(n),
              if (pick.lotId case final lot?) l10n.lot(lot),
              if (pick.expiresOn case final e?) l10n.expiresOn(e),
              if (pick.remainingQty case final q?) l10n.pickLotRemaining(q),
            ].join(' · '),
            style: theme.textTheme.bodyLarge,
          ),
          if (warn != null)
            Text(
              warn,
              key: const ValueKey('pick-status-warning'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          if (pick.notice case final n?)
            Text(n, key: const ValueKey('pick-notice')),
          for (final c in pick.locations)
            Text(
              (c.allocatedQty ?? 0) > 0
                  ? l10n.pickLocationAllocated(c.code, c.allocatedQty!)
                  : l10n.pickLocationOther(c.code, c.qty ?? 0),
              style: (c.allocatedQty ?? 0) > 0
                  ? theme.textTheme.titleMedium
                  : theme.textTheme.bodyMedium,
            ),
        ],
      ),
    );
  }
}
