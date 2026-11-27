import 'dart:async';
import 'dart:io' show Platform;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart' as kakao;

import '../l10n/gen/app_localizations.dart';
import 'demo.dart';
import 'location.dart';
import 'rider_style.dart';
import 'rider_widgets.dart';

/// 카카오 네이티브 앱 키(빌드 때 `--dart-define-from-file=.secrets/rider.env`). 비면 지도 대신 약도를 그린다.
/// 키는 로그에 남기지 않는다.
const kakaoNativeAppKey = String.fromEnvironment('KAKAO_NATIVE_APP_KEY');

/// 카카오 지도를 쓸 수 있는지. 키가 있고 시험 실행이 아닐 때만 쓴다(arm 기기 전용 — x86 에뮬레이터 불가).
final mapAvailableProvider = Provider<bool>(
  (_) =>
      kakaoNativeAppKey.isNotEmpty &&
      !Platform.environment.containsKey('FLUTTER_TEST'),
);

/// 지도에 올릴 픽업지·전달지(핀 2개와 둘을 잇는 직선).
///
/// [pickupTime]·[dropTime] 이 있으면 핀 위에 "도착예상 / 오후 6:48" 두 줄을 핀 색으로 띄운다
/// (레퍼런스 image 11). 분 단위 문자열이라 1분에 한 번만 다시 그린다.
@immutable
class MapRoute {
  const MapRoute({
    this.pickup,
    this.drop,
    this.pickupTime,
    this.dropTime,
    this.toDrop = false,
  });

  /// 서버 좌표가 없으면 null — 그 핀·선은 그리지 않는다(지어낸 좌표로 그리지 않는다).
  final GeoPoint? pickup;
  final GeoPoint? drop;
  final String? pickupTime;
  final String? dropTime;

  /// 직선의 목적지. false = 내 위치 → 픽업지(제안·픽업 전), true = 내 위치 → 전달지(픽업 뒤).
  final bool toDrop;

  /// 내 위치에서 이어 그을 목적지. 픽업 뒤 전달지를 모르면 null(픽업지로 대신 긋지 않는다).
  GeoPoint? get target => toDrop ? drop : pickup;

  @override
  bool operator ==(Object other) =>
      other is MapRoute &&
      other.pickup == pickup &&
      other.drop == drop &&
      other.pickupTime == pickupTime &&
      other.dropTime == dropTime &&
      other.toDrop == toDrop;

  @override
  int get hashCode => Object.hash(pickup, drop, pickupTime, dropTime, toDrop);
}

/// 지도 바탕. 키가 없으면(목·시험) 약도 자리표시를 그린다.
///
/// [route] 가 있으면 픽업지·전달지 핀과 직선 경로를 올리고 둘이 다 보이게 맞춘다.
/// 좌표는 계약에 아직 없어 목 지점·주문 좌표(실서버는 픽업 뒤 전달지 좌표만)를 쓴다.
class RiderMap extends ConsumerWidget {
  const RiderMap({super.key, this.showRoute = false, this.route});

  final bool showRoute;
  final MapRoute? route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(mapAvailableProvider)) {
      return _LiveMap(route: route);
    }
    final l10n = AppLocalizations.of(context);
    final routed = showRoute || route != null;
    // 약도 자리(비율): 픽업·전달 핀 끝과 내 위치. 선은 내 위치 → 목적지(레퍼런스 image 11).
    const pickupAt = Offset(0.30, 0.44);
    const dropAt = Offset(0.20, 0.30);
    const meAt = Offset(0.80, 0.74);
    final target = route?.toDrop ?? false ? dropAt : pickupAt;
    return LayoutBuilder(
      builder: (context, box) {
        Positioned pinAt(Offset at, Widget pin) => Positioned(
          left: box.maxWidth * at.dx - 50,
          bottom: box.maxHeight * (1 - at.dy),
          child: pin,
        );
        return Stack(
          key: const ValueKey('map-placeholder'),
          children: [
            Positioned.fill(child: CustomPaint(painter: _SketchMapPainter())),
            if (routed) ...[
              Positioned.fill(
                child: CustomPaint(painter: _RoutePainter(meAt, target)),
              ),
              pinAt(
                dropAt,
                _Pin(
                  label: l10n.pinDrop,
                  color: RiderColors.drop,
                  caption: l10n.pinEta,
                  time: route?.dropTime,
                ),
              ),
              pinAt(
                pickupAt,
                _Pin(
                  label: l10n.pinPickup,
                  color: RiderColors.pickup,
                  caption: l10n.pinEta,
                  time: route?.pickupTime,
                ),
              ),
            ],
            Positioned(
              left: box.maxWidth * (routed ? meAt.dx : 0.5) - 14,
              top: box.maxHeight * (routed ? meAt.dy : 0.48) - 14,
              child: const _MeDot(),
            ),
          ],
        );
      },
    );
  }
}

