import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../work/domain/work.dart';
import '../../work/presentation/work_screens.dart' show backToSession;
import '../domain/inbound.dart';
import 'inbound_controller.dart';

/// 입고(받기): 도착 등록·하차 → 상품별 수령 계수(정상/격리/미판정) → 확인·수령 등록 → 재고 반영 확인.
class InboundReceiveScreen extends ConsumerWidget {
  const InboundReceiveScreen({super.key, required this.trfId});

  final String trfId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    // 박스 목록이 있으면 도착 → 박스 → 낱개 → 확인 → 반영, 없으면 도착 → 수령 → 확인 → 반영.
    final boxes = s.usesBoxes;
    final step = switch (s.phase) {
      InboundPhase.arrival => 0,
      InboundPhase.boxCheck || InboundPhase.counting => 1,
      InboundPhase.boxInspect => 2,
      InboundPhase.review => boxes ? 3 : 2,
      InboundPhase.applying ||
      InboundPhase.applied ||
      InboundPhase.applyRejected => boxes ? 4 : 3,
      _ => -1,
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.inboundTitle(trfId))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (step >= 0) _Steps(current: step, boxes: boxes),
              const SizedBox(height: 12),
              Expanded(
                child: switch (s.phase) {
                  InboundPhase.loading => const Center(
                    child: CircularProgressIndicator(),
                  ),
                  InboundPhase.loadError => _Message(
                    text: l10n.inboundLoadError,
                    action: l10n.retry,
                    onAction: ctl.load,
                  ),
                  InboundPhase.cancelled => _Message(
                    text: l10n.inboundCancelled,
                    action: l10n.nextTask,
                    onAction: () async =>
                        backToSession(context, WorkArea.inbound),
                  ),
                  InboundPhase.arrival => _ArrivalStep(trfId: trfId),
                  InboundPhase.boxCheck => _BoxCheckStep(trfId: trfId),
                  InboundPhase.boxInspect => _BoxInspectStep(trfId: trfId),
                  InboundPhase.counting => _CountStep(trfId: trfId),
                  InboundPhase.review => _ReviewStep(trfId: trfId),
                  InboundPhase.applying => _Message(
                    key: const ValueKey('inbound-applying'),
                    text: l10n.inboundApplying,
                    busy: s.busy,
                    action: l10n.checkAgain,
                    onAction: ctl.pollApply,
                  ),
                  InboundPhase.applied => _Message(
                    key: const ValueKey('inbound-applied'),
                    icon: Icons.check_circle,
                    text: l10n.inboundApplied,
                    action: l10n.nextTask,
                    onAction: () async =>
                        backToSession(context, WorkArea.inbound),
                  ),
                  InboundPhase.applyRejected => _Message(
                    key: const ValueKey('inbound-apply-rejected'),
                    icon: Icons.error_outline,
                    text: l10n.inboundApplyRejected,
                    action: l10n.nextTask,
                    onAction: () async =>
                        backToSession(context, WorkArea.inbound),
                  ),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Steps extends StatelessWidget {
  const _Steps({required this.current, this.boxes = false});

  final int current;
  final bool boxes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final names = [
      l10n.inboundStepArrival,
      if (boxes) ...[
        l10n.inboundStepBox,
        l10n.inboundStepUnits,
      ] else
        l10n.inboundStepCount,
      l10n.inboundStepReview,
      l10n.inboundStepApply,
    ];
    return Row(
      key: ValueKey('inbound-step-$current'),
      children: [
        for (final (i, n) in names.indexed)
          Expanded(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: i <= current
                      ? scheme.primary
                      : scheme.surfaceContainerHighest,
                  foregroundColor: i <= current
                      ? scheme.onPrimary
                      : scheme.onSurfaceVariant,
                  child: Text('${i + 1}'),
                ),
                const SizedBox(height: 4),
                Text(
                  n,
                  style: TextStyle(
                    fontWeight: i == current ? FontWeight.bold : null,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    super.key,
    required this.text,
    required this.action,
    required this.onAction,
    this.icon,
    this.busy = false,
  });

  final String text;
  final String action;
  final Future<void> Function() onAction;
  final IconData? icon;
  final bool busy;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisAlignment: MainAxisAlignment.center,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (busy)
        const Center(child: CircularProgressIndicator())
      else if (icon != null)
        Icon(icon, size: 64),
      const SizedBox(height: 16),
      Text(
        text,
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 24),
      CommandButton(
        key: const ValueKey('inbound-message-action'),
        label: action,
        busy: busy,
        onPressed: onAction,
      ),
    ],
  );
}

class _ArrivalStep extends ConsumerWidget {
  const _ArrivalStep({required this.trfId});

  final String trfId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    final p = s.promise!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.trfId, style: theme.textTheme.headlineSmall),
                if (p.eta ?? p.plannedArrivalAt case final t?)
                  Text(l10n.inboundPlannedAt(formatSeoulTime(t))),
                Text(l10n.inboundLinesSummary(p.lines.length, p.expectedTotal)),
                if (p.boxes case final b?)
                  Text(
                    l10n.inboundTruck(p.rollContainers ?? 0, b),
                    key: const ValueKey('inbound-truck'),
                    style: theme.textTheme.titleMedium,
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(l10n.inboundArrivalHelp, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        ScanInput(
          id: 'trf-scan',
          testValues: [
            TestScan(l10n.tsNext, trfId),
            TestScan(l10n.tsOtherTruck, 'TRF-OTHER-999'),
          ],
          label: l10n.inboundTrfScanHint,
          cameraTitle: l10n.inboundTrfScanHint,
          continuous: false,
          autofocus: false,
          onScan: (code) {
            if (code.trim() != trfId) {
              return ScanFeedback.error(l10n.inboundTrfMismatch);
            }
            ctl.arrive();
            return const ScanFeedback.ok();
          },
        ),
        if (s.code case final c?)
          Text(
            c == 'VERSION_CONFLICT'
                ? l10n.inboundVersionConflict
                : l10n.inboundArrivalRejected,
            key: const ValueKey('inbound-arrival-rejected'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (s.unknown)
          Text(
            l10n.inboundArrivalUnknown,
            key: const ValueKey('inbound-unknown'),
          ),
        const SizedBox(height: 8),
        // 입고 예정 상품 전부(박스 수·입수·수량).
        Expanded(
          child: ListView(
            key: const ValueKey('arrival-lines'),
            children: [
              for (final l in p.lines)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(l.productName ?? l.sku),
                  subtitle: Text(
                    [
                      l.sku,
                      if (l.unitsPerBox case final per?) l10n.boxPer(per),
                    ].join(' · '),
                  ),
                  trailing: Text(
                    [
                      if (l.boxCount case final b?) l10n.boxesUnit(b),
                      l10n.qtyUnit(l.expectedQty),
                    ].join(' · '),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
            ],
          ),
        ),
        CommandButton(
          key: const ValueKey('inbound-arrive'),
          busy: s.busy,
          label: s.unknown ? l10n.checkAgain : l10n.inboundArrive,
          onPressed: ctl.arrive,
        ),
      ],
    );
  }
}

class _CountStep extends ConsumerWidget {
  const _CountStep({required this.trfId});

  final String trfId;

  Future<void> _edit(
    BuildContext context,
    String title,
    int value,
    ValueChanged<int> onSet,
  ) async {
    final v = await showDialog<int>(
      context: context,
      builder: (_) => _QtyDialog(title: title, initial: value),
    );
    if (v != null) onSet(v);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    final p = s.promise!;
    final l = s.line!;
    final c = s.countOf(l);
    final reason = c.reasonFor(l.expectedQty);
    final diff = c.total != l.expectedQty;

    Widget counter(
      String key,
      String label,
      int value,
      ReceiptCount Function(int) set,
    ) => Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.titleMedium)),
        IconButton.outlined(
          key: ValueKey('$key-minus'),
          onPressed: value > 0 ? () => ctl.setCount(l, set(value - 1)) : null,
          icon: const Icon(Icons.remove),
        ),
        InkWell(
          key: ValueKey('$key-value'),
          onTap: () =>
              _edit(context, label, value, (v) => ctl.setCount(l, set(v))),
          child: SizedBox(
            width: 64,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall,
            ),
          ),
        ),
        IconButton.filledTonal(
          key: ValueKey('$key-plus'),
          onPressed: () => ctl.setCount(l, set(value + 1)),
          icon: const Icon(Icons.add),
        ),
      ],
    );

