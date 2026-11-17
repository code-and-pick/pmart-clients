import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

typedef GeoPoint = ({double lat, double lng});

/// 앱을 내려도 위치를 계속 받을 때 띄우는 Android 상시 알림 문구.
typedef LocationNotice = ({String title, String text, String channel});

/// 단말 위치(어댑터). 지도의 내 위치와 서버 위치 전송이 같은 스트림을 나눠 쓴다.
abstract interface class LocationSource {
  /// 지금 위치. 권한이 없거나 위치를 못 잡으면 null.
  Future<GeoPoint?> current();

  /// 새 위치(약 5초마다, 멈춰 있어도). 권한이 없으면 아무것도 오지 않는다.
  Stream<GeoPoint> watch();

  /// [notice] 가 있으면 상시 알림(포그라운드 서비스)을 띄워 앱을 내려도 위치를 받는다.
  /// null 이면 알림을 내리고 앱이 화면에 있을 때만 받는다.
  Future<void> keepAlive(LocationNotice? notice);
}

/// 시험 실행에는 위치 서비스가 없어 null 이다.
final locationSourceProvider = Provider<LocationSource?>((ref) {
  if (Platform.environment.containsKey('FLUTTER_TEST')) return null;
  final source = DeviceLocationSource();
  ref.onDispose(source.dispose);
  return source;
});

/// geolocator 는 Android 에서 위치 스트림을 하나만 두고 처음 구독한 설정을 계속 쓴다.
/// 그래서 여기서 한 번만 구독하고, 상시 알림을 켜고 끌 때는 다시 구독한다.
final class DeviceLocationSource implements LocationSource {
  DeviceLocationSource() {
    _out = StreamController<GeoPoint>.broadcast(
      onListen: _restart,
      onCancel: _stopUpstream,
    );
  }

  late final StreamController<GeoPoint> _out;
  StreamSubscription<Position>? _up;
  LocationNotice? _notice;
  int _generation = 0;

  @override
  Future<GeoPoint?> current() async {
    try {
      if (!await _allowed()) return null;
      final p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      return (lat: p.latitude, lng: p.longitude);
    } on Exception {
      // 위치를 못 잡은 것은 오류 화면이 아니라 "위치 모름"이다. 좌표는 로그에 남기지 않는다.
      return null;
    }
  }

  @override
  Stream<GeoPoint> watch() => _out.stream;

  @override
  Future<void> keepAlive(LocationNotice? notice) async {
    if (notice == _notice) return;
    _notice = notice;
    if (_out.hasListener) await _restart();
  }

  Future<void> _restart() async {
    final gen = ++_generation;
    await _stopUpstream();
    if (!await _allowed() || gen != _generation || !_out.hasListener) return;
    final notice = _notice;
    try {
      _up =
          Geolocator.getPositionStream(
            locationSettings: AndroidSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 0,
              intervalDuration: const Duration(seconds: 5),
              foregroundNotificationConfig: notice == null
                  ? null
                  : ForegroundNotificationConfig(
                      notificationTitle: notice.title,
                      notificationText: notice.text,
                      notificationChannelName: notice.channel,
                      enableWakeLock: true,
                      setOngoing: true,
                    ),
            ),
          ).listen(
            (p) => _out.add((lat: p.latitude, lng: p.longitude)),
            onError: (Object _) {},
          );
    } on Exception {
      // 위치를 못 받으면 "위치 모름"으로 둔다.
    }
  }

  Future<void> _stopUpstream() async {
    final up = _up;
    _up = null;
    await up?.cancel();
  }

  Future<bool> _allowed() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse;
  }

  void dispose() {
    _generation++;
    unawaited(_stopUpstream());
    unawaited(_out.close());
  }
}

/// 위치 권한 단계.
enum LocationAccess { denied, whileInUse, always }

/// "항상 허용" 위치 권한과 알림 권한(Android 13+). 앱을 내려도 위치를 보내는 데 쓴다.
abstract interface class BackgroundLocationPermission {
  Future<LocationAccess> check();

  /// 알림 권한을 묻고, 위치를 "항상 허용"으로 올려 달라고 한다.
  /// 시스템 창으로 안 되면 앱 설정 화면을 연다. 끝난 뒤의 권한을 돌려준다.
  Future<LocationAccess> request();
}

final backgroundLocationPermissionProvider =
    Provider<BackgroundLocationPermission?>(
      (_) => Platform.environment.containsKey('FLUTTER_TEST')
          ? null
          : const DeviceBackgroundLocationPermission(),
    );

final class DeviceBackgroundLocationPermission
    implements BackgroundLocationPermission {
  const DeviceBackgroundLocationPermission();

  static const _notifications = MethodChannel('pmart.rider/notifications');

  @override
  Future<LocationAccess> check() async =>
      _map(await Geolocator.checkPermission());

  @override
  Future<LocationAccess> request() async {
    try {
      await _notifications.invokeMethod<bool>('request');
    } on PlatformException {
      // 알림을 못 띄워도 위치 전송은 된다(알림만 안 보인다).
    }
    var access = await check();
    if (access == LocationAccess.always) return access;
    access = _map(await Geolocator.requestPermission());
    if (access != LocationAccess.always) {
      await Geolocator.openAppSettings();
    }
    return access;
  }

  static LocationAccess _map(LocationPermission p) => switch (p) {
    LocationPermission.always => LocationAccess.always,
    LocationPermission.whileInUse => LocationAccess.whileInUse,
    _ => LocationAccess.denied,
  };
}
