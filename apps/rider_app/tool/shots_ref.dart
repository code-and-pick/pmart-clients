// 레퍼런스(사용자 2026-11-25 캡처 5장) 비교용: 홈·배차 제안·픽업·전달·마이페이지만. 에뮬레이터 없이 목 모드 앱을 테스트 러너로 그려 PNG 로 남긴다.
//   flutter test tool/screenshots.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
// 글꼴: 테스트 러너에는 한글 글꼴이 없어 이 PC 의 맑은 고딕을 읽는다(캡처에만 쓰고 앱에 넣지 않는다).
// 지도는 카카오 지도가 아니라 약도 자리표시로 나온다(테스트 러너에는 지도 SDK 가 없다).
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/auth/presentation/postcode_screen.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

const _dir = String.fromEnvironment('SHOT_DIR');

Future<void> _font(String family, List<String> paths) async {
  final loader = FontLoader(family);
  var any = false;
  for (final p in paths) {
    final f = File(p);
    if (!f.existsSync()) continue;
    final bytes = await f.readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
    any = true;
  }
  if (any) await loader.load();
}

Future<void> _loadFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await _font('MaterialIcons', ['$material/materialicons-regular.otf']);
  const win = 'C:/Windows/Fonts';
  await _font('Roboto', ['$win/malgun.ttf', '$win/malgunbd.ttf']);
  // 앱 글꼴(pubspec fonts) — 테스트 러너는 앱 글꼴을 자동으로 읽지 않는다.
  await _font('Pretendard', [
    'assets/fonts/Pretendard-Regular.otf',
    'assets/fonts/Pretendard-SemiBold.otf',
    'assets/fonts/Pretendard-Bold.otf',
  ]);
}

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('screens', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    Directory(_dir).createSync(recursive: true);
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1125, 2436)
      ..devicePixelRatio = 3
      // 레퍼런스(아이폰 375×812)와 같은 판: 위 상태바 44·아래 막대 34
      ..padding = const FakeViewPadding(top: 132, bottom: 102)
      ..viewPadding = const FakeViewPadding(top: 132, bottom: 102);
    addTearDown(t.view.reset);

    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
      mode: DispatchMode.aiRecommended,
    );
    final deliveries = MockDeliveryRepository(
      latency: Duration.zero,
      visible: (id) => offers.assignedDeliveries.contains(id),
    );
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          addressSearchProvider.overrideWithValue(
            (_) async => const PickedAddress(
              roadAddress: '부산 부산진구 동천로 109',
              label: '부산 부산진구 동천로 109',
            ),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(deliveries),
          handoverRepositoryProvider.overrideWithValue(deliveries),
          evidenceUploaderProvider.overrideWithValue(deliveries),
          recordsRepositoryProvider.overrideWithValue(
            MockRecordsRepository(latency: Duration.zero),
          ),
          signupRepositoryProvider.overrideWithValue(
            MockSignupRepository(latency: Duration.zero),
          ),
        ],
        child: const RiderApp(),
      ),
    );

    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await t.pump(const Duration(milliseconds: 100));
      }
    }

    var n = 0;
    Future<void> shot(String name) async {
      await settle();
      n += 1;
      final file = File('$_dir/${n.toString().padLeft(2, '0')}-$name.png');
      await expectLater(find.byType(RiderApp), matchesGoldenFile(file.uri));
    }

    Future<void> tap(String key) async {
      await t.tap(find.byKey(ValueKey(key)));
      await settle();
    }

    GoRouter router() => GoRouter.of(t.element(find.byType(Scaffold).last));
    await shot('home-off-duty');
    await tap('start-duty');
    await shot('home-offer');
    await tap('offer-detail-offer-mock-1');
    await shot('offer-detail');
    router().pop();
    await settle();
    await tap('new-dispatch');
    await shot('home-new-dispatch-off');
    await tap('new-dispatch');
    await tap('accept-offer-mock-1');
    await t.pump(const Duration(seconds: 5)); // 안내 띠가 내려갈 때까지
    await shot('home-active');
    await tap('delivery-list');
    await shot('delivery-list');
    router().pop();
    await settle();
    // 홈에 배송 시트가 바로 뜬다.
    await shot('delivery-1-to-store');
    await tap('sheet-handle'); // 펼치면 배달 정보·가게 도착
    await shot('delivery-1-open');
    await tap('arrive-store');
    await shot('delivery-2-at-store');
    await tap('qr-pickup');
    await shot('qr-pickup');
    Future<void> label(String pkg) async {
      await t.enterText(
        find.byKey(const ValueKey('qr-number')),
        MockDeliveryRepository.labelNumbers[pkg]!,
      );
      await tap('qr-number-submit');
    }

    await label('pkg-1');
    await shot('qr-pickup-partial');
    await label('pkg-2');
    await tap('pickup');
    await shot('delivery-3-picked-up');
    await tap('photo');
    await shot('photo');
    await tap('upload-photo');
    await shot('delivery-5-photo-done');
    await tap('complete');
    await shot('complete-dialog');
    await tap('complete-confirm');
    await shot('delivery-done');
    await tap('done-close');

    await tap('my-page');
    await shot('my-page');
    debugDisableShadows = true;
  });

  testWidgets('bundle offer', (t) async {
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1125, 2436)
      ..devicePixelRatio = 3
      // 레퍼런스(아이폰 375×812)와 같은 판: 위 상태바 44·아래 막대 34
      ..padding = const FakeViewPadding(top: 132, bottom: 102)
      ..viewPadding = const FakeViewPadding(top: 132, bottom: 102);
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(
      latency: Duration.zero,
      demoBundle: true,
      mode: DispatchMode.aiRecommended,
    );
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await t.pump(const Duration(milliseconds: 100));
      }
    }

    await settle();
    await t.tap(find.byKey(const ValueKey('reject-offer-mock-1')));
    await settle();
    await expectLater(
      find.byType(RiderApp),
      matchesGoldenFile(File('$_dir/30-home-bundle.png').uri),
    );
    // 남은 제안을 모두 거절하면 위쪽 "적합한 배달을 찾고 있어요" 띠
    for (final id in ['offer-bundle-1', 'offer-return-1']) {
      await t.tap(find.byKey(ValueKey('reject-$id')));
      await settle();
    }
    await expectLater(
      find.byType(RiderApp),
      matchesGoldenFile(File('$_dir/31-home-searching.png').uri),
    );
    debugDisableShadows = true;
  });
}
