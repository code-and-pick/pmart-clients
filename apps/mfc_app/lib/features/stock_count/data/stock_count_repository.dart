import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../../shared/providers.dart' show sourceSystem;
import '../domain/stock_count.dart';

/// 재고 실사 업무(mfc-inventory count-sessions). 차이 승인(approvals)은 센터 관리자 전용이라 PDA 에 두지 않는다.
/// 실사 작업 배정(어느 실사를 누가 셀지)은 계약에 없다 — BR-52 R2.
abstract interface class StockCountRepository {
  /// `POST /mfcs/{mfcId}/count-sessions` — 실사 잠금된 위치의 장부를 기준 시각에 고정.
  Future<FieldOutcome<CountSessionView>> start(
    String mfcId, {
    required List<String> locationCodes,
    String? reason,
    required IdempotencyKey key,
  });

  /// `GET /mfcs/{mfcId}/count-sessions/{sessionId}`.
  Future<CountSessionView> session(String mfcId, String sessionId);

  /// `POST …/counts` — 계수·재계수 제출.
  Future<FieldOutcome<CountSessionView>> submit(
    String mfcId,
    String sessionId,
    List<CountedLine> lines, {
    required IdempotencyKey key,

    /// 계수표 밖 상품 — 계약에 받을 곳이 없어(BR-52 R19 6) 실서버에는 보내지 않는다.
    List<ExtraFind> extras = const [],
  });
}

final class ApiStockCountRepository implements StockCountRepository {
  ApiStockCountRepository(Dio dio)
    : _api = inv.PmartApiMfcInventory(dio: dio).getCountsApi();

  final inv.CountsApi _api;

  Future<FieldOutcome<CountSessionView>> _cmd(
    Future<Response<inv.CountSession>> Function() call,
  ) async {
    try {
      final res = await pmartGuard(call);
      final s = res.data;
      return s == null ? const FieldUnknown() : FieldDone(countFromContract(s));
    } on PmartFailure catch (f) {
      return fieldFailure(f);
    }
  }

  @override
  Future<FieldOutcome<CountSessionView>> start(
    String mfcId, {
    required List<String> locationCodes,
    String? reason,
    required IdempotencyKey key,
  }) => _cmd(
    () => _api.createCountSession(
      mfcId: mfcId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      createCountSessionRequest: inv.CreateCountSessionRequest(
        locationCodes: locationCodes,
        reason: reason,
      ),
      extra: commandOptions(key).extra,
    ),
  );

  @override
  Future<CountSessionView> session(String mfcId, String sessionId) async {
    final res = await pmartGuard(
      () => _api.getCountSession(mfcId: mfcId, sessionId: sessionId),
    );
    return countFromContract(
      res.data ?? (throw const ContractViolationFailure('CountSession 없음')),
    );
  }

  @override
  Future<FieldOutcome<CountSessionView>> submit(
    String mfcId,
    String sessionId,
    List<CountedLine> lines, {
    required IdempotencyKey key,
    List<ExtraFind> extras = const [],
  }) => _cmd(
    () => _api.submitCount(
      mfcId: mfcId,
      sessionId: sessionId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      submitCountRequest: inv.SubmitCountRequest(
        lines: [
          for (final l in lines)
            inv.SubmitCountRequestLinesInner(
              locationCode: l.line.locationCode,
              sku: l.line.sku,
              lotId: l.line.lotId,
              countedQty: l.countedQty,
            ),
        ],
      ),
      extra: commandOptions(key).extra,
    ),
  );
}

CountSessionView countFromContract(inv.CountSession s) {
  CountSheetLine line(
    String? loc,
    String? sku,
    String? lot, {
    String? exp,
    String? name,
    List<String>? barcodes,
  }) => CountSheetLine(
    locationCode:
        loc ?? (throw const ContractViolationFailure('locationCode 없음')),
    sku: sku ?? (throw const ContractViolationFailure('sku 없음')),
    lotId: lot ?? (throw const ContractViolationFailure('lotId 없음')),
    expiryDate: exp,
    productName: switch (name?.trim()) {
      final n? when n.isNotEmpty => n,
      _ => null,
    },
    barcodes: [
      for (final b in barcodes ?? const <String>[])
        if (b.trim().isNotEmpty) b.trim(),
    ],
  );
  return CountSessionView(
    sessionId:
        s.sessionId ?? (throw const ContractViolationFailure('sessionId 없음')),
    state: switch (s.state?.value) {
      'COUNTING' => CountState.counting,
      'RECOUNT_REQUIRED' => CountState.recountRequired,
      'PENDING_APPROVAL' => CountState.pendingApproval,
      'MATCHED' => CountState.matched,
      'ADJUSTED' => CountState.adjusted,
      'REJECTED' => CountState.rejected,
      _ => CountState.unknown,
    },
    locationCodes: s.locationCodes ?? const [],
    sheet: [
      for (final l in s.sheet ?? const <inv.CountSessionSheetInner>[])
        line(
          l.locationCode,
          l.sku,
          l.lotId,
          exp: l.expiryDate,
          name: l.productName,
          barcodes: l.barcodes,
        ),
    ],
    differences: s.differences == null
        ? null
        : [
            for (final d in s.differences!)
              CountDifference(
                line: line(d.locationCode, d.sku, d.lotId),
                bookQty: d.bookQty ?? 0,
                heldQty: d.heldQty ?? 0,
                countedQty: d.countedQty ?? 0,
                deltaQty: d.deltaQty ?? 0,
              ),
          ],
    firstCounter: s.firstCounter,
    recounter: s.recounter,
    version: s.version,
  );
}
