import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart' as kakao;

import '../../../l10n/gen/app_localizations.dart';
import '../../address/presentation/map_pick_screen.dart'
    show GeoPoint, mapAvailableProvider;

/// 배송현황 지도(레퍼런스 8-5 "배달중 — 라이더 마커, 이동"). 라이더 마커와 내 배송지 마커만 그린다.
///
/// - [rider] 는 서버가 준 라이더 지금 위치(`DeliveryEta.riderLocation` — SSE `ETA_UPDATED` 로 받는다,
///   PC 5 요청 2026-11-19 `clients/all/2026-11-19-notice-live-rider-location.md`). 바뀌면 마커가 [glide] 동안
///   새 자리로 미끄러져 간다. null 이면 라이더 마커를 숨긴다(서버가 주지 않으면 지어내지 않는다).
/// - [riderStale] 이면(서버가 받은 지 60초 넘음) 마커를 흐리게 한다.
/// - [home] 은 주문 당시 배송지 지도 핀(`ShippingAddress.geo`). 없으면 그리지 않는다.
/// - 출발지(MFC)는 고객이 받을 길이 계약에 없어 그리지 않는다(사용자 2026-11-19 "빼고 요청도 안 함").
/// - 지나온 길은 서버가 주지 않아 그리지 않는다.
///
/// 지도 가운데는 [rider] → [home]. 둘 다 아직 없으면(주문·주소 변환을 읽는 중) "지도 위치를 확인하고 있어요" 칸.
/// 카카오 지도는 실서버·키가 있을 때만([mapAvailableProvider]). 목·시험·키 없음이면 지도 대신 안내 칸.
class TrackingMap extends ConsumerStatefulWidget {
  const TrackingMap({
    super.key,
    required this.rider,
    this.home,
    this.riderStale = false,
  });

  final GeoPoint? rider;
  final GeoPoint? home;
  final bool riderStale;

  /// 마커가 이전 점에서 새 점으로 움직이는 시간.
  static const glide = Duration(seconds: 1);

  /// 지도 아래를 덮는 시트 높이(화면 비율 — [TrackMapLayout] 의 처음 크기와 같게). 마커는 그 위에 맞춘다.
  static const sheetFraction = 0.45;

  @override
  ConsumerState<TrackingMap> createState() => _TrackingMapState();
}

class _TrackingMapState extends ConsumerState<TrackingMap> {
  kakao.KakaoMapController? _map;
  kakao.Poi? _riderPoi;
  kakao.PoiStyle? _riderStyle;
  kakao.PoiStyle? _riderDimStyle;
  kakao.PoiStyle? _homeStyle;
  kakao.Poi? _homePoi;
  bool? _shownStale;

  /// 카메라를 맞춘 적이 있는지·그때 라이더가 있었는지. 처음 한 번 + 라이더가 처음 나타날 때 한 번만 맞춘다 —
  /// 그 뒤 위치가 오가거나(구독 끊김·서버가 잠깐 비움) 움직여도 카메라는 그대로(사용자 2026-11-19 "지도가 다른 위치로 튐").
  bool _fitted = false;
  bool _fittedWithRider = false;

  /// 한 번 그린 지도의 시작 위치. 위치를 잠깐 둘 다 모르게 돼도 지도를 다시 만들지 않는다.
  GeoPoint? _start;

  static kakao.LatLng _ll(GeoPoint p) => kakao.LatLng(p.lat, p.lng);

  Future<void> _onReady(kakao.KakaoMapController map) async {
    final scheme = Theme.of(context).colorScheme;
    final riderIcon = await kakao.KImage.fromWidget(
      RiderMarker(color: scheme.primary),
      RiderMarker.size,
      context: context,
    );
    if (!mounted) return;
    final riderDimIcon = await kakao.KImage.fromWidget(
      const RiderMarker(color: Color(0xFF9E9EA6), stale: true),
      RiderMarker.size,
      context: context,
    );
    if (!mounted) return;
    final homeIcon = await kakao.KImage.fromWidget(
      const HomeMarker(),
      HomeMarker.size,
      context: context,
    );
    if (!mounted) return;
    const center = kakao.KPoint(0.5, 0.5);
    _riderStyle = kakao.PoiStyle(icon: riderIcon, anchor: center);
    _riderDimStyle = kakao.PoiStyle(icon: riderDimIcon, anchor: center);
    _homeStyle = kakao.PoiStyle(
      icon: homeIcon,
      anchor: const kakao.KPoint(0.5, 1),
    );
    _map = map;
    await _syncHome();
    await _syncRider(animate: false);
    await _fit();
  }

  /// 내 배송지 마커 — 주문·주소 변환이 늦게 와도 그때 그린다.
  Future<void> _syncHome() async {
    final map = _map;
    final style = _homeStyle;
    final home = widget.home;
    if (map == null || style == null || home == null) return;
    final poi = _homePoi;
    if (poi == null) {
      _homePoi = await map.labelLayer.addPoi(_ll(home), style: style);
    } else {
      await poi.move(_ll(home));
    }
  }

