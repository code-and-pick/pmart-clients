import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../checkout/presentation/checkout_controller.dart'
    show clockProvider;
import '../../payment/presentation/pg_widget_session.dart'
    show pgAmountMismatchCode;
import '../../payment/presentation/toss_payment_page.dart' show TossPgLauncher;
import '../data/redelivery_payments_repository.dart' show RedeliveryProblemCode;
import '../domain/redelivery_payment.dart';
import 'redelivery_controller.dart';

/// 주문 상세 위쪽의 다시 배송비 결제 안내(오배송 고객 잘못, ADR-0065). 결제 건이 없으면 아무것도 그리지 않는다.
/// 조회 실패는 "결제 건 없음"으로 보이지 않는다 — 실패 안내와 다시 시도.
class RedeliveryPaymentsSection extends ConsumerWidget {
  const RedeliveryPaymentsSection({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return switch (ref.watch(redeliveryPaymentsProvider(orderId))) {
      AsyncData(:final value) when value.isNotEmpty => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final p in value)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: _RedeliveryCard(payment: p),
            ),
        ],
      ),
      AsyncError() => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(
          key: const ValueKey('rdp-load-failed'),
          children: [
            Expanded(
              child: Text(
                l10n.rdpLoadFailed,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
            TextButton(
              onPressed: () =>
                  ref.invalidate(redeliveryPaymentsProvider(orderId)),
              child: Text(l10n.checkoutCheckAgain),
            ),
          ],
        ),
      ),
      _ => const SizedBox.shrink(),
    };
  }
}

class _RedeliveryCard extends ConsumerWidget {
  const _RedeliveryCard({required this.payment});

  final RedeliveryPayment payment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final p = payment;
    final waiting = p.status == RedeliveryPaymentStatus.waitingPayment;
    return Container(
      key: ValueKey('rdp-${p.id}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: waiting ? scheme.primaryContainer.withValues(alpha: 0.35) : null,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: waiting ? scheme.primary : scheme.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (waiting) ...[
            Text(l10n.rdpCardTitle, style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              l10n.rdpCardBody(formatKrw(p.amount)),
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            _DeadlineText(payment: p),
            const SizedBox(height: 10),
            FilledButton(
              key: ValueKey('rdp-open-${p.id}'),
              onPressed: () => context.push(
                '/orders/${Uri.encodeComponent(p.orderId)}/redelivery-payments/${Uri.encodeComponent(p.id)}',
              ),
              child: Text(l10n.rdpOpen),
            ),
          ] else
            Text(
              redeliverySettledText(l10n, p.status),
              key: ValueKey('rdp-status-${p.id}'),
              style: theme.textTheme.bodyMedium,
            ),
        ],
      ),
    );
  }
}

/// 남은 시간. 표시 전용 — 기한이 지났는지의 결론은 서버 상태(TIMED_OUT)다.
class _DeadlineText extends ConsumerWidget {
  const _DeadlineText({required this.payment});

  final RedeliveryPayment payment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final left = payment.deadlineAt.difference(ref.watch(clockProvider)());
    final over = left <= Duration.zero;
    return Text(
      over
          ? l10n.rdpDeadlineOver
          : l10n.rdpDeadline(
              formatSeoulTime(payment.deadlineAt),
              // 남은 분은 올림(29분 30초 → 30분) — 0분으로 보이지 않게.
              (left.inSeconds + 59) ~/ 60,
            ),
      key: const ValueKey('rdp-deadline'),
      style: theme.textTheme.labelLarge?.copyWith(
        color: over ? theme.colorScheme.error : theme.colorScheme.primary,
      ),
    );
  }
}

String redeliverySettledText(
  AppLocalizations l10n,
  RedeliveryPaymentStatus s,
) => switch (s) {
  RedeliveryPaymentStatus.paid => l10n.rdpPaid,
  RedeliveryPaymentStatus.declined => l10n.rdpDeclined,
  RedeliveryPaymentStatus.timedOut => l10n.rdpTimedOut,
  RedeliveryPaymentStatus.waitingPayment => l10n.rdpCardTitle,
};

String? _failureText(AppLocalizations l10n, String? code) => switch (code) {
  null => null,
  'USER_CANCELLED' => l10n.rdpCancelled,
  redeliveryDeadlinePassed => l10n.rdpDeadlineOver,
  TossPgLauncher.configMissing => l10n.payConfigRequired,
  TossPgLauncher.resultMismatch => l10n.payResultMismatch,
  pgAmountMismatchCode => l10n.payAmountMismatch,
  RedeliveryProblemCode.alreadyPaid => l10n.rdpAlreadyPaid,
  'DECLINE_FAILED' => l10n.rdpDeclineFailed,
  _ => l10n.rdpFailed,
};

