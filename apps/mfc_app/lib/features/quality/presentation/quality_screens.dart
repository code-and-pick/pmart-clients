import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/evidence.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../work/domain/work.dart';
import '../../work/presentation/work_screens.dart' show backToSession;
import '../domain/quality.dart';
import 'quality_controllers.dart';

String inspectIssueText(AppLocalizations l10n, InspectIssue i) => switch (i) {
  InspectIssue.zeroQty => l10n.inspectZeroQty,
  InspectIssue.needExpiry => l10n.inspectNeedExpiryAll,
  InspectIssue.needManufacture => l10n.inspectNeedManufacture,
  InspectIssue.badManufacture => l10n.inspectBadManufacture,
  InspectIssue.needVerdict => l10n.inspectNeedVerdict,
  InspectIssue.needReason => l10n.inspectNeedReason,
  InspectIssue.needEvidence => l10n.inspectNeedEvidence,
  InspectIssue.needLot => l10n.inspectNeedLot,
  InspectIssue.totalMismatch => l10n.inspectTotalMismatch,
  InspectIssue.duplicate => l10n.inspectDuplicateExpiry,
  InspectIssue.needTemperature => l10n.inspectNeedTemperature,
};

String quarantineReasonText(AppLocalizations l10n, QuarantineReason r) =>
    switch (r) {
      QuarantineReason.expiry => l10n.qrExpiry,
      QuarantineReason.manufacture => l10n.qrManufacture,
      QuarantineReason.damaged => l10n.qrDamaged,
      QuarantineReason.temperature => l10n.qrTemperature,
      QuarantineReason.other => l10n.qrOther,
    };

String zoneText(AppLocalizations l10n, TempZone z) => switch (z) {
  TempZone.ambient => l10n.zoneAmbient,
  TempZone.chilled => l10n.zoneChilled,
  TempZone.frozen => l10n.zoneFrozen,
};

String disposeReasonText(AppLocalizations l10n, DisposeReason r) => switch (r) {
  DisposeReason.temperatureZone => l10n.disposeTemperatureZone,
  DisposeReason.fresh => l10n.disposeFresh,
  DisposeReason.opened => l10n.disposeOpened,
  DisposeReason.damaged => l10n.disposeDamaged,
  DisposeReason.expired => l10n.disposeExpired,
  DisposeReason.other => l10n.disposeOther,
};

Future<void> _next(BuildContext context) async =>
    backToSession(context, WorkArea.inspection);

/// 증빙 사진 버튼. 찍으면 참조가 보인다. 촬영 불가(패키지 승인 전)면 안내.
class EvidenceButton extends ConsumerWidget {
  const EvidenceButton({
    super.key,
    required this.value,
    required this.purpose,
    required this.onCaptured,
  });

  final String? value;
  final String purpose;
  final ValueChanged<String?> onCaptured;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final cam = ref.watch(evidenceCameraProvider);
    if (value case final v?) {
      return InputChip(
        avatar: const Icon(Icons.photo_camera),
        label: Text(l10n.evidenceTaken(v)),
        onDeleted: () => onCaptured(null),
      );
    }
    return OutlinedButton.icon(
      onPressed: cam.available
          ? () async => onCaptured(await cam.capture(context, purpose: purpose))
          : null,
      icon: const Icon(Icons.photo_camera_outlined),
      label: Text(cam.available ? l10n.evidenceTake : l10n.evidenceUnavailable),
    );
  }
}

