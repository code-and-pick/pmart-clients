import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;

import 'package:mfc_app/features/inbound/domain/inbound.dart';
import 'package:mfc_app/features/quality/data/quality_repository.dart';

/// BR-53 R8·R10 (mfc-inbound 0.8.0): 입고 작업의 상품명·바코드, 송장 라벨 형식.
void main() {
  ib.InboundTask task(Map<String, dynamic> extra) => ib.InboundTask.fromJson({
    'taskId': 'TSK-INS-1',
    'taskType': 'INSPECT',
    'mfcId': 'MFC-1',
    'receiptId': 'rcp-1',
    'sku': 'S-1',
    'lotId': 'L-1',
    'locationCode': 'RCV-C-01',
    'plannedQty': 12,
    'doneQty': 0,
    'state': 'READY',
    'version': 1,
    ...extra,
  });

  test('입고 작업: 서버 상품명·바코드 전부(선행 0 보존)로 대조, 대표는 첫 번째', () {
    final v = inboundTaskFromContract(
      task({
        'productName': '서울우유 1L',
        'barcodes': ['08801115114154', '8801115114154'],
      }),
    );
    expect(v.productName, '서울우유 1L');
    expect(v.barcode, '08801115114154');
    expect(v.matchesBarcode('8801115114154'), isTrue);
    expect(v.matchesBarcode(' 08801115114154 '), isTrue);
    expect(v.matchesBarcode('8801115114155'), isFalse);
  });

  test('입고 작업: 상품명·바코드가 없거나 비면(옛 상품·조회 실패) SKU 로 — 대조할 바코드 없음', () {
    for (final extra in [
      <String, dynamic>{},
      {'productName': '  ', 'barcodes': <String>[]},
    ]) {
      final v = inboundTaskFromContract(task(extra));
      expect(v.productName, isNull);
      expect(v.barcode, isNull);
      expect(v.matchesBarcode(''), isFalse);
    }
  });

  test('송장 라벨 TRF:{trfId}:{version} — trfId 만 꺼낸다, 형식이 아니면 null', () {
    expect(trfIdFromLabel('TRF:TRF-MOCK-001:1'), 'TRF-MOCK-001');
    expect(trfIdFromLabel(' TRF:TRF-MOCK-001:7 '), 'TRF-MOCK-001');
    expect(trfIdFromLabel('TRF:a:b:3'), 'a:b');
    expect(trfIdFromLabel('TRF-MOCK-001'), isNull);
    expect(trfIdFromLabel('TRF:TRF-MOCK-001'), isNull);
    expect(trfIdFromLabel('TRF:TRF-MOCK-001:x'), isNull);
    expect(trfIdFromLabel('PKG:p-1:1'), isNull);
  });
}
