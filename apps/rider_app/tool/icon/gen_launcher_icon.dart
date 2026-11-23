// 픽라이더 앱 아이콘 만들기(사용자 2026-11-24 로고 — 보라 둥근 사각에 흰 "P라이더"·번개 줄). 원본: tool/icon/pick_rider_icon.png
// (받은 그림이 흰 바탕이라 네 모서리에서 이어진 밝은 픽셀만 투명으로 바꾼 PNG 를 원본으로 둔다.)
// 실행(이 앱 밖 임시 프로젝트에서 package:image 로): dart run gen_launcher_icon.dart <원본> <android/app/src/main/res>
// - mipmap-*/ic_launcher.png: 정리한 그림에 둥근 사각(반지름 22%)을 새로 씌움 — 적응형을 안 쓰는 런처.
// - mipmap-*/ic_launcher_foreground.png + mipmap-anydpi-v26/ic_launcher.xml: 적응형 아이콘. 런처가 모양(원·둥근 사각)을
//   잘라 쓰므로 투명 모서리를 안쪽 색으로 채운 정사각을 보이는 영역(108dp 중 가운데 72dp)에 꽉 채운다.
import 'dart:io';
import 'dart:math' as math;

import 'package:image/image.dart' as img;

void main(List<String> args) {
  final src = _clearOutsideOwnShape(
    _clearDarkCorners(
      img.decodeImage(File(args[0]).readAsBytesSync())!.convert(numChannels: 4),
    ),
  );
  final res = args[1];
  final side = src.width > src.height ? src.width : src.height;
  final square = img.copyResize(
    src,
    width: side,
    height: side,
    interpolation: img.Interpolation.cubic,
  );

  // 투명 모서리 → 가운데 쪽으로 걸어가 처음 만나는 불투명 색으로 채운다.
  final filled = img.Image.from(square);
  final c = side / 2;
  for (var y = 0; y < side; y++) {
    for (var x = 0; x < side; x++) {
      final here = square.getPixel(x, y);
      if (here.a > 250) {
        filled.setPixelRgba(
          x,
          y,
          here.r,
          here.g,
          here.b,
          255,
        ); // 거의 불투명(253 등)도 꽉 채운다
        continue;
      }
      var fx = x.toDouble(), fy = y.toDouble();
      final dx = (c - x) / side * 4, dy = (c - y) / side * 4;
      img.Pixel p = square.getPixel(x, y);
      while (p.a <= 250) {
        fx += dx;
        fy += dy;
        p = square.getPixel(
          fx.round().clamp(0, side - 1),
          fy.round().clamp(0, side - 1),
        );
      }
      filled.setPixelRgba(x, y, p.r, p.g, p.b, 255);
    }
  }

  // 원본 가장자리의 투명 여백·밝은 테두리가 적응형 아이콘에 비치지 않게 바깥 5% 를 잘라 낸다(그림은 가운데에 있어 안 잘린다).
  final cut = (side * 0.05).round();
  final edgeless = img.copyCrop(
    filled,
    x: cut,
    y: cut,
    width: side - 2 * cut,
    height: side - 2 * cut,
  );

  // 일반 아이콘: 원본 가장자리(투명 여백·잡티)를 쓰지 않고, 정리한 정사각에 둥근 사각 모양을 새로 씌운다(반지름 22%).
  final rounded = _roundedSquare(edgeless, 0.22);

  const dens = {
    'mdpi': 1.0,
    'hdpi': 1.5,
    'xhdpi': 2.0,
    'xxhdpi': 3.0,
    'xxxhdpi': 4.0,
  };
  dens.forEach((name, k) {
    final dir = '$res/mipmap-$name';
    final legacy = img.copyResize(
      rounded,
      width: (48 * k).round(),
      interpolation: img.Interpolation.average,
    );
    File('$dir/ic_launcher.png').writeAsBytesSync(img.encodePng(legacy));
    // 그림을 보이는 영역(72dp)에 그대로 맞춘다 — 런처가 씌우는 모양이 그림의 둥근 사각과 거의 같아 받은 그림처럼 보이고
    // 글자 비율도 그대로다(사용자 2026-11-24 "그림이랑 글자 크기 그대로"). 줄여 두면 그림 둘레에 네모 경계가 비쳤다.
    // (예전 헬멧 로고는 고리가 그림 끝까지 닿아 78% 로 줄였었다 — 2026-11-21.)
    final canvas = (108 * k).round(), inner = (72 * k).round();
    final fg = img.Image(width: canvas, height: canvas, numChannels: 4);
    final art = img.copyResize(
      edgeless,
      width: inner,
      interpolation: img.Interpolation.average,
    );
    final off = (canvas - inner) ~/ 2;
    // 바깥: 가장자리 색을 줄마다 늘이면 그라데이션·번개 끝이 줄무늬로 번졌다(2026-11-24 새 로고) —
    // 그림의 보라(흰 글자 빼고)를 평면 기울기로 맞춘 색을 바깥에 칠하고, 그림 가장자리 6% 는 그 색과 섞어 경계를 없앤다.
    final plane = _fitPlane(art);
    final feather = inner * 0.06;
    for (var y = 0; y < canvas; y++) {
      for (var x = 0; x < canvas; x++) {
        final ax = x - off, ay = y - off;
        final u = (ax + 0.5) / inner, v = (ay + 0.5) / inner;
        final bg = plane(u, v);
        final inside = ax >= 0 && ay >= 0 && ax < inner && ay < inner;
        if (!inside) {
          fg.setPixelRgba(x, y, bg.$1, bg.$2, bg.$3, 255);
          continue;
        }
        final edge = [ax, ay, inner - 1 - ax, inner - 1 - ay].reduce(math.min);
        final t = (edge / feather).clamp(0.0, 1.0);
        final p = art.getPixel(ax, ay);
        fg.setPixelRgba(
          x,
          y,
          (bg.$1 + (p.r - bg.$1) * t).round(),
          (bg.$2 + (p.g - bg.$2) * t).round(),
          (bg.$3 + (p.b - bg.$3) * t).round(),
          255,
        );
      }
    }
    File('$dir/ic_launcher_foreground.png').writeAsBytesSync(img.encodePng(fg));
  });
}

