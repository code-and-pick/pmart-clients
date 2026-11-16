// 화면 캡처 도구(디자인 전후 비교용). 에뮬레이터 없이 목 모드 앱을 테스트 러너로 그려 PNG 로 남긴다.
//   flutter test tool/screenshots.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
// 글꼴: 테스트 러너에는 한글 글꼴이 없어 이 PC 의 맑은 고딕을 읽는다(캡처에만 쓰고 앱에 넣지 않는다).
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/features/inbound/data/mock_inbound_repository.dart';
import 'package:mfc_app/features/inbound/presentation/inbound_controller.dart';
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/quality/data/mock_quality_repository.dart';
import 'package:mfc_app/features/stock_count/data/mock_stock_count_repository.dart';
import 'package:mfc_app/features/stock_move/data/mock_stock_move_repository.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/shared/field_repositories.dart';
import 'package:mfc_app/shared/providers.dart';

import '../test/support.dart';

const _dir = String.fromEnvironment('SHOT_DIR');

Future<void> _font(String family, List<String> paths) async {
  final loader = FontLoader(family);
  var any = false;
  for (final p in paths) {
    final f = File(p);
    if (!f.existsSync()) continue;
    loader.addFont(Future.value(ByteData.sublistView(await f.readAsBytes())));
    any = true;
  }
  if (any) await loader.load();
}

Future<void> _loadFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  await _font('MaterialIcons', [
    '$flutterRoot/bin/cache/artifacts/material_fonts/materialicons-regular.otf',
  ]);
  const win = 'C:/Windows/Fonts';
  await _font('Roboto', ['$win/malgun.ttf', '$win/malgunbd.ttf']);
}

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('picking', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    Directory(_dir).createSync(recursive: true);
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize =
          const Size(1080, 2160) // 360 x 720 @3x
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);

    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          taskRepositoryProvider.overrideWithValue(
            MockTaskRepository(latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();

    var n = 0;
    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      n += 1;
      final file = File('$_dir/${n.toString().padLeft(2, '0')}-$name.png');
      await expectLater(find.byType(MfcApp), matchesGoldenFile(file.uri));
    }

    Future<void> scanTo(String id, String code) async {
      await t.enterText(find.byKey(ValueKey(id)), code);
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pumpAndSettle();
    }

    await openRoute(t, '/tasks/task-mock-1');
    await shot('pick-cart');
    await scanTo('cart-scan', 'CRT-C-01');
    await shot('pick-location');
    await scanTo('pick-loc-scan', 'C-S1-01-1-01');
    await shot('pick-item');
    debugDisableShadows = true; // 테스트 끝 검사 전에 되돌린다.
  });

  testWidgets('move', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1080, 2160)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final stockMove = MockStockMoveRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          taskRepositoryProvider.overrideWithValue(
            MockTaskRepository(latency: Duration.zero),
          ),
          packingRepositoryProvider.overrideWithValue(
            MockPackingRepository(latency: Duration.zero),
          ),
          inboundRepositoryProvider.overrideWithValue(
            MockInboundRepository(latency: Duration.zero),
          ),
          qualityRepositoryProvider.overrideWithValue(
            MockQualityRepository(latency: Duration.zero, returns: stockMove),
          ),
          stockMoveRepositoryProvider.overrideWithValue(stockMove),
          stockCountRepositoryProvider.overrideWithValue(
            MockStockCountRepository(latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();

    Future<void> tap(String key) async {
      await t.ensureVisible(find.byKey(ValueKey(key)));
      await t.tap(find.byKey(ValueKey(key)));
      await t.pumpAndSettle();
    }

    Future<void> scanTo(String id, String code) async {
      await t.enterText(find.byKey(ValueKey(id)), code);
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pumpAndSettle();
    }

    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(File('$_dir/$name.png').uri),
      );
    }

    await tap('area-stockMove');
    await tap('guide-ok');
    await tap('run-task');
    await scanTo('move-scan', 'CRT-C-01');
    await shot('11-move-from');
    await scanTo('move-scan', 'C-R1-01-1-01');
    for (var i = 0; i < 6; i++) {
      await scanTo('move-scan', MockTaskRepository.milkBarcode);
    }
    await tap('move-submit');
    await shot('12-move-drop');
    debugDisableShadows = true;
  });

  testWidgets('supervisor', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1080, 2160)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(
              session: const EmployeeSession(
                operatorId: 'OP-mock-sup',
                roles: [EmployeeSession.mfcSupervisorRole],
                centers: ['MFC-MOCK-01'],
              ),
            ),
          ),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(File('$_dir/$name.png').uri),
      );
    }

    await shot('21-sup-home');
    await t.tap(find.byKey(const ValueKey('manage-tasks')));
    await shot('22-sup-tasks');
    Navigator.of(t.element(find.byType(Scaffold).last)).pop();
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('manage-workers')));
    await shot('23-sup-workers');
    debugDisableShadows = true;
  });

  testWidgets('setup', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1080, 2160)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(
            MockPasswordAuthRepository(), // 데모 앱과 같은 로그인
          ),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(File('$_dir/$name.png').uri),
      );
    }

    await shot('31-start');
    await t.tap(find.byKey(const ValueKey('start-setup')));
    await shot('32-setup');
    await t.tap(find.byKey(const ValueKey('setup-network')));
    await shot('33-setup-network');
    Navigator.of(t.element(find.byType(Scaffold).last)).pop();
    await t.pumpAndSettle();
    Navigator.of(t.element(find.byType(Scaffold).last)).pop();
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('start-stock')));
    await shot('34-login');
    await t.tap(find.byKey(const ValueKey('employee-login')));
    await shot('35-mock-signin');
    await t.enterText(find.byKey(const ValueKey('login-id')), 'mfcw-pp-01');
    await t.enterText(find.byKey(const ValueKey('login-password')), 'x');
    await t.pump();
    await t.tap(find.byKey(const ValueKey('mock-signin-submit')));
    for (var i = 0; i < 3; i++) {
      await t.pump(const Duration(seconds: 1));
      await t.pumpAndSettle();
    }
    await t.enterText(
      find.byKey(const ValueKey('stock-check-scan')),
      '8801115114154',
    );
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pump(const Duration(seconds: 1));
    await t.pumpAndSettle();
    await shot('36-stock-check');
    Navigator.of(t.element(find.byType(Scaffold).last)).pop();
    for (var i = 0; i < 3; i++) {
      await t.pump(const Duration(seconds: 1));
      await t.pumpAndSettle();
    }
    await shot('37-home');
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pump(const Duration(seconds: 1));
    await t.pumpAndSettle();
    await shot('38-my-work');
    debugDisableShadows = true;
  });
}