/// 카카오 지도 + 내 위치(+ 픽업·전달 핀과 직선). 위치를 못 잡으면 기본 위치에 머문다.
class _LiveMap extends ConsumerStatefulWidget {
  const _LiveMap({this.route});

  final MapRoute? route;

  @override
  ConsumerState<_LiveMap> createState() => _LiveMapState();
}

/// 마지막으로 안 내 위치 — 지도는 화면마다 새로 생기므로, 새 지도를 이 자리에서 열어
/// 기본 위치(서울)에서 내 위치로 튀는 깜빡임을 없앤다.
GeoPoint? _lastKnownSpot;

class _LiveMapState extends ConsumerState<_LiveMap> {
  /// 지도가 처음 자리(내 위치·경로)를 잡을 때까지 지도 바탕색 덮개를 둔다 — 새 지도의 빈 흰 화면과
  /// 카메라 튐을 가린다(사용자 2026-11-18 "화면 전환 할 때마다 지도가 깜빡 깜빡"). 위치가 늦어도 오래 가리지 않게 상한을 둔다.
  bool _ready = false;
  Timer? _readyCap;

  void _reveal() {
    _readyCap?.cancel();
    if (mounted && !_ready) setState(() => _ready = true);
  }

  kakao.KakaoMapController? _map;
  kakao.Poi? _me;
  GeoPoint? _last;
  StreamSubscription<GeoPoint>? _sub;
  final _routePois = <kakao.Poi>[];
  kakao.Route? _line;

  @override
  void dispose() {
    _readyCap?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _LiveMap old) {
    super.didUpdateWidget(old);
    if (old.route != widget.route) {
      _demoAim();
      unawaited(_drawRoute());
    }
  }

  /// 시연 빌드: 가짜 위치가 이 지도의 목적지(픽업 전 MFC, 픽업 뒤 고객)로 가게 한다.
  /// 경로 없는 지도(빈 홈)는 목적지를 지우지 않는다 — 화면을 오가도 가던 길을 계속 간다.
  void _demoAim() {
    if (!kDemo) return;
    final target = widget.route?.target;
    if (target == null) return;
    Future.microtask(() {
      if (mounted) ref.read(demoTargetProvider.notifier).set(target);
    });
  }

  Future<void> _onReady(kakao.KakaoMapController controller) async {
    _map = controller;
    _demoAim();
    _readyCap = Timer(const Duration(milliseconds: 700), _reveal);
    final source = ref.read(locationSourceProvider);
    // 위치 받기는 지도가 준비되자마자 시작한다 — 전에는 경로 그리기를 기다린 뒤에 구독해서, 그리기가 끝나지
    // 않으면 내 위치 점이 처음 자리에 멈춰 있었다(사용자 2026-11-19 "라이더 이동위치 실시간으로 안 보여").
    if (source != null) _sub = source.watch().listen(_show);
    // 마지막으로 안 위치가 있으면 그것으로 먼저 그린다(지금 위치는 늦게 올 수 있다).
    if (_lastKnownSpot case final known?) {
      await _show(known);
      await _drawRoute();
      if (widget.route == null) await _center();
      _reveal();
    }
    // 직선은 내 위치에서 시작하므로 위치를 먼저 잡고 경로를 그린다.
    final here = await source?.current();
    if (!mounted) return;
    if (here != null) await _show(here);
    await _drawRoute();
    // 경로가 있으면 경로가 다 보이게 둔다(내 위치로 옮기지 않는다).
    if (widget.route == null) await _center();
    _reveal();
  }

