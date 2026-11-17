import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../data/auth_repository.dart';
import '../data/google_token_source.dart';
import '../data/mock_auth_repository.dart';
import '../domain/auth.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockAuthRepository(),
    PmartEnv.local => ApiAuthRepository(
      ref.watch(dioProvider),
      ref.watch(deviceIdProvider),
    ),
  },
);

final socialTokenSourceProvider = Provider<SocialTokenSource>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockSocialTokenSource(),
    // 실서버는 Google 만 지원한다(ADR-0019). 카카오·네이버 SDK 는 서버 지원 뒤 붙인다.
    PmartEnv.local => GoogleSocialTokenSource(),
  },
);

/// 로그인 화면에 보일 제공자. 실서버는 지원하는 제공자만(나머지는 501 이라 버튼을 숨긴다).
final loginProvidersProvider = Provider<List<SocialProvider>>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => loginProviders,
    PmartEnv.local => serverLoginProviders,
  },
);

/// 결과 불명 로그인의 같은 키 재전송 횟수.
final loginResolveAttemptsProvider = Provider<int>((_) => 2);

/// `dioProvider` 의 세션 종료 콜백을 세션 컨트롤러에 연결한다. 앱 루트(`ProviderScope`)에서 이 값으로
/// `onSessionExpiredProvider` 를 덮는다.
final sessionExpiryHandlerProvider = Provider<void Function()>(
  (ref) =>
      () => ref.read(sessionProvider.notifier).expired(),
);

/// 앱 시작 때 한 번: 저장된 refresh token 이 있으면 세션을 되살린다. 실패하면 비회원으로 둔다.
final sessionRestoreProvider = FutureProvider<void>(
  (ref) => ref.read(sessionProvider.notifier).restore(),
);

/// 앱의 로그인 상태. 시작은 비회원이고, [sessionRestoreProvider] 가 저장된 세션을 확인한다.
final sessionProvider = NotifierProvider<SessionController, Session>(
  SessionController.new,
);

/// 세션에 관해 한 번 알릴 것(스낵바). 읽은 쪽이 지운다.
enum SessionNotice {
  /// 세션이 끝나 조용히 다시 로그인했다.
  renewed,

  /// 세션이 끝났고 조용한 재로그인도 안 됐다 → "다시 로그인해 주세요".
  expired,

  /// 저장된 세션을 서버에 확인하지 못했다(연결 안 됨). 로그인은 그대로 두고 "다시 시도"를 준다.
  unreachable,
}

/// 저장된 세션이 있는데 서버에 닿지 못해 아직 확인하지 못했다. 회원으로 확정해 보이지 않고,
/// 비회원으로 바꾸지도 않는다(토큰을 지우지 않는다). 확인되면 false.
final sessionUnverifiedProvider =
    NotifierProvider<SessionUnverifiedController, bool>(
      SessionUnverifiedController.new,
    );

class SessionUnverifiedController extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

final sessionNoticeProvider =
    NotifierProvider<SessionNoticeController, SessionNotice?>(
      SessionNoticeController.new,
    );

class SessionNoticeController extends Notifier<SessionNotice?> {
  @override
  SessionNotice? build() => null;

  void set(SessionNotice notice) => state = notice;

  void clear() => state = null;
}

class SessionController extends Notifier<Session> {
  /// 만료 처리 중(동시에 여러 요청이 만료를 받아도 한 번만).
  Future<void>? _expiring;

  @override
  Session build() => const GuestSession();

  /// 인증 인터셉터가 토큰 갱신 거절(세션 종료)을 알렸다. 토큰은 이미 지워졌다.
  /// 조용한 재로그인(Google 지난 계정)을 먼저 시도하고, 성공하면 회원을 유지한다.
  /// 안 되면 비회원으로 바꾸고 "다시 로그인" 안내를 올린다. 비회원 장바구니 토큰은 건드리지 않는다.
  Future<void> expired() =>
      _expiring ??= _handleExpiry().whenComplete(() => _expiring = null);

