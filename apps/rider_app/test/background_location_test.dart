import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/shared/background_location.dart';
import 'package:rider_app/shared/location.dart';
import 'package:rider_app/shared/location_reporter.dart';

final class _Source implements LocationSource {
  final points = StreamController<GeoPoint>.broadcast();
  final notices = <LocationNotice?>[];

  @override
  Future<GeoPoint?> current() async => null;

  @override
  Stream<GeoPoint> watch() => points.stream;

  @override
  Future<void> keepAlive(LocationNotice? notice) async => notices.add(notice);
}

final class _Background implements BackgroundLocation {
  final calls = <String>[];

  /// 위치 권한이 있는지(없으면 서비스가 못 켜져 false)
  bool permitted = true;

  /// start 때 받은 서비스 전송 간격
  final flushes = <Duration>[];

  @override
  Future<bool> start(
    LocationNotice notice, {
    Duration flushEvery = const Duration(seconds: 10),
  }) async {
    flushes.add(flushEvery);
    calls.add('start:${notice.title}');
    return permitted;
  }

  @override
  Future<void> syncToken() async => calls.add('token');

  @override
  Future<void> stop() async => calls.add('stop');
}

final class _Uploader implements LocationUploader {
  int batches = 0;

  @override
  Future<void> upload(
    List<LocationSample> points, {
    required IdempotencyKey key,
  }) async => batches++;
}

/// 앱을 닫아도 위치 전송(2026-11-18): 앱 화면이 있는 동안은 Dart 가 보내고, 운행 시작 때 서비스를 켜 두며
/// 보낼 때마다 최신 토큰을 건넨다. 상시 알림은 서비스가 띄우므로 geolocator 알림은 쓰지 않는다.
void main() {
  const notice = (title: '운행 중', text: '위치를 보내고 있어요', channel: '위치');

  ProviderContainer container(_Source source, BackgroundLocation? bg) {
    final c = ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        locationSourceProvider.overrideWithValue(source),
        backgroundLocationProvider.overrideWithValue(bg),
        locationUploaderProvider.overrideWithValue(_Uploader()),
      ],
    );
    addTearDown(c.dispose);
    return c;
  }

  test(
    '운행 시작 → 서비스 켜기(geolocator 상시 알림 없음), 보낸 뒤 토큰 건넴, 운행 끝 → 서비스 끄기',
    () async {
      final source = _Source();
      final bg = _Background();
      final c = container(source, bg);
      final reporter = c.read(locationReporterProvider.notifier)
        ..setActive(true, notice: notice);
      await Future<void>.delayed(Duration.zero);
      expect(bg.calls, ['start:운행 중']);
      expect(source.notices, [null], reason: '알림은 서비스가 띄운다');

      reporter.addForTest((
        lat: 37.5,
        lng: 127.0,
        recordedAt: DateTime.utc(2026),
      ));
      await reporter.flush();
      await Future<void>.delayed(Duration.zero);
      expect(bg.calls.last, 'token');

      reporter.setActive(false);
      await Future<void>.delayed(Duration.zero);
      expect(bg.calls.last, 'stop');
    },
  );

  test('서비스가 없으면(목 모드·시험) 지금처럼 geolocator 상시 알림', () async {
    final source = _Source();
    final c = container(source, null);
    c.read(locationReporterProvider.notifier).setActive(true, notice: notice);
    await Future<void>.delayed(Duration.zero);
    expect(source.notices, [notice]);
  });

  test('위치 권한 없이 운행이 켜지면 서비스를 못 켜고, 권한을 받은 뒤 retryAfterPermission 이 다시 켠다(가입 직후 앱 꺼짐, 2026-11-19)', () async {
    final source = _Source();
    final bg = _Background()..permitted = false;
    final c = container(source, bg);
    final reporter = c.read(locationReporterProvider.notifier)
      ..setActive(true, notice: notice);
    await Future<void>.delayed(Duration.zero);
    expect(bg.calls, ['start:운행 중']);

    bg.permitted = true;
    reporter.retryAfterPermission();
    await Future<void>.delayed(Duration.zero);
    expect(bg.calls, ['start:운행 중', 'stop', 'start:운행 중']);

    // 이미 켜졌으면 다시 켜지 않는다(앱으로 돌아올 때마다 부름)
    reporter.retryAfterPermission();
    await Future<void>.delayed(Duration.zero);
    expect(bg.calls, hasLength(3));
  });

  test(
    '맡은 배송이 있는 동안은 5초마다, 없으면 10초마다 — 서비스(앱 닫힘)도 같은 간격(고객 지도 실시간, 2026-11-19)',
    () async {
      final source = _Source();
      final bg = _Background();
      final c = container(source, bg);
      final reporter = c.read(locationReporterProvider.notifier)
        ..setActive(true, notice: notice);
      await Future<void>.delayed(Duration.zero);
      expect(bg.flushes, [const Duration(seconds: 10)], reason: '운행 중·배송 없음');

      // 배송을 맡으면 간격만 5초로(다시 켜지 않는다)
      reporter.setActive(true, notice: notice, delivering: true);
      await Future<void>.delayed(Duration.zero);
      expect(bg.flushes.last, const Duration(seconds: 5));
      expect(bg.calls.where((x) => x == 'stop'), isEmpty);

      // 같은 상태로 다시 불러도 그대로
      reporter.setActive(true, notice: notice, delivering: true);
      await Future<void>.delayed(Duration.zero);
      expect(bg.flushes, hasLength(2));

      // 배송이 끝나면 10초로
      reporter.setActive(true, notice: notice);
      await Future<void>.delayed(Duration.zero);
      expect(bg.flushes.last, const Duration(seconds: 10));
    },
  );

  test('배송을 맡은 채 시작하면 처음부터 5초', () async {
    final source = _Source();
    final bg = _Background();
    final c = container(source, bg);
    c
        .read(locationReporterProvider.notifier)
        .setActive(true, notice: notice, delivering: true);
    await Future<void>.delayed(Duration.zero);
    expect(bg.flushes, [const Duration(seconds: 5)]);
  });
}
