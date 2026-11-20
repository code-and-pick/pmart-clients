import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_api_rider_auth/pmart_api_rider_auth.dart' as ra;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import 'kakao_naver_token_sources.dart';

/// 라이더용 Google 웹 클라이언트 ID(serverClientId). Google 이 주는 ID 토큰의 `aud` 가 이 값이고,
/// rider-auth-service 는 이 값만 받는다(고객용 ID 로는 라이더 로그인이 안 된다). 공개 식별자 — 비밀값 아님
/// (백엔드 `docs/architecture/auth/login-structure-and-flow.md` §2, ADR-0055). client secret 은 쓰지 않는다.
const riderGoogleServerClientId = String.fromEnvironment(
  'PMART_RIDER_GOOGLE_SERVER_CLIENT_ID',
  defaultValue: '293585219605-la3cj13q19oo51p7e4d0rf4ickh3flgu.apps.googleusercontent.com',
);

/// 라이더 로그인 제공자. 화면 순서도 이 순서(구글 → 카카오 → 네이버).
enum RiderSocialProvider { google, kakao, naver }

/// rider-auth-service 가 카카오·네이버를 받는지 — rider-auth 0.2.0(백엔드 #250 병합·배포)부터 GOOGLE·KAKAO·NAVER.
/// providerToken 은 ID 토큰만(카카오 OIDC idToken, 네이버는 인가 코드 + PKCE 를 서버가 교환한 id_token). 서버에 그 제공자 앱 키가 아직 없으면
/// 422 CONFIG_REQUIRED — 안내하고 이 실행 동안 그 버튼을 숨긴다([unavailableSocialProvidersProvider]).
const riderAuthAcceptsKakaoNaver = true;

/// 빌드 때 `--dart-define-from-file=.secrets/rider.env` 로 들어오는 키(버튼을 낼지 판단에만 쓴다. 값은 로그에 남기지 않는다).
/// 네이버 Client Secret 은 앱·빌드 설정에 두지 않는다 — 서버(rider-auth)가 코드 교환에 쓴다(BR-69, ADR-0078).
const _kakaoNativeAppKey = String.fromEnvironment('KAKAO_NATIVE_APP_KEY');
const _naverClientId = String.fromEnvironment('NAVER_CLIENT_ID');

/// 실서버에서 카카오·네이버 버튼을 낼지: 서버가 받고 + 그 키가 빌드에 들어 있을 때만.
List<RiderSocialProvider> serverSocialProviders({
  bool serverAccepts = riderAuthAcceptsKakaoNaver,
  String kakaoKey = _kakaoNativeAppKey,
  String naverClientId = _naverClientId,
}) => [
  RiderSocialProvider.google,
  if (serverAccepts && kakaoKey.trim().isNotEmpty) RiderSocialProvider.kakao,
  if (serverAccepts && naverClientId.trim().isNotEmpty)
    RiderSocialProvider.naver,
];

/// 이 실행 동안 숨길 제공자 — 서버가 422 CONFIG_REQUIRED(앱 키 미설정)·501 UNSUPPORTED_ACTION 으로 답한 카카오·네이버.
/// 앱을 다시 켜면 비워진다(그사이 서버 설정이 끝났을 수 있다). 구글은 숨기지 않는다(로그인할 방법이 없어진다).
final class UnavailableSocialProviders
    extends Notifier<Set<RiderSocialProvider>> {
  @override
  Set<RiderSocialProvider> build() => const {};

  void hide(RiderSocialProvider p) {
    if (p == RiderSocialProvider.google || state.contains(p)) return;
    state = {...state, p};
  }
}

final unavailableSocialProvidersProvider =
    NotifierProvider<UnavailableSocialProviders, Set<RiderSocialProvider>>(
      UnavailableSocialProviders.new,
    );

/// 로그인 화면에 보일 제공자. 목 모드는 셋 다(목 로그인), 실서버는 [serverSocialProviders] 에서 이번 실행에 준비 안 됨으로
/// 확인된 제공자를 뺀다.
final riderSocialProvidersProvider = Provider<List<RiderSocialProvider>>((ref) {
  final hidden = ref.watch(unavailableSocialProvidersProvider);
  return switch (ref.watch(envProvider)) {
    PmartEnv.mock => RiderSocialProvider.values,
    PmartEnv.local => [
      for (final p in serverSocialProviders())
        if (!hidden.contains(p)) p,
    ],
  };
});

/// 실서버 로그인 결과(목 모드는 [RiderLogin] 을 거치지 않는다).
sealed class RiderLoginOutcome {
  const RiderLoginOutcome();
}

/// 로그인됨. [registered] = rider-service 프로필이 있음(`GET /riders/me` 404 면 false → 가입 화면).
final class RiderLoggedIn extends RiderLoginOutcome {
  const RiderLoggedIn({required this.riderId, required this.registered});
  final String riderId;
  final bool registered;
}

/// 계정 선택 창을 닫았다(서버를 부르지 않는다).
final class RiderLoginCanceled extends RiderLoginOutcome {
  const RiderLoginCanceled();
}

