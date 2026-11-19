// 카카오·네이버 로그인·휴대폰 본인 확인(OCTOMO) 화면 캡처 — 목 모드(실서버와 같은 화면, 목 데이터).
//   flutter test tool/screenshots_identity.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
// 목 번호: 01012345678 확인됨, 01055550000 아직 안 옴, 01044440000 서버 혼잡, 01033330000 만료, 01022220000 하루 초과,
// 01099990000 카카오 계정 있음, 01099990001 네이버 계정 있음, 01077770000 탈퇴 30일.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
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

  Future<void> run(
    WidgetTester t,
    String prefix,
    Future<void> Function(
      Future<void> Function(String) shot,
      Future<void> Function(String) tap,
      Future<void> Function(String phone) toIdentity,
    )
    body,
  ) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    Directory(_dir).createSync(recursive: true);
    await t.runAsync(_loadFonts);
    debugDisableShadows = false;
    t.view
      ..physicalSize = const Size(1080, 2340)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
      mode: DispatchMode.aiRecommended,
    );
    final deliveries = MockDeliveryRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
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
      for (var i = 0; i < 12; i++) {
        await t.pump(const Duration(milliseconds: 100));
      }
    }

    Future<void> shot(String name) async {
      await settle();
      await expectLater(
        find.byType(RiderApp),
        matchesGoldenFile(File('$_dir/$prefix-$name.png').uri),
      );
    }

    Future<void> tap(String key) async {
      await t.ensureVisible(find.byKey(ValueKey(key)));
      await t.tap(find.byKey(ValueKey(key)));
      await settle();
    }

    Future<void> toIdentity(String phone) async {
      await tap('login-apply');
      await tap('signup-start');
      for (final c in SignupOptions.consents.where((c) => c.required)) {
        await t.tap(find.byKey(ValueKey('consent-${c.type}')));
      }
      await settle();
      await tap('signup-next');
      await t.enterText(find.byKey(const ValueKey('signup-phone')), phone);
      await t.enterText(find.byKey(const ValueKey('signup-name')), '홍길동');
      await settle();
      await tap('phone-check');
    }

    await body(shot, tap, toIdentity);
    debugDisableShadows = true; // 테스트 불변식(그림자 디버그 변수 원래대로)
  }

  testWidgets(
    '01 로그인 — 구글·카카오·네이버',
    (t) => run(t, '01', (shot, tap, to) => shot('login')),
  );
  testWidgets(
    '02 본인 확인 — 시작·보냈어요·확인됨',
    (t) => run(t, '02', (shot, tap, to) async {
      await to('01012345678');
      await shot('a-start');
      await tap('phone-id-sent');
      await shot('b-verified');
    }),
  );
  testWidgets(
    '03 본인 확인 — 아직 안 옴',
    (t) => run(t, '03', (shot, tap, to) async {
      await to('01055550000');
      await tap('phone-id-sent');
      await shot('not-yet');
    }),
  );
  testWidgets(
    '04 본인 확인 — 서버 혼잡',
    (t) => run(t, '04', (shot, tap, to) async {
      await to('01044440000');
      await tap('phone-id-sent');
      await shot('busy');
    }),
  );
  testWidgets(
    '05 본인 확인 — 만료',
    (t) => run(t, '05', (shot, tap, to) async {
      await to('01033330000');
      await tap('phone-id-sent');
      await shot('expired');
    }),
  );
  testWidgets(
    '06 본인 확인 — 하루 초과',
    (t) => run(t, '06', (shot, tap, to) async {
      await to('01022220000');
      await shot('daily-limit');
    }),
  );
  testWidgets(
    '07 이 번호로 가입한 계정 — 카카오',
    (t) => run(t, '07', (shot, tap, to) async {
      await to('01099990000');
      await shot('existing-kakao');
    }),
  );
  testWidgets(
    '08 이 번호로 가입한 계정 — 네이버',
    (t) => run(t, '08', (shot, tap, to) async {
      await to('01099990001');
      await shot('existing-naver');
    }),
  );
  testWidgets(
    '09 탈퇴 30일',
    (t) => run(t, '09', (shot, tap, to) async {
      await to('01077770000');
      await shot('rejoin-blocked');
    }),
  );
}
