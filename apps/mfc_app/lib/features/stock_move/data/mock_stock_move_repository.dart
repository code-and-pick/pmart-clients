import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../domain/stock_move.dart';
import 'stock_move_repository.dart';

/// 목: 자동 보충 1건(우유 6개, 보충 칸 C-R1-01-1-01 → 선반 C-S1-02-2-05). 집어 올리기·내려놓기는 같은 키면 한 번.
final class MockStockMoveRepository implements StockMoveRepository {
  MockStockMoveRepository({this.latency = const Duration(milliseconds: 300)}) {
    _moves['MV-mock-1'] = const MoveOrderView(
      moveId: 'MV-mock-1',
      kind: MoveKind.replenish,
      state: MoveState.active,
      sku: 'E-00000001',
      lotId: 'LOT-M-1022',
      fromLocation: 'C-R1-01-1-01',
      toLocation: 'C-S1-02-2-05',
      qty: 6,
      pickedQty: 0,
      droppedQty: 0,
      onCartQty: 0,
    );
  }

  final Duration latency;
  final _moves = <String, MoveOrderView>{};
  final _keys = <String, FieldOutcome<MoveOrderView>>{};
  final _returns = <String, String>{};
  int _seq = 0;

  /// 반입된 회수품(검수 대기). 목 반품 1건: 과자(상온·미개봉) 2 + 우유(냉장) 1.
  final _received = <String, ReturnReceiptView>{
    'RRC-mock-1': const ReturnReceiptView(
      returnReceiptId: 'RRC-mock-1',
      applyStatus: 'APPLIED',
      inspected: false,
      claimId: 'clm-seed-1',
      lines: [
        ReturnedLine(
          sku: 'E-00000005',
          qty: 2,
          orderLineId: 'ol-3',
          lotId: 'RET-clm-seed-1',
          conditionNote: '고객 단순 변심, 미개봉',
          productName: '감자칩 오리지널 110g',
          zone: 'AMBIENT',
          fresh: false,
        ),
        ReturnedLine(
          sku: 'E-00000001',
          qty: 1,
          orderLineId: 'ol-2',
          lotId: 'RET-clm-seed-1',
          conditionNote: '용기 찌그러짐',
          productName: '서울우유 1L',
          zone: 'CHILLED',
          fresh: false,
        ),
      ],
    ),
  };

  /// 진행 중 이동·보충 지시(다음 작업 받기 목이 고른다).
  Iterable<MoveOrderView> get activeMoves => _moves.values.where(
    (m) => m.state == MoveState.active || m.state == MoveState.cancelPending,
  );

  /// 모든 이동 지시(센터 관리자 목 — 목록·지시·취소가 같은 지시를 본다).
  Iterable<MoveOrderView> get allMoves => _moves.values;

  MoveOrderView? moveById(String moveId) => _moves[moveId];

  /// 센터 관리자 목이 지시·취소한 결과를 넣는다.
  void putMove(MoveOrderView m) => _moves[m.moveId] = m;

  /// 검수 대기 반입 ID(다음 작업 받기 목이 고른다 — 계약에는 목록 없음, BR-52 R12).
  Iterable<String> get pendingReturnIds =>
      _received.values.where((r) => !r.inspected).map((r) => r.returnReceiptId);

  /// 품질 목이 검수를 받으면 부른다.
  void markInspected(String returnReceiptId) {
    final r = _received[returnReceiptId];
    if (r == null) return;
    _received[returnReceiptId] = ReturnReceiptView(
      returnReceiptId: r.returnReceiptId,
      applyStatus: r.applyStatus,
      inspected: true,
      claimId: r.claimId,
      lines: r.lines,
    );
  }

  Future<void> _wait() => Future<void>.delayed(latency);

  MoveOrderView _with(
    MoveOrderView m, {
    int? picked,
    int? dropped,
    String? cart,
  }) {
    final p = picked ?? m.pickedQty;
    final d = dropped ?? m.droppedQty;
    return MoveOrderView(
      moveId: m.moveId,
      kind: m.kind,
      state: d >= m.qty ? MoveState.completed : m.state,
      sku: m.sku,
      lotId: m.lotId,
      fromLocation: m.fromLocation,
      toLocation: m.toLocation,
      cartLocation: cart ?? m.cartLocation,
      qty: m.qty,
      pickedQty: p,
      droppedQty: d,
      onCartQty: p - d,
      urgent: m.urgent,
    );
  }

  @override
  Future<MoveOrderView> move(String moveId) async {
    await _wait();
    return _moves[moveId] ??
        (throw const ProblemFailure(
          Problem(status: 404, code: ProblemCode.notFound),
        ));
  }

  @override
  Future<FieldOutcome<MoveOrderView>> pickUp(
    String moveId, {
    required String cartLocation,
    required int qty,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final m = _moves[moveId]!;
    if (qty > m.toPick) return const FieldRejected(ProblemCode.invalidState);
    final n = _with(m, picked: m.pickedQty + qty, cart: cartLocation);
    _moves[moveId] = n;
    return _keys[key.value] = FieldDone(n);
  }

  @override
  Future<FieldOutcome<MoveOrderView>> drop(
    String moveId, {
    required String toLocation,
    required int qty,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final m = _moves[moveId]!;
    if (qty > m.onCartQty || toLocation != m.dropTarget) {
      return const FieldRejected(ProblemCode.invalidState);
    }
    final n = _with(m, dropped: m.droppedQty + qty);
    _moves[moveId] = n;
    return _keys[key.value] = FieldDone(n);
  }

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
    await _wait();
    return FieldDone(_returns[key.value] ??= 'RRC-mock-${++_seq}');
  }

  @override
  Future<ReturnReceiptView> returnReceipt(String returnReceiptId) async {
    await _wait();
    if (_received[returnReceiptId] case final r?) return r;
    return ReturnReceiptView(
      returnReceiptId: returnReceiptId,
      applyStatus: 'APPLIED',
      inspected: false,
    );
  }
}