/// Google 설정 문제(이 앱의 Android 클라이언트 — 패키지·서명 SHA-1 — 가 콘솔에 없음 등, DEVELOPER_ERROR).
final class RiderLoginMisconfigured extends RiderLoginOutcome {
  const RiderLoginMisconfigured();
}

/// 서버가 거절했다(Problem code). 예: PROVIDER_REJECTED·ACCOUNT_NOT_AVAILABLE·AUTH_RESTRICTED.
final class RiderLoginRejected extends RiderLoginOutcome {
  const RiderLoginRejected(this.code);
  final String? code;
}

/// 연결 문제·Google 장애·결과 불명 — 잠시 뒤 다시.
final class RiderLoginUnavailable extends RiderLoginOutcome {
  const RiderLoginUnavailable();
}

/// 이 앱에 그 제공자 로그인이 붙어 있지 않다(토큰 소스 없음) — 서버를 부르지 않았다.
final class RiderLoginUnsupported extends RiderLoginOutcome {
  const RiderLoginUnsupported();
}

/// 서버가 이 제공자를 아직 받지 않는다 — 422 CONFIG_REQUIRED(앱 키 미설정)·501 UNSUPPORTED_ACTION.
/// 안내하고 이 실행 동안 그 버튼을 숨긴다.
final class RiderLoginProviderNotReady extends RiderLoginOutcome {
  const RiderLoginProviderNotReady(this.provider);
  final RiderSocialProvider provider;
}

/// 제공자 로그인 → 서버에 넘길 OIDC ID 토큰(Google·카카오·네이버). 토큰은 로그·오류 문구에 남기지 않는다.
abstract interface class SocialTokenSource {
  /// 취소면 null. 설정 문제면 [RiderLoginMisconfigured] 를, 장애면 [RiderLoginUnavailable] 를 던진다.
  Future<String?> obtain();

  Future<void> signOut();
}

/// Google 계정 선택 → ID 토큰.
abstract interface class GoogleIdTokenSource implements SocialTokenSource {}

final class GoogleSignInIdTokenSource implements GoogleIdTokenSource {
  GoogleSignInIdTokenSource({GoogleSignIn? signIn})
    : _signIn = signIn ?? GoogleSignIn.instance;

  final GoogleSignIn _signIn;
  Future<void>? _initialized;

  @override
  Future<String?> obtain() async {
    try {
      await (_initialized ??= _signIn.initialize(
        serverClientId: riderGoogleServerClientId,
      ));
      final account = await _signIn.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const RiderLoginMisconfigured();
      }
      return idToken;
    } on GoogleSignInException catch (e) {
      return switch (e.code) {
        GoogleSignInExceptionCode.canceled ||
        GoogleSignInExceptionCode.interrupted => null,
        GoogleSignInExceptionCode.clientConfigurationError ||
        GoogleSignInExceptionCode.providerConfigurationError =>
          throw const RiderLoginMisconfigured(),
        _ => throw const RiderLoginUnavailable(),
      };
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await (_initialized ??= _signIn.initialize(
        serverClientId: riderGoogleServerClientId,
      ));
      await _signIn.signOut();
    } on Object {
      // 기기 Google 로그아웃 실패는 무시한다(PMart 토큰은 지웠다).
    }
  }
}

final googleIdTokenSourceProvider = Provider<GoogleIdTokenSource>(
  (_) => GoogleSignInIdTokenSource(),
);

/// rider-auth-service 로그인·로그아웃 + 가입 여부 확인.
final class RiderLogin {
  RiderLogin({
    required Dio dio,
    required this.tokens,
    required this.deviceId,
    required this.google,
    this.kakao,
    this.naver,
  }) : _logins = ra.PmartApiRiderAuth(dio: dio).getLoginsApi(),
       _tokensApi = ra.PmartApiRiderAuth(dio: dio).getTokensApi(),
       _me = rd.PmartApiRider(dio: dio).getMeApi();

  final ra.LoginsApi _logins;
  final ra.TokensApi _tokensApi;
  final rd.MeApi _me;
  final TokenStore tokens;
  final DeviceIdProvider deviceId;
  final GoogleIdTokenSource google;

  /// 카카오 OIDC ID 토큰([KakaoIdTokenSource]). null 이면 카카오 로그인을 부르지 않는다.
  final SocialTokenSource? kakao;

  /// 네이버 OIDC(인가 코드 + PKCE) ID 토큰([NaverIdTokenSource]). null 이면 부르지 않는다.
  final SocialTokenSource? naver;

  /// 마지막으로 로그인한 제공자 소스 — 로그아웃 때 그 SDK 로그인도 끝낸다.
  SocialTokenSource? _signedIn;

  SocialTokenSource? _sourceOf(RiderSocialProvider p) => switch (p) {
    RiderSocialProvider.google => google,
    RiderSocialProvider.kakao => kakao,
    RiderSocialProvider.naver => naver,
  };

