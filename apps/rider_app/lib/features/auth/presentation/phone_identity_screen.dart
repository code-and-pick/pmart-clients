import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/phone_identity.dart';
import '../data/session.dart';
import 'login_screen.dart' show SocialLoginButton, providerName;

/// 문자 앱을 받는 번호·본문을 채워 연다(`sms:`). 못 열면 false(화면이 복사 안내). 번호·본문은 로그에 남기지 않는다.
final smsComposerProvider =
    Provider<Future<bool> Function(String to, String body)>(
      (_) => (to, body) async {
        if (Platform.environment.containsKey('FLUTTER_TEST')) return true;
        try {
          return await launchUrl(
            Uri(scheme: 'sms', path: to, queryParameters: {'body': body}),
          );
        } on Object {
          return false;
        }
      },
    );

/// 서버 날짜를 서울 날짜로(YYYY-MM-DD).
String seoulDate(DateTime instant) =>
    DateFormat('yyyy-MM-dd').format(toSeoulWallClock(instant));

/// "보냈어요" 뒤 안내(진행 중 상태).
enum _Note { none, pending, busy, expired, failed }

/// 휴대폰 본인 확인(OCTOMO) — 대표번호로 문자를 보내고 "보냈어요"를 누른다. 확인되면 확인 ID(가입에 넣는 phoneVerificationId)로 닫는다.
///
/// 이 번호로 가입한 다른 계정이 있으면(시작 409) 그 계정 안내(제공자·가입일·가린 이메일 + 그 제공자로 로그인),
/// 탈퇴한 번호면 다시 가입할 수 있는 날(서버 값)을 보인다.
/// 서버에 확인 설정이 없으면(422 CONFIG_REQUIRED) 준비 중 안내 + "확인 없이 계속" — [phoneIdentitySkipped] 로 닫는다
/// (가입을 받을지는 서버가 정한다: 확인이 필수로 켜지면 가입이 422 PHONE_NOT_VERIFIED).
class PhoneIdentityScreen extends ConsumerStatefulWidget {
  const PhoneIdentityScreen({super.key, required this.phone});

  final String phone;

  @override
  ConsumerState<PhoneIdentityScreen> createState() =>
      _PhoneIdentityScreenState();
}

class _PhoneIdentityScreenState extends ConsumerState<PhoneIdentityScreen> {
  PhoneIdentityStart? _start;
  bool _startFailed = false;

  /// 시작을 서버가 거절했다(010 아님·하루 횟수 초과) — 다시 시도 버튼 없이 안내만.
  PhoneIdentityStartRejection? _rejected;
  bool _confirming = false;
  _Note _note = _Note.none;
  int _remaining = 0;

  /// 끝난 결과(기존 계정·재가입 제한) — 화면 전체가 안내로 바뀐다.
  PhoneIdentityOutcome? _final;

  /// 시작 키(다시 시작마다 새 키). 확인 키는 한 번 누름 단위 — 503(혼잡) 뒤 다시 누르면 같은 키.
  IdempotencyKey _startKey = IdempotencyKey.generate();
  IdempotencyKey? _confirmKey;

  PhoneIdentityRepository get _repo =>
      ref.read(phoneIdentityRepositoryProvider)!;

  @override
  void initState() {
    super.initState();
    _begin();
  }

  Future<void> _begin() async {
    setState(() {
      _start = null;
      _startFailed = false;
      _rejected = null;
      _note = _Note.none;
      _confirmKey = null;
    });
    try {
      final s = await _repo.start(widget.phone, _startKey);
      if (!mounted) return;
      setState(() {
        _start = s;
        _remaining = s.maxAttempts ?? 0;
      });
    } on PhoneIdentityStartRejected catch (e) {
      if (mounted) setState(() => _rejected = e.reason);
    } on PhoneIdentityStartEnded catch (e) {
      if (mounted) setState(() => _final = e.outcome);
    } on PmartFailure {
      if (mounted) setState(() => _startFailed = true);
    }
  }

