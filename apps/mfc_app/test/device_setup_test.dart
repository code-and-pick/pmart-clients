import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/shared/providers.dart';

/// 첫 화면은 기기 설정(사용자 2026-11-17) — 프린터·스캐너·기기 정보, 아래 로그인.
/// 서버 주소 바꾸기(네트워크)는 두지 않는다(사용자 2026-11-17 — 주소는 빌드 값만).
void main() {
  setUpAll(initPmartFormatting);

  late MemoryKeyValueStore store;

  Future<ProviderContainer> pump(
    WidgetTester t, {
    PmartEnv env = PmartEnv.mock,
    bool openSetup = true,
  }) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    store = MemoryKeyValueStore();
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(env),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(signedIn: false),
          ),
          secureStoreProvider.overrideWithValue(store),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    final c = ProviderScope.containerOf(t.element(find.byType(Scaffold).first));
    if (openSetup) {
      await t.tap(find.byKey(const ValueKey('start-setup')));
      await t.pumpAndSettle();
    }
    return c;
  }

  Future<void> tap(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  testWidgets('시작 메뉴: 로그인 · 기기 설정 · 재고 확인 — 로그인은 로그인 화면으로, 뒤로 오면 다시 시작 메뉴', (
    t,
  ) async {
    await pump(t, openSetup: false);
    for (final k in ['start-login', 'start-setup', 'start-stock']) {
      expect(find.byKey(ValueKey(k)), findsOneWidget, reason: k);
    }
    expect(find.byKey(const ValueKey('employee-login')), findsNothing);
    await tap(t, 'start-login');
    expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('start-setup')), findsOneWidget);

    await tap(t, 'start-setup');
    for (final k in ['setup-printer', 'setup-scanner', 'setup-device']) {
      expect(find.byKey(ValueKey(k)), findsOneWidget, reason: k);
    }
  });

  testWidgets('스캐너 확인: 찍은 값이 그대로 보인다', (t) async {
    await pump(t);
    await tap(t, 'setup-scanner');
    expect(find.byKey(const ValueKey('scanner-check-empty')), findsOneWidget);
    await t.enterText(
      find.byKey(const ValueKey('scanner-check')),
      'C-S1-03-2-04',
    );
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
    expect(find.text('C-S1-03-2-04'), findsOneWidget);
    expect(find.text('1번 읽음'), findsOneWidget);
  });

  testWidgets('프린터·기기 정보도 로그인 없이 열린다', (t) async {
    await pump(t);
    await tap(t, 'setup-printer');
    expect(find.text('프린터 설정'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await tap(t, 'setup-device');
    expect(find.byKey(const ValueKey('device-mode')), findsOneWidget);
  });
}
