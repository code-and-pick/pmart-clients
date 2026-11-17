import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/stock_check/data/stock_check_repository.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

/// 재고 확인(사용자 2026-11-17 시작 메뉴 · 홈 메뉴줄) — 상품을 찍으면 LOT·칸별 재고(보기만).
void main() {
  setUpAll(initPmartFormatting);

  Future<void> pump(WidgetTester t, {bool signedIn = false}) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(signedIn: signedIn),
          ),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          stockCheckRepositoryProvider.overrideWithValue(
            MockStockCheckRepository(latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> tap(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  Future<void> scan(WidgetTester t, String code) async {
    await t.enterText(find.byKey(const ValueKey('stock-check-scan')), code);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
  }

  testWidgets('시작 메뉴 재고 확인: 로그인 화면 → 로그인되면 바로 재고 확인, 뒤로 가면 메인', (t) async {
    await pump(t);
    await tap(t, 'start-stock');
    expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
    await tap(t, 'employee-login');
    expect(find.byKey(const ValueKey('stock-check-idle')), findsOneWidget);

    await scan(t, '8801115114154'); // 우유
    expect(find.text('서울우유 1L'), findsOneWidget);
    expect(find.byKey(const ValueKey('stock-lot-LOT-M-1022')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('stock-line-C-R1-01-1-01-LOT-M-1022')),
      findsOneWidget,
    );
    expect(find.text('20개'), findsOneWidget);
    expect(find.textContaining('격리 · 보관'), findsOneWidget);

    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('menu-stock')), findsOneWidget);
  });

  testWidgets('홈 메뉴줄 재고 확인: 모르는 바코드·재고 없는 상품은 그렇다고 알린다', (t) async {
    await pump(t, signedIn: true);
    await tap(t, 'menu-stock');
    await scan(t, '0000000000000');
    expect(find.byKey(const ValueKey('stock-check-unknown')), findsOneWidget);
    await scan(t, '8801019606557'); // 감자칩 — 재고 없음
    expect(find.byKey(const ValueKey('stock-check-none')), findsOneWidget);
  });

  test('계약 → 화면 모델: 서버 값 그대로(합계를 앱이 만들지 않는다)', () {
    final v = stockFromContract(
      inv.CenterStock.fromJson({
        'mfcId': 'MFC-1',
        'sku': 'E-1',
        'lots': [
          {
            'lotId': 'L-1',
            'expiryDate': '2026-12-01',
            'onHand': 5,
            'available': 3,
          },
        ],
        'units': [
          {
            'locationCode': 'C-S1-01-1-01',
            'lotId': 'L-1',
            'qualityState': 'QUARANTINED',
            'workState': 'STORED',
            'qty': 2,
          },
        ],
      }),
    );
    expect(v.lots.single.onHand, 5);
    expect(v.lots.single.reserved, isNull);
    expect(v.lots.single.expiryDate, '2026-12-01');
    expect(v.lines.single.qualityState, 'QUARANTINED');
    expect(v.lines.single.qty, 2);
  });
}
