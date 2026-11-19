import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../work/domain/work.dart';
import '../../work/presentation/work_screens.dart' show backToSession;
import '../../../shared/printer/label.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/pda_theme.dart';
import '../../../shared/product_hints.dart';
import '../../../shared/printer/printer_ui.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../tasks/domain/task_list.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../domain/packing.dart';
import 'packing_controller.dart';

String zoneText(AppLocalizations l10n, TemperatureZone z) => switch (z) {
  TemperatureZone.chilled => l10n.zoneChilled,
  TemperatureZone.frozen => l10n.zoneFrozen,
  TemperatureZone.ambient => l10n.zoneAmbient,
};

String storageZoneText(AppLocalizations l10n, StorageZone z) =>
    zoneText(l10n, TemperatureZone.values.byName(z.name));

String packScanText(AppLocalizations l10n, PackScan r) => switch (r) {
  PackScan.matched => '',
  PackScan.wrongItem => l10n.packWrongItem,
  PackScan.overExpected => l10n.packOver,
  PackScan.otherZone => l10n.packOtherZone,
};

String packageStateText(AppLocalizations l10n, PackageState s) => switch (s) {
  PackageState.open => l10n.pkgOpen,
  PackageState.sealed => l10n.pkgSealed,
  PackageState.handedOver => l10n.pkgHandedOver,
  PackageState.invalidated => l10n.pkgInvalidated,
  PackageState.voided => l10n.pkgVoided,
  PackageState.unknown => l10n.tsUnknown,
};

/// 패킹(WK-07). 유효 포장 합계 = 확정 피킹량이어야 준비 완료다(서버 판정).
class PackingScreen extends ConsumerStatefulWidget {
  const PackingScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<PackingScreen> createState() => _PackingScreenState();
}

