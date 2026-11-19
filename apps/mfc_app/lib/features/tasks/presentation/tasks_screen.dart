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
import '../../../shared/pda_theme.dart';
import '../../../shared/location_guide.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../domain/task_list.dart';
import '../../my_work/presentation/my_work.dart';
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
          // READY 도 시작을 보낸다: 배정 직후 fulfillment 는 배정 사건을 받기 전이라 잠깐 READY 다
          // (2026-11-18 실서버 — 피킹 끝 → 패킹 배정 → "지금 할 수 없어요"). 서버 시작 판정은 READY·ASSIGNED 를 받고
          // 배정자는 capacity 에 바로 묻는다(TaskRules.startRejection) — 내 배정이 아니면 NOT_ASSIGNEE 로 거절된다.
          if ((t.state == TaskState.assigned || t.state == TaskState.ready) &&
              t.kind != TaskKind.dispatch) {
            if (flow.phase == StartPhase.idle) _start(t);
          }
          final message = switch (flow.phase) {
            StartPhase.rejected => startRejectText(l10n, flow.rejectCode),
            StartPhase.notStarted => l10n.startNotStarted,
            StartPhase.unknown => l10n.startUnknown,
            StartPhase.clientError => l10n.startClientError,
            _
                when t.state != TaskState.assigned &&
                    t.state != TaskState.ready &&
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
  ScanResult.wrongLot => l10n.scanWrongLot,
  ScanResult.overRemaining => l10n.scanOver,
  ScanResult.noTarget => l10n.scanNoTarget,
  ScanResult.needLocation => l10n.pickNeedLocation,
};

/// 피킹 실적 거절 사유. 모르는 코드는 코드 그대로.
String pickRejectText(AppLocalizations l10n, String code) => switch (code) {
  TaskProblemCode.toLocationRequired => l10n.pickRejectToLocation,
  TaskProblemCode.cartMismatch => l10n.pickRejectCartMismatch,
  TaskProblemCode.locationZoneMismatch => l10n.pickRejectZone,
  TaskProblemCode.lotMismatch => l10n.pickRejectLot,
  TaskProblemCode.pickQtyExceeded => l10n.pickRejectQtyExceeded,
  TaskProblemCode.insufficientStock => l10n.pickRejectStock,
  TaskProblemCode.locationClosed => l10n.pickRejectLocationClosed,
  TaskProblemCode.locationNotRegistered => l10n.pickRejectLocationUnknown,
  TaskProblemCode.locationAllocatedToOther => l10n.pickRejectLocationOther,
  TaskProblemCode.skuAlreadyShelved => l10n.pickRejectShelved,
  TaskProblemCode.temperatureZoneMismatch => l10n.pickRejectTemperature,
  TaskProblemCode.invalidState => l10n.pickRejectState,
  TaskProblemCode.versionConflict => l10n.pickRejectVersion,
  TaskProblemCode.configRequired => l10n.pickRejectConfig,
  ProblemCode.domainRejected => l10n.pickRejectByServer,
  _ => l10n.pickRejectCode(code),
};

