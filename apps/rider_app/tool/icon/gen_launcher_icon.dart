// 픽라이더 앱 아이콘 만들기(사용자 2026-11-19 로고 — 두 번째 안, 스쿠터 P). 원본: tool/icon/pick_rider_icon.webp
// 실행(이 앱 밖 임시 프로젝트에서 package:image 로): dart run gen_launcher_icon.dart <원본> <android/app/src/main/res>
// - mipmap-*/ic_launcher.png: 원본 그대로(둥근 사각, 모서리 투명) — Android 7 이하·둥근 아이콘 없는 런처.
// - mipmap-*/ic_launcher_foreground.png + mipmap-anydpi-v26/ic_launcher.xml: 적응형 아이콘. 런처가 모양(원·둥근 사각)을
//   잘라 쓰므로 투명 모서리를 안쪽 색으로 채운 정사각을 보이는 영역(108dp 중 가운데 72dp)에 꽉 채운다.
import 'dart:io';

import 'package:image/image.dart' as img;

void main(List<String> args) {
  final src = img.decodeImage(File(args[0]).readAsBytesSync())!;
  final res = args[1];
  final side = src.width > src.height ? src.width : src.height;
  final square = img.copyResize(src, width: side, height: side, interpolation: img.Interpolation.cubic);

  // 투명 모서리 → 가운데 쪽으로 걸어가 처음 만나는 불투명 색으로 채운다.
  final filled = img.Image.from(square);
  final c = side / 2;
  for (var y = 0; y < side; y++) {
    for (var x = 0; x < side; x++) {
      final here = square.getPixel(x, y);
      if (here.a > 250) {
        filled.setPixelRgba(x, y, here.r, here.g, here.b, 255); // 거의 불투명(253 등)도 꽉 채운다
        continue;
      }
      var fx = x.toDouble(), fy = y.toDouble();
      final dx = (c - x) / side * 4, dy = (c - y) / side * 4;
      img.Pixel p = square.getPixel(x, y);
      while (p.a <= 250) {
        fx += dx;
        fy += dy;
        p = square.getPixel(fx.round().clamp(0, side - 1), fy.round().clamp(0, side - 1));
      }
      filled.setPixelRgba(x, y, p.r, p.g, p.b, 255);
    }
  }

  // 원본 가장자리의 투명 여백·밝은 테두리가 적응형 아이콘에 비치지 않게 바깥 5% 를 잘라 낸다(그림은 가운데에 있어 안 잘린다).
  final cut = (side * 0.05).round();
  final edgeless = img.copyCrop(filled, x: cut, y: cut, width: side - 2 * cut, height: side - 2 * cut);

  const dens = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0};
  dens.forEach((name, k) {
    final dir = '$res/mipmap-$name';
    final legacy = img.copyResize(square, width: (48 * k).round(), interpolation: img.Interpolation.average);
    File('$dir/ic_launcher.png').writeAsBytesSync(img.encodePng(legacy));
    final canvas = (108 * k).round(), inner = (72 * k).round();
    final fg = img.Image(width: canvas, height: canvas, numChannels: 4);
    final art = img.copyResize(edgeless, width: inner, interpolation: img.Interpolation.average);
    img.compositeImage(fg, art, dstX: (canvas - inner) ~/ 2, dstY: (canvas - inner) ~/ 2);
    File('$dir/ic_launcher_foreground.png').writeAsBytesSync(img.encodePng(fg));
  });
}
