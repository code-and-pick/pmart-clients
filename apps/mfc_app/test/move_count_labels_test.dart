import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_mfc_inbound/pmart_api_mfc_inbound.dart' as ib;
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;

import 'package:mfc_app/features/stock_count/data/stock_count_repository.dart';
import 'package:mfc_app/features/stock_move/data/stock_move_repository.dart';
import 'package:mfc_app/l10n/gen/app_localizations_ko.dart';
import 'package:mfc_app/shared/field_widgets.dart';

/// BR-52 R19-1 (mfc-inbound 0.9.0 MoveOrder, mfc-inventory 0.16.0 CountSession.sheet[]): 상품명·바코드.
/// BR-52 R2 (mfc-inbound 0.9.0): 담당이 있는 입고 작업은 담당만 — 409 NOT_ASSIGNEE.
void main() {
  ib.MoveOrder move(Map<String, dynamic> extra) => ib.MoveOrder.fromJson({
    'moveId': 'MV-1',
    'kind': 'REPLENISH',
    'mfcId': 'MFC-1',
    'sku': 'S-1',
    'lotId': 'L-1',
    'fromLocation': 'A-01-01',
    'toLocation': 'P-01-01',
    'qty': 6,
    'state': 'ACTIVE',
    ...extra,
  });

  test('이동 지시: 서버 상품명·바코드 전부(선행 0 보존)로 대조, 대표는 첫 번째', () {
    final m = moveFromContract(
      move({
        'productName': ' 두부 300g ',
        'barcodes': ['08801234567893', '8801234567893', '  '],
      }),
    );
    expect(m.productName, '두부 300g');
    expect(m.barcodes, ['08801234567893', '8801234567893']);
    expect(m.barcode, '08801234567893');
    expect(m.matchesBarcode(' 8801234567893 '), isTrue);
    expect(m.matchesBarcode('8801234567894'), isFalse);
  });

  test('이동 지시: 상품명·바코드가 없으면(옛 상품·조회 실패) null·빈 배열', () {
    final m = moveFromContract(move({}));
    expect(m.productName, isNull);
    expect(m.barcode, isNull);
    expect(m.matchesBarcode(''), isFalse);
  });

  test('실사 계수표: 줄마다 상품명·바코드, 없으면 null·빈 배열', () {
    final s = countFromContract(
      inv.CountSession.fromJson({
        'sessionId': 'CNT-1',
        'state': 'COUNTING',
        'locationCodes': ['A-01-01'],
        'sheet': [
          {
            'locationCode': 'A-01-01',
            'sku': 'S-1',
            'lotId': 'L-1',
            'productName': '서울우유 1L',
            'barcodes': ['8801115114154'],
          },
          {
            'locationCode': 'A-01-01',
            'sku': 'S-2',
            'lotId': 'L-2',
            'productName': null,
            'barcodes': <String>[],
          },
        ],
      }),
    );
    expect(s.sheet[0].productName, '서울우유 1L');
    expect(s.sheet[0].matchesBarcode('8801115114154'), isTrue);
    expect(s.sheet[1].productName, isNull);
    expect(s.sheet[1].barcodes, isEmpty);
  });

  test('거절 문구: 담당 아님은 따로, 나머지는 코드와 함께', () {
    final l10n = AppLocalizationsKo();
    expect(fieldRejectedText(l10n, 'NOT_ASSIGNEE'), l10n.startNotAssignee);
    expect(
      fieldRejectedText(l10n, 'INVALID_STATE'),
      l10n.inspectRejected('INVALID_STATE'),
    );
  });
}
