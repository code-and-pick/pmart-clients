import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../stock_move/data/mock_stock_move_repository.dart';
import '../domain/quality.dart';
import 'quality_repository.dart';

/// 목: 품질검사 작업 1건(요거트 12개). 검사하면 정상 결과마다 적치 작업을 만든다. 회수품 검수는 바로 반영.
final class MockQualityRepository implements QualityRepository {
  MockQualityRepository({
    this.latency = const Duration(milliseconds: 300),
    this.returns,
  }) {
    // 입고 수령 결과(정상+미판정)가 품질검사 대상 — 요거트 12(냉장, 소비기한 5일 이상),
    // 두부 16(냉장, 제조 3일 이내·소비기한 3일 이상 — 제조일 필수).
    _tasks['TSK-INS-mock-1'] = const InboundTaskView(
      taskId: 'TSK-INS-mock-1',
      kind: InboundTaskKind.inspect,
      receiptId: 'rcp-seed-1',
      sku: 'E-00000002',
      lotId: 'LOT-Y-1110',
      locationCode: 'RCV-C-01',
      plannedQty: 12,
      doneQty: 0,
      completed: false,
      version: 1,
      productName: '그릭요거트 플레인 400g',
      barcodes: ['8801115220015'],
      minRemainingDays: 5,
      zone: TempZone.chilled,
    );
    _tasks['TSK-INS-mock-2'] = const InboundTaskView(
      taskId: 'TSK-INS-mock-2',
      kind: InboundTaskKind.inspect,
      receiptId: 'rcp-seed-1',
      sku: 'E-00000011',
      lotId: 'LOT-T-1109',
      locationCode: 'RCV-C-02',
      plannedQty: 16,
      doneQty: 0,
      completed: false,
      version: 1,
      productName: '국산콩 두부 300g',
      barcodes: ['8801007001101'],
      minRemainingDays: 3,
      maxDaysSinceManufacture: 3,
      zone: TempZone.chilled,
    );
  }

  final Duration latency;

  /// 회수품 검수가 반입 기록을 INSPECTED 로 바꾸게 잇는다.
  final MockStockMoveRepository? returns;

  /// 다음 응답을 1회 잃는다(서버는 반영함).
  bool loseNextResponse = false;
  int inspectCalls = 0;
  final inspectedReturns = <String, List<ReturnInspectionLine>>{};
  final _tasks = <String, InboundTaskView>{};
  final _done = <String, FieldOutcome<InboundTaskExecutionView>>{};
  final _returns = <String, String>{};
  int _seq = 0;

  Future<void> _wait() => Future<void>.delayed(latency);

  InboundTaskView? task(String id) => _tasks[id];

  @override
  Future<List<InboundTaskView>> inboundTasks(
    String mfcId, {
    InboundTaskKind? kind,
    bool completed = false,
  }) async {
    await _wait();
    return [
      for (final t in _tasks.values)
        if (t.completed == completed && (kind == null || t.kind == kind)) t,
    ];
  }

  InboundTaskView _advance(InboundTaskView t, int qty) => InboundTaskView(
    taskId: t.taskId,
    kind: t.kind,
    receiptId: t.receiptId,
    parentTaskId: t.parentTaskId,
    sku: t.sku,
    lotId: t.lotId,
    locationCode: t.locationCode,
    plannedQty: t.plannedQty,
    doneQty: t.doneQty + qty,
    completed: t.doneQty + qty >= t.plannedQty,
    version: t.version + 1,
    productName: t.productName,
    barcodes: t.barcodes,
    minRemainingDays: t.minRemainingDays,
    maxDaysSinceManufacture: t.maxDaysSinceManufacture,
    zone: t.zone,
    suggestedLocations: t.suggestedLocations,
  );

  /// 적치 추천 칸(목) — 그 상품이 있던 선반.
  static const _shelfOf = {
    'E-00000002': ['C-S1-01-1-01', 'C-S1-01-1-02'],
    'E-00000011': ['C-S1-04-1-02'],
  };

  @override
  Future<FieldOutcome<InboundTaskExecutionView>> inspect(
    String taskId,
    List<InspectionResult> results, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    inspectCalls++;
    if (_done[key.value] case final o?) return o;
    final t = _tasks[taskId];
    if (t == null) return const FieldRejected(ProblemCode.notFound);
    final sum = results.fold(0, (s, r) => s + r.qty);
    if (t.completed || sum > t.remainingQty) {
      return const FieldRejected(ProblemCode.invalidState);
    }
    final created = <String>[];
    for (final r in results.where((r) => !r.quarantined)) {
      final id = 'TSK-PUT-mock-${++_seq}';
      created.add(id);
      _tasks[id] = InboundTaskView(
        taskId: id,
        kind: InboundTaskKind.putaway,
        receiptId: t.receiptId,
        parentTaskId: t.taskId,
        sku: t.sku,
        lotId: '${t.lotId}-${r.sourceLotRef ?? _seq}',
        locationCode: t.locationCode,
        plannedQty: r.qty,
        doneQty: 0,
        completed: false,
        version: 1,
        productName: t.productName,
        barcodes: t.barcodes,
        zone: t.zone,
        suggestedLocations: _shelfOf[t.sku] ?? const [],
      );
    }
    final next = _advance(t, sum);
    _tasks[taskId] = next;
    final o = FieldDone(
      InboundTaskExecutionView(
        executionId: 'exe-${++_seq}',
        task: next,
        commitId: 'commit-$_seq',
        createdTaskIds: created,
      ),
    );
    _done[key.value] = o;
    if (loseNextResponse) {
      loseNextResponse = false;
      return const FieldUnknown();
    }
    return o;
  }

  @override
  Future<FieldOutcome<InboundTaskExecutionView>> putaway(
    String taskId, {
    required String toLocationCode,
    required int qty,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_done[key.value] case final o?) return o;
    final t = _tasks[taskId];
    if (t == null) return const FieldRejected(ProblemCode.notFound);
    if (t.completed || qty > t.remainingQty) {
      return const FieldRejected(ProblemCode.invalidState);
    }
    final next = _advance(t, qty);
    _tasks[taskId] = next;
    final o = FieldDone(
      InboundTaskExecutionView(
        executionId: 'exe-${++_seq}',
        task: next,
        commitId: 'commit-$_seq',
      ),
    );
    _done[key.value] = o;
    return o;
  }

  @override
  Future<FieldOutcome<String?>> inspectReturn({
    required String mfcId,
    required String claimId,
    required String returnReceiptId,
    required String inspectedBy,
    required List<ReturnInspectionLine> lines,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_returns[key.value] case final id?) return FieldDone(id);
    if (lines.any(
      (l) => l.verdict == ReturnVerdict.resale && !l.resaleAllowed,
    )) {
      return const FieldRejected(QualityProblemCode.resaleNotAllowed);
    }
    final id = 'RIN-mock-${++_seq}';
    _returns[key.value] = id;
    inspectedReturns[returnReceiptId] = lines;
    returns?.markInspected(returnReceiptId);
    return FieldDone(id);
  }

  @override
  Future<({String id, String applyStatus, int resaleQty, int disposeQty})>
  returnInspection(String returnInspectionId) async {
    await _wait();
    return (
      id: returnInspectionId,
      applyStatus: 'APPLIED',
      resaleQty: 0,
      disposeQty: 0,
    );
  }
}
