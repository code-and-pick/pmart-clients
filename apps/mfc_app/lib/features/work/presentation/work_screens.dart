import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../auth/presentation/auth_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/menu_tile.dart';
import '../../../shared/providers.dart';
import '../../../shared/ui_state_of.dart';
import '../../my_work/presentation/my_work.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../domain/work.dart';
import 'work_controller.dart';

String workAreaText(AppLocalizations l10n, WorkArea a) => switch (a) {
  WorkArea.inbound => l10n.areaInbound,
  WorkArea.inspection => l10n.areaInspection,
  WorkArea.stockMove => l10n.areaStockMove,
  WorkArea.stockCount => l10n.areaStockCount,
  WorkArea.pickPack => l10n.areaPickPack,
};

String workAreaHint(AppLocalizations l10n, WorkArea a) => switch (a) {
  WorkArea.inbound => l10n.areaInboundHint,
  WorkArea.inspection => l10n.areaInspectionHint,
  WorkArea.stockMove => l10n.areaStockMoveHint,
  WorkArea.stockCount => l10n.areaStockCountHint,
  WorkArea.pickPack => l10n.areaPickPackHint,
};

IconData workAreaIcon(WorkArea a) => switch (a) {
  WorkArea.inbound => Icons.local_shipping_outlined,
  WorkArea.inspection => Icons.fact_check_outlined,
  WorkArea.stockMove => Icons.swap_horiz,
  WorkArea.stockCount => Icons.inventory_outlined,
  WorkArea.pickPack => Icons.shopping_basket_outlined,
};

String assignedTypeText(AppLocalizations l10n, String type) => switch (type) {
  'PICK' => l10n.typePick,
  'PACK' => l10n.typePack,
  'RETURN' => l10n.typeReturn,
  'REPLENISH' => l10n.typeReplenish,
  'MOVE' => l10n.typeMove,
  'RECEIVE' => l10n.typeReceive,
  'PUTAWAY' => l10n.typePutaway,
  'INSPECT' => l10n.typeInspect,
  'RETURN_INSPECT' => l10n.typeReturnInspect,
  'RETURN_RECEIPT' => l10n.typeReturnReceipt,
  'CYCLE_COUNT' => l10n.typeCycleCount,
  _ => type,
};

/// 작업을 끝내고 근무 화면으로 돌아간다. 근무 상태를 새로 만들어 서버에 다음 작업을 다시 받는다.
/// (작업 화면 사이에 교체(pushReplacement)가 있으면 근무 화면의 push 완료를 믿을 수 없어서.)
void backToSession(BuildContext context, WorkArea area) {
  ProviderScope.containerOf(
    context,
    listen: false,
  ).invalidate(workSessionProvider(area));
  context.go('/work/${area.name}');
}

/// 권한이 없을 때 띄운다.
Future<void> showNoPermission(BuildContext context, String what) {
  final l10n = AppLocalizations.of(context);
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      key: const ValueKey('no-permission'),
      icon: const Icon(Icons.lock_outline),
      title: Text(l10n.noPermissionTitle),
      content: Text(l10n.noPermissionBody(what)),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.confirmOk),
        ),
      ],
    ),
  );
}

