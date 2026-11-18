import 'dart:async';
import 'dart:io' show Platform;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart' as kakao;

import '../l10n/gen/app_localizations.dart';
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

class _LiveMapState extends ConsumerState<_LiveMap> {
  kakao.KakaoMapController? _map;
  kakao.Poi? _me;
  GeoPoint? _last;
  StreamSubscription<GeoPoint>? _sub;
  final _routePois = <kakao.Poi>[];
  kakao.Route? _line;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _LiveMap old) {
    super.didUpdateWidget(old);
    if (old.route != widget.route) unawaited(_drawRoute());
  }

  Future<void> _onReady(kakao.KakaoMapController controller) async {
    _map = controller;
    final source = ref.read(locationSourceProvider);
    // 직선은 내 위치에서 시작하므로 위치를 먼저 잡고 경로를 그린다.
    final here = await source?.current();
    if (!mounted) return;
    if (here != null) await _show(here);
    await _drawRoute();
    // 경로가 있으면 경로가 다 보이게 둔다(내 위치로 옮기지 않는다).
    if (widget.route == null) await _center();
    if (source != null) _sub = source.watch().listen(_show);
  }

  static kakao.LatLng _at(GeoPoint p) => kakao.LatLng(p.lat, p.lng);

  kakao.RouteStyle? _lineStyle;

  /// 레퍼런스(image 11): 주황 굵은 선 + 흰 테두리 + 진행 방향 화살표(›) 무늬.
  Future<kakao.RouteStyle> _style() async => _lineStyle ??= kakao.RouteStyle(
    RiderColors.pickup,
    9,
    strokeColor: Colors.white,
    strokeWidth: 2,
    pattern: kakao.RoutePattern(
      kakao.KImage.fromData(await _chevronPng(), 10, 10),
      22,
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
    final position = kakao.LatLng(p.lat, p.lng);
    // 위치가 오면 직선 시작점을 옮긴다(그리기 줄에 넣어 경로 그리기와 겹치지 않게).
    unawaited(_drawLine());
    final me = _me;
    if (me != null) {
      await me.move(position, 300);
      return;
    }
    _me = await map.labelLayer.addPoi(
      position,
      style: kakao.PoiStyle(
        icon: kakao.KImage.fromData(await _dotPng(), 28, 28),
        anchor: const kakao.KPoint(0.5, 0.5),
      ),
    );
  }

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
          option: const kakao.KakaoMapOption(
            // 위치를 받기 전 기본 위치(서울 시청)
            position: kakao.LatLng(37.5665, 126.9780),
            zoomLevel: 15,
          ),
          onMapReady: _onReady,
        ),
      ),
      Align(
        alignment: const Alignment(-0.92, -0.1),
        child: Material(
          color: Colors.white,
          elevation: 3,
          borderRadius: BorderRadius.circular(6),
          child: InkWell(
            key: const ValueKey('locate-me'),
            borderRadius: BorderRadius.circular(6),
            onTap: _locate,
            child: const SizedBox(
              width: 44,
              height: 44,
              child: Icon(Icons.my_location, color: RiderColors.ink),
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
      Paint()..color = RiderColors.drop.withValues(alpha: 0.2),
    )
    ..drawCircle(c, 22, Paint()..color = Colors.white)
    ..drawCircle(c, 17, Paint()..color = RiderColors.drop);
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
      ..color = Colors.white
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

const _pinW = 28.0;
const _pinH = 34.0;

/// 핀 위 예정시간 글씨(핀 색 + 흰 테두리, 배경 없음 — 레퍼런스 image 11).
TextSpan _etaSpan(String text, Color color, {required bool outline}) =>
    TextSpan(
      text: text,
      style: TextStyle(
        fontSize: 11,
        height: 1.15,
        fontWeight: FontWeight.w800,
        foreground: outline
            ? (Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = 3.0
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
        fontSize: 10,
        fontWeight: FontWeight.w700,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  text.paint(
    canvas,
    Offset((_pinW - text.width) / 2, (_pinW - text.height) / 2),
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
              child: Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Center(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
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
    // 크기에 비례(원 반지름 r, 꼬리는 원 아래쪽에서 핀 끝까지).
    final r = size.width / 2;
    final paint = Paint()..color = color;
    final tail = Path()
      ..moveTo(r - r * 0.42, r + r * 0.63)
      ..lineTo(r, size.height)
      ..lineTo(r + r * 0.42, r + r * 0.63)
      ..close();
    canvas
      ..drawPath(tail, paint)
      ..drawCircle(Offset(r, r), r, paint);
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
      color: RiderColors.drop.withValues(alpha: 0.18),
    ),
    alignment: Alignment.center,
    child: Container(
      width: 14,
      height: 14,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: RiderColors.drop,
        border: Border.all(color: Colors.white, width: 2),
      ),
    ),
  );
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
    canvas
      ..drawLine(
        from,
        to,
        Paint()
          ..color = Colors.white
          ..strokeWidth = 12
          ..strokeCap = StrokeCap.round,
      )
      ..drawLine(
        from,
        to,
        Paint()
          ..color = RiderColors.pickup
          ..strokeWidth = 8
          ..strokeCap = StrokeCap.round,
      );
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
