import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/phone_format.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/phone_identity.dart' show phoneIdentitySkipped;
import '../data/profile.dart';

/// 이번 실행에서 이미 물었는지 — "나중에"를 누르면 앱을 다시 켤 때까지 다시 묻지 않는다.
final phoneVerifyPromptShownProvider = NotifierProvider<_Shown, bool>(
  _Shown.new,
);

class _Shown extends Notifier<bool> {
  @override
  bool build() => false;

  void mark() => state = true;
}

/// 전화번호 인증을 안 한 기존 가입자에게 한 번 묻는다(2026-11-25 사용자 "전화번호 인증이 뒤늦게 생겨서 이미 가입했는데
/// 인증 안 한 계정은 전화번호 인증하라고 팝업"). 서버가 `phoneVerified` 를 false 로 줄 때만 — 모르면(null) 묻지 않는다.
/// rider 0.28.0 — 인증은 [PhoneVerifyScreen](번호 → 본인 확인 → PATCH /riders/me phone + phoneVerificationId).
Future<void> maybeAskPhoneVerify(BuildContext context, WidgetRef ref) async {
  final profile = ref.read(profileProvider).value;
  if (profile == null || profile.phoneVerified != false) return;
  if (ref.read(phoneVerifyPromptShownProvider)) return;
  ref.read(phoneVerifyPromptShownProvider.notifier).mark();
  final go = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const PhoneVerifyDialog(),
  );
  if (go == true && context.mounted) {
    unawaited(context.push('/my/phone-verify'));
  }
}

/// 흰 팝업 — 굵은 제목(전화 그림은 2026-11-25 사용자 요청으로 뺌) · 한두 줄 · [나중에] [지금 인증하기].
class PhoneVerifyDialog extends StatelessWidget {
  const PhoneVerifyDialog({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Dialog(
      key: const ValueKey('phone-verify-dialog'),
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.phoneVerifyTitle,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: RiderColors.ink,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              l10n.phoneVerifyBody,
              style: const TextStyle(
                fontSize: 15,
                height: 1.5,
                color: RiderColors.sub,
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const ValueKey('phone-verify-later'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      foregroundColor: RiderColors.ink,
                      side: const BorderSide(color: RiderColors.line),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    onPressed: () => Navigator.of(context).pop(false),
                    child: Text(l10n.phoneVerifyLater),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    key: const ValueKey('phone-verify-go'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: RiderColors.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    onPressed: () => Navigator.of(context).pop(true),
                    child: Text(
                      l10n.phoneVerifyGo,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// 가입한 라이더의 전화번호 인증 — 번호 넣기 → 본인 확인(가입과 같은 OCTOMO 화면) → 내 정보에 붙이기.
/// 서버가 붙였다고 답할 때만 "마쳤어요"(결과를 모르면 내 정보를 다시 읽어 맞춘다).
class PhoneVerifyScreen extends ConsumerStatefulWidget {
  const PhoneVerifyScreen({super.key});

  @override
  ConsumerState<PhoneVerifyScreen> createState() => _PhoneVerifyScreenState();
}

class _PhoneVerifyScreenState extends ConsumerState<PhoneVerifyScreen> {
  final _phone = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  bool get _valid {
    final d = phoneDigits(_phone.text);
    return d.length == 11 && d.startsWith('010');
  }

  Future<void> _start() async {
    if (_busy || !_valid) return;
    final l10n = AppLocalizations.of(context);
    final phone = phoneDigits(_phone.text);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = await context.push<String>(
        '/my/phone-verify/check',
        extra: phone,
      );
      if (!mounted || id == null || id == phoneIdentitySkipped) return;
      final repo = ref.read(profileRepositoryProvider);
      final key = IdempotencyKey.generate();
      try {
        final fresh = await repo.me();
        await repo.attachVerifiedPhone(
          phone: phone,
          phoneVerificationId: id,
          expectedVersion: fresh.version,
          key: key,
        );
      } on ProblemFailure catch (f) {
        if (f.problem.status < 500) {
          setState(
            () => _error = switch (f.problem.code) {
              'PHONE_NOT_VERIFIED' => l10n.phoneAttachNotVerified,
              'IDENTITY_ALREADY_REGISTERED' => l10n.phoneAttachOther,
              'RIDER_REJOIN_BLOCKED' => l10n.phoneAttachBlocked,
              _ => l10n.phoneAttachFailed,
            },
          );
          return;
        }
      } on PmartFailure {
        // 결과를 모른다 — 아래에서 내 정보를 다시 읽어 맞춘다.
      }
      final now = await ref.refresh(profileProvider.future);
      if (!mounted) return;
      if (now.phoneVerified == true) {
        showRiderToast(context, l10n.phoneAttachDone);
        context.pop();
      } else {
        setState(() => _error = l10n.phoneAttachFailed);
      }
    } on PmartFailure {
      if (mounted) setState(() => _error = l10n.phoneAttachFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(l10n.phoneVerifyTitleShort)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.phoneVerifyHeadline,
                style: const TextStyle(
                  fontSize: 22,
                  height: 1.4,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
              const SizedBox(height: 28),
              Text(
                l10n.phoneVerifyField,
                style: const TextStyle(fontSize: 15, color: RiderColors.ink),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('phone-verify-input'),
                controller: _phone,
                autofocus: true,
                enabled: !_busy,
                keyboardType: TextInputType.phone,
                inputFormatters: const [PhoneNumberFormatter()],
                decoration: const InputDecoration(hintText: '010-0000-0000'),
                onChanged: (_) => setState(() => _error = null),
              ),
              if (_error case final e?) ...[
                const SizedBox(height: 8),
                Text(
                  e,
                  key: const ValueKey('phone-verify-error'),
                  style: const TextStyle(
                    fontSize: 14,
                    color: RiderColors.danger,
                  ),
                ),
              ],
              const Spacer(),
              RiderButton(
                key: const ValueKey('phone-verify-start'),
                label: l10n.phoneVerifyStart,
                onPressed: _busy || !_valid ? null : _start,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
