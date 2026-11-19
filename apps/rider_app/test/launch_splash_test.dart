// 시작 화면(사용자 2026-11-19 "로딩 중에 뜨는 화면 … 이 화면으로") — 전체 그림·보라 바탕.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/shared/launch_splash.dart';

void main() {
  testWidgets('시작 화면은 그림을 화면 가득(cover) 보라 바탕 위에 그린다', (t) async {
    await t.pumpWidget(const PickRiderSplash());
    final image = t.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.cover);
    expect(
      (image.image as AssetImage).assetName,
      'assets/splash/pick_rider_splash.jpg',
    );
    expect(
      t.widget<ColoredBox>(find.byType(ColoredBox)).color,
      pickRiderSplashColor,
    );
  });
}