String pickLocText(AppLocalizations l10n, PickLocScan r) => switch (r) {
  PickLocScan.ok => '',
  PickLocScan.wrongPlace => l10n.moveWrongPlace,
  PickLocScan.notLocation => l10n.moveNotLocation,
  PickLocScan.overScan => l10n.scanOver,
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
      // 장갑 낀 손으로도 누르게 큰 칸 셋(아이콘 + 이름, 파손은 품질 사고 안내 한 줄).
      builder: (context) => SimpleDialog(
        title: Text(l10n.shortageTitle(missing)),
        contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        children: [
          for (final r in ShortageReason.values)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton(
                key: ValueKey('shortage-${r.name}'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(64),
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () => Navigator.of(context).pop(r),
                child: Row(
                  children: [
                    Icon(switch (r) {
                      ShortageReason.short =>
                        Icons.remove_shopping_cart_outlined,
                      ShortageReason.damaged => Icons.broken_image_outlined,
                      ShortageReason.blocked => Icons.block,
                    }, size: 28),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(switch (r) {
                            ShortageReason.short => l10n.shortageShort,
                            ShortageReason.damaged => l10n.shortageDamaged,
                            ShortageReason.blocked => l10n.shortageBlocked,
                          }, style: Theme.of(context).textTheme.titleMedium),
                          // mfc-quality 0.6.0: 파손 결품 보고는 서버가 품질 사고(자동)를 연다
                          if (r == ShortageReason.damaged)
                            Text(
                              l10n.shortageDamagedNote,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
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
    final task = detail.value;
    final stepTitle = picking.cart == null
        ? l10n.pickTitleCart
        : picking.at == null
        ? l10n.pickTitleLocation
        : l10n.pickTitleItem;
    return Scaffold(
      appBar: AppBar(
        // 위치 스캔 화면 구성(사용자 2026-11-16 참고 화면): 제목은 지금 단계, 위에 작업 이름.
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.pickingTitle, style: theme.textTheme.labelMedium),
            Text(stepTitle, key: const ValueKey('pick-step-title')),
          ],
        ),
        bottom: const MyWorkBar(),
        actions: [
          if (picking.cart case final cart?)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Column(
                key: const ValueKey('pick-cart-chip'),
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.shopping_cart_outlined, size: 20),
                  Text(cart, style: theme.textTheme.labelSmall),
                ],
              ),
            ),
          if (task != null)
            IconButton(
              key: const ValueKey('task-info'),
              tooltip: l10n.taskInfo,
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                builder: (_) => _TaskInfoSheet(task: task),
              ),
              icon: const Icon(Icons.info_outline),
            ),
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
          // 시안 pda-preview.html: 위 = 단계·진행·큰 제목·카드, 아래 고정 칸 = 스캔·버튼.
          final body = <Widget>[];
          final actions = <Widget>[];
          if (stop != null) {
            body.add(
              StepHeader(
                names: [
                  l10n.pickStepCart,
                  l10n.pickStepLocation,
                  l10n.pickStepItem,
                ],
                current: step,
              ),
            );
          }
          body.add(
            ProgressLine(
              textKey: const ValueKey('pick-progress'),
              text: l10n.taskProgress(task.totalCompleted, task.totalPlanned),
              done: task.totalCompleted,
              total: task.totalPlanned,
            ),
          );
          if (checking) {
            body.add(
              Card(
                key: const ValueKey('do-not-redo'),
                margin: const EdgeInsets.only(bottom: 12),
                color: theme.colorScheme.errorContainer,
                child: ListTile(
                  leading: const Icon(Icons.warning_amber_rounded),
                  title: Text(l10n.doNotRedo),
                ),
              ),
            );
          }
          if (stop != null && picking.cart == null) {
            // 1. 장바구니 — 주문과 장바구니를 잇는다(업무 문서 §7-6).
            body.add(
              ScanPrompt(
                key: const ValueKey('target-cart'),
                text: l10n.pickCartTitle,
                detail: l10n.pickCartHelp,
              ),
            );
            actions.add(
              ScanInput(
                id: 'cart-scan',
                testValues: [
                  TestScan(l10n.tsCart, 'CRT-C-01'),
                  TestScan(l10n.tsWrong, 'C-S1-01-1-01'),
                ],
                label: l10n.pickScanCart,
                cameraTitle: l10n.pickCameraTitle,
                continuous: false,
                autofocus: false,
                onScan: (code) =>
                    _ctl.scanCart(code, shipmentId: task.shipmentId)
                    ? const ScanFeedback.ok()
                    : ScanFeedback.error(l10n.pickNotCart),
              ),
            );
          } else if (stop != null) {
            if (picking.at == null) {
              // 2. 칸 — 진한 카드(온도대·구역·랙·단·칸). 같은 상품이 여러 칸·LOT 에 있어도
              // 지시 LOT 을 집게(IV-07 오로트 차단).
              body.add(
                LocationGuide(
                  code: stop.location,
                  codeKey: const ValueKey('pick-location'),
                  detail: picking.cart == null
                      ? null
                      : l10n.pickCartDetail(picking.cart!),
                ),
              );
              if (picking.lastLocScan case final r? when r != PickLocScan.ok) {
                body.add(
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      pickLocText(l10n, r),
                      key: const ValueKey('pick-loc-error'),
                      style: TextStyle(
                        color: theme.colorScheme.error,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                );
              }
              actions.add(
                ScanInput(
                  id: 'pick-loc-scan',
                  testValues: [
                    TestScan(l10n.tsLocation, stop.location),
                    for (final o in stop.otherLocations)
                      TestScan(l10n.tsOtherLocation, o),
                    TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                  ],
                  label: l10n.locScanHint,
                  cameraTitle: l10n.pickCameraTitle,
                  continuous: false,
                  autofocus: false,
                  onScan: (code) => switch (_ctl.scanLocation(task, code)) {
                    PickLocScan.ok => const ScanFeedback.ok(),
                    final r => ScanFeedback.error(pickLocText(l10n, r)),
                  },
                ),
              );
            } else {
              // 3. 상품 — 큰 제목 "상품 n개를 담으세요" + 확인한 칸.
              body.add(
                ScanPrompt(
                  text: l10n.pickTakeTitle(stop.qty),
                  detail: l10n.pickLocConfirmed(picking.at!),
                ),
              );
            }
            body.add(
              _PickCard(
                key: ValueKey('current-${stop.line.orderLineId}'),
                stop: stop,
                captured: picking.capturedFor(stop.line.orderLineId),
                emphasize: picking.at != null,
              ),
            );
            if (picking.at != null) {
              // 첫 개를 스캔하면 수량 칸 — 스캔마다 +1, + 버튼, 수기(사용자 2026-11-17).
              if (picking.capturedFor(stop.line.orderLineId) > 0) {
                body.add(
                  CountQtyField(
                    id: 'pick-qty',
                    label: l10n.pickQtyLabel,
                    help: l10n.pickQtyHelp(stop.qty),
                    addLabel: l10n.pickQtyAdd,
                    value: picking.capturedFor(stop.line.orderLineId),
                    max: stop.qty,
                    onAdd: () => _ctl.addOne(task),
                    onSet: (n) => _ctl.setCount(task, n),
                  ),
                );
              }
              if (picking.lastScan case final s? when s != ScanResult.matched) {
                body.add(
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      pickScanText(l10n, s),
                      key: const ValueKey('scan-error'),
                      style: TextStyle(
                        color: theme.colorScheme.error,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                );
              }
              actions.addAll([
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
                  label: l10n.pickScanItem,
                  cameraTitle: l10n.pickCameraTitle,
                  // 한 번 인식하면 카메라를 내린다(사용자 2026-11-17) — 열린 채 연속 인식하면
                  // 칸 몫을 채운 뒤의 인식이 다음 단계로 넘어가 버렸다.
                  continuous: false,
                  onScan: (code) => _onScan(task, code),
                ),
                OutlinedButton(
                  key: const ValueKey('report-shortage'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: PdaColors.danger,
                  ),
                  onPressed: () => _shortage(task, stop),
                  child: Text(l10n.reportShortage),
                ),
              ]);
            }
          } else if (task.state == TaskState.blocked) {
            // 결품 보고로 막혔다 — 고객 확인 전에는 패킹하지 않는다(WK-06).
            body.add(
              Text(
                l10n.pickBlocked(task.blockReason ?? '-'),
                key: const ValueKey('pick-blocked'),
                style: theme.textTheme.titleMedium,
              ),
            );
            actions.add(
              FilledButton(
                key: const ValueKey('next-task'),
                onPressed: () => backToSession(context, WorkArea.pickPack),
                child: Text(l10n.nextTask),
              ),
            );
          } else if (task.lines.every((l) => l.done)) {
            // 4. 피킹 끝 — 장바구니를 들고 패킹대로(피킹·패킹 같은 사람, 업무 문서 §7-6).
            body.add(
              DoneMark(
                title: l10n.pickDoneTitle,
                message: l10n.pickToPack,
                messageKey: const ValueKey('pick-finished'),
              ),
            );
            actions.add(
              FilledButton(
                key: const ValueKey('to-pack'),
                onPressed: () => continueToPack(context, ref),
                child: Text(l10n.pickStartPacking),
              ),
            );
          } else {
            // 보낸 실적이 아직 확정되지 않았다 — 다시 집지 않는다.
            body.add(
              Text(
                l10n.pickWaitingConfirm,
                key: const ValueKey('pick-finished'),
              ),
            );
            actions.add(
              CommandButton(
                key: const ValueKey('check-again'),
                busy: picking.syncing,
                label: l10n.checkAgain,
                onPressed: _ctl.sync,
              ),
            );
          }
          if (queue.any((q) => q.state == QueueItemState.rejected)) {
            body.add(
              _RejectedNotice(
                taskId: widget.taskId,
                items: [
                  for (final q in queue)
                    if (q.state == QueueItemState.rejected) q,
                ],
              ),
            );
          }
          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: body,
                ),
              ),
              ActionBar(children: actions),
            ],
          );
        },
      ),
    );
  }
}

