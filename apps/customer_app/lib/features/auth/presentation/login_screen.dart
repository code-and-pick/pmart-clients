import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/auth_repository.dart' show consentTypeOf;
import '../domain/auth.dart';

import 'package:pmart_core/pmart_core.dart' show PmartEnv, ProblemCode;

import '../../../shared/providers.dart' show envProvider;
import 'auth_controller.dart';

/// SCR-AUTH-001·CONSENT-001. 로그인되면 `true` 로 돌아간다. 취소·실패는 원래 화면을 그대로 둔다.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.purpose = LoginPurpose.general});

  final LoginPurpose purpose;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _agreed = <String>{};

  String _providerLabel(AppLocalizations l10n, SocialProvider p) => switch (p) {
    SocialProvider.kakao => l10n.loginKakao,
    SocialProvider.naver => l10n.loginNaver,
    SocialProvider.apple => l10n.loginApple,
    SocialProvider.google => l10n.loginGoogle,
  };

  String _consentLabel(AppLocalizations l10n, String item) =>
      switch (consentTypeOf(item)) {
        'TERMS_OF_SERVICE' => l10n.consentTerms,
        'PRIVACY_POLICY' => l10n.consentPrivacy,
        'AGE_OVER_14' => l10n.consentAge14,
        'MARKETING' => l10n.consentMarketing,
        // 모르는 항목은 서버 코드 그대로(지어내지 않는다)
        _ => consentTypeOf(item),
      };

  /// 이 동의 대기에 대해 고객이 고른 선택 항목(기본 해제). 동의 대기가 바뀌면 비운다.
  String? _consentFor;

  /// 새로 가입한 계정은 내 정보(이름·휴대폰 번호)부터 받는다(소셜 로그인이 번호를 주지 않음). 끝나면 원래 화면으로.
  Future<void> _afterLogin({required bool newAccount}) async {
    if (newAccount) await context.push<bool>('/me/info?from=signup');
    if (!mounted) return;
    if (context.canPop()) context.pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = loginFlowProvider(widget.purpose);
    final flow = ref.watch(provider);
    final controller = ref.read(provider.notifier);

    ref.listen(provider, (_, next) {
      if (next case LoginSettled(outcome: LoginMember(:final newAccount))) {
        _afterLogin(newAccount: newAccount);
      }
      if (next case LoginSettled(outcome: LoginCancelled())) {
        // 고객 취소는 오류가 아니다. 원래 화면으로 돌아간다.
        if (context.canPop()) context.pop(false);
      }
    });

    final busy = flow is LoginWorking;
    final workingProvider = flow is LoginWorking ? flow.provider : null;
    final outcome = switch (flow) {
      LoginSettled(:final outcome) => outcome,
      _ => null,
    };

    if (outcome case final LoginNeedsConsent waiting) {
      if (_consentFor != waiting.authRequestId) {
        _consentFor = waiting.authRequestId;
        _agreed.clear();
      }
      final allAgreed = waiting.requiredConsents.every(_agreed.contains);
      Widget box(String c, String title) => CheckboxListTile(
        key: ValueKey('consent-$c'),
        value: _agreed.contains(c),
        title: Text(title),
        onChanged: busy
            ? null
            : (v) => setState(
                () => (v ?? false) ? _agreed.add(c) : _agreed.remove(c),
              ),
      );
      final error = switch (waiting.lastError) {
        null => null,
        AuthProblemCode.requiredConsentMissing => l10n.consentMissing,
        ProblemCode.unknownResult => l10n.consentUnknown,
        _ => l10n.loginRejected,
      };
      return Scaffold(
        appBar: AppBar(title: Text(l10n.consentTitle)),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // 기존 회원(newAccount=false)은 약관이 바뀌어 다시 묻는 것이다.
            Text(
              waiting.newAccount ? l10n.consentBody : l10n.consentReconsentBody,
              key: const ValueKey('consent-body'),
            ),
            for (final c in waiting.requiredConsents)
              box(c, l10n.consentRequired(_consentLabel(l10n, c))),
            for (final c in waiting.optionalConsents)
              box(c, l10n.consentOptional(_consentLabel(l10n, c))),
            if (error != null) ...[
              const SizedBox(height: 8),
              Text(
                error,
                key: const ValueKey('consent-error'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('consent-submit'),
              onPressed: (allAgreed && !busy)
                  ? () => controller.submitConsents(waiting, [
                      for (final c in waiting.requiredConsents)
                        ConsentDecision(c, agreed: true),
                      // 선택 항목은 끈 것도 false 로 보낸다(거부로 기록돼 다시 묻지 않는다)
                      for (final c in waiting.optionalConsents)
                        ConsentDecision(c, agreed: _agreed.contains(c)),
                    ])
                  : null,
              child: Text(l10n.consentSubmit),
            ),
          ],
        ),
      );
    }

    final message = switch (outcome) {
      LoginRestricted(:final retryAfterSeconds) => switch (retryAfterSeconds) {
        final int s => l10n.loginRestrictedFor((s / 60).ceil()),
        null => l10n.loginRestricted,
      },
      LoginProviderUnavailable() => l10n.loginProviderDown,
      LoginRejected(:final code) => switch (code) {
        AuthProblemCode.providerRejected => l10n.loginProviderRejected,
        // 동의 완료가 막혔다(다른 기기·계정, 이미 끝남, 그 사이 약관 버전이 바뀜) — 처음부터
        AuthProblemCode.forbidden ||
        AuthProblemCode.invalidState ||
        AuthProblemCode.consentVersionOutdated => l10n.loginConsentRestart,
        AuthProblemCode.accountNotAvailable ||
        AuthProblemCode.accountNotPurchasable => l10n.loginAccountUnavailable,
        AuthProblemCode.configRequired ||
        AuthProblemCode.providerConfiguration => l10n.loginConfigRequired,
        AuthProblemCode.unsupported => l10n.loginUnsupported,
        _ => l10n.loginRejected,
      },
      LoginUnknown() => l10n.loginUnknown,
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.loginTitle)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(52, 96, 52, 24),
        children: [
          Text(
            l10n.appTitle,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              fontSize: 40,
              fontWeight: FontWeight.w900,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            widget.purpose == LoginPurpose.checkout
                ? l10n.loginForCheckout
                : l10n.loginBody,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (ref.watch(envProvider) == PmartEnv.mock) ...[
            const SizedBox(height: 8),
            Text(
              l10n.loginMockNotice,
              key: const ValueKey('login-mock-notice'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 56),
          if (message != null) ...[
            Text(
              message,
              key: const ValueKey('login-message'),
              textAlign: TextAlign.center,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 12),
          ],
          if (outcome is LoginUnknown)
            OutlinedButton(
              key: const ValueKey('login-check-again'),
              onPressed: busy ? null : controller.checkAgain,
              child: Text(l10n.loginCheckAgain),
            )
          else
            for (final p in ref.watch(loginProvidersProvider))
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: FilledButton.tonal(
                  key: ValueKey('login-${p.name}'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(46),
                    shape: const StadiumBorder(),
                    backgroundColor: Theme.of(context)
                        .colorScheme
                        .surfaceContainer,
                    foregroundColor: Theme.of(context).colorScheme.onSurface,
                    textStyle: Theme.of(context).textTheme.bodyMedium,
                  ),
                  // 제한 중에는 다시 누를 수 없다(남은 시간은 서버 값).
                  onPressed: (busy || outcome is LoginRestricted)
                      ? null
                      : () => controller.start(p),
                  child: workingProvider == p
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(_providerLabel(l10n, p)),
                ),
              ),
        ],
      ),
    );
  }
}