  /// 라이더 마커를 지금 값에 맞춘다 — 없으면 숨김, 처음이면 만들기, 있으면 미끄러지듯 옮기기, 오래됨이면 흐리게.
  Future<void> _syncRider({bool animate = true}) async {
    final map = _map;
    final normal = _riderStyle;
    final dim = _riderDimStyle;
    if (map == null || normal == null || dim == null) return;
    final rider = widget.rider;
    final poi = _riderPoi;
    if (rider == null) {
      await poi?.hide();
      return;
    }
    final style = widget.riderStale ? dim : normal;
    if (poi == null) {
      _riderPoi = await map.labelLayer.addPoi(
        _ll(rider),
        style: style,
        rank: 1,
      );
      _shownStale = widget.riderStale;
      return;
    }
    if (!poi.visible) await poi.show();
    if (_shownStale != widget.riderStale) {
      await poi.changeStyles(style);
      _shownStale = widget.riderStale;
    }
    await poi.move(
      _ll(rider),
      animate ? TrackingMap.glide.inMilliseconds : null,
    );
  }

  /// 라이더와 배송지가 함께 보이게 맞춘다(하나만 있으면 그 가운데).
  Future<void> _fit() async {
    final map = _map;
    final points = [?widget.rider, ?widget.home];
    if (map == null || points.isEmpty) return;
    final withRider = widget.rider != null;
    if (_fitted && (_fittedWithRider || !withRider)) return;
    _fitted = true;
    _fittedWithRider = withRider;
    await map.moveCamera(
      kakao.CameraUpdate.fitMapPoints([
        for (final p in visibleFitPoints(points, TrackingMap.sheetFraction))
          _ll(p),
      ], padding: 60),
    );
  }

  @override
  void didUpdateWidget(TrackingMap old) {
    super.didUpdateWidget(old);
    final moved = old.rider != widget.rider;
    if (moved || old.riderStale != widget.riderStale) {
      _syncRider();
    }
    if (old.home != widget.home) _syncHome();
    // 카메라는 [_fit] 이 정한 때(처음·라이더가 처음 나타날 때)만 — 나머지는 마커만 움직이거나 숨긴다.
    if (old.rider == null && widget.rider != null) _fit();
  }

  @override
  Widget build(BuildContext context) {
    final start = _start ??= widget.rider ?? widget.home;
    if (start == null) {
      // 지도 가운데를 아직 모른다(주문·주소 변환을 읽는 중, 또는 둘 다 없음) — 위치를 지어내지 않는다.
      final theme = Theme.of(context);
      return Container(
        key: const ValueKey('track-map-pending'),
        color: theme.colorScheme.surfaceContainerHighest,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(24),
        child: Text(
          AppLocalizations.of(context).trackMapPending,
          textAlign: TextAlign.center,
        ),
      );
    }
    if (!ref.watch(mapAvailableProvider)) {
      final theme = Theme.of(context);
      return Container(
        key: const ValueKey('track-map-unavailable'),
        color: theme.colorScheme.surfaceContainerHighest,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(24),
        child: Text(
          AppLocalizations.of(context).trackMapUnavailable,
          textAlign: TextAlign.center,
        ),
      );
    }
    return kakao.KakaoMap(
      key: const ValueKey('track-map'),
      option: kakao.KakaoMapOption(position: _ll(start), zoomLevel: 16),
      onMapReady: _onReady,
    );
  }
}

/// 라이더 마커: 브랜드색 옅은 원(후광) 위 흰 원판 + 그림자, 안에 채운 오토바이. 오래된 위치면 회색·흐리게.
class RiderMarker extends StatelessWidget {
  const RiderMarker({super.key, required this.color, this.stale = false});

  final Color color;
  final bool stale;

  static const size = Size(64, 64);

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: stale ? 0.6 : 1,
    child: SizedBox.fromSize(
      size: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.18),
              shape: BoxShape.circle,
            ),
          ),
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: color, width: 2.5),
              boxShadow: const [
                BoxShadow(
                  blurRadius: 8,
                  offset: Offset(0, 2),
                  color: Color(0x33000000),
                ),
              ],
            ),
            alignment: Alignment.center,
            child: ScooterGlyph(size: 28, color: color),
          ),
        ],
      ),
    ),
  );
}

/// 내 배송지 마커: 진한 물방울 핀(아래 끝이 배송지) 안에 흰 집, 땅에 작은 그림자.
class HomeMarker extends StatelessWidget {
  const HomeMarker({super.key});

  static const size = Size(48, 60);

  @override
  Widget build(BuildContext context) => SizedBox.fromSize(
    size: size,
    child: CustomPaint(painter: _HomePinPainter()),
  );
}

