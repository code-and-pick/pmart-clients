import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/device/data/server_address.dart';
import 'package:mfc_app/shared/providers.dart';

/// 첫 화면은 기기 설정(사용자 2026-11-17) — 네트워크·프린터·스캐너·기기 정보, 아래 로그인.
void main() {
  setUpAll(initPmartFormatting);

  late MemoryKeyValueStore store;
  late List<Uri> probed;

  Future<ProviderContainer> pump(
    WidgetTester t, {
    PmartEnv env = PmartEnv.mock,
    ProbeResult probe = ProbeResult.reachable,
  }) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    store = MemoryKeyValueStore();
    probed = [];
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(env),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(signedIn: false),
          ),
          secureStoreProvider.overrideWithValue(store),
          serverProbeProvider.overrideWithValue((u) async {
            probed.add(u);
            return probe;
          }),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    return ProviderScope.containerOf(t.element(find.byType(Scaffold).first));
  }

  Future<void> tap(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  testWidgets('첫 화면: 맨 위에 로그인, 그 아래 기기 설정 4칸', (t) async {
    await pump(t);
    final login = t.getTopLeft(find.byKey(const ValueKey('employee-login')));
    final title = t.getTopLeft(find.byKey(const ValueKey('setup-title')));
    expect(login.dy, lessThan(title.dy));
    for (final k in [
      'setup-network',
      'setup-printer',
      'setup-scanner',
      'setup-device',
    ]) {
      await t.scrollUntilVisible(find.byKey(ValueKey(k)), 100);
      expect(find.byKey(ValueKey(k)), findsOneWidget, reason: k);
    }
    // 로그인하면 메인.
    await t.scrollUntilVisible(
      find.byKey(const ValueKey('employee-login')),
      -100,
    );
    await tap(t, 'employee-login');
    expect(find.byKey(const ValueKey('setup-network')), findsNothing);
    expect(find.byKey(const ValueKey('logout')), findsOneWidget);
  });

  testWidgets('네트워크: 주소를 고쳐 저장하면 실서버 요청 주소가 바뀌고, 기본값으로 되돌릴 수 있다', (t) async {
    final c = await pump(t, env: PmartEnv.local);
    expect(c.read(apiBaseUrlProvider), defaultApiBaseUrl(PmartEnv.local));
    await tap(t, 'setup-network');

    await t.enterText(find.byKey(const ValueKey('network-address')), 'a b');
    await tap(t, 'network-save');
    expect(find.text('주소 형식이 아니에요'), findsOneWidget);

    await t.enterText(
      find.byKey(const ValueKey('network-address')),
      '192.168.0.40:8080',
    );
    await tap(t, 'network-save');
    expect(c.read(apiBaseUrlProvider), 'http://192.168.0.40:8080/api/v1');
    expect(
      await t.runAsync(() => store.read(serverAddressStoreKey)),
      'http://192.168.0.40:8080/api/v1',
    );

    await tap(t, 'network-check');
    expect(probed.single.host, '192.168.0.40');
    expect(probed.single.port, 8080);
    expect(
      find.byKey(const ValueKey('network-probe-reachable')),
      findsOneWidget,
    );

    await tap(t, 'network-reset');
    expect(c.read(apiBaseUrlProvider), defaultApiBaseUrl(PmartEnv.local));
    expect(await t.runAsync(() => store.read(serverAddressStoreKey)), isNull);
  });

  testWidgets('네트워크: 닿지 않으면 Wi-Fi·주소를 확인하라고 안내', (t) async {
    await pump(t, env: PmartEnv.local, probe: ProbeResult.unreachable);
    await tap(t, 'setup-network');
    await tap(t, 'network-check');
    expect(
      find.byKey(const ValueKey('network-probe-unreachable')),
      findsOneWidget,
    );
  });

  testWidgets('목 모드 네트워크 화면은 서버를 쓰지 않는다고 알린다', (t) async {
    await pump(t);
    await tap(t, 'setup-network');
    expect(find.byKey(const ValueKey('network-mock-note')), findsOneWidget);
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

  test('주소 정리: 스킴·경로가 없으면 http·/api/v1, 주소가 아니면 null', () {
    expect(
      normalizeServerAddress(' 192.168.0.40:8080 '),
      'http://192.168.0.40:8080/api/v1',
    );
    expect(
      normalizeServerAddress('https://gw.lan:8443/'),
      'https://gw.lan:8443/api/v1',
    );
    expect(
      normalizeServerAddress('https://gw.lan/api/v1'),
      'https://gw.lan/api/v1',
    );
    expect(normalizeServerAddress(''), isNull);
    expect(normalizeServerAddress('ftp://x'), isNull);
    expect(normalizeServerAddress('a b'), isNull);
  });
}
