import 'package:flutter_test/flutter_test.dart';

import 'package:customer_app/features/orders/presentation/tracking_map.dart';

/// 배송 현황 지도: 라이더·집 마커가 아래 시트(화면 45%)에 가려지지 않게 맞출 범위.
void main() {
  test('실제 점들은 맞출 범위의 위쪽 55% 안에 들어온다', () {
    const rider = (lat: 35.1500, lng: 129.0600);
    const home = (lat: 35.1565, lng: 129.0665);
    final pts = visibleFitPoints([rider, home], 0.45);
    final lats = pts.map((p) => p.lat);
    final top = lats.reduce((a, b) => a > b ? a : b);
    final bottom = lats.reduce((a, b) => a < b ? a : b);
    final visibleBottom = top - (top - bottom) * 0.55;
    // 두 마커 모두 시트 위 영역(맞출 범위의 위 55%)에 있다.
    expect(rider.lat, greaterThanOrEqualTo(visibleBottom - 1e-9));
    expect(home.lat, greaterThanOrEqualTo(visibleBottom - 1e-9));
    // 경도 범위는 실제 점들을 덮는다.
    final lngs = pts.map((p) => p.lng);
    expect(lngs.reduce((a, b) => a < b ? a : b), lessThanOrEqualTo(129.0600));
    expect(
      lngs.reduce((a, b) => a > b ? a : b),
      greaterThanOrEqualTo(129.0665),
    );
  });

  test('점이 하나면 약 300m 폭으로 넓혀 너무 확대하지 않고, 그래도 시트 위에 둔다', () {
    const home = (lat: 35.1565, lng: 129.0665);
    final pts = visibleFitPoints([home], 0.45);
    final lats = pts.map((p) => p.lat);
    final top = lats.reduce((a, b) => a > b ? a : b);
    final bottom = lats.reduce((a, b) => a < b ? a : b);
    expect(top - bottom, greaterThan(0.003));
    expect(home.lat, greaterThan(top - (top - bottom) * 0.55));
  });
}