/// 지금 집을 상품 카드(시안 card): 이름 + 큰 수량, 회색 LOT·유통기한, 담은 수, 칸 경고·같은 LOT 다른 칸.
class _PickCard extends StatelessWidget {
  const _PickCard({
    super.key,
    required this.stop,
    required this.captured,
    required this.emphasize,
  });

  final PickStop stop;
  final int captured;

  /// 상품 단계 — 담은 수를 진하게.
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final meta = [
      if (stop.pick?.visitSeq case final n?) l10n.pickVisit(n),
      if (stop.lotId case final lot?) l10n.lot(lot),
      if (stop.expiresOn case final e?) l10n.expiresOn(e),
    ].join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Text(
                    stop.line.productName ?? stop.line.sku,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                      height: 1.35,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  l10n.pickFooterQty(stop.qty),
                  style: const TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w900,
                    color: PdaColors.primary,
                  ),
                ),
              ],
            ),
            if (meta.isNotEmpty)
              Text(
                meta,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: PdaColors.muted,
                ),
              ),
            const SizedBox(height: 6),
            Text(
              l10n.pickStopQty(stop.qty, captured),
              key: const ValueKey('pick-counts'),
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: emphasize ? FontWeight.w800 : null,
                color: emphasize ? PdaColors.dark : PdaColors.muted,
              ),
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
              NoticeBox(
                key: const ValueKey('pick-other-locations'),
                warning: true,
                text: l10n.pickOtherLocations(stop.otherLocations.join(', ')),
              ),
          ],
        ),
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