/// 입고 품질검사: 위치 확인 → 상품 대조 → 기준 판정(소비기한·제조일·온도, 정상/격리·사유·사진).
class InspectScreen extends ConsumerWidget {
  const InspectScreen({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inspectFlowProvider(taskId));
    final ctl = ref.read(inspectFlowProvider(taskId).notifier);
    final t = s.task;
    final step = switch (s.phase) {
      InspectPhase.locate => 0,
      InspectPhase.product => 1,
      InspectPhase.judge => 2,
      _ => -1,
    };

    final Widget body = switch (s.phase) {
      InspectPhase.loading => const Center(child: CircularProgressIndicator()),
      InspectPhase.loadError => ResultView(
        key: const ValueKey('inspect-load-error'),
        icon: Icons.cloud_off,
        text: l10n.inspectLoadError,
        action: l10n.retry,
        onAction: ctl.load,
      ),
      InspectPhase.notFound => ResultView(
        key: const ValueKey('inspect-not-found'),
        icon: Icons.search_off,
        text: l10n.inspectNotFound,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      InspectPhase.applied => ResultView(
        key: const ValueKey('inspect-applied'),
        icon: Icons.check_circle,
        text: switch (s.result?.createdTaskIds.length ?? 0) {
          0 => l10n.inspectAppliedAllQuarantined,
          final n => l10n.inspectApplied(n),
        },
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      InspectPhase.locate => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProductHeader(task: t!),
          const SizedBox(height: 12),
          TargetLine(
            key: const ValueKey('inspect-target'),
            label: l10n.inspectGoTo,
            code: t.locationCode,
            confirmed: false,
          ),
          const SizedBox(height: 8),
          ScanInput(
            id: 'inspect-loc-scan',
            testValues: [
              TestScan(l10n.tsLocation, t.locationCode),
              TestScan(l10n.tsWrong, 'RCV-C-09'),
            ],
            label: l10n.inspectScanLocation,
            cameraTitle: l10n.inspectTitle,
            continuous: false,
            autofocus: false,
            onScan: (code) => ctl.scanLocation(code) == InspectScan.ok
                ? const ScanFeedback.ok()
                : ScanFeedback.error(l10n.moveWrongPlace),
          ),
          if (s.lastScan == InspectScan.wrong)
            Text(
              l10n.moveWrongPlace,
              key: const ValueKey('inspect-scan-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
        ],
      ),
      InspectPhase.product => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProductHeader(task: t!),
          const SizedBox(height: 12),
          if (t.barcode != null) ...[
            ScanInput(
              id: 'inspect-product-scan',
              reprint: [
                ReprintTarget(
                  sku: t.sku,
                  name: t.productName,
                  barcode: t.barcode,
                ),
              ],
              testValues: [
                TestScan(t.productName ?? t.sku, t.barcode!),
                TestScan(l10n.tsWrong, '8801115114154'),
              ],
              label: l10n.inspectScanProduct,
              cameraTitle: l10n.inspectTitle,
              continuous: false,
              autofocus: false,
              onScan: (code) => ctl.scanProduct(code) == InspectScan.ok
                  ? const ScanFeedback.ok()
                  : ScanFeedback.error(l10n.inspectWrongProduct),
            ),
            if (s.lastScan == InspectScan.wrong)
              Text(
                l10n.inspectWrongProduct,
                key: const ValueKey('inspect-scan-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
          ] else ...[
            // 계약에 바코드가 없을 때(BR-52 R18) — SKU 를 눈으로 대조한다.
            Text(l10n.inspectNoBarcode),
            const SizedBox(height: 8),
            FilledButton(
              key: const ValueKey('inspect-confirm-sku'),
              onPressed: ctl.confirmProductWithoutBarcode,
              child: Text(l10n.inspectConfirmSku(t.sku)),
            ),
          ],
        ],
      ),
      InspectPhase.judge => _JudgeStep(taskId: taskId),
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.inspectTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (step >= 0)
                StepHeader(
                  names: [
                    l10n.inspectStepLocate,
                    l10n.inspectStepProduct,
                    l10n.inspectStepJudge,
                  ],
                  current: step,
                ),
              if (step >= 0) const SizedBox(height: 8),
              Expanded(child: body),
            ],
          ),
        ),
      ),
    );
  }
}

/// 상품명·SKU·검사할 수량.
class _ProductHeader extends StatelessWidget {
  const _ProductHeader({required this.task});

