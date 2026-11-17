import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers.dart';
import '../../../shared/qr_camera.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/mock_delivery_repository.dart';
import '../data/trip_repository.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';

/// 라벨 숫자 → QR 원문. null 이면 숫자 입력을 쓸 수 없다(실서버 — 계약에 아직 없음).
final labelNumberResolverProvider = Provider<String? Function(String)?>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockDeliveryRepository.qrForLabelNumber,
    PmartEnv.local => null,
  },
);

/// QR코드 픽업. 포장마다 스캔하고, 서버가 인계를 확정한 포장만 인계 완료로 센다.
/// 모든 포장이 확정돼야 픽업 완료를 보낼 수 있다(스캔 ≠ 인계).
/// 스캔이 안 되면 라벨의 숫자를 직접 입력한다(입력도 스캔과 같은 인계 절차를 탄다).
class QrPickupScreen extends ConsumerStatefulWidget {
  const QrPickupScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<QrPickupScreen> createState() => _QrPickupScreenState();
}

class _QrPickupScreenState extends ConsumerState<QrPickupScreen> {
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

  /// 숫자 입력 → QR 원문으로 바꿔 스캔과 같이 처리한다.
  Future<void> _enterNumber(DeliveryView d, String digits) async {
    final l10n = AppLocalizations.of(context);
    final resolve = ref.read(labelNumberResolverProvider);
    final code = resolve?.call(digits);
    // 안내는 아래 칸에 바로 보인다(토스트가 픽업 버튼을 가리지 않게).
    setState(
      () => _numberError = resolve == null
          ? l10n.labelNumberUnsupported
          : code == null
          ? l10n.labelNumberUnknown
          : null,
    );
    if (code != null) await _scan(d, code);
  }

  Future<void> _openNumberPad(DeliveryView d) async {
    final digits = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (context) => const _NumberSheet(),
    );
    if (digits != null && mounted) await _enterNumber(d, digits);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(_id)).value;
    final trip = ref.watch(tripInfoProvider(_id)).value;
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
                    onPressed: () => context.pop(),
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
                    child: camera != null && d != null
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
                    // 카메라가 없으면(시험·카메라 오류) 숫자 입력 칸을 바로 보인다.
                    if (camera == null && d != null) ...[
                      _NumberField(onSubmit: (v) => _enterNumber(d, v)),
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
                              if (context.mounted) context.pop();
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
  const _NumberField({required this.onSubmit, this.autofocus = false});

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
            key: const ValueKey('qr-number'),
            controller: _input,
            autofocus: widget.autofocus,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
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

/// "스캔이 안 된다면" → 숫자 입력 시트.
class _NumberSheet extends StatelessWidget {
  const _NumberSheet();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.labelNumberTitle,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.labelNumberGuide,
            style: const TextStyle(fontSize: 14, color: RiderColors.sub),
          ),
          const SizedBox(height: 14),
          _NumberField(
            autofocus: true,
            onSubmit: (v) async => Navigator.of(context).pop(v),
          ),
        ],
      ),
    );
  }
}
