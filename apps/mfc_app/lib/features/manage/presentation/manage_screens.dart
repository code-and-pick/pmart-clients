import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../tasks/domain/task_list.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../../tasks/presentation/tasks_screen.dart'
    show taskKindText, taskStateText;
import '../../work/domain/work.dart';
import '../../work/presentation/work_controller.dart';
import '../../work/presentation/work_screens.dart' show workAreaText;

/// 센터 관리자(`MFC_SUPERVISOR`) PDA 관리 메뉴(사용자 2026-11-16). 조회만 — 판정·배정은 서버와 MFC 백오피스.

/// 작업 현황 거르기. 계약 기본(생략)은 ASSIGNED·IN_PROGRESS.
enum TaskFilter {
  active([TaskState.assigned, TaskState.inProgress]),
  ready([TaskState.ready, TaskState.waiting]),
  blocked([TaskState.blocked]);

  const TaskFilter(this.states);

  final List<TaskState> states;
}

final centerTasksProvider = FutureProvider.autoDispose
    .family<TaskList, TaskFilter>(
      (ref, f) => ref
          .watch(taskRepositoryProvider)
          .centerTasks(ref.watch(currentMfcIdProvider), states: f.states),
    );

final centerWorkersProvider = FutureProvider.autoDispose<List<WorkerProfile>>(
  (ref) => ref
      .watch(workRepositoryProvider)
      .workers(ref.watch(currentMfcIdProvider)),
);

String taskFilterText(AppLocalizations l10n, TaskFilter f) => switch (f) {
  TaskFilter.active => l10n.manageFilterActive,
  TaskFilter.ready => l10n.manageFilterReady,
  TaskFilter.blocked => l10n.manageFilterBlocked,
};

class CenterTasksScreen extends ConsumerStatefulWidget {
  const CenterTasksScreen({super.key});

  @override
  ConsumerState<CenterTasksScreen> createState() => _CenterTasksScreenState();
}

class _CenterTasksScreenState extends ConsumerState<CenterTasksScreen> {
  TaskFilter _filter = TaskFilter.active;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final list = ref.watch(centerTasksProvider(_filter));
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.manageTasks),
        actions: [
          IconButton(
            key: const ValueKey('manage-tasks-refresh'),
            tooltip: l10n.sync,
            onPressed: () => ref.invalidate(centerTasksProvider(_filter)),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: SegmentedButton<TaskFilter>(
              segments: [
                for (final f in TaskFilter.values)
                  ButtonSegment(
                    value: f,
                    label: Text(
                      taskFilterText(l10n, f),
                      key: ValueKey('task-filter-${f.name}'),
                    ),
                  ),
              ],
              selected: {_filter},
              showSelectedIcon: false,
              onSelectionChanged: (s) => setState(() => _filter = s.first),
            ),
          ),
          Expanded(
            child: UiStateView<TaskList>(
              state: uiStateOf(list, isEmpty: (l) => l.tasks.isEmpty),
              onRetry: () => ref.invalidate(centerTasksProvider(_filter)),
              empty: (_) => Center(
                child: Text(
                  l10n.manageNoTasks,
                  key: const ValueKey('manage-tasks-empty'),
                ),
              ),
              ready: (context, data) => ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (!data.assignmentFresh)
                    Text(
                      l10n.manageAssigneeStale,
                      key: const ValueKey('manage-tasks-stale'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  for (final t in data.tasks) _CenterTaskTile(task: t),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CenterTaskTile extends StatelessWidget {
  const _CenterTaskTile({required this.task});

  final TaskItem task;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final headline = switch ((task.headlineProduct, task.otherLineCount)) {
      (final p?, final n?) when n > 0 => l10n.manageHeadlineMore(p, n),
      (final p?, _) => p,
      _ => task.taskId,
    };
    return Card(
      key: ValueKey('center-task-${task.taskId}'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  taskKindText(l10n, task.kind),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                Text(taskStateText(l10n, task.state)),
                const Spacer(),
                if (task.late)
                  _Flag(
                    key: const ValueKey('task-late'),
                    text: l10n.manageLate,
                    color: theme.colorScheme.error,
                  ),
                if (task.idle)
                  _Flag(
                    key: const ValueKey('task-idle'),
                    text: l10n.manageIdle,
                    color: theme.colorScheme.tertiary,
                  ),
              ],
            ),
            Text(headline, style: theme.textTheme.bodyLarge),
            Text(
              [
                task.assigneeId == null
                    ? l10n.manageUnassigned
                    : l10n.manageAssignee(task.assigneeId!),
                if (task.promisedReadyAt case final p?)
                  l10n.promisedReadyAt(formatSeoulTime(p)),
              ].join(' · '),
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _Flag extends StatelessWidget {
  const _Flag({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 4),
    child: DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(text, style: TextStyle(color: color, fontSize: 12)),
      ),
    ),
  );
}

class CenterWorkersScreen extends ConsumerWidget {
  const CenterWorkersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.manageWorkers),
        actions: [
          IconButton(
            key: const ValueKey('manage-workers-refresh'),
            tooltip: l10n.sync,
            onPressed: () => ref.invalidate(centerWorkersProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: UiStateView<List<WorkerProfile>>(
        state: uiStateOf(
          ref.watch(centerWorkersProvider),
          isEmpty: (l) => l.isEmpty,
        ),
        onRetry: () => ref.invalidate(centerWorkersProvider),
        empty: (_) => Center(child: Text(l10n.manageNoWorkers)),
        ready: (context, workers) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              l10n.manageWorkersSummary(
                workers.where((w) => w.active).length,
                workers.where((w) => w.active && w.onBreak).length,
              ),
              key: const ValueKey('manage-workers-summary'),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            for (final w in workers)
              Card(
                key: ValueKey('worker-${w.workerId}'),
                child: ListTile(
                  title: Text(w.displayName ?? w.workerId),
                  subtitle: Text(switch (w.workAreas) {
                    final a? when a.isNotEmpty => [
                      for (final x in WorkArea.values)
                        if (a.contains(x)) workAreaText(l10n, x),
                    ].join(' · '),
                    null => l10n.manageAreasUnknown,
                    _ => l10n.manageNoAreas,
                  }),
                  trailing: Text(
                    !w.active
                        ? l10n.manageWorkerSuspended
                        : w.onBreak
                        ? l10n.statusOnBreak
                        : l10n.manageWorkerOn,
                    style: TextStyle(
                      color: !w.active
                          ? theme.colorScheme.error
                          : w.onBreak
                          ? theme.colorScheme.tertiary
                          : theme.colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