  Future<void> _handleExpiry() async {
    final current = state;
    if (current is! MemberSession) return;
    final provider = current.provider ?? SocialProvider.google;
    try {
      final credential = await ref
          .read(socialTokenSourceProvider)
          .obtainSilently(provider);
      if (!ref.mounted) return;
      if (credential != null) {
        final outcome = await ref
            .read(authRepositoryProvider)
            .login(
              provider,
              credential.token,
              purpose: LoginPurpose.general,
              key: IdempotencyKey.generate(),
            );
        if (!ref.mounted) return;
        if (outcome is LoginMember) {
          await signIn(
            outcome,
            provider: provider,
            accountLabel: credential.accountLabel,
          );
          ref.read(sessionNoticeProvider.notifier).set(SessionNotice.renewed);
          return;
        }
      }
    } on Object {
      // 조용한 재로그인 실패(제공자 장애·불명 포함)는 아래 안내로 간다. 새 로그인 시도는 고객이 한다.
    }
    if (!ref.mounted) return;
    state = const GuestSession();
    ref.read(sessionNoticeProvider.notifier).set(SessionNotice.expired);
  }

  Future<void> signIn(
    LoginMember member, {
    SocialProvider? provider,
    String? accountLabel,
  }) async {
    await ref.read(tokenStoreProvider).save(member.tokens);
    ref.read(sessionUnverifiedProvider.notifier).set(false);
    state = MemberSession(
      member.accountId,
      provider: provider,
      accountLabel: accountLabel,
    );
  }

  /// 저장된 refresh token 이 있을 때만 서버에 세션을 묻는다(`GET /auth/sessions/current`).
  /// 서버가 확인한 계정만 회원으로 보인다. 그 사이 직접 로그인했으면 덮지 않는다.
  /// 서버에 닿지 못하면 토큰을 두고 "확인 못 함"으로 남긴다 — 다시 시도·앱 복귀 때 다시 묻는다.
  /// (예전에는 연결 실패도 "세션 없음"으로 보고 비회원으로 시작해, 다른 망에서 로그인이 풀린 것처럼 보였다.)
  Future<void> restore() async {
    final tokens = ref.read(tokenStoreProvider);
    if (await tokens.readRefreshToken() == null) return;
    if (!ref.mounted || state is MemberSession) return;
    final String? accountId;
    try {
      accountId = await ref.read(authRepositoryProvider).currentAccountId();
    } on PmartFailure {
      if (!ref.mounted || state is MemberSession) return;
      final wasUnverified = ref.read(sessionUnverifiedProvider);
      ref.read(sessionUnverifiedProvider.notifier).set(true);
      // 처음 한 번만 알린다(앱 복귀 때마다 다시 띄우지 않는다)
      if (!wasUnverified) {
        ref.read(sessionNoticeProvider.notifier).set(SessionNotice.unreachable);
      }
      return;
    }
    if (!ref.mounted) return;
    ref.read(sessionUnverifiedProvider.notifier).set(false);
    if (accountId == null || state is MemberSession) return;
    state = MemberSession(accountId);
  }

  /// 확인하지 못한 저장 세션을 다시 확인한다(다시 시도·앱 복귀).
  Future<void> retryRestore() async {
    if (!ref.read(sessionUnverifiedProvider)) return;
    await restore();
  }

  Future<void> signOut() async {
    // 회원 토큰을 지우기 전에 서버에서 이 단말의 푸시 토큰을 지운다(지운 뒤에는 부를 수 없다).
    try {
      await ref.read(beforeSignOutProvider)();
    } on Object {
      // 못 지워도 로그아웃은 끝낸다.
    }
    await ref.read(tokenStoreProvider).clear();
    final source = ref.read(socialTokenSourceProvider);
    if (source is GoogleSocialTokenSource) {
      try {
        await source.signOut();
      } on Object {
        // Google 쪽 선택 해제 실패는 앱 로그아웃을 막지 않는다.
      }
    }
    state = const GuestSession();
  }
}

