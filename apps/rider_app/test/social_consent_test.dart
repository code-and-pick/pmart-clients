// RA-1(2026-11-22, rider-auth 0.4.0) 소셜 "동의는 처음 가입할 때만" — 앱 몫.
// 탈퇴 전 네이버 재인증(purpose WITHDRAWAL)·탈퇴 뒤 구글 끊기·가입을 그만두면 구글·카카오 끊기·세션에 제공자 저장.
// 서버는 부르지 않는다(가짜 어댑터가 계약 모양의 JSON 을 돌려준다).
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:rider_app/features/auth/data/kakao_naver_token_sources.dart';
import 'package:rider_app/features/auth/data/rider_auth.dart';
import 'package:rider_app/features/auth/data/session.dart';

Dio _dio(FakeAdapter a) =>
    Dio(BaseOptions(baseUrl: 'http://fake/api/v1'))..httpClientAdapter = a;

Map<String, Object?> _bodyOf(RequestOptions o) => switch (o.data) {
  final String s => jsonDecode(s) as Map<String, Object?>,
  final Map<String, Object?> m => m,
  final other => jsonDecode(jsonEncode(other)) as Map<String, Object?>,
};

final class _Source implements GoogleIdTokenSource {
  _Source([this.token = 'id-token']);
  final String? token;
  final withdrawals = <bool>[];
  final signOuts = <bool>[];
  int abandons = 0;

  @override
  Future<String?> obtain({bool withdrawal = false}) async {
    withdrawals.add(withdrawal);
    return token;
  }

  @override
  Future<void> signOut({bool revoke = false}) async => signOuts.add(revoke);

  @override
  Future<void> abandonSignup() async => abandons++;
}

RiderLogin _login({
  required _Source google,
  _Source? kakao,
  _Source? naver,
  FakeAdapter? adapter,
}) => RiderLogin(
  dio: _dio(
    adapter ?? FakeAdapter((o, _) async => const FakeReply(200, body: {})),
  ),
  tokens: TokenStore(MemoryKeyValueStore()),
  deviceId: DeviceIdProvider(MemoryKeyValueStore()),
  google: google,
  kakao: kakao,
  naver: naver,
);

