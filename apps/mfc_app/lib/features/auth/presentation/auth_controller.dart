import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../data/auth_repository.dart';
import '../data/login_browser.dart';
import '../domain/employee_auth.dart';

final loginBrowserProvider = Provider<LoginBrowser>(
  (_) => const CustomTabLoginBrowser(),
);

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  if (ref.watch(envProvider) == PmartEnv.mock) return MockAuthRepository();
  final baseUrl = ref.watch(apiBaseUrlProvider);
  return ApiAuthRepository(
    baseUrl: baseUrl,
    sourceSystem: sourceSystem,
    tokens: ref.watch(tokenStoreProvider),
    deviceId: ref.watch(deviceIdProvider),
    browser: ref.watch(loginBrowserProvider),
    refresher: ref.watch(tokenRefresherProvider),
    authedDio: ref.watch(dioProvider),
  );
});

/// 직원 세션. 로그인 전·세션 종료 뒤에는 라우터가 로그인 화면으로 보낸다(`router.dart`).
final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

final class AuthController extends Notifier<AuthState> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  AuthState build() {
    final repo = ref.watch(authRepositoryProvider);
    final initial = repo.initialState;
    if (initial is AuthRestoring) unawaited(_restore());
    return initial;
  }

  Future<void> _restore() async {
    try {
      final session = await _repo.restore();
      state = session == null
          ? AuthSignedOut(ended: ref.read(sessionEndRecorderProvider).take())
          : AuthSignedIn(session);
    } on PmartFailure {
      // 결과를 모른다(네트워크 등): 보관한 토큰은 두고 로그인 화면으로. 다시 켜면 다시 시도한다.
      state = const AuthSignedOut();
    }
  }

  /// 브라우저로 로그인한다. 실패는 [LoginFailure] 로 던진다(화면이 안내한다).
  Future<void> login() async {
    final session = await _repo.login();
    ref.read(sessionEndRecorderProvider).take(); // 지난 종료 사유는 버린다
    state = AuthSignedIn(session);
  }

  /// 임시 아이디·비밀번호 로그인(목 전용 — [TemporaryPasswordLogin]). 실패는 [LoginFailure].
  Future<void> loginWithPassword({
    required String loginId,
    required String password,
  }) async {
    final Object repo = _repo;
    if (repo is! TemporaryPasswordLogin) {
      throw const LoginFailure(LoginError.unknown);
    }
    final session = await repo.loginWithPassword(
      loginId: loginId,
      password: password,
    );
    ref.read(sessionEndRecorderProvider).take();
    state = AuthSignedIn(session);
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AuthSignedOut();
  }

  /// 토큰 갱신이 거절됐다(무활동 30분·최대 12시간·정지/퇴사). Dio 인터셉터가 토큰을 지운 뒤 부른다.
  void sessionExpired() {
    if (state is! AuthSignedIn) return;
    state = AuthSignedOut(
      ended: ref.read(sessionEndRecorderProvider).take() ?? SessionEnd.expired,
    );
  }
}

/// 지금 로그인한 직원(로그인 전이면 null).
final employeeSessionProvider = Provider<EmployeeSession?>(
  (ref) => switch (ref.watch(authControllerProvider)) {
    AuthSignedIn(:final session) => session,
    _ => null,
  },
);
