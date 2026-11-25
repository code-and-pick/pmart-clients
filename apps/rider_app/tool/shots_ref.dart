// 레퍼런스(사용자 2026-11-25 캡처 5장) 비교용: 홈·배차 제안·픽업·전달·마이페이지만. 에뮬레이터 없이 목 모드 앱을 테스트 러너로 그려 PNG 로 남긴다.
//   flutter test tool/screenshots.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
// 글꼴: 테스트 러너에는 한글 글꼴이 없어 이 PC 의 맑은 고딕을 읽는다(캡처에만 쓰고 앱에 넣지 않는다).
// 지도는 카카오 지도가 아니라 약도 자리표시로 나온다(테스트 러너에는 지도 SDK 가 없다).
import 'dart:async';
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
import 'package:rider_app/features/auth/presentation/signup_screens.dart'
    show AreaSheet;
import 'package:rider_app/shared/mfc_directory.dart' show MfcRegion;
import 'package:rider_app/features/auth/presentation/postcode_screen.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/profile.dart'
    show LocationArea, LocationState;
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/my/presentation/phone_verify_prompt.dart'
    show PhoneVerifyDialog;
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/features/inquiries/data/inquiries.dart';
import 'package:rider_app/features/my/presentation/area_change.dart'
    show AreaChangeScreen;
import 'package:rider_app/features/auth/data/pickup_points.dart'
    show areaOptionsProvider;

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
    // 지원센터 캡처용 문의 두 건(목).
    final inquiriesRepo = MockInquiryRepository(latency: Duration.zero);
    await t.runAsync(() async {
      await inquiriesRepo.create(
        InquiryKind.settlement,
        title: '지급일이 언제인가요?',
        body: '11월 24일 배달한 수행료 지급일이 궁금해요.',
        key: IdempotencyKey.generate(),
      );
      await inquiriesRepo.create(
        InquiryKind.appError,
        title: '지도가 가끔 하얗게 나와요',
        body: '배송 중에 지도가 안 보일 때가 있어요.',
        key: IdempotencyKey.generate(),
      );
    });
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          inquiryRepositoryProvider.overrideWithValue(inquiriesRepo),
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
    // 내 정보(사용자 2026-11-25 '라이더님 ›').
    await tap('my-name');
    await shot('my-info');
    await tap('info-vehicle');
    await shot('my-info-vehicle');
    await tap('vehicle-motorcycle');
    await shot('my-info-license');
    // 지원센터(문의·소명이의 탭).
    router().go('/my/inquiries');
    await shot('support');
    router().go('/my');
    await settle();
    final container = ProviderScope.containerOf(
      t.element(find.byType(Scaffold).last),
    );
    final areas = (await t.runAsync(
      () => container.read(areaOptionsProvider.future),
    ))!;
    final all = areas.values.expand((l) => l).toList();
    final cur = all.firstWhere(
      (a) => a.mfcId == 'MFC-BSJ-01',
      orElse: () => all.first,
    );
    final other = areas[cur.region]!.firstWhere((a) => a.mfcId != cur.mfcId);
    {
      final nav = Navigator.of(t.element(find.byType(Scaffold).last));
      nav.push(
        MaterialPageRoute<void>(
          builder: (_) => AreaChangeScreen(
            current: cur,
            areas: areas,
            // 지금 위치 권역(rider 0.27.0) — 현 지역·고른 지점 말고는 "지역 밖"
            here: LocationArea(
              state: LocationState.fresh,
              mfcIds: {cur.mfcId, other.mfcId},
            ),
          ),
        ),
      );
      await settle();
      await t.tap(find.byKey(ValueKey('area-${other.name}')));
      await shot('area-change');
      nav.pop();
      await settle();
      // 가입 배달 지역: 거주지(부산)와 다른 권역 지점 → 선택완료에서 팝업(2026-11-25)
      final mokpo = areas[MfcRegion.jeolla]!.first;
      unawaited(
        showModalBottomSheet<void>(
          context: t.element(find.byType(Scaffold).last),
          isScrollControlled: true,
          builder: (_) => AreaSheet(areas: areas, residence: '부산 부산진구 동천로 109'),
        ),
      );
      await settle();
      await tap('area-jeolla');
      await tap('area-confirm');
      await tap('area-${mokpo.name}');
      await tap('area-confirm');
      await shot('signup-area-dialog');
      await tap('area-residence-ok');
      Navigator.of(t.element(find.byKey(const ValueKey('area-confirm')))).pop();
      await settle();
    }
    // 전화번호 인증 안 한 기존 가입자 팝업(2026-11-25) — 홈 위에
    router().go('/');
    await settle();
    unawaited(
      showDialog<bool>(
        context: t.element(find.byType(Scaffold).last),
        barrierDismissible: false,
        builder: (_) => const PhoneVerifyDialog(),
      ),
    );
    await shot('phone-verify-dialog');
    await tap('phone-verify-later');
    unawaited(router().push('/my/phone-verify'));
    await settle();
    await t.enterText(
      find.byKey(const ValueKey('phone-verify-input')),
      '01012345678',
    );
    await shot('phone-verify-screen');
    // 가입 완료(2026-11-25 사용자 사진대로)
    router().go('/signup/done');
    await settle();
    await t.runAsync(
      () => precacheImage(
        const AssetImage('assets/images/signup_done.png'),
        t.element(find.byType(Scaffold).last),
      ),
    );
    await shot('signup-done');

    router().go('/my/inquiries/new');
    await shot('support-new');
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
