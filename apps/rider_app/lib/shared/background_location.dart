import 'dart:io' show Platform;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import 'location.dart';
import 'providers.dart';

/// 앱 화면이 없어진 뒤(최근 앱에서 밀어 닫기) 위치 전송을 넘겨받는 Android 서비스(`RiderLocationService`).
///
/// 앱 화면이 있는 동안은 Dart([LocationReporter])가 보내고 토큰 갱신도 Dart 가 한다. 서비스는 운행 시작부터 상시 알림으로
/// 프로세스를 지키다가, 화면이 없어지면 마지막으로 받은 access token 으로 이어 보낸다(refresh 안 함 — 사용자 결정 2026-11-18
/// "앱이 준 토큰으로만"). 토큰이 끝나면 서비스가 멈추고 "앱을 열어 주세요" 알림을 띄운다.
abstract interface class BackgroundLocation {
  /// 운행 시작 — 상시 알림을 띄우고 넘겨받을 준비를 한다. 다시 부르면 Dart 가 보내는 쪽으로 돌려받는다.
  /// 못 켰으면(위치 권한이 아직 없음 등) false — 권한이 생기면 [LocationReporter.retryAfterPermission] 이 다시 부른다.
  /// [flushEvery] = 앱 화면이 없을 때 서비스가 올리는 간격(맡은 배송이 있으면 5초, 없으면 10초).
  Future<bool> start(LocationNotice notice, {Duration flushEvery});

  /// 넘겨받을 때 쓸 최신 access token 을 건넨다(값이 바뀐 때만 보낸다).
  Future<void> syncToken();

  Future<void> stop();
}

final class NativeBackgroundLocation implements BackgroundLocation {
  NativeBackgroundLocation({
    required this.baseUrl,
    required this.tokens,
    required this.deviceId,
  });

  static const _channel = MethodChannel('pmart.rider/location');

  final String baseUrl;
  final TokenStore tokens;
  final DeviceIdProvider deviceId;
  String? _sentToken;

  @override
  Future<bool> start(
    LocationNotice notice, {
    Duration flushEvery = const Duration(seconds: 10),
  }) async {
    final token = tokens.accessToken;
    _sentToken = token;
    return _call('start', {
      'baseUrl': baseUrl,
      'accessToken': ?token,
      'deviceId': await deviceId.get(),
      'sourceSystem': sourceSystem,
      'title': notice.title,
      'text': notice.text,
      'channel': notice.channel,
      'flushMs': flushEvery.inMilliseconds,
    });
  }

  @override
  Future<void> syncToken() async {
    final token = tokens.accessToken;
    if (token == null || token == _sentToken) return;
    _sentToken = token;
    await _call('token', {'accessToken': token});
  }

  @override
  Future<void> stop() async {
    _sentToken = null;
    await _call('stop', const {});
  }

  Future<bool> _call(String method, Map<String, Object?> args) async {
    try {
      return await _channel.invokeMethod<bool>(method, args) ?? false;
    } on PlatformException {
      // 서비스를 못 켜면 앱을 닫았을 때만 위치가 끊긴다(앱이 열려 있으면 Dart 가 보낸다). 토큰 값은 남기지 않는다.
    } on MissingPluginException {
      // 채널이 없는 환경
    }
    return false;
  }
}

/// 실서버(local)·Android 에서만 쓴다. 목 모드·시험에는 없다(null — 지금처럼 geolocator 상시 알림만).
final backgroundLocationProvider = Provider<BackgroundLocation?>((ref) {
  if (Platform.environment.containsKey('FLUTTER_TEST')) return null;
  if (!Platform.isAndroid) return null;
  final env = ref.watch(envProvider);
  if (env == PmartEnv.mock) return null;
  return NativeBackgroundLocation(
    baseUrl: riderApiBaseUrl(env),
    tokens: ref.watch(tokenStoreProvider),
    deviceId: ref.watch(deviceIdProvider),
  );
});
