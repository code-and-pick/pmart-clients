import 'package:pmart_core/pmart_core.dart';

import '../../inbound/data/mock_inbound_repository.dart';
import '../../inbound/domain/inbound.dart';
import '../../quality/data/mock_quality_repository.dart';
import '../../quality/domain/quality.dart';
import '../../stock_count/data/mock_stock_count_repository.dart';
import '../../stock_move/data/mock_stock_move_repository.dart';
import '../../stock_move/domain/stock_move.dart';
import '../../tasks/data/mock_task_repository.dart';
import '../domain/work.dart';
import 'work_repository.dart';

/// 목 구현. 테스트 계정 OP-mock-1 은 모든 업무 권한이 있다(권한 없음은 [allowed] 로 바꿔 본다).
/// 입고는 목 입고 예정(EXPECTED·RECEIVING)을 RECEIVE 작업으로 준다(taskId = trfId, BR-52).
/// 다음 작업은 고른 업무의 작업 유형 안에서 진행 중 → 배정됨 순으로 하나 준다(서버의 "들고 있는 작업 먼저"와 같게).
/// 피패킹 외 업무의 작업은 목에 없어 "지금 할 작업이 없어요"가 된다.
final class MockWorkRepository implements WorkRepository {
  MockWorkRepository({
    required this.tasks,
    this.inbound,
    this.quality,
    this.stockMove,
    this.stockCount,
    this.latency = const Duration(milliseconds: 300),
    Set<String>? allowed,
  }) : allowed = allowed ?? defaultAllowed;

  /// 모든 업무.
  static const defaultAllowed = {
    'RECEIVE',
    'PICK',
    'PACK',
    'INSPECT',
    'RETURN_INSPECT',
    'PUTAWAY',
    'REPLENISH',
    'MOVE',
    'RETURN',
    'RETURN_RECEIPT',
    'CYCLE_COUNT',
  };

  final MockTaskRepository tasks;
  final MockInboundRepository? inbound;
  final MockQualityRepository? quality;
  final MockStockMoveRepository? stockMove;
  final MockStockCountRepository? stockCount;
  final Duration latency;
  final Set<String> allowed;
  bool onBreak = false;
  int nextCalls = 0;

  /// 다음 받기 응답을 1회 잃는다(서버는 배정함).
  bool loseNextResponse = false;

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<WorkerProfile> me(String mfcId, String workerId) async {
    await _wait();
    return WorkerProfile(
      workerId: workerId,
      displayName: '목 작업자',
      allowedTaskTypes: allowed,
      onBreak: onBreak,
    );
  }

  @override
  Future<List<WorkerProfile>> workers(String mfcId) async {
    await _wait();
    return [
      WorkerProfile(
        workerId: MockTaskRepository.workerId,
        displayName: '목 작업자',
        allowedTaskTypes: allowed,
        onBreak: onBreak,
      ),
      const WorkerProfile(
        workerId: 'OP-mock-2',
        displayName: '목 작업자 2',
        allowedTaskTypes: {'PICK', 'PACK'},
        workAreas: {WorkArea.pickPack},
      ),
      const WorkerProfile(
        workerId: 'OP-mock-3',
        displayName: '목 작업자 3',
        allowedTaskTypes: {'PUTAWAY', 'REPLENISH', 'MOVE', 'RETURN'},
        workAreas: {WorkArea.stockMove},
        onBreak: true,
      ),
      const WorkerProfile(
        workerId: 'OP-mock-4',
        displayName: '목 작업자 4',
        allowedTaskTypes: {'PICK', 'PACK'},
        workAreas: {WorkArea.pickPack},
        active: false,
      ),
    ];
  }

  @override
  Future<NextTaskOutcome> next(
    String mfcId,
    String workerId,
    WorkArea area, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    nextCalls++;
    if (onBreak) return const NextUnavailable(WorkProblemCode.onBreak);
    if (area == WorkArea.inbound) return _nextInbound();
    if (area == WorkArea.inspection) return _nextInspection(mfcId);
    if (area == WorkArea.stockMove) return _nextStockMove(mfcId);
    if (area == WorkArea.stockCount) return _nextCount(workerId);
    Map<String, Object?>? pick(String state) {
      for (final id in tasks.taskIds) {
        final t = tasks.taskJson(id);
        final assignee = (t['assignment'] as Map?)?['workerId'];
        if (t['state'] == state &&
            area.taskTypes.contains(t['taskType']) &&
            (assignee == null || assignee == workerId)) {
          return t;
        }
      }
      return null;
    }

    final t = pick('IN_PROGRESS') ?? pick('ASSIGNED') ?? pick('READY');
    if (t == null) {
      return const NextUnavailable(WorkProblemCode.noTaskAvailable);
    }
    if (loseNextResponse) {
      loseNextResponse = false;
      return const NextUnknown();
    }
    return NextAssigned(
      AssignedTask(
        taskId: t['taskId']! as String,
        taskType: t['taskType']! as String,
        promisedReadyAt: switch (t['promisedReadyAt']) {
          final String s => DateTime.parse(s),
          _ => null,
        },
        lines: [
          for (final l
              in (t['lines'] as List? ?? const <Object>[])
                  .cast<Map<String, Object?>>())
            AssignedLine(
              productName: l['productName'] as String?,
              sku: l['sku'] as String?,
              qty: l['remainingQty'] as int?,
              fromLocation: l['locationId'] as String?,
            ),
        ],
      ),
    );
  }

