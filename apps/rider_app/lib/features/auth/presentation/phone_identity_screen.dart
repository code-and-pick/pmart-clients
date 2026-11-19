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
      return _Centered(
        children: [
          Text(
            switch (r) {
              PhoneIdentityStartRejection.notSupported =>
                l10n.phoneIdNotSupported,
              PhoneIdentityStartRejection.tooMany => l10n.phoneIdTooMany,
              PhoneIdentityStartRejection.notReady => l10n.phoneIdNotReady,
            },
            key: const ValueKey('phone-id-rejected'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: RiderColors.sub),
          ),
          // 서버가 아직 확인을 받지 않는다 — 확인 없이 가입을 이어 간다(받을지는 가입 때 서버가 정한다).
          if (r == PhoneIdentityStartRejection.notReady) ...[
            const SizedBox(height: 16),
            OutlinedButton(
              key: const ValueKey('phone-id-skip'),
              onPressed: () => context.pop(phoneIdentitySkipped),
              child: Text(l10n.phoneIdSkip),
            ),
          ],
        ],
      );
    }
    if (_startFailed) {
      return _Centered(
        children: [
          Text(
            l10n.phoneIdStartFailed,
            key: const ValueKey('phone-id-start-failed'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: RiderColors.sub),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            key: const ValueKey('phone-id-retry'),
            onPressed: _begin, // 같은 시작 키로 다시
            child: Text(l10n.phoneIdRetry),
          ),
        ],
      );
    }
    if (s == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final ended = _note == _Note.expired || _note == _Note.failed;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      children: [
        Text(
          l10n.phoneIdGuide,
          style: const TextStyle(
            fontSize: 16,
            height: 1.5,
            color: RiderColors.ink,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.phoneIdTarget(s.phoneMasked),
          style: const TextStyle(fontSize: 14, color: RiderColors.sub),
        ),
        const SizedBox(height: 20),
        _CopyRow(
          key: const ValueKey('phone-id-send-to'),
          label: l10n.phoneIdSendTo,
          value: s.sendTo,
          onCopy: () => _copy(s.sendTo),
        ),
        const SizedBox(height: 12),
        _CopyRow(
          key: const ValueKey('phone-id-text'),
          label: l10n.phoneIdText,
          value: s.text,
          onCopy: () => _copy(s.text),
        ),
        const SizedBox(height: 10),
        Text(
          l10n.phoneIdExpires(formatSeoulTime(s.expiresAt)),
          style: const TextStyle(fontSize: 13, color: RiderColors.hint),
        ),
        const SizedBox(height: 24),
        if (!ended) ...[
          RiderOutlineButton(
            key: const ValueKey('phone-id-open-sms'),
            label: l10n.phoneIdOpenSms,
            onPressed: _openSms,
          ),
          const SizedBox(height: 10),
          RiderButton(
            key: const ValueKey('phone-id-sent'),
            label: _confirming ? l10n.phoneIdChecking : l10n.phoneIdSent,
            onPressed: _confirming ? null : _confirm,
          ),
        ] else
          RiderButton(
            key: const ValueKey('phone-id-restart'),
            label: l10n.phoneIdRestart,
            onPressed: _restart,
          ),
        if (_note != _Note.none)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              switch (_note) {
                _Note.pending => l10n.phoneIdPending(_remaining),
                _Note.busy => l10n.phoneIdBusy,
                _Note.expired => l10n.phoneIdExpired,
                _Note.failed => l10n.phoneIdFailed,
                _Note.none => '',
              },
              key: const ValueKey('phone-id-note'),
              style: TextStyle(
                fontSize: 14,
                color: ended ? RiderColors.danger : RiderColors.sub,
              ),
            ),
          ),
      ],
    );
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisSize: MainAxisSize.min, children: children),
    ),
  );
}

class _CopyRow extends StatelessWidget {
  const _CopyRow({
    super.key,
    required this.label,
    required this.value,
    required this.onCopy,
  });

  final String label;
  final String value;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
    decoration: BoxDecoration(
      color: RiderColors.field,
      borderRadius: BorderRadius.circular(4),
    ),
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
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
            ],
          ),
        ),
        TextButton(
          onPressed: onCopy,
          child: Text(AppLocalizations.of(context).phoneIdCopy),
        ),
      ],
    ),
  );
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
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: const TextStyle(fontSize: 15, color: RiderColors.sub),
            ),
          ),
          Expanded(
            child: Text(
              value,
              key: key,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: RiderColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
    return ListView(
      key: const ValueKey('existing-account'),
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 16),
      children: [
        Text(
          l10n.existingTitle,
          style: const TextStyle(fontSize: 24, color: RiderColors.ink),
        ),
        const SizedBox(height: 12),
        Text(
          l10n.existingBody,
          style: const TextStyle(
            fontSize: 15,
            height: 1.5,
            color: RiderColors.sub,
          ),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: RiderColors.field,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Column(
            children: [
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
                row(
                  l10n.existingEmail,
                  email,
                  const ValueKey('existing-email'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 28),
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
            onPressed: () => ref.read(sessionProvider.notifier).logout(),
          ),
        const SizedBox(height: 8),
        TextButton(
          key: const ValueKey('existing-other-phone'),
          onPressed: onOtherPhone,
          child: Text(l10n.existingOtherPhone),
        ),
      ],
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.rejoinTitle,
            style: const TextStyle(fontSize: 24, color: RiderColors.ink),
          ),
          const SizedBox(height: 12),
          Text(
            l10n.rejoinBody(seoulDate(availableAt)),
            key: const ValueKey('rejoin-blocked'),
            style: const TextStyle(fontSize: 16, color: RiderColors.sub),
          ),
          const Spacer(),
          RiderButton(
            key: const ValueKey('rejoin-ok'),
            label: l10n.rejoinOk,
            onPressed: onOk,
          ),
        ],
      ),
    );
  }
}