/// 다시 배송비 결제 화면. 뒤로 가기·재진입·앱 재시작은 같은 결제 건을 조회한다(결제창을 저절로 다시 열지 않는다).
class RedeliveryPaymentScreen extends ConsumerStatefulWidget {
  const RedeliveryPaymentScreen({
    super.key,
    required this.orderId,
    required this.redeliveryPaymentId,
  });

  final String orderId;
  final String redeliveryPaymentId;

  @override
  ConsumerState<RedeliveryPaymentScreen> createState() =>
      _RedeliveryPaymentScreenState();
}

class _RedeliveryPaymentScreenState
    extends ConsumerState<RedeliveryPaymentScreen> {
  RedeliveryRef get _ref =>
      (orderId: widget.orderId, id: widget.redeliveryPaymentId);

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(redeliveryFlowProvider(_ref).notifier).load(),
    );
  }

  Future<void> _confirmDecline(RedeliveryPayment p) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.rdpDeclineConfirmTitle),
        content: Text(l10n.rdpDeclineConfirmBody(formatKrw(p.amount))),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cartRemoveConfirmCancel),
          ),
          FilledButton(
            key: const ValueKey('rdp-decline-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.rdpDeclineConfirmOk),
          ),
        ],
      ),
    );
    if (ok ?? false) {
      await ref.read(redeliveryFlowProvider(_ref).notifier).decline();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(redeliveryFlowProvider(_ref));
    final ctl = ref.read(redeliveryFlowProvider(_ref).notifier);
    final p = s.payment;
    final working = switch (s.phase) {
      RedeliveryPhase.loading => !s.loadFailed,
      RedeliveryPhase.preparing ||
      RedeliveryPhase.authenticating ||
      RedeliveryPhase.confirming ||
      RedeliveryPhase.declining => !s.stillChecking,
      _ => false,
    };
    final phaseText = switch (s.phase) {
      RedeliveryPhase.loading when s.loadFailed => l10n.rdpLoadFailed,
      RedeliveryPhase.preparing => l10n.rdpPreparing,
      RedeliveryPhase.authenticating => l10n.payAuthenticating,
      RedeliveryPhase.confirming => l10n.payConfirming,
      RedeliveryPhase.declining => l10n.rdpDeclining,
      RedeliveryPhase.missing => l10n.rdpMissing,
      RedeliveryPhase.settled when p != null => redeliverySettledText(
        l10n,
        p.status,
      ),
      _ => _failureText(l10n, s.failureCode),
    };
    final checking =
        s.stillChecking || (s.phase == RedeliveryPhase.loading && s.loadFailed);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.rdpTitle), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (p != null) ...[
            Text(l10n.rdpCardTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              l10n.rdpCardBody(formatKrw(p.amount)),
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Text(l10n.rdpTitle, style: theme.textTheme.bodyMedium),
                const Spacer(),
                Text(
                  formatKrw(p.amount),
                  key: const ValueKey('rdp-amount'),
                  style: theme.textTheme.titleMedium,
                ),
              ],
            ),
            if (p.status == RedeliveryPaymentStatus.waitingPayment) ...[
              const SizedBox(height: 6),
              _DeadlineText(payment: p),
              const SizedBox(height: 12),
              Text(
                l10n.rdpRefundNote(formatKrw(p.amount)),
                style: theme.textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 24),
          ],
          if (working) const Center(child: CircularProgressIndicator()),
          if (phaseText != null) ...[
            const SizedBox(height: 12),
            Text(
              phaseText,
              key: const ValueKey('rdp-phase'),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleSmall,
            ),
          ],
          if (s.phase == RedeliveryPhase.confirming) ...[
            const SizedBox(height: 8),
            Text(l10n.payDoNotRetry, textAlign: TextAlign.center),
          ],
          if (s.stillChecking) ...[
            const SizedBox(height: 8),
            Text(l10n.payStillChecking, textAlign: TextAlign.center),
          ],
          if (checking) ...[
            const SizedBox(height: 12),
            OutlinedButton(
              key: const ValueKey('rdp-check-again'),
              onPressed: ctl.checkAgain,
              child: Text(l10n.checkoutCheckAgain),
            ),
          ],
          if (s.canChoose && p != null) ...[
            const SizedBox(height: 20),
            FilledButton(
              key: const ValueKey('rdp-pay'),
              onPressed: ctl.pay,
              child: Text(
                s.phase == RedeliveryPhase.failed
                    ? l10n.rdpPayAgain
                    : l10n.rdpPay(formatKrw(p.amount)),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              key: const ValueKey('rdp-decline'),
              onPressed: () => _confirmDecline(p),
              child: Text(l10n.rdpDecline),
            ),
          ],
        ],
      ),
    );
  }
}
