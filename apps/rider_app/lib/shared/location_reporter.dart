import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as tr;
import 'package:pmart_core/pmart_core.dart';

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

final locationReporterProvider = NotifierProvider<LocationReporter, bool>(
  LocationReporter.new,
);

/// 운행 중·배달 중에 위치를 모아 일정 간격으로 올린다. 상태 = 보내는 중인지.
///
/// 보내는 동안은 Android 상시 알림(위치 포그라운드 서비스)을 띄워 앱을 내려도 계속 보낸다
/// (사용자 결정 2026-11-16). 좌표는 로그에 남기지 않는다.
class LocationReporter extends Notifier<bool> {
  LocationSource? _source;
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

  /// [notice] 는 보내는 동안 띄울 상시 알림 문구.
  void setActive(bool active, {LocationNotice? notice}) {
    if (active == state) return;
    active ? _start(notice) : _stop();
    state = active;
  }

  void _start(LocationNotice? notice) {
    final source = ref.read(locationSourceProvider);
    if (source == null) return;
    _source = source;
    unawaited(source.keepAlive(notice));
    _sub = source.watch().listen(
      (p) => _buffer.add((
        lat: p.lat,
        lng: p.lng,
        recordedAt: DateTime.now().toUtc(),
      )),
    );
    _timer = Timer.periodic(
      ref.read(locationFlushIntervalProvider),
      (_) => flush(),
    );
  }

  void _stop() {
    unawaited(_source?.keepAlive(null));
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
    } on PmartFailure {
      // 다음 간격에 같은 키로 다시 보낸다.
    }
  }

  /// 시험용: 점 하나를 넣는다.
  void addForTest(LocationSample p) => _buffer.add(p);
}
