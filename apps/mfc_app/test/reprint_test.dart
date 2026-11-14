import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:mfc_app/l10n/gen/app_localizations.dart';
import 'package:mfc_app/shared/printer/label.dart';
import 'package:mfc_app/shared/printer/label_printer.dart';
import 'package:mfc_app/shared/printer/reprint.dart';
import 'package:mfc_app/shared/providers.dart';
import 'package:mfc_app/shared/scanner/scan_input.dart';
import 'package:mfc_app/shared/scanner/scanner.dart';

/// 상품 바코드 스티커 재출력(사용자 2026-11-14: 작업자 확인만, 상품 스캔하는 모든 화면).
void main() {
  test('ZPL: Code 128 로 바코드 원문 그대로, SKU 는 글자로', () {
    final z = productBarcodeLabelZpl(
      const ProductBarcodeLabel(
        sku: 'E-00000001',
        barcode: '8801115114154',
        productName: '서울우유 1L',
      ),
    );
    expect(z, startsWith('^XA'));
    expect(z.trim(), endsWith('^XZ'));
    expect(z, contains(r'^BCN,220,Y,N,N^FH\^FD8801115114154^FS'));
    expect(z, contains('SKU E-00000001'));
    // 라벨 기본 글꼴에 한글이 없어 상품명은 찍지 않는다.
    expect(z, isNot(contains(r'\EC\84')));
  });

  late List<String> sent;
  late MemoryKeyValueStore store;

  Future<void> pump(
    WidgetTester t, {
    required List<ReprintTarget>? reprint,
    PmartEnv env = PmartEnv.mock,
  }) async {
    sent = [];
    store = MemoryKeyValueStore();
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(env),
          secureStoreProvider.overrideWithValue(store),
          rawPrintSenderProvider.overrideWithValue(
            (host, port, bytes) async => sent.add(utf8.decode(bytes)),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Column(
              children: [
                ScanInput(
                  id: 'p',
                  label: '상품',
                  cameraTitle: '상품',
                  reprint: reprint,
                  onScan: (_) => const ScanFeedback.ok(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await t.pumpAndSettle();
  }

  testWidgets('위치·카트 같은 자리(null)에는 버튼이 없다', (t) async {
    await pump(t, reprint: null);
    expect(find.byKey(const ValueKey('p-reprint')), findsNothing);
  });

  testWidgets('한 상품: 실물 확인 → 미리보기에 같은 바코드(이름·바코드는 상품 정보에서)', (t) async {
    await pump(t, reprint: const [ReprintTarget(sku: 'E-00000001')]);
    await t.tap(find.byKey(const ValueKey('p-reprint')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('reprint-confirm')), findsOneWidget);
    expect(find.text('서울우유 1L'), findsOneWidget);
    expect(find.text('바코드 8801115114154'), findsOneWidget);

    // "아니에요" → 뽑지 않는다.
    await t.tap(find.byKey(const ValueKey('reprint-no')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('barcode-label-preview')), findsNothing);

    await t.tap(find.byKey(const ValueKey('p-reprint')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('reprint-yes')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('barcode-label-preview')), findsOneWidget);
    expect(find.text('8801115114154'), findsOneWidget);
    expect(sent, isEmpty); // 미리보기 모드
  });

  testWidgets('여러 상품: 먼저 고르고, 네트워크 프린터면 ZPL 을 보낸다', (t) async {
    await pump(
      t,
      reprint: const [
        ReprintTarget(sku: 'E-00000001'),
        ReprintTarget(sku: 'X-1', name: '두부', barcode: '1234567890128'),
      ],
    );
    final c = ProviderScope.containerOf(
      t.element(find.byKey(const ValueKey('p-reprint'))),
    );
    await c.read(printerSettingsProvider.future);
    await c
        .read(printerSettingsProvider.notifier)
        .save(
          const PrinterSettings(mode: PrinterMode.networkZpl, host: '10.0.0.9'),
        );
    await t.tap(find.byKey(const ValueKey('p-reprint')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('reprint-pick')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('reprint-pick-X-1')));
    await t.pumpAndSettle();
    expect(find.text('두부'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('reprint-yes')));
    await t.pumpAndSettle();
    expect(sent.single, contains('^FD1234567890128^FS'));
    expect(find.text('프린터로 보냈어요. 스티커를 붙이고 다시 찍어 주세요.'), findsOneWidget);
  });

  testWidgets('바코드 값을 모르면(실서버 응답에 없음) 뽑지 않는다', (t) async {
    await pump(
      t,
      env: PmartEnv.local,
      reprint: const [ReprintTarget(sku: 'E-00000001', name: '우유')],
    );
    await t.tap(find.byKey(const ValueKey('p-reprint')));
    await t.pumpAndSettle();
    expect(find.text('다시 뽑을 수 없어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('reprint-yes')), findsNothing);
  });
}
