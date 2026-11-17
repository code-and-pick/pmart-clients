import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// QR 카메라 보기를 만드는 함수. 스캔한 원문을 [onCode] 로 넘긴다.
typedef QrCameraBuilder = Widget Function(ValueChanged<String> onCode);

/// 카메라 스캐너(어댑터). 시험 실행에는 카메라가 없어 null 이다 — 화면은 직접 입력만 보인다.
final qrCameraProvider = Provider<QrCameraBuilder?>(
  (_) => Platform.environment.containsKey('FLUTTER_TEST')
      ? null
      : (onCode) => _QrCamera(onCode: onCode),
);

class _QrCamera extends StatefulWidget {
  const _QrCamera({required this.onCode});

  final ValueChanged<String> onCode;

  @override
  State<_QrCamera> createState() => _QrCameraState();
}

class _QrCameraState extends State<_QrCamera> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    formats: const [BarcodeFormat.qrCode],
  );
  String? _last;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    for (final b in capture.barcodes) {
      final code = b.rawValue?.trim();
      if (code == null || code.isEmpty) continue;
      final now = DateTime.now();
      // 같은 QR 이 연속으로 잡히는 것을 2초 동안 한 번으로 본다.
      if (code == _last && now.difference(_lastAt).inSeconds < 2) continue;
      _last = code;
      _lastAt = now;
      widget.onCode(code);
    }
  }

  @override
  Widget build(BuildContext context) => MobileScanner(
    controller: _controller,
    onDetect: _onDetect,
    errorBuilder: (context, error) => const Center(
      child: Icon(
        Icons.no_photography_outlined,
        color: Colors.white54,
        size: 48,
      ),
    ),
  );
}