  static kakao.LatLng _at(GeoPoint p) => kakao.LatLng(p.lat, p.lng);

  kakao.RouteStyle? _lineStyle;

  /// 레퍼런스(image 11): 주황 굵은 선 + 흰 테두리 + 진행 방향 화살표(›) 무늬.
  // 사용자 2026-11-25 레퍼런스: 회색 반투명 띠 위에 짙은 회색 꺾쇠(진행 방향).
  Future<kakao.RouteStyle> _style() async => _lineStyle ??= kakao.RouteStyle(
    _routeBand,
    16,
    pattern: kakao.RoutePattern(
      kakao.KImage.fromData(await _chevronPng(), 10, 10),
      24,
    ),
  );

  /// 지도 그리기(핀·선·카메라)는 한 번에 하나씩 차례로 한다. 경로가 바뀌거나 위치가 와서
  /// 작업이 겹치면 핀 목록이 꼬여 핀이 사라지거나 선이 두 개 생긴다(폰 확인 2026-11-16).
  Future<void> _op = Future.value();

  Future<void> _enqueue(Future<void> Function() job) =>
      _op = _op.then((_) => job()).catchError((Object _) {});

  Future<void> _drawLine() => _enqueue(_drawLineNow);

  Future<void> _drawRoute() => _enqueue(_drawRouteNow);

  /// 내 위치 → 목적지(픽업 전 픽업지, 픽업 뒤 전달지) 직선. 위치를 모르면 긋지 않는다.
  Future<void> _drawLineNow() async {
    final map = _map;
    final route = widget.route;
    final me = _last;
    final target = route?.target;
    if (map == null || route == null || me == null || !mounted) return;
    if (target == null) {
      if (_line case final line?) await map.routeLayer.removeRoute(line);
      _line = null;
      return;
    }
    final points = [_at(me), _at(target)];
    if (_line case final line?) {
      await line.changePoint(points);
    } else {
      _line = await map.routeLayer.addRoute(points, await _style());
    }
  }

  /// 픽업·전달 핀(위에 예정시간)과 내 위치에서 목적지까지의 직선을 다시 그리고,
  /// 내 위치·두 핀이 다 보이게 카메라를 맞춘다. 늘 그 순간의 [widget.route] 로 그린다.
  Future<void> _drawRouteNow() async {
    final map = _map;
    if (map == null || !mounted) return;
    for (final p in _routePois) {
      await map.labelLayer.removePoi(p);
    }
    _routePois.clear();
    if (_line case final line?) await map.routeLayer.removeRoute(line);
    _line = null;
    final route = widget.route;
    if (route == null || !mounted) return;
    final l10n = AppLocalizations.of(context);
    final pickupAt = switch (route.pickup) {
      final p? => _at(p),
      null => null,
    };
    final dropAt = switch (route.drop) {
      final d? => _at(d),
      null => null,
    };
    await _drawLineNow();
    Future<kakao.Poi> pin(
      kakao.LatLng at,
      String label,
      Color color,
      String? time,
    ) async {
      final png = await _pinPng(
        label,
        color,
        caption: time == null ? null : l10n.pinEta,
        time: time,
      );
      // 아래 가운데(핀 끝)가 좌표에 닿는다.
      return map.labelLayer.addPoi(
        at,
        style: kakao.PoiStyle(
          icon: kakao.KImage.fromData(png.bytes, png.width, png.height),
        ),
      );
    }

    if (pickupAt != null) {
      _routePois.add(
        await pin(
          pickupAt,
          l10n.pinPickup,
          RiderColors.pickup,
          route.pickupTime,
        ),
      );
    }
    if (dropAt != null) {
      _routePois.add(
        await pin(dropAt, l10n.pinDrop, RiderColors.drop, route.dropTime),
      );
    }
    final fit = [?pickupAt, ?dropAt, if (_last case final me?) _at(me)];
    if (fit.isEmpty) return;
    await map.moveCamera(
      fit.length >= 2
          // 핀 위 "도착예상" 두 줄이 위쪽 가장자리에서 잘리지 않을 만큼 여백을 둔다.
          ? kakao.CameraUpdate.fitMapPoints(fit, padding: 260)
          : kakao.CameraUpdate.newCenterPosition(fit.first, zoomLevel: 15),
      animation: const kakao.CameraAnimation(300),
    );
  }