  /// 품질검사: 입고 품질검사 작업 먼저, 그다음 검수 대기 회수품.
  Future<NextTaskOutcome> _nextInspection(String mfcId) async {
    final q = quality;
    if (q != null) {
      final open = await q.inboundTasks(mfcId, kind: InboundTaskKind.inspect);
      if (open.firstOrNull case final t?) {
        return NextAssigned(
          AssignedTask(
            taskId: t.taskId,
            taskType: 'INSPECT',
            lines: [
              AssignedLine(
                sku: t.sku,
                qty: t.remainingQty,
                fromLocation: t.locationCode,
              ),
            ],
          ),
        );
      }
    }
    final sm = stockMove;
    if (sm != null) {
      if (sm.pendingReturnIds.firstOrNull case final id?) {
        final r = await sm.returnReceipt(id);
        return NextAssigned(
          AssignedTask(
            taskId: id,
            taskType: 'RETURN_INSPECT',
            lines: [
              for (final l in r.lines)
                AssignedLine(
                  productName: l.productName,
                  sku: l.sku,
                  qty: l.qty,
                  notice: l.conditionNote,
                ),
            ],
          ),
        );
      }
    }
    return const NextUnavailable(WorkProblemCode.noTaskAvailable);
  }

  /// 재고 이동: 카트에 실린 것(들고 있는 일) → 긴급 → 이동·보충 → 적치.
  Future<NextTaskOutcome> _nextStockMove(String mfcId) async {
    final sm = stockMove;
    if (sm != null) {
      int rank(MoveOrderView m) => m.onCartQty > 0 ? 0 : (m.urgent ? 1 : 2);
      final moves = sm.activeMoves.toList()
        ..sort((a, b) => rank(a).compareTo(rank(b)));
      if (moves.firstOrNull case final m?) {
        return NextAssigned(
          AssignedTask(
            taskId: m.moveId,
            taskType: m.kind == MoveKind.move ? 'MOVE' : 'REPLENISH',
            urgent: m.urgent,
            lines: [
              AssignedLine(
                sku: m.sku,
                qty: m.qty - m.droppedQty,
                fromLocation: m.fromLocation,
                toLocation: m.toLocation,
              ),
            ],
          ),
        );
      }
    }
    final q = quality;
    if (q != null) {
      final open = await q.inboundTasks(mfcId, kind: InboundTaskKind.putaway);
      if (open.firstOrNull case final t?) {
        return NextAssigned(
          AssignedTask(
            taskId: t.taskId,
            taskType: 'PUTAWAY',
            lines: [
              AssignedLine(
                sku: t.sku,
                qty: t.remainingQty,
                fromLocation: t.locationCode,
              ),
            ],
          ),
        );
      }
    }
    // 취소품 복귀(fulfillment RETURN) — 순서 맨 뒤(capacity 공지).
    for (final st in const ['IN_PROGRESS', 'ASSIGNED']) {
      for (final id in tasks.taskIds) {
        final t = tasks.taskJson(id);
        if (t['taskType'] == 'RETURN' && t['state'] == st) {
          return NextAssigned(
            AssignedTask(
              taskId: id,
              taskType: 'RETURN',
              lines: [
                for (final l
                    in (t['lines']! as List).cast<Map<String, Object?>>())
                  AssignedLine(
                    productName: l['productName'] as String?,
                    sku: l['sku'] as String?,
                    qty: l['remainingQty'] as int?,
                  ),
              ],
            ),
          );
        }
      }
    }
    return const NextUnavailable(WorkProblemCode.noTaskAvailable);
  }

  NextTaskOutcome _nextCount(String workerId) {
    final c = stockCount?.openFor(workerId).firstOrNull;
    if (c == null) {
      return const NextUnavailable(WorkProblemCode.noTaskAvailable);
    }
    return NextAssigned(
      AssignedTask(
        taskId: c.sessionId,
        taskType: 'CYCLE_COUNT',
        lines: [
          for (final loc in c.locationCodes) AssignedLine(fromLocation: loc),
        ],
      ),
    );
  }

  NextTaskOutcome _nextInbound() {
    final ib = inbound;
    if (ib == null) {
      return const NextUnavailable(WorkProblemCode.noTaskAvailable);
    }
    // 하차 중인 것(들고 있는 작업)이 먼저.
    final open = [
      ...ib.trfIds.where((id) => ib.peek(id).state == PromiseState.receiving),
      ...ib.trfIds.where((id) => ib.peek(id).state == PromiseState.expected),
    ];
    if (open.isEmpty) {
      return const NextUnavailable(WorkProblemCode.noTaskAvailable);
    }
    final p = ib.peek(open.first);
    return NextAssigned(
      AssignedTask(
        taskId: p.trfId,
        taskType: 'RECEIVE',
        promisedReadyAt: p.plannedArrivalAt,
        lines: [
          for (final l in p.lines)
            AssignedLine(
              productName: l.productName,
              sku: l.sku,
              qty: l.expectedQty,
              boxes: l.boxCount,
            ),
        ],
      ),
    );
  }

  @override
  Future<void> startBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    onBreak = true;
  }

  @override
  Future<void> endBreak(
    String mfcId,
    String workerId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    onBreak = false;
  }
}
