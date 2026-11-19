import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/pda_theme.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../packing/domain/packing.dart';
import '../../packing/presentation/packing_controller.dart'
    show shipmentProvider;
import '../../packing/presentation/packing_screen.dart' show packageStateText;
import '../domain/handover.dart';
import 'handover_controller.dart';

String verdictText(AppLocalizations l10n, HandoverVerdict v) => switch (v) {
  HandoverVerdict.ready => l10n.verdictReady,
  HandoverVerdict.stopped => l10n.verdictStopped,
  HandoverVerdict.inProgress => l10n.verdictInProgress,
  HandoverVerdict.handedOver => l10n.verdictHandedOver,
  HandoverVerdict.unknown => l10n.verdictUnknown,
};

String fenceText(AppLocalizations l10n, HandoverView h) => switch (h.fence) {
  FenceState.none => l10n.fenceNone,
  FenceState.inProgress => switch (h.fenceExpiresAt) {
    final t? => l10n.fenceInProgressUntil(formatSeoulTime(t)),
    null => l10n.fenceInProgress,
  },
  FenceState.committed => l10n.fenceCommitted,
  FenceState.expired => l10n.fenceExpired,
  FenceState.unknown => l10n.fenceUnknown,
};

String inventoryText(AppLocalizations l10n, InventoryApply i) => switch (i) {
  InventoryApply.notRequested => l10n.invNotRequested,
  InventoryApply.processing => l10n.invProcessing,
  InventoryApply.applied => l10n.invApplied,
  InventoryApply.rejected => l10n.invRejected,
  InventoryApply.unknownResult => l10n.invUnknown,
};

String? lastCheckText(AppLocalizations l10n, LastCheckView? c) {
  if (c == null) return null;
  final time = c.checkedAt == null ? '-' : formatSeoulTime(c.checkedAt!);
  return switch (c.result) {
    HandoverCheck.atStation => l10n.lastCheckAtStation(time),
    HandoverCheck.takenByRider => l10n.lastCheckTaken(time),
  };
}

/// 확인 거절·불명·완료 안내. 없으면 null.
String? checkFlowMessage(AppLocalizations l10n, CheckFlow f) =>
    switch (f.phase) {
      CheckPhase.idle => null,
      CheckPhase.sending => l10n.checkSending,
      CheckPhase.unknown => l10n.checkUnknown,
      CheckPhase.done =>
        f.result?.verdict == HandoverVerdict.handedOver
            ? l10n.checkDoneTaken
            : l10n.checkDoneAtStation,
      CheckPhase.rejected => switch (f.rejectCode) {
        HandoverProblemCode.fenceActive => l10n.checkFenceActive,
        HandoverProblemCode.invalidState => l10n.checkInvalidState,
        'IDEMPOTENCY_CONFLICT' => l10n.checkClientError,
        final c => l10n.checkRejected(c ?? '-'),
      },
    };

/// 확인 버튼 두 개. "포장대에 없음"은 재고가 빠지는 확정이라 한 번 더 묻는다.
class HandoverCheckButtons extends ConsumerWidget {
  const HandoverCheckButtons({super.key, required this.item, this.riderIds});

  final HandoverView item;

  /// 같은 화면 라이더를 한 번에 묻는 키([riderKey]) — 목록이면 목록 전체 키를 넘겨 조회를 한 번으로.
  final String? riderIds;

  Future<bool> _confirm(BuildContext context, String title, String body) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
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

