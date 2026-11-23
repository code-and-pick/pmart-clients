import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/qr_camera.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/delivery_repository.dart' show packageIdFromQr;
import '../data/trip_repository.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'pickup_group.dart';
import '../../../shared/keyboard.dart';

/// QR코드 픽업. 포장마다 스캔하고, 서버가 인계를 확정한 포장만 인계 완료로 센다.
/// 모든 포장이 확정돼야 픽업 완료를 보낼 수 있다(스캔 ≠ 인계).
/// 스캔이 안 되면 라벨의 숫자(4자리, 옛 포장 6자리)를 직접 입력한다 — 숫자로 허가를 받고(mfc-fulfillment
/// `handover-code-authorizations`) 확정은 스캔과 같다. 5번 틀리면 숫자 입력이 막힌다(QR·직원 확인).
///
/// 같은 가게에서 함께 픽업하는 배송이 있으면([withIds], 사용자 2026-11-23 "가게는 한 번에 가서 2개 동시에 픽업")
/// 이 화면 하나에서 모든 주문의 포장을 찍는다 — 찍은 포장이 속한 배송으로 인계를 보내고,
/// 모든 주문의 포장이 확정되면 픽업 완료를 배송마다 보낸다.
class QrPickupScreen extends ConsumerStatefulWidget {
  const QrPickupScreen({
    super.key,
    required this.deliveryId,
    this.withIds = const [],
  });

  final String deliveryId;

  /// 함께 픽업하는 같은 가게의 다른 배송.
  final List<String> withIds;

  @override
  ConsumerState<QrPickupScreen> createState() => _QrPickupScreenState();
}

class _QrPickupScreenState extends ConsumerState<QrPickupScreen> {
  bool _closing = false;

  /// 닫기 직전에 카메라를 먼저 끈다 — 카메라 미리보기가 켜진 채 닫히면 아래 지도(안드로이드가 그리는 화면)가
  /// 페이드 동안 검게 깜빡였다(2026-11-20 S23 픽업 뒤 화면 녹화로 확인, 사용자 "검정으로 껌뻑껌뻑").
  bool _cameraOff = false;

