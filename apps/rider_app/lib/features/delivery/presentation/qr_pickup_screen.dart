import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/qr_camera.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/trip_repository.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import '../../../shared/keyboard.dart';

/// QR코드 픽업. 포장마다 스캔하고, 서버가 인계를 확정한 포장만 인계 완료로 센다.
/// 모든 포장이 확정돼야 픽업 완료를 보낼 수 있다(스캔 ≠ 인계).
/// 스캔이 안 되면 라벨의 숫자(4자리, 옛 포장 6자리)를 직접 입력한다 — 숫자로 허가를 받고(mfc-fulfillment
/// `handover-code-authorizations`) 확정은 스캔과 같다. 5번 틀리면 숫자 입력이 막힌다(QR·직원 확인).
class QrPickupScreen extends ConsumerStatefulWidget {
  const QrPickupScreen({super.key, required this.deliveryId});

  final String deliveryId;

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

  Future<void> _scan(DeliveryView d, String code) async {
    if (code.trim().isEmpty || _scanning) return;
    _scanning = true;
    try {
      await ref.read(deliveryFlowProvider(_id).notifier).scan(d, code);
    } finally {
      _scanning = false;
    }
  }

  /// 숫자 입력 → 숫자로 인계 허가·확정. 안내는 아래 칸에 바로 보인다(토스트가 픽업 버튼을 가리지 않게).
  Future<void> _enterNumber(DeliveryView d, String digits) async {
    if (_scanning) return;
    _scanning = true;
    try {
      final step = await ref
          .read(deliveryFlowProvider(_id).notifier)
          .enterCode(d, digits);
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      // 같은 MFC 에서 픽업 전인 다른 주문(묶음·여러 건) — 틀린 숫자가 그 주문 포장일 수 있다.
      // 목록을 못 읽었으면 없는 것으로 본다(기본 안내).
      final others = ref.read(myActiveDeliveriesProvider).value ?? const [];
      final pickingUpOthers = others.any(
        (o) =>
            o.deliveryId != _id &&
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
    // 픽업이 이미 끝났거나(연타로 화면이 한 번 더 열림 — 2026-11-20 S23 실서버 재현) 배송이 다른 단계로 갔으면
    // 이 화면을 닫는다. 남아 있으면 끝난 픽업 버튼이 켜진 채 보인다.
    if (d != null && d.state != ExecutionState.arrivedAtStore && !_closing) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _close();
      });
    }
    final trip = ref.watch(tripInfoProvider(_id)).value;
    // 숫자 안내에서 같이 픽업하는 다른 주문이 있는지 본다(_enterNumber) — 화면이 떠 있는 동안 살려 둔다.
    ref.watch(myActiveDeliveriesProvider);
    final flow = ref.watch(deliveryFlowProvider(_id));
    final ctl = ref.read(deliveryFlowProvider(_id).notifier);
    final queue = ref.watch(deliveryQueueProvider(_id)).value ?? const [];
    final camera = ref.watch(qrCameraProvider);
    final packages = d?.packageIds ?? const <String>[];
    final done = packages
        .where((p) => flow.phaseOf(p).phase == HandoverPhase.handedOver)
        .length;
    final allHanded = packages.isNotEmpty && done == packages.length;
    final busy = queue.any((q) => q.isOpen);

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
                        ? camera((code) => _scan(d, code))
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
                    if ((camera == null || _numberOpen) && d != null) ...[
                      _NumberField(
                        key: const ValueKey('number-inline'),
                        autofocus: _numberOpen,
                        onSubmit: (v) => _enterNumber(d, v),
                      ),
                      const SizedBox(height: 8),
                    ],
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
                    for (final pkg in packages)
                      if (flow.phaseOf(pkg).phase == HandoverPhase.checking)
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
                              onPressed: () => ctl.checkAgain(pkg),
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
                      label: l10n.pickupDone,
                      // 모든 포장의 인계가 서버에서 확정돼야 픽업 완료를 보낼 수 있다.
                      onPressed: (allHanded && !busy)
                          ? () async {
                              await ctl.pickup();
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
