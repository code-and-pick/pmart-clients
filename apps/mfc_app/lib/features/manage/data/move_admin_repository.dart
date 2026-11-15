import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;
import 'package:pmart_api_product/pmart_api_product.dart' as prod;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/codes.dart';
import '../../../shared/field_outcome.dart';
import '../../../shared/product_hints.dart';
import '../../../shared/providers.dart' show sourceSystem;
import '../../stock_move/data/mock_stock_move_repository.dart';
import '../../stock_move/data/stock_move_repository.dart' show moveFromContract;
import '../../stock_move/domain/stock_move.dart';

/// 옮길 수 있는 재고 한 묶음(mfc-inventory `CenterStock.units[]` — 칸·LOT). 정상·보관 상태만 고른다.
@immutable
class StockUnit {
  const StockUnit({
    required this.locationCode,
    required this.lotId,
    required this.qty,
    this.expiryDate,
  });

  final String locationCode;
  final String lotId;
  final int qty;
  final String? expiryDate;
}

/// 센터 관리자 이동 지시(사용자 2026-11-16 — mfc-inbound `move-orders` 지시·취소·목록, MFC_SUPERVISOR).
/// 칸 배정(물량·공간·칸당 한 상품)은 서버(mfc-inventory)가 판정하고, 거절은 그 코드 그대로 보인다.
abstract interface class MoveAdminRepository {
  /// `GET /move-orders?mfcId=` — 기본 진행 중(ACTIVE·CANCEL_PENDING).
  Future<List<MoveOrderView>> activeMoves(String mfcId);

  /// 찍은 값 → SKU. SKU 코드면 그대로, 상품 바코드면 product `resolveBarcode`. 모르는 바코드면 null.
  Future<String?> resolveSku(String code);

  /// `GET /mfcs/{mfcId}/stock?sku=` 에서 옮길 수 있는 묶음(정상·보관·수량 있음).
  Future<List<StockUnit>> movableStock(String mfcId, String sku);

  /// `POST /move-orders`. 같은 키는 같은 이동(moveId 가 키에서 정해진다).
  Future<FieldOutcome<MoveOrderView>> create({
    required String mfcId,
    required String sku,
    required String lotId,
    required String fromLocation,
    required String toLocation,
    required int qty,
    String? reason,
    bool urgent = false,
    required IdempotencyKey key,
  });

  /// `POST /move-orders/{moveId}/cancellations` — 집지 않은 몫만 풀리고, 카트에 남은 물건은 내려놓아야 끝난다.
  Future<FieldOutcome<MoveOrderView>> cancel(
    String moveId, {
    required String reason,
    required IdempotencyKey key,
  });
}

List<StockUnit> movableUnitsFromContract(inv.CenterStock s) {
  final expiry = {for (final l in s.lots) ?l.lotId: l.expiryDate};
  return [
    for (final u in s.units)
      if (u.qualityState == inv.QualityState.NORMAL &&
          u.workState == inv.WorkState.STORED &&
          (u.qty ?? 0) > 0)
        StockUnit(
          locationCode:
              u.locationCode ??
              (throw const ContractViolationFailure('locationCode 없음')),
          lotId: u.lotId ?? (throw const ContractViolationFailure('lotId 없음')),
          qty: u.qty!,
          expiryDate: expiry[u.lotId],
        ),
  ];
}

final class ApiMoveAdminRepository implements MoveAdminRepository {
  ApiMoveAdminRepository(Dio dio)
    : _moves = ib.PmartApiMfcInbound(dio: dio).getMovesApi(),
      _stock = inv.PmartApiMfcInventory(dio: dio).getQueriesApi(),
      _barcodes = prod.PmartApiProduct(dio: dio).getBarcodesApi();

  final ib.MovesApi _moves;
  final inv.QueriesApi _stock;
  final prod.BarcodesApi _barcodes;

  @override
  Future<List<MoveOrderView>> activeMoves(String mfcId) async {
    final res = await pmartGuard(() => _moves.listMoveOrders(mfcId: mfcId));
    final items =
        res.data?.items ??
        (throw const ContractViolationFailure('listMoveOrders.items 없음'));
    return [for (final m in items) moveFromContract(m)];
  }

  @override
  Future<String?> resolveSku(String code) async {
    final c = code.trim();
    if (isSku(c)) return c;
    try {
      final res = await pmartGuard(() => _barcodes.resolveBarcode(barcode: c));
      return res.data?.sku;
    } on ProblemFailure catch (f) {
      if (f.problem.status == 404) return null;
      rethrow;
    }
  }

