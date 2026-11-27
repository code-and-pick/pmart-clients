// 시연 빌드(사용자 2026-11-27 "라이더앱 기능 빠짐없이 녹화 … 너가 배차 온 것처럼 라이더도 움직이는 것처럼 설정해서").
// `--dart-define=PMART_ENV=mock --dart-define=PMART_DEMO=true` 일 때만 켜진다. 실서버(local)·평소 목 빌드에는 영향이 없다.
// - 주문(제안)이 운행을 시작하면 몇 초 뒤부터 하나씩 들어온다(목 제안 저장소 — 한꺼번에 떠 있지 않게).
// - 위치는 단말 GPS 대신 가짜 위치가 지도의 목적지(픽업 전 MFC, 픽업 뒤 고객) 쪽으로 움직인다.
// - 시나리오(어떤 주문을 보낼지)는 화면에 안 보이게 adb 로 넣은 파일에서 읽는다:
//   /sdcard/Android/data/com.pmart.rider_app/files/demo.txt — `single`(한집) · `bundle`(알뜰) · `all`(섞어서, 기본)
import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'location.dart';

const kDemo = bool.fromEnvironment('PMART_DEMO');

enum DemoScenario { all, single, bundle }

const _scenarioFile = '/sdcard/Android/data/com.pmart.rider_app/files/demo.txt';

/// 시나리오 파일을 읽는다. 없거나 못 읽으면 [DemoScenario.all].
DemoScenario readDemoScenario() {
  try {
    final v = File(_scenarioFile).readAsStringSync().trim().toLowerCase();
    return switch (v) {
      'single' => DemoScenario.single,
      'bundle' => DemoScenario.bundle,
      _ => DemoScenario.all,
    };
  } on Object {
    return DemoScenario.all;
  }
}

/// 지도가 긋는 목적지(픽업 전 MFC, 픽업 뒤 고객). 가짜 위치가 이쪽으로 간다. null 이면 멈춰 있다.
final demoTargetProvider = NotifierProvider<DemoTarget, GeoPoint?>(
  DemoTarget.new,
);

class DemoTarget extends Notifier<GeoPoint?> {
  @override
  GeoPoint? build() => null;

  void set(GeoPoint? p) {
    if (p != state) state = p;
  }
}

/// 가짜 위치 — 1초마다 목적지 쪽으로 [speed] m 씩 간다(시연이라 실제보다 빠르게). 목적지에 닿으면 멈춘다.
final class DemoLocationSource implements LocationSource {
  DemoLocationSource({
    required GeoPoint start,
    required this.target,
    this.speed = 35,
  }) : _at = start {
    _out = StreamController<GeoPoint>.broadcast(
      onListen: () =>
          _tick ??= Timer.periodic(const Duration(seconds: 1), (_) => _step()),
      onCancel: () {
        _tick?.cancel();
        _tick = null;
      },
    );
  }

  final GeoPoint? Function() target;

  /// 초당 m.
  final double speed;
  GeoPoint _at;
  late final StreamController<GeoPoint> _out;
  Timer? _tick;

  static const _mPerDegLat = 111320.0;

  void _step() {
    final t = target();
    if (t != null) {
      final mPerDegLng = _mPerDegLat * math.cos(_at.lat * math.pi / 180);
      final dy = (t.lat - _at.lat) * _mPerDegLat;
      final dx = (t.lng - _at.lng) * mPerDegLng;
      final d = math.sqrt(dx * dx + dy * dy);
      // 핀 바로 앞(10m)에서 멈춘다 — 핀과 내 위치 점이 겹치지 않게.
      if (d > 12) {
        final move = math.min(speed, d - 10) / d;
        _at = (
          lat: _at.lat + dy * move / _mPerDegLat,
          lng: _at.lng + dx * move / mPerDegLng,
        );
      }
    }
    if (!_out.isClosed) _out.add(_at);
  }

  @override
  Future<GeoPoint?> current() async => _at;

  @override
  Stream<GeoPoint> watch() => _out.stream;

  @override
  Future<void> keepAlive(LocationNotice? notice) async {}

  void dispose() {
    _tick?.cancel();
    unawaited(_out.close());
  }
}
