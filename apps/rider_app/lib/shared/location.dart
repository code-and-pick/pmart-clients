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

/// 위치 권한과 알림 권한(Android 13+) 묻기.
///
/// 허용 범위는 라이더가 Android 설정 창에서 직접 고른다 — "앱 사용 중에만 허용"이든 "항상 허용"이든 둘 다 된다
/// (사용자 결정 2026-11-18). 운행·배달 중에는 위치 포그라운드 서비스(상시 알림)를 앱이 화면에 있을 때 켜므로,
/// "앱 사용 중에만 허용"이어도 다른 앱으로 넘어가도 위치를 계속 보낸다. 앱이 "항상 허용"을 요구하지 않는다.
/// Manifest 의 `ACCESS_BACKGROUND_LOCATION` 은 설정 창에 "항상 허용" 고르기가 보이도록 남겨 둔다.
abstract interface class RiderLocationPermission {
  Future<LocationAccess> check();

  /// 알림 권한을 묻고, 위치 권한 시스템 창을 띄운다.
  /// 시스템 창이 더는 뜨지 않으면(두 번 거절 등) 앱 설정 화면을 연다. 끝난 뒤의 권한을 돌려준다.
  Future<LocationAccess> request();
}

final locationPermissionProvider = Provider<RiderLocationPermission?>(
  (_) => Platform.environment.containsKey('FLUTTER_TEST')
      ? null
      : const DeviceRiderLocationPermission(),
);

final class DeviceRiderLocationPermission implements RiderLocationPermission {
  const DeviceRiderLocationPermission();

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
    final now = await Geolocator.checkPermission();
    if (now == LocationPermission.deniedForever) {
      await Geolocator.openAppSettings();
      return check();
    }
    if (_map(now) != LocationAccess.denied) return _map(now);
    final asked = await Geolocator.requestPermission();
    if (asked == LocationPermission.deniedForever) {
      await Geolocator.openAppSettings();
    }
    return _map(asked);
  }

  static LocationAccess _map(LocationPermission p) => switch (p) {
    LocationPermission.always => LocationAccess.always,
    LocationPermission.whileInUse => LocationAccess.whileInUse,
    _ => LocationAccess.denied,
  };
}

/// 배터리 최적화 예외(사용자 결정 2026-11-18). 제조사 절전이 운행·배달 중 앱을 종료하면
/// 상시 알림도 사라져 위치 전송이 끊긴다 — 예외로 두면 그런 일이 줄어든다. 고를지는 라이더가 정한다.
abstract interface class BatteryOptimization {
  /// 이미 예외인지. 확인하지 못하면 true(묻지 않는다).
  Future<bool> isExempt();

  /// 시스템 창("배터리 최적화를 중지할까요?")을 연다.
  Future<void> request();
}

final batteryOptimizationProvider = Provider<BatteryOptimization?>(
  (_) => Platform.environment.containsKey('FLUTTER_TEST')
      ? null
      : const DeviceBatteryOptimization(),
);

final class DeviceBatteryOptimization implements BatteryOptimization {
  const DeviceBatteryOptimization();

  static const _channel = MethodChannel('pmart.rider/battery');

  @override
  Future<bool> isExempt() async {
    try {
      return await _channel.invokeMethod<bool>('isExempt') ?? true;
    } on PlatformException {
      return true;
    } on MissingPluginException {
      return true;
    }
  }

  @override
  Future<void> request() async {
    try {
      await _channel.invokeMethod<bool>('request');
    } on PlatformException {
      // 창을 못 띄워도 위치 전송은 된다(종료될 가능성만 남는다).
    } on MissingPluginException {
      // 위와 같다.
    }
  }
}