  final InboundTaskView task;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              task.productName ?? task.sku,
              style: theme.textTheme.titleLarge,
            ),
            Text('${task.sku} · ${l10n.inspectFrom(task.locationCode)}'),
            Text(
              l10n.inspectTarget(task.remainingQty),
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _JudgeStep extends ConsumerWidget {
  const _JudgeStep({required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inspectFlowProvider(taskId));
    final ctl = ref.read(inspectFlowProvider(taskId).notifier);
    final t = s.task!;
    final c = s.criteria;
    final issues = ctl.issues();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: ListView(
            children: [
              // 판정 기준(상품 정보).
              Card(
                key: const ValueKey('inspect-criteria'),
                margin: EdgeInsets.zero,
                color: theme.colorScheme.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.productName ?? t.sku,
                        style: theme.textTheme.titleMedium,
                      ),
                      if (!c.known)
                        Text(
                          l10n.inspectNoCriteria,
                          key: const ValueKey('inspect-no-criteria'),
                          style: TextStyle(color: theme.colorScheme.error),
                        )
                      else
                        Text(l10n.inspectMinDays(c.minRemainingDays!)),
                      if (c.maxDaysSinceManufacture case final m?)
                        Text(l10n.inspectMaxMfgDays(m)),
                      if (c.zone case final z?)
                        Text(l10n.inspectZone(zoneText(l10n, z))),
                      Text(l10n.inspectTarget(t.remainingQty)),
                    ],
                  ),
                ),
              ),
              if (c.needsTemperature) ...[
                const SizedBox(height: 8),
                Text(
                  l10n.inspectTemperatureQ,
                  style: theme.textTheme.titleSmall,
                ),
                SegmentedButton<bool>(
                  key: const ValueKey('inspect-temperature'),
                  emptySelectionAllowed: true,
                  segments: [
                    ButtonSegment(value: true, label: Text(l10n.inspectTempOk)),
                    ButtonSegment(
                      value: false,
                      label: Text(l10n.inspectTempBad),
                    ),
                  ],
                  selected: {?s.temperatureOk},
                  onSelectionChanged: (v) {
                    if (v.isNotEmpty) ctl.setTemperature(ok: v.first);
                  },
                ),
              ],
              const SizedBox(height: 8),
              for (final (i, r) in s.rows.indexed)
                _JudgeRow(
                  key: ValueKey('inspect-row-${r.id}'),
                  taskId: taskId,
                  index: i,
                  row: r,
                ),
              TextButton.icon(
                key: const ValueKey('inspect-add-row'),
                onPressed: s.unknown ? null : ctl.addRow,
                icon: const Icon(Icons.call_split),
                label: Text(l10n.inspectAddRow),
              ),
            ],
          ),
        ),
        Text(
          l10n.inspectTotal(s.total, t.remainingQty),
          key: const ValueKey('inspect-total'),
          style: theme.textTheme.titleMedium?.copyWith(
            color: s.total == t.remainingQty ? null : theme.colorScheme.error,
          ),
        ),
        for (final i in issues.intersection({
          InspectIssue.totalMismatch,
          InspectIssue.duplicate,
          InspectIssue.needTemperature,
        }))
          Text(
            inspectIssueText(l10n, i),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (s.code case final code?)
          Text(
            l10n.inspectRejected(code),
            key: const ValueKey('inspect-rejected'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        if (s.unknown)
          Text(l10n.inspectUnknown, key: const ValueKey('inspect-unknown')),
        const SizedBox(height: 8),
        CommandButton(
          key: const ValueKey('inspect-submit'),
          busy: s.busy,
          label: s.unknown ? l10n.checkAgain : l10n.inspectSubmit,
          onPressed: s.unknown || issues.isEmpty ? ctl.submit : null,
        ),
      ],
    );
  }
}

class _JudgeRow extends ConsumerWidget {
  const _JudgeRow({
    super.key,
    required this.taskId,
    required this.index,
    required this.row,
  });