class _HomePinPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    // 땅 그림자
    canvas.drawOval(
      Rect.fromCenter(center: Offset(w / 2, h - 3), width: 16, height: 5),
      Paint()..color = const Color(0x33000000),
    );
    // 물방울 핀(원 + 아래 뾰족)
    const r = 19.0;
    final c = Offset(w / 2, r + 2);
    final pin = Path()
      ..moveTo(w / 2, h - 4)
      ..quadraticBezierTo(w / 2 - 9, c.dy + r * 0.85, c.dx - r, c.dy)
      ..arcToPoint(Offset(c.dx + r, c.dy), radius: const Radius.circular(r))
      ..quadraticBezierTo(w / 2 + 9, c.dy + r * 0.85, w / 2, h - 4)
      ..close();
    canvas
      ..drawShadow(pin, Colors.black, 3, false)
      ..drawPath(pin, Paint()..color = const Color(0xFF1B1B1F));
    // 흰 집(지붕 + 몸통, 문은 비움)
    final house = Path()
      ..moveTo(c.dx, c.dy - 9)
      ..lineTo(c.dx + 9, c.dy - 1)
      ..lineTo(c.dx + 6.5, c.dy - 1)
      ..lineTo(c.dx + 6.5, c.dy + 8)
      ..lineTo(c.dx + 2, c.dy + 8)
      ..lineTo(c.dx + 2, c.dy + 3)
      ..lineTo(c.dx - 2, c.dy + 3)
      ..lineTo(c.dx - 2, c.dy + 8)
      ..lineTo(c.dx - 6.5, c.dy + 8)
      ..lineTo(c.dx - 6.5, c.dy - 1)
      ..lineTo(c.dx - 9, c.dy - 1)
      ..close();
    canvas.drawPath(house, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_HomePinPainter oldDelegate) => false;
}

/// 채운 배달 오토바이(짐 상자·안장·몸통·앞 기둥·손잡이·두 바퀴). 마커·시트 그림·지금 단계에 같이 쓴다.
class ScooterGlyph extends StatelessWidget {
  const ScooterGlyph({super.key, required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CustomPaint(painter: _ScooterPainter(color)),
  );
}

class _ScooterPainter extends CustomPainter {
  const _ScooterPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    final fill = Paint()..color = color;
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2
      ..strokeCap = StrokeCap.round;
    // 짐 상자
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(2.6, 4.4, 7.8, 6.2),
        const Radius.circular(1.4),
      ),
      fill,
    );
    // 안장 + 뒤 몸통
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(4, 11.4, 9.2, 4.2),
        const Radius.circular(2),
      ),
      fill,
    );
    // 발판에서 앞 기둥으로
    canvas.drawPath(
      Path()
        ..moveTo(12, 15.6)
        ..lineTo(15.6, 15.6)
        ..lineTo(17.2, 7.6),
      stroke,
    );
    // 손잡이
    canvas.drawLine(const Offset(15.4, 7), const Offset(19.4, 7), stroke);
    // 앞 바퀴 축
    canvas.drawLine(const Offset(17.2, 7.6), const Offset(19, 17.6), stroke);
    // 바퀴(흰 축)
    final hub = Paint()..color = Colors.white;
    for (final x in const [6.4, 19.0]) {
      canvas
        ..drawCircle(Offset(x, 18), 3.4, fill)
        ..drawCircle(Offset(x, 18), 1.2, hub);
    }
  }

  @override
  bool shouldRepaint(_ScooterPainter old) => old.color != color;
}

/// 아래 시트에 가려지지 않게 맞출 점들. 실제 점들의 남북 폭 아래로 [sheetFraction] 만큼 빈 점을 하나 더해,
/// 화면 전체에 맞춰도 실제 점들은 시트 위(1 - sheetFraction) 영역에 들어오게 한다(사용자 2026-11-19 "두 마커가 가려지지 않게").
/// 점이 하나거나 아주 가까우면 약 300m 폭으로 넓혀 너무 확대되지 않게 한다. 좌표를 지어내는 게 아니라 카메라 범위만 정한다.
List<GeoPoint> visibleFitPoints(List<GeoPoint> points, double sheetFraction) {
  const minSpan = 0.003;
  var minLat = points.first.lat, maxLat = points.first.lat;
  var minLng = points.first.lng, maxLng = points.first.lng;
  for (final p in points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (maxLat - minLat < minSpan) {
    final mid = (maxLat + minLat) / 2;
    minLat = mid - minSpan / 2;
    maxLat = mid + minSpan / 2;
  }
  if (maxLng - minLng < minSpan) {
    final mid = (maxLng + minLng) / 2;
    minLng = mid - minSpan / 2;
    maxLng = mid + minSpan / 2;
  }
  final span = maxLat - minLat;
  final visible = 1 - sheetFraction;
  return [
    (lat: maxLat, lng: minLng),
    (lat: maxLat, lng: maxLng),
    (lat: minLat, lng: minLng),
    (lat: minLat, lng: maxLng),
    // 시트가 덮는 만큼 아래로 늘린 빈 점.
    (
      lat: minLat - span * (sheetFraction / visible),
      lng: (minLng + maxLng) / 2,
    ),
  ];
}
