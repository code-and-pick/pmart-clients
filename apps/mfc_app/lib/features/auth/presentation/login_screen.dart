import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers.dart';
import '../data/auth_repository.dart' show TemporaryPasswordLogin;
import '../domain/employee_auth.dart';
import 'auth_controller.dart';

String loginErrorText(AppLocalizations l10n, LoginError e) => switch (e) {
  LoginError.notRegistered => l10n.loginErrorNotRegistered,
  LoginError.accountNotAvailable => l10n.loginErrorAccountNotAvailable,
  LoginError.cancelled => l10n.loginErrorCancelled,
  LoginError.temporary => l10n.loginErrorTemporary,
  LoginError.ticketInvalid => l10n.loginErrorTicketInvalid,
  LoginError.network => l10n.loginErrorNetwork,
  LoginError.badCredentials => l10n.loginErrorBadCredentials,
  LoginError.unknown => l10n.loginErrorUnknown,
};

/// 직원 로그인 칸 — 첫 화면(기기 설정) 맨 위에 둔다(사용자 2026-11-17 "최상단에 로그인 기능").
/// 버튼 하나 — 아이디·비밀번호는 Keycloak 화면(Custom Tab)에서 넣는다. 앱은 비밀번호를 받지 않는다.
class LoginPanel extends ConsumerStatefulWidget {
  const LoginPanel({super.key});

  @override
  ConsumerState<LoginPanel> createState() => _LoginPanelState();
}

class _LoginPanelState extends ConsumerState<LoginPanel> {
  bool _busy = false;
  LoginError? _error;

  // 임시 아이디·비밀번호 로그인(목 전용)에서만 쓴다. 비밀번호는 이 칸에만 있고 로그·오류 문구에 남기지 않는다.
  final _loginId = TextEditingController();
  final _password = TextEditingController();
  bool _showPassword = false;

  @override
  void dispose() {
    _loginId.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() login) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await login();
      // 성공하면 라우터가 메인으로 보낸다.
    } on LoginFailure catch (e) {
      if (mounted) setState(() => _error = e.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _login() =>
      _run(() => ref.read(authControllerProvider.notifier).login());

  Future<void> _loginWithPassword() async {
    final loginId = _loginId.text.trim();
    final password = _password.text;
    if (loginId.isEmpty || password.isEmpty) return;
    await _run(
      () => ref
          .read(authControllerProvider.notifier)
          .loginWithPassword(loginId: loginId, password: password),
    );
    // 맞든 틀리든 입력한 비밀번호는 지운다.
    if (mounted) _password.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final auth = ref.watch(authControllerProvider);
    final ended = auth is AuthSignedOut ? auth.ended : null;
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    // 임시: 저장소가 아이디·비밀번호 로그인을 받으면(목 전용) 버튼 대신 입력 칸을 보인다.
    final passwordForm =
        ref.watch(authRepositoryProvider) is TemporaryPasswordLogin;
    final scheme = theme.colorScheme;
    // 카드 안에 버튼·안내·참고 문구(백오피스 직원 로그인과 같은 배치).
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.loginTitle,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            // 세션이 끝나서 나온 경우의 안내(지금 누른 로그인의 오류가 있으면 그것을 먼저 보인다)
            if (ended != null && _error == null)
              _Notice(
                key: const ValueKey('session-ended'),
                text: switch (ended) {
                  SessionEnd.accountBlocked => l10n.sessionEndedBlocked,
                  SessionEnd.expired => l10n.sessionEndedExpired,
                },
              ),
            if (_error != null)
              _Notice(
                key: const ValueKey('login-error'),
                text: loginErrorText(l10n, _error!),
                error: true,
              ),
            if (passwordForm) ...[
              TextField(
                key: const ValueKey('login-id'),
                controller: _loginId,
                enabled: !_busy,
                autocorrect: false,
                enableSuggestions: false,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.username],
                maxLength: 64,
                decoration: InputDecoration(
                  labelText: l10n.loginIdLabel,
                  hintText: l10n.loginIdHint,
                  prefixIcon: const Icon(Icons.badge_outlined),
                  border: const OutlineInputBorder(),
                  counterText: '',
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('login-password'),
                controller: _password,
                enabled: !_busy,
                obscureText: !_showPassword,
                autocorrect: false,
                enableSuggestions: false,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                maxLength: 128,
                decoration: InputDecoration(
                  labelText: l10n.loginPasswordLabel,
                  prefixIcon: const Icon(Icons.lock_outline),
                  border: const OutlineInputBorder(),
                  counterText: '',
                  suffixIcon: IconButton(
                    key: const ValueKey('login-password-toggle'),
                    tooltip: _showPassword
                        ? l10n.loginPasswordHide
                        : l10n.loginPasswordShow,
                    icon: Icon(
                      _showPassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                    ),
                    onPressed: () =>
                        setState(() => _showPassword = !_showPassword),
                  ),
                ),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _loginWithPassword(),
              ),
              const SizedBox(height: 16),
            ],
            // 장갑을 끼고도 누를 수 있게 크게.
            FilledButton.icon(
              key: const ValueKey('employee-login'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(60),
                textStyle: theme.textTheme.titleMedium,
              ),
              onPressed: _busy
                  ? null
                  : !passwordForm
                  ? _login
                  : (_loginId.text.trim().isEmpty || _password.text.isEmpty)
                  ? null
                  : _loginWithPassword,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.login),
              label: Text(
                _busy
                    ? l10n.loginInProgress
                    : passwordForm
                    ? l10n.loginSubmit
                    : l10n.loginButton,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              passwordForm
                  ? l10n.loginTemporaryNote
                  : mock
                  ? l10n.loginMockNote
                  : l10n.loginNote,
              key: passwordForm
                  ? const ValueKey('login-temporary-note')
                  : mock
                  ? const ValueKey('login-mock-note')
                  : null,
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({super.key, required this.text, this.error = false});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: error ? scheme.errorContainer : scheme.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            text,
            style: TextStyle(
              color: error
                  ? scheme.onErrorContainer
                  : scheme.onSecondaryContainer,
            ),
          ),
        ),
      ),
    );
  }
}

/// 앱을 켠 직후 세션을 되살리는 동안.
class StartingScreen extends StatelessWidget {
  const StartingScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}
