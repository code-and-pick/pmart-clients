import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
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
/// 계약(인증 여부·가입한 라이더가 인증을 붙이는 길)은 라이더 백엔드에 요청 중이라, 지금은 목 모드에서만 뜬다.
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
    // 인증 화면은 가입한 라이더용 계약이 나오면 연다(지금은 안내만).
    showRiderToast(context, AppLocalizations.of(context).phoneVerifySoon);
  }
}

/// 흰 팝업 — 연보라 원 안 전화 그림 · 굵은 제목 · 한두 줄 · [나중에] [지금 인증하기].
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
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: RiderColors.primaryPale,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.phone_iphone_rounded,
                  size: 24,
                  color: RiderColors.primary,
                ),
              ),
            ),
            const SizedBox(height: 14),
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
