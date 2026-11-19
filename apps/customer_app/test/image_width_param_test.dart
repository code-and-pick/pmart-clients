import 'package:flutter_test/flutter_test.dart';

import 'package:customer_app/shared/providers.dart';

/// product-content 0.3.0 서버 축소 이미지 `?w=`(240·480·720) — 백엔드 요청 2026-11-19 상세 속도 R3.
void main() {
  const img = '/api/v1/content-images/IMG-1';

  test('그릴 폭(물리 화소)에 맞는 가장 작은 값, 넘으면 720', () {
    expect(withImageWidth(img, 216), '$img?w=240');
    expect(withImageWidth(img, 240), '$img?w=240');
    expect(withImageWidth(img, 400), '$img?w=480');
    expect(withImageWidth(img, 1080), '$img?w=720');
  });

  test('콘텐츠 이미지가 아니거나 이미 쿼리가 있으면 그대로', () {
    expect(
      withImageWidth('https://cdn.example/a.jpg', 300),
      'https://cdn.example/a.jpg',
    );
    expect(withImageWidth('$img?w=480', 300), '$img?w=480');
    expect(withImageWidth(null, 300), isNull);
  });
}
