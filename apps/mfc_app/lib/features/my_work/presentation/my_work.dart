import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../tasks/domain/task_list.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../../tasks/presentation/tasks_screen.dart'
    show taskKindText, taskStateText;

/// 내 오늘 업무 내역(사용자 2026-11-17 "작업자마다 본인의 금일 작업내용을 체크").
/// fulfillment `GET /tasks?assignee=me&state=COMPLETED,CLOSED_PARTIAL,IN_PROGRESS` 에서
/// 마지막 실적 시각(`lastActivityAt`)이 오늘(서울)인 것만 고른다 — 계약에 날짜 거르기가 없다.
/// 입고·검사·이동·실사는 이 목록에 없다(서버에 내 내역 조회가 없음 — handoff 2026-11-17 my-work).
final myTodayWorkProvider = FutureProvider.autoDispose<List<TaskItem>>((
  ref,
) async {
  final list = await ref
      .watch(taskRepositoryProvider)
      .myHistory(ref.watch(currentMfcIdProvider));
  final today = _seoulDate(DateTime.now());
  final items = [
    for (final t in list.tasks)
      if (t.lastActivityAt case final at? when _seoulDate(at) == today) t,
  ]..sort((a, b) => b.lastActivityAt!.compareTo(a.lastActivityAt!));
  return items;
});

(int, int, int) _seoulDate(DateTime instant) {
  final s = toSeoulWallClock(instant);
  return (s.year, s.month, s.day);
}

bool _finished(TaskItem t) =>
    t.state == TaskState.completed || t.state == TaskState.closedPartial;

/// 업무 고르기·업무 진행 화면 맨 위의 작은 바 — "업무 내역" 칩을 누르면 오늘 업무 내역.
/// AppBar `bottom` 에 둔다. 조회 실패는 칩에 건수를 빼고 보일 뿐(내역 화면에서 오류를 보인다).
class MyWorkBar extends ConsumerWidget implements PreferredSizeWidget {
  const MyWorkBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(44);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final done = ref.watch(myTodayWorkProvider).value?.where(_finished).length;
    return SizedBox(
      height: preferredSize.height,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
        child: Row(
          children: [
            ActionChip(
              key: const ValueKey('my-work-chip'),
              avatar: const Icon(Icons.history, size: 18),
              visualDensity: VisualDensity.compact,
              label: Text(
                done == null ? l10n.myWorkChip : l10n.myWorkChipCount(done),
              ),
              onPressed: () => context.push('/my-work'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 오늘 업무 내역 화면.
class MyWorkScreen extends ConsumerWidget {
  const MyWorkScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.myWorkTitle)),
      body: SafeArea(
        child: UiStateView<List<TaskItem>>(
          state: uiStateOf(ref.watch(myTodayWorkProvider)),
          onRetry: () => ref.invalidate(myTodayWorkProvider),
          ready: (context, items) => _MyWorkList(items: items),
        ),
      ),
    );
  }
}

class _MyWorkList extends StatelessWidget {
  const _MyWorkList({required this.items});

  final List<TaskItem> items;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final finished = items.where(_finished).toList();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          key: const ValueKey('my-work-summary'),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: _Stat(
                    label: l10n.myWorkDone,
                    value: l10n.myWorkCount(finished.length),
                  ),
                ),
                Expanded(
                  child: _Stat(
                    label: l10n.myWorkInProgress,
                    value: l10n.myWorkCount(items.length - finished.length),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Text(
              l10n.myWorkEmpty,
              key: const ValueKey('my-work-empty'),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
          ),
        for (final t in items)
          ListTile(
            key: ValueKey('my-work-${t.taskId}'),
            contentPadding: EdgeInsets.zero,
            title: Text(
              t.headlineProduct == null
                  ? taskKindText(l10n, t.kind)
                  : (t.otherLineCount ?? 0) > 0
                  ? l10n.myWorkHeadline(t.headlineProduct!, t.otherLineCount!)
                  : t.headlineProduct!,
            ),
            subtitle: Text(
              [
                taskKindText(l10n, t.kind),
                formatSeoulTime(t.lastActivityAt!),
                if (t.completedQty != null && t.plannedQty != null)
                  l10n.myWorkQty(t.completedQty!, t.plannedQty!),
              ].join(' · '),
            ),
            trailing: Text(
              taskStateText(l10n, t.state),
              style: theme.textTheme.labelLarge?.copyWith(
                color: t.state == TaskState.completed
                    ? scheme.primary
                    : t.state == TaskState.closedPartial
                    ? scheme.error
                    : scheme.onSurfaceVariant,
              ),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          l10n.myWorkScopeNote,
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Text(label, style: theme.textTheme.labelLarge),
        Text(value, style: theme.textTheme.headlineSmall),
      ],
    );
  }
}
