import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../../shared/ui_state_of.dart';
import '../data/deductions.dart';

/// 오배송 차감(execution 0.41.0) — 정산내역 위 띠와 차감 목록·이의.
/// 금액·기한·남은 금액은 서버 값만 보인다(클라이언트 계산 없음).

String deductionStateText(AppLocalizations l10n, DeductionState s) =>
    switch (s) {
      DeductionState.pendingObjection => l10n.deductionStatePending,
      DeductionState.objected => l10n.deductionStateObjected,
      DeductionState.confirmed => l10n.deductionStateConfirmed,
      DeductionState.cancelled => l10n.deductionStateCancelled,
    };

Color _stateColor(DeductionState s) => switch (s) {
  DeductionState.pendingObjection => RiderColors.pickup,
  DeductionState.objected => RiderColors.drop,
  DeductionState.confirmed => RiderColors.danger,
  DeductionState.cancelled => RiderColors.sub,
};

String _md(String ymd) => ymd.length >= 10
    ? '${int.parse(ymd.substring(5, 7))}/${int.parse(ymd.substring(8, 10))}'
    : ymd;

/// 정산내역 맨 위 띠 — 차감이 있을 때만. 못 읽으면 "읽지 못했어요"(없는 것처럼 숨기지 않는다).
class DeductionBanner extends ConsumerWidget {
  const DeductionBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return switch (ref.watch(myDeductionsProvider)) {
      AsyncData(:final value) when value.items.isEmpty =>
        const SizedBox.shrink(),
      AsyncData(:final value) => InkWell(
        key: const ValueKey('deduction-banner'),
        onTap: () => context.push('/my/deductions'),
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: const Color(0xFF2A1A1A),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: RiderColors.danger),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.deductionBanner,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        if (value.remainingTotal case final r?)
                          l10n.deductionRemaining(formatKrw(r)),
                        if (value.pendingTotal case final p? when p > 0)
                          l10n.deductionPending(formatKrw(p)),
                      ].join(' · '),
                      key: const ValueKey('deduction-banner-totals'),
                      style: const TextStyle(
                        color: Color(0xFFFF9C98),
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const PmartLineIcon(
                PmartLineIcons.chevronRight,
                color: Colors.white70,
                size: 20,
              ),
            ],
          ),
        ),
      ),
      AsyncError() => Padding(
        key: const ValueKey('deduction-banner-failed'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: Text(
          l10n.deductionBannerFailed,
          style: const TextStyle(color: RiderColors.gold, fontSize: 14),
        ),
      ),
      _ => const SizedBox.shrink(),
    };
  }
}

/// 오배송 차감 목록 — 최신이 위(서버 순서).
class DeductionsScreen extends ConsumerWidget {
  const DeductionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(
        context,
        title: l10n.deductionTitle,
        centerTitle: true,
      ),
      body: UiStateView<DeductionList>(
        state: uiStateOf(
          ref.watch(myDeductionsProvider),
          isEmpty: (l) => l.items.isEmpty,
        ),
        empty: (_) => Center(
          child: Text(
            l10n.deductionEmpty,
            style: const TextStyle(fontSize: 15, color: RiderColors.sub),
          ),
        ),
        onRetry: () => ref.invalidate(myDeductionsProvider),
        ready: (context, list) => RefreshIndicator(
          onRefresh: () => ref.refresh(myDeductionsProvider.future),
          child: ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    _Total(
                      l10n.deductionRemainingLabel,
                      list.remainingTotal,
                      RiderColors.danger,
                    ),
                    _Total(
                      l10n.deductionPendingLabel,
                      list.pendingTotal,
                      RiderColors.pickup,
                    ),
                  ],
                ),
              ),
              for (final d in list.items) ...[
                const SizedBox(height: 10),
                _DeductionCard(d),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total(this.label, this.amount, this.color);

  final String label;
  final int? amount;
  final Color color;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: RiderColors.ink,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          // 서버가 주지 않으면 0원이 아니라 "-"
          amount == null ? '-' : formatKrw(amount!),
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: (amount ?? 0) > 0 ? color : RiderColors.ink,
          ),
        ),
      ],
    ),
  );
}

class _DeductionCard extends StatelessWidget {
  const _DeductionCard(this.d);

