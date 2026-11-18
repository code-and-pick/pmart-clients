import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../inbound/data/mock_inbound_repository.dart';
import '../../inbound/presentation/inbound_controller.dart';
import '../../quality/data/mock_quality_repository.dart';
import '../../stock_count/data/mock_stock_count_repository.dart';
import '../../stock_move/data/mock_stock_move_repository.dart';
import '../../../shared/field_repositories.dart';
import '../../tasks/data/mock_task_repository.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../data/mock_work_repository.dart';
import '../data/work_repository.dart';
import '../domain/work.dart';

final workRepositoryProvider = Provider<WorkRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockWorkRepository(
      tasks: switch (ref.watch(taskRepositoryProvider)) {
        final MockTaskRepository m => m,
        _ => MockTaskRepository(),
      },
      inbound: switch (ref.watch(inboundRepositoryProvider)) {
        final MockInboundRepository m => m,
        _ => null,
      },
      quality: switch (ref.watch(qualityRepositoryProvider)) {
        final MockQualityRepository m => m,
        _ => null,
      },
      stockMove: switch (ref.watch(stockMoveRepositoryProvider)) {
        final MockStockMoveRepository m => m,
        _ => null,
      },
      stockCount: switch (ref.watch(stockCountRepositoryProvider)) {
        final MockStockCountRepository m => m,
        _ => null,
      },
    ),
    PmartEnv.local => ApiWorkRepository(ref.watch(dioProvider)),
  },
);

/// 작업자 본인(권한·휴게).
final meProvider = FutureProvider.autoDispose<WorkerProfile>(
  (ref) => ref
      .watch(workRepositoryProvider)
      .me(ref.watch(currentMfcIdProvider), ref.watch(currentWorkerIdProvider)),
);

enum SessionPhase { pulling, assigned, unavailable, unknown }

@immutable
class SessionState {
  const SessionState({this.phase = SessionPhase.pulling, this.task, this.code});

  final SessionPhase phase;
  final AssignedTask? task;
  final String? code;

  SessionState copyWith({
    SessionPhase? phase,
    AssignedTask? Function()? task,
    String? Function()? code,
  }) => SessionState(
    phase: phase ?? this.phase,
    task: task != null ? task() : this.task,
    code: code != null ? code() : this.code,
  );
}

/// 업무 하나의 근무. 작업을 끝내고 돌아오면 서버에 다음 작업을 다시 받는다.
final workSessionProvider = NotifierProvider.autoDispose
    .family<WorkSessionController, SessionState, WorkArea>(
      WorkSessionController.new,
    );

class WorkSessionController extends Notifier<SessionState> {
  WorkSessionController(this.area);

  final WorkArea area;

  /// 결과를 모르는 받기의 키. 같은 키로 다시 받는다.
  IdempotencyKey? _pending;

  @override
  SessionState build() {
    Future.microtask(pull);
    return const SessionState();
  }

  Future<void> pull() async {
    if (!ref.mounted) return;
    state = state.copyWith(phase: SessionPhase.pulling);
    final key = _pending ??= IdempotencyKey.generate();
    final outcome = await ref
        .read(workRepositoryProvider)
        .next(
          ref.read(currentMfcIdProvider),
          ref.read(currentWorkerIdProvider),
          area,
          key: key,
        );
    if (!ref.mounted) return;
    switch (outcome) {
      case NextAssigned(:final task):
        _pending = null;
        ref
            .read(knownAssignmentVersionsProvider.notifier)
            .put(task.taskId, task.assignmentVersion);
        state = state.copyWith(
          phase: SessionPhase.assigned,
          task: () => task,
          code: () => null,
        );
      case NextUnavailable(:final code):
        _pending = null;
        state = state.copyWith(
          phase: SessionPhase.unavailable,
          task: () => null,
          code: () => code,
        );
      case NextUnknown():
        state = state.copyWith(phase: SessionPhase.unknown);
    }
  }
}

/// 휴게 시작·끝. 끝나면 본인 정보를 다시 읽는다.
Future<void> setOnBreak(WidgetRef ref, {required bool on}) async {
  final repo = ref.read(workRepositoryProvider);
  final mfc = ref.read(currentMfcIdProvider);
  final me = ref.read(currentWorkerIdProvider);
  final key = IdempotencyKey.generate();
  if (on) {
    await repo.startBreak(mfc, me, key: key);
  } else {
    await repo.endBreak(mfc, me, key: key);
  }
  ref.invalidate(meProvider);
}

/// 피킹을 끝내고 패킹대로 — 서버에 다음 작업을 받아, 패킹이면 바로 그 패킹을 연다.
/// 다른 작업이면 근무 화면이 보인다(같은 주문 패킹을 피킹한 사람에게 주는지는 BR-52 R20).
Future<void> continueToPack(BuildContext context, WidgetRef ref) async {
  final outcome = await ref
      .read(workRepositoryProvider)
      .next(
        ref.read(currentMfcIdProvider),
        ref.read(currentWorkerIdProvider),
        WorkArea.pickPack,
        key: IdempotencyKey.generate(),
      );
  if (outcome case NextAssigned(:final task)) {
    ref
        .read(knownAssignmentVersionsProvider.notifier)
        .put(task.taskId, task.assignmentVersion);
  }
  if (!context.mounted) return;
  ref.invalidate(workSessionProvider(WorkArea.pickPack));
  if (outcome case NextAssigned(:final task) when task.taskType == 'PACK') {
    context.go('/work/${WorkArea.pickPack.name}');
    await context.push(task.route!);
    return;
  }
  context.go('/work/${WorkArea.pickPack.name}');
}

/// 완료 화면의 자동 다음 작업을 켤지 — 휴게 중이면 끈다(사용자 2026-11-14).
/// 본인 정보를 아직 못 읽었으면 켠다: 휴게 중이면 서버가 `ON_BREAK` 로 거절하고 근무 화면이 그 안내를 보인다.
bool autoNextAllowed(WidgetRef ref) =>
    ref.watch(meProvider).value?.onBreak != true;
