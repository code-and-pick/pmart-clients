import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';
import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/kakao_naver_token_sources.dart';
import 'package:rider_app/features/auth/data/phone_identity.dart';
import 'package:rider_app/features/auth/data/rider_auth.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/router.dart';
import 'package:rider_app/shared/providers.dart';

final class _NoGoogle implements GoogleIdTokenSource {
  int calls = 0;

  @override
  Future<String?> obtain({bool withdrawal = false}) async {
    calls++;
    return null;
  }

  @override
  Future<void> signOut({bool revoke = false}) async {}

  @override
  Future<void> abandonSignup() async {}
}

/// 카카오·네이버 로그인(목) · 휴대폰 본인 확인(OCTOMO, 목) · 이 번호로 가입한 계정 안내 · 재가입 제한.
void main() {
  setUpAll(initPmartFormatting);

  late MockPhoneIdentityRepository identity;

  setUp(() {
    identity = MockPhoneIdentityRepository(delay: Duration.zero);
  });

  Widget app({PmartEnv env = PmartEnv.mock, RiderSession? session}) {
    final offers = MockOfferRepository(latency: Duration.zero);
    return ProviderScope(
      retry: (_, _) => null,
      overrides: [
        envProvider.overrideWithValue(env),
        initialSessionProvider.overrideWithValue(session),
        secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        offerRepositoryProvider.overrideWithValue(offers),
        dutyRepositoryProvider.overrideWithValue(offers),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(latency: Duration.zero, seeded: false),
        ),
        phoneIdentityRepositoryProvider.overrideWithValue(identity),
      ],
      child: const RiderApp(),
    );
  }

  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
  }

  /// 안내(토스트) 타이머까지 흘려 보낸다.
  Future<void> drain(WidgetTester t) async {
    await t.pump(const Duration(seconds: 6));
    await settle(t);
  }

  Future<void> tap(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await settle(t);
  }

  ProviderContainer containerOf(WidgetTester t) =>
      ProviderScope.containerOf(t.element(find.byType(RiderApp)));

  group('로그인 화면 제공자', () {
    testWidgets('목 모드: 구글 아래 카카오·네이버 순서로 보인다', (t) async {
      await t.pumpWidget(app());
      await settle(t);
      final google = find.byKey(const ValueKey('login-google'));
      final kakao = find.byKey(const ValueKey('login-kakao'));
      final naver = find.byKey(const ValueKey('login-naver'));
      expect(google, findsOneWidget);
      expect(kakao, findsOneWidget);
      expect(naver, findsOneWidget);
      expect(find.text('카카오로 로그인'), findsOneWidget);
      expect(find.text('네이버로 로그인'), findsOneWidget);
      expect(t.getTopLeft(google).dy, lessThan(t.getTopLeft(kakao).dy));
      expect(t.getTopLeft(kakao).dy, lessThan(t.getTopLeft(naver).dy));
    });

    testWidgets('실서버(local): rider-auth 가 GOOGLE 만 받아 카카오·네이버 버튼이 없다', (
      t,
    ) async {
      await t.pumpWidget(app(env: PmartEnv.local));
      await settle(t);
      expect(find.byKey(const ValueKey('login-google')), findsOneWidget);
      expect(find.byKey(const ValueKey('login-kakao')), findsNothing);
      expect(find.byKey(const ValueKey('login-naver')), findsNothing);
    });

    test('실서버 버튼: 서버가 받고 키가 있을 때만', () {
      expect(serverSocialProviders(), [RiderSocialProvider.google]);
      expect(
        serverSocialProviders(
          serverAccepts: false,
          kakaoKey: 'k',
          naverClientId: 'n',
        ),
        [RiderSocialProvider.google],
      );
      expect(
        serverSocialProviders(
          serverAccepts: true,
          kakaoKey: 'k',
          naverClientId: '',
        ),
        [RiderSocialProvider.google, RiderSocialProvider.kakao],
      );
      expect(
        serverSocialProviders(
          serverAccepts: true,
          kakaoKey: 'k',
          naverClientId: 'n',
        ),
        RiderSocialProvider.values,
      );
    });

    test('카카오·네이버 토큰 소스가 붙지 않은 로그인은 서버·SDK 를 부르지 않는다', () async {
      final google = _NoGoogle();
      final login = RiderLogin(
        dio: Dio(),
        tokens: TokenStore(MemoryKeyValueStore()),
        deviceId: DeviceIdProvider(MemoryKeyValueStore()),
        google: google,
      );
      expect(
        await login.login(provider: RiderSocialProvider.kakao),
        isA<RiderLoginUnsupported>(),
      );
      expect(
        await login.login(provider: RiderSocialProvider.naver),
        isA<RiderLoginUnsupported>(),
      );
      expect(google.calls, 0);
    });

    for (final key in ['login-kakao', 'login-naver']) {
      testWidgets('목 모드 $key 로 로그인하면 홈으로 간다', (t) async {
        await t.pumpWidget(app());
        await settle(t);
        await tap(t, key);
        expect(containerOf(t).read(sessionProvider), isNotNull);
        expect(find.byKey(const ValueKey('new-dispatch')), findsOneWidget);
      });
    }
  });

  group('휴대폰 본인 확인(목)', () {
    const signingUp = RiderSession(riderId: 'rider-new', registered: false);

    Future<Future<String?>> open(WidgetTester t, String phone) async {
      await t.pumpWidget(app(session: signingUp));
      await settle(t);
      final result = containerOf(t)
          .read(routerProvider)
          .push<String>('/signup/phone', extra: phone);
      await settle(t);
      return result;
    }

    testWidgets('보낼 내용·대표번호를 보이고, 보냈어요 → 확인되면 확인 ID 로 닫힌다', (t) async {
      final result = await open(t, '01012345678');
      expect(find.text('본인 확인'), findsOneWidget);
      expect(find.text(MockPhoneIdentityRepository.sendTo), findsOneWidget);
      expect(find.text('010-****-5678'), findsOneWidget);
      expect(find.byKey(const ValueKey('phone-id-open-sms')), findsOneWidget);
      await tap(t, 'phone-id-open-sms'); // 시험에서는 문자 앱을 열지 않는다
      await tap(t, 'phone-id-sent');
      expect(await result, isNotNull);
      expect(identity.confirmCalls, 1);
      await drain(t);
    });

    testWidgets('아직 안 왔으면 남은 횟수, 확인 서버 혼잡(503)이면 같은 키로 다시', (t) async {
      identity.script.addAll([
        MockConfirmStep.notYet,
        MockConfirmStep.busy,
        MockConfirmStep.verified,
      ]);
      final result = await open(t, '01012345678');
      await tap(t, 'phone-id-sent');
      expect(find.text('보낸 뒤 다시 눌러 주세요 · 남은 횟수 4번'), findsOneWidget);
      await tap(t, 'phone-id-sent');
      expect(find.text('잠시 뒤 다시 눌러 주세요 · 횟수는 그대로예요'), findsOneWidget);
      // 혼잡 뒤에도 "보냈어요"는 다시 누를 수 있다(자동으로 되풀이해 부르지 않는다).
      expect(identity.confirmCalls, 2);
      await tap(t, 'phone-id-sent');
      expect(await result, isNotNull);
      // 결과를 받은 누름 뒤에는 새 키, 503 뒤 다시 누름은 같은 키.
      expect(identity.confirmKeys[1], isNot(identity.confirmKeys[0]));
      expect(identity.confirmKeys[2], identity.confirmKeys[1]);
      await drain(t);
    });

    testWidgets('시간이 지나면 다시 시작해야 하고, 다시 시작하면 새 문자', (t) async {
      identity.script.add(MockConfirmStep.expired);
      final result = await open(t, '01012345678');
      await tap(t, 'phone-id-sent');
      expect(find.text('확인 시간이 지났어요'), findsOneWidget);
      expect(find.byKey(const ValueKey('phone-id-sent')), findsNothing);
      await tap(t, 'phone-id-restart');
      expect(find.byKey(const ValueKey('phone-id-sent')), findsOneWidget);
      await tap(t, 'phone-id-sent');
      expect(await result, isNotNull);
      await drain(t);
    });

    testWidgets('이 번호로 가입한 계정이 있으면 제공자·가입일·가린 이메일과 그 제공자 로그인', (t) async {
      // 세션이 바뀌면 화면 묶음이 통째로 바뀌어 이 화면의 결과(Future)는 끝나지 않는다 — 기다리지 않는다.
      await open(t, '01099990000');
      expect(find.text('이미 가입한 번호예요'), findsOneWidget);
      expect(
        t.widget<Text>(find.byKey(const ValueKey('existing-provider'))).data,
        '카카오',
      );
      expect(
        t.widget<Text>(find.byKey(const ValueKey('existing-joined'))).data,
        '2026-03-02', // 서버 시각(UTC 03-01 15:00)을 서울 날짜로
      );
      expect(
        t.widget<Text>(find.byKey(const ValueKey('existing-email'))).data,
        'ri***@kakao.com',
      );
      expect(find.text('카카오로 로그인'), findsOneWidget);
      // 가입 중 세션을 끝내고 카카오로 다시 로그인 → 가입한 계정이라 홈.
      await tap(t, 'login-kakao');
      final session = containerOf(t).read(sessionProvider);
      expect(session, isNotNull);
      expect(session!.registered, isTrue);
      expect(find.byKey(const ValueKey('new-dispatch')), findsOneWidget);
      expect(find.byKey(const ValueKey('existing-account')), findsNothing);
    });

    testWidgets('네이버로 가입한 번호면 네이버로 로그인 버튼', (t) async {
      await open(t, '01099990001');
      expect(
        t.widget<Text>(find.byKey(const ValueKey('existing-provider'))).data,
        '네이버',
      );
      expect(find.byKey(const ValueKey('login-naver')), findsOneWidget);
      expect(find.byKey(const ValueKey('login-kakao')), findsNothing);
      await tap(t, 'existing-other-phone');
      expect(find.byKey(const ValueKey('existing-account')), findsNothing);
    });

    testWidgets('탈퇴한 번호는 서버가 준 날부터 다시 가입할 수 있다고 안내', (t) async {
      final result = await open(t, '01077770000');
      expect(find.text('탈퇴한 번호예요'), findsOneWidget);
      expect(find.text('2026-12-19부터 다시 가입할 수 있어요'), findsOneWidget);
      await tap(t, 'rejoin-ok');
      expect(await result, isNull);
    });

    testWidgets('시작 거절: 010 이 아닌 번호·하루 횟수 초과는 안내만(문자 화면 없음)', (t) async {
      await open(t, '01022220000');
      expect(find.text('오늘은 더 확인할 수 없어요'), findsOneWidget);
      expect(find.byKey(const ValueKey('phone-id-sent')), findsNothing);
    });

    testWidgets('010 이 아닌 번호는 확인할 수 없다고 안내', (t) async {
      await open(t, '01112345678');
      expect(find.text('010 휴대폰 번호만 확인할 수 있어요'), findsOneWidget);
      expect(identity.confirmCalls, 0);
    });
  });

  test('본인 확인 저장소: 실서버는 Api(rider 0.17.0), 목은 목 구현', () {
    final c = ProviderContainer(
      overrides: [envProvider.overrideWithValue(PmartEnv.local)],
    );
    addTearDown(c.dispose);
    expect(
      c.read(phoneIdentityRepositoryProvider),
      isA<ApiPhoneIdentityRepository>(),
    );
    final m = ProviderContainer(
      overrides: [envProvider.overrideWithValue(PmartEnv.mock)],
    );
    addTearDown(m.dispose);
    expect(
      m.read(phoneIdentityRepositoryProvider),
      isA<MockPhoneIdentityRepository>(),
    );
  });

  test('네이버(OIDC+PKCE): Client ID 가 없으면 브라우저를 열지 않고 설정 문제로 알린다, redirect_uri 는 게이트웨이 중계 주소(앱으로 com.pmart.rider 302)', () async {
    expect(
      naverRedirectUrl,
      'http://192.168.0.40:8080/api/v1/auth/oauth-callbacks/naver/rider',
    );
    var opened = false;
    await expectLater(
      NaverIdTokenSource(
        clientId: '  ',
        exchange: _noExchange,
        authorize: (_) async {
          opened = true;
          return null;
        },
      ).obtain(),
      throwsA(isA<RiderLoginMisconfigured>()),
    );
    expect(opened, isFalse);
  });

  group('네이버 서버 교환(BR-69, rider-auth 0.3.0)', () {
    final granted = (code: 'CODE-1', codeVerifier: 'v' * 43);

    test('인가 코드만 받고 서버가 바꾼 id_token 을 쓴다 — redirectUri 는 중계 주소 그대로', () async {
      final calls = <(String, String)>[];
      final token = await NaverIdTokenSource(
        clientId: 'CID',
        authorize: (_) async => granted,
        exchange:
            ({
              required authorizationCode,
              required codeVerifier,
              required redirectUri,
              required key,
              bool withdrawal = false,
            }) async {
              calls.add((authorizationCode, redirectUri));
              return 'ID-TOKEN';
            },
      ).obtain();
      expect(token, 'ID-TOKEN');
      expect(calls, [('CODE-1', naverRedirectUrl)]);
    });

    test('결과 불명이면 같은 키로 한 번만 더', () async {
      final keys = <String>[];
      final token = await NaverIdTokenSource(
        clientId: 'CID',
        authorize: (_) async => granted,
        exchange:
            ({
              required authorizationCode,
              required codeVerifier,
              required redirectUri,
              required key,
              bool withdrawal = false,
            }) async {
              keys.add(key.value);
              if (keys.length == 1) throw const UnknownResultFailure();
              return 'ID-TOKEN';
            },
      ).obtain();
      expect(token, 'ID-TOKEN');
      expect(keys, hasLength(2));
      expect(keys.toSet(), hasLength(1));
    });

    test(
      '서버에 secret 이 없으면(422 CONFIG_REQUIRED) 설정 문제, 네이버 거절(401)은 장애로',
      () async {
        NaverIdTokenSource failing(int status, String code) =>
            NaverIdTokenSource(
              clientId: 'CID',
              authorize: (_) async => granted,
              exchange:
                  ({
                    required authorizationCode,
                    required codeVerifier,
                    required redirectUri,
                    required key,
                    bool withdrawal = false,
                  }) async => throw ProblemFailure(
                    Problem.fromJson({
                      'type': 'about:blank',
                      'title': code,
                      'status': status,
                      'code': code,
                    }, httpStatus: status),
                  ),
            );
        await expectLater(
          failing(422, ProblemCode.configRequired).obtain(),
          throwsA(isA<RiderLoginMisconfigured>()),
        );
        await expectLater(
          failing(401, 'PROVIDER_REJECTED').obtain(),
          throwsA(isA<RiderLoginUnavailable>()),
        );
      },
    );

    test('라이더가 네이버 화면을 닫으면 서버에 보내지 않고 취소', () async {
      final token = await NaverIdTokenSource(
        clientId: 'CID',
        authorize: (_) async => null,
        exchange: _noExchange,
      ).obtain();
      expect(token, isNull);
    });
  });
}

Future<String> _noExchange({
  required String authorizationCode,
  required String codeVerifier,
  required String redirectUri,
  required IdempotencyKey key,
  bool withdrawal = false,
}) async => throw StateError('부르면 안 된다');