  void _restart() {
    _startKey = IdempotencyKey.generate();
    _begin();
  }

  Future<void> _openSms() async {
    final s = _start;
    if (s == null) return;
    final ok = await ref.read(smsComposerProvider)(s.sendTo, s.text);
    if (!ok && mounted) {
      showRiderToast(context, AppLocalizations.of(context).phoneIdSmsFailed);
    }
  }

  Future<void> _copy(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (mounted) {
      showRiderToast(context, AppLocalizations.of(context).phoneIdCopied);
    }
  }

  Future<void> _confirm() async {
    final s = _start;
    if (s == null || _confirming) return;
    final key = _confirmKey ??= IdempotencyKey.generate();
    setState(() => _confirming = true);
    final PhoneIdentityOutcome outcome;
    try {
      outcome = await _repo.confirm(s.verificationId, widget.phone, key);
    } on PhoneIdentityBusy {
      // 시도 횟수는 줄지 않았다 — 같은 키로 다시 누르게 둔다.
      if (mounted) {
        setState(() {
          _confirming = false;
          _note = _Note.busy;
        });
      }
      return;
    } on PmartFailure {
      // 확인했는지 모른다 — 실패로 단정하지 않고 같은 키로 다시 누르게 둔다.
      if (mounted) {
        setState(() {
          _confirming = false;
          _note = _Note.busy;
        });
      }
      return;
    }
    if (!mounted) return;
    _confirmKey = null; // 결과를 받았다 — 다음 누름은 새 시도.
    switch (outcome) {
      case PhoneIdentityVerified():
        showRiderToast(context, AppLocalizations.of(context).phoneIdDone);
        // 가입 요청에 넣을 확인 ID(phoneVerificationId)로 닫는다.
        context.pop(s.verificationId);
        return;
      case PhoneIdentityPending(:final remainingAttempts):
        setState(() {
          _confirming = false;
          _note = _Note.pending;
          _remaining = remainingAttempts;
        });
      case PhoneIdentityExpired():
        setState(() {
          _confirming = false;
          _note = _Note.expired;
        });
      case PhoneIdentityFailed():
        setState(() {
          _confirming = false;
          _note = _Note.failed;
        });
      case PhoneIdentityAlreadyRegistered() || PhoneIdentityRejoinBlocked():
        setState(() {
          _confirming = false;
          _final = outcome;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.phoneIdTitle)),
      body: SafeArea(
        child:
            switch (_final) {
              final o? => identityEndedView(o, onClose: () => context.pop()),
              null => null,
            } ??
            _body(l10n),
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    final s = _start;
    if (_rejected case final r?) {
      final (title, sub) = switch (r) {
        PhoneIdentityStartRejection.notSupported => (
          l10n.phoneIdNotSupported,
          l10n.phoneIdNotSupportedSub,
        ),
        PhoneIdentityStartRejection.tooMany => (
          l10n.phoneIdTooMany,
          l10n.phoneIdTooManySub,
        ),
        PhoneIdentityStartRejection.notReady => (
          l10n.phoneIdNotReady,
          l10n.phoneIdNotReadySub,
        ),
      };
      final notReady = r == PhoneIdentityStartRejection.notReady;
      return IdentityLayout(
        icon: notReady ? Icons.hourglass_empty_rounded : Icons.block_rounded,
        tone: notReady ? IdentityTone.info : IdentityTone.warn,
        title: title,
        titleKey: const ValueKey('phone-id-rejected'),
        sub: sub,
        actions: [
          // 서버가 아직 확인을 받지 않는다 — 확인 없이 가입을 이어 간다(받을지는 가입 때 서버가 정한다).
          if (notReady)
            RiderButton(
              key: const ValueKey('phone-id-skip'),
              label: l10n.phoneIdSkip,
              height: 52,
              onPressed: () => context.pop(phoneIdentitySkipped),
            )
          else
            RiderButton(
              key: const ValueKey('phone-id-ok'),
              label: l10n.phoneIdOk,
              height: 52,
              onPressed: () => context.pop(),
            ),
        ],
      );
    }
    if (_startFailed) {
      return IdentityLayout(
        icon: Icons.wifi_off_rounded,
        tone: IdentityTone.warn,
        title: l10n.phoneIdStartFailed,
        titleKey: const ValueKey('phone-id-start-failed'),
        sub: l10n.phoneIdStartFailedSub,
        actions: [
          RiderButton(
            key: const ValueKey('phone-id-retry'),
            label: l10n.phoneIdRetry,
            height: 52,
            onPressed: _begin, // 같은 시작 키로 다시
          ),
        ],
      );
    }
    if (s == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final ended = _note == _Note.expired || _note == _Note.failed;
    return IdentityLayout(
      title: l10n.phoneIdGuide,
      sub: l10n.phoneIdGuideSub,
      content: [
        _SmsCard(
          sendTo: s.sendTo,
          text: s.text,
          sendToLabel: l10n.phoneIdSendTo,
          textLabel: l10n.phoneIdText,
          copyLabel: l10n.phoneIdCopy,
          onCopy: _copy,
          dimmed: ended,
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Text(
              l10n.phoneIdTarget(s.phoneMasked),
              style: const TextStyle(fontSize: 13, color: RiderColors.sub),
            ),
            const Spacer(),
            Text(
              l10n.phoneIdExpires(formatSeoulTime(s.expiresAt)),
              style: const TextStyle(fontSize: 13, color: RiderColors.sub),
            ),
          ],
        ),
        if (_note != _Note.none) ...[
          const SizedBox(height: 20),
          _NoteBox(
            tone: switch (_note) {
              _Note.expired || _Note.failed => IdentityTone.warn,
              _Note.busy => IdentityTone.notice,
              _ => IdentityTone.info,
            },
            title: switch (_note) {
              _Note.pending => l10n.phoneIdPending,
              _Note.busy => l10n.phoneIdBusy,
              _Note.expired => l10n.phoneIdExpired,
              _Note.failed => l10n.phoneIdFailed,
              _Note.none => '',
            },
            sub: switch (_note) {
              _Note.pending => l10n.phoneIdPendingSub(_remaining),
              _Note.busy => l10n.phoneIdBusySub,
              _Note.expired => l10n.phoneIdExpiredSub,
              _Note.failed => l10n.phoneIdFailedSub,
              _Note.none => '',
            },
          ),
        ],
      ],
      actions: [
        if (!ended) ...[
          RiderOutlineButton(
            key: const ValueKey('phone-id-open-sms'),
            label: l10n.phoneIdOpenSms,
            height: 52,
            onPressed: _openSms,
          ),
          const SizedBox(height: 8),
          RiderButton(
            key: const ValueKey('phone-id-sent'),
            label: _confirming ? l10n.phoneIdChecking : l10n.phoneIdSent,
            height: 52,
            onPressed: _confirming ? null : _confirm,
          ),
        ] else
          RiderButton(
            key: const ValueKey('phone-id-restart'),
            label: l10n.phoneIdRestart,
            height: 52,
            onPressed: _restart,
          ),
      ],
    );
  }
}

/// 안내 색(아이콘 동그라미·안내 상자 바탕).
enum IdentityTone { info, notice, warn }

(Color, Color) _toneColors(IdentityTone t) => switch (t) {
  IdentityTone.info => (RiderColors.primaryMist, RiderColors.primary),
  IdentityTone.notice => (RiderColors.notice, RiderColors.pickup),
  IdentityTone.warn => (const Color(0xFFFDEEEE), RiderColors.danger),
};

/// 본인 확인 화면들의 같은 틀 — 위: (아이콘) 제목·한 줄 설명·내용, 아래: 화면 바닥에 붙은 버튼.
/// 제목·설명은 한 줄에 들어가게 짧게 쓴다(사용자 2026-11-20 "문장 길어서 2줄 되고 … 위로 다닥다닥 붙어있고").
class IdentityLayout extends StatelessWidget {
  const IdentityLayout({
    super.key,
    required this.title,
    this.titleKey,
    required this.sub,
    this.icon,
    this.tone = IdentityTone.info,
    this.content = const [],
    required this.actions,
  });

  final String title;
  final Key? titleKey;
  final String sub;
  final IconData? icon;
  final IdentityTone tone;
  final List<Widget> content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final (soft, strong) = _toneColors(tone);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
            children: [
              if (icon case final i?) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: soft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(i, color: strong, size: 28),
                  ),
                ),
                const SizedBox(height: 20),
              ],
              Text(
                title,
                key: titleKey,
                style: const TextStyle(
                  fontSize: 22,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                sub,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.5,
                  color: RiderColors.sub,
                ),
              ),
              if (content.isNotEmpty) ...[
                const SizedBox(height: 28),
                ...content,
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: actions,
          ),
        ),
      ],
    );
  }
}

