import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;
import 'package:pmart_api_mfc_quality/pmart_api_mfc_quality.dart' as q;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../../shared/providers.dart' show sourceSystem;
import '../domain/quality.dart';

/// 품질검사 업무: 입고 품질검사(mfc-inbound inbound-tasks INSPECT)와 회수품 검수(mfc-quality return-inspections).
/// 적치(PUTAWAY)도 같은 입고 작업 API 라 여기 둔다 — 화면은 재고 이동 업무.
abstract interface class QualityRepository {
  /// `GET /inbound-tasks` (READY 기본).
  Future<List<InboundTaskView>> inboundTasks(
    String mfcId, {
    InboundTaskKind? kind,
    bool completed = false,
  });

  /// `POST /inbound-tasks/{taskId}/inspections` — 정상/격리 판정과 LOT 분리. 합계 ≤ 잔량.
  Future<FieldOutcome<InboundTaskExecutionView>> inspect(
    String taskId,
    List<InspectionResult> results, {
    required IdempotencyKey key,
  });

  /// `POST /inbound-tasks/{taskId}/putaways` — 선반 위치·수량(이때부터 판매 가능).
  Future<FieldOutcome<InboundTaskExecutionView>> putaway(
    String taskId, {
    required String toLocationCode,
    required int qty,
    required IdempotencyKey key,
  });

  /// `POST /return-inspections` — 회수품 재판매/폐기. 202 resultId = returnInspectionId.
  Future<FieldOutcome<String?>> inspectReturn({
    required String mfcId,
    required String claimId,
    required String returnReceiptId,
    required String inspectedBy,
    required List<ReturnInspectionLine> lines,
    required IdempotencyKey key,
  });

  /// `GET /return-inspections/{id}` — 재고 반영 상태(APPLIED 만 확정).
  Future<({String id, String applyStatus, int resaleQty, int disposeQty})>
  returnInspection(String returnInspectionId);
}

final class ApiQualityRepository implements QualityRepository {
  ApiQualityRepository(Dio dio)
    : _tasks = ib.PmartApiMfcInbound(dio: dio).getInboundTasksApi(),
      _returns = q.PmartApiMfcQuality(dio: dio).getReturnInspectionsApi();

  final ib.InboundTasksApi _tasks;
  final q.ReturnInspectionsApi _returns;

  @override
  Future<List<InboundTaskView>> inboundTasks(
    String mfcId, {
    InboundTaskKind? kind,
    bool completed = false,
  }) async {
    final res = await pmartGuard(
      () => _tasks.listInboundTasks(
        mfcId: mfcId,
        state: completed ? 'COMPLETED' : 'READY',
        taskType: switch (kind) {
          InboundTaskKind.inspect => 'INSPECT',
          InboundTaskKind.putaway => 'PUTAWAY',
          _ => null,
        },
      ),
    );
    return [
      for (final t in res.data?.items ?? const <ib.InboundTask>[])
        inboundTaskFromContract(t),
    ];
  }

