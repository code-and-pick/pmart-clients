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
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
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
}
