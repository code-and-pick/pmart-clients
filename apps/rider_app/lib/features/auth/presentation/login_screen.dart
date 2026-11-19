import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/rider_auth.dart';
import '../data/session.dart';

/// 로그인 결과 안내(로그인됨·취소는 안내 없음).
/// [provider] 는 준비 안 됨(notReady) 안내에 쓰는 제공자 이름.
String? loginResultText(
  AppLocalizations l10n,
  LoginResult r, {
  RiderSocialProvider provider = RiderSocialProvider.google,
}) => switch (r) {
  LoginResult.loggedIn || LoginResult.canceled => null,
  LoginResult.misconfigured => l10n.loginMisconfigured,
  LoginResult.rejected => l10n.loginRejected,
  LoginResult.unavailable => l10n.loginUnavailable,
  LoginResult.unsupported => l10n.loginUnsupported,
  LoginResult.notReady => l10n.loginProviderNotReady(
    providerName(l10n, provider),
  ),
};

String loginLabel(AppLocalizations l10n, RiderSocialProvider p) => switch (p) {
  RiderSocialProvider.google => l10n.loginGoogle,
  RiderSocialProvider.kakao => l10n.loginKakao,
  RiderSocialProvider.naver => l10n.loginNaver,
};

String providerName(AppLocalizations l10n, RiderSocialProvider p) =>
    switch (p) {
      RiderSocialProvider.google => l10n.providerGoogle,
      RiderSocialProvider.kakao => l10n.providerKakao,
      RiderSocialProvider.naver => l10n.providerNaver,
    };

/// 제공자 로그인 버튼(구글 = 주 색, 카카오 = 노랑·검정 글자, 네이버 = 초록). 키 `login-<제공자>`.
class SocialLoginButton extends StatelessWidget {
  const SocialLoginButton({
    super.key,
    required this.provider,
    required this.onPressed,
  });

  final RiderSocialProvider provider;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return RiderButton(
      key: ValueKey('login-${provider.name}'),
      label: loginLabel(l10n, provider),
      onPressed: onPressed,
      color: switch (provider) {
        RiderSocialProvider.google => RiderColors.primary,
        RiderSocialProvider.kakao => RiderColors.kakao,
        RiderSocialProvider.naver => RiderColors.naver,
      },
      foreground: provider == RiderSocialProvider.kakao
          ? RiderColors.kakaoInk
          : Colors.white,
    );
  }
}

/// 로그인. 라이더 인증은 소셜 로그인이다(백엔드 ADR-0054·0055) — 레퍼런스의 아이디·비밀번호 칸은 두지 않는다.
/// 구글 아래 카카오·네이버(사용자 2026-11-19). 실서버는 rider-auth 가 받는 제공자만 보인다([riderSocialProvidersProvider]).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;

  Future<void> _login(RiderSocialProvider provider) async {
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    final result = await ref.read(sessionProvider.notifier).login(provider);
    if (!mounted) return;
    setState(() => _busy = false);
    if (loginResultText(l10n, result, provider: provider) case final text?) {
      showRiderToast(context, text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 72),
              Text(
                l10n.loginHello,
                style: const TextStyle(
                  fontSize: 28,
                  height: 1.45,
                  color: RiderColors.ink,
                ),
              ),
              const SizedBox(height: 36),
              Text(
                l10n.loginGuide,
                style: const TextStyle(fontSize: 15, color: RiderColors.sub),
              ),
              const SizedBox(height: 20),
              for (final (i, p)
                  in ref.watch(riderSocialProvidersProvider).indexed) ...[
                if (i > 0) const SizedBox(height: 10),
                SocialLoginButton(
                  provider: p,
                  onPressed: _busy ? null : () => _login(p),
                ),
              ],
              const Spacer(),
              Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      l10n.loginNoAccount,
                      style: const TextStyle(
                        fontSize: 15,
                        color: RiderColors.ink,
                      ),
                    ),
                    InkWell(
                      key: const ValueKey('login-apply'),
                      onTap: () => context.push('/signup/intro'),
                      child: Padding(
                        padding: const EdgeInsets.all(6),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              l10n.loginApply,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: RiderColors.primary,
                              ),
                            ),
                            const Icon(
                              Icons.chevron_right,
                              size: 18,
                              color: RiderColors.primary,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