/// 원본 둥근 사각 바깥 모서리가 투명이 아니라 검정으로 칠해져 온 경우(2026-11-20 네 번째 안) — 네 모서리에서
/// 이어진 어두운 픽셀만 투명으로 바꾼다. 그림 안쪽의 어두운 색은 모서리와 이어지지 않으면 그대로 둔다.
img.Image _clearDarkCorners(img.Image src) {
  bool dark(img.Pixel p) => p.a > 0 && p.r < 60 && p.g < 60 && p.b < 60;
  final w = src.width, h = src.height;
  final seen = List<bool>.filled(w * h, false);
  final stack = <int>[0, w - 1, (h - 1) * w, (h - 1) * w + w - 1];
  while (stack.isNotEmpty) {
    final i = stack.removeLast();
    if (seen[i]) continue;
    seen[i] = true;
    final x = i % w, y = i ~/ w;
    final p = src.getPixel(x, y);
    if (!dark(p) && p.a > 0) continue;
    p.a = 0;
    if (x > 0) stack.add(i - 1);
    if (x < w - 1) stack.add(i + 1);
    if (y > 0) stack.add(i - w);
    if (y < h - 1) stack.add(i + w);
  }
  return src;
}

/// 원본 둥근 사각 바깥(모서리)에 얼룩(파랑·분홍 잡티)이 묻어 온 경우(2026-11-20 여섯 번째 안) — 원본 자신의 모서리
/// 반지름을 대각선에서 재고(얼룩에 속지 않게 연속 12px 불투명이 시작되는 곳), 그 둥근 사각 바깥을 투명으로 지운다.
/// 정사각 원본만 다룬다(아니면 그대로).
img.Image _clearOutsideOwnShape(img.Image src) {
  final n = src.width;
  if (src.height != n) return src;
  var d = 0;
  bool solidFrom(int k) {
    for (var j = 0; j < 12; j++) {
      if (k + j >= n || src.getPixel(k + j, k + j).a <= 250) return false;
    }
    return true;
  }

  while (d < n ~/ 2 && !solidFrom(d)) {
    d++;
  }
  if (d == 0 || d >= n ~/ 2) return src;
  // 대각선 거리 d = R(1 - 1/√2) → R. 경계 잡티가 남지 않게 2px 안쪽으로.
  final r = d / (1 - 1 / math.sqrt2) + 2;
  final inset = 2.0;
  for (var y = 0; y < n; y++) {
    for (var x = 0; x < n; x++) {
      final px = x + 0.5, py = y + 0.5;
      final cx = px.clamp(inset + r, n - inset - r);
      final cy = py.clamp(inset + r, n - inset - r);
      final outside =
          px < inset ||
          py < inset ||
          px > n - inset ||
          py > n - inset ||
          math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) > r;
      if (outside) src.getPixel(x, y).a = 0;
    }
  }
  return src;
}

