import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../auth/presentation/auth_controller.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/field_widgets.dart' show NoticeBox, StepCaption;
import '../../../shared/pda_theme.dart';
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
    if (!me.onBreak) {
      // 휴게 시작은 센터 관리자 번호가 있어야 한다 — 번호 창이 서버 확인까지 맡는다.
      await showDialog<void>(
        context: context,
        builder: (_) => BreakPinDialog(onSubmit: (pin) => startBreak(ref, pin)),
      );
      return;
    }
    final l10n = AppLocalizations.of(context);
    setState(() => _breakBusy = true);
    try {
      await endBreak(ref);
    } on PmartFailure catch (f) {
      // 근무에 정해진 자동 휴게는 센터 관리자만 일찍 끝낸다(409 AUTO_BREAK_SUPERVISOR_ONLY).
      final auto =
          f is ProblemFailure &&
          f.problem.code == BreakProblemCode.autoBreakSupervisorOnly;
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(
                auto ? l10n.breakAutoSupervisorOnly : l10n.breakFailed,
              ),
            ),
          );
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
              // 첫 화면: 인사·상태 → 업무 같은 크기 2열 → 맨 아래 고정 도구 줄.
              ready: (context, me) {
                void openArea(WorkArea a) {
                  if (!me.can(a)) {
                    unawaited(showNoPermission(context, workAreaText(l10n, a)));
                    return;
                  }
                  if (me.onBreak) {
                    unawaited(_onBreakDialog(me));
                    return;
                  }
                  // 고르면 바로 그 업무의 작업 순서 안내로.
                  context.push('/guide/${a.name}');
                }

                // 피패킹이 주 업무라 맨 앞(크기는 같다).
                const areas = [
                  WorkArea.pickPack,
                  WorkArea.inbound,
                  WorkArea.inspection,
                  WorkArea.stockMove,
                  WorkArea.stockCount,
                ];
                final tools = Row(
                  children: [
                    _ToolButton(
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
                    // 반납 인증번호 — 라이더가 회수품을 가져오면 알려 줄 번호(rider-app 요청 2026-11-18).
                    _ToolButton(
                      key: const ValueKey('menu-return-handover'),
                      icon: Icons.assignment_return_outlined,
                      label: l10n.returnHandoverMenu,
                      allowed: me.canUse(PdaMenu.returnHandover),
                      onTap: () => _menu(
                        me,
                        PdaMenu.returnHandover,
                        l10n.returnHandoverMenu,
                        () => context.push('/return-handovers'),
                      ),
                    ),
                    _ToolButton(
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
                    // 재고 확인 — 시작 메뉴와 같은 화면(사용자 2026-11-17 "홈 아래 메뉴줄에도").
                    _ToolButton(
                      key: const ValueKey('menu-stock'),
                      icon: Icons.manage_search,
                      label: l10n.stockCheckMenu,
                      allowed: true,
                      onTap: () => context.push('/stock-check'),
                    ),
                    _ToolButton(
                      key: const ValueKey('menu-break'),
                      icon: me.onBreak
                          ? Icons.play_circle_outline
                          : Icons.coffee_outlined,
                      label: me.onBreak ? l10n.breakEnd : l10n.breakStart,
                      allowed: me.canUse(PdaMenu.rest),
                      onTap: _breakBusy ? null : () => _toggleBreak(me),
                    ),
                  ],
                );
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Expanded(
                                child: Text(
                                  l10n.homeHello(me.displayName ?? me.workerId),
                                  style: theme.textTheme.headlineSmall
                                      ?.copyWith(
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: -1.2,
                                      ),
                                ),
                              ),
                              Text(
                                me.onBreak
                                    ? l10n.statusOnBreak
                                    : l10n.statusReady,
                                key: const ValueKey('worker-status'),
                                style: theme.textTheme.labelMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: me.onBreak
                                      ? theme.colorScheme.error
                                      : PdaColors.muted,
                                ),
                              ),
                            ],
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(2, 18, 0, 8),
                            child: Text(
                              l10n.chooseWork,
                              style: theme.textTheme.labelLarge?.copyWith(
                                color: PdaColors.muted,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          // 업무는 모두 같은 크기(사용자 2026-11-19) — 2열, 고르면 그 칸이 커지며 안내 화면 위 카드가 된다.
                          for (var r = 0; r < areas.length; r += 2)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                children: [
                                  for (var c = r; c < r + 2; c++) ...[
                                    if (c > r) const SizedBox(width: 8),
                                    Expanded(
                                      child: c < areas.length
                                          ? _AreaTile(
                                              area: areas[c],
                                              allowed: me.can(areas[c]),
                                              onTap: () => openArea(areas[c]),
                                            )
                                          : const SizedBox.shrink(),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                    // 도구 줄은 기종과 상관없이 화면 맨 아래(사용자 2026-11-19) — 아래 시스템 막대 위로 띄운다.
                    DecoratedBox(
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        border: Border(top: BorderSide(color: PdaColors.line)),
                      ),
                      child: SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(8, 4, 8, 6),
                          child: tools,
                        ),
                      ),
                    ),
                  ],
                );
              },
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