  final String taskId;
  final int index;
  final InspectRow row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(inspectFlowProvider(taskId));
    final ctl = ref.read(inspectFlowProvider(taskId).notifier);
    final c = s.criteria;
    final today = ctl.today;
    final canNormal = ctl.canBeNormal(row);
    final forced = !canNormal && row.quarantined == true && c.known;
    void set(InspectRow v) => ctl.setRow(index, v);
    final rowIssues = inspectRowIssues(row, c, today);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    key: ValueKey('qty-$index'),
                    initialValue: '${row.qty}',
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: l10n.inspectQty,
                      isDense: true,
                    ),
                    onChanged: (v) =>
                        set(row.copyWith(qty: int.tryParse(v) ?? 0)),
                  ),
                ),
                if (s.rows.length > 1 && !s.unknown)
                  IconButton(
                    key: ValueKey('remove-row-$index'),
                    onPressed: () => ctl.removeRow(index),
                    icon: const Icon(Icons.delete_outline),
                  ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: _DateField(
                    key: ValueKey('exp-$index'),
                    label: l10n.inspectExpiry,
                    value: row.expiry,
                    first: DateTime(today.year - 2),
                    last: DateTime(today.year + 5, 12, 31),
                    initial: today,
                    onPicked: (v) => set(row.copyWith(expiry: v)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _DateField(
                    key: ValueKey('mfg-$index'),
                    label: c.needsManufacture
                        ? l10n.inspectManufactureRequired
                        : l10n.inspectManufacture,
                    value: row.manufacture,
                    first: DateTime(today.year - 5),
                    last: switch (DateTime.tryParse(row.expiry)) {
                      final e? when e.isBefore(today) => e,
                      _ => today,
                    },
                    initial: today,
                    onPicked: (v) => set(row.copyWith(manufacture: v)),
                    onClear: row.manufacture.isEmpty || c.needsManufacture
                        ? null
                        : () => set(row.copyWith(manufacture: '')),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // 판정 — 기본값 없음. 기준 미달·온도 이탈이면 격리로 고정.
            SegmentedButton<bool>(
              key: ValueKey('verdict-$index'),
              emptySelectionAllowed: true,
              segments: [
                ButtonSegment(
                  value: false,
                  enabled: canNormal,
                  label: Text(l10n.qtyNormal),
                  icon: const Icon(Icons.check),
                ),
                ButtonSegment(
                  value: true,
                  label: Text(l10n.qtyQuarantined),
                  icon: const Icon(Icons.block),
                ),
              ],
              selected: {?row.quarantined},
              onSelectionChanged: (v) {
                if (v.isEmpty) return;
                final q = v.first;
                set(
                  row.copyWith(
                    quarantined: () => q,
                    reason: q ? null : () => null,
                    evidence: q ? null : () => null,
                  ),
                );
              },
            ),
            if (forced)
              Text(
                l10n.inspectForced(quarantineReasonText(l10n, row.reason!)),
                key: ValueKey('forced-$index'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (row.quarantined == true) ...[
              if (!forced)
                Wrap(
                  spacing: 6,
                  children: [
                    for (final r in [
                      QuarantineReason.damaged,
                      QuarantineReason.temperature,
                      QuarantineReason.other,
                    ])
                      ChoiceChip(
                        key: ValueKey('reason-$index-${r.name}'),
                        label: Text(quarantineReasonText(l10n, r)),
                        selected: row.reason == r,
                        onSelected: (_) => set(row.copyWith(reason: () => r)),
                      ),
                  ],
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: EvidenceButton(
                  key: ValueKey('evidence-$index'),
                  value: row.evidence,
                  purpose: 'inspect-quarantine',
                  onCaptured: (v) => set(row.copyWith(evidence: () => v)),
                ),
              ),
            ],
            if (row.quarantined == false) ...[
              if (row.lotRef.isNotEmpty)
                InputChip(
                  key: ValueKey('lot-value-$index'),
                  avatar: const Icon(Icons.qr_code_2),
                  label: Text(l10n.inspectLotScanned(row.lotRef)),
                  onDeleted: () => set(row.copyWith(lotRef: '')),
                )
              else if (row.noLot)
                InputChip(
                  key: ValueKey('lot-none-$index'),
                  avatar: const Icon(Icons.block),
                  label: Text(l10n.inspectNoLot),
                  onDeleted: () => set(row.copyWith(noLot: false)),
                )
              else ...[
                ScanInput(
                  id: 'lot-scan-$index',
                  testValues: [
                    TestScan(l10n.tsLot, 'L2611A'),
                    TestScan(l10n.tsLot, 'L2611B'),
                  ],
                  label: l10n.inspectLotScan,
                  cameraTitle: l10n.inspectLotScan,
                  continuous: false,
                  autofocus: false,
                  onScan: (code) {
                    final v = code.trim();
                    if (v.isEmpty) {
                      return ScanFeedback.error(l10n.inspectLotScan);
                    }
                    set(row.copyWith(lotRef: v, noLot: false));
                    return const ScanFeedback.ok();
                  },
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: ValueKey('lot-none-btn-$index'),
                    onPressed: () => set(row.copyWith(noLot: true)),
                    icon: const Icon(Icons.block),
                    label: Text(l10n.inspectNoLot),
                  ),
                ),
              ],
            ],
            for (final i in rowIssues.difference({InspectIssue.needVerdict}))
              Text(
                inspectIssueText(l10n, i),
                style: TextStyle(color: theme.colorScheme.error),
              ),
          ],
        ),
      ),
    );
  }
}