  @override
  Future<List<StockUnit>> movableStock(String mfcId, String sku) async {
    final res = await pmartGuard(
      () => _stock.getCenterStock(mfcId: mfcId, sku: sku),
    );
    return movableUnitsFromContract(
      res.data ?? (throw const ContractViolationFailure('CenterStock 없음')),
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
  Future<FieldOutcome<MoveOrderView>> create({
    required String mfcId,
    required String sku,
    required String lotId,
    required String fromLocation,
    required String toLocation,
    required int qty,
    String? reason,
    bool urgent = false,
    required IdempotencyKey key,
  }) => _cmd(
    () => _moves.createMoveOrder(
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      createMoveOrderRequest: ib.CreateMoveOrderRequest(
        mfcId: mfcId,
        sku: sku,
        lotId: lotId,
        fromLocation: fromLocation,
        toLocation: toLocation,
        qty: qty,
        reason: reason,
        urgent: urgent,
      ),
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<FieldOutcome<MoveOrderView>> cancel(
    String moveId, {
    required String reason,
    required IdempotencyKey key,
  }) => _cmd(
    () => _moves.cancelMoveOrder(
      moveId: moveId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      cancelMoveOrderRequest: ib.CancelMoveOrderRequest(reason: reason),
      extra: commandOptions(key).extra,
    ),
  );
}

/// 목: 재고 이동 목([MockStockMoveRepository])의 지시를 같이 본다 — 지시한 이동은 작업자 "재고 이동"에서 받는다.
final class MockMoveAdminRepository implements MoveAdminRepository {
  MockMoveAdminRepository({
    required this.moves,
    this.hints = const MockProductHints(),
    this.latency = const Duration(milliseconds: 300),
  });

  final MockStockMoveRepository moves;
  final ProductHints hints;
  final Duration latency;
  final _keys = <String, FieldOutcome<MoveOrderView>>{};
  int _seq = 0;

  /// 목 재고(칸·LOT·수량). 우유는 보충 칸에 20, 진열 칸에 4.
  static const stock = <String, List<StockUnit>>{
    'E-00000001': [
      StockUnit(
        locationCode: 'C-R1-01-1-01',
        lotId: 'LOT-M-1022',
        qty: 20,
        expiryDate: '2026-11-20',
      ),
      StockUnit(
        locationCode: 'C-S1-02-2-05',
        lotId: 'LOT-M-1022',
        qty: 4,
        expiryDate: '2026-11-20',
      ),
    ],
    'E-00000002': [
      StockUnit(
        locationCode: 'C-S1-01-1-01',
        lotId: 'LOT-Y-1024',
        qty: 10,
        expiryDate: '2026-11-05',
      ),
    ],
  };

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<List<MoveOrderView>> activeMoves(String mfcId) async {
    await _wait();
    return moves.activeMoves.toList();
  }

  @override
  Future<String?> resolveSku(String code) async {
    await _wait();
    final c = code.trim();
    if (isSku(c)) return c;
    return hints.byBarcode(c)?.$1;
  }

  @override
  Future<List<StockUnit>> movableStock(String mfcId, String sku) async {
    await _wait();
    return stock[sku] ?? const [];
  }

  @override
  Future<FieldOutcome<MoveOrderView>> create({
    required String mfcId,
    required String sku,
    required String lotId,
    required String fromLocation,
    required String toLocation,
    required int qty,
    String? reason,
    bool urgent = false,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final unit = (stock[sku] ?? const <StockUnit>[])
        .where((u) => u.locationCode == fromLocation && u.lotId == lotId)
        .firstOrNull;
    if (unit == null || qty > unit.qty) {
      return _keys[key.value] = const FieldRejected('INSUFFICIENT_STOCK');
    }
    if (fromLocation == toLocation || !isMfcLocation(toLocation)) {
      return _keys[key.value] = const FieldRejected('INVALID_DESTINATION');
    }
    _seq += 1;
    final m = MoveOrderView(
      moveId: 'MV-mock-new-$_seq',
      kind: MoveKind.move,
      state: MoveState.active,
      sku: sku,
      lotId: lotId,
      fromLocation: fromLocation,
      toLocation: toLocation,
      qty: qty,
      pickedQty: 0,
      droppedQty: 0,
      onCartQty: 0,
      urgent: urgent,
      reason: reason,
      productName: hints.bySku(sku)?.name,
      barcodes: [?hints.bySku(sku)?.barcode],
    );
    moves.putMove(m);
    return _keys[key.value] = FieldDone(m);
  }

  @override
  Future<FieldOutcome<MoveOrderView>> cancel(
    String moveId, {
    required String reason,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final m = moves.moveById(moveId);
    if (m == null) {
      return _keys[key.value] = const FieldRejected(ProblemCode.notFound);
    }
    final n = MoveOrderView(
      moveId: m.moveId,
      kind: m.kind,
      // 카트에 실린 물건이 있으면 내려놓아야 끝난다.
      state: m.onCartQty > 0 ? MoveState.cancelPending : MoveState.cancelled,
      sku: m.sku,
      lotId: m.lotId,
      fromLocation: m.fromLocation,
      toLocation: m.toLocation,
      cartLocation: m.cartLocation,
      qty: m.qty,
      pickedQty: m.pickedQty,
      droppedQty: m.droppedQty,
      onCartQty: m.onCartQty,
      urgent: m.urgent,
      reason: reason,
      productName: m.productName,
      barcodes: m.barcodes,
    );
    moves.putMove(n);
    return _keys[key.value] = FieldDone(n);
  }
}