  /// 한 번만 닫는다: 카메라를 끄고 한 프레임 뒤에 닫는다(픽업 버튼과 단계 바뀜 감지가 둘 다 닫으려 했다).
  void _close() {
    if (_closing) return;
    _closing = true;
    setState(() => _cameraOff = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && context.canPop()) context.pop();
    });
  }

  bool _scanning = false;
  String? _numberError;

  String get _id => widget.deliveryId;

  /// 함께 픽업하는 배송(이 배송 먼저). 화면에서 가게 도착 상태인 것만 쓴다.
  /// 고객 방문 순서대로("1번 주문" = 먼저 갈 고객) — 숫자 입력 칸의 주문 고르기와 줄 순서가 같다.
  List<DeliveryView> _members(DeliveryView d) => orderByStop(
    [
      d,
      for (final id in widget.withIds)
        if (ref.watch(deliveryProvider(id)).value case final o?
            when o.mfcId == d.mfcId && o.state == ExecutionState.arrivedAtStore)
          o,
    ],
    ref.watch(myActiveDeliveriesProvider).value,
    ref.watch(bundleStopsProvider),
  );

  /// 마지막으로 찍은 포장의 배송 — 안내 문구를 그 배송 기준으로 보인다.
  String? _lastFlowId;

  /// 숫자 입력을 보낼 배송(여럿이면 고른다). 없으면 아직 다 안 받은 첫 배송.
  String? _numberTarget;

  Future<void> _scan(List<DeliveryView> members, String code) async {
    if (code.trim().isEmpty || _scanning) return;
    _scanning = true;
    try {
      // 찍은 포장이 속한 배송으로 보낸다. 어느 배송 포장도 아니면 이 배송 기준(다른 배달 포장 안내).
      final pkg = packageIdFromQr(code);
      final owner =
          members.where((m) => m.packageIds.contains(pkg)).firstOrNull ??
          members.first;
      setState(() => _lastFlowId = owner.deliveryId);
      await ref
          .read(deliveryFlowProvider(owner.deliveryId).notifier)
          .scan(owner, code);
    } finally {
      _scanning = false;
    }
  }

  /// 숫자 입력 → 숫자로 인계 허가·확정. 안내는 아래 칸에 바로 보인다(토스트가 픽업 버튼을 가리지 않게).
  Future<void> _enterNumber(DeliveryView d, String digits) async {
    if (_scanning) return;
    _scanning = true;
    setState(() => _lastFlowId = d.deliveryId);
    try {
      final step = await ref
          .read(deliveryFlowProvider(d.deliveryId).notifier)
          .enterCode(d, digits);
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      // 같은 MFC 에서 픽업 전인 다른 주문(묶음·여러 건) — 틀린 숫자가 그 주문 포장일 수 있다.
      // 목록을 못 읽었으면 없는 것으로 본다(기본 안내).
      final others = ref.read(myActiveDeliveriesProvider).value ?? const [];
      final pickingUpOthers = others.any(
        (o) =>
            o.deliveryId != d.deliveryId &&
            !widget.withIds.contains(o.deliveryId) &&
            o.mfcId != null &&
            o.mfcId == d.mfcId &&
            (o.state == ExecutionState.assigned ||
                o.state == ExecutionState.arrivedAtStore),
      );
      setState(
        () => _numberError = labelNumberResultText(
          l10n,
          step,
          pickingUpOthers: pickingUpOthers,
        ),
      );
    } finally {
      _scanning = false;
    }
  }

  /// "스캔이 안 된다면"을 눌렀다 — 숫자 칸을 이 화면 아래에 바로 연다(사용자 2026-11-23 "팝업창이 뜨게 하니까 느린데").
  /// 전에는 아래 시트가 올라온 뒤 키보드가 또 올라와 두 번 움직였다. 이제 칸이 바로 생기고 키보드만 올라온다.
  bool _numberOpen = false;

  void _openNumberPad(DeliveryView d) {
    if (_numberOpen) return;
    setState(() => _numberOpen = true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(_id)).value;
    final members = d == null ? const <DeliveryView>[] : _members(d);
    // 픽업이 이미 끝났거나(연타로 화면이 한 번 더 열림 — 2026-11-20 S23 실서버 재현) 배송이 다른 단계로 갔으면
    // 이 화면을 닫는다. 남아 있으면 끝난 픽업 버튼이 켜진 채 보인다(함께 픽업하는 배송도 모두 넘어갔을 때).
    final stillHere = members.any(
      (m) => m.state == ExecutionState.arrivedAtStore,
    );
    if (d != null && !stillHere && !_closing) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _close();
      });
    }
    final trip = ref.watch(tripInfoProvider(_id)).value;
    // 숫자 안내에서 같이 픽업하는 다른 주문이 있는지 본다(_enterNumber) — 화면이 떠 있는 동안 살려 둔다.
    ref.watch(myActiveDeliveriesProvider);
    // 배송마다 인계 상태·보낼 명령.
    final flows = {
      for (final m in members)
        m.deliveryId: ref.watch(deliveryFlowProvider(m.deliveryId)),
    };
    // 모든 배송의 큐를 지켜본다(any 는 중간에 멈추므로 먼저 다 읽는다).
    final queues = [
      for (final m in members)
        ref.watch(deliveryQueueProvider(m.deliveryId)).value ?? const [],
    ];
    final busy = queues.any((q) => q.any((i) => i.isOpen));
    if (members.isEmpty) ref.watch(deliveryFlowProvider(_id));
    final lastId = flows.containsKey(_lastFlowId) ? _lastFlowId! : _id;
    final DeliveryFlowState flow =
        flows[lastId] ?? ref.watch(deliveryFlowProvider(_id));
    final camera = ref.watch(qrCameraProvider);
    int handed(DeliveryView m) => m.packageIds
        .where(
          (p) =>
              flows[m.deliveryId]!.phaseOf(p).phase == HandoverPhase.handedOver,
        )
        .length;
    final packages = [for (final m in members) ...m.packageIds];
    final done = members.fold<int>(0, (a, m) => a + handed(m));
    final allHanded =
        members.isNotEmpty &&
        members.every(
          (m) => m.packageIds.isNotEmpty && handed(m) == m.packageIds.length,
        );
    final group = members.length > 1;
    // 숫자 입력 대상: 고른 배송, 없으면 아직 다 안 받은 첫 배송.
    final numberTarget =
        members.where((m) => m.deliveryId == _numberTarget).firstOrNull ??
        members.where((m) => handed(m) < m.packageIds.length).firstOrNull ??
        d;

    return Scaffold(
      backgroundColor: const Color(0xFF3A3A3A),
      body: Column(
        children: [
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.qrPickup,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('qr-close'),
                    icon: const Icon(
                      Icons.close,
                      color: Colors.white,
                      size: 30,
                    ),
                    onPressed: _close,
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 8),
              child: Center(
                child: AspectRatio(
                  aspectRatio: 1,
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.white, width: 2),
                      color: Colors.black26,
                    ),
                    clipBehavior: Clip.hardEdge,
                    child: camera != null && d != null && !_cameraOff
                        ? camera((code) => _scan(members, code))
                        : const Center(
                            child: Icon(
                              Icons.qr_code_scanner,
                              color: Colors.white54,
                              size: 72,
                            ),
                          ),
                  ),
                ),
              ),
            ),
          ),
          Text(
            l10n.scanQr,
            style: const TextStyle(color: Colors.white, fontSize: 16),
          ),
          TextButton(
            key: const ValueKey('manual-entry'),
            onPressed: d == null ? null : () => _openNumberPad(d),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  l10n.scanManualNumber,
                  style: const TextStyle(color: Colors.white70, fontSize: 14),
                ),
                const Icon(
                  Icons.chevron_right,
                  color: Colors.white70,
                  size: 18,
                ),
              ],
            ),
          ),
          Material(
            color: Colors.white,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // 카메라가 없거나(시험·카메라 오류) "스캔이 안 된다면"을 눌렀으면 숫자 입력 칸을 바로 보인다.
                    if ((camera == null || _numberOpen) &&
                        numberTarget != null) ...[
                      // 여러 주문이면 숫자를 어느 주문 포장에 넣을지 고른다(틀린 주문에 넣으면 남은 횟수가 준다).
                      if (group)
                        Wrap(
                          spacing: 6,
                          children: [
                            for (final (i, m) in members.indexed)
                              ChoiceChip(
                                key: ValueKey('number-target-${m.deliveryId}'),
                                label: Text(l10n.pickupOrderN(i + 1)),
                                selected:
                                    m.deliveryId == numberTarget.deliveryId,
                                onSelected: (_) => setState(
                                  () => _numberTarget = m.deliveryId,
                                ),
                              ),
                          ],
                        ),
                      _NumberField(
                        key: const ValueKey('number-inline'),
                        autofocus: _numberOpen,
                        onSubmit: (v) => _enterNumber(numberTarget, v),
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (!group) ...[
                      Text(
                        l10n.orderNumber,
                        style: const TextStyle(
                          fontSize: 14,
                          color: RiderColors.sub,
                        ),
                      ),
                      OrderCode(
                        code: trip?.orderNo ?? d?.orderId ?? _id,
                        size: 26,
                      ),
                    ] else
                      // 함께 픽업하는 주문마다 받은 포장 수.
                      for (final (i, m) in members.indexed)
                        _GroupRow(
                          key: ValueKey('group-row-${m.deliveryId}'),
                          index: i + 1,
                          deliveryId: m.deliveryId,
                          fallback: m.orderId ?? m.deliveryId,
                          done: handed(m),
                          total: m.packageIds.length,
                        ),
                    const SizedBox(height: 6),
                    Text(
                      l10n.handoverProgress(done, packages.length),
                      key: const ValueKey('handover-progress'),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (_numberError case final e?)
                      Text(
                        e,
                        key: const ValueKey('number-error'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: RiderColors.danger,
                        ),
                      )
                    else if (flow.lastScan case final s?
                        when s != ScanVerdict.accepted)
                      Text(
                        switch (s) {
                          ScanVerdict.otherDelivery => l10n.scanOtherDelivery,
                          ScanVerdict.duplicate => l10n.scanDuplicate,
                          _ => l10n.scanUnreadable,
                        },
                        key: const ValueKey('scan-error'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: RiderColors.danger,
                        ),
                      )
                    else if (flow.lastRejectCode case final code?)
                      Text(
                        handoverRejectText(l10n, code),
                        key: const ValueKey('scan-rejected'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: RiderColors.danger,
                        ),
                      ),
                    for (final m in members)
                      for (final pkg in m.packageIds)
                        if (flows[m.deliveryId]!.phaseOf(pkg).phase ==
                            HandoverPhase.checking)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Flexible(
                                child: Text(
                                  '${l10n.packageLabel(pkg)} · ${l10n.hoChecking}',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                              TextButton(
                                key: ValueKey('check-$pkg'),
                                onPressed: () => ref
                                    .read(
                                      deliveryFlowProvider(m.deliveryId)
                                          .notifier,
                                    )
                                    .checkAgain(pkg),
                                child: Text(l10n.checkAgain),
                              ),
                            ],
                          ),
                    if (!allHanded && done > 0)
                      Text(
                        l10n.partialHandover,
                        key: const ValueKey('partial-handover'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 13,
                          color: RiderColors.pickup,
                        ),
                      ),
                    const SizedBox(height: 10),
                    RiderButton(
                      key: const ValueKey('pickup'),
                      label: group
                          ? l10n.pickupDoneGroup(members.length)
                          : l10n.pickupDone,
                      // 모든 포장의 인계가 서버에서 확정돼야 픽업 완료를 보낼 수 있다(함께 픽업하면 모든 주문).
                      onPressed: (allHanded && !busy)
                          ? () async {
                              // 차례로(동시에 넣으면 기기에 저장하는 명령 큐를 함께 고쳐 한 건이 덮인다).
                              for (final m in members) {
                                await ref
                                    .read(
                                      deliveryFlowProvider(m.deliveryId)
                                          .notifier,
                                    )
                                    .pickup();
                                if (!context.mounted) return;
                              }
                              if (context.mounted) _close();
                            }
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 라벨 숫자 입력 칸(숫자 키패드).
class _NumberField extends StatefulWidget {
  const _NumberField({
    super.key,
    required this.onSubmit,
    this.autofocus = false,
  });

  final Future<void> Function(String digits) onSubmit;
  final bool autofocus;

  @override
  State<_NumberField> createState() => _NumberFieldState();
}

class _NumberFieldState extends State<_NumberField> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final v = _input.text.trim();
    if (v.isEmpty) return;
    _input.clear();
    await widget.onSubmit(v);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          child: TextField(
            onTapOutside: dismissKeyboard,
            key: const ValueKey('qr-number'),
            controller: _input,
            autofocus: widget.autofocus,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(PackageLabelNumber.maxLength),
            ],
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(hintText: l10n.labelNumberHint),
            onSubmitted: (_) => _submit(),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton(
          key: const ValueKey('qr-number-submit'),
          style: FilledButton.styleFrom(backgroundColor: RiderColors.primary),
          onPressed: _submit,
          child: Text(l10n.ok),
        ),
      ],
    );
  }
}

/// 함께 픽업하는 주문 한 줄 — "1번 주문 · 주문번호 · 받은 포장 n/m".
class _GroupRow extends ConsumerWidget {
  const _GroupRow({
    super.key,
    required this.index,
    required this.deliveryId,
    required this.fallback,
    required this.done,
    required this.total,
  });

  final int index;
  final String deliveryId;
  final String fallback;
  final int done;
  final int total;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final orderNo = ref.watch(tripInfoProvider(deliveryId)).value?.orderNo;
    final complete = total > 0 && done == total;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Text(
            l10n.pickupOrderN(index),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          const SizedBox(width: 8),
          Expanded(child: OrderCode(code: orderNo ?? fallback, size: 18)),
          Icon(
            complete ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 18,
            color: complete ? RiderColors.primary : RiderColors.sub,
          ),
          const SizedBox(width: 4),
          Text(
            '$done/$total',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
