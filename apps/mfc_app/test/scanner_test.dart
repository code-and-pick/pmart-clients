import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/l10n/gen/app_localizations.dart';
import 'package:mfc_app/features/handover/data/mock_handover_repository.dart';
import 'package:mfc_app/features/handover/domain/handover.dart';
import 'package:mfc_app/features/handover/presentation/handover_controller.dart';
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/router.dart';
import 'package:mfc_app/shared/providers.dart';
import 'package:mfc_app/shared/scanner/scan_input.dart';
import 'package:mfc_app/shared/scanner/scanner.dart';

import 'support.dart';

/// 카메라 대신 정해 둔 코드를 차례로 넘긴다.
final class FakeCameraScanner implements CameraScanner {
  FakeCameraScanner(this.codes);

  final List<String> codes;
  final feedback = <ScanFeedback>[];
  String? title;
  bool? continuous;

  @override
  Future<void> open(
    BuildContext context, {
    required ScanHandler onScan,
    required String title,
    bool continuous = true,
  }) async {
    this.title = title;
    this.continuous = continuous;
    for (final c in codes) {
      final f = onScan(c);
      feedback.add(f);
      if (f.ok && !continuous) break;
    }
  }
}

void main() {
  setUpAll(initPmartFormatting);

  group('ScanDedup', () {
    final t0 = DateTime.utc(2026, 11, 10);
    Duration ms(int n) => Duration(milliseconds: n);

    test('다른 코드는 바로 받는다', () {
      final d = ScanDedup();
      expect(d.accept('A', t0), isTrue);
      expect(d.accept('B', t0.add(ms(10))), isTrue);
      expect(d.accept('A', t0.add(ms(20))), isTrue);
    });

    test('계속 비추고 있는 같은 코드는 창이 지나도 다시 받지 않는다', () {
      final d = ScanDedup(window: ms(1500));
      expect(d.accept('A', t0), isTrue);
      for (var i = 1; i <= 10; i++) {
        expect(d.accept('A', t0.add(ms(500 * i))), isFalse);
      }
    });

    test('같은 코드도 창만큼 안 보였다가 다시 보이면 받는다(두 번째 상품)', () {
      final d = ScanDedup(window: ms(1500));
      expect(d.accept('A', t0), isTrue);
      expect(d.accept('A', t0.add(ms(1500))), isTrue);
    });

    test('빈 코드는 받지 않는다', () {
      expect(ScanDedup().accept('  ', t0), isFalse);
    });
  });

  group('parsePackageQr', () {
    test('PKG:<id>:<버전>', () {
      expect(parsePackageQr('PKG:pkg-1:2'), (packageId: 'pkg-1', version: 2));
      expect(parsePackageQr(' PKG:a:b:3 '), (packageId: 'a:b', version: 3));
    });

    test('형식이 아니면 null', () {
      for (final s in [
        '',
        '8801115114154',
        'PKG:',
        'PKG::1',
        'PKG:pkg-1',
        'PKG:pkg-1:v1',
        'PKG:pkg-1:0',
        'PMART-PKG:pkg-1:v1',
      ]) {
        expect(parsePackageQr(s), isNull, reason: s);
      }
    });
  });

  late FakeCameraScanner camera;
  late MockHandoverRepository handovers;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    taskRepositoryProvider.overrideWithValue(
      MockTaskRepository(latency: Duration.zero),
    ),
    packingRepositoryProvider.overrideWithValue(
      MockPackingRepository(latency: Duration.zero),
    ),
    handoverRepositoryProvider.overrideWithValue(handovers),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
    cameraScannerProvider.overrideWith((_) => camera),
  ];

  setUp(() => handovers = MockHandoverRepository(latency: Duration.zero));

  Future<void> pumpApp(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: overrides(),
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  testWidgets('피킹: 카메라 스캔도 같은 대조 — 다른 상품은 거절 안내, 맞는 상품은 담김', (t) async {
    camera = FakeCameraScanner([
      MockTaskRepository.milkBarcode,
      MockTaskRepository.yogurtBarcode,
    ]);
    await pumpApp(t);
    // 작업 상세 없이 — 열면 시작 판정을 받고 바로 피킹.
    await openRoute(t, '/tasks/task-mock-1');
    for (final (id, code) in [
      ('cart-scan', 'CRT-C-01'),
      ('pick-loc-scan', 'C-S1-01-1-01'),
    ]) {
      await t.enterText(find.byKey(ValueKey(id)), code);
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pumpAndSettle();
    }

    // 긴 스캔 칸을 누르면 카메라(카메라 단추는 없다)
    await t.tap(find.byKey(const ValueKey('scan-field')));
    await t.pumpAndSettle();
    expect(camera.title, '피킹 상품 스캔');
    // 한 번 맞게 인식하면 카메라를 내린다(사용자 2026-11-17). 틀린 인식은 안내만 하고 창을 둔다.
    expect(camera.continuous, isFalse);
    expect(camera.feedback.map((f) => f.ok), [false, true]);
    expect(camera.feedback.first.message, isNotNull);
    // 맞는 상품이 담겨 칸 몫(1개)이 차면 바로 보낸다 — 다음 칸 지시.
    expect(
      t.widget<Text>(find.byKey(const ValueKey('pick-location'))).data,
      'C-S1-02-2-05',
    );
  });

  testWidgets('인계 확인: 포장 QR 카메라 스캔 → 그 포장 인계 상태, 옛 라벨 경고', (t) async {
    camera = FakeCameraScanner(['hello', 'PKG:pkg-chk-1:2']);
    await pumpApp(t);
    await t.tap(find.byKey(const ValueKey('menu-handover')));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const ValueKey('package-qr-scan')));
    await t.pumpAndSettle();
    expect(camera.continuous, isFalse);
    expect(camera.feedback.map((f) => f.ok), [false, true]);
    expect(camera.feedback.first.message, '포장 QR이 아니에요');

    expect(find.text('포장 인계 상태'), findsOneWidget);
    expect(find.byKey(const ValueKey('check-required')), findsOneWidget);
    // 찍은 라벨 v2, 지금 포장 v1.
    expect(find.byKey(const ValueKey('stale-label')), findsOneWidget);
  });

  testWidgets('인계 확인: 키보드 웨지로 포장 QR 입력 → 같은 버전이면 경고 없음', (t) async {
    camera = FakeCameraScanner(const []);
    await pumpApp(t);
    unawaited(
      ProviderScope.containerOf(t.element(find.byType(Scaffold).first))
          .read(routerProvider)
          .push<void>('/handover-checks'),
    );
    await t.pumpAndSettle();

    await t.enterText(
      find.byKey(const ValueKey('package-qr-scan')),
      'PKG:pkg-chk-2:1',
    );
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
    expect(find.text('포장 인계 상태'), findsOneWidget);
    expect(find.text('놓인 위치: PAK-C-01'), findsOneWidget);
    expect(find.byKey(const ValueKey('stale-label')), findsNothing);
  });

  testWidgets('테스트 값 드롭다운은 목 모드에서만 — 고르면 실제 스캔과 같은 처리', (t) async {
    final got = <String>[];
    Widget app(PmartEnv env) => ProviderScope(
      overrides: [envProvider.overrideWithValue(env)],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('ko'),
        home: Scaffold(
          body: ScanInput(
            id: 'x',
            label: 'scan',
            cameraTitle: 'scan',
            autofocus: false,
            testValues: const [TestScan('다음', 'BOX-00000001')],
            onScan: (c) {
              got.add(c);
              return const ScanFeedback.ok();
            },
          ),
        ),
      ),
    );
    await t.pumpWidget(app(PmartEnv.local));
    expect(find.byKey(const ValueKey('x-test')), findsNothing);
    await t.pumpWidget(app(PmartEnv.mock));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('x-test')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('x-test-BOX-00000001')));
    await t.pumpAndSettle();
    expect(got, ['BOX-00000001']);
  });

  testWidgets(
    '스캔 받는 자리는 타이핑 칸이 아니다 — 화면 키보드·커서·붙여넣기 없음, 스캐너(글자 + Enter)는 그대로 받는다',
    (t) async {
      final got = <String>[];
      await t.pumpWidget(
        ProviderScope(
          overrides: [envProvider.overrideWithValue(PmartEnv.local)],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            locale: const Locale('ko'),
            home: Scaffold(
              body: ScanInput(
                id: 'x',
                label: '출발 칸',
                cameraTitle: 'scan',
                onScan: (c) {
                  got.add(c);
                  return const ScanFeedback.ok();
                },
              ),
            ),
          ),
        ),
      );
      await t.pumpAndSettle();

      final field = t.widget<TextField>(find.byKey(const ValueKey('x')));
      expect(field.keyboardType, TextInputType.none); // 화면 키보드를 띄우지 않는다
      expect(field.showCursor, isFalse);
      expect(field.enableInteractiveSelection, isFalse); // 붙여넣기 메뉴 없음
      // 안내는 한 줄 — 넘긴 label 만(고정 힌트를 겹쳐 두 줄로 자르지 않는다).
      expect(find.text('출발 칸'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('x-camera')),
        findsNothing,
      ); // 카메라 단추 없음 — 칸을 누르면 카메라

      // 키보드 웨지: 글자가 들어오고 Enter.
      await t.enterText(find.byKey(const ValueKey('x')), 'LOC-A-01');
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pump();
      expect(got, ['LOC-A-01']);
      expect(field.controller!.text, isEmpty); // 다음 스캔을 받게 비운다
    },
  );
}
