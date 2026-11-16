import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/providers.dart';

/// 기기 설정 — 서버(게이트웨이) 주소(사용자 2026-11-17 "첫 화면은 기기 설정, 네트워크 설정 등").
///
/// 빌드 때 정한 주소(`PMART_API_BASE_URL`)를 PDA 에서 바꿀 수 있게 한다. 저장하지 않았으면 빌드 기본값.
/// 목 모드는 서버를 쓰지 않는다(저장은 되지만 쓰이지 않는다).
const serverAddressStoreKey = 'mfc.server.v1';

/// 앱을 켤 때 저장소에서 읽어 둔 값(`main` 이 넣는다). 테스트·미리보기는 null(빌드 기본값).
final savedServerAddressProvider = Provider<String?>((_) => null);

/// 지금 쓰는 서버 주소(저장한 값). null 이면 빌드 기본값.
final serverAddressProvider =
    NotifierProvider<ServerAddressController, String?>(
      ServerAddressController.new,
    );

class ServerAddressController extends Notifier<String?> {
  @override
  String? build() => ref.watch(savedServerAddressProvider);

  /// [baseUrl] 은 [normalizeServerAddress] 를 거친 값. null 이면 빌드 기본값으로 되돌린다.
  Future<void> save(String? baseUrl) async {
    final store = ref.read(secureStoreProvider);
    if (baseUrl == null) {
      await store.delete(serverAddressStoreKey);
    } else {
      await store.write(serverAddressStoreKey, baseUrl);
    }
    state = baseUrl;
  }
}

/// 사람이 넣은 주소를 API 기준 주소로. `192.168.0.40:8080` → `http://192.168.0.40:8080/api/v1`.
/// 경로가 없으면 `/api/v1` 을 붙인다. 주소가 아니면 null.
String? normalizeServerAddress(String input) {
  var s = input.trim();
  if (s.isEmpty) return null;
  if (!s.contains('://')) s = 'http://$s';
  final uri = Uri.tryParse(s);
  if (uri == null ||
      (uri.scheme != 'http' && uri.scheme != 'https') ||
      !RegExp(r'^[A-Za-z0-9.-]+$').hasMatch(uri.host) ||
      uri.hasQuery ||
      uri.hasFragment) {
    return null;
  }
  final path = uri.path.replaceAll(RegExp(r'/+$'), '');
  return uri.replace(path: path.isEmpty ? '/api/v1' : path).toString();
}

/// 연결 확인 결과. 닿았다 ≠ 로그인된다(계정·권한은 로그인에서 서버가 판정).
enum ProbeResult { reachable, unreachable, unsupported }

/// 서버 주소에 닿는지 — 그 주소·포트로 연결만 해 보고 바로 닫는다(API 를 부르지 않는다).
typedef ServerProbe = Future<ProbeResult> Function(Uri baseUrl);

final serverProbeProvider = Provider<ServerProbe>((_) => _tcpProbe);

Future<ProbeResult> _tcpProbe(Uri baseUrl) async {
  try {
    final socket = await Socket.connect(
      baseUrl.host,
      baseUrl.port,
      timeout: const Duration(seconds: 3),
    );
    socket.destroy();
    return ProbeResult.reachable;
  } on UnsupportedError {
    return ProbeResult.unsupported; // 웹 미리보기
  } on SocketException {
    return ProbeResult.unreachable;
  } on TimeoutException {
    return ProbeResult.unreachable;
  }
}
