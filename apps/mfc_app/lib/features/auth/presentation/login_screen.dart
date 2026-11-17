import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

/// 직원 로그인. 버튼 하나 — 아이디·비밀번호는 Keycloak 화면(Custom Tab)에서 넣는다. 앱은 비밀번호를 받지 않는다.
/// 목 앱도 같은 화면이다(사용자 2026-11-17 "목 앱도 실서버 앱처럼 똑같이") — 버튼을 누르면 Keycloak 화면 자리에
/// 앱 안 시험용 로그인 화면([MockSignInPage])이 열린다.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;
  LoginError? _error;

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (ref.read(authRepositoryProvider) is TemporaryPasswordLogin) {
        final done = await Navigator.of(context).push<bool>(
          MaterialPageRoute(
            fullscreenDialog: true,
            builder: (_) => const MockSignInPage(),
          ),
        );
        // 실서버에서 Custom Tab 을 닫은 것과 같다.
        if (done != true) throw const LoginFailure(LoginError.cancelled);
      } else {
        await ref.read(authControllerProvider.notifier).login();
      }
      // 성공하면 라우터가 메인으로 보낸다.
    } on LoginFailure catch (e) {
      if (mounted) setState(() => _error = e.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final auth = ref.watch(authControllerProvider);
    final ended = auth is AuthSignedOut ? auth.ended : null;
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    final scheme = theme.colorScheme;
    // 배치는 다른 앱의 로그인을 따랐다: 고객앱(큰 브랜드 이름 + 한 줄 설명 + 버튼), 백오피스 직원 로그인(카드 안에 버튼·안내·참고 문구).
    return Scaffold(
      // 기기 설정에서 왔으면 뒤로, 세션이 끝나 바로 왔으면 기기 설정으로 가는 버튼.
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: context.canPop()
            ? const BackButton()
            : IconButton(
                key: const ValueKey('login-setup'),
                tooltip: l10n.setupBack,
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => context.go('/setup'),
              ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
            child: ConstrainedBox(
              // 폰·PDA 폭에서는 꽉 차고, 태블릿·브라우저에서는 늘어지지 않는다.
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(
                    Icons.warehouse_outlined,
                    size: 56,
                    color: scheme.primary,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    l10n.homeTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                      color: scheme.primary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.loginSubtitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  if (mock) ...[
                    const SizedBox(height: 12),
                    Center(
                      child: Chip(
                        key: const ValueKey('login-mock-badge'),
                        label: Text(l10n.mockModeBadge),
                      ),
                    ),
                  ],
                  const SizedBox(height: 32),
                  DecoratedBox(
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
                                SessionEnd.accountBlocked =>
                                  l10n.sessionEndedBlocked,
                                SessionEnd.expired => l10n.sessionEndedExpired,
                              },
                            ),
                          if (_error != null)
                            _Notice(
                              key: const ValueKey('login-error'),
                              text: loginErrorText(l10n, _error!),
                              error: true,
                            ),
                          // 장갑을 끼고도 누를 수 있게 크게.
                          FilledButton.icon(
                            key: const ValueKey('employee-login'),
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(60),
                              textStyle: theme.textTheme.titleMedium,
                            ),
                            onPressed: _busy ? null : _login,
                            icon: _busy
                                ? const SizedBox.square(
                                    dimension: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.login),
                            label: Text(
                              _busy ? l10n.loginInProgress : l10n.loginButton,
                            ),
                          ),
                          const SizedBox(height: 16),
                          Text(
                            l10n.loginNote,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 목 앱 전용 — 실서버의 Keycloak 로그인 화면(Custom Tab) 자리에 여는 시험용 로그인 화면.
/// 계약에 없는 임시 화면이라 서버로 보내는 것이 없다. 비밀번호는 이 칸에만 있고 로그·오류 문구에 남기지 않는다.
/// 성공하면 `true` 로 닫힌다. 아이디·비밀번호가 틀리면 Keycloak 처럼 이 화면에서 알리고 머문다.
class MockSignInPage extends ConsumerStatefulWidget {
  const MockSignInPage({super.key});

  @override
  ConsumerState<MockSignInPage> createState() => _MockSignInPageState();
}

class _MockSignInPageState extends ConsumerState<MockSignInPage> {
  final _loginId = TextEditingController();
  final _password = TextEditingController();
  bool _showPassword = false;
  bool _busy = false;
  bool _bad = false;

  @override
  void dispose() {
    _loginId.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _ready =>
      _loginId.text.trim().isNotEmpty && _password.text.isNotEmpty;

  Future<void> _submit() async {
    if (!_ready || _busy) return;
    setState(() {
      _busy = true;
      _bad = false;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .loginWithPassword(
            loginId: _loginId.text.trim(),
            password: _password.text,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on LoginFailure {
      if (mounted) setState(() => _bad = true);
    } finally {
      // 맞든 틀리든 입력한 비밀번호는 지운다.
      if (mounted) {
        _password.clear();
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          key: const ValueKey('mock-signin-close'),
          tooltip: l10n.cancel,
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(false),
        ),
        title: Text(l10n.loginTitle),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (_bad)
              _Notice(
                key: const ValueKey('login-error'),
                text: l10n.loginErrorBadCredentials,
                error: true,
              ),
            TextField(
              key: const ValueKey('login-id'),
              controller: _loginId,
              enabled: !_busy,
              autofocus: true,
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
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('mock-signin-submit'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(60),
                textStyle: theme.textTheme.titleMedium,
              ),
              onPressed: _busy || !_ready ? null : _submit,
              child: Text(l10n.loginSubmit),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.loginTemporaryNote,
              key: const ValueKey('login-temporary-note'),
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
