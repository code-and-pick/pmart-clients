// 마이페이지·알림함·문의·소명 화면만 캡처(레이아웃 비교용).
//   flutter test tool/shots_inbox.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/appeals/data/appeals.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/inquiries/data/inquiries.dart';
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

  testWidgets('inbox screens', (t) async {
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
    final offers = MockOfferRepository(latency: Duration.zero);
    var now = DateTime.now().subtract(const Duration(hours: 3));
    final inquiries = MockInquiryRepository(
      latency: Duration.zero,
      clock: () => now,
    );
    await t.runAsync(
      () => inquiries.create(
        InquiryKind.settlement,
        title: '11월 2주차 정산 금액이 달라요',
        body: '배달 12건인데 정산내역에는 11건으로 나와요. 확인 부탁드려요.',
        key: IdempotencyKey.generate(),
      ),
    );
    now = DateTime.now();
    await t.runAsync(
      () => inquiries.create(
        InquiryKind.appError,
        title: '사진 올리기가 자꾸 실패해요',
        body: '전달 완료 사진을 올리면 계속 다시 시도하라고 나와요.',
        key: IdempotencyKey.generate(),
      ),
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
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
          appealRepositoryProvider.overrideWithValue(
            MockAppealRepository(latency: Duration.zero),
          ),
          inquiryRepositoryProvider.overrideWithValue(inquiries),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await t.pump(const Duration(milliseconds: 100));
      }
    }

    GoRouter router() => GoRouter.of(t.element(find.byType(Scaffold).last));
    Future<void> shot(String path, String name) async {
      router().go(path);
      await settle();
      await expectLater(
        find.byType(RiderApp),
        matchesGoldenFile(File('$_dir/$name.png').uri),
      );
    }

    await settle();
    await shot('/my', '1-my');
    await shot('/notifications', '2-notifications');
    await shot('/my/inquiries', '3-inquiries');
    await shot('/my/appeals', '4-appeals');
    debugDisableShadows = true;
  });
}