/// 받는 번호·보낼 내용 — 한 상자에 두 줄, 줄마다 복사.
class _SmsCard extends StatelessWidget {
  const _SmsCard({
    required this.sendTo,
    required this.text,
    required this.sendToLabel,
    required this.textLabel,
    required this.copyLabel,
    required this.onCopy,
    required this.dimmed,
  });

  final String sendTo;
  final String text;
  final String sendToLabel;
  final String textLabel;
  final String copyLabel;
  final void Function(String) onCopy;
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    Widget row(String label, String value, Key key) => Padding(
      key: key,
      padding: const EdgeInsets.fromLTRB(18, 16, 12, 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 13, color: RiderColors.sub),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: dimmed ? RiderColors.hint : RiderColors.ink,
                  ),
                ),
              ],
            ),
          ),
          OutlinedButton(
            onPressed: dimmed ? null : () => onCopy(value),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(56, 34),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              foregroundColor: RiderColors.primary,
              side: const BorderSide(color: RiderColors.line),
              shape: const StadiumBorder(),
              textStyle: const TextStyle(
                fontFamily: riderFontFamily,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: Text(copyLabel),
          ),
        ],
      ),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: RiderColors.line),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          row(sendToLabel, sendTo, const ValueKey('phone-id-send-to')),
          const Divider(height: 1, indent: 18, endIndent: 18),
          row(textLabel, text, const ValueKey('phone-id-text')),
        ],
      ),
    );
  }
}

