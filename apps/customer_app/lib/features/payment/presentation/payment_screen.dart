import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../auth/domain/auth.dart' show MemberSession;
import '../../auth/presentation/auth_controller.dart' show sessionProvider;
import '../../checkout/presentation/checkout_controller.dart';
import '../../orders/presentation/orders_providers.dart'
    show orderDetailProvider;
import '../../checkout/presentation/order_sheet_screen.dart'
    show checkoutFailureText;
import 'pg_widget_session.dart' show pgAmountMismatchCode;
import 'toss_payment_page.dart' show TossPgLauncher;
import '../domain/payment.dart';
import 'payment_controller.dart';

String paymentPhaseText(AppLocalizations l10n, PaymentFlowState s) =>
    switch (s.phase) {
      PaymentPhase.preparing => l10n.payPreparing,
      PaymentPhase.authenticating => l10n.payAuthenticating,
      PaymentPhase.confirming => l10n.payConfirming,
      PaymentPhase.done => l10n.payDone,
      PaymentPhase.failed => switch (s.failureCode) {
        'USER_CANCELLED' => l10n.payCancelled,
        TossPgLauncher.resultMismatch => l10n.payResultMismatch,
        TossPgLauncher.configMissing => l10n.payConfigRequired,
        pgAmountMismatchCode => l10n.payAmountMismatch,
        'PG_RENDER_FAILED' => l10n.payRenderFailed,
        final String code => checkoutFailureText(l10n, code),
        null => l10n.payFailed,
      },
      PaymentPhase.recovering => l10n.payRecovering,
      PaymentPhase.refunding => l10n.payRefunding,
    };

/// SCR-PAYMENT-001. 뒤로가기·재진입·앱 재시작은 같은 결제 시도를 조회한다.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key, required this.draftId});

  final String draftId;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(paymentFlowProvider(widget.draftId).notifier).run(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = paymentFlowProvider(widget.draftId);
    final s = ref.watch(provider);
    final ctl = ref.read(provider.notifier);
    // 결제 중 세션이 끝났다가 다시 로그인되면 결제 결과부터 확인한다(결제를 다시 시작하지 않는다).
    ref.listen(sessionProvider, (prev, next) {
      if (prev is! MemberSession && next is MemberSession) ctl.checkAgain();
    });
    final working = switch (s.phase) {
      PaymentPhase.preparing ||
      PaymentPhase.authenticating ||
      PaymentPhase.confirming => !s.stillChecking,
      _ => false,
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.payTitle),
        automaticallyImplyLeading: s.phase != PaymentPhase.done,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (working) const CircularProgressIndicator(),
              if (s.phase == PaymentPhase.done)
                const Icon(Icons.check_circle_outline, size: 64),
              const SizedBox(height: 16),
              Text(
                paymentPhaseText(l10n, s),
                key: const ValueKey('pay-phase'),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (s.stillChecking) ...[
                const SizedBox(height: 8),
                Text(l10n.payStillChecking, textAlign: TextAlign.center),
              ],
              if (s.phase == PaymentPhase.confirming ||
                  s.phase == PaymentPhase.recovering ||
                  s.phase == PaymentPhase.refunding) ...[
                const SizedBox(height: 8),
                // 결과를 모르는 동안 다시 결제하지 않게 안내한다.
                Text(l10n.payDoNotRetry, textAlign: TextAlign.center),
              ],
              const SizedBox(height: 24),
              if (s.phase == PaymentPhase.done) ...[
                // 화면용 주문번호(order 0.11.0)는 주문 조회에만 있다. 읽는 동안은 비워 두고, 없거나 못 읽으면 orderId.
                switch (ref.watch(orderDetailProvider(s.orderId!))) {
                  AsyncLoading() => const SizedBox.shrink(),
                  AsyncData(:final value) => Text(
                    l10n.payOrderNumber(value.displayNumber),
                    key: const ValueKey('order-id'),
                  ),
                  _ => Text(
                    l10n.payOrderNumber(s.orderId!),
                    key: const ValueKey('order-id'),
                  ),
                },
                const SizedBox(height: 12),
                FilledButton(
                  key: const ValueKey('go-order'),
                  onPressed: () => context.go('/orders/${s.orderId}'),
                  child: Text(l10n.payGoOrder),
                ),
                TextButton(
                  onPressed: () => context.go('/'),
                  child: Text(l10n.payGoHome),
                ),
              ],
              // 이번 결제 시도는 끝났다. 주문서로 돌아가 새로 결제 진입한다(같은 결제창을 다시 열지 않는다).
              if (s.canRetryPayment)
                FilledButton(
                  key: const ValueKey('pay-retry'),
                  onPressed: () {
                    ref.read(draftControllerProvider.notifier).refresh();
                    if (context.canPop()) {
                      context.pop();
                    } else {
                      context.go('/checkout');
                    }
                  },
                  child: Text(l10n.payBackToOrderSheet),
                ),
              if (!working &&
                  !s.canRetryPayment &&
                  s.phase != PaymentPhase.done)
                OutlinedButton(
                  key: const ValueKey('pay-check-again'),
                  onPressed: ctl.checkAgain,
                  child: Text(l10n.checkoutCheckAgain),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
