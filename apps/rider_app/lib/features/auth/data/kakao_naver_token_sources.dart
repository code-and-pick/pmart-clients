import 'package:dio/dio.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';
import 'package:pmart_api_rider_auth/pmart_api_rider_auth.dart' as ra;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import 'rider_auth.dart';

/// 카카오 로그인: 카카오톡이 있으면 카카오톡, 없으면 카카오계정(웹)으로 로그인해 **OIDC ID 토큰**을 넘긴다
/// (고객앱 BR-65 와 같은 방식 — 서버가 카카오 JWKS 로 검증). 콘솔에서 OpenID Connect 를 켜야 ID 토큰이 온다.
/// rider-auth 0.2.0 KAKAO(aud = 카카오 앱 키). 토큰은 로그에 남기지 않는다.
final class KakaoIdTokenSource implements SocialTokenSource {
  const KakaoIdTokenSource();

  @override
  Future<String?> obtain() async {
    try {
      final token = await isKakaoTalkInstalled()
          ? await UserApi.instance.loginWithKakaoTalk()
          : await UserApi.instance.loginWithKakaoAccount();
      final idToken = token.idToken;
      // OIDC 가 꺼져 있으면 ID 토큰이 없다 — 서버가 검증할 수 없어 설정 문제로 알린다.
      if (idToken == null || idToken.isEmpty) {
        throw const RiderLoginMisconfigured();
      }
      return idToken;
    } on KakaoAuthException catch (e) {
      if (e.error == AuthErrorCause.accessDenied) return null; // 동의 화면에서 취소
      if (e.error == AuthErrorCause.misconfigured) {
        throw const RiderLoginMisconfigured();
      }
      throw const RiderLoginUnavailable();
    } on KakaoClientException catch (e) {
      if (e.reason == ClientErrorCause.cancelled) return null;
      throw const RiderLoginUnavailable();
    } on PlatformException catch (e) {
      // 카카오톡 로그인 화면에서 뒤로 — SDK 가 CANCELED 로 준다.
      if (e.code == 'CANCELED') return null;
      throw const RiderLoginUnavailable();
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await UserApi.instance.logout();
    } on Object {
      // 카카오 SDK 로그아웃 실패는 무시한다(PMart 토큰은 지웠다).
    }
  }
}

/// 네이버 redirect_uri = 네이버 콘솔 Callback URL. 네이버 콘솔이 앱 주소를 받지 않아 게이트웨이 중계 주소를 쓴다
/// (백엔드 auth-service 0.5.0, 2026-11-19 LAN 배포): 서버는 받은 쿼리를 그대로 `com.pmart.rider://oauth/naver?…` 로 302 만 한다.
/// 앱은 build.gradle `appAuthRedirectScheme`(com.pmart.rider)로 그 주소를 받는다. 서버 교환(아래)의 redirectUri 도 이 값 그대로 —
/// rider-auth 설정의 이 앱 콜백 주소와 같아야 한다(아니면 400). 사내 와이파이에서만 닿는다. 다른 주소는 빌드 때 `NAVER_REDIRECT_URL` 로.
const naverRedirectUrl = String.fromEnvironment(
  'NAVER_REDIRECT_URL',
  defaultValue:
      'http://192.168.0.40:8080/api/v1/auth/oauth-callbacks/naver/rider',
);

/// 네이버 OIDC 공개 설정(https://nid.naver.com/.well-known/openid-configuration — 고객앱과 같음).
const _naverOidc = AuthorizationServiceConfiguration(
  authorizationEndpoint: 'https://nid.naver.com/oauth2/authorize',
  tokenEndpoint: 'https://nid.naver.com/oauth2/token',
);

/// 네이버 인가 요청으로 받은 것(메모리에만 — 로그 금지).
typedef NaverAuthorization = ({String code, String codeVerifier});

/// 네이버 인가 화면을 띄워 코드를 받는다. 라이더가 닫으면 null. 실패는 [PlatformException].
typedef NaverAuthorize = Future<NaverAuthorization?> Function(String clientId);

/// 서버가 인가 코드를 ID 토큰으로 바꾼다(`POST /rider-auth/naver-token-exchanges`, rider-auth 0.3.0).
typedef NaverCodeExchange = Future<String> Function({
  required String authorizationCode,
  required String codeVerifier,
  required String redirectUri,
  required IdempotencyKey key,
});

