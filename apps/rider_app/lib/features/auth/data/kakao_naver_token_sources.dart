import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';

import 'rider_auth.dart';

/// 카카오 로그인: 카카오톡이 있으면 카카오톡, 없으면 카카오계정(웹)으로 로그인해 **OIDC ID 토큰**을 넘긴다
/// (고객앱 BR-65 와 같은 방식 — 서버가 카카오 JWKS 로 검증). 콘솔에서 OpenID Connect 를 켜야 ID 토큰이 온다.
/// rider-auth 계약에 KAKAO 가 생기기 전에는 부르지 않는다([riderAuthAcceptsKakaoNaver]). 토큰은 로그에 남기지 않는다.
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

/// 네이버 로그인 자리. rider-auth 0.2.0(PR #250, 병합 전)은 네이버도 **ID 토큰**(OIDC 인가 코드 + PKCE 로 받은 id_token,
/// aud = Client ID)만 받는다(고객 ADR-0071, `docs/operations/social-login-kakao-naver.md` §3). 네이버 로그인 SDK
/// (flutter_naver_login)는 액세스 토큰만 줘서 쓰지 않는다. OIDC 패키지(고객앱은 flutter_appauth)는 라이더 앱에
/// 넣는 승인을 받은 뒤 붙인다 — 그 전에는 서버·브라우저를 부르지 않고 설정 문제로 알린다.
final class NaverIdTokenSource implements SocialTokenSource {
  const NaverIdTokenSource();

  @override
  Future<String?> obtain() async => throw const RiderLoginMisconfigured();

  @override
  Future<void> signOut() async {}
}

final kakaoTokenSourceProvider = Provider<SocialTokenSource>(
  (_) => const KakaoIdTokenSource(),
);

final naverTokenSourceProvider = Provider<SocialTokenSource>(
  (_) => const NaverIdTokenSource(),
);