/// 로그인 화면의 진행 상태.
@immutable
sealed class LoginFlow {
  const LoginFlow();
}

final class LoginIdle extends LoginFlow {
  const LoginIdle();
}

final class LoginWorking extends LoginFlow {
  const LoginWorking(this.provider);

  final SocialProvider provider;
}

/// 직전 시도의 결과(동의 대기·제한·불명·실패·취소·완료).
final class LoginSettled extends LoginFlow {
  const LoginSettled(this.outcome);

  final LoginOutcome outcome;
}

final loginFlowProvider = NotifierProvider.autoDispose
    .family<LoginFlowController, LoginFlow, LoginPurpose>(
      LoginFlowController.new,
    );

class LoginFlowController extends Notifier<LoginFlow> {
  LoginFlowController(this.purpose);

  final LoginPurpose purpose;

  /// 결과 불명인 로그인의 키·제공자·제공자 자격. 다시 확인은 같은 키로 재전송한다.
  ({IdempotencyKey key, SocialProvider provider, SocialCredential credential})?
  _unknown;

  /// 이번 로그인 시도의 제공자·계정 표시(회원이 되면 세션에 붙인다).
  ({SocialProvider provider, String? label})? _who;

  /// 이번 로그인에서 받은 제공자 ID 토큰 — 동의 완료(auth 0.2.0)에 다시 보낸다. 메모리에만, 로그 금지.
  String? _providerToken;

  /// 결과를 모르는 동의 완료의 키 — 다시 누르면 같은 키로 보낸다(서버가 새 토큰을 준다, 두 번 가입되지 않음).
  IdempotencyKey? _completionKey;

  @override
  LoginFlow build() => const LoginIdle();

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  bool get busy => state is LoginWorking;

  Future<void> start(SocialProvider provider) async {
    if (busy) return;
    state = LoginWorking(provider);
    final SocialCredential? credential;
    try {
      credential = await ref.read(socialTokenSourceProvider).obtain(provider);
    } on SocialProviderDown {
      return _settle(const LoginProviderUnavailable());
    } on SocialProviderMisconfigured {
      return _settle(
        const LoginRejected(AuthProblemCode.providerConfiguration),
      );
    }
    if (!ref.mounted) return;
    if (credential == null) return _settle(const LoginCancelled());
    _who = (provider: provider, label: credential.accountLabel);
    _providerToken = credential.token;
    _completionKey = null;
    final key = IdempotencyKey.generate();
    final outcome = await _repo.login(
      provider,
      credential.token,
      purpose: purpose,
      key: key,
    );
    if (!ref.mounted) return;
    if (outcome is LoginUnknown) {
      _unknown = (key: key, provider: provider, credential: credential);
      return _resolve(
        outcome,
        attempts: ref.read(loginResolveAttemptsProvider),
      );
    }
    await _settle(outcome);
  }

  /// "다시 확인". 같은 키로만 재전송한다(새 로그인 시도가 아니다).
  Future<void> checkAgain() async {
    final unknown = _unknown;
    if (unknown == null || busy) return;
    state = LoginWorking(unknown.provider);
    await _resolve(const LoginUnknown(), attempts: 1);
  }

  Future<void> _resolve(LoginUnknown first, {required int attempts}) async {
    final unknown = _unknown!;
    LoginOutcome outcome = first;
    for (var i = 0; i < attempts && outcome is LoginUnknown; i++) {
      final id = outcome.authRequestId;
      outcome = id != null
          ? await _repo.lookup(id)
          : await _repo.login(
              unknown.provider,
              unknown.credential.token,
              purpose: purpose,
              key: unknown.key,
            );
      if (!ref.mounted) return;
    }
    if (outcome is! LoginUnknown) _unknown = null;
    await _settle(outcome);
  }

