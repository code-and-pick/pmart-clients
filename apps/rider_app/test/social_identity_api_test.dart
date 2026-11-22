import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';
import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/phone_identity.dart';
import 'package:rider_app/features/auth/data/rider_auth.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/mfc_directory.dart';
import 'package:rider_app/shared/providers.dart';

/// 실서버 연결(rider-auth 0.2.0 · rider 0.17.0, 백엔드 #250) — 요청 모양·응답/오류 → 화면 결과.
/// 서버는 부르지 않는다(가짜 어댑터가 계약 모양의 JSON 을 돌려준다).
Dio _dio(FakeAdapter a) =>
    Dio(BaseOptions(baseUrl: 'http://fake/api/v1'))..httpClientAdapter = a;

Map<String, Object?> _problem(
  String code, {
  required int status,
  List<Map<String, String>> details = const [],
}) => {...problemBody(code, status: status), 'details': details};

Map<String, Object?> _bodyOf(RequestOptions o) => switch (o.data) {
  final String s => jsonDecode(s) as Map<String, Object?>,
  final Map<String, Object?> m => m,
  final other => jsonDecode(jsonEncode(other)) as Map<String, Object?>,
};

const _started = {
  'verificationId': 'RPV-1',
  'sendTo': '1666-3538',
  'text': '123456',
  'expiresAt': '2026-11-20T03:10:00Z',
  'phoneMasked': '010-****-5678',
  'maxAttempts': 5,
};

Map<String, Object?> _view(String state, {int remaining = 4}) => {
  'verificationId': 'RPV-1',
  'state': state,
  'remainingAttempts': remaining,
  'expiresAt': '2026-11-20T03:10:00Z',
};

final class _Source implements SocialTokenSource {
  _Source(this.token);
  final String? token;
  int calls = 0;
  int signOuts = 0;

  @override
  Future<String?> obtain({bool withdrawal = false}) async {
    calls++;
    return token;
  }

  @override
  Future<void> signOut({bool revoke = false}) async => signOuts++;

  @override
  Future<void> abandonSignup() async {}
}

final class _Google extends _Source implements GoogleIdTokenSource {
  _Google() : super('google-id-token');
}