/// 그림의 바탕 보라를 c = a + b·u + d·v (u,v 는 0~1 위치) 로 맞춘다 — 밝은 글자 픽셀은 뺀다. 바깥 칠하기용.
(int, int, int) Function(double, double) _fitPlane(img.Image art) {
  // 정규방정식 3x3 (채널마다 같은 행렬).
  final m = List.generate(3, (_) => List<double>.filled(3, 0));
  final rhs = List.generate(3, (_) => List<double>.filled(3, 0));
  for (var y = 0; y < art.height; y += 2) {
    for (var x = 0; x < art.width; x += 2) {
      final p = art.getPixel(x, y);
      if (p.g > 60) continue; // 흰 글자·번진 밝은 곳
      final f = [1.0, x / art.width, y / art.height];
      final c = [p.r.toDouble(), p.g.toDouble(), p.b.toDouble()];
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
          m[i][j] += f[i] * f[j];
        }
        for (var ch = 0; ch < 3; ch++) {
          rhs[ch][i] += f[i] * c[ch];
        }
      }
    }
  }
  List<double> solve(List<double> b) {
    final a = [
      for (var i = 0; i < 3; i++) [...m[i], b[i]],
    ];
    for (var col = 0; col < 3; col++) {
      for (var r = col + 1; r < 3; r++) {
        final k = a[r][col] / a[col][col];
        for (var c = col; c < 4; c++) {
          a[r][c] -= k * a[col][c];
        }
      }
    }
    final s = List<double>.filled(3, 0);
    for (var i = 2; i >= 0; i--) {
      var v = a[i][3];
      for (var j = i + 1; j < 3; j++) {
        v -= a[i][j] * s[j];
      }
      s[i] = v / a[i][i];
    }
    return s;
  }

  final co = [for (var ch = 0; ch < 3; ch++) solve(rhs[ch])];
  int at(int ch, double u, double v) =>
      (co[ch][0] + co[ch][1] * u + co[ch][2] * v).round().clamp(0, 255);
  return (u, v) => (at(0, u, v), at(1, u, v), at(2, u, v));
}

img.Image _roundedSquare(img.Image src, double radiusRatio) {
  final n = src.width;
  final r = n * radiusRatio;
  final out = img.Image(width: n, height: n, numChannels: 4);
  for (var y = 0; y < n; y++) {
    for (var x = 0; x < n; x++) {
      // 가장 가까운 모서리 원 중심까지의 거리 — 바깥이면 투명, 경계 1px 은 부드럽게.
      final px = x + 0.5, py = y + 0.5;
      final cx = px.clamp(r, n - r), cy = py.clamp(r, n - r);
      final dist = math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) - r;
      final cov = (0.5 - dist).clamp(0.0, 1.0);
      if (cov <= 0) continue;
      final p = src.getPixel(x, y);
      out.setPixelRgba(x, y, p.r, p.g, p.b, (255 * cov).round());
    }
  }
  return out;
}
