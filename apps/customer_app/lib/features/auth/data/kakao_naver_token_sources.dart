import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_naver_login/flutter_naver_login.dart';
import 'package:flutter_naver_login/interface/types/naver_login_status.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';

import '../domain/auth.dart';
import 'auth_repository.dart';
import 'google_token_source.dart' show SocialProviderMisconfigured;

/// 카카오 로그인(BR-65): 카카오톡이 있으면 카카오톡, 없으면 카카오계정(웹)으로 로그인해 **OIDC ID 토큰**을
/// `providerToken` 으로 넘긴다(서버가 카카오 JWKS 로 검증 — Google 과 같은 방식, ADR-0055). 콘솔에서 OpenID Connect 를
/// 켜야 ID 토큰이 온다(사용자 2026-11-19 활성화). 토큰은 로그에 남기지 않는다.
final class KakaoSocialTokenSource implements SocialTokenSource {
  const KakaoSocialTokenSource();

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) async {
    if (provider != SocialProvider.kakao) throw const SocialProviderDown();
    try {
      final token = await isKakaoTalkInstalled()
          ? await UserApi.instance.loginWithKakaoTalk()
          : await UserApi.instance.loginWithKakaoAccount();
      final idToken = token.idToken;
      // OIDC 가 꺼져 있으면 ID 토큰이 없다 — 서버가 검증할 수 없어 설정 문제로 알린다.
      if (idToken == null || idToken.isEmpty) {
        throw const SocialProviderMisconfigured();
      }
      return SocialCredential(idToken);
    } on KakaoAuthException catch (e) {
      if (e.error == AuthErrorCause.accessDenied) return null; // 동의 화면에서 취소
      throw const SocialProviderDown();
    } on KakaoClientException catch (e) {
      if (e.reason == ClientErrorCause.cancelled) return null;
      throw const SocialProviderDown();
    } on PlatformException catch (e) {
      // 카카오톡 로그인 화면에서 뒤로 — SDK 가 CANCELED 로 준다.
      if (e.code == 'CANCELED') return null;
      throw const SocialProviderDown();
    }
  }

  /// 카카오 SDK 가 저장한 토큰으로 조용한 재로그인은 하지 않는다(ID 토큰은 새로 로그인할 때만 온다) — 다시 로그인 화면으로.
  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) async =>
      null;
}

/// 네이버 로그인(BR-65): 네이버 Android SDK 로 로그인해 **액세스 토큰**을 `providerToken` 으로 넘긴다
/// (서버가 `GET https://openapi.naver.com/v1/nid/me` 로 확인 — 사용자 2026-11-19 Android 만·SDK 방식).
/// Client ID·Secret 은 빌드 때 매니페스트로만 들어간다(.secrets). 토큰은 로그에 남기지 않는다.
final class NaverSocialTokenSource implements SocialTokenSource {
  const NaverSocialTokenSource();

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) async {
    if (provider != SocialProvider.naver) throw const SocialProviderDown();
    try {
      final result = await FlutterNaverLogin.logIn();
      switch (result.status) {
        case NaverLoginStatus.loggedIn:
          final token = result.accessToken?.accessToken;
          if (token == null || token.isEmpty) throw const SocialProviderDown();
          return SocialCredential(token, accountLabel: result.account?.email);
        case NaverLoginStatus.loggedOut:
          return null; // 고객이 닫음
        case NaverLoginStatus.error:
          // SDK 는 취소도 오류 문구로 준다(문구 비교는 취소 판단에만 — 화면 문구로 쓰지 않는다).
          final msg = result.errorMessage?.toLowerCase() ?? '';
          if (msg.contains('cancel')) return null;
          throw const SocialProviderDown();
      }
    } on PlatformException {
      throw const SocialProviderDown();
    }
  }

  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) async =>
      null;
}

/// 제공자마다 맞는 SDK 로 보낸다.
final class RoutingSocialTokenSource implements SocialTokenSource {
  const RoutingSocialTokenSource({
    required this.google,
    this.kakao = const KakaoSocialTokenSource(),
    this.naver = const NaverSocialTokenSource(),
  });

  final SocialTokenSource google;
  final SocialTokenSource kakao;
  final SocialTokenSource naver;

  SocialTokenSource _of(SocialProvider p) => switch (p) {
    SocialProvider.kakao => kakao,
    SocialProvider.naver => naver,
    _ => google,
  };

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) =>
      _of(provider).obtain(provider);

  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) =>
      _of(provider).obtainSilently(provider);
}