  static ra.Provider _contractProvider(RiderSocialProvider p) => switch (p) {
    RiderSocialProvider.google => ra.Provider.GOOGLE,
    RiderSocialProvider.kakao => ra.Provider.KAKAO,
    RiderSocialProvider.naver => ra.Provider.NAVER,
  };

  Future<RiderLoginOutcome> login({
    RiderSocialProvider provider = RiderSocialProvider.google,
  }) async {
    final source = _sourceOf(provider);
    if (source == null) return const RiderLoginUnsupported();
    final String? idToken;
    try {
      idToken = await source.obtain();
    } on RiderLoginOutcome catch (o) {
      return o;
    }
    if (idToken == null) return const RiderLoginCanceled();
    final key = IdempotencyKey.generate();
    final ra.RiderAuthResult result;
    try {
      final res = await pmartGuard(
        () async => _logins.riderSocialLogin(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          xDeviceId: await deviceId.get(),
          riderSocialLoginRequest: ra.RiderSocialLoginRequest(
            provider: _contractProvider(provider),
            providerToken: idToken!,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      result =
          res.data ??
          (throw const ContractViolationFailure('RiderAuthResult 본문 없음'));
    } on ProblemFailure catch (f) {
      // 서버에 그 제공자 앱 키가 아직 없다(422 CONFIG_REQUIRED) / 받지 않는 제공자(501) — 제공자 SDK 로그인만 끝내 둔다.
      if (f.problem.code == ProblemCode.configRequired ||
          f.problem.code == ProblemCode.unsupportedAction) {
        await source.signOut();
        return RiderLoginProviderNotReady(provider);
      }
      return RiderLoginRejected(f.problem.code);
    } on PmartFailure catch (f) {
      // 501 은 변경 요청의 5xx 라 결과 불명으로 온다 — 코드가 UNSUPPORTED_ACTION 이면 준비 안 됨.
      if (f case UnknownResultFailure(:final problem?)
          when problem.code == ProblemCode.unsupportedAction) {
        await source.signOut();
        return RiderLoginProviderNotReady(provider);
      }
      return const RiderLoginUnavailable();
    }
    _signedIn = source;
    final pair = result.tokens;
    if (pair == null) return const RiderLoginUnavailable();
    await tokens.save(
      AuthTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      ),
    );
    // 가입 여부: GET /riders/me — 404 면 미가입(가입 화면으로).
    var registered = !result.newAccount;
    try {
      await pmartGuard(() => _me.getMyRider());
      registered = true;
    } on ProblemFailure catch (f) {
      if (f.problem.status == 404) registered = false;
    } on PmartFailure {
      // 확인하지 못했다 — 새 계정 여부로 판단한다.
    }
    return RiderLoggedIn(riderId: result.riderId, registered: registered);
  }

  /// 서버 세션을 끝내고(이 기기만) 토큰을 지운다. 서버 호출이 실패해도 기기 토큰은 지운다.
  Future<void> logout() async {
    if (await tokens.readRefreshToken() != null) {
      final key = IdempotencyKey.generate();
      try {
        await pmartGuard(
          () async => _tokensApi.riderLogout(
            idempotencyKey: key.value,
            xSourceSystem: sourceSystem,
            riderLogoutRequest: ra.RiderLogoutRequest(allDevices: false),
            extra: commandOptions(key).extra,
          ),
        );
      } on PmartFailure {
        // 세션은 서버에서 만료로 끝난다.
      }
    }
    await tokens.clear();
    final signedIn = _signedIn ?? google;
    _signedIn = null;
    await signedIn.signOut();
  }
}

final riderLoginProvider = Provider<RiderLogin>(
  (ref) => RiderLogin(
    dio: ref.watch(dioProvider),
    tokens: ref.watch(tokenStoreProvider),
    deviceId: ref.watch(deviceIdProvider),
    google: ref.watch(googleIdTokenSourceProvider),
    kakao: ref.watch(kakaoTokenSourceProvider),
    naver: ref.watch(naverTokenSourceProvider),
  ),
);

/// `POST /rider-auth/tokens` 로 토큰을 회전한다. 인증 인터셉터를 거치지 않는 별도 Dio(갱신이 다시
/// 갱신을 부르지 않게). 401(TOKEN_INVALID·TOKEN_REUSED)이면 세션 폐기 → null(재로그인).
TokenRefresher riderRefresher({
  required String baseUrl,
  required DeviceIdProvider deviceId,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(BaseOptions(baseUrl: baseUrl));
  if (adapter != null) dio.httpClientAdapter = adapter;
  final api = ra.PmartApiRiderAuth(dio: dio).getTokensApi();
  return (refreshToken) async {
    try {
      final res = await api.refreshRiderTokens(
        idempotencyKey: IdempotencyKey.generate().value,
        xSourceSystem: sourceSystem,
        xDeviceId: await deviceId.get(),
        refreshRiderTokensRequest: ra.RefreshRiderTokensRequest(
          refreshToken: refreshToken,
        ),
      );
      final pair =
          res.data ?? (throw const ContractViolationFailure('TokenPair 본문 없음'));
      return AuthTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) return null;
      throw PmartFailure.fromDioException(e);
    }
  };
}
