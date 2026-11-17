import 'package:dio/dio.dart';
import 'package:pmart_api_auth/pmart_api_auth.dart' as auth;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/auth.dart';

/// 제공자 SDK 에서 인가 코드·ID 토큰(과 표시용 계정 이름)을 받는다. 고객이 취소하면 null.
///
/// 실제 SDK(카카오 등)는 앱 키 결정 뒤 붙인다(`[결정 필요]` 카카오 키). 토큰은 로그에 남기지 않는다.
abstract interface class SocialTokenSource {
  /// 제공자 장애면 [SocialProviderDown] 을 던진다.
  Future<SocialCredential?> obtain(SocialProvider provider);

  /// 조용한 재로그인(화면 없이). 세션이 끝났을 때 먼저 시도한다(백엔드 요청 2026-11-02 세션 만료 §3-2).
  /// 못 받으면 null — 던지지 않는다.
  Future<SocialCredential?> obtainSilently(SocialProvider provider);
}

final class SocialProviderDown implements Exception {
  const SocialProviderDown();
}

abstract interface class AuthRepository {
  /// `POST /auth/social-logins`. 같은 [key] 재전송은 원인증 결과를 돌려준다.
  Future<LoginOutcome> login(
    SocialProvider provider,
    String providerToken, {
    required LoginPurpose purpose,
    required IdempotencyKey key,
  });

  /// `GET /auth/social-logins/{authRequestId}`.
  Future<LoginOutcome> lookup(String authRequestId);

  /// 저장된 세션의 계정(`GET /auth/sessions/current`. 401 이면 인터셉터가 refresh 회전 후 다시 보낸다).
  /// 세션이 끝났거나 고객 세션이 아니면 null(토큰은 인터셉터가 지운다).
  /// 서버에 닿지 못했으면(연결 오류·타임아웃·결과 불명·5xx) [PmartFailure] 를 던진다 — 세션이 끝난 게 아니다.
  Future<String?> currentAccountId();

  /// 동의 대기(AUTH_CONSENT)를 끝낸다 — `POST /auth/social-logins/{id}/completions`(auth 0.2.0, CU-1).
  /// 토큰이 없는 단계라 [providerToken](로그인한 그 계정의 ID 토큰)으로 서버가 본인을 다시 확인한다.
  /// [consents] 는 필수(모두 동의)와 선택(고객이 고른 값 — 끈 것도 false)을 모두 담는다.
  /// 같은 [key] 재전송(응답 유실)은 새 토큰을 준다.
  Future<LoginOutcome> completeWithConsents(
    String authRequestId, {
    required String providerToken,
    required List<ConsentDecision> consents,
    required IdempotencyKey key,
  });
}