void main() {
  group('네이버 교환 purpose(rider-auth 0.4.0)', () {
    Future<Map<String, Object?>> sent({required bool withdrawal}) async {
      final a = FakeAdapter(
        (o, _) async => const FakeReply(200, body: {'idToken': 'ID'}),
      );
      final token = await riderNaverExchange(_dio(a))(
        authorizationCode: 'CODE',
        codeVerifier: 'v' * 43,
        redirectUri: naverRedirectUrl,
        key: IdempotencyKey.generate(),
        withdrawal: withdrawal,
      );
      expect(token, 'ID');
      expect(
        a.requests.single.uri.path,
        '/api/v1/rider-auth/naver-token-exchanges',
      );
      return _bodyOf(a.requests.single);
    }

    test('탈퇴 재인증은 WITHDRAWAL, 로그인은 LOGIN', () async {
      expect((await sent(withdrawal: true))['purpose'], 'WITHDRAWAL');
      expect((await sent(withdrawal: false))['purpose'], 'LOGIN');
    });

    test('NaverIdTokenSource.obtain(withdrawal) 이 교환까지 넘긴다', () async {
      final seen = <bool>[];
      final source = NaverIdTokenSource(
        clientId: 'CID',
        authorize: (_) async => (code: 'C', codeVerifier: 'v' * 43),
        exchange:
            ({
              required authorizationCode,
              required codeVerifier,
              required redirectUri,
              required key,
              bool withdrawal = false,
            }) async {
              seen.add(withdrawal);
              return 'ID';
            },
      );
      await source.obtain(withdrawal: true);
      await source.obtain();
      expect(seen, [true, false]);
    });

    test('네이버 인가 요청에 auth_type 을 덧붙이지 않는다(고객앱과 같게)', () {
      expect(naverAuthorizeExtra, isEmpty);
    });
  });

  group('탈퇴 전 재인증', () {
    test('네이버로 로그인한 라이더만 네이버 재인증(withdrawal)', () async {
      final google = _Source(), kakao = _Source(), naver = _Source();
      final login = _login(google: google, kakao: kakao, naver: naver);
      expect(
        await login.reauthenticateForWithdrawal(RiderSocialProvider.naver),
        isTrue,
      );
      expect(naver.withdrawals, [true]);
      for (final p in [
        RiderSocialProvider.google,
        RiderSocialProvider.kakao,
        null,
      ]) {
        expect(await login.reauthenticateForWithdrawal(p), isTrue);
      }
      expect(google.withdrawals, isEmpty);
      expect(kakao.withdrawals, isEmpty);
    });

    Map<String, Object?> session(String? provider) => {
      'sessionId': 'S1',
      'riderId': 'R1',
      'issuedAt': '2026-11-22T01:00:00Z',
      'expiresAt': '2026-11-22T02:00:00Z',
      'provider': provider,
    };

    test('저장된 제공자가 없으면 서버 현재 세션 provider 로 — NAVER 면 재인증', () async {
      final naver = _Source();
      final a = FakeAdapter(
        (o, _) async => FakeReply(200, body: session('NAVER')),
      );
      final login = _login(google: _Source(), naver: naver, adapter: a);
      expect(await login.reauthenticateForWithdrawal(null), isTrue);
      expect(a.requests.single.uri.path, '/api/v1/rider-auth/sessions/current');
      expect(naver.withdrawals, [true]);
    });

    test('서버도 모르거나(null) 조회가 실패하면 재인증 없이 이어 간다', () async {
      for (final reply in [
        FakeReply(200, body: session(null)),
        FakeReply.problem(503, problemBody('UNAVAILABLE', status: 503)),
      ]) {
        final naver = _Source();
        final login = _login(
          google: _Source(),
          naver: naver,
          adapter: FakeAdapter((o, _) async => reply),
        );
        expect(await login.reauthenticateForWithdrawal(null), isTrue);
        expect(naver.withdrawals, isEmpty);
      }
    });

    test('저장된 제공자가 있으면 서버에 묻지 않는다', () async {
      final a = FakeAdapter(
        (o, _) async => FakeReply(200, body: session('NAVER')),
      );
      final kakao = _Source(), naver = _Source();
      final login = _login(
        google: _Source(),
        kakao: kakao,
        naver: naver,
        adapter: a,
      );
      expect(
        await login.reauthenticateForWithdrawal(RiderSocialProvider.kakao),
        isTrue,
      );
      expect(a.requests, isEmpty);
      expect(naver.withdrawals, isEmpty);
    });

    test('네이버 화면을 닫으면 false — 탈퇴 신청을 보내지 않는다', () async {
      final login = _login(google: _Source(), naver: _Source(null));
      expect(
        await login.reauthenticateForWithdrawal(RiderSocialProvider.naver),
        isFalse,
      );
    });
  });

  group('로그아웃·탈퇴·가입 그만두기', () {
    test('탈퇴 끝 → 저장된 제공자(구글)를 revoke 로 정리', () async {
      final google = _Source(), kakao = _Source();
      await _login(
        google: google,
        kakao: kakao,
      ).logout(provider: RiderSocialProvider.google, withdrawn: true);
      expect(google.signOuts, [true]);
      expect(kakao.signOuts, isEmpty);
    });

    test('앱을 다시 켠 뒤 로그아웃도 저장된 제공자(카카오) SDK 를 정리한다', () async {
      final google = _Source(), kakao = _Source();
      await _login(
        google: google,
        kakao: kakao,
      ).logout(provider: RiderSocialProvider.kakao);
      expect(kakao.signOuts, [false]);
      expect(google.signOuts, isEmpty);
    });

    test('가입을 그만두면 abandonSignup(앱 연결 끊기)', () async {
      final google = _Source(), kakao = _Source();
      await _login(
        google: google,
        kakao: kakao,
      ).logout(provider: RiderSocialProvider.kakao, abandonSignup: true);
      expect(kakao.abandons, 1);
      expect(kakao.signOuts, isEmpty);
    });

    test('카카오: 가입 그만두기 = unlink 뒤 logout, 탈퇴 = logout 만(끊기는 서버)', () async {
      final calls = <String>[];
      final kakao = KakaoIdTokenSource(
        login: () => throw StateError('부르지 않는다'),
        logout: () async => calls.add('logout'),
        unlink: () async => calls.add('unlink'),
      );
      await kakao.abandonSignup();
      expect(calls, ['unlink', 'logout']);
      calls.clear();
      await kakao.signOut(revoke: true);
      expect(calls, ['logout']);
    });

    test('카카오 끊기 실패는 흐름을 막지 않는다', () async {
      final calls = <String>[];
      final kakao = KakaoIdTokenSource(
        login: () => throw StateError('부르지 않는다'),
        logout: () async => calls.add('logout'),
        unlink: () async => throw Exception('offline'),
      );
      await kakao.abandonSignup();
      expect(calls, ['logout']);
    });
  });

  group('세션에 제공자 저장', () {
    test('저장된 provider 를 읽고, 예전 세션(provider 없음)은 null', () async {
      final store = MemoryKeyValueStore();
      await store.write(
        'pmart.rider.session',
        jsonEncode({'riderId': 'R1', 'registered': true, 'provider': 'naver'}),
      );
      expect(
        (await loadSavedSession(store))?.provider,
        RiderSocialProvider.naver,
      );
      await store.write(
        'pmart.rider.session',
        jsonEncode({'riderId': 'R1', 'registered': true}),
      );
      final old = await loadSavedSession(store);
      expect(old?.riderId, 'R1');
      expect(old?.provider, isNull);
    });
  });
}
