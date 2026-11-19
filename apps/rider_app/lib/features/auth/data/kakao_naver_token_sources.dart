import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';

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
/// (백엔드 auth-service 0.5.0, 2026-11-19 LAN 배포): 서버는 받은 쿼리를 그대로 `com.pmart.rider://oauth/naver?…` 로 302 만 한다
/// (코드 교환·저장 없음). 앱은 build.gradle `appAuthRedirectScheme`(com.pmart.rider)로 그 주소를 받고, 코드 교환은 앱이 PKCE 로
/// 이 http 주소를 redirect_uri 로 그대로 보낸다. 사내 와이파이에서만 닿는다. 다른 주소는 빌드 때 `NAVER_REDIRECT_URL` 로.
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

/// 네이버: OIDC 인가 코드 + PKCE(S256) → id_token(aud = Client ID). Client Secret 은 앱에 넣지 않는다(토큰 엔드포인트 인증 none).
final class NaverIdTokenSource implements SocialTokenSource {
  const NaverIdTokenSource({
    this.clientId = const String.fromEnvironment('NAVER_CLIENT_ID'),
  });

  static const _appAuth = FlutterAppAuth();
  final String clientId;

  @override
  Future<String?> obtain() async {
    final id = clientId.trim();
    if (id.isEmpty) throw const RiderLoginMisconfigured();
    try {
      final result = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          id,
          naverRedirectUrl,
          scopes: const ['openid'],
          serviceConfiguration: _naverOidc,
        ),
      );
      final idToken = result.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const RiderLoginMisconfigured();
      }
      return idToken;
    } on FlutterAppAuthUserCancelledException {
      return null; // 라이더가 로그인 화면을 닫음
    } on PlatformException {
      // 콘솔 Callback URL 이 없거나 네이버가 거절 — 상세(토큰·코드)는 화면·로그에 쓰지 않는다.
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
  (_) => const NaverIdTokenSource(),
);