/// 회수품(반품·불량) 검수: 온도대·신선은 상품 정보, 작업자는 개봉·파손·기한 지남과 사진. 판정은 자동.
class ReturnInspectScreen extends ConsumerWidget {
  const ReturnInspectScreen({super.key, required this.returnReceiptId});

  final String returnReceiptId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(returnInspectFlowProvider(returnReceiptId));
    final ctl = ref.read(returnInspectFlowProvider(returnReceiptId).notifier);

    final Widget body = switch (s.phase) {
      ReturnPhase.loading => const Center(child: CircularProgressIndicator()),
      ReturnPhase.loadError => ResultView(
        key: const ValueKey('return-load-error'),
        icon: Icons.cloud_off,
        text: l10n.inspectLoadError,
        action: l10n.retry,
        onAction: ctl.load,
      ),
      ReturnPhase.alreadyInspected => ResultView(
        key: const ValueKey('return-already'),
        icon: Icons.task_alt,
        text: l10n.returnAlreadyInspected,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      ReturnPhase.applying => ResultView(
        key: const ValueKey('return-applying'),
        icon: Icons.hourglass_top,
        busy: s.busy,
        text: s.code == 'APPLY_REJECTED'
            ? l10n.returnApplyRejected
            : l10n.returnApplying,
        action: l10n.checkAgain,
        onAction: ctl.pollApply,
      ),
      ReturnPhase.applied => ResultView(
        key: const ValueKey('return-applied'),
        icon: Icons.check_circle,
        text: l10n.returnApplied,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      ReturnPhase.editing => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.returnHeader(
              s.receipt!.returnReceiptId,
              s.receipt!.claimId ?? '-',
            ),
            style: theme.textTheme.titleMedium,
          ),
          Text(l10n.returnHelp2, style: theme.textTheme.bodySmall),
          const SizedBox(height: 8),
          Expanded(
            child: ListView(
              children: [
                for (final (i, l) in s.receipt!.lines.indexed)
                  _ReturnLineCard(
                    index: i,
                    title: l.productName ?? l.sku,
                    subtitle: [
                      l.sku,
                      l10n.qtyUnit(l.qty),
                      ?l.conditionNote,
                    ].join(' · '),
                    d: s.decisions[i],
                    locked: s.unknown,
                    onChanged: (d) => ctl.decide(i, d),
                  ),
              ],
            ),
          ),
          if (s.code case final c?)
            Text(
              c == QualityProblemCode.resaleNotAllowed
                  ? l10n.returnResaleNotAllowed
                  : l10n.inspectRejected(c),
              key: const ValueKey('return-rejected'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          if (s.unknown)
            Text(l10n.inspectUnknown, key: const ValueKey('return-unknown')),
          const SizedBox(height: 8),
          CommandButton(
            key: const ValueKey('return-submit'),
            busy: s.busy,
            label: s.unknown ? l10n.checkAgain : l10n.returnSubmit,
            onPressed: s.unknown || s.complete ? ctl.submit : null,
          ),
        ],
      ),
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.returnTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: body,
        ),
      ),
    );
  }
}