  /// 동의 완료(auth 0.2.0 completions — CU-1). [consents] 는 필수(모두 true)와 선택(고른 값)을 모두 담는다.
  ///
  /// - 결과 불명·503 은 같은 키로 다시 보낸다(서버가 새 토큰을 준다). 끝내 모르면 동의 화면에 남고 다시 누르면 같은 키.
  /// - 401 PROVIDER_REJECTED(ID 토큰 만료 — 약 1시간)는 제공자에서 새 토큰을 받아 한 번 더(본문이 바뀌어 새 키).
  /// - FORBIDDEN·INVALID_STATE·CONSENT_VERSION_OUTDATED 는 로그인을 처음부터(로그인 화면에 안내).
  /// - 그 밖 거절(REQUIRED_CONSENT_MISSING 등)은 동의 화면을 유지하고 사유를 보인다.
  Future<void> submitConsents(
    LoginNeedsConsent waiting,
    List<ConsentDecision> consents,
  ) async {
    if (busy) return;
    final provider = _who?.provider ?? SocialProvider.google;
    state = LoginWorking(provider);
    var token = _providerToken ?? await _freshToken(provider);
    if (!ref.mounted) return;
    if (token == null) {
      // 본인 확인용 토큰을 다시 받지 못했다 — 처음부터 로그인한다.
      return _settle(const LoginRejected(AuthProblemCode.providerRejected));
    }
    var key = _completionKey ?? IdempotencyKey.generate();
    var outcome = await _complete(waiting.authRequestId, token, consents, key);
    if (!ref.mounted) return;
    if (outcome case LoginRejected(code: AuthProblemCode.providerRejected)) {
      final fresh = await _freshToken(provider);
      if (!ref.mounted) return;
      if (fresh != null) {
        _providerToken = token = fresh;
        key = IdempotencyKey.generate();
        outcome = await _complete(waiting.authRequestId, fresh, consents, key);
        if (!ref.mounted) return;
      }
    }
    if (outcome is LoginUnknown) {
      _completionKey = key;
      state = LoginSettled(waiting.withError(ProblemCode.unknownResult));
      return;
    }
    _completionKey = null;
    if (outcome case LoginRejected(:final code)
        when !AuthProblemCode.restartLogin.contains(code) &&
            code != AuthProblemCode.providerRejected) {
      state = LoginSettled(waiting.withError(code));
      return;
    }
    if (outcome is! LoginNeedsConsent) _providerToken = null;
    await _settle(outcome);
  }

  Future<LoginOutcome> _complete(
    String authRequestId,
    String token,
    List<ConsentDecision> consents,
    IdempotencyKey key,
  ) async {
    LoginOutcome outcome = const LoginUnknown();
    final attempts = ref.read(loginResolveAttemptsProvider);
    for (var i = 0; i < attempts && outcome is LoginUnknown; i++) {
      outcome = await _repo.completeWithConsents(
        authRequestId,
        providerToken: token,
        consents: consents,
        key: key,
      );
      if (!ref.mounted) return outcome;
    }
    return outcome;
  }

  /// 제공자 ID 토큰을 다시 받는다(조용히 먼저, 안 되면 화면). 못 받으면 null.
  Future<String?> _freshToken(SocialProvider provider) async {
    final source = ref.read(socialTokenSourceProvider);
    try {
      final silent = await source.obtainSilently(provider);
      if (silent != null) return silent.token;
      return (await source.obtain(provider))?.token;
    } on Object {
      return null;
    }
  }

  Future<void> _settle(LoginOutcome outcome) async {
    if (outcome is LoginMember) {
      await ref
          .read(sessionProvider.notifier)
          .signIn(outcome, provider: _who?.provider, accountLabel: _who?.label);
    }
    if (ref.mounted) state = LoginSettled(outcome);
  }
}
