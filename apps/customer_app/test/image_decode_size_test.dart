import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:customer_app/features/catalog/presentation/widgets/content_image.dart';
import 'package:customer_app/features/catalog/presentation/widgets/product_tile_card.dart';
import 'package:customer_app/shared/providers.dart';

/// 백엔드 요청 2026-11-19(상품 상세 느림): 서버 이미지(1080×2000)를 원본으로 풀지 않고 그릴 크기 × 화소 비율로만 디코딩한다.
void main() {
  Future<Image> pumpImage(WidgetTester t, Widget child) async {
    t.view
      ..physicalSize = const Size(1080, 2400)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        overrides: [
          imageOriginProvider.overrideWithValue('https://img.invalid'),
        ],
        child: MaterialApp(home: Scaffold(body: child)),
      ),
    );
    return t.widget<Image>(find.byType(Image));
  }

  int? decodeWidth(Image image) => switch (image.image) {
    final ResizeImage r => r.width,
    _ => null,
  };

  testWidgets('설명 이미지는 화면 폭(360dp) × 3 = 1080px 로 디코딩', (t) async {
    final image = await pumpImage(
      t,
      const ContentImage(url: '/content-images/a'),
    );
    expect(decodeWidth(image), 1080);
  });

  testWidgets('목록 카드 사진(72dp)은 216px 로 — 원본 크기로 풀지 않는다', (t) async {
    final image = await pumpImage(
      t,
      const Center(child: ProductImage(url: '/content-images/a')),
    );
    expect(decodeWidth(image), 216);
  });
}
