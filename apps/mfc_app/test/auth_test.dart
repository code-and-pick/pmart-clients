// 직원 로그인(employee-auth-service, app=mfc) — 백엔드 handoff 2026-11-13 mfc-app-employee-login, 계약 employee-auth-service.yaml.
import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/data/login_browser.dart';
import 'package:mfc_app/features/auth/data/pkce.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/shared/providers.dart';

const _base = 'http://test.invalid/api/v1';

String _jwt(Map<String, Object?> claims) {
  String seg(Object? v) =>
      base64Url.encode(utf8.encode(jsonEncode(v))).replaceAll('=', '');
  return '${seg({'alg': 'none'})}.${seg(claims)}.sig';
}

final _access = _jwt({
  'sub': 'OP-1',
  'typ': 'OPERATOR',
  'roles': ['MFC_WORKER'],
  'centers': ['MFC-SEED-01'],
});

Map<String, Object?> _pair({String refresh = 'rt-1'}) => {
  'accessToken': _access,
  'refreshToken': refresh,
  'accessTokenExpiresAt': '2026-11-13T01:15:00Z',
  'refreshTokenExpiresAt': '2026-11-13T13:00:00Z',
  'sessionId': 'SES-1',
};

Map<String, Object?> _loginResult() => {
  'operatorId': 'OP-1',
  'roles': ['MFC_WORKER'],
  'centers': ['MFC-SEED-01'],
  'tokens': _pair(),
};

Map<String, dynamic> _body(RequestOptions o) =>
    jsonDecode(o.data as String) as Map<String, dynamic>;

/// 로그인 창 대신: 연 주소를 기록하고 정해 둔 복귀 주소를 돌려준다.
final class _FakeBrowser implements LoginBrowser {
  _FakeBrowser(this.back);

  final Object back; // Uri 또는 LoginFailure
  final opened = <Uri>[];

  @override
  Future<Uri> open(Uri url, {required String callbackScheme}) async {
    opened.add(url);
    expect(callbackScheme, 'pmart-mfc');
    final b = back;
    if (b is LoginFailure) throw b;
    return b as Uri;
  }
}

({ApiAuthRepository repo, TokenStore tokens, MemoryKeyValueStore store})
_repo(_FakeBrowser browser, FakeAdapter adapter, {SessionEndRecorder? ended}) {
  final store = MemoryKeyValueStore();
  final tokens = TokenStore(store);
  final deviceId = DeviceIdProvider(store);
  final refresher = employeeAuthRefresher(
    baseUrl: _base,
    sourceSystem: sourceSystem,
    deviceId: deviceId,
    ended: ended,
    adapter: adapter,
  );
  final repo = ApiAuthRepository(
    baseUrl: _base,
    sourceSystem: sourceSystem,
    tokens: tokens,
    deviceId: deviceId,
    browser: browser,
    refresher: refresher,
    authedDio: createPmartDio(
      baseUrl: _base,
      sourceSystem: sourceSystem,
      tokens: tokens,
      deviceId: deviceId,
      refresher: refresher,
      adapter: adapter,
      delay: (_) async {},
    ),
    adapter: adapter,
  );
  return (repo: repo, tokens: tokens, store: store);
}

final _ticketBack = Uri.parse('pmart-mfc://login?ticket=TICKET-1');

