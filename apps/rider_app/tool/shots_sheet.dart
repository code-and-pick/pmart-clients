// 홈 배송 시트 — 끝까지 펼친 모양·내용을 내려 고정 머리줄이 뜬 모양 캡처(2026-11-24 시트 위쪽 잘림·종 가림 비교용).
//   flutter test tool/shots_sheet.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

const _dir = String.fromEnvironment('SHOT_DIR');

Future<void> _font(String family, List<String> paths) async {
  final loader = FontLoader(family);
  for (final p in paths) {
    final f = File(p);
    if (!f.existsSync()) continue;
    loader.addFont(Future.value(ByteData.sublistView(await f.readAsBytes())));
  }
  await loader.load();
}

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('delivery sheet', (t) async {
    if (_dir.isEmpty) fail('SHOT_DIR 필요');
    Directory(_dir).createSync(recursive: true);
    await t.runAsync(() async {
      final root = Platform.environment['FLUTTER_ROOT'] ?? '';
      await _font('MaterialIcons', [
        '$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf',
      ]);
      await _font('Roboto', ['C:/Windows/Fonts/malgun.ttf']);
      await _font('Pretendard', [
        'assets/fonts/Pretendard-Regular.otf',
        'assets/fonts/Pretendard-SemiBold.otf',
        'assets/fonts/Pretendard-Bold.otf',
      ]);
    });
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1080, 2340)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
    );
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero),
          ),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 20; i++) {
        await t.pump(const Duration(milliseconds: 50));
      }
    }

    await settle();
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle();
    await expectLater(
      find.byType(RiderApp),
      matchesGoldenFile(File('$_dir/sheet-open.png').uri),
    );
    await t.dragFrom(const Offset(180, 450), const Offset(0, -260));
    await settle();
    await expectLater(
      find.byType(RiderApp),
      matchesGoldenFile(File('$_dir/sheet-pinned.png').uri),
    );
    // 그림자 끄기 값을 시험 전으로 돌려 둔다(안 그러면 시험 틀이 실패로 본다)
    debugDisableShadows = true;
  });
}
