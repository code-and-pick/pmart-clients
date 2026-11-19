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

  // 피패킹 한 주문 전체(업무 고르기 → 피킹 → 패킹 → 끝) — 단계마다 한 장. 파일 이름 pp-NN-<단계>.
  testWidgets('pickpack-flow', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    Directory(_dir).createSync(recursive: true);
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
          taskRepositoryProvider.overrideWithValue(tasks),
          packingRepositoryProvider.overrideWithValue(
            MockPackingRepository(
              latency: Duration.zero,
              onShipmentReady: tasks.shipmentReady,
            ),
          ),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
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
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(
          File('$_dir/pp-${n.toString().padLeft(2, '0')}-$name.png').uri,
        ),
      );
    }

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

    // 업무 고르기 → 안내 → 받은 작업
    await shot('home');
    await tap('area-pickPack');
    await shot('guide');
    await tap('guide-ok');
    await shot('assigned');
    await tap('run-task');

    // 피킹
    await shot('pick-cart');
    await scanTo('cart-scan', 'CRT-C-02');
    final stops = [
      ('C-S1-01-1-01', MockTaskRepository.yogurtBarcode),
      ('C-S1-02-2-05', MockTaskRepository.milkBarcode),
      ('C-S2-04-1-10', MockTaskRepository.milkBarcode),
      ('F-S1-01-1-03', MockTaskRepository.dumplingBarcode),
      ('A-S3-01-1-10', MockTaskRepository.chipsBarcode),
    ];
    for (var i = 0; i < stops.length; i++) {
      final (loc, code) = stops[i];
      if (i == 0) await shot('pick-location');
      await scanTo('pick-loc-scan', loc);
      if (i == 0) {
        await shot('pick-item');
        // 결품·파손 보고 창(닫고 계속)
        await tap('report-shortage');
        await shot('pick-shortage');
        Navigator.of(t.element(find.byType(SimpleDialog))).pop();
        await t.pumpAndSettle();
      }
      await scanTo('scan-field', code);
      if (i == 0) await shot('pick-next-location');
    }
    await shot('pick-done');

    // 패킹
    await tap('to-pack');
    await shot('pack-station');
    await scanTo('station-scan', 'PAK-C-01');
    await shot('pack-cart');
    await scanTo('pack-cart-scan', 'CRT-C-02');
    await shot('pack-dispatch');
    await tap('pack-min-10');
    await tap('request-dispatch');
    await shot('pack-bag-empty');
    await scanTo('pack-scan', MockTaskRepository.yogurtBarcode);
    await scanTo('pack-scan', MockTaskRepository.milkBarcode);
    await scanTo('pack-scan', MockTaskRepository.milkBarcode);
    await shot('pack-bag-chilled');
    await tap('seal');
    await shot('pack-label');
    await t.tap(
      find
          .descendant(
            of: find.byKey(const ValueKey('label-preview')),
            matching: find.byType(TextButton),
          )
          .last,
    );
    await t.pumpAndSettle();
    await scanTo('pack-scan', MockTaskRepository.dumplingBarcode);
    await tap('seal');
    await t.tap(
      find
          .descendant(
            of: find.byKey(const ValueKey('label-preview')),
            matching: find.byType(TextButton),
          )
          .last,
    );
    await t.pumpAndSettle();
    await scanTo('pack-scan', MockTaskRepository.chipsBarcode);
    await tap('seal');
    await t.tap(
      find
          .descendant(
            of: find.byKey(const ValueKey('label-preview')),
            matching: find.byType(TextButton),
          )
          .last,
    );
    await t.pumpAndSettle();
    await shot('pack-rack');
    await scanTo('rack-scan', 'DSP-A-01');
    await shot('pack-rack-scanned');
    await tap('finish-packing');
    await shot('pack-finished');
    debugDisableShadows = true;
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

  // 입고(박스)·품질검사·재고 실사 — 단계마다 한 장. 파일 이름 fx-NN-<단계>.
  testWidgets('field-flow', (t) async {
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

    var n = 0;
    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      expect(t.takeException(), isNull, reason: name);
      n += 1;
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(
          File('$_dir/fx-${n.toString().padLeft(2, '0')}-$name.png').uri,
        ),
      );
    }

    Future<void> home() async {
      final nav = Navigator.of(t.element(find.byType(Scaffold).last));
      nav.popUntil((r) => r.isFirst);
      await t.pumpAndSettle();
    }

    // 첫 화면 → 업무 칸이 커지며 안내 화면 위 카드로(중간 세 장 — 그림이 이어서 움직이는지).
    await shot('home');
    await t.tap(find.byKey(const ValueKey('area-inbound')));
    await t.pump();
    for (final ms in [95, 95, 95]) {
      await t.pump(Duration(milliseconds: ms));
      expect(t.takeException(), isNull);
      n += 1;
      await expectLater(
        find.byType(MfcApp),
        matchesGoldenFile(
          File('$_dir/fx-${n.toString().padLeft(2, '0')}-hero-mid.png').uri,
        ),
      );
    }
    await shot('guide');

    // 입고.
    await tap('guide-ok');
    await tap('run-task');
    await shot('inbound-arrival');
    await tap('inbound-arrive');
    await shot('inbound-boxes');
    await scanTo('box-scan', 'BOX-00000001');
    await shot('inbound-box-scanned');
    await tap('box-scan-test');
    await tap('box-scan-action-all');
    await tap('box-check-done');
    await shot('inbound-open-list');
    await scanTo('box-open-scan', 'BOX-00000001');
    await scanTo('box-item-scan', '8801115114154');
    await shot('inbound-box-count');
    await home();

    // 품질검사.
    await tap('area-inspection');
    await tap('guide-ok');
    await tap('run-task');
    await shot('inspect-location');
    await scanTo('inspect-loc-scan', 'RCV-C-01');
    await shot('inspect-product');
    await scanTo('inspect-product-scan', '8801115220015');
    await shot('inspect-judge');
    await home();

    // 재고 실사.
    await tap('area-stockCount');
    await tap('guide-ok');
    await tap('run-task');
    await shot('count-location');
    await scanTo('count-loc-scan', 'A-S3-01-1-10');
    await shot('count-counting');
    await scanTo('count-item-scan', MockTaskRepository.milkBarcode);
    await shot('count-counted');
    await home();

    // 아래 도구 줄 화면들.
    for (final (key, name) in [
      ('menu-handover', 'handover-checks'),
      ('menu-return-handover', 'return-numbers'),
      ('menu-printer', 'printer'),
    ]) {
      await tap(key);
      await shot(name);
      await home();
    }
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