  /// 보내고, 완료·거절이면 알림으로도 보인다(목록이 다시 조회되면 이 항목이 사라질 수 있다).
  Future<void> _send(
    BuildContext context,
    WidgetRef ref,
    HandoverCheck value,
  ) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final provider = checkFlowProvider(item.packageId);
    // 응답을 기다리는 동안 컨트롤러가 사라지지 않게 붙들어 둔다.
    final sub = ref.listenManual(provider, (_, _) {});
    try {
      await ref.read(provider.notifier).submit(value);
      if (!context.mounted) return;
      final flow = ref.read(provider);
      if (flow.phase == CheckPhase.done || flow.phase == CheckPhase.rejected) {
        final text = checkFlowMessage(l10n, flow);
        if (text != null) {
          messenger.showSnackBar(SnackBar(content: Text(text)));
        }
      }
    } finally {
      sub.close();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final id = item.packageId;
    final flow = ref.watch(checkFlowProvider(id));
    final message = checkFlowMessage(l10n, flow);
    // 확인 창의 라이더도 표기로("김*수 · 482913") — 라이더 ID 는 글자로 내지 않는다(ADR-0070).
    final rider = riderDisplayText(
      l10n,
      ref,
      item.riderId,
      riderIds ?? riderKey([item.riderId]),
    );
    final unknown = flow.phase == CheckPhase.unknown;
    final busy = flow.phase == CheckPhase.sending;
    final clientError =
        flow.phase == CheckPhase.rejected &&
        flow.rejectCode == 'IDEMPOTENCY_CONFLICT';
    final canSend = !busy && !clientError && flow.phase != CheckPhase.done;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (message != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              message,
              key: ValueKey('check-message-$id'),
              style: flow.phase == CheckPhase.rejected || unknown
                  ? TextStyle(color: theme.colorScheme.error)
                  : null,
            ),
          ),
        if (unknown)
          // 결과를 모를 때는 보냈던 확인만 같은 키로 다시 보낸다.
          CommandButton(
            key: ValueKey('check-again-$id'),
            label: l10n.checkAgain,
            busy: busy,
            onPressed: () => _send(context, ref, flow.pending!),
          )
        else if (flow.phase != CheckPhase.done)
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: ValueKey('check-at-station-$id'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                  ),
                  onPressed: canSend
                      ? () async {
                          if (await _confirm(
                            context,
                            l10n.confirmAtStationTitle,
                            l10n.confirmAtStationBody,
                          )) {
                            if (!context.mounted) return;
                            await _send(context, ref, HandoverCheck.atStation);
                          }
                        }
                      : null,
                  child: Text(l10n.checkAtStation),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: ValueKey('check-taken-$id'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    backgroundColor: theme.colorScheme.error,
                    foregroundColor: theme.colorScheme.onError,
                  ),
                  onPressed: canSend
                      ? () async {
                          if (await _confirm(
                            context,
                            l10n.confirmTakenTitle,
                            l10n.confirmTakenBody(rider),
                          )) {
                            if (!context.mounted) return;
                            await _send(
                              context,
                              ref,
                              HandoverCheck.takenByRider,
                            );
                          }
                        }
                      : null,
                  child: Text(l10n.checkTaken),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

/// 센터 전체 점원 확인 필요 포장(`GET /packages?checkRequired=true`).
class HandoverChecksScreen extends ConsumerWidget {
  const HandoverChecksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.handoverChecksTitle)),
      // 포장 QR 스캔은 늘 아래 같은 자리(다른 현장 화면과 같다).
      bottomNavigationBar: const ActionBar(children: [_PackageQrScan()]),
      body: UiStateView<HandoverCheckList>(
        state: uiStateOf(
          ref.watch(handoverChecksProvider),
          isEmpty: (l) => l.items.isEmpty,
        ),
        onRetry: () => ref.invalidate(handoverChecksProvider),
        empty: (_) => RefreshIndicator(
          onRefresh: () => ref.refresh(handoverChecksProvider.future),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  key: const ValueKey('checks-empty'),
                  child: Text(l10n.handoverChecksEmpty),
                ),
              ),
            ],
          ),
        ),
        ready: (context, list) {
          final riderIds = riderKey(list.items.map((h) => h.riderId));
          return RefreshIndicator(
            onRefresh: () => ref.refresh(handoverChecksProvider.future),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  l10n.handoverChecksIntro,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: PdaColors.body,
                  ),
                ),
                if (!list.fresh)
                  ListTile(
                    key: const ValueKey('checks-stale'),
                    leading: const Icon(Icons.info_outline),
                    title: Text(l10n.viewStale),
                  ),
                const SizedBox(height: 8),
                for (final h in list.items)
                  Card(
                    key: ValueKey('check-item-${h.packageId}'),
                    margin: const EdgeInsets.only(top: 10),
                    child: Padding(
                      padding: const EdgeInsets.all(15),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            h.packingLocation == null
                                ? l10n.hoLocationUnknown
                                : l10n.hoLocation(h.packingLocation!),
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontSize: 19,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          DefaultTextStyle.merge(
                            style: const TextStyle(color: PdaColors.body),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // 시스템 ID 대신 화면 번호(ADR-0070) — 인계 번호·주문번호·라이더 표기.
                                Text(
                                  l10n.hoHandoverCode(
                                    h.handoverCode ?? l10n.packNoHandoverCode,
                                  ),
                                  key: ValueKey('ho-code-${h.packageId}'),
                                  style: const TextStyle(
                                    color: PdaColors.ink,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                if (h.orderNumber != null)
                                  Text(l10n.hoOrder(h.orderNumber!)),
                                RiderLabelText(
                                  riderId: h.riderId,
                                  ids: riderIds,
                                ),
                              ],
                            ),
                          ),
                          if (h.fenceExpiresAt != null)
                            NoticeBox(
                              text: l10n.hoExpiredAt(
                                formatSeoulTime(h.fenceExpiresAt!),
                              ),
                              warning: true,
                            ),
                          const SizedBox(height: 8),
                          HandoverCheckButtons(item: h, riderIds: riderIds),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              key: ValueKey('open-handover-${h.packageId}'),
                              onPressed: () => context.push(
                                '/packages/${h.packageId}/handover',
                              ),
                              child: Text(l10n.viewHandover),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// 포장 한 건의 인계 판정(`GET /packages/{id}/handover-resolution`) + 라이더 픽업 ETA.
class PackageHandoverScreen extends ConsumerWidget {
  const PackageHandoverScreen({
    super.key,
    required this.packageId,
    this.scannedVersion,
  });

  final String packageId;

  /// 포장 QR 을 찍고 들어왔으면 그 QR 의 포장 버전.
  final int? scannedVersion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final provider = handoverProvider(packageId);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.handoverTitle)),
      body: UiStateView<HandoverView>(
        state: uiStateOf(ref.watch(provider)),
        onRetry: () => ref.invalidate(provider),
        ready: (context, h) {
          final warn =
              h.inventory == InventoryApply.rejected ||
              h.inventory == InventoryApply.unknownResult;
          final last = lastCheckText(l10n, h.lastCheck);
          return RefreshIndicator(
            onRefresh: () => ref.refresh(provider.future),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  verdictText(l10n, h.verdict),
                  key: const ValueKey('verdict'),
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.2,
                  ),
                ),
                if (!h.fresh)
                  ListTile(
                    key: const ValueKey('handover-stale'),
                    leading: const Icon(Icons.info_outline),
                    title: Text(l10n.viewStale),
                  ),
                if (scannedVersion case final v?
                    when h.packageVersion != null && v != h.packageVersion)
                  Text(
                    l10n.staleLabel(v, h.packageVersion!),
                    key: const ValueKey('stale-label'),
                    style: TextStyle(
                      color: theme.colorScheme.error,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                _InfoCard(
                  children: [
                    Text(
                      h.packingLocation == null
                          ? l10n.hoLocationUnknown
                          : l10n.hoLocation(h.packingLocation!),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      l10n.hoHandoverCode(
                        h.handoverCode ?? l10n.packNoHandoverCode,
                      ),
                      style: const TextStyle(
                        color: PdaColors.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      packageStateText(l10n, h.packageState),
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: PdaColors.primary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (h.orderNumber != null)
                      Text(
                        l10n.hoOrder(h.orderNumber!),
                        style: const TextStyle(color: PdaColors.body),
                      ),
                    if (h.riderId != null)
                      RiderLabelText(
                        riderId: h.riderId,
                        ids: riderKey([h.riderId]),
                      ),
                    // 시스템 번호는 상세에만 작게(문의·대조용).
                    Text(
                      l10n.hoSystemNo(
                        h.packageId,
                        '${h.packageVersion ?? '-'}',
                      ),
                      key: const ValueKey('ho-system-no'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: PdaColors.muted,
                      ),
                    ),
                  ],
                ),
                _InfoCard(
                  children: [
                    Text(fenceText(l10n, h), key: const ValueKey('fence')),
                    Text(
                      inventoryText(l10n, h.inventory),
                      key: const ValueKey('inventory'),
                      style: warn
                          ? TextStyle(
                              color: theme.colorScheme.error,
                              fontWeight: FontWeight.bold,
                            )
                          : null,
                    ),
                    if (last != null)
                      Text(last, key: const ValueKey('last-check')),
                  ],
                ),
                if (h.checkRequired) ...[
                  const SizedBox(height: 12),
                  Chip(
                    key: const ValueKey('check-required'),
                    label: Text(l10n.checkRequiredBadge),
                  ),
                  HandoverCheckButtons(item: h),
                ],
                if (h.verdict != HandoverVerdict.handedOver &&
                    h.shipmentId != null) ...[
                  _InfoCard(
                    children: [
                      Text(
                        l10n.etaTitle,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      _PickupEta(shipmentId: h.shipmentId!),
                    ],
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

/// 흰 카드 한 장(여백 15) — 정보 묶음.
class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    ),
  );
}

class _PickupEta extends ConsumerWidget {
  const _PickupEta({required this.shipmentId});

  final String shipmentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final shipment = shipmentProvider(shipmentId);
    return UiStateView<ShipmentView>(
      state: uiStateOf(ref.watch(shipment)),
      onRetry: () => ref.invalidate(shipment),
      ready: (context, s) {
        final deliveryId = s.deliveryId;
        if (deliveryId == null) return Text(l10n.etaNoDelivery);
        final eta = pickupEtaProvider(deliveryId);
        return UiStateView<PickupEtaView>(
          state: uiStateOf(ref.watch(eta)),
          onRetry: () => ref.invalidate(eta),
          ready: (context, e) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_etaText(l10n, e), key: const ValueKey('pickup-eta')),
              if (!e.fresh) Text(l10n.viewStale),
            ],
          ),
        );
      },
    );
  }

  String _etaText(AppLocalizations l10n, PickupEtaView e) {
    if (e.stage == DeliveryStage.unassigned) return l10n.etaUnassigned;
    return switch (e.status) {
      EtaStatus.available => switch ((e.etaAt, e.remainingSeconds)) {
        (final t?, final r?) => l10n.etaAvailable(
          formatSeoulTime(t),
          (r / 60).ceil(),
        ),
        (final t?, null) => l10n.etaAvailableNoRemain(formatSeoulTime(t)),
        _ => l10n.etaPending,
      },
      EtaStatus.locating => l10n.etaLocating,
      EtaStatus.pending || EtaStatus.unknown => l10n.etaPending,
      EtaStatus.finalized => l10n.etaFinal,
    };
  }
}

/// 포장 라벨 QR 을 찍어 그 포장의 인계 상태로 간다.
class _PackageQrScan extends StatelessWidget {
  const _PackageQrScan();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ScanInput(
      id: 'package-qr-scan',
      testValues: [
        TestScan(l10n.tsPackageQr, 'PKG:pkg-chk-1:1'),
        TestScan(l10n.tsPackageQr, 'PKG:pkg-chk-2:1'),
        TestScan(l10n.tsOldLabel, 'PKG:pkg-chk-1:2'),
        TestScan(l10n.tsWrong, '8801115114154'),
      ],
      label: l10n.packageQrHint,
      cameraTitle: l10n.packageQrCameraTitle,
      continuous: false,
      autofocus: false,
      onScan: (code) {
        final qr = parsePackageQr(code);
        if (qr == null) return ScanFeedback.error(l10n.notPackageQr);
        context.push(
          '/packages/${Uri.encodeComponent(qr.packageId)}/handover'
          '?scanned=${qr.version}',
        );
        return const ScanFeedback.ok();
      },
    );
  }
}

/// 허가받은 라이더 한 줄 — "허가받은 라이더: 김*수 · 482913". 모르면 "라이더", 조회 실패면 "라이더(이름 못 읽음)".
/// 라이더 ID 는 글자로 내지 않는다(ADR-0070).
class RiderLabelText extends ConsumerWidget {
  const RiderLabelText({super.key, required this.riderId, required this.ids});

  final String? riderId;

  /// 같은 화면 라이더를 한 번에 묻는 키([riderKey]).
  final String ids;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final text = riderDisplayText(l10n, ref, riderId, ids);
    return Text(
      l10n.hoRider(text),
      key: riderId == null ? null : ValueKey('ho-rider-$riderId'),
    );
  }
}

/// 라이더 한 명의 화면 표기 — "김*수 · 482913", 탈퇴는 번호만, 모르면 "라이더", 조회 실패면 "라이더(이름 못 읽음)".
/// [ids] 는 같은 화면 라이더 전체 키([riderKey]) — 같은 키면 조회는 한 번이다.
String riderDisplayText(
  AppLocalizations l10n,
  WidgetRef ref,
  String? riderId,
  String ids,
) {
  final id = riderId;
  if (id == null) return l10n.riderUnknown;
  return switch (ref.watch(riderLabelsProvider(ids))) {
    AsyncData(:final value) => value[id]?.text ?? l10n.riderUnknown,
    AsyncError() => l10n.riderUnreadable,
    _ => '…',
  };
}