void main() {
  group('PKCE', () {
    test('S256 challenge 는 RFC 7636 부록 B 의 값과 같다', () {
      expect(
        Pkce.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      );
    });

    test('verifier 는 43자 base64url 이고 매번 다르다', () {
      final a = Pkce.newVerifier();
      expect(a, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
      expect(Pkce.newVerifier(), isNot(a));
    });
  });

  test('access token 클레임에서 운영자 ID·역할·센터를 읽는다. 형식이 아니면 null', () {
    final s = EmployeeSession.fromAccessToken(_access)!;
    expect(s.operatorId, 'OP-1');
    expect(s.roles, ['MFC_WORKER']);
    expect(s.centers, ['MFC-SEED-01']);
    expect(s.awaitingGrant, isFalse);
    expect(
      EmployeeSession.fromAccessToken(_jwt({'sub': 'OP-2'}))!.awaitingGrant,
      isTrue,
    );
    expect(EmployeeSession.fromAccessToken('not-a-token'), isNull);
    expect(EmployeeSession.fromAccessToken('a.!!!.c'), isNull);
  });

  group('로그인', () {
    test('로그인 창 주소(app=mfc·기기 ID·challenge·복귀 주소) → 티켓 교환(공개 요청, 같은 기기 ID, verifier) → 토큰 보관', () async {
      final adapter = FakeAdapter((o, _) async => FakeReply(200, body: _loginResult()));
      final browser = _FakeBrowser(_ticketBack);
      final t = _repo(browser, adapter);

      final session = await t.repo.login();

      expect(session, const EmployeeSession(operatorId: 'OP-1', roles: ['MFC_WORKER'], centers: ['MFC-SEED-01']));
      final url = browser.opened.single;
      expect(url.path, '/api/v1/employee-auth/logins');
      expect(url.queryParameters['app'], 'mfc');
      expect(url.queryParameters['returnUri'], 'pmart-mfc://login');
      expect(url.queryParameters['codeChallengeMethod'], 'S256');
      final device = url.queryParameters['deviceId']!;
      expect(device, isNotEmpty);

      final req = adapter.requests.single;
      expect(req.method, 'POST');
      expect(req.path, '/employee-auth/tokens');
      expect(req.headers['Authorization'], isNull);
      expect(req.headers['X-Source-System'], 'mfc-app');
      expect(req.headers['X-Device-Id'], device); // 로그인을 시작한 기기 ID 그대로
      expect(req.headers['Idempotency-Key'], isNotEmpty);
      final body = _body(req);
      expect(body['ticket'], 'TICKET-1');
      // 서버가 검증하는 그대로: 보낸 verifier 의 S256 = 로그인 창에 실은 challenge
      expect(Pkce.challenge(body['codeVerifier'] as String), url.queryParameters['codeChallenge']);
      expect(url.toString(), isNot(contains(body['codeVerifier'] as String)));

      expect(t.tokens.accessToken, _access);
      expect(await t.tokens.readRefreshToken(), 'rt-1');
    });

    test('복귀 주소 ?error= 는 코드로 이유를 고르고, 서버에 아무것도 보내지 않는다', () async {
      const cases = {
        'EMPLOYEE_NOT_REGISTERED': LoginError.notRegistered,
        'ACCOUNT_NOT_AVAILABLE': LoginError.accountNotAvailable,
        'IDP_ERROR': LoginError.cancelled,
        'IDP_REJECTED': LoginError.temporary,
        'IDP_UNAVAILABLE': LoginError.temporary,
        'SOMETHING_NEW': LoginError.unknown,
      };
      for (final e in cases.entries) {
        final adapter = FakeAdapter((_, _) async => const FakeReply(500));
        final t = _repo(_FakeBrowser(Uri.parse('pmart-mfc://login?error=${e.key}')), adapter);
        await expectLater(t.repo.login(), throwsA(isA<LoginFailure>().having((f) => f.error, 'error', e.value)));
        expect(adapter.requests, isEmpty);
        expect(await t.tokens.readRefreshToken(), isNull);
      }
    });

    test('로그인 창을 닫으면 취소, 티켓 없이 돌아오면 다시 로그인', () async {
      final adapter = FakeAdapter((_, _) async => const FakeReply(500));
      await expectLater(
        _repo(_FakeBrowser(const LoginFailure(LoginError.cancelled)), adapter).repo.login(),
        throwsA(isA<LoginFailure>().having((f) => f.error, 'error', LoginError.cancelled)),
      );
      await expectLater(
        _repo(_FakeBrowser(Uri.parse('pmart-mfc://login')), adapter).repo.login(),
        throwsA(isA<LoginFailure>().having((f) => f.error, 'error', LoginError.ticketInvalid)),
      );
      expect(adapter.requests, isEmpty);
    });

    test('티켓 교환 거절: 401 → 다시 로그인, 403 ACCOUNT_NOT_AVAILABLE → 이용할 수 없는 계정, 응답 없음 → 결과 모름. 같은 티켓을 다시 보내지 않는다', () async {
      Future<(LoginError, int)> run(FakeReply reply) async {
        final adapter = FakeAdapter((_, _) async => reply);
        final t = _repo(_FakeBrowser(_ticketBack), adapter);
        late LoginError error;
        try {
          await t.repo.login();
          fail('로그인되면 안 된다');
        } on LoginFailure catch (f) {
          error = f.error;
        }
        expect(await t.tokens.readRefreshToken(), isNull);
        return (error, adapter.requests.length);
      }

      expect(await run(const FakeReply.problem(401, {'code': 'TICKET_INVALID', 'status': 401})), (LoginError.ticketInvalid, 1));
      expect(await run(const FakeReply.problem(403, {'code': 'ACCOUNT_NOT_AVAILABLE', 'status': 403})), (LoginError.accountNotAvailable, 1));
      expect(await run(const FakeReply.transport(DioExceptionType.receiveTimeout)), (LoginError.network, 1));
      expect(await run(const FakeReply(503)), (LoginError.network, 1));
    });
  });

  group('토큰 갱신', () {
    DeviceIdProvider device() => DeviceIdProvider(MemoryKeyValueStore());

    test('POST /employee-auth/tokens/refresh — 기기 ID·멱등키를 싣고 새 토큰 쌍으로 바꾼다', () async {
      final adapter = FakeAdapter((_, _) async => FakeReply(200, body: _pair(refresh: 'rt-2')));
      final d = device();
      final refresh = employeeAuthRefresher(baseUrl: _base, sourceSystem: sourceSystem, deviceId: d, adapter: adapter);

      final next = await refresh('rt-1');

      expect(next!.refreshToken, 'rt-2');
      final req = adapter.requests.single;
      expect(req.path, '/employee-auth/tokens/refresh');
      expect(_body(req), {'refreshToken': 'rt-1'});
      expect(req.headers['X-Device-Id'], await d.get());
      expect(req.headers['X-Source-System'], 'mfc-app');
      expect(req.headers['Idempotency-Key'], isNotEmpty);
    });

    test('401 이면 세션 종료(null) — 갱신 거절은 "만료"로 남긴다(정지·퇴사도 TOKEN_INVALID 로 온다). 네트워크 오류는 세션 종료가 아니다', () async {
      Future<(AuthTokens?, SessionEnd?)> run(FakeReply reply) async {
        final ended = SessionEndRecorder();
        final refresh = employeeAuthRefresher(
          baseUrl: _base,
          sourceSystem: sourceSystem,
          deviceId: device(),
          ended: ended,
          adapter: FakeAdapter((_, _) async => reply),
        );
        return (await refresh('rt-1'), ended.take());
      }

      expect(await run(const FakeReply.problem(401, {'code': 'SESSION_EXPIRED', 'status': 401})), (null, SessionEnd.expired));
      expect(await run(const FakeReply.problem(401, {'code': 'TOKEN_REUSED', 'status': 401})), (null, SessionEnd.expired));
      expect(await run(const FakeReply.problem(401, {'code': 'TOKEN_INVALID', 'status': 401})), (null, SessionEnd.expired));
      // 지금 백엔드는 갱신에 이 code 를 주지 않는다(바꾸면 그대로 "이용할 수 없는 계정").
      expect(await run(const FakeReply.problem(401, {'code': 'ACCOUNT_NOT_AVAILABLE', 'status': 401})), (null, SessionEnd.accountBlocked));
      await expectLater(run(const FakeReply.transport(DioExceptionType.connectionTimeout)), throwsA(isA<PmartFailure>()));
    });

    test('정지·퇴사: 업무 요청 401 SUBJECT_BLOCKED → 갱신은 TOKEN_INVALID 로 거절 → 이유는 "이용할 수 없는 계정"', () async {
      final ended = SessionEndRecorder();
      final store = MemoryKeyValueStore();
      final tokens = TokenStore(store);
      await tokens.save(AuthTokens(accessToken: _access, refreshToken: 'rt-1'));
      final adapter = FakeAdapter((o, _) async => o.path.endsWith('/employee-auth/tokens/refresh')
          ? const FakeReply.problem(401, {'code': 'TOKEN_INVALID', 'status': 401})
          : const FakeReply.problem(401, {'code': 'SUBJECT_BLOCKED', 'status': 401}));
      SessionEnd? told;
      final dio = watchSubjectBlocked(
        createPmartDio(
          baseUrl: _base,
          sourceSystem: sourceSystem,
          tokens: tokens,
          deviceId: DeviceIdProvider(store),
          refresher: employeeAuthRefresher(
            baseUrl: _base,
            sourceSystem: sourceSystem,
            deviceId: DeviceIdProvider(store),
            ended: ended,
            adapter: adapter,
          ),
          // 세션 종료 알림을 받는 순간의 이유(컨트롤러가 이때 읽는다)
          onSessionExpired: () => told = ended.take(),
          adapter: adapter,
          delay: (_) async {},
        ),
        ended,
      );

      await expectLater(dio.get<dynamic>('/work'), throwsA(isA<DioException>()));

      expect(told, SessionEnd.accountBlocked);
      expect(tokens.accessToken, isNull);
      expect(await tokens.readRefreshToken(), isNull);
    });

    test('무활동 만료: 업무 요청 401(다른 code) → 갱신 거절 → 이유는 "만료"', () async {
      final ended = SessionEndRecorder();
      final store = MemoryKeyValueStore();
      final tokens = TokenStore(store);
      await tokens.save(AuthTokens(accessToken: _access, refreshToken: 'rt-1'));
      final adapter = FakeAdapter((o, _) async => o.path.endsWith('/employee-auth/tokens/refresh')
          ? const FakeReply.problem(401, {'code': 'TOKEN_INVALID', 'status': 401})
          : const FakeReply.problem(401, {'code': 'TOKEN_EXPIRED', 'status': 401}));
      SessionEnd? told;
      final dio = watchSubjectBlocked(
        createPmartDio(
          baseUrl: _base,
          sourceSystem: sourceSystem,
          tokens: tokens,
          deviceId: DeviceIdProvider(store),
          refresher: employeeAuthRefresher(
            baseUrl: _base,
            sourceSystem: sourceSystem,
            deviceId: DeviceIdProvider(store),
            ended: ended,
            adapter: adapter,
          ),
          onSessionExpired: () => told = ended.take(),
          adapter: adapter,
          delay: (_) async {},
        ),
        ended,
      );

      await expectLater(dio.get<dynamic>('/work'), throwsA(isA<DioException>()));

      expect(told, SessionEnd.expired);
    });

    test('업무 요청 401 → 갱신 거절 → 토큰 삭제·세션 종료 알림(동시 요청도 갱신은 한 번)', () async {
      var refreshes = 0;
      var expired = 0;
      final adapter = FakeAdapter((o, _) async {
        if (o.path.endsWith('/tokens/refresh')) {
          refreshes += 1;
          return const FakeReply.problem(401, {'code': 'SESSION_EXPIRED', 'status': 401});
        }
        return const FakeReply.problem(401, {'code': 'SUBJECT_BLOCKED', 'status': 401});
      });
      final store = MemoryKeyValueStore();
      final tokens = TokenStore(store);
      await tokens.save(const AuthTokens(accessToken: 'a-old', refreshToken: 'rt-1'));
      final dio = createPmartDio(
        baseUrl: _base,
        sourceSystem: sourceSystem,
        tokens: tokens,
        refresher: employeeAuthRefresher(baseUrl: _base, sourceSystem: sourceSystem, deviceId: DeviceIdProvider(store), adapter: adapter),
        onSessionExpired: () => expired += 1,
        adapter: adapter,
        delay: (_) async {},
      );

      final results = await Future.wait([
        for (var i = 0; i < 3; i++) dio.get<dynamic>('/mfc/anything').then((_) => 'ok', onError: (Object e) => (e as DioException).error.runtimeType.toString()),
      ]);

      expect(results, everyElement('SessionExpiredFailure'));
      expect(refreshes, 1);
      expect(expired, 1);
      expect(tokens.accessToken, isNull);
      expect(await tokens.readRefreshToken(), isNull);
    });
  });

  group('세션 복원·로그아웃', () {
    test('보관한 refresh 가 없으면 서버에 묻지 않는다', () async {
      final adapter = FakeAdapter((_, _) async => const FakeReply(500));
      expect(await _repo(_FakeBrowser(_ticketBack), adapter).repo.restore(), isNull);
      expect(adapter.requests, isEmpty);
    });

    test('보관한 refresh 로 갱신해 세션을 되살리고, 회전된 값으로 바꿔 둔다', () async {
      final adapter = FakeAdapter((_, _) async => FakeReply(200, body: _pair(refresh: 'rt-2')));
      final t = _repo(_FakeBrowser(_ticketBack), adapter);
      await t.store.write(TokenStore.defaultRefreshKey, 'rt-1');

      final session = await t.repo.restore();

      expect(session!.operatorId, 'OP-1');
      expect(session.centers, ['MFC-SEED-01']);
      expect(await t.tokens.readRefreshToken(), 'rt-2');
      expect(t.tokens.accessToken, _access);
    });

    test('세션이 끝났으면 보관을 지우고 null, 네트워크 오류면 보관을 둔다', () async {
      final ended = _repo(_FakeBrowser(_ticketBack), FakeAdapter((_, _) async => const FakeReply.problem(401, {'code': 'SESSION_EXPIRED', 'status': 401})));
      await ended.store.write(TokenStore.defaultRefreshKey, 'rt-1');
      expect(await ended.repo.restore(), isNull);
      expect(await ended.tokens.readRefreshToken(), isNull);

      final offline = _repo(_FakeBrowser(_ticketBack), FakeAdapter((_, _) async => const FakeReply.transport(DioExceptionType.connectionError)));
      await offline.store.write(TokenStore.defaultRefreshKey, 'rt-1');
      await expectLater(offline.repo.restore(), throwsA(isA<PmartFailure>()));
      expect(await offline.tokens.readRefreshToken(), 'rt-1');
    });

    test('로그아웃: Bearer 로 POST /employee-auth/logouts(allDevices=false) 뒤 토큰 삭제 — 서버가 실패해도 지운다', () async {
      for (final reply in [const FakeReply(200, body: <String, Object?>{}), const FakeReply(500)]) {
        final adapter = FakeAdapter((_, _) async => reply);
        final t = _repo(_FakeBrowser(_ticketBack), adapter);
        await t.tokens.save(AuthTokens(accessToken: _access, refreshToken: 'rt-1'));

        await t.repo.logout();

        final req = adapter.requests.first;
        expect(req.path, '/employee-auth/logouts');
        expect(req.headers['Authorization'], 'Bearer $_access');
        expect(req.headers['Idempotency-Key'], isNotEmpty);
        expect(_body(req), {'allDevices': false});
        expect(t.tokens.accessToken, isNull);
        expect(await t.tokens.readRefreshToken(), isNull);
      }
    });
  });

  group('화면', () {
    Future<ProviderContainer> pump(WidgetTester t, AuthRepository repo) async {
      t.view
        ..physicalSize = const Size(800, 2000)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [authRepositoryProvider.overrideWithValue(repo)],
          child: const MfcApp(),
        ),
      );
      await t.pumpAndSettle();
      // 로그인 전 첫 화면은 기기 설정(사용자 2026-11-17) — 아래 로그인 버튼으로 로그인 화면에 간다.
      final setupLogin = find.byKey(const ValueKey('setup-login'));
      if (setupLogin.evaluate().isNotEmpty) {
        await t.tap(setupLogin);
        await t.pumpAndSettle();
      }
      return ProviderScope.containerOf(t.element(find.byType(Scaffold).first));
    }

    testWidgets('로그인 전: 버튼 하나(아이디·비밀번호 칸 없음) → 누르면 메인', (t) async {
      final repo = MockAuthRepository(signedIn: false);
      await pump(t, repo);
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const ValueKey('menu-handover')), findsNothing);

      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();

      expect(repo.loginCalls, 1);
      expect(find.byKey(const ValueKey('menu-handover')), findsOneWidget);
      expect(find.byKey(const ValueKey('awaiting-grant')), findsNothing);
    });

    // 임시(목 전용): 실서버 Keycloak 화면 자리에 앱 안 시험용 로그인 화면(사용자 2026-11-17 "목 앱도 실서버처럼").
    // 계약에 없어 서버로 보내는 것이 없다.
    testWidgets('목 앱 로그인 화면도 버튼 하나 — 누르면 시험용 로그인 화면, 둘 다 넣어야 켜지고 맞으면 메인', (t) async {
      final repo = MockPasswordAuthRepository();
      final c = await pump(t, repo);
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
      expect(find.byType(TextField), findsNothing); // 실서버 앱과 같은 화면
      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();

      expect(find.byKey(const ValueKey('login-id')), findsOneWidget);
      expect(find.byKey(const ValueKey('login-password')), findsOneWidget);
      expect(find.byKey(const ValueKey('login-temporary-note')), findsOneWidget);
      FilledButton button() => t.widget<FilledButton>(find.byKey(const ValueKey('mock-signin-submit')));
      expect(button().onPressed, isNull);

      await t.enterText(find.byKey(const ValueKey('login-id')), ' mfcw-pp-01 ');
      await t.pump();
      expect(button().onPressed, isNull); // 비밀번호가 아직 없다
      await t.enterText(find.byKey(const ValueKey('login-password')), 'anything');
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const ValueKey('login-password'))).obscureText, isTrue);

      await t.tap(find.byKey(const ValueKey('mock-signin-submit')));
      await t.pumpAndSettle();

      expect(find.byKey(const ValueKey('menu-handover')), findsOneWidget);
      expect(c.read(employeeSessionProvider)!.operatorId, 'OP-mock-mfcw-pp-01');
    });

    testWidgets('시험용 로그인 화면: 시험 작업자 아이디가 아니면 그 화면에서 알리고 머문다 — 비밀번호 칸은 비운다', (t) async {
      await pump(t, MockPasswordAuthRepository());
      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();
      for (final id in ['someone', 'mfcw-pp-31', 'mfcw-rcv-11', 'mfcw-qc-00', 'mfcw-pp-1']) {
        await t.enterText(find.byKey(const ValueKey('login-id')), id);
        await t.enterText(find.byKey(const ValueKey('login-password')), 'anything');
        await t.pump();
        await t.tap(find.byKey(const ValueKey('mock-signin-submit')));
        await t.pumpAndSettle();
        expect(find.byKey(const ValueKey('login-error')), findsOneWidget, reason: id);
        expect(find.textContaining('아이디 또는 비밀번호가 맞지 않아요'), findsOneWidget);
        expect(t.widget<TextField>(find.byKey(const ValueKey('login-password'))).controller!.text, isEmpty);
        expect(find.byKey(const ValueKey('menu-handover')), findsNothing);
      }
      expect(MockPasswordAuthRepository.isTestWorker('mfcw-pp-30'), isTrue);
      expect(MockPasswordAuthRepository.isTestWorker('mfcw-rtn-10'), isTrue);
    });

    testWidgets('시험용 로그인 화면을 닫으면 실서버(Custom Tab 닫기)처럼 "취소" 안내', (t) async {
      await pump(t, MockPasswordAuthRepository());
      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('mock-signin-close')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('login-error')), findsOneWidget);
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
    });

    testWidgets('로그인 실패는 이유를 안내하고 로그인 화면에 머문다 — 다시 누르면 다시 시도', (t) async {
      final repo = MockAuthRepository(signedIn: false)..nextLoginError = LoginError.accountNotAvailable;
      await pump(t, repo);
      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('login-error')), findsOneWidget);
      expect(find.textContaining('이용할 수 없는 계정'), findsOneWidget);
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);

      await t.tap(find.byKey(const ValueKey('employee-login')));
      await t.pumpAndSettle();
      expect(repo.loginCalls, 2);
      expect(find.byKey(const ValueKey('menu-handover')), findsOneWidget);
    });

    testWidgets('로그아웃: 확인을 거쳐 서버 세션을 끝내고 로그인 화면으로 — 취소하면 그대로', (t) async {
      final repo = MockAuthRepository();
      await pump(t, repo);
      await t.tap(find.byKey(const ValueKey('logout')));
      await t.pumpAndSettle();
      await t.tap(find.text('취소'));
      await t.pumpAndSettle();
      expect(repo.logoutCalls, 0);
      expect(find.byKey(const ValueKey('menu-handover')), findsOneWidget);

      await t.tap(find.byKey(const ValueKey('logout')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('logout-confirm')));
      await t.pumpAndSettle();
      expect(repo.logoutCalls, 1);
      // 직접 로그아웃은 첫 화면(기기 설정)으로 — 종료 안내가 없다.
      expect(find.byKey(const ValueKey('setup-login')), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('setup-login')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
      expect(find.byKey(const ValueKey('session-ended')), findsNothing);
    });

    testWidgets('세션이 끝나면(갱신 거절) 어느 화면에 있든 로그인 화면으로 — 이유를 안내한다', (t) async {
      final c = await pump(t, MockAuthRepository());
      c.read(sessionEndRecorderProvider).record(SessionEnd.accountBlocked);
      c.read(authControllerProvider.notifier).sessionExpired();
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('employee-login')), findsOneWidget);
      expect(find.byKey(const ValueKey('session-ended')), findsOneWidget);
      expect(find.textContaining('이용할 수 없는 계정'), findsOneWidget);
    });

    testWidgets('무활동 등으로 끝난 세션은 "다시 로그인" 안내', (t) async {
      final c = await pump(t, MockAuthRepository());
      c.read(authControllerProvider.notifier).sessionExpired();
      await t.pumpAndSettle();
      expect(find.textContaining('로그인이 끝났어요'), findsOneWidget);
    });

    testWidgets('역할이 없는 직원(권한 승인 대기)은 메인에서 안내를 본다', (t) async {
      await pump(t, MockAuthRepository(session: const EmployeeSession(operatorId: 'OP-new', roles: [], centers: [])));
      expect(find.byKey(const ValueKey('awaiting-grant')), findsOneWidget);
    });

    testWidgets('앱을 켠 직후에는 세션을 되살리는 동안 기다리고, 끝나면 메인(로그인 화면이 깜빡이지 않는다)', (t) async {
      final repo = _SlowRestore();
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [authRepositoryProvider.overrideWithValue(repo)],
          child: const MfcApp(),
        ),
      );
      await t.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byKey(const ValueKey('employee-login')), findsNothing);

      repo.done.complete(MockAuthRepository.mockSession);
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('menu-handover')), findsOneWidget);
    });

    testWidgets('되살릴 세션이 없으면 첫 화면(기기 설정)', (t) async {
      final repo = _SlowRestore();
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [authRepositoryProvider.overrideWithValue(repo)],
          child: const MfcApp(),
        ),
      );
      await t.pump();
      repo.done.complete(null);
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('setup-login')), findsOneWidget);
      expect(find.byKey(const ValueKey('employee-login')), findsNothing);
    });
  });
}

/// 실서버처럼 "되살리는 중"으로 시작하는 저장소.
final class _SlowRestore implements AuthRepository {
  final done = Completer<EmployeeSession?>();

  @override
  AuthState get initialState => const AuthRestoring();

  @override
  Future<EmployeeSession?> restore() => done.future;

  @override
  Future<EmployeeSession> login() async => MockAuthRepository.mockSession;

  @override
  Future<void> logout() async {}
}