class _ReturnLineCard extends StatelessWidget {
  const _ReturnLineCard({
    required this.index,
    required this.title,
    required this.subtitle,
    required this.d,
    required this.locked,
    required this.onChanged,
  });

  final int index;
  final String title;
  final String subtitle;
  final ReturnDecision d;
  final bool locked;
  final ValueChanged<ReturnDecision> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    void set(ReturnDecision v) {
      if (!locked) onChanged(v);
    }

    final dispose = d.verdict == ReturnVerdict.dispose;
    return Card(
      key: ValueKey('return-line-$index'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: theme.textTheme.titleMedium),
            Text(subtitle, style: theme.textTheme.bodySmall),
            // 상품 정보 값 — 작업자가 바꾸지 않는다.
            Text(
              d.known
                  ? l10n.returnProductInfo(
                      zoneText(l10n, d.zone!),
                      d.fresh! ? l10n.returnFresh : l10n.returnNotFresh,
                    )
                  : l10n.returnNoProductInfo,
              key: ValueKey('return-info-$index'),
              style: d.known ? null : TextStyle(color: theme.colorScheme.error),
            ),
            if (d.known) ...[
              Wrap(
                spacing: 6,
                children: [
                  FilterChip(
                    key: ValueKey('opened-$index'),
                    label: Text(l10n.returnOpened),
                    selected: d.opened,
                    onSelected: (v) => set(d.copyWith(opened: v)),
                  ),
                  FilterChip(
                    key: ValueKey('damaged-$index'),
                    label: Text(l10n.returnDamaged),
                    selected: d.damaged,
                    onSelected: (v) => set(d.copyWith(damaged: v)),
                  ),
                  FilterChip(
                    key: ValueKey('expired-$index'),
                    label: Text(l10n.returnExpired),
                    selected: d.expired,
                    onSelected: (v) => set(d.copyWith(expired: v)),
                  ),
                ],
              ),
              Chip(
                key: ValueKey('verdict-$index'),
                avatar: Icon(dispose ? Icons.delete_outline : Icons.storefront),
                backgroundColor: dispose
                    ? theme.colorScheme.errorContainer
                    : theme.colorScheme.primaryContainer,
                label: Text(
                  dispose
                      ? l10n.returnDisposeBy(
                          disposeReasonText(l10n, d.disposeReason!),
                        )
                      : l10n.returnResale,
                ),
              ),
              if (dispose)
                EvidenceButton(
                  key: ValueKey('evidence-$index'),
                  value: d.evidence,
                  purpose: 'return-dispose',
                  onCaptured: (v) => set(d.copyWith(evidence: () => v)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 날짜 고르기(달력). 값은 yyyy-MM-dd. 손으로 적지 않아 형식 오류가 없다.
class _DateField extends StatelessWidget {
  const _DateField({
    super.key,
    required this.label,
    required this.value,
    required this.first,
    required this.last,
    required this.initial,
    required this.onPicked,
    this.onClear,
  });

  final String label;
  final String value;
  final DateTime first;
  final DateTime last;
  final DateTime initial;
  final ValueChanged<String> onPicked;
  final VoidCallback? onClear;

  static String ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  Future<void> _pick(BuildContext context) async {
    DateTime clamp(DateTime d) =>
        d.isBefore(first) ? first : (d.isAfter(last) ? last : d);
    final picked = await showDatePicker(
      context: context,
      helpText: label,
      initialDate: clamp(DateTime.tryParse(value) ?? initial),
      firstDate: first,
      lastDate: last,
    );
    if (picked != null) onPicked(ymd(picked));
  }

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: () => _pick(context),
    child: InputDecorator(
      isEmpty: value.isEmpty,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        suffixIcon: onClear != null
            ? IconButton(
                tooltip: MaterialLocalizations.of(context).deleteButtonTooltip,
                onPressed: onClear,
                icon: const Icon(Icons.clear),
              )
            : const Icon(Icons.calendar_month),
      ),
      child: Text(value),
    ),
  );
}