/// "보냈어요" 뒤 안내 상자 — 굵은 한 줄 + 작은 한 줄.
class _NoteBox extends StatelessWidget {
  const _NoteBox({required this.tone, required this.title, required this.sub});

  final IdentityTone tone;
  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) {
    final (soft, strong) = _toneColors(tone);
    return Container(
      key: const ValueKey('phone-id-note'),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(
              tone == IdentityTone.info
                  ? Icons.info_outline_rounded
                  : Icons.error_outline_rounded,
              size: 20,
              color: strong,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: strong,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  sub,
                  style: const TextStyle(fontSize: 13, color: RiderColors.sub),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 다른 계정이 있음·탈퇴한 번호 안내. 그 밖의 결과는 null.
Widget? identityEndedView(
  PhoneIdentityOutcome outcome, {
  required VoidCallback onClose,
}) => switch (outcome) {
  PhoneIdentityAlreadyRegistered(:final account) => _ExistingAccount(
    account: account,
    onOtherPhone: onClose,
  ),
  PhoneIdentityRejoinBlocked(:final until) => _RejoinBlocked(
    availableAt: until,
    onOk: onClose,
  ),
  _ => null,
};

/// 가입(`POST /riders/signups`)이 409 IDENTITY_ALREADY_REGISTERED·RIDER_REJOIN_BLOCKED 로 거절했을 때 같은 안내.
/// 닫으면 가입 화면(전화번호 단계)으로 돌아간다.
class IdentityEndedScreen extends StatelessWidget {
  const IdentityEndedScreen({super.key, required this.outcome});

  final PhoneIdentityOutcome outcome;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(AppLocalizations.of(context).phoneIdTitle)),
    body: SafeArea(
      child:
          identityEndedView(outcome, onClose: () => context.pop()) ??
          const SizedBox.shrink(),
    ),
  );
}

/// 이 번호로 가입한 계정이 있다 — 그 제공자로 로그인하게 안내한다(다른 이커머스처럼).
class _ExistingAccount extends ConsumerWidget {
  const _ExistingAccount({required this.account, required this.onOtherPhone});

  final ExistingRiderAccount account;
  final VoidCallback onOtherPhone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    Widget row(String label, String value, Key key) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: const TextStyle(fontSize: 14, color: RiderColors.sub),
            ),
          ),
          Expanded(
            child: Text(
              value,
              key: key,
              textAlign: TextAlign.end,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: RiderColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
    final rows = [
      if (account.provider case final p?)
        row(
          l10n.existingProvider,
          providerName(l10n, p),
          const ValueKey('existing-provider'),
        ),
      if (account.joinedAt case final at?)
        row(
          l10n.existingJoined,
          seoulDate(at),
          const ValueKey('existing-joined'),
        ),
      if (account.emailMasked case final email?)
        row(l10n.existingEmail, email, const ValueKey('existing-email')),
    ];
    return KeyedSubtree(
      key: const ValueKey('existing-account'),
      child: IdentityLayout(
        icon: Icons.person_search_rounded,
        title: l10n.existingTitle,
        sub: l10n.existingBody,
        content: [
          if (rows.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
              decoration: BoxDecoration(
                border: Border.all(color: RiderColors.line),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(children: rows),
            ),
          const SizedBox(height: 12),
          Text(
            l10n.existingHint,
            style: const TextStyle(fontSize: 13, color: RiderColors.hint),
          ),
        ],
        actions: [
          // 지금(가입 중) 세션을 끝내고 그 제공자로 로그인한다. 서버가 수단을 알려 주지 않으면 로그인 화면으로.
          if (account.provider case final p?)
            SocialLoginButton(
              provider: p,
              onPressed: () =>
                  ref.read(sessionProvider.notifier).switchAccount(p),
            )
          else
            RiderButton(
              key: const ValueKey('existing-to-login'),
              label: l10n.existingToLogin,
              height: 52,
              onPressed: () => ref.read(sessionProvider.notifier).logout(),
            ),
          const SizedBox(height: 4),
          TextButton(
            key: const ValueKey('existing-other-phone'),
            onPressed: onOtherPhone,
            style: TextButton.styleFrom(
              foregroundColor: RiderColors.sub,
              minimumSize: const Size.fromHeight(44),
              textStyle: const TextStyle(
                fontFamily: riderFontFamily,
                fontSize: 14,
              ),
            ),
            child: Text(l10n.existingOtherPhone),
          ),
        ],
      ),
    );
  }
}

class _RejoinBlocked extends StatelessWidget {
  const _RejoinBlocked({required this.availableAt, required this.onOk});

  final DateTime availableAt;
  final VoidCallback onOk;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IdentityLayout(
      icon: Icons.event_busy_rounded,
      tone: IdentityTone.notice,
      title: l10n.rejoinTitle,
      sub: l10n.rejoinSub,
      content: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            color: RiderColors.field,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            l10n.rejoinBody(seoulDate(availableAt)),
            key: const ValueKey('rejoin-blocked'),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: RiderColors.ink,
            ),
          ),
        ),
      ],
      actions: [
        RiderButton(
          key: const ValueKey('rejoin-ok'),
          label: l10n.rejoinOk,
          height: 52,
          onPressed: onOk,
        ),
      ],
    );
  }
}