  /// 내 위치 점을 그 자리로 옮긴다(처음이면 만든다). 직선의 시작점도 따라 옮긴다.
  Future<void> _show(GeoPoint p) async {
    final map = _map;
    if (map == null || !mounted) return;
    _last = p;
    _lastKnownSpot = p;
    final position = kakao.LatLng(p.lat, p.lng);
    // 위치가 오면 직선 시작점을 옮긴다(그리기 줄에 넣어 경로 그리기와 겹치지 않게).
    unawaited(_drawLine());
    final me = _me;
    if (me != null) {
      await me.move(position, 300);
      return;
    }
    // 점을 만드는 중에 다음 위치가 오면 점이 둘 생겨, 하나는 처음 자리에 남았다 — 만드는 것은 한 번만.
    final creating = _meCreating ??= () async {
      final poi = await map.labelLayer.addPoi(
        position,
        style: kakao.PoiStyle(
          icon: kakao.KImage.fromData(await _dotPng(), 28, 28),
          anchor: const kakao.KPoint(0.5, 0.5),
        ),
      );
      _me = poi;
      return poi;
    }();
    final poi = await creating;
    // 만드는 동안 온 가장 새 위치로 옮긴다
    if (_last case final latest? when latest != p) {
      await poi.move(_at(latest), 300);
    }
  }

  Future<kakao.Poi>? _meCreating;

  Future<void> _center() async {
    final p = _last;
    if (p == null) return;
    await _map?.moveCamera(
      kakao.CameraUpdate.newCenterPosition(
        kakao.LatLng(p.lat, p.lng),
        zoomLevel: 16,
      ),
      animation: const kakao.CameraAnimation(300),
    );
  }

  /// 내 위치로 가기. 아직 위치를 못 받았으면 한 번 더 물어본다.
  Future<void> _locate() async {
    if (_last == null) {
      final here = await ref.read(locationSourceProvider)?.current();
      if (!mounted) return;
      if (here == null) {
        showRiderToast(
          context,
          AppLocalizations.of(context).locationUnavailable,
        );
        return;
      }
      await _show(here);
    }
    await _center();
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Positioned.fill(
        child: kakao.KakaoMap(
          option: kakao.KakaoMapOption(
            // 마지막으로 안 내 위치에서 연다(처음이면 기본 위치 — 서울 시청).
            position: _lastKnownSpot == null
                ? const kakao.LatLng(37.5665, 126.9780)
                : _at(_lastKnownSpot!),
            zoomLevel: 16,
          ),
          onMapReady: _onReady,
        ),
      ),
      // 지도가 자리를 잡을 때까지 지도 바탕색 덮개(새 지도의 흰 화면·카메라 튐을 가림).
      Positioned.fill(
        child: IgnorePointer(
          child: AnimatedOpacity(
            opacity: _ready ? 0 : 1,
            duration: const Duration(milliseconds: 160),
            child: const ColoredBox(color: Color(0xFFF2F1EC)),
          ),
        ),
      ),
      Align(
        alignment: const Alignment(-0.91, 0.33),
        child: Material(
          color: Colors.white,
          elevation: 3,
          borderRadius: BorderRadius.circular(22),
          child: InkWell(
            key: const ValueKey('locate-me'),
            borderRadius: BorderRadius.circular(22),
            onTap: _locate,
            child: const SizedBox(
              width: 44,
              height: 44,
              child: Icon(Icons.gps_fixed, size: 26, color: RiderColors.ink),
            ),
          ),
        ),
      ),
    ],
  );
}

