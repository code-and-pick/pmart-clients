import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as tr;
import 'package:pmart_core/pmart_core.dart';

import 'background_location.dart';
import 'location.dart';
import 'providers.dart';

/// 서버에 보내는 위치 한 점.
typedef LocationSample = ({double lat, double lng, DateTime recordedAt});

/// 위치 묶음 올리기(`POST /riders/me/locations`, delivery-tracking).
abstract interface class LocationUploader {
  Future<void> upload(
    List<LocationSample> points, {
    required IdempotencyKey key,
  });
}

final class ApiLocationUploader implements LocationUploader {
  ApiLocationUploader(Dio dio, this._deviceId)
    : _api = tr.PmartApiDeliveryTracking(dio: dio).getLocationsApi();

  final tr.LocationsApi _api;
  final DeviceIdProvider _deviceId;

  @override
  Future<void> upload(
    List<LocationSample> points, {
    required IdempotencyKey key,
  }) async {
    final device = await _deviceId.get();
    await pmartGuard(
      () => _api.uploadMyLocations(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        locationBatch: tr.LocationBatch(
          deviceId: device,
          points: [
            for (final p in points)
              tr.LocationPoint(
                lat: p.lat,
                lng: p.lng,
                recordedAt: p.recordedAt,
              ),
          ],
        ),
        extra: commandOptions(key).extra,
      ),
    );
  }
}

/// 목: 받은 묶음 수만 센다.
final class MockLocationUploader implements LocationUploader {
  int batches = 0;
  int points = 0;

  @override
  Future<void> upload(
    List<LocationSample> points, {
    required IdempotencyKey key,
  }) async {
    batches++;
    this.points += points.length;
  }
}

final locationUploaderProvider = Provider<LocationUploader>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockLocationUploader(),
    PmartEnv.local => ApiLocationUploader(
      ref.watch(dioProvider),
      ref.watch(deviceIdProvider),
    ),
  },
);

/// 전송 간격(백엔드 안내 예시 10초). 위치가 2분 넘게 안 오면 배차 후보에서 빠지고,
/// 배달 중 3분 넘게 안 오면 "위치 끊김"이 기록된다.
final locationFlushIntervalProvider = Provider<Duration>(
  (_) => const Duration(seconds: 10),
);

/// 맡은 배송이 있는 동안(배정 ~ 전달 완료·반납)의 전송 간격 — 고객 지도에 라이더 위치가 5~8초 안에 보이게
/// (백엔드 딜리버리 조율 2026-11-19 notice-live-rider-location, 사용자 "실시간으로"). 표본은 그대로 5초.
final deliveringFlushIntervalProvider = Provider<Duration>(
  (_) => const Duration(seconds: 5),
);

final locationReporterProvider = NotifierProvider<LocationReporter, bool>(
  LocationReporter.new,
);

/// 운행 중·배달 중에 위치를 모아 일정 간격으로 올린다. 상태 = 보내는 중인지.
///
/// 보내는 동안은 Android 상시 알림(위치 포그라운드 서비스)을 띄워 앱을 내려도 계속 보낸다
/// (사용자 결정 2026-11-16). 실서버 Android 에서는 앱 화면이 없어지면 위치 전송 서비스가 넘겨받는다
/// ([BackgroundLocation], 2026-11-18). 좌표는 로그에 남기지 않는다.
class LocationReporter extends Notifier<bool> {
  LocationSource? _source;
  BackgroundLocation? _background;
  LocationNotice? _notice;
  bool _backgroundStarted = false;
  bool _delivering = false;
  StreamSubscription<GeoPoint>? _sub;
  Timer? _timer;
  final _buffer = <LocationSample>[];
  IdempotencyKey? _pendingKey;
  List<LocationSample>? _pending;

  @override
  bool build() {
    ref.onDispose(_stop);
    return false;
  }