  final Deduction d;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    const sub = TextStyle(fontSize: 14, color: RiderColors.sub);
    return Container(
      key: ValueKey('deduction-${d.id}'),
      color: Colors.white,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                deductionStateText(l10n, d.state),
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: _stateColor(d.state),
                ),
              ),
              if (d.manual) ...[
                const SizedBox(width: 8),
                Container(
                  key: ValueKey('deduction-manual-${d.id}'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: RiderColors.line),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    l10n.deductionManual,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
              const Spacer(),
              Text(formatSeoulDate(d.createdAt), style: sub),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '−${formatKrw(d.amount)}',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: d.state == DeductionState.cancelled
                  ? RiderColors.hint
                  : RiderColors.ink,
              decoration: d.state == DeductionState.cancelled
                  ? TextDecoration.lineThrough
                  : null,
            ),
          ),
          const SizedBox(height: 4),
          Text(l10n.deductionDelivery(d.deliveryLabel), style: sub),
          if (d.reason case final r?) ...[
            const SizedBox(height: 12),
            Text(
              l10n.deductionReason,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(r, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 4),
          ],
          if (d.state == DeductionState.confirmed) ...[
            const SizedBox(height: 4),
            Text(
              l10n.deductionLeft(formatKrw(d.remaining)),
              key: ValueKey('deduction-left-${d.id}'),
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: RiderColors.danger,
              ),
            ),
          ],
          for (final a in d.applied)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                l10n.deductionApplied(_md(a.payoutDate), formatKrw(a.amount)),
                style: sub,
              ),
            ),
          if (d.objectionNote case final note?) ...[
            const SizedBox(height: 12),
            Text(
              l10n.deductionMyObjection,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(note, style: const TextStyle(fontSize: 15)),
          ],
          if (d.decisionAccepted case final accepted?) ...[
            const SizedBox(height: 12),
            Text(
              accepted
                  ? l10n.deductionDecisionAccepted
                  : l10n.deductionDecisionRejected,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: accepted ? RiderColors.drop : RiderColors.danger,
              ),
            ),
            if (d.decisionNote case final n?)
              Text(n, style: const TextStyle(fontSize: 15)),
          ],
          if (d.objectableAt(DateTime.now())) ...[
            const SizedBox(height: 12),
            Text(
              l10n.deductionDeadline(formatSeoulDateTime(d.objectionDeadline)),
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: RiderColors.pickup,
              ),
            ),
            const SizedBox(height: 10),
            RiderButton(
              key: ValueKey('deduction-object-${d.id}'),
              label: l10n.deductionObject,
              height: 48,
              onPressed: () => context.push('/my/deductions/${d.id}/objection'),
            ),
          ],
        ],
      ),
    );
  }
}

/// 차감 이의 — 한 번만, 기한 전. 결과 불명이면 같은 글은 같은 키로 다시 보낸다.
class DeductionObjectionScreen extends ConsumerStatefulWidget {
  const DeductionObjectionScreen({super.key, required this.deductionId});

  final String deductionId;

  @override
  ConsumerState<DeductionObjectionScreen> createState() =>
      _DeductionObjectionScreenState();
}

class _DeductionObjectionScreenState
    extends ConsumerState<DeductionObjectionScreen> {
  final _note = TextEditingController();
  IdempotencyKey? _key;
  String? _keyFor;
  bool _busy = false;
  bool _done = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final text = _note.text.trim();
    if (text.length < 2 || _busy) return;
    // 결과 불명 뒤 같은 글이면 같은 키, 고쳤으면 새 키
    if (_keyFor != text) _key = null;
    _keyFor = text;
    final key = _key ??= IdempotencyKey.generate();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(deductionsRepositoryProvider)
          .object(deductionId: widget.deductionId, note: text, key: key);
      ref.invalidate(myDeductionsProvider);
      if (mounted) setState(() => _done = true);
    } on ObjectionClosedFailure {
      _key = null;
      ref.invalidate(myDeductionsProvider);
      if (mounted) setState(() => _error = l10n.deductionObjectClosed);
    } on UnknownResultFailure {
      if (mounted) setState(() => _error = l10n.deductionObjectUnknown);
    } on PmartFailure {
      _key = null;
      if (mounted) setState(() => _error = l10n.deductionObjectFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.deductionObjectTitle),
        titleTextStyle: riderTitleStyle(context),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: _done
              ? Column(
                  key: const ValueKey('deduction-object-done'),
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.deductionObjectDone,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    RiderButton(
                      label: l10n.deductionTitle,
                      onPressed: () => context.pop(),
                    ),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.deductionObjectOnce,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: RiderColors.pickup,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      key: const ValueKey('deduction-object-note'),
                      controller: _note,
                      maxLength: 500,
                      minLines: 5,
                      maxLines: 8,
                      enabled: !_busy,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        hintText: l10n.deductionObjectHint,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    if (_error case final e?)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          e,
                          key: const ValueKey('deduction-object-error'),
                          style: const TextStyle(
                            color: RiderColors.danger,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    const Spacer(),
                    RiderButton(
                      key: const ValueKey('deduction-object-send'),
                      label: l10n.deductionObjectSend,
                      onPressed: _busy || _note.text.trim().length < 2
                          ? null
                          : _submit,
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