Future<NaverAuthorization?> _authorizeWithAppAuth(String clientId) async {
  try {
    final r = await const FlutterAppAuth().authorize(
      AuthorizationRequest(
        clientId,
        naverRedirectUrl,
        scopes: const ['openid'],
        serviceConfiguration: _naverOidc,
      ),
    );
    final code = r.authorizationCode;
    final verifier = r.codeVerifier;
    if (code == null || code.isEmpty || verifier == null || verifier.isEmpty) {
      throw const RiderLoginUnavailable();
    }
    return (code: code, codeVerifier: verifier);
  } on FlutterAppAuthUserCancelledException {
    return null; // 라이더가 로그인 화면을 닫음
  }
}

/// rider-auth 의 네이버 코드 교환(공개 명령 — 로그인 전이라 라이더 토큰을 붙이지 않는다).
NaverCodeExchange riderNaverExchange(Dio dio) {
  final logins = ra.PmartApiRiderAuth(dio: dio).getLoginsApi();
  return ({
    required authorizationCode,
    required codeVerifier,
    required redirectUri,
    required key,
  }) async {
    final res = await pmartGuard(
      () => logins.exchangeNaverCode(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        exchangeNaverCodeRequest: ra.ExchangeNaverCodeRequest(
          authorizationCode: authorizationCode,
          codeVerifier: codeVerifier,
          redirectUri: redirectUri,
        ),
        extra: {...?commandOptions(key).extra, PmartExtra.public: true},
      ),
    );
    // 본문이 없으면 교환됐는지 모른다 — 같은 키로 다시 물을 수 있게 결과 불명으로.
    final idToken = res.data?.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw UnknownResultFailure(requestId: key.value);
    }
    return idToken;
  };
}

/// 네이버 로그인(BR-69, rider-auth 0.3.0·ADR-0078): OIDC 인가 코드 + PKCE(S256, scope `openid`).
/// 네이버 토큰 엔드포인트는 client secret 없는 교환을 받지 않아(`invalid_client`), 앱은 **인가 코드까지만** 받고
/// 서버가 secret 으로 교환해 준 **id_token** 을 `providerToken` 으로 쓴다. Client Secret 은 앱·빌드 설정에 두지 않는다.
/// 코드·verifier·토큰은 로그에 남기지 않는다.
final class NaverIdTokenSource implements SocialTokenSource {
  const NaverIdTokenSource({
    required this.exchange,
    this.clientId = const String.fromEnvironment('NAVER_CLIENT_ID'),
    this.authorize = _authorizeWithAppAuth,
  });

  final NaverCodeExchange exchange;
  final String clientId;
  final NaverAuthorize authorize;

  @override
  Future<String?> obtain() async {
    final id = clientId.trim();
    if (id.isEmpty) throw const RiderLoginMisconfigured();
    final NaverAuthorization? granted;
    try {
      granted = await authorize(id);
    } on PlatformException {
      // 콘솔 Callback URL 이 없거나 네이버가 거절 — 상세(코드)는 화면·로그에 쓰지 않는다.
      throw const RiderLoginUnavailable();
    }
    if (granted == null) return null;
    // 인가 코드는 한 번만 쓸 수 있다 — 결과를 모르면 같은 키로 한 번 더(서버가 두 번 교환하지 않는다).
    final key = IdempotencyKey.generate();
    Future<String> once() => exchange(
      authorizationCode: granted!.code,
      codeVerifier: granted.codeVerifier,
      redirectUri: naverRedirectUrl,
      key: key,
    );
    try {
      try {
        return await once();
      } on UnknownResultFailure {
        return await once();
      }
    } on ProblemFailure catch (f) {
      // 서버에 네이버 secret 이 없다(422 CONFIG_REQUIRED) — 설정 문제로 알린다.
      if (f.problem.code == ProblemCode.configRequired) {
        throw const RiderLoginMisconfigured();
      }
      throw const RiderLoginUnavailable();
    } on PmartFailure {
      throw const RiderLoginUnavailable();
    }
  }

  @override
  Future<void> signOut() async {}
}

final kakaoTokenSourceProvider = Provider<SocialTokenSource>(
  (_) => const KakaoIdTokenSource(),
);

final naverTokenSourceProvider = Provider<SocialTokenSource>(
  (ref) =>
      NaverIdTokenSource(exchange: riderNaverExchange(ref.watch(dioProvider))),
);