  /// [notice] 는 보내는 동안 띄울 상시 알림 문구. [delivering] = 맡은 배송이 있음(더 자주 보낸다).
  void setActive(
    bool active, {
    LocationNotice? notice,
    bool delivering = false,
  }) {
    if (active == state) {
      if (active && delivering != _delivering) _changeInterval(delivering);
      return;
    }
    _delivering = delivering;
    active ? _start(notice) : _stop();
    state = active;
  }

  Duration get _interval => ref.read(
    _delivering
        ? deliveringFlushIntervalProvider
        : locationFlushIntervalProvider,
  );

  /// 보내는 중에 배송이 생기거나 끝났다 — 간격만 바꾼다(앱·서비스 둘 다).
  void _changeInterval(bool delivering) {
    _delivering = delivering;
    _timer?.cancel();
    _timer = Timer.periodic(_interval, (_) => flush());
    final background = _background;
    final notice = _notice;
    if (background != null && notice != null && _backgroundStarted) {
      unawaited(background.start(notice, flushEvery: _interval));
    }
  }

  /// 위치 권한을 받은 뒤(권한 창·설정에서 돌아옴) 부른다. 권한이 없어 못 켠 위치 전송 서비스·위치 구독을 다시 켠다.
  /// 이미 켜졌으면 아무것도 안 한다(가입 직후 권한을 묻는 동안 앱이 꺼지던 문제, 2026-11-19).
  void retryAfterPermission() {
    if (!state || _backgroundStarted) return;
    final notice = _notice;
    _stop();
    _start(notice);
  }

  void _start(LocationNotice? notice) {
    _notice = notice;
    final source = ref.read(locationSourceProvider);
    if (source == null) return;
    _source = source;
    // 실서버 Android: 상시 알림은 위치 전송 서비스가 띄운다(앱 화면이 없어지면 넘겨받아 보낸다).
    // 그 밖(목 모드 등): geolocator 상시 알림으로 앱을 내려도 받는다.
    final background = notice == null
        ? null
        : ref.read(backgroundLocationProvider);
    _background = background;
    if (background != null && notice != null) {
      unawaited(source.keepAlive(null));
      unawaited(
        background.start(notice, flushEvery: _interval).then((ok) {
          if (identical(_background, background)) _backgroundStarted = ok;
        }),
      );
    } else {
      unawaited(source.keepAlive(notice));
      _backgroundStarted = true;
    }
    _sub = source.watch().listen(
      (p) => _buffer.add((
        lat: p.lat,
        lng: p.lng,
        recordedAt: DateTime.now().toUtc(),
      )),
      // 권한이 아직 없으면 위치 스트림이 오류로 끝난다 — 권한을 받으면 retryAfterPermission 이 다시 구독한다.
      onError: (Object _) => _backgroundStarted = false,
    );
    _timer = Timer.periodic(_interval, (_) => flush());
  }

  void _stop() {
    unawaited(_source?.keepAlive(null));
    unawaited(_background?.stop());
    _background = null;
    _backgroundStarted = false;
    _source = null;
    _sub?.cancel();
    _timer?.cancel();
    _sub = null;
    _timer = null;
  }

  /// 모인 점을 보낸다. 보내지 못한 묶음은 같은 키로 다음에 다시 보낸다.
  Future<void> flush() async {
    if (_pending == null) {
      if (_buffer.isEmpty) return;
      _pending = List.of(_buffer);
      _buffer.clear();
      _pendingKey = IdempotencyKey.generate();
    }
    try {
      await ref
          .read(locationUploaderProvider)
          .upload(_pending!, key: _pendingKey!);
      _pending = null;
      _pendingKey = null;
      // 갱신된 토큰을 서비스에 건넨다(앱을 닫으면 이 토큰으로 이어 보낸다)
      unawaited(_background?.syncToken());
    } on PmartFailure {
      // 다음 간격에 같은 키로 다시 보낸다.
    }
  }

  /// 시험용: 점 하나를 넣는다.
  void addForTest(LocationSample p) => _buffer.add(p);
}