/// 작업 정보 — 이 작업의 상품 줄과 진행(서버 값 그대로).
class _TaskInfoSheet extends StatelessWidget {
  const _TaskInfoSheet({required this.task});

  final TaskDetailView task;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return SafeArea(
      child: ListView(
        key: const ValueKey('task-info-sheet'),
        shrinkWrap: true,
        padding: const EdgeInsets.all(16),
        children: [
          Text(l10n.taskInfo, style: theme.textTheme.titleLarge),
          Text(l10n.taskProgress(task.totalCompleted, task.totalPlanned)),
          const Divider(),
          for (final l in task.lines)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                l.done ? Icons.check_circle : Icons.radio_button_unchecked,
                color: l.done ? theme.colorScheme.primary : null,
              ),
              title: Text(l.productName ?? l.sku),
              subtitle: Text(firstPickLocation(l) ?? '-'),
              trailing: Text(l10n.taskInfoLine(l.completedQty, l.plannedQty)),
            ),
        ],
      ),
    );
  }
}

/// 거절된 실적과 사유 — 무엇이 막혔는지 현장에서 알 수 있게(fulfillment 0.16.0 E1).
/// 보낼 때 받은 코드가 있으면 그 문구, 확정 조회로 거절된 것(코드 없음)은 실행을 조회해 코드·서버 문장.
class _RejectedNotice extends ConsumerWidget {
  const _RejectedNotice({required this.taskId, required this.items});

  final String taskId;
  final List<QueueItem> items;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final lines = <String>{};
    for (final q in items) {
      final code = q.rejectCode;
      if (code != null && code != ProblemCode.domainRejected) {
        lines.add(pickRejectText(l10n, code));
        continue;
      }
      final id = q.resultId;
      final r = id == null
          ? null
          : ref.watch(executionRejectProvider((taskId, id))).value;
      lines.add(switch (r) {
        ExecutionReject(:final code, :final reason?) =>
          l10n.pickRejectWithReason(pickRejectText(l10n, code), reason),
        ExecutionReject(:final code) => pickRejectText(l10n, code),
        null => pickRejectText(l10n, code ?? ProblemCode.domainRejected),
      });
    }
    return Text(
      [l10n.pickRejectedSome, ...lines].join('\n'),
      key: const ValueKey('pick-rejected'),
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    );
  }
}