  @override
  Future<FieldOutcome<InboundTaskExecutionView>> inspect(
    String taskId,
    List<InspectionResult> results, {
    required IdempotencyKey key,
  }) => _exec(
    () => _tasks.inspectInboundTask(
      taskId: taskId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      inspectInboundTaskRequest: ib.InspectInboundTaskRequest(
        results: [
          for (final r in results)
            ib.InspectInboundTaskRequestResultsInner(
              qty: r.qty,
              resultQuality: r.quarantined
                  ? ib
                        .InspectInboundTaskRequestResultsInnerResultQualityEnum
                        .QUARANTINED
                  : ib
                        .InspectInboundTaskRequestResultsInnerResultQualityEnum
                        .NORMAL,
              sourceLotRef: r.sourceLotRef,
              expiryDate: r.expiryDate,
              manufactureDate: r.manufactureDate,
            ),
        ],
      ),
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<FieldOutcome<InboundTaskExecutionView>> putaway(
    String taskId, {
    required String toLocationCode,
    required int qty,
    required IdempotencyKey key,
  }) => _exec(
    () => _tasks.putawayInboundTask(
      taskId: taskId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      putawayInboundTaskRequest: ib.PutawayInboundTaskRequest(
        toLocationCode: toLocationCode,
        qty: qty,
      ),
      extra: commandOptions(key).extra,
    ),
  );

  Future<FieldOutcome<InboundTaskExecutionView>> _exec(
    Future<Response<ib.InboundTaskExecution>> Function() call,
  ) async {
    try {
      final res = await pmartGuard(call);
      final e = res.data;
      if (e == null) return const FieldUnknown();
      return switch (e.applyStatus.value) {
        'APPLIED' => FieldDone(
          InboundTaskExecutionView(
            executionId: e.executionId,
            task: e.task == null ? null : inboundTaskFromContract(e.task!),
            commitId: e.inventoryCommitId,
            createdTaskIds: e.createdTaskIds ?? const [],
          ),
        ),
        'REJECTED' => FieldRejected(e.rejectReason ?? 'REJECTED'),
        // CAPTURED·UNKNOWN_RESULT — 같은 키로 다시 보내 확정한다.
        _ => const FieldUnknown(),
      };
    } on PmartFailure catch (f) {
      return fieldFailure(f);
    }
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
    try {
      final res = await pmartGuard(
        () => _returns.createReturnInspection(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          returnInspectionRequest: q.ReturnInspectionRequest(
            mfcId: mfcId,
            claimId: claimId,
            returnReceiptId: returnReceiptId,
            inspectedBy: inspectedBy,
            lines: [
              for (final l in lines)
                q.ReturnInspectionRequestLinesInner(
                  orderLineId: l.orderLineId,
                  sku: l.sku,
                  lotId: l.lotId,
                  qty: l.qty,
                  verdict: l.verdict == ReturnVerdict.resale
                      ? q.ReturnInspectionRequestLinesInnerVerdictEnum.RESALE
                      : q.ReturnInspectionRequestLinesInnerVerdictEnum.DISPOSE,
                  temperatureZone: switch (l.zone) {
                    TempZone.ambient =>
                      q
                          .ReturnInspectionRequestLinesInnerTemperatureZoneEnum
                          .AMBIENT,
                    TempZone.chilled =>
                      q
                          .ReturnInspectionRequestLinesInnerTemperatureZoneEnum
                          .CHILLED,
                    TempZone.frozen =>
                      q
                          .ReturnInspectionRequestLinesInnerTemperatureZoneEnum
                          .FROZEN,
                  },
                  fresh: l.fresh,
                  opened: l.opened,
                  disposeReason: switch (l.disposeReason) {
                    null => null,
                    final r =>
                      q
                          .ReturnInspectionRequestLinesInnerDisposeReasonEnum
                          .values
                          .firstWhere((e) => e.value == r.wire),
                  },
                  evidenceRef: l.evidenceRef,
                ),
            ],
          ),
          extra: commandOptions(key).extra,
        ),
      );
      final r = res.data;
      if (r == null) return const FieldUnknown();
      return fieldCommand(r.status.value, r.resultId);
    } on PmartFailure catch (f) {
      return fieldFailure(f);
    }
  }

  @override
  Future<({String id, String applyStatus, int resaleQty, int disposeQty})>
  returnInspection(String returnInspectionId) async {
    final res = await pmartGuard(
      () =>
          _returns.getReturnInspection(returnInspectionId: returnInspectionId),
    );
    final r =
        res.data ??
        (throw const ContractViolationFailure('ReturnInspection 없음'));
    return (
      id: r.returnInspectionId ?? returnInspectionId,
      applyStatus: r.inventoryApplyStatus?.value ?? 'UNKNOWN_RESULT',
      resaleQty: r.resaleQty ?? 0,
      disposeQty: r.disposeQty ?? 0,
    );
  }
}

InboundTaskView inboundTaskFromContract(ib.InboundTask t) => InboundTaskView(
  taskId: t.taskId,
  kind: switch (t.taskType.value) {
    'INSPECT' => InboundTaskKind.inspect,
    'PUTAWAY' => InboundTaskKind.putaway,
    _ => InboundTaskKind.unknown,
  },
  receiptId: t.receiptId,
  parentTaskId: t.parentTaskId,
  sku: t.sku,
  lotId: t.lotId,
  locationCode: t.locationCode,
  plannedQty: t.plannedQty,
  doneQty: t.doneQty,
  completed: t.state.value == 'COMPLETED',
  version: t.version,
  productName: switch (t.productName?.trim()) {
    final n? when n.isNotEmpty => n,
    _ => null,
  },
  barcodes: [
    for (final b in t.barcodes ?? const <String>[])
      if (b.trim().isNotEmpty) b.trim(),
  ],
);