/// 업무를 고른 뒤 안내 화면 위 큰 카드 — 첫 화면 칸이 [Hero] 로 커져 이 카드가 된다.
class AreaHeroCard extends StatelessWidget {
  const AreaHeroCard({super.key, required this.area});

  final WorkArea area;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Hero(
      tag: 'area-card-${area.name}',
      flightShuttleBuilder: _areaShuttle(area),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(17),
          side: const BorderSide(color: PdaColors.lilac, width: 1.5),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.all(15),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      workAreaText(l10n, area),
                      key: const ValueKey('area-hero-title'),
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: -1.5,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      workAreaDesc(l10n, area),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: PdaColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 84,
                height: 84,
                decoration: const BoxDecoration(
                  color: PdaColors.softer,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  workAreaIcon(area),
                  size: 46,
                  color: PdaColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 칸 → 큰 카드로 커지는 동안 그리는 모습. 그림은 칸 자리(가운데 위, 52)에서 카드 자리(오른쪽, 84)로
/// 크기와 함께 이어서 움직이고, 칸 이름은 흐려지며 카드 제목·설명이 나타난다(사용자 2026-11-19
/// "픽토그램도 전후 움직임 끊기지 않게"). 돌아갈 때는 같은 길을 거꾸로.
HeroFlightShuttleBuilder _areaShuttle(WorkArea area) =>
    (_, animation, _, _, _) => _AreaFlight(area: area, animation: animation);

class _AreaFlight extends StatelessWidget {
  const _AreaFlight({required this.area, required this.animation});

  final WorkArea area;
  final Animation<double> animation;

  // 칸([_AreaTile])과 카드([AreaHeroCard])의 치수 — 두 쪽을 바꾸면 여기도 맞춘다.
  static const _tileCircle = 52.0;
  static const _tileIcon = 28.0;
  static const _tileCircleCenterY = 40.0; // (112 - 84) / 2 + 52 / 2
  static const _tileLabelTop = 76.0;
  static const _cardCircle = 84.0;
  static const _cardIcon = 46.0;
  static const _cardPad = 15.0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) {
        final t = Curves.easeInOutCubic.transform(animation.value);
        double lerp(double a, double b) => a + (b - a) * t;
        final tileText = (1 - t * 2).clamp(0.0, 1.0);
        final cardText = (t * 2 - 1).clamp(0.0, 1.0);
        return Material(
          color: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(lerp(14, 17)),
            side: BorderSide(
              color: Color.lerp(PdaColors.line, PdaColors.lilac, t)!,
              width: lerp(1, 1.5),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: LayoutBuilder(
            builder: (context, c) {
              final w = c.maxWidth;
              final h = c.maxHeight;
              final d = lerp(_tileCircle, _cardCircle);
              final cx = lerp(w / 2, w - _cardPad - _cardCircle / 2);
              final cy = lerp(_tileCircleCenterY, h / 2);
              return Stack(
                children: [
                  if (tileText > 0)
                    Positioned(
                      left: 0,
                      right: 0,
                      top: _tileLabelTop,
                      child: Opacity(
                        opacity: tileText,
                        child: Text(
                          workAreaText(l10n, area),
                          textAlign: TextAlign.center,
                          maxLines: 1,
                          overflow: TextOverflow.clip,
                          style: const TextStyle(
                            color: PdaColors.ink,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  if (cardText > 0)
                    Positioned(
                      left: _cardPad,
                      right: d + _cardPad * 2,
                      top: 0,
                      bottom: 0,
                      child: Opacity(
                        opacity: cardText,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              workAreaText(l10n, area),
                              maxLines: 1,
                              overflow: TextOverflow.clip,
                              softWrap: false,
                              style: theme.textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                                letterSpacing: -1.5,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              workAreaDesc(l10n, area),
                              maxLines: 2,
                              overflow: TextOverflow.clip,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: PdaColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  Positioned(
                    left: cx - d / 2,
                    top: cy - d / 2,
                    width: d,
                    height: d,
                    child: Container(
                      decoration: const BoxDecoration(
                        color: PdaColors.softer,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        workAreaIcon(area),
                        size: lerp(_tileIcon, _cardIcon),
                        color: PdaColors.primary,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

/// 업무 한 줄 설명(안내 화면 위 카드).
String workAreaDesc(AppLocalizations l10n, WorkArea a) => switch (a) {
  WorkArea.pickPack => l10n.featuredPickPack,
  WorkArea.inbound => l10n.areaDescInbound,
  WorkArea.inspection => l10n.areaDescInspection,
  WorkArea.stockMove => l10n.areaDescStockMove,
  WorkArea.stockCount => l10n.areaDescStockCount,
};

/// 업무 칸 — 모두 같은 크기, 위 그림 + 아래 이름. 권한이 없으면 자물쇠.
/// 고르면 [Hero] 로 커지며 안내 화면 위 카드([AreaHeroCard])가 된다.
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
    return Hero(
      tag: 'area-card-${area.name}',
      flightShuttleBuilder: _areaShuttle(area),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: PdaColors.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey('area-${area.name}'),
          onTap: onTap,
          child: SizedBox(
            height: 112,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: const BoxDecoration(
                    color: PdaColors.softer,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    allowed ? workAreaIcon(area) : Icons.lock_outline,
                    size: 28,
                    color: allowed ? PdaColors.primary : PdaColors.muted,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  workAreaText(l10n, area),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: PdaColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: const BorderSide(color: PdaColors.line),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 62),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: PdaColors.softer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: PdaColors.primary),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    height: 1.25,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// 관리 메뉴 칸(센터 관리자) — 기타 업무 칸과 같은 모양.
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
    child: _Tile(
      icon: allowed ? icon : Icons.lock_outline,
      label: label,
      onTap: onTap,
    ),
  );
}

/// 아래 도구 줄(시안 tools) — 작은 그림 + 이름.
class _ToolButton extends StatelessWidget {
  const _ToolButton({
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
    child: InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(allowed ? icon : Icons.lock_outline, color: PdaColors.muted),
            const SizedBox(height: 4),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: PdaColors.muted),
            ),
          ],
        ),
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
              AreaHeroCard(area: area),
              const SizedBox(height: 12),
              // 업무 카드 아래 회색 한 줄 + 번호를 선으로 이은 단계 목록.
              Text(
                l10n.guideLead,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: PdaColors.muted,
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: Column(
                  children: [
                    for (final (i, (icon, text)) in steps.indexed)
                      Expanded(
                        child: _GuideStep(
                          n: i + 1,
                          icon: icon,
                          text: text,
                          last: i == steps.length - 1,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              NoticeBox(text: l10n.guideCommon),
              const SizedBox(height: 12),
              FilledButton(
                key: const ValueKey('guide-ok'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(64),
                  textStyle: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
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
            WorkProblemCode.workerNotActive => l10n.nextWorkerNotActive,
            WorkProblemCode.workerNotRegistered => l10n.nextWorkerNotRegistered,
            WorkProblemCode.configRequired => l10n.nextConfigRequired,
            ProblemCode.forbidden => l10n.nextForbidden,
            _ => l10n.nextNotAllowed,
          },
          key: const ValueKey('session-unavailable'),
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
        // 서버 코드 — 관리자가 원인을 바로 찾게(작업 없음은 빼고).
        if (s.code case final code?
            when code != WorkProblemCode.noTaskAvailable) ...[
          const SizedBox(height: 4),
          Text(
            l10n.nextReasonCode(code),
            key: const ValueKey('session-unavailable-code'),
            style: theme.textTheme.bodySmall,
          ),
        ],
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
        StepCaption(l10n.sessionNow),
        Row(
          children: [
            Text(
              assignedTypeText(l10n, task.taskType),
              key: const ValueKey('assigned-type'),
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -1.2,
              ),
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
            style: theme.textTheme.bodyMedium?.copyWith(
              color: PdaColors.primary,
              fontWeight: FontWeight.w800,
            ),
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
          child: Card(
            margin: EdgeInsets.zero,
            child: ListView.separated(
              key: const ValueKey('assigned-lines'),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              itemCount: task.lines.length,
              separatorBuilder: (_, _) => const Divider(),
              itemBuilder: (_, i) {
                final l = task.lines[i];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    l.productName ?? l.sku ?? '-',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(
                    [
                      if (l.boxes case final b?) l10n.boxesUnit(b),
                      if (l.qty case final q?) l10n.qtyUnit(q),
                      ?l.fromLocation,
                      if (l.toLocation case final t?) '→ $t',
                      ?l.notice,
                    ].join(' · '),
                    style: const TextStyle(color: PdaColors.muted),
                  ),
                );
              },
            ),
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
/// 안내 한 단계(시안 flow) — 왼쪽 번호 원(아래로 선), 옅은 보라 그림 칸, 한 줄 안내. 아래 구분선.
class _GuideStep extends StatelessWidget {
  const _GuideStep({
    required this.n,
    required this.icon,
    required this.text,
    required this.last,
  });

  final int n;
  final IconData icon;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      key: ValueKey('guide-step-$n'),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: PdaColors.line)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 31,
            child: Stack(
              alignment: Alignment.center,
              children: [
                if (!last)
                  const Positioned(
                    top: 0,
                    bottom: 0,
                    left: 11,
                    child: SizedBox(
                      width: 1,
                      child: ColoredBox(color: PdaColors.lilac),
                    ),
                  ),
                Positioned(
                  left: 0,
                  child: Container(
                    width: 23,
                    height: 23,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: PdaColors.softer,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '$n',
                      style: const TextStyle(
                        color: PdaColors.primary,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: PdaColors.softer,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, size: 30, color: PdaColors.primary),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              text,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w700,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 휴게 시작 — 센터 관리자 4자리 번호(로그인 비밀번호 아님). 서버가 받아야 닫힌다.
/// 번호는 이 창 안에만 두고 저장·기록하지 않는다. 틀리면 지우고 다시 입력.
class BreakPinDialog extends StatefulWidget {
  const BreakPinDialog({required this.onSubmit, super.key});

  final Future<BreakStartOutcome> Function(String pin) onSubmit;

  @override
  State<BreakPinDialog> createState() => _BreakPinDialogState();
}

class _BreakPinDialogState extends State<BreakPinDialog> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  /// 잠김·미설정·서버 미지원 — 더 받지 않는다.
  bool _closed = false;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (_pin.text.length != 4 || _busy || _closed) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    BreakStartOutcome? outcome;
    try {
      outcome = await widget.onSubmit(_pin.text);
    } on PmartFailure {
      outcome = null;
    }
    if (!mounted) return;
    _pin.clear();
    switch (outcome) {
      case BreakStarted():
        Navigator.of(context).pop();
      case BreakRejected(
        :final code,
        :final remainingAttempts,
        :final lockedUntil,
      ):
        setState(() {
          _busy = false;
          _closed =
              code == BreakProblemCode.pinLocked ||
              code == BreakProblemCode.pinNotSet;
          _error = switch (code) {
            BreakProblemCode.pinInvalid => switch (remainingAttempts) {
              final n? => l10n.breakPinWrongLeft(n),
              null => l10n.breakPinWrong,
            },
            BreakProblemCode.pinLocked => switch (lockedUntil) {
              final u? => l10n.breakPinLockedUntil(formatSeoulTime(u)),
              null => l10n.breakPinLocked,
            },
            BreakProblemCode.pinNotSet => l10n.breakPinNotSet,
            _ => l10n.breakFailed,
          };
        });
      case null:
        setState(() {
          _busy = false;
          _error = l10n.breakFailed;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final ready = _pin.text.length == 4 && !_busy && !_closed;
    return AlertDialog(
      key: const ValueKey('break-pin-dialog'),
      icon: const Icon(Icons.lock_outline),
      title: Text(l10n.breakPinTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.breakPinHelp),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('break-pin'),
            controller: _pin,
            enabled: !_busy && !_closed,
            autofocus: true,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            maxLength: 4,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: Theme.of(context).textTheme.headlineSmall,
            decoration: const InputDecoration(counterText: ''),
            onChanged: (_) => setState(() => _error = null),
            onSubmitted: (_) => _submit(),
          ),
          if (_error case final e?) ...[
            const SizedBox(height: 8),
            Text(
              e,
              key: const ValueKey('break-pin-error'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          key: const ValueKey('break-pin-cancel'),
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const ValueKey('break-pin-ok'),
          onPressed: ready ? _submit : null,
          child: Text(l10n.breakPinOk),
        ),
      ],
    );
  }
}