void main() {
  group('본인 확인 Api 저장소', () {
    test('시작: 번호·멱등키·출처를 보내고 응답을 화면 모델로', () async {
      final a = FakeAdapter(
        (o, _) async => const FakeReply(200, body: _started),
      );
      final repo = ApiPhoneIdentityRepository(_dio(a));
      final key = IdempotencyKey.generate();
      final s = await repo.start('01012345678', key);
      final req = a.requests.single;
      expect(req.method, 'POST');
      expect(req.uri.path, '/api/v1/riders/me/phone-verifications');
      expect(req.headers['Idempotency-Key'], key.value);
      expect(req.headers['X-Source-System'], sourceSystem);
      expect(_bodyOf(req), {'phone': '01012345678'});
      expect(s.verificationId, 'RPV-1');
      expect(s.sendTo, '1666-3538');
      expect(s.text, '123456');
      expect(s.phoneMasked, '010-****-5678');
      expect(s.maxAttempts, 5);
      expect(s.expiresAt, DateTime.utc(2026, 11, 20, 3, 10));
    });

    test(
      '시작 409 IDENTITY_ALREADY_REGISTERED → 다른 계정 안내(제공자·가입일·가린 이메일)',
      () async {
        final a = FakeAdapter(
          (o, _) async => FakeReply.problem(
            409,
            _problem(
              'IDENTITY_ALREADY_REGISTERED',
              status: 409,
              details: [
                {'field': 'provider', 'reason': 'KAKAO'},
                {'field': 'emailMasked', 'reason': 'a***@k***'},
                {'field': 'joinedAt', 'reason': '2026-03-01T15:00:00Z'},
              ],
            ),
          ),
        );
        final repo = ApiPhoneIdentityRepository(_dio(a));
        await expectLater(
          repo.start('01012345678', IdempotencyKey.generate()),
          throwsA(
            isA<PhoneIdentityStartEnded>().having(
              (e) => e.outcome,
              'outcome',
              isA<PhoneIdentityAlreadyRegistered>()
                  .having(
                    (o) => o.account.provider,
                    'provider',
                    RiderSocialProvider.kakao,
                  )
                  .having(
                    (o) => o.account.joinedAt,
                    'joinedAt',
                    DateTime.utc(2026, 3, 1, 15),
                  )
                  .having((o) => o.account.emailMasked, 'email', 'a***@k***'),
            ),
          ),
        );
      },
    );

    test('다른 계정 details 에 수단·이메일이 없으면 null(지어내지 않는다)', () {
      final o = identityConflictOf(
        const Problem(
          status: 409,
          code: 'IDENTITY_ALREADY_REGISTERED',
          details: [
            ProblemDetail(field: 'joinedAt', reason: '2026-03-01T15:00:00Z'),
          ],
        ),
      );
      expect(o, isA<PhoneIdentityAlreadyRegistered>());
      final account = (o! as PhoneIdentityAlreadyRegistered).account;
      expect(account.provider, isNull);
      expect(account.emailMasked, isNull);
      expect(account.joinedAt, DateTime.utc(2026, 3, 1, 15));
    });

    test('시작 409 RIDER_REJOIN_BLOCKED → 다시 가입할 수 있는 때(until)', () async {
      final a = FakeAdapter(
        (o, _) async => FakeReply.problem(
          409,
          _problem(
            'RIDER_REJOIN_BLOCKED',
            status: 409,
            details: [
              {'field': 'until', 'reason': '2026-12-18T15:00:00Z'},
            ],
          ),
        ),
      );
      await expectLater(
        ApiPhoneIdentityRepository(_dio(a))
            .start('01012345678', IdempotencyKey.generate()),
        throwsA(
          isA<PhoneIdentityStartEnded>().having(
            (e) => (e.outcome as PhoneIdentityRejoinBlocked).until,
            'until',
            DateTime.utc(2026, 12, 18, 15),
          ),
        ),
      );
    });

    for (final (code, status, reason) in [
      ('PHONE_NOT_SUPPORTED', 400, PhoneIdentityStartRejection.notSupported),
      ('TOO_MANY_VERIFICATIONS', 429, PhoneIdentityStartRejection.tooMany),
      ('CONFIG_REQUIRED', 422, PhoneIdentityStartRejection.notReady),
    ]) {
      test('시작 $status $code → $reason', () async {
        final a = FakeAdapter(
          (o, _) async =>
              FakeReply.problem(status, _problem(code, status: status)),
        );
        await expectLater(
          ApiPhoneIdentityRepository(_dio(a))
              .start('01012345678', IdempotencyKey.generate()),
          throwsA(
            isA<PhoneIdentityStartRejected>().having(
              (e) => e.reason,
              'reason',
              reason,
            ),
          ),
        );
      });
    }

    test('확인: 같은 번호를 다시 보내고 state 를 결과로', () async {
      final states = ['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED'];
      final a = FakeAdapter(
        (o, i) async => FakeReply(200, body: _view(states[i], remaining: 3)),
      );
      final repo = ApiPhoneIdentityRepository(_dio(a));
      final key = IdempotencyKey.generate();
      final first = await repo.confirm('RPV-1', '01012345678', key);
      expect(first, isA<PhoneIdentityPending>());
      expect((first as PhoneIdentityPending).remainingAttempts, 3);
      expect(
        await repo.confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
        isA<PhoneIdentityVerified>(),
      );
      expect(
        await repo.confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
        isA<PhoneIdentityFailed>(),
      );
      expect(
        await repo.confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
        isA<PhoneIdentityExpired>(),
      );
      final req = a.requests.first;
      expect(
        req.uri.path,
        '/api/v1/riders/me/phone-verifications/RPV-1/confirmations',
      );
      expect(req.headers['Idempotency-Key'], key.value);
      expect(req.headers['X-Source-System'], sourceSystem);
      expect(_bodyOf(req), {'phone': '01012345678'});
    });

    test(
      '확인 503 DEPENDENCY_UNAVAILABLE → 혼잡(시도로 세지 않음 — 짝 조회도 하지 않는다)',
      () async {
        final a = FakeAdapter(
          (o, _) async => FakeReply.problem(
            503,
            _problem('DEPENDENCY_UNAVAILABLE', status: 503),
          ),
        );
        await expectLater(
          ApiPhoneIdentityRepository(_dio(a))
              .confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
          throwsA(isA<PhoneIdentityBusy>()),
        );
        expect(a.requests, hasLength(1));
      },
    );

    test('확인 응답을 못 받으면 GET 짝 조회 — 끝났으면 그 결과, 아직이면 혼잡(같은 키로 다시)', () async {
      var lookup = 'VERIFIED';
      final a = FakeAdapter((o, _) async {
        if (o.method == 'POST') {
          return const FakeReply.transport(DioExceptionType.receiveTimeout);
        }
        return FakeReply(200, body: _view(lookup));
      });
      final repo = ApiPhoneIdentityRepository(_dio(a));
      expect(
        await repo.confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
        isA<PhoneIdentityVerified>(),
      );
      expect(a.requests.last.method, 'GET');
      expect(
        a.requests.last.uri.path,
        '/api/v1/riders/me/phone-verifications/RPV-1',
      );
      lookup = 'PENDING';
      await expectLater(
        repo.confirm('RPV-1', '01012345678', IdempotencyKey.generate()),
        throwsA(isA<PhoneIdentityBusy>()),
      );
    });
  });

  group('가입 Api', () {
    const draft = SignupDraft(
      consents: {'PRIVACY_COLLECTION'},
      phone: '01012345678',
      name: '홍길동',
      roadAddress: '서울특별시 중구 세종대로 110',
      addressDetail: '1층',
      area: AreaOption(
        region: MfcRegion.chungcheong,
        mfcId: 'MFC-1',
        name: '지점',
      ),
      vehicle: Vehicle.bicycle,
      phoneVerificationId: 'RPV-1',
    );

    test('확인 ID(phoneVerificationId)를 보내고, 건너뛰었으면 보내지 않는다', () async {
      final a = FakeAdapter((o, _) async => const FakeReply(201, body: {}));
      final repo = ApiSignupRepository(_dio(a));
      try {
        await repo.submit(draft);
      } on PmartFailure {
        // 빈 프로필 본문은 읽지 못해도 된다 — 보낸 요청만 본다.
      }
      expect(_bodyOf(a.requests.single)['phoneVerificationId'], 'RPV-1');
      try {
        await repo.submit(draft.copyWith(clearPhoneVerification: true));
      } on PmartFailure {
        // 위와 같다.
      }
      expect(
        _bodyOf(a.requests.last).containsKey('phoneVerificationId'),
        isFalse,
      );
    });

    test('409 다른 계정·탈퇴한 번호 → SignupIdentityEnded, 422 PHONE_NOT_VERIFIED → SignupPhoneNotVerified, 거절 뒤 새 키', () async {
      final replies = [
        FakeReply.problem(
          409,
          _problem(
            'IDENTITY_ALREADY_REGISTERED',
            status: 409,
            details: [
              {'field': 'provider', 'reason': 'NAVER'},
              {'field': 'joinedAt', 'reason': '2026-07-10T03:00:00Z'},
            ],
          ),
        ),
        FakeReply.problem(
          409,
          _problem(
            'RIDER_REJOIN_BLOCKED',
            status: 409,
            details: [
              {'field': 'until', 'reason': '2026-12-18T15:00:00Z'},
            ],
          ),
        ),
        FakeReply.problem(422, _problem('PHONE_NOT_VERIFIED', status: 422)),
      ];
      final a = FakeAdapter((o, i) async => replies[i]);
      final repo = ApiSignupRepository(_dio(a));
      await expectLater(
        repo.submit(draft),
        throwsA(
          isA<SignupIdentityEnded>().having(
            (e) =>
                (e.outcome as PhoneIdentityAlreadyRegistered).account.provider,
            'provider',
            RiderSocialProvider.naver,
          ),
        ),
      );
      await expectLater(
        repo.submit(draft),
        throwsA(
          isA<SignupIdentityEnded>().having(
            (e) => e.outcome,
            'outcome',
            isA<PhoneIdentityRejoinBlocked>(),
          ),
        ),
      );
      await expectLater(
        repo.submit(draft),
        throwsA(isA<SignupPhoneNotVerified>()),
      );
      final keys = {
        for (final r in a.requests) r.headers['Idempotency-Key'] as String,
      };
      expect(keys, hasLength(3));
    });

    test('응답을 못 받은 가입은 같은 키로 다시 보낸다', () async {
      final a = FakeAdapter(
        (o, _) async =>
            const FakeReply.transport(DioExceptionType.receiveTimeout),
      );
      final repo = ApiSignupRepository(_dio(a));
      for (var i = 0; i < 2; i++) {
        await expectLater(
          repo.submit(draft),
          throwsA(isA<UnknownResultFailure>()),
        );
      }
      expect(
        a.requests[0].headers['Idempotency-Key'],
        a.requests[1].headers['Idempotency-Key'],
      );
    });
  });

  group('카카오·네이버 실서버 로그인', () {
    RiderLogin login(FakeAdapter a, {_Source? kakao, _Source? naver}) =>
        RiderLogin(
          dio: _dio(a),
          tokens: TokenStore(MemoryKeyValueStore()),
          deviceId: DeviceIdProvider(MemoryKeyValueStore()),
          google: _Google(),
          kakao: kakao,
          naver: naver,
        );

    test('카카오 ID 토큰을 provider KAKAO 로 보낸다', () async {
      final a = FakeAdapter((o, _) async {
        if (o.uri.path.endsWith('/riders/me')) {
          return FakeReply.problem(404, _problem('NOT_FOUND', status: 404));
        }
        return const FakeReply(
          200,
          body: {
            'authRequestId': 'ar-1',
            'state': 'AUTH_MEMBER',
            'riderId': 'RD-1',
            'newAccount': true,
            'occurredAt': '2026-11-20T03:00:00Z',
            'tokens': {
              'accessToken': 'a',
              'refreshToken': 'r',
              'accessTokenExpiresAt': '2026-11-20T03:15:00Z',
            },
          },
        );
      });
      final kakao = _Source('kakao-id-token');
      final out = await login(
        a,
        kakao: kakao,
      ).login(provider: RiderSocialProvider.kakao);
      final req = a.requests.first;
      expect(req.uri.path, '/api/v1/rider-auth/social-logins');
      expect(_bodyOf(req)['provider'], 'KAKAO');
      expect(_bodyOf(req)['providerToken'], 'kakao-id-token');
      expect(req.headers['Idempotency-Key'], isNotNull);
      expect(out, isA<RiderLoggedIn>());
      expect((out as RiderLoggedIn).registered, isFalse);
    });

    test('네이버 422 CONFIG_REQUIRED → 준비 안 됨(네이버 SDK 로그인은 끝낸다)', () async {
      final a = FakeAdapter(
        (o, _) async =>
            FakeReply.problem(422, _problem('CONFIG_REQUIRED', status: 422)),
      );
      final naver = _Source('naver-id-token');
      final out = await login(
        a,
        naver: naver,
      ).login(provider: RiderSocialProvider.naver);
      expect(_bodyOf(a.requests.single)['provider'], 'NAVER');
      expect(out, isA<RiderLoginProviderNotReady>());
      expect(
        (out as RiderLoginProviderNotReady).provider,
        RiderSocialProvider.naver,
      );
      expect(naver.signOuts, 1);
    });
  });

  group('CONFIG_REQUIRED 뒤 버튼 숨김(이 실행 동안)', () {
    testWidgets('실서버: 카카오 422 → 안내, 카카오 버튼이 사라지고 구글은 남는다', (t) async {
      await initPmartFormatting();
      final a = FakeAdapter(
        (o, _) async =>
            FakeReply.problem(422, _problem('CONFIG_REQUIRED', status: 422)),
      );
      final offers = MockOfferRepository(latency: Duration.zero);
      final kakao = _Source('kakao-id-token');
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [
            envProvider.overrideWithValue(PmartEnv.local),
            initialSessionProvider.overrideWithValue(null),
            secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
            offerRepositoryProvider.overrideWithValue(offers),
            dutyRepositoryProvider.overrideWithValue(offers),
            deliveryRepositoryProvider.overrideWithValue(
              MockDeliveryRepository(latency: Duration.zero, seeded: false),
            ),
            // 빌드에 키가 있는 것처럼 카카오 버튼을 낸다(시험 빌드에는 dart-define 이 없다).
            riderSocialProvidersProvider.overrideWith((ref) {
              final hidden = ref.watch(unavailableSocialProvidersProvider);
              return [
                for (final p in const [
                  RiderSocialProvider.google,
                  RiderSocialProvider.kakao,
                ])
                  if (!hidden.contains(p)) p,
              ];
            }),
            riderLoginProvider.overrideWithValue(
              RiderLogin(
                dio: _dio(a),
                tokens: TokenStore(MemoryKeyValueStore()),
                deviceId: DeviceIdProvider(MemoryKeyValueStore()),
                google: _Google(),
                kakao: kakao,
              ),
            ),
          ],
          child: const RiderApp(),
        ),
      );
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
      expect(find.byKey(const ValueKey('login-kakao')), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('login-kakao')));
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.text('카카오 로그인은 아직 준비 중이에요. 다른 방법으로 로그인해 주세요'),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('login-kakao')), findsNothing);
      expect(find.byKey(const ValueKey('login-google')), findsOneWidget);
      await t.pump(const Duration(seconds: 6));
    });
  });
}