class _PackingScreenState extends ConsumerState<PackingScreen> {
  Future<void> _repack(ShipmentView s, PackageView p) async {
    final l10n = AppLocalizations.of(context);
    final reason = await showDialog<RepackReason>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(l10n.repackTitle),
        children: [
          for (final r in RepackReason.values)
            SimpleDialogOption(
              key: ValueKey('repack-${r.name}'),
              onPressed: () => Navigator.of(context).pop(r),
              child: Text(switch (r) {
                RepackReason.damagedBag => l10n.repackDamaged,
                RepackReason.contentChange => l10n.repackContent,
                RepackReason.labelUnreadable => l10n.repackLabel,
                RepackReason.shortageAdjust => l10n.repackShortage,
              }),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    final outcome = await ref
        .read(packingProvider(widget.taskId).notifier)
        .repack(s.shipmentId, p, reason);
    if (!mounted) return;
    if (outcome is PackRejected) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.repackRejected)));
    }
  }

  /// 봉투 나누기: 새 봉투로 옮길 수량을 고른다(주문 줄마다). 하나 이상 옮기고 하나 이상 남겨야 한다.
  Future<void> _split(
    TaskDetailView task,
    ShipmentView s,
    PackageView p,
  ) async {
    final l10n = AppLocalizations.of(context);
    final qtyByLine = <String, int>{};
    for (final c in p.contents) {
      qtyByLine[c.orderLineId] = (qtyByLine[c.orderLineId] ?? 0) + c.qty;
    }
    String nameOf(String ol) {
      final l = task.lines.where((x) => x.orderLineId == ol).firstOrNull;
      return l?.productName ?? l?.sku ?? ol;
    }

    final moved = await showDialog<Map<String, int>>(
      context: context,
      builder: (context) {
        final m = <String, int>{for (final k in qtyByLine.keys) k: 0};
        return StatefulBuilder(
          builder: (context, setState) {
            final total = qtyByLine.values.fold(0, (a, b) => a + b);
            final n = m.values.fold(0, (a, b) => a + b);
            final ok = n >= 1 && n <= total - 1;
            return AlertDialog(
              key: const ValueKey('split-dialog'),
              title: Text(l10n.splitTitle),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l10n.splitHelp),
                  for (final e in qtyByLine.entries)
                    Row(
                      children: [
                        Expanded(child: Text(nameOf(e.key))),
                        IconButton(
                          key: ValueKey('split-less-${e.key}'),
                          icon: const Icon(Icons.remove),
                          onPressed: m[e.key]! > 0
                              ? () => setState(() => m[e.key] = m[e.key]! - 1)
                              : null,
                        ),
                        Text(
                          l10n.splitLineQty(m[e.key]!, e.value),
                          key: ValueKey('split-qty-${e.key}'),
                        ),
                        IconButton(
                          key: ValueKey('split-more-${e.key}'),
                          icon: const Icon(Icons.add),
                          onPressed: m[e.key]! < e.value
                              ? () => setState(() => m[e.key] = m[e.key]! + 1)
                              : null,
                        ),
                      ],
                    ),
                  if (!ok)
                    Text(
                      l10n.splitInvalid,
                      key: const ValueKey('split-invalid'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(l10n.cancel),
                ),
                FilledButton(
                  key: const ValueKey('split-confirm'),
                  onPressed: ok
                      ? () => Navigator.of(context).pop({...m})
                      : null,
                  child: Text(l10n.splitConfirm),
                ),
              ],
            );
          },
        );
      },
    );
    if (moved == null || !mounted) return;
    final outcome = await ref
        .read(packingProvider(widget.taskId).notifier)
        .split(s.shipmentId, p, moved);
    if (!mounted) return;
    switch (outcome) {
      case RegroupDone(:final packages):
        // 새 봉투마다 새 라벨(새 QR) — 옛 라벨은 떼어 낸다.
        final fresh = await ref.read(shipmentProvider(s.shipmentId).future);
        for (final np in packages) {
          if (!mounted) return;
          if (np.qrCode != null) {
            await printPackageLabel(context, ref, PackageLabel.of(fresh, np));
          }
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(l10n.splitDone(packages.length))),
          );
        }
      case RegroupRejected(:final code):
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              code == PackProblemCode.contentMismatch
                  ? l10n.splitMismatch
                  : l10n.splitRejected,
            ),
          ),
        );
      case RegroupUnknown():
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l10n.splitUnknown)));
    }
  }

  Widget _scanError(AppLocalizations l10n, ThemeData theme, PackingState p) =>
      SizedBox(
        height: 20,
        child: switch (p.stepError) {
          final e? => Text(
            switch (e) {
              PackStepError.notStation => l10n.packNotStation,
              PackStepError.notCart => l10n.pickNotCart,
              PackStepError.otherCart => l10n.packOtherCart,
              PackStepError.notRack => l10n.packNotRack,
              PackStepError.notFinished => l10n.packNotFinished,
              PackStepError.finishCheckFailed => l10n.packFinishCheckFailed,
            },
            key: const ValueKey('pack-step-error'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
          null => null,
        },
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final taskValue = ref.watch(taskDetailProvider(widget.taskId));
    final packing = ref.watch(packingProvider(widget.taskId));
    final ctl = ref.read(packingProvider(widget.taskId).notifier);
    // 밀봉되면 라벨을 바로 출력한다(같은 포장 ID·QR). 다시 출력은 포장 목록의 버튼.
    ref.listen(packingProvider(widget.taskId).select((s) => s.lastSealed), (
      prev,
      next,
    ) async {
      final id = taskValue.value?.shipmentId;
      if (next == null || next.packageId == prev?.packageId || id == null) {
        return;
      }
      final s = await ref.read(shipmentProvider(id).future);
      if (!mounted || next.qrCode == null) return;
      await printPackageLabel(this.context, ref, PackageLabel.of(s, next));
    });
    return Scaffold(
      appBar: AppBar(title: Text(l10n.packingTitle)),
      body: UiStateView<TaskDetailView>(
        state: uiStateOf(taskValue),
        onRetry: () => ref.invalidate(taskDetailProvider(widget.taskId)),
        ready: (context, task) {
          final shipmentId = task.shipmentId;
          if (shipmentId == null) return Center(child: Text(l10n.noShipment));
          final shipmentValue = ref.watch(shipmentProvider(shipmentId));
          return UiStateView<ShipmentView>(
            state: uiStateOf(shipmentValue),
            onRetry: () => ref.invalidate(shipmentProvider(shipmentId)),
            ready: (context, s) {
              if (packing.packingFinished) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: ResultView(
                    key: const ValueKey('packing-finished'),
                    icon: Icons.check_circle,
                    text: l10n.packingFinishedAt(packing.rack ?? '-'),
                    action: l10n.nextTask,
                    onAction: () async =>
                        backToSession(context, WorkArea.pickPack),
                  ),
                );
              }
              final ready = s.state == ShipmentState.ready;
              final expectedCart = ref.watch(orderCartProvider)[shipmentId];
              // 지금 단계: 패킹대 → 장바구니 → 배차 요청 → 담기 → 출하대기 랙.
              final step = packing.station == null
                  ? 0
                  : packing.cart == null
                  ? 1
                  : s.dispatchRequest == null
                  ? 2
                  : !ready
                  ? 3
                  : 4;
              // 시안 pda-preview.html: 위 = 단계·주문·큰 제목·카드, 아래 고정 칸(actions) = 스캔·주 버튼.
              final actions = <Widget>[];
              final children = <Widget>[
                StepHeader(
                  names: [
                    l10n.packStepStation,
                    l10n.packStepCart,
                    l10n.packStepDispatch,
                    l10n.packStepBag,
                    l10n.packStepRack,
                  ],
                  current: step,
                ),
                // 어느 주문인지 — 장바구니·패킹대 확인 전에도 보인다.
                Text(
                  l10n.packOrderLine(
                    s.orderId ?? shipmentId,
                    task.lines.length,
                    task.totalPlanned,
                  ),
                  key: const ValueKey('pack-order'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: PdaColors.muted,
                  ),
                ),
                if (s.dispatchRequest case final d? when step >= 3)
                  Text(
                    l10n.packDispatchDone(formatSeoulTime(d.estimatedReadyAt)),
                    key: const ValueKey('dispatch-requested'),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: PdaColors.muted,
                    ),
                  ),
                const SizedBox(height: 14),
              ];
              switch (step) {
                case 0:
                  children.addAll([
                    ScanPrompt(
                      key: const ValueKey('target-station'),
                      text: l10n.packStationTitle,
                      detail: l10n.packScanStation,
                    ),
                    _scanError(l10n, theme, packing),
                  ]);
                  actions.add(
                    ScanInput(
                      id: 'station-scan',
                      testValues: [
                        for (final x in const ['PAK-C-01', 'PAK-C-02'])
                          TestScan(l10n.tsStation, x),
                        TestScan(l10n.tsWrong, 'C-S1-01-1-01'),
                      ],
                      label: l10n.packScanStationBtn,
                      cameraTitle: l10n.packingTitle,
                      continuous: false,
                      autofocus: false,
                      onScan: (c) => ctl.scanStation(c)
                          ? const ScanFeedback.ok()
                          : ScanFeedback.error(l10n.packNotStation),
                    ),
                  );
                case 1:
                  children.addAll([
                    ScanPrompt(
                      key: const ValueKey('target-cart'),
                      text: l10n.packCartTitle,
                      detail: l10n.packStationConfirmed(packing.station!),
                    ),
                    if (expectedCart != null)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.shopping_cart_outlined,
                                color: PdaColors.primary,
                              ),
                              const SizedBox(width: 10),
                              Text(
                                expectedCart,
                                style: theme.textTheme.titleLarge?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    _scanError(l10n, theme, packing),
                  ]);
                  actions.add(
                    ScanInput(
                      id: 'pack-cart-scan',
                      testValues: [
                        TestScan(l10n.tsCart, expectedCart ?? 'CRT-C-01'),
                        TestScan(l10n.tsOtherCart, 'CRT-C-09'),
                      ],
                      label: l10n.packScanCartBtn,
                      cameraTitle: l10n.packingTitle,
                      continuous: false,
                      autofocus: false,
                      onScan: (c) => ctl.scanCart(c, expected: expectedCart)
                          ? const ScanFeedback.ok()
                          : ScanFeedback.error(l10n.packOtherCart),
                    ),
                  );
                case 2:
                  // D-5: 포장을 시작하면 예상 포장 시간과 함께 배차를 요청한다(직원 요청만).
                  children.addAll([
                    ScanPrompt(
                      text: l10n.packMinutesTitle,
                      detail: l10n.packDispatchFirst,
                    ),
                    DispatchSection(taskId: widget.taskId, shipment: s),
                  ]);
                case 3:
                  final sealedCount = s.packages
                      .where(
                        (p) =>
                            p.state == PackageState.sealed ||
                            p.state == PackageState.handedOver,
                      )
                      .length;
                  final inBag = packing.bag.values.fold(0, (a, b) => a + b);
                  final leftAfter = ctl.leftAfterBag(task, s);
                  children.addAll([
                    Text(
                      l10n.packBagNo(sealedCount + 1),
                      key: const ValueKey('bag-no'),
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: -1.2,
                      ),
                    ),
                    Text(
                      switch (ctl.bagZone(task)) {
                        final z? => l10n.bagZone(storageZoneText(l10n, z)),
                        null when ctl.zonesKnown(task) => l10n.bagZoneEmpty,
                        null => l10n.zoneUnknownPick,
                      },
                      key: const ValueKey('bag-zone'),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: PdaColors.muted,
                      ),
                    ),
                    Text(
                      l10n.packSplitProgress(leftAfter + inBag, inBag),
                      key: const ValueKey('pack-split-progress'),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: PdaColors.muted,
                      ),
                    ),
                    if (sealedCount > 0 && inBag == 0 && !packing.sealUnknown)
                      NoticeBox(
                        textKey: const ValueKey('pack-next-bag'),
                        text: l10n.packNextBag(sealedCount, leftAfter),
                      )
                    else if (sealedCount == 0 && inBag == 0)
                      NoticeBox(
                        textKey: const ValueKey('pack-split-hint'),
                        text: l10n.packSplitHint,
                      ),
                    if (!ctl.zonesKnown(task))
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: SegmentedButton<TemperatureZone>(
                          key: const ValueKey('zone-select'),
                          segments: [
                            for (final z in TemperatureZone.values)
                              ButtonSegment(
                                value: z,
                                label: Text(zoneText(l10n, z)),
                              ),
                          ],
                          selected: {packing.zone},
                          onSelectionChanged: (v) => ctl.setZone(v.first),
                        ),
                      ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: Column(
                          children: [
                            for (final (i, l) in [
                              for (final l in task.lines)
                                if (ctl.room(l, s) > 0 ||
                                    packing.inBag(l.orderLineId) > 0)
                                  l,
                            ].indexed) ...[
                              if (i > 0) const Divider(),
                              Padding(
                                key: ValueKey('pack-line-${l.orderLineId}'),
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(l.productName ?? l.sku),
                                          if (ctl.zoneOf(l) case final z?)
                                            Text(
                                              storageZoneText(l10n, z),
                                              style: theme.textTheme.bodySmall
                                                  ?.copyWith(
                                                    color: PdaColors.muted,
                                                  ),
                                            ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      l10n.packLineLeft(
                                        packing.inBag(l.orderLineId),
                                        ctl.room(l, s) +
                                            packing.inBag(l.orderLineId),
                                      ),
                                      style: theme.textTheme.titleMedium
                                          ?.copyWith(
                                            fontWeight: FontWeight.w800,
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    if (packing.lastScan != null &&
                        packing.lastScan != PackScan.matched)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          packScanText(l10n, packing.lastScan!),
                          key: const ValueKey('pack-scan-error'),
                          style: TextStyle(
                            color: theme.colorScheme.error,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    if (packing.sealUnknown)
                      Text(
                        l10n.sealUnknown,
                        key: const ValueKey('seal-unknown'),
                      ),
                    if (packing.rejectCode case final c?)
                      Text(
                        c == PackProblemCode.contentMismatch
                            ? l10n.sealMismatch
                            : l10n.sealRejected,
                        key: const ValueKey('seal-rejected'),
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                  ]);
                  actions.addAll([
                    ScanInput(
                      id: 'pack-scan',
                      reprint: [
                        for (final l in task.lines)
                          ReprintTarget(
                            sku: l.sku,
                            name: l.productName,
                            barcode: l.barcode,
                          ),
                      ],
                      testValues: [
                        for (final l in task.lines)
                          if (l.barcode case final bc?)
                            TestScan(l.productName ?? l.sku, bc),
                        TestScan(l10n.tsWrong, '0000000000000'),
                      ],
                      label: l10n.pickScanItem,
                      cameraTitle: l10n.packCameraTitle,
                      // 피킹처럼 한 번에 하나 — 맞게 인식하면 카메라를 내린다(사용자 2026-11-19). 한 번 스캔 = 1개.
                      continuous: false,
                      onScan: (code) => switch (ctl.scan(task, s, code)) {
                        PackScan.matched => const ScanFeedback.ok(),
                        final r => ScanFeedback.error(packScanText(l10n, r)),
                      },
                    ),
                    CommandButton(
                      key: const ValueKey('seal'),
                      busy: packing.busy,
                      label: packing.sealUnknown
                          ? l10n.checkAgain
                          : inBag > 0 && leftAfter > 0
                          ? l10n.sealPartial
                          : l10n.seal,
                      onPressed: (packing.bag.isNotEmpty || packing.sealUnknown)
                          ? () => ctl.seal(task, s)
                          : null,
                    ),
                  ]);
                default:
                  // 5. 라벨 붙인 봉투를 출하대기 랙에 올리고 랙을 찍는다(업무 문서 §7-6 13단계).
                  children.addAll([
                    ScanPrompt(
                      key: const ValueKey('target-rack'),
                      text: packing.rack == null
                          ? l10n.packRackTitle
                          : l10n.packRackDoneTitle,
                      detail: l10n.packToRack(
                        s.packages
                            .where((p) => p.state == PackageState.sealed)
                            .length,
                      ),
                    ),
                    Text(
                      l10n.shipmentReady,
                      key: const ValueKey('shipment-state'),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: PdaColors.muted,
                      ),
                    ),
                    if (packing.rack case final rack?)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: TargetLine(
                            label: l10n.packStepRack,
                            code: rack,
                            confirmed: true,
                          ),
                        ),
                      ),
                    _scanError(l10n, theme, packing),
                  ]);
                  actions.addAll([
                    if (packing.rack == null)
                      ScanInput(
                        id: 'rack-scan',
                        testValues: [
                          TestScan(l10n.tsRack, 'DSP-A-01'),
                          TestScan(l10n.tsWrong, 'PAK-C-01'),
                        ],
                        label: l10n.packScanRackBtn,
                        cameraTitle: l10n.packingTitle,
                        continuous: false,
                        autofocus: false,
                        onScan: (c) => ctl.scanRack(c)
                            ? const ScanFeedback.ok()
                            : ScanFeedback.error(l10n.packNotRack),
                      ),
                    FilledButton(
                      key: const ValueKey('finish-packing'),
                      onPressed: packing.rack == null || packing.busy
                          ? null
                          : () => ctl.finish(task, s),
                      child: Text(l10n.finishPacking),
                    ),
                  ]);
              }
              // 밀봉한 포장(라벨 다시 출력·재포장).
              if (s.packages.isNotEmpty && step >= 3) {
                children.addAll([
                  const Divider(height: 24),
                  Text(l10n.packagesTitle, style: theme.textTheme.titleSmall),
                  // 봉투마다 카드 한 장: 위에 상태·온도대·QR, 아래에 버튼(항상 왼쪽부터 같은 자리).
                  for (final p in s.packages)
                    Card(
                      key: ValueKey('package-${p.packageId}'),
                      margin: const EdgeInsets.only(top: 8),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap:
                            p.state == PackageState.sealed ||
                                p.state == PackageState.handedOver
                            ? () => context.push(
                                '/packages/${p.packageId}/handover',
                              )
                            : null,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 10, 4, 4),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(
                                    Icons.inventory_2_outlined,
                                    size: 20,
                                    color: theme.colorScheme.primary,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      [
                                        packageStateText(l10n, p.state),
                                        if (p.temperatureZone case final z?)
                                          zoneText(
                                            l10n,
                                            TemperatureZone.values.byName(
                                              z.toLowerCase(),
                                            ),
                                          ),
                                      ].join(' · '),
                                      style: theme.textTheme.titleSmall,
                                    ),
                                  ),
                                  Text(
                                    p.qrCode ?? '-',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                ],
                              ),
                              Wrap(
                                spacing: 4,
                                children: [
                                  if (p.state == PackageState.sealed &&
                                      p.qrCode != null)
                                    TextButton(
                                      key: ValueKey('print-${p.packageId}'),
                                      onPressed: () => printPackageLabel(
                                        context,
                                        ref,
                                        PackageLabel.of(s, p),
                                      ),
                                      child: Text(l10n.printLabel),
                                    ),
                                  if (p.canRepack &&
                                      p.contents.fold(0, (n, c) => n + c.qty) >=
                                          2)
                                    TextButton(
                                      key: ValueKey('split-${p.packageId}'),
                                      onPressed: () => _split(task, s, p),
                                      child: Text(l10n.splitPackage),
                                    ),
                                  if (p.canRepack)
                                    TextButton(
                                      key: ValueKey('repack-${p.packageId}'),
                                      onPressed: () => _repack(s, p),
                                      child: Text(l10n.repack),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ]);
              }
              return Column(
                children: [
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: children,
                    ),
                  ),
                  ActionBar(children: actions),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

/// 예상 포장 시간 선택지(분). 계약 범위 1~180.
const packMinuteChoices = [5, 10, 15, 20, 30];

/// 배차 요청 — 직원 요청만 쓴다(자동 요청 없음, 2026-11-10). 서버에 요청이 있으면 그것만 보이고,
/// 없으면 예상 포장 시간을 받아 요청한다. 서버가 자동 요청(AUTO_ON_READY)을 보내면 숨기지 않고 알린다.
class DispatchSection extends ConsumerStatefulWidget {
  const DispatchSection({
    super.key,
    required this.taskId,
    required this.shipment,
  });

  final String taskId;
  final ShipmentView shipment;

  @override
  ConsumerState<DispatchSection> createState() => _DispatchSectionState();
}

class _DispatchSectionState extends ConsumerState<DispatchSection> {
  int? _minutes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final packing = ref.watch(packingProvider(widget.taskId));
    final ctl = ref.read(packingProvider(widget.taskId).notifier);
    final shipmentId = widget.shipment.shipmentId;

    if (widget.shipment.dispatchRequest case final d?) {
      return Card(
        key: const ValueKey('dispatch-requested'),
        color: d.trigger == DispatchTrigger.manual
            ? null
            : theme.colorScheme.errorContainer,
        child: ListTile(
          leading: const Icon(Icons.delivery_dining),
          title: Text(
            d.trigger == DispatchTrigger.manual
                ? l10n.dispatchRequested
                : l10n.dispatchRequestedAuto,
          ),
          subtitle: Text(
            l10n.dispatchReadyAt(formatSeoulTime(d.estimatedReadyAt)),
          ),
        ),
      );
    }

    final minutes = _minutes;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 자동 요청이 없어 직원이 잊으면 배차가 시작되지 않는다.
          if (widget.shipment.state == ShipmentState.ready &&
              !packing.dispatchUnknown)
            Text(
              l10n.dispatchMissing,
              key: const ValueKey('dispatch-missing'),
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          // PDA 에서는 키보드 대신 버튼으로 고른다.
          if (!packing.dispatchUnknown) ...[
            Text(l10n.packMinutesLabel, style: theme.textTheme.labelLarge),
            Wrap(
              spacing: 8,
              children: [
                for (final m in packMinuteChoices)
                  ChoiceChip(
                    key: ValueKey('pack-min-$m'),
                    label: Text(l10n.minutesN(m)),
                    selected: _minutes == m,
                    onSelected: (_) => setState(() => _minutes = m),
                  ),
              ],
            ),
          ],
          if (packing.dispatchUnknown)
            Text(l10n.dispatchUnknown, key: const ValueKey('dispatch-unknown')),
          if (packing.dispatchRejectCode case final c?)
            Text(
              c == PackProblemCode.invalidState
                  ? l10n.dispatchInvalidState
                  : l10n.dispatchRejected,
              key: const ValueKey('dispatch-rejected'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          const SizedBox(height: 8),
          CommandButton(
            key: const ValueKey('request-dispatch'),
            busy: packing.dispatchBusy,
            label: packing.dispatchUnknown
                ? l10n.checkAgain
                : l10n.requestDispatch,
            onPressed: packing.dispatchUnknown
                ? () => ctl.recheckDispatch(shipmentId)
                : minutes != null
                ? () => ctl.requestDispatch(shipmentId, minutes)
                : null,
          ),
        ],
      ),
    );
  }
}