    return Column(
      key: ValueKey('count-${l.key}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.inboundLineOf(s.index + 1, p.lines.length),
          style: theme.textTheme.labelLarge,
        ),
        Text(l.productName ?? l.sku, style: theme.textTheme.headlineSmall),
        Text([l.sku, if (l.lotId case final lot?) l10n.lot(lot)].join(' · ')),
        Text(switch ((l.boxCount, l.unitsPerBox)) {
          (final b?, final per?) => l10n.inboundExpectedBoxes(
            b,
            per,
            l.expectedQty,
          ),
          _ => l10n.inboundExpected(l.expectedQty),
        }, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        ScanInput(
          id: 'inbound-scan',
          reprint: [
            ReprintTarget(sku: l.sku, name: l.productName, barcode: l.barcode),
          ],
          testValues: [
            for (final x in p.lines)
              if (x.barcode case final bc?)
                TestScan(x.productName ?? x.sku, bc),
            TestScan(l10n.tsWrong, '0000000000000'),
          ],
          label: l10n.inboundScanHint,
          cameraTitle: l10n.inboundCameraTitle,
          autofocus: false,
          onScan: (code) => switch (ctl.scan(code)) {
            InboundScan.counted => const ScanFeedback.ok(),
            InboundScan.otherLine => ScanFeedback.error(l10n.inboundOtherLine),
            InboundScan.unknownCode => ScanFeedback.error(
              l10n.inboundUnknownCode,
            ),
          },
        ),
        if (s.lastScan case final r? when r != InboundScan.counted)
          Text(
            r == InboundScan.otherLine
                ? l10n.inboundOtherLine
                : l10n.inboundUnknownCode,
            key: const ValueKey('inbound-scan-error'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (l.unitsPerBox case final per?)
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              key: const ValueKey('box-plus'),
              onPressed: () => ctl.addBox(l),
              icon: const Icon(Icons.inventory_2_outlined),
              label: Text(l10n.inboundAddBox(per)),
            ),
          ),
        counter(
          'normal',
          l10n.qtyNormal,
          c.normal,
          (v) => c.copyWith(normal: v),
        ),
        counter(
          'quarantined',
          l10n.qtyQuarantined,
          c.quarantined,
          (v) => c.copyWith(quarantined: v),
        ),
        counter(
          'pending',
          l10n.qtyPending,
          c.pending,
          (v) => c.copyWith(pending: v),
        ),
        const Divider(),
        Text(
          l10n.inboundTotal(c.total, l.expectedQty),
          key: const ValueKey('inbound-total'),
          style: theme.textTheme.titleMedium?.copyWith(
            color: diff ? theme.colorScheme.error : null,
          ),
        ),
        if (diff && reason != null)
          Text(
            reasonText(l10n, reason),
            key: const ValueKey('inbound-diff-reason'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (c.quarantined > 0) ...[
          Text(l10n.inboundQuarantineReason),
          Wrap(
            spacing: 8,
            children: [
              for (final r in [
                DiscrepancyReason.damaged,
                DiscrepancyReason.temperature,
              ])
                ChoiceChip(
                  key: ValueKey('reason-${r.name}'),
                  label: Text(reasonText(l10n, r)),
                  selected: c.quarantineReason == r,
                  onSelected: (_) =>
                      ctl.setCount(l, c.copyWith(quarantineReason: () => r)),
                ),
            ],
          ),
        ],
        const Spacer(),
        Row(
          children: [
            if (s.index > 0) ...[
              OutlinedButton(
                key: const ValueKey('inbound-back'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(96, 56),
                ),
                onPressed: ctl.back,
                child: Text(l10n.prev),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: FilledButton(
                key: const ValueKey('inbound-next'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                onPressed: c.complete ? ctl.next : null,
                child: Text(
                  s.index + 1 < p.lines.length
                      ? l10n.nextProduct
                      : l10n.inboundToReview,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

String reasonText(AppLocalizations l10n, DiscrepancyReason r) => switch (r) {
  DiscrepancyReason.notReceived => l10n.reasonNotReceived,
  DiscrepancyReason.short => l10n.reasonShort,
  DiscrepancyReason.over => l10n.reasonOver,
  DiscrepancyReason.damaged => l10n.reasonDamaged,
  DiscrepancyReason.temperature => l10n.reasonTemperature,
};

class _ReviewStep extends ConsumerWidget {
  const _ReviewStep({required this.trfId});

  final String trfId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    final p = s.promise!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.inboundReviewTitle, style: theme.textTheme.titleLarge),
        Expanded(
          child: ListView(
            children: [
              for (final l in p.lines)
                Builder(
                  builder: (context) {
                    final c = s.countOf(l);
                    final r = c.reasonFor(l.expectedQty);
                    return ListTile(
                      key: ValueKey('review-${l.key}'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(l.productName ?? l.sku),
                      subtitle: Text(
                        [
                          l10n.inboundReviewLine(
                            l.expectedQty,
                            c.normal,
                            c.quarantined,
                            c.pending,
                          ),
                          if (r != null) reasonText(l10n, r),
                        ].join('\n'),
                      ),
                      trailing: c.total == l.expectedQty
                          ? const Icon(Icons.check)
                          : Icon(
                              Icons.warning_amber,
                              color: theme.colorScheme.error,
                            ),
                    );
                  },
                ),
            ],
          ),
        ),
        if (s.code case final c?)
          Text(
            switch (c) {
              'VERSION_CONFLICT' => l10n.inboundVersionConflict,
              'INVALID_STATE' => l10n.inboundReceiptInvalidState,
              _ => l10n.inboundReceiptRejected,
            },
            key: const ValueKey('inbound-receipt-rejected'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (s.unknown)
          Text(
            l10n.inboundReceiptUnknown,
            key: const ValueKey('inbound-unknown'),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton(
              key: const ValueKey('inbound-back'),
              style: OutlinedButton.styleFrom(minimumSize: const Size(96, 56)),
              onPressed: s.busy || s.unknown ? null : ctl.back,
              child: Text(l10n.prev),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: CommandButton(
                key: const ValueKey('inbound-submit'),
                busy: s.busy,
                label: s.unknown ? l10n.checkAgain : l10n.inboundSubmit,
                onPressed: ctl.submit,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// 수량 직접 입력. 컨트롤러는 다이얼로그가 닫힌 뒤(애니메이션 끝) 해제한다.
class _QtyDialog extends StatefulWidget {
  const _QtyDialog({required this.title, required this.initial});

  final String title;
  final int initial;

  @override
  State<_QtyDialog> createState() => _QtyDialogState();
}

class _QtyDialogState extends State<_QtyDialog> {
  late final _c = TextEditingController(text: '${widget.initial}');

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: const ValueKey('qty-input'),
        controller: _c,
        autofocus: true,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const ValueKey('qty-ok'),
          onPressed: () =>
              Navigator.of(context).pop(int.tryParse(_c.text.trim())),
          child: Text(l10n.confirmOk),
        ),
      ],
    );
  }
}

String boxScanText(AppLocalizations l10n, BoxScan r) => switch (r) {
  BoxScan.ok => '',
  BoxScan.already => l10n.boxAlready,
  BoxScan.notThisTruck => l10n.boxNotThisTruck,
};

/// 박스 검수: 이 트럭에 어떤 상품이 몇 박스 와야 하는지 → 박스 바코드로 하나씩 확인, 박스째 파손은 격리.
class _BoxCheckStep extends ConsumerWidget {
  const _BoxCheckStep({required this.trfId});

  final String trfId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    final p = s.promise!;
    final total = p.boxList.length;
    final last = s.lastBox == null ? null : s.boxById(s.lastBox!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // 한 줄에 함께 — 파손 표시로 줄이 늘어 아래 목록이 밀리지 않게.
        Text.rich(
          TextSpan(
            text: l10n.boxCheckProgress(s.arrived.length, total),
            children: [
              if (s.damaged.isNotEmpty)
                TextSpan(
                  text: '  ${l10n.boxDamagedCount(s.damaged.length)}',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
            ],
          ),
          key: const ValueKey('box-progress'),
          style: theme.textTheme.titleLarge,
        ),
        Text(l10n.boxCheckHelp, style: theme.textTheme.bodySmall),
        const SizedBox(height: 8),
        ScanInput(
          id: 'box-scan',
          testActions: [
            TestAction(
              'all',
              l10n.testScanAllBoxes(total - s.arrived.length),
              () {
                for (final b in p.boxList) {
                  if (!s.arrived.contains(b.boxId)) ctl.scanBox(b.boxId);
                }
              },
            ),
            TestAction('all-but-one', l10n.testScanAllButOne, () {
              final left = [
                for (final b in p.boxList)
                  if (!ctl.current.arrived.contains(b.boxId)) b,
              ];
              for (final b in left.take(left.length - 1)) {
                ctl.scanBox(b.boxId);
              }
            }),
          ],
          testValues: [
            for (final b
                in p.boxList.where((b) => !s.arrived.contains(b.boxId)).take(5))
              TestScan(l10n.tsNext, b.boxId),
            if (s.arrived.isNotEmpty) TestScan(l10n.tsAlready, s.arrived.first),
            TestScan(l10n.tsOtherTruck, 'BOX-99999999'),
          ],
          label: l10n.boxScanHint,
          cameraTitle: l10n.boxScanHint,
          autofocus: false,
          onScan: (code) => switch (ctl.scanBox(code)) {
            BoxScan.ok => const ScanFeedback.ok(),
            final r => ScanFeedback.error(boxScanText(l10n, r)),
          },
        ),
        // 안내 줄 자리는 늘 잡아 둔다 — 오류가 나타나도 아래 목록이 밀리지 않게.
        SizedBox(
          height: 20,
          child: switch (s.lastBoxScan) {
            final r? when r != BoxScan.ok => Text(
              boxScanText(l10n, r),
              key: const ValueKey('box-scan-error'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.colorScheme.error),
            ),
            _ => null,
          },
        ),
        // 자리를 늘 잡아 둔다 — 박스를 확인할 때 아래 목록이 밀려 잘못 누르지 않게.
        if (last != null && s.arrived.contains(last.boxId))
          Card(
            key: const ValueKey('last-box'),
            child: ListTile(
              title: Text(last.boxId),
              subtitle: Text(
                l10n.boxOf(
                  p.lines
                          .where((l) => l.key == last.lineKey)
                          .firstOrNull
                          ?.productName ??
                      last.lineKey.split('|').first,
                  last.unitsPerBox,
                ),
              ),
              trailing: FilterChip(
                key: const ValueKey('box-damaged'),
                label: Text(l10n.boxDamaged),
                selected: s.damaged.contains(last.boxId),
                onSelected: (_) => ctl.toggleDamaged(last.boxId),
              ),
            ),
          )
        else
          Card(
            child: ListTile(
              title: Text(l10n.boxLastPlaceholder),
              subtitle: const Text(' '),
            ),
          ),
        Expanded(
          child: ListView(
            children: [
              for (final l in p.lines)
                Builder(
                  builder: (context) {
                    final boxes = p.boxesOf(l);
                    final got = boxes
                        .where((b) => s.arrived.contains(b.boxId))
                        .length;
                    final bad = boxes
                        .where((b) => s.damaged.contains(b.boxId))
                        .length;
                    final done = got == boxes.length;
                    final open = s.expandedLine == l.key;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ListTile(
                          key: ValueKey('box-line-${l.key}'),
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          onTap: () => ctl.toggleLine(l.key),
                          leading: Icon(
                            done
                                ? Icons.check_circle
                                : Icons.inventory_2_outlined,
                            color: done ? theme.colorScheme.primary : null,
                          ),
                          title: Text(l.productName ?? l.sku),
                          subtitle: Text(
                            [
                              if (l.unitsPerBox case final per?)
                                l10n.boxPer(per),
                              if (bad > 0) l10n.boxDamagedCount(bad),
                            ].join(' · '),
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                l10n.boxLineProgress(got, boxes.length),
                                style: theme.textTheme.titleMedium,
                              ),
                              Icon(
                                open ? Icons.expand_less : Icons.expand_more,
                              ),
                            ],
                          ),
                        ),
                        if (open)
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            children: [
                              for (final b in boxes)
                                FilterChip(
                                  key: ValueKey('box-chip-${b.boxId}'),
                                  label: Text(b.boxId.substring(4)),
                                  selected: s.arrived.contains(b.boxId),
                                  // 보기 전용 — 확인은 스캔으로만(안드로이드).
                                  onSelected: null,
                                ),
                            ],
                          ),
                      ],
                    );
                  },
                ),
            ],
          ),
        ),
        if (s.arrived.length < total)
          Text(
            l10n.boxMissingWarn(total - s.arrived.length),
            key: const ValueKey('box-missing'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('box-check-done'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
          onPressed: s.arrived.isEmpty ? null : ctl.finishBoxCheck,
          child: Text(l10n.boxCheckDone),
        ),
      ],
    );
  }
}

/// 박스별 낱개 검수: 확인한 박스를 하나씩 열어 정상·격리·미판정을 센다(박스째 파손은 이미 격리).
class _BoxInspectStep extends ConsumerWidget {
  const _BoxInspectStep({required this.trfId});

  final String trfId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inboundFlowProvider(trfId));
    final ctl = ref.read(inboundFlowProvider(trfId).notifier);
    final p = s.promise!;
    InboundLine? lineOf(InboundBox b) =>
        p.lines.where((l) => l.key == b.lineKey).firstOrNull;
    String nameOf(InboundBox b) =>
        lineOf(b)?.productName ?? b.lineKey.split('|').first;

    if (s.selectedBox case final id?) {
      final b = s.boxById(id)!;
      final c = ctl.boxCountOf(id);
      return Column(
        key: ValueKey('box-open-$id'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(id, style: theme.textTheme.titleLarge),
          Text(l10n.boxOf(nameOf(b), b.unitsPerBox)),
          Text(l10n.boxCountHelp, style: theme.textTheme.bodySmall),
          const SizedBox(height: 8),
          // 낱개는 0부터 — 상품 바코드 1번 = 정상 +1(입고는 수량·겉보기 파손만, 품질 판정은 품질검사).
          ScanInput(
            id: 'box-item-scan',
            reprint: [
              if (lineOf(b) case final l?)
                ReprintTarget(sku: l.sku, name: nameOf(b), barcode: l.barcode),
            ],
            testValues: [
              if (lineOf(b)?.barcode case final bc?) TestScan(nameOf(b), bc),
              TestScan(l10n.tsWrong, '0000000000000'),
            ],
            testActions: [
              TestAction(
                'fill',
                l10n.testFillBox(b.unitsPerBox),
                () => ctl.setBoxCount(
                  id,
                  c.copyWith(normal: b.unitsPerBox - c.pending),
                ),
              ),
            ],
            label: l10n.boxItemScan,
            cameraTitle: l10n.boxItemScan,
            autofocus: false,
            onScan: (code) {
              if (code.trim() != lineOf(b)?.barcode) {
                return ScanFeedback.error(l10n.inboundOtherLine);
              }
              final now = ctl.boxCountOf(id);
              ctl.setBoxCount(id, now.copyWith(normal: now.normal + 1));
              return const ScanFeedback.ok();
            },
          ),
          QtyStepper(
            id: 'box-normal',
            label: l10n.qtyNormal,
            value: c.normal,
            onChanged: (v) => ctl.setBoxCount(id, c.copyWith(normal: v)),
          ),
          QtyStepper(
            id: 'box-damaged-units',
            label: l10n.boxLooksDamaged,
            value: c.pending,
            onChanged: (v) => ctl.setBoxCount(id, c.copyWith(pending: v)),
          ),
          Text(
            l10n.inboundTotal(c.total, b.unitsPerBox),
            key: const ValueKey('box-total'),
            style: theme.textTheme.titleMedium?.copyWith(
              color: c.total == b.unitsPerBox ? null : theme.colorScheme.error,
            ),
          ),
          if (c.total != b.unitsPerBox && c.total > 0)
            Text(l10n.boxCountDiff, style: theme.textTheme.bodySmall),
          const Spacer(),
          Row(
            children: [
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(96, 56),
                ),
                onPressed: ctl.closeBox,
                child: Text(l10n.prev),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: const ValueKey('box-save'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                  ),
                  onPressed: c.total > 0 ? ctl.saveBox : null,
                  child: Text(l10n.boxSave),
                ),
              ),
            ],
          ),
        ],
      );
    }

    final boxes = s.openable;
    final done = boxes.where((b) => s.boxCounts.containsKey(b.boxId)).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.boxInspectProgress(done, boxes.length),
          key: const ValueKey('box-inspect-progress'),
          style: theme.textTheme.titleLarge,
        ),
        if (s.damaged.isNotEmpty)
          Text(l10n.boxDamagedQuarantined(s.damaged.length)),
        const SizedBox(height: 8),
        ScanInput(
          id: 'box-open-scan',
          testActions: [
            TestAction('all-normal', l10n.testOpenAllNormal, () {
              for (final b in ctl.current.openable) {
                if (ctl.current.boxCounts.containsKey(b.boxId)) continue;
                ctl
                  ..openBox(b.boxId)
                  ..setBoxCount(b.boxId, ReceiptCount(normal: b.unitsPerBox))
                  ..saveBox();
              }
            }),
          ],
          testValues: [
            for (final b
                in s.openable
                    .where((b) => !s.boxCounts.containsKey(b.boxId))
                    .take(5))
              TestScan(l10n.tsNext, b.boxId),
            TestScan(l10n.tsOtherTruck, 'BOX-99999999'),
          ],
          label: l10n.boxOpenScan,
          cameraTitle: l10n.boxOpenScan,
          continuous: false,
          autofocus: false,
          onScan: (code) => ctl.openBox(code)
              ? const ScanFeedback.ok()
              : ScanFeedback.error(l10n.boxNotThisTruck),
        ),
        Expanded(
          child: ListView(
            children: [
              for (final b in boxes)
                ListTile(
                  key: ValueKey('box-${b.boxId}'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    s.boxCounts.containsKey(b.boxId)
                        ? Icons.check_circle
                        : Icons.inventory_2_outlined,
                  ),
                  title: Text('${b.boxId} · ${nameOf(b)}'),
                  trailing: Text(switch (s.boxCounts[b.boxId]) {
                    final c? => l10n.boxInspected(
                      c.normal,
                      c.quarantined + c.pending,
                    ),
                    null => l10n.boxNotInspected,
                  }),
                  onTap: () => ctl.openBox(b.boxId),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(96, 56)),
              onPressed: ctl.backToBoxCheck,
              child: Text(l10n.prev),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                key: const ValueKey('box-to-review'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                onPressed: s.allBoxesInspected ? ctl.boxesToReview : null,
                child: Text(l10n.inboundToReview),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
