import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;
import 'package:pmart_api_product/pmart_api_product.dart' as prod;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/codes.dart';
import '../../../shared/providers.dart';

/// 재고 확인(사용자 2026-11-17 시작 메뉴 "재고 확인") — 상품을 찍으면 이 센터의 LOT·칸별 재고.
/// mfc-inventory `GET /mfcs/{mfcId}/stock?sku=`(백오피스 재고 메뉴와 같은 API). 보기만 한다.
/// 계약상 사용자 종류는 OPERATOR — 작업자(MFC_WORKER) 역할로 되는지는 서버가 판정한다(403 이면 권한 안내).
/// 칸으로 찾기는 API 가 없다(MB-1).

/// LOT 요약(서버 값 그대로 — 앱이 더하거나 빼지 않는다).
@immutable
class StockLot {
  const StockLot({
    required this.lotId,
    this.expiryDate,
    this.onHand,
    this.sellable,
    this.quarantined,
    this.reserved,
    this.available,
  });

  final String lotId;
  final String? expiryDate;
  final int? onHand;
  final int? sellable;
  final int? quarantined;
  final int? reserved;
  final int? available;
}

/// 칸·LOT·상태별 한 줄.
@immutable
class StockLine {
  const StockLine({
    required this.locationCode,
    required this.lotId,
    required this.qty,
    this.qualityState,
    this.workState,
  });

  final String locationCode;
  final String lotId;
  final int qty;

  /// 계약 값 그대로(NORMAL·QUARANTINED…). 화면이 문구로 바꾼다.
  final String? qualityState;
  final String? workState;
}

@immutable
class StockView {
  const StockView({required this.sku, required this.lots, required this.lines});

  final String sku;
  final List<StockLot> lots;
  final List<StockLine> lines;

  bool get isEmpty => lots.isEmpty && lines.isEmpty;
}

StockView stockFromContract(inv.CenterStock s) => StockView(
  sku: s.sku,
  lots: [
    for (final l in s.lots)
      StockLot(
        lotId: l.lotId ?? (throw const ContractViolationFailure('lotId 없음')),
        expiryDate: l.expiryDate?.toString(),
        onHand: l.onHand,
        sellable: l.sellable,
        quarantined: l.quarantined,
        reserved: l.reserved,
        available: l.available,
      ),
  ],
  lines: [
    for (final u in s.units)
      StockLine(
        locationCode:
            u.locationCode ??
            (throw const ContractViolationFailure('locationCode 없음')),
        lotId: u.lotId ?? (throw const ContractViolationFailure('lotId 없음')),
        qty: u.qty ?? 0,
        qualityState: u.qualityState?.name,
        workState: u.workState?.name,
      ),
  ],
);

abstract interface class StockCheckRepository {
  /// 찍은 값 → SKU. SKU 코드면 그대로, 상품 바코드면 product `resolveBarcode`. 모르는 바코드면 null.
  Future<String?> resolveSku(String code);

  /// `GET /mfcs/{mfcId}/stock?sku=`.
  Future<StockView> centerStock(String mfcId, String sku);
}

final class ApiStockCheckRepository implements StockCheckRepository {
  ApiStockCheckRepository(Dio dio)
    : _stock = inv.PmartApiMfcInventory(dio: dio).getQueriesApi(),
      _barcodes = prod.PmartApiProduct(dio: dio).getBarcodesApi();

  final inv.QueriesApi _stock;
  final prod.BarcodesApi _barcodes;

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
  Future<StockView> centerStock(String mfcId, String sku) async {
    final res = await pmartGuard(
      () => _stock.getCenterStock(mfcId: mfcId, sku: sku),
    );
    return stockFromContract(
      res.data ?? (throw const ContractViolationFailure('CenterStock 없음')),
    );
  }
}

/// 목 재고. 우유는 보충 칸·진열 칸·격리, 요거트는 진열 칸 하나, 감자칩은 재고 없음.
final class MockStockCheckRepository implements StockCheckRepository {
  MockStockCheckRepository({this.latency = const Duration(milliseconds: 300)});

  final Duration latency;

  static const _barcodes = {
    '8801115114154': 'E-00000001',
    '8801115220015': 'E-00000002',
    '8801019606557': 'E-00000005',
  };

  static const _stock = <String, StockView>{
    'E-00000001': StockView(
      sku: 'E-00000001',
      lots: [
        StockLot(
          lotId: 'LOT-M-1022',
          expiryDate: '2026-11-20',
          onHand: 26,
          sellable: 24,
          quarantined: 2,
          reserved: 3,
          available: 21,
        ),
      ],
      lines: [
        StockLine(
          locationCode: 'C-R1-01-1-01',
          lotId: 'LOT-M-1022',
          qty: 20,
          qualityState: 'NORMAL',
          workState: 'STORED',
        ),
        StockLine(
          locationCode: 'C-S1-02-2-05',
          lotId: 'LOT-M-1022',
          qty: 4,
          qualityState: 'NORMAL',
          workState: 'STORED',
        ),
        StockLine(
          locationCode: 'C-Q1-01-1-01',
          lotId: 'LOT-M-1022',
          qty: 2,
          qualityState: 'QUARANTINED',
          workState: 'STORED',
        ),
      ],
    ),
    'E-00000002': StockView(
      sku: 'E-00000002',
      lots: [
        StockLot(
          lotId: 'LOT-Y-1024',
          expiryDate: '2026-11-25',
          onHand: 10,
          sellable: 10,
          quarantined: 0,
          reserved: 0,
          available: 10,
        ),
      ],
      lines: [
        StockLine(
          locationCode: 'C-S1-01-1-01',
          lotId: 'LOT-Y-1024',
          qty: 10,
          qualityState: 'NORMAL',
          workState: 'STORED',
        ),
      ],
    ),
  };

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<String?> resolveSku(String code) async {
    await _wait();
    final c = code.trim();
    if (isSku(c)) return c;
    return _barcodes[c];
  }

  @override
  Future<StockView> centerStock(String mfcId, String sku) async {
    await _wait();
    return _stock[sku] ?? StockView(sku: sku, lots: const [], lines: const []);
  }
}

final stockCheckRepositoryProvider = Provider<StockCheckRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockStockCheckRepository(),
    PmartEnv.local => ApiStockCheckRepository(ref.watch(dioProvider)),
  },
);
