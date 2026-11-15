import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../../shared/providers.dart' show sourceSystem;
import '../domain/stock_move.dart';

/// 재고 이동 업무: 이동·보충 지시 실행(mfc-inbound move-orders), 회수품 반입(return-receipts).
/// 적치(PUTAWAY)는 입고 작업 API(`QualityRepository.putaway`)를 쓴다.
abstract interface class StockMoveRepository {
  /// `GET /move-orders/{moveId}` — MOVE·REPLENISH 배정의 taskId = moveId(capacity 공지 2026-11-08).
  Future<MoveOrderView> move(String moveId);

  /// `POST /move-orders/{moveId}/pickups` — 출발 칸 → 카트.
  Future<FieldOutcome<MoveOrderView>> pickUp(
    String moveId, {
    required String cartLocation,
    required int qty,
    required IdempotencyKey key,
  });

  /// `POST /move-orders/{moveId}/drops` — 카트 → 도착 칸(취소 뒤에는 출발 칸).
  Future<FieldOutcome<MoveOrderView>> drop(
    String moveId, {
    required String toLocation,
    required int qty,
    required IdempotencyKey key,
  });

  /// `POST /return-receipts` — 회수품 실물 반입(격리). 202 resultId = returnReceiptId.
  Future<FieldOutcome<String?>> receiveReturn({
    required String mfcId,
    required String claimId,
    required String returnPickupId,
    required String toLocationCode,
    required String receivedBy,
    required DateTime receivedAt,
    required List<ReturnReceiptLine> lines,
    String? orderId,
    required IdempotencyKey key,
  });

  /// `GET /return-receipts/{id}`.
  Future<ReturnReceiptView> returnReceipt(String returnReceiptId);
}

final class ApiStockMoveRepository implements StockMoveRepository {
  ApiStockMoveRepository(Dio dio)
    : _moves = ib.PmartApiMfcInbound(dio: dio).getMovesApi(),
      _returns = ib.PmartApiMfcInbound(dio: dio).getReturnReceiptsApi();

  final ib.MovesApi _moves;
  final ib.ReturnReceiptsApi _returns;

  @override
  Future<MoveOrderView> move(String moveId) async {
    final res = await pmartGuard(() => _moves.getMoveOrder(moveId: moveId));
    return moveFromContract(
      res.data ?? (throw const ContractViolationFailure('MoveOrder 없음')),
    );
  }

  Future<FieldOutcome<MoveOrderView>> _cmd(
    Future<Response<ib.MoveOrder>> Function() call,
  ) async {
    try {
      final res = await pmartGuard(call);
      final m = res.data;
      return m == null ? const FieldUnknown() : FieldDone(moveFromContract(m));
    } on PmartFailure catch (f) {
      return fieldFailure(f);
    }
  }

  @override
  Future<FieldOutcome<MoveOrderView>> pickUp(
    String moveId, {
    required String cartLocation,
    required int qty,
    required IdempotencyKey key,
  }) => _cmd(
    () => _moves.pickUpMoveOrder(
      moveId: moveId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      pickUpMoveOrderRequest: ib.PickUpMoveOrderRequest(
        cartLocation: cartLocation,
        qty: qty,
      ),
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<FieldOutcome<MoveOrderView>> drop(
    String moveId, {
    required String toLocation,
    required int qty,
    required IdempotencyKey key,
  }) => _cmd(
    () => _moves.dropMoveOrder(
      moveId: moveId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      dropMoveOrderRequest: ib.DropMoveOrderRequest(
        toLocation: toLocation,
        qty: qty,
      ),
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<FieldOutcome<String?>> receiveReturn({
    required String mfcId,
    required String claimId,
    required String returnPickupId,
    required String toLocationCode,
    required String receivedBy,
    required DateTime receivedAt,
    required List<ReturnReceiptLine> lines,
    String? orderId,
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _returns.recordReturnReceipt(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          recordReturnReceiptRequest: ib.RecordReturnReceiptRequest(
            mfcId: mfcId,
            claimId: claimId,
            returnPickupId: returnPickupId,
            toLocationCode: toLocationCode,
            orderId: orderId,
            receivedAt: receivedAt.toUtc(),
            receivedBy: receivedBy,
            lines: [
              for (final l in lines)
                ib.RecordReturnReceiptRequestLinesInner(
                  orderLineId: l.orderLineId,
                  sku: l.sku,
                  qty: l.qty,
                  sourceLotRef: l.sourceLotRef,
                  expiryDate: l.expiryDate,
                  conditionNote: l.conditionNote,
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
  Future<ReturnReceiptView> returnReceipt(String returnReceiptId) async {
    final res = await pmartGuard(
      () => _returns.getReturnReceipt(returnReceiptId: returnReceiptId),
    );
    final r =
        res.data ?? (throw const ContractViolationFailure('ReturnReceipt 없음'));
    return ReturnReceiptView(
      returnReceiptId: r.returnReceiptId ?? returnReceiptId,
      applyStatus: r.inventoryApplyStatus?.value ?? 'UNKNOWN_RESULT',
      inspected: r.inspectionState?.value == 'INSPECTED',
      claimId: r.claimId,
      lines: [
        for (final l
            in r.lines ?? const <ib.GetReturnReceipt200ResponseLinesInner>[])
          ReturnedLine(
            sku: l.sku ?? (throw const ContractViolationFailure('sku 없음')),
            qty: l.qty ?? (throw const ContractViolationFailure('qty 없음')),
            orderLineId: l.orderLineId,
            lotId: l.lotId,
            conditionNote: l.conditionNote,
          ),
      ],
      rejectReason: r.rejectReason,
      putawayTaskIds: r.putawayTaskIds ?? const [],
    );
  }
}

MoveOrderView moveFromContract(ib.MoveOrder m) => MoveOrderView(
  moveId: m.moveId ?? (throw const ContractViolationFailure('moveId 없음')),
  kind: switch (m.kind?.value) {
    'MOVE' => MoveKind.move,
    'REPLENISH' => MoveKind.replenish,
    _ => MoveKind.unknown,
  },
  state: switch (m.state?.value) {
    'ACTIVE' => MoveState.active,
    'CANCEL_PENDING' => MoveState.cancelPending,
    'COMPLETED' => MoveState.completed,
    'CANCELLED' => MoveState.cancelled,
    _ => MoveState.unknown,
  },
  sku: m.sku ?? (throw const ContractViolationFailure('sku 없음')),
  lotId: m.lotId ?? (throw const ContractViolationFailure('lotId 없음')),
  fromLocation:
      m.fromLocation ??
      (throw const ContractViolationFailure('fromLocation 없음')),
  toLocation:
      m.toLocation ?? (throw const ContractViolationFailure('toLocation 없음')),
  cartLocation: m.cartLocation,
  qty: m.qty ?? (throw const ContractViolationFailure('qty 없음')),
  pickedQty: m.pickedQty ?? 0,
  droppedQty: m.droppedQty ?? 0,
  onCartQty: m.onCartQty ?? 0,
  urgent: m.urgent ?? false,
  assigneeId: m.assigneeId,
  pickedBy: m.pickedBy,
  reason: m.reason,
  productName: switch (m.productName?.trim()) {
    final n? when n.isNotEmpty => n,
    _ => null,
  },
  barcodes: [
    for (final b in m.barcodes ?? const <String>[])
      if (b.trim().isNotEmpty) b.trim(),
  ],
);