/// 실서버 구현(auth-service).
final class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(Dio dio, this._deviceId)
    : _logins = auth.PmartApiAuth(dio: dio).getLoginsApi(),
      _tokens = auth.PmartApiAuth(dio: dio).getTokensApi();

  final auth.LoginsApi _logins;
  final auth.TokensApi _tokens;
  final DeviceIdProvider _deviceId;

  Map<String, dynamic> _publicCommand(IdempotencyKey key) => {
    ...?commandOptions(key).extra,
    PmartExtra.public: true,
  };

  @override
  Future<LoginOutcome> login(
    SocialProvider provider,
    String providerToken, {
    required LoginPurpose purpose,
    required IdempotencyKey key,
  }) => _guard(
    () async => (await _logins.socialLogin(
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      xDeviceId: await _deviceId.get(),
      socialLoginRequest: auth.SocialLoginRequest(
        provider: switch (provider) {
          SocialProvider.kakao => auth.Provider.KAKAO,
          SocialProvider.naver => auth.Provider.NAVER,
          SocialProvider.apple => auth.Provider.APPLE,
          SocialProvider.google => auth.Provider.GOOGLE,
        },
        providerToken: providerToken,
        purpose: switch (purpose) {
          LoginPurpose.general => auth.SocialLoginRequestPurposeEnum.GENERAL,
          LoginPurpose.checkout => auth.SocialLoginRequestPurposeEnum.CHECKOUT,
        },
      ),
      extra: _publicCommand(key),
    )).data,
  );

  @override
  Future<LoginOutcome> lookup(String authRequestId) => _guard(
    () async => (await _logins.getSocialLogin(
      authRequestId: authRequestId,
      xDeviceId: await _deviceId.get(),
      extra: {PmartExtra.public: true},
    )).data,
  );

  @override
  Future<String?> currentAccountId() async {
    try {
      final session = await pmartGuard(
        () async => (await _tokens.getCurrentSession()).data,
      );
      return session?.principalType == auth.SessionPrincipalTypeEnum.CUSTOMER
          ? session?.principalId
          : null;
    } on SessionExpiredFailure {
      return null;
    } on ProblemFailure catch (f) {
      // 서버가 답했다: 4xx 는 세션 없음, 5xx·429 는 지금 확인할 수 없음
      if (f.problem.status >= 500 || f.problem.status == 429) rethrow;
      return null;
    }
  }

  @override
  Future<LoginOutcome> completeWithConsents(
    String authRequestId, {
    required String providerToken,
    required List<ConsentDecision> consents,
    required IdempotencyKey key,
  }) => _guard(
    // BR-20 회신(2026-11-17): 동의는 completions 본문으로 보낸다 — customer `/me/consent-changes` 를 먼저 부르지 않는다.
    () async => (await _logins.completeSocialLogin(
      authRequestId: authRequestId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      xDeviceId: await _deviceId.get(),
      completeSocialLoginRequest: auth.CompleteSocialLoginRequest(
        providerToken: providerToken,
        consents: [
          for (final c in consents)
            auth.CompleteSocialLoginRequestConsentsInner(
              consentType: c.type,
              version: c.version,
              agreed: c.agreed,
            ),
        ],
      ),
      extra: _publicCommand(key),
    )).data,
  );

  Future<LoginOutcome> _guard(Future<auth.AuthResult?> Function() call) async {
    try {
      final result = await pmartGuard(call);
      if (result == null) return const LoginUnknown();
      return authResultToOutcome(result);
    } on PmartFailure catch (f) {
      return authFailureToOutcome(f);
    }
  }
}

/// 동의 항목 문자열 `TYPE:version`(BR-20 회신)에서 유형.
String consentTypeOf(String item) => ConsentDecision(item, agreed: true).type;

LoginOutcome authResultToOutcome(auth.AuthResult r) => switch (r.state) {
  auth.AuthState.AUTH_MEMBER => switch ((r.accountId, r.tokens)) {
    (final String accountId, final auth.TokenPair t) => LoginMember(
      accountId: accountId,
      tokens: AuthTokens(
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
      ),
      newAccount: r.newAccount ?? false,
      cartMergeConfirm:
          r.nextAction == auth.AuthResultNextActionEnum.CART_MERGE_CONFIRM,
    ),
    // 회원이라는데 토큰·계정이 없으면 계약 위반이다. 로그인됐다고 보이지 않는다.
    _ => throw const ContractViolationFailure('AUTH_MEMBER 인데 토큰 없음'),
  },
  auth.AuthState.AUTH_CONSENT => LoginNeedsConsent(
    authRequestId: r.authRequestId,
    requiredConsents: r.requiredConsents ?? const [],
    optionalConsents: r.optionalConsents ?? const [],
    // 계약: 동의 화면에서 나갔던 가입은 다음 로그인도 newAccount=true. 값이 없으면 신규로 본다.
    newAccount: r.newAccount ?? true,
  ),
  auth.AuthState.AUTH_RESTRICTED => LoginRestricted(
    retryAfterSeconds: r.retryAfterSeconds,
  ),
  auth.AuthState.AUTH_UNKNOWN ||
  auth.AuthState.AUTH_PENDING => LoginUnknown(authRequestId: r.authRequestId),
  auth.AuthState.AUTH_GUEST => const LoginRejected('AUTH_GUEST'),
};

LoginOutcome authFailureToOutcome(PmartFailure f) => switch (f) {
  ProblemFailure(:final problem)
      when problem.code == AuthProblemCode.restricted =>
    LoginRestricted(
      retryAfterSeconds: problem.raw['retryAfterSeconds'] as int?,
    ),
  ProblemFailure(:final problem) => LoginRejected(problem.code),
  UnknownResultFailure(:final problem)
      when problem?.code == AuthProblemCode.providerUnavailable =>
    const LoginProviderUnavailable(),
  // 501 은 "지원하지 않음"이 확정된 응답이다. 변경 요청의 5xx 라도 결과 불명으로 두지 않는다.
  UnknownResultFailure(:final problem)
      when problem?.code == AuthProblemCode.unsupported =>
    const LoginRejected(AuthProblemCode.unsupported),
  UnknownResultFailure() => const LoginUnknown(),
  _ => throw f,
};