/// 내 위치 점(파란 점 + 흰 테두리 + 옅은 원) PNG.
Future<Uint8List> _dotPng() async {
  const size = 84.0;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  const c = Offset(size / 2, size / 2);
  canvas
    ..drawCircle(
      c,
      40,
      Paint()..color = RiderColors.drop.withValues(alpha: 0.16),
    )
    ..drawCircle(c, 22, Paint()..color = Colors.white)
    ..drawCircle(c, 19, Paint()..color = _meBlue)
    ..drawPath(_arrowPath(c, 19), Paint()..color = Colors.white);
  final image = await recorder.endRecording().toImage(
    size.toInt(),
    size.toInt(),
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  return bytes!.buffer.asUint8List();
}

/// 선 위 진행 방향 화살표(흰 꺾쇠, 위쪽이 진행 방향) PNG.
Future<Uint8List> _chevronPng() async {
  const size = 30.0;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final path = Path()
    ..moveTo(size * 0.22, size * 0.70)
    ..lineTo(size * 0.50, size * 0.36)
    ..lineTo(size * 0.78, size * 0.70);
  canvas.drawPath(
    path,
    Paint()
      ..color = const Color(0xFF6E6E6E)
      ..style = PaintingStyle.stroke
      ..strokeWidth = size * 0.14
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round,
  );
  final image = await recorder.endRecording().toImage(
    size.toInt(),
    size.toInt(),
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  return bytes!.buffer.asUint8List();
}

const _pinW = 32.0;
// 사용자 2026-11-25 "핀 크기가 세로로 조금 긴 것 같아" — 42 → 38.
const _pinH = 38.0;

/// 경로 띠(회색 반투명)·내 위치 파랑 — 레퍼런스 색.
const _routeBand = Color(0x55808080);
const _meBlue = Color(0xFF1E6FE0);

/// 내 위치 원 안 흰 진행 화살표(오른쪽 위를 향한 삼각 화살).
Path _arrowPath(Offset c, double r) => Path()
  ..moveTo(c.dx - r * 0.38, c.dy - r * 0.5)
  ..lineTo(c.dx + r * 0.55, c.dy)
  ..lineTo(c.dx - r * 0.38, c.dy + r * 0.5)
  ..lineTo(c.dx - r * 0.18, c.dy)
  ..close();

/// 핀 위 예정시간 글씨(핀 색 + 흰 테두리, 배경 없음 — 레퍼런스 image 11).
TextSpan _etaSpan(String text, Color color, {required bool outline}) =>
    TextSpan(
      text: text,
      style: TextStyle(
        fontSize: 13,
        height: 1.15,
        fontWeight: FontWeight.w800,
        foreground: outline
            ? (Paint()
                ..style = PaintingStyle.stroke
                // 사용자 2026-11-25 "도착예상 시간 글자에 하얀 테두리도 너무 두껍다" — 3.5 → 2.
                ..strokeWidth = 2
                ..strokeJoin = StrokeJoin.round
                ..color = Colors.white)
            : null,
        color: outline ? null : color,
      ),
    );

/// 픽업·전달 핀 PNG(원 + 꼬리 + 흰 글씨) — [time] 이 있으면 그 위에 "도착예상 / 오후 6:48".
/// 화면 배율 3배로 그린다. 그림의 아래 가운데가 핀 끝이다.
Future<({Uint8List bytes, int width, int height})> _pinPng(
  String label,
  Color color, {
  String? caption,
  String? time,
}) async {
  const scale = 3.0;
  final lines = [?caption, ?time].join('\n');
  TextPainter eta({required bool outline}) => TextPainter(
    text: _etaSpan(lines, color, outline: outline),
    textAlign: TextAlign.center,
    textDirection: TextDirection.ltr,
  )..layout();
  final etaFill = lines.isEmpty ? null : eta(outline: false);
  final etaLine = lines.isEmpty ? null : eta(outline: true);
  final textW = (etaFill?.width ?? 0) + 6;
  final textH = etaFill == null ? 0.0 : etaFill.height + 2;
  final w = textW > _pinW ? textW : _pinW;
  final h = _pinH + textH;

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(scale);
  if (etaFill != null && etaLine != null) {
    final at = Offset((w - etaFill.width) / 2, 0);
    etaLine.paint(canvas, at);
    etaFill.paint(canvas, at);
  }
  canvas
    ..save()
    ..translate((w - _pinW) / 2, textH);
  _PinPainter(color).paint(canvas, const Size(_pinW, _pinH));
  final text = TextPainter(
    text: TextSpan(
      text: label,
      style: const TextStyle(
        color: Colors.white,
        fontSize: 12,
        fontWeight: FontWeight.w800,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  text.paint(
    canvas,
    Offset((_pinW - text.width) / 2, _pinW * 0.5 - text.height / 2),
  );
  canvas.restore();
  final image = await recorder.endRecording().toImage(
    (w * scale).ceil(),
    (h * scale).ceil(),
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  return (
    bytes: bytes!.buffer.asUint8List(),
    width: w.ceil(),
    height: h.ceil(),
  );
}

/// 약도(목·시험)용 핀. 지도 핀과 같은 모양으로 위에 예정시간을 띄운다.
class _Pin extends StatelessWidget {
  const _Pin({
    required this.label,
    required this.color,
    this.caption,
    this.time,
  });

  final String label;
  final Color color;
  final String? caption;
  final String? time;

  @override
  Widget build(BuildContext context) {
    final lines = time == null ? '' : [?caption, time].join('\n');
    return SizedBox(
      width: 100,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (lines.isNotEmpty)
            Stack(
              key: ValueKey('pin-eta-$label'),
              children: [
                Text.rich(
                  _etaSpan(lines, color, outline: true),
                  textAlign: TextAlign.center,
                ),
                Text.rich(
                  _etaSpan(lines, color, outline: false),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          SizedBox(
            width: _pinW,
            height: _pinH,
            child: CustomPaint(
              painter: _PinPainter(color),
              child: Align(
                // 글자는 둥근 머리 가운데(위에서 핀 폭의 절반)에.
                alignment: const Alignment(0, _pinW / _pinH - 1),
                child: Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PinPainter extends CustomPainter {
  _PinPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    // 물방울 핀(레퍼런스): 둥근 머리에서 곡선으로 좁아져 아래 끝이 뾰족하다. 흰 테두리.
    final w = size.width;
    final r = w / 2 - 1.5;
    final c = Offset(w / 2, r + 1.5);
    final tip = Offset(w / 2, size.height - 1);
    final drop = Path()
      ..moveTo(tip.dx, tip.dy)
      ..cubicTo(
        c.dx - r * 0.35,
        tip.dy - r * 0.55,
        c.dx - r,
        c.dy + r * 0.75,
        c.dx - r,
        c.dy,
      )
      ..arcToPoint(Offset(c.dx + r, c.dy), radius: Radius.circular(r))
      ..cubicTo(
        c.dx + r,
        c.dy + r * 0.75,
        c.dx + r * 0.35,
        tip.dy - r * 0.55,
        tip.dx,
        tip.dy,
      )
      ..close();
    canvas
      ..drawShadow(drop, Colors.black, 2, false)
      ..drawPath(
        drop,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3,
      )
      ..drawPath(drop, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_PinPainter old) => old.color != color;
}

class _MeDot extends StatelessWidget {
  const _MeDot();

  @override
  Widget build(BuildContext context) => Container(
    width: 28,
    height: 28,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: _meBlue.withValues(alpha: 0.16),
    ),
    alignment: Alignment.center,
    child: CustomPaint(size: const Size(22, 22), painter: _MeArrowPainter()),
  );
}

class _MeArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2;
    canvas
      ..drawCircle(c, r, Paint()..color = Colors.white)
      ..drawCircle(c, r - 1.5, Paint()..color = _meBlue)
      ..drawPath(_arrowPath(c, r - 1.5), Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// 약도의 내 위치 → 목적지 직선(비율 좌표).
class _RoutePainter extends CustomPainter {
  _RoutePainter(this.fromRatio, this.toRatio);

  final Offset fromRatio;
  final Offset toRatio;

  @override
  void paint(Canvas canvas, Size size) {
    final from = Offset(size.width * fromRatio.dx, size.height * fromRatio.dy);
    final to = Offset(size.width * toRatio.dx, size.height * toRatio.dy);
    canvas.drawLine(
      from,
      to,
      Paint()
        ..color = _routeBand
        ..strokeWidth = 16
        ..strokeCap = StrokeCap.round,
    );
    // 진행 방향 꺾쇠(24 간격)
    final d = to - from;
    final len = d.distance;
    if (len < 1) return;
    final u = d / len;
    final n = Offset(-u.dy, u.dx);
    final chev = Paint()
      ..color = const Color(0xFF6E6E6E)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (var t = 14.0; t < len - 10; t += 24) {
      final p = from + u * t;
      canvas.drawPath(
        Path()
          ..moveTo((p - u * 3 + n * 3.5).dx, (p - u * 3 + n * 3.5).dy)
          ..lineTo((p + u * 1.5).dx, (p + u * 1.5).dy)
          ..lineTo((p - u * 3 - n * 3.5).dx, (p - u * 3 - n * 3.5).dy),
        chev,
      );
    }
  }

  @override
  bool shouldRepaint(_RoutePainter old) =>
      old.fromRatio != fromRatio || old.toRatio != toRatio;
}

/// 약도 자리표시(강·큰길·골목·녹지). 실제 지형이 아니다.
class _SketchMapPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = const Color(0xFFF1F2F3),
    );

    final river = Path()
      ..moveTo(0, 0)
      ..lineTo(w * 0.78, 0)
      ..lineTo(w * 0.46, h * 0.20)
      ..lineTo(0, h * 0.34)
      ..close();
    canvas.drawPath(river, Paint()..color = const Color(0xFFB7D3EE));

    final green = Paint()..color = const Color(0xFFDCEBD3);
    canvas
      ..drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.52, h * 0.20, w * 0.48, h * 0.035),
          const Radius.circular(4),
        ),
        green,
      )
      ..drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.30, h * 0.66, w * 0.26, h * 0.12),
          const Radius.circular(18),
        ),
        green,
      );

    final road = Paint()
      ..color = Colors.white
      ..strokeCap = StrokeCap.round;
    // 골목 격자
    for (var i = 1; i < 9; i++) {
      final y = h * (0.26 + i * 0.085);
      canvas.drawLine(
        Offset(0, y),
        Offset(w, y + h * 0.03),
        road..strokeWidth = 5,
      );
    }
    for (var i = 0; i < 7; i++) {
      final x = w * (0.06 + i * 0.16);
      canvas.drawLine(
        Offset(x, h * 0.26),
        Offset(x + w * 0.05, h),
        road..strokeWidth = 5,
      );
    }
    // 큰길
    final main = Paint()
      ..color = const Color(0xFFF7E3A0)
      ..strokeWidth = 12
      ..strokeCap = StrokeCap.round;
    canvas
      ..drawLine(Offset(0, h * 0.37), Offset(w * 0.52, h * 0.20), main)
      ..drawLine(Offset(w * 0.52, h * 0.20), Offset(w, h * 0.03), main)
      ..drawLine(Offset(w * 0.08, h * 0.30), Offset(w * 0.84, h), main);
    // 큰 건물 터
    final block = Paint()..color = const Color(0xFFE6E8EA);
    for (final r in [
      Rect.fromLTWH(w * 0.56, h * 0.29, w * 0.20, h * 0.07),
      Rect.fromLTWH(w * 0.02, h * 0.50, w * 0.22, h * 0.09),
      Rect.fromLTWH(w * 0.62, h * 0.76, w * 0.30, h * 0.10),
    ]) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(r, const Radius.circular(6)),
        block,
      );
    }
  }

  @override
  bool shouldRepaint(_SketchMapPainter old) => false;
}
