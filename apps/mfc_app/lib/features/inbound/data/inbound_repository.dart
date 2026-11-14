import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/inbound.dart';

abstract interface class InboundRepository {
  /// `GET /inbound-promises/{trfId}`.
  Future<InboundPromiseView> promise(String trfId);

  /// `POST /inbound-promises/{trfId}/arrivals` — 도착 등록·하차 시작(EXPECTED→RECEIVING).
  Future<InboundCommandOutcome> recordArrival(
    String trfId, {
    required int version,
    required DateTime arrivedAt,
    required String recordedBy,
    required IdempotencyKey key,
  });

  /// `POST /inbound-promises/{trfId}/receipts` — 수령(정상/격리/미판정). 202 resultId = receiptId.
  Future<InboundCommandOutcome> recordReceipt(
    String trfId, {
    required int version,
    required List<(InboundLine, ReceiptCount)> counts,
    required DateTime receivedAt,
    required String receivedBy,
    required IdempotencyKey key,
  });

  /// `GET /inbound-promises/{trfId}/receipts/{receiptId}` — 재고 반영 상태.
  Future<ReceiptView> receipt(String trfId, String receiptId);
}

final class ApiInboundRepository implements InboundRepository {
  ApiInboundRepository(Dio dio)
    : _api = ib.PmartApiMfcInbound(dio: dio).getInboundPromisesApi();

  final ib.InboundPromisesApi _api;

  @override
  Future<InboundPromiseView> promise(String trfId) async {
    final res = await pmartGuard(() => _api.getInboundPromise(trfId: trfId));
    return promiseFromContract(
      res.data ?? (throw const ContractViolationFailure('InboundPromise 없음')),
    );
  }

  @override
  Future<InboundCommandOutcome> recordArrival(
    String trfId, {
    required int version,
    required DateTime arrivedAt,
    required String recordedBy,
    required IdempotencyKey key,
  }) => _command(
    () => _api.recordArrival(
      trfId: trfId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      xExpectedVersion: version,
      recordArrivalRequest: ib.RecordArrivalRequest(
        arrivedAt: arrivedAt.toUtc(),
        recordedBy: recordedBy,
      ),
      extra: commandOptions(key, expectedVersion: version).extra,
    ),
  );

  @override
  Future<InboundCommandOutcome> recordReceipt(
    String trfId, {
    required int version,
    required List<(InboundLine, ReceiptCount)> counts,
    required DateTime receivedAt,
    required String receivedBy,
    required IdempotencyKey key,
  }) => _command(
    () => _api.recordReceipt(
      trfId: trfId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      xExpectedVersion: version,
      recordReceiptRequest: ib.RecordReceiptRequest(
        receivedAt: receivedAt.toUtc(),
        receivedBy: receivedBy,
        lines: [
          for (final (l, c) in counts)
            ib.RecordReceiptRequestLinesInner(
              sku: l.sku,
              lotId: l.lotId,
              normalQty: c.normal,
              quarantinedQty: c.quarantined,
              pendingQty: c.pending,
              discrepancyReason: switch (c.reasonFor(l.expectedQty)) {
                null => null,
                final r =>
                  ib.RecordReceiptRequestLinesInnerDiscrepancyReasonEnum.values
                      .firstWhere((e) => e.value == r.wire),
              },
            ),
        ],
      ),
      extra: commandOptions(key, expectedVersion: version).extra,
    ),
  );

  Future<InboundCommandOutcome> _command(
    Future<Response<ib.RecordArrival202Response>> Function() call,
  ) async {
    try {
      final res = await pmartGuard(call);
      final r = res.data;
      if (r == null) return const InboundUnknown();
      return switch (r.status.value) {
        'ACCEPTED' || 'APPLIED' => InboundAccepted(resultId: r.resultId),
        'REJECTED' => const InboundRejected('REJECTED'),
        _ => const InboundUnknown(),
      };
    } on PmartFailure catch (f) {
      return switch (f) {
        UnknownResultFailure() => const InboundUnknown(),
        ProblemFailure(:final problem)
            when problem.code == ProblemCode.idempotencyConflict &&
                problem.retryable =>
          const InboundUnknown(),
        ProblemFailure(:final problem) => InboundRejected(problem.code),
        _ => throw f,
      };
    }
  }

  @override
  Future<ReceiptView> receipt(String trfId, String receiptId) async {
    final res = await pmartGuard(
      () => _api.getReceipt(trfId: trfId, receiptId: receiptId),
    );
    return receiptFromContract(
      res.data ?? (throw const ContractViolationFailure('Receipt 없음')),
    );
  }
}

ReceiptView receiptFromContract(ib.Receipt r) => ReceiptView(
  receiptId:
      r.receiptId ?? (throw const ContractViolationFailure('receiptId 없음')),
  applyStatus: switch (r.inventoryApplyStatus?.value) {
    'CAPTURED' => ApplyStatus.captured,
    'SUBMITTED' => ApplyStatus.submitted,
    'PROCESSING' => ApplyStatus.processing,
    'APPLIED' => ApplyStatus.applied,
    'REJECTED' => ApplyStatus.rejected,
    'UNKNOWN_RESULT' => ApplyStatus.unknownResult,
    _ => ApplyStatus.unknown,
  },
  commitId: r.inventoryCommitId,
  receivedAt: r.receivedAt,
);

InboundPromiseView promiseFromContract(ib.InboundPromise p) =>
    InboundPromiseView(
      trfId: p.trfId ?? (throw const ContractViolationFailure('trfId 없음')),
      version: p.version ?? 0,
      state: switch (p.state?.value) {
        'EXPECTED' => PromiseState.expected,
        'RECEIVING' => PromiseState.receiving,
        'TIN_POSTED' => PromiseState.tinPosted,
        'CANCELLED' => PromiseState.cancelled,
        _ => PromiseState.unknown,
      },
      plannedArrivalAt: p.plannedArrivalAt,
      eta: p.eta,
      arrivedAt: p.arrivedAt,
      lines: [
        for (final l in p.lines ?? const <ib.InboundPromiseLinesInner>[])
          InboundLine(
            sku: l.sku ?? (throw const ContractViolationFailure('sku 없음')),
            lotId: l.lotId,
            expectedQty:
                l.expectedQty ??
                (throw const ContractViolationFailure('expectedQty 없음')),
            receivedQty: l.receivedQty ?? 0,
            quarantinedQty: l.quarantinedQty ?? 0,
            pendingQty: l.pendingQty ?? 0,
            productName: switch (l.productName?.trim()) {
              final n? when n.isNotEmpty => n,
              _ => null,
            },
            barcodes: [
              for (final b in l.barcodes ?? const <String>[])
                if (b.trim().isNotEmpty) b.trim(),
            ],
          ),
      ],
      receipts: [
        for (final r in p.receipts ?? const <ib.Receipt>[])
          receiptFromContract(r),
      ],
    );