/// 메인(모든 작업자 공통). 작업 목록은 없다 — 업무를 고르고 준비 완료를 누르면 서버가 작업을 준다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _breakBusy = false;

  Future<void> _toggleBreak(WorkerProfile me) async {
    final l10n = AppLocalizations.of(context);
    setState(() => _breakBusy = true);
    try {
      await setOnBreak(ref, on: !me.onBreak);
    } on PmartFailure {
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(l10n.breakFailed)));
      }
    } finally {
      if (mounted) setState(() => _breakBusy = false);
    }
  }

  /// 휴게 중에 업무를 누르면: 안내 + 바로 휴게 끝내기.
  Future<void> _onBreakDialog(WorkerProfile me) async {
    final l10n = AppLocalizations.of(context);
    final end = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('on-break-dialog'),
        icon: const Icon(Icons.coffee_outlined),
        content: Text(l10n.readyBlockedByBreak),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const ValueKey('end-break'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.breakEnd),
          ),
        ],
      ),
    );
    if (end ?? false) await _toggleBreak(me);
  }

  /// 교대·자리 비움. 확인한 뒤 서버 세션을 끝내고 로그인 화면으로 간다(라우터가 보낸다).
  Future<void> _logout() async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('logout-dialog'),
        content: Text(l10n.logoutConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const ValueKey('logout-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.logout),
          ),
        ],
      ),
    );
    if (ok ?? false) await ref.read(authControllerProvider.notifier).logout();
  }

  void _menu(WorkerProfile me, PdaMenu m, String label, VoidCallback go) {
    if (!me.canUse(m)) {
      unawaited(showNoPermission(context, label));
      return;
    }
    go();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.homeTitle),
        // 오늘 업무 내역 칩(사용자 2026-11-17). 근무 센터가 정해졌을 때만(내역 조회에 센터가 필요).
        bottom: ref.watch(centerScopeProvider) is SingleCenter
            ? const MyWorkBar()
            : null,
        actions: [
          if (mock)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Chip(label: Text(l10n.mockModeBadge)),
            ),
          IconButton(
            key: const ValueKey('logout'),
            tooltip: l10n.logout,
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      // 역할이 아직 없으면(권한 승인 대기) 업무 API 가 403 이다 — 조회 오류 대신 이유를 먼저 알린다.
      bottomNavigationBar:
          (ref.watch(employeeSessionProvider)?.awaitingGrant ?? false)
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  l10n.awaitingGrant,
                  key: const ValueKey('awaiting-grant'),
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            )
          : null,
      // 근무 센터가 하나가 아니면 업무 API 를 부르지 않는다(요청 경로의 센터를 정할 수 없다).
      body:
          switch (ref.watch(centerScopeProvider)) {
            SingleCenter() => null,
            // 권한 승인 대기면 아래 줄 안내가 이유다.
            NoCenter()
                when ref.watch(employeeSessionProvider)?.awaitingGrant ??
                    false =>
              const SizedBox.shrink(),
            NoCenter() => _CenterNotice(l10n.noCenter),
            MultipleCenters() => _CenterNotice(l10n.multipleCenters),
          } ??
          _withManage(
            ref.watch(employeeSessionProvider)?.isSupervisor ?? false,
            UiStateView<WorkerProfile>(
              state: uiStateOf(ref.watch(meProvider)),
              onRetry: () => ref.invalidate(meProvider),
              ready: (context, me) => SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        l10n.homeHello(me.displayName ?? me.workerId),
                        style: theme.textTheme.titleLarge,
                      ),
                      Text(
                        me.onBreak ? l10n.statusOnBreak : l10n.statusReady,
                        key: const ValueKey('worker-status'),
                        style: theme.textTheme.bodyLarge?.copyWith(
                          color: me.onBreak
                              ? theme.colorScheme.error
                              : theme.colorScheme.primary,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(l10n.chooseArea, style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      for (final a in WorkArea.values)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _AreaTile(
                              area: a,
                              allowed: me.can(a),
                              onTap: () {
                                if (!me.can(a)) {
                                  unawaited(
                                    showNoPermission(
                                      context,
                                      workAreaText(l10n, a),
                                    ),
                                  );
                                  return;
                                }
                                if (me.onBreak) {
                                  unawaited(_onBreakDialog(me));
                                  return;
                                }
                                // 고르면 바로 그 업무의 작업 순서 안내로.
                                context.push('/work/${a.name}/guide');
                              },
                            ),
                          ),
                        ),
                      Row(
                        children: [
                          _MenuButton(
                            key: const ValueKey('menu-handover'),
                            icon: Icons.inventory_2_outlined,
                            label: l10n.handoverChecksMenu,
                            allowed: me.canUse(PdaMenu.handoverCheck),
                            onTap: () => _menu(
                              me,
                              PdaMenu.handoverCheck,
                              l10n.handoverChecksMenu,
                              () => context.push('/handover-checks'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          _MenuButton(
                            key: const ValueKey('menu-printer'),
                            icon: Icons.print_outlined,
                            label: l10n.printerMenu,
                            allowed: me.canUse(PdaMenu.printerSettings),
                            onTap: () => _menu(
                              me,
                              PdaMenu.printerSettings,
                              l10n.printerSettingsTitle,
                              () => context.push('/settings/printer'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // 재고 확인 — 시작 메뉴와 같은 화면(사용자 2026-11-17 "홈 아래 메뉴줄에도").
                          _MenuButton(
                            key: const ValueKey('menu-stock'),
                            icon: Icons.manage_search,
                            label: l10n.stockCheckMenu,
                            allowed: true,
                            onTap: () => context.push('/stock-check'),
                          ),
                          const SizedBox(width: 8),
                          _MenuButton(
                            key: const ValueKey('menu-break'),
                            icon: me.onBreak
                                ? Icons.play_circle_outline
                                : Icons.coffee_outlined,
                            label: me.onBreak ? l10n.breakEnd : l10n.breakStart,
                            allowed: me.canUse(PdaMenu.rest),
                            onTap: _breakBusy ? null : () => _toggleBreak(me),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
    );
  }

  /// 센터 관리자면 관리 메뉴를 위에 더한다(사용자 2026-11-16 "관리 메뉴 + 작업 업무").
  /// 작업자 정보 조회가 실패해도(작업자로 등록되지 않은 관리자) 관리 메뉴는 보인다.
  Widget _withManage(bool supervisor, Widget worker) {
    if (!supervisor) return worker;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: _ManageMenu(),
        ),
        Expanded(child: worker),
      ],
    );
  }
}

/// 근무 센터가 하나가 아닐 때 홈 안내(업무 화면으로 보내지 않는다).
class _CenterNotice extends StatelessWidget {
  const _CenterNotice(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          text,
          key: const ValueKey('center-notice'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
      ),
    ),
  );
}

/// 관리 메뉴(센터 관리자만). 조회 화면 — 배정·설정은 MFC 백오피스.
class _ManageMenu extends StatelessWidget {
  const _ManageMenu();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      key: const ValueKey('manage-menu'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.manageTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        // 2×2 — 작은 화면에서도 글자가 잘리지 않게.
        Row(
          children: [
            _MenuButton(
              key: const ValueKey('manage-tasks'),
              icon: Icons.assignment_outlined,
              label: l10n.manageTasks,
              allowed: true,
              onTap: () => context.push('/manage/tasks'),
            ),
            const SizedBox(width: 8),
            _MenuButton(
              key: const ValueKey('manage-workers'),
              icon: Icons.groups_outlined,
              label: l10n.manageWorkers,
              allowed: true,
              onTap: () => context.push('/manage/workers'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            _MenuButton(
              key: const ValueKey('manage-moves'),
              icon: Icons.swap_horiz,
              label: l10n.manageMoves,
              allowed: true,
              onTap: () => context.push('/manage/moves'),
            ),
            const SizedBox(width: 8),
            _MenuButton(
              key: const ValueKey('manage-counts'),
              icon: Icons.fact_check_outlined,
              label: l10n.manageCounts,
              allowed: true,
              onTap: () => context.push('/manage/counts'),
            ),
          ],
        ),
        const Divider(height: 24),
      ],
    );
  }
}

class _AreaTile extends StatelessWidget {
  const _AreaTile({
    required this.area,
    required this.allowed,
    required this.onTap,
  });

  final WorkArea area;
  final bool allowed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return MenuTile(
      key: ValueKey('area-${area.name}'),
      icon: workAreaIcon(area),
      title: workAreaText(l10n, area),
      hint: workAreaHint(l10n, area),
      allowed: allowed,
      onTap: onTap,
    );
  }
}

class _MenuButton extends StatelessWidget {
  const _MenuButton({
    super.key,
    required this.icon,
    required this.label,
    required this.allowed,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool allowed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Expanded(
    child: OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(64),
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
      onPressed: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(allowed ? icon : Icons.lock_outline),
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    ),
  );
}

/// 업무 설명 한 장(스크롤 없음). 확인을 누르면 작업을 받을 수 있다고 서버에 알린다(다음 작업 받기).
class WorkGuideScreen extends StatelessWidget {
  const WorkGuideScreen({super.key, required this.area});

  final WorkArea area;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    // 단계마다 픽토그램(아이콘)과 한 줄 안내.
    final steps = switch (area) {
      WorkArea.inbound => [
        (Icons.local_shipping, l10n.guideInbound1),
        (Icons.qr_code_scanner, l10n.guideInbound2),
        (Icons.format_list_numbered, l10n.guideInbound3),
        (Icons.report_problem_outlined, l10n.guideInbound4),
      ],
      WorkArea.inspection => [
        (Icons.qr_code_scanner, l10n.guideInspection1),
        (Icons.event_available, l10n.guideInspection2),
        (Icons.health_and_safety_outlined, l10n.guideInspection3),
        (Icons.recycling, l10n.guideInspection4),
      ],
      WorkArea.stockMove => [
        (Icons.shelves, l10n.guideStockMove1),
        (Icons.move_down, l10n.guideStockMove2),
        (Icons.sync_alt, l10n.guideStockMove3),
        (Icons.report_problem_outlined, l10n.guideStockMove4),
      ],
      WorkArea.stockCount => [
        (Icons.place_outlined, l10n.guideStockCount1),
        (Icons.numbers, l10n.guideStockCount2),
        (Icons.visibility_outlined, l10n.guideStockCount3),
        (Icons.verified_user_outlined, l10n.guideStockCount4),
      ],
      WorkArea.pickPack => [
        (Icons.shelves, l10n.guidePickPack1),
        (Icons.shopping_cart_checkout, l10n.guidePickPack2),
        (Icons.report_problem_outlined, l10n.guidePickPack3),
        (Icons.inventory_2_outlined, l10n.guidePickPack4),
      ],
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.guideTitle(workAreaText(l10n, area)))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            key: const ValueKey('guide'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.guideLead,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              Expanded(
                child: Column(
                  children: [
                    for (final (i, (icon, text)) in steps.indexed) ...[
                      if (i > 0)
                        Icon(
                          Icons.arrow_downward,
                          size: 20,
                          color: theme.colorScheme.outline,
                        ),
                      Expanded(
                        child: _GuideStep(n: i + 1, icon: icon, text: text),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Card(
                margin: EdgeInsets.zero,
                color: theme.colorScheme.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(l10n.guideCommon),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const ValueKey('guide-ok'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(64),
                  textStyle: theme.textTheme.titleLarge,
                ),
                onPressed: () => context.pushReplacement('/work/${area.name}'),
                child: Text(l10n.guideOk),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 근무 중 화면. 서버가 준 작업 하나를 보이고, 끝내고 돌아오면 다음 작업을 다시 받는다.
class WorkSessionScreen extends ConsumerWidget {
  const WorkSessionScreen({super.key, required this.area});

  final WorkArea area;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(workSessionProvider(area));
    final ctl = ref.read(workSessionProvider(area).notifier);

    Widget center(List<Widget> children) => Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );

    final body = switch (s.phase) {
      SessionPhase.pulling => center([
        const Center(child: CircularProgressIndicator()),
        const SizedBox(height: 16),
        Text(
          l10n.sessionPulling,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
      ]),
      SessionPhase.unknown => center([
        Text(
          l10n.sessionUnknown,
          key: const ValueKey('session-unknown'),
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('session-retry'),
          onPressed: ctl.pull,
          child: Text(l10n.checkAgain),
        ),
      ]),
      SessionPhase.unavailable => center([
        Icon(
          s.code == WorkProblemCode.noTaskAvailable
              ? Icons.hourglass_empty
              : Icons.block,
          size: 56,
        ),
        const SizedBox(height: 12),
        Text(
          switch (s.code) {
            WorkProblemCode.noTaskAvailable => l10n.nextNoTask,
            WorkProblemCode.onBreak => l10n.nextOnBreak,
            WorkProblemCode.offShift => l10n.nextOffShift,
            WorkProblemCode.dailyNotEnrolled => l10n.nextNotEnrolled,
            WorkProblemCode.workAreaNotAllowed => l10n.nextWorkAreaNotAllowed,
            _ => l10n.nextNotAllowed,
          },
          key: const ValueKey('session-unavailable'),
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('session-retry'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
          onPressed: ctl.pull,
          child: Text(l10n.nextRetry),
        ),
      ]),
      SessionPhase.assigned => _AssignedView(
        area: area,
        task: s.task!,
        onRun: () async {
          await context.push(s.task!.route!);
          // 작업 화면에서 돌아오면 서버에 다음 작업을 다시 받는다(끝나지 않았으면 같은 작업).
          await ctl.pull();
        },
        onRetry: ctl.pull,
      ),
    };

    return Scaffold(
      appBar: AppBar(
        title: Text(workAreaText(l10n, area)),
        automaticallyImplyLeading: false,
        bottom: const MyWorkBar(),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: body),
              const SizedBox(height: 8),
              OutlinedButton(
                key: const ValueKey('session-end'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                onPressed: () => context.go('/'),
                child: Text(l10n.sessionEnd),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssignedView extends StatelessWidget {
  const _AssignedView({
    required this.area,
    required this.task,
    required this.onRun,
    required this.onRetry,
  });

  final WorkArea area;
  final AssignedTask task;
  final Future<void> Function() onRun;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      key: ValueKey('assigned-${task.taskId}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.sessionNow, style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Row(
          children: [
            Text(
              assignedTypeText(l10n, task.taskType),
              key: const ValueKey('assigned-type'),
              style: theme.textTheme.headlineMedium,
            ),
            if (task.urgent) ...[
              const SizedBox(width: 8),
              Chip(label: Text(l10n.urgent)),
            ],
          ],
        ),
        if (task.promisedReadyAt case final t?)
          Text(
            task.taskType == 'RECEIVE'
                ? l10n.inboundPlannedAt(formatSeoulTime(t))
                : l10n.promisedReadyAt(formatSeoulTime(t)),
          ),
        if (!area.taskTypes.contains(task.taskType))
          Text(
            l10n.areaMismatch,
            key: const ValueKey('area-mismatch'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        const SizedBox(height: 12),
        // 받은 작업의 상품을 전부 보인다("외 N개" 없이).
        Expanded(
          child: ListView(
            key: const ValueKey('assigned-lines'),
            children: [
              for (final l in task.lines)
                Card(
                  child: ListTile(
                    title: Text(l.productName ?? l.sku ?? '-'),
                    subtitle: Text(
                      [
                        if (l.boxes case final b?) l10n.boxesUnit(b),
                        if (l.qty case final q?) l10n.qtyUnit(q),
                        ?l.fromLocation,
                        if (l.toLocation case final t?) '→ $t',
                        ?l.notice,
                      ].join(' · '),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (!task.detailAvailable) Text(l10n.detailUnavailable),
        const SizedBox(height: 8),
        if (task.runnable)
          CommandButton(
            key: const ValueKey('run-task'),
            label: l10n.runTask,
            onPressed: onRun,
          )
        else ...[
          Text(
            l10n.taskScreenNotYet,
            key: const ValueKey('task-not-runnable'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: onRetry, child: Text(l10n.checkAgain)),
        ],
      ],
    );
  }
}

/// 안내 한 단계: 번호 + 픽토그램 + 한 줄.
class _GuideStep extends StatelessWidget {
  const _GuideStep({required this.n, required this.icon, required this.text});

  final int n;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Card(
      key: ValueKey('guide-step-$n'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(icon, size: 40, color: scheme.onPrimaryContainer),
                ),
                Positioned(
                  left: -6,
                  top: -6,
                  child: CircleAvatar(
                    radius: 12,
                    backgroundColor: scheme.primary,
                    foregroundColor: scheme.onPrimary,
                    child: Text('$n', style: theme.textTheme.labelLarge),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                text,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
