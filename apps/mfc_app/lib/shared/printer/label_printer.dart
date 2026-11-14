import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import 'label.dart';

/// 출력 방식. 포장대 고정형 라벨 프린터를 가정한다(2026-11-10).
enum PrinterMode {
  /// 프린터 없이 화면에 라벨을 보인다(기본).
  preview,

  /// 네트워크 라벨 프린터에 RAW(9100) 로 ZPL 을 보낸다.
  networkZpl,
}

@immutable
class PrinterSettings {
  const PrinterSettings({
    this.mode = PrinterMode.preview,
    this.host = '',
    this.port = defaultPort,
  });

  static const defaultPort = 9100;

  final PrinterMode mode;
  final String host;
  final int port;

  bool get networkReady => host.trim().isNotEmpty && port > 0 && port < 65536;

  Map<String, Object?> toJson() => {
    'mode': mode.name,
    'host': host,
    'port': port,
  };

  static PrinterSettings fromJson(Map<String, Object?> j) => PrinterSettings(
    mode: PrinterMode.values.firstWhere(
      (m) => m.name == j['mode'],
      orElse: () => PrinterMode.preview,
    ),
    host: j['host'] as String? ?? '',
    port: j['port'] as int? ?? defaultPort,
  );
}

/// 기기에 저장한 프린터 설정. 비밀값이 아니지만 앱의 저장소가 이것뿐이라 같이 쓴다.
final printerSettingsProvider =
    AsyncNotifierProvider<PrinterSettingsController, PrinterSettings>(
      PrinterSettingsController.new,
    );

class PrinterSettingsController extends AsyncNotifier<PrinterSettings> {
  static const _key = 'mfc.printer.v1';

  @override
  Future<PrinterSettings> build() async {
    final raw = await ref.read(secureStoreProvider).read(_key);
    if (raw == null) return const PrinterSettings();
    try {
      return PrinterSettings.fromJson(
        (jsonDecode(raw) as Map).cast<String, Object?>(),
      );
    } on FormatException {
      return const PrinterSettings();
    }
  }

  Future<void> save(PrinterSettings s) async {
    await ref.read(secureStoreProvider).write(_key, jsonEncode(s.toJson()));
    state = AsyncData(s);
  }
}

/// 프린터로 바이트를 보낸다. 테스트에서 바꾼다.
typedef RawPrintSender = Future<void> Function(
  String host,
  int port,
  List<int> bytes,
);

final rawPrintSenderProvider = Provider<RawPrintSender>((_) => sendRaw9100);

Future<void> sendRaw9100(String host, int port, List<int> bytes) async {
  final socket = await Socket.connect(
    host,
    port,
    timeout: const Duration(seconds: 5),
  );
  try {
    socket.add(bytes);
    await socket.flush();
  } finally {
    await socket.close();
  }
}

@immutable
sealed class PrintOutcome {
  const PrintOutcome();
}

/// 프린터로 보냈다. RAW 출력은 프린터가 결과를 돌려주지 않아 "나왔는지 확인" 으로 안내한다.
final class PrintSent extends PrintOutcome {
  const PrintSent();
}

/// 미리보기 모드 — 화면에 라벨을 보인다.
final class PrintPreview extends PrintOutcome {
  const PrintPreview(this.label);

  final PrintableLabel label;
}

enum PrintFailure { notConfigured, unreachable }

final class PrintFailed extends PrintOutcome {
  const PrintFailed(this.reason);

  final PrintFailure reason;
}

final labelPrintServiceProvider = Provider<LabelPrintService>(
  LabelPrintService.new,
);

/// 라벨 출력. 재출력은 같은 포장 ID·같은 QR(서버 값), 상품 스티커는 같은 바코드 그대로다 — 새 번호를 만들지 않는다.
class LabelPrintService {
  LabelPrintService(this._ref);

  final Ref _ref;

  Future<PrintOutcome> print(PrintableLabel label) async {
    final s = await _ref.read(printerSettingsProvider.future);
    switch (s.mode) {
      case PrinterMode.preview:
        return PrintPreview(label);
      case PrinterMode.networkZpl:
        if (!s.networkReady) {
          return const PrintFailed(PrintFailure.notConfigured);
        }
        try {
          await _ref.read(rawPrintSenderProvider)(
            s.host.trim(),
            s.port,
            utf8.encode(label.zpl()),
          );
          return const PrintSent();
        } on SocketException catch (e) {
          if (kDebugMode) {
            debugPrint('label print failed: ${e.osError?.errorCode}');
          }
          return const PrintFailed(PrintFailure.unreachable);
        }
    }
  }
}
