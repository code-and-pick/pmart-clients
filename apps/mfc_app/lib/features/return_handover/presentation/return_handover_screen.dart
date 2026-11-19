import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/pda_theme.dart';
import '../../../shared/ui_state_of.dart';
import '../domain/return_handover.dart';
import 'return_handover_controller.dart';

String returnPurposeText(AppLocalizations l10n, ReturnPurpose p) => switch (p) {
  ReturnPurpose.claimReturn => l10n.rhPurposeClaim,
  ReturnPurpose.misdeliveryRecovery => l10n.rhPurposeMisdelivery,
  ReturnPurpose.failedDeliveryReturn => l10n.rhPurposeFailed,
  ReturnPurpose.other => l10n.rhPurposeOther,
};

String? reissueMessage(AppLocalizations l10n, ReissueFlow f) =>
    switch (f.phase) {
      ReissuePhase.idle => null,
      ReissuePhase.sending => l10n.rhReissueSending,
      ReissuePhase.done => l10n.rhReissueDone,
      ReissuePhase.unknown => l10n.rhReissueUnknown,
      ReissuePhase.rejected => switch (f.rejectCode) {
        'IDEMPOTENCY_CONFLICT' => l10n.checkClientError,
        final c => l10n.rhReissueRejected(c ?? '-'),
      },
    };

/// 반납 인증번호(delivery-execution 0.28.0 `GET /return-handovers`).
/// 라이더가 회수품을 MFC 에 가져오면 이 번호를 불러 주거나 보여 준다. 라이더가 라이더 앱에 넣으면 반납이 끝난다.
/// 번호는 화면에만 — 로그·분석에 남기지 않는다.
class ReturnHandoversScreen extends ConsumerWidget {
  const ReturnHandoversScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    Widget list(List<Widget> children) => RefreshIndicator(
      onRefresh: () => ref.refresh(returnHandoversProvider.future),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            l10n.rhIntro,
            style: Theme.of(context).textTheme.bodyMedium
                ?.copyWith(color: PdaColors.muted),
          ),
          const SizedBox(height: 4),
          ...children,
        ],
      ),
    );
    return Scaffold(
      appBar: AppBar(title: Text(l10n.rhTitle)),
      body: UiStateView<List<ReturnHandoverView>>(
        state: uiStateOf(
          ref.watch(returnHandoversProvider),
          isEmpty: (l) => l.isEmpty,
        ),
        onRetry: () => ref.invalidate(returnHandoversProvider),
        empty: (_) => list([
          Padding(
            padding: const EdgeInsets.all(32),
            child: Center(
              key: const ValueKey('rh-empty'),
              child: Text(l10n.rhEmpty),
            ),
          ),
        ]),
        ready: (context, items) =>
            list([for (final h in items) _ReturnCard(item: h)]),
      ),
    );
  }
}

class _ReturnCard extends ConsumerWidget {
  const _ReturnCard({required this.item});

  final ReturnHandoverView item;

  Future<bool> _confirm(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.rhReissueConfirmTitle),
        content: Text(l10n.rhReissueConfirmBody),
        actions: [
          TextButton(
            key: const ValueKey('confirm-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.confirmCancel),
          ),
          FilledButton(
            key: const ValueKey('confirm-ok'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.confirmOk),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _send(WidgetRef ref) async {
    final provider = reissueFlowProvider(item.deliveryId);
    // 응답을 기다리는 동안 컨트롤러가 사라지지 않게 붙들어 둔다.
    final sub = ref.listenManual(provider, (_, _) {});
    try {
      await ref.read(provider.notifier).submit();
    } finally {
      sub.close();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final id = item.deliveryId;
    final flow = ref.watch(reissueFlowProvider(id));
    final message = reissueMessage(l10n, flow);
    final busy = flow.phase == ReissuePhase.sending;
    final unknown = flow.phase == ReissuePhase.unknown;
    final bad = flow.phase == ReissuePhase.rejected || unknown;
    return Card(
      key: ValueKey('rh-item-$id'),
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              returnPurposeText(l10n, item.purpose),
              style: theme.textTheme.titleMedium?.copyWith(
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              l10n.rhDelivery(item.deliveryNumber ?? id),
              style: const TextStyle(color: PdaColors.muted),
            ),
            Text(
              l10n.rhRider(item.riderId ?? '-'),
              style: const TextStyle(color: PdaColors.muted),
            ),
            const SizedBox(height: 10),
            if (item.locked)
              Text(
                l10n.rhLocked,
                key: ValueKey('rh-locked-$id'),
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge?.copyWith(
                  color: theme.colorScheme.error,
                ),
              )
            else
              // 번호는 옅은 보라 칸 안에 크게(보라) — 라이더에게 보여 주는 자리.
              Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: PdaColors.softer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  item.code,
                  key: ValueKey('rh-code-$id'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.displayLarge?.copyWith(
                    color: PdaColors.primary,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 12,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            const SizedBox(height: 4),
            Text(
              l10n.rhIssuedAt(formatSeoulTime(item.issuedAt)),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall,
            ),
            if (item.failedAttempts > 0)
              Text(
                l10n.rhFailedAttempts(item.failedAttempts),
                key: ValueKey('rh-failed-$id'),
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (message != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  message,
                  key: ValueKey('rh-message-$id'),
                  style: bad ? TextStyle(color: theme.colorScheme.error) : null,
                ),
              ),
            const SizedBox(height: 8),
            if (unknown)
              // 결과를 모를 때는 같은 키로만 다시 보낸다(새 키면 번호가 한 번 더 바뀐다).
              CommandButton(
                key: ValueKey('rh-again-$id'),
                label: l10n.rhReissueAgain,
                busy: busy,
                onPressed: () => _send(ref),
              )
            else
              OutlinedButton(
                key: ValueKey('rh-reissue-$id'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                onPressed: busy
                    ? null
                    : () async {
                        if (await _confirm(context)) await _send(ref);
                      },
                child: Text(
                  item.locked ? l10n.rhReissueUnlock : l10n.rhReissue,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
