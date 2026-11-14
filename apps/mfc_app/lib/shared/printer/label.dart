import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../features/packing/domain/packing.dart';

/// 라벨 프린터로 뽑는 것. [zpl] 은 프린터로 보내는 명령.
abstract interface class PrintableLabel {
  String zpl();
}

/// 포장 라벨에 찍는 값. 라벨 항목은 계약에 아직 없어(BR-22) QR·포장·주문·배송·온도대·봉투 수만 넣는다.
@immutable
class PackageLabel implements PrintableLabel {
  const PackageLabel({
    required this.packageId,
    required this.packageVersion,
    required this.qrCode,
    this.orderId,
    this.deliveryId,
    this.temperatureZone,
    this.bagCount,
  });

  factory PackageLabel.of(ShipmentView s, PackageView p) => PackageLabel(
    packageId: p.packageId,
    packageVersion: p.packageVersion,
    qrCode: p.qrCode!,
    orderId: s.orderId,
    deliveryId: s.deliveryId,
    temperatureZone: p.temperatureZone,
    bagCount: p.bagCount,
  );

  final String packageId;
  final int packageVersion;

  /// 서버가 준 `Package.qrCode` 원문. 클라이언트가 만들지 않는다.
  final String qrCode;
  final String? orderId;
  final String? deliveryId;

  /// 계약 값 그대로(CHILLED·FROZEN·AMBIENT).
  final String? temperatureZone;
  final int? bagCount;

  @override
  String zpl() => packageLabelZpl(this);
}

/// 상품 바코드 스티커 — 상품 바코드가 훼손돼 안 찍힐 때 같은 번호로 다시 뽑는다(사용자 2026-11-14).
/// 값은 서버(또는 목)가 준 그 상품의 바코드 원문 그대로다. 새 번호를 만들지 않고 실적·재고와 무관하다
/// (WMS 업무 문서: 라벨 재출력은 같은 번호, 물류 실적 없음).
@immutable
class ProductBarcodeLabel implements PrintableLabel {
  const ProductBarcodeLabel({
    required this.sku,
    required this.barcode,
    this.productName,
  });

  final String sku;
  final String barcode;

  /// 화면 미리보기에만 쓴다(라벨 기본 글꼴에 한글이 없다).
  final String? productName;

  @override
  String zpl() => productBarcodeLabelZpl(this);
}

/// 필드 값은 `^FH` 로 `^`·`~`·`\` 를 16진수로 바꿔 명령으로 해석되지 않게 한다.
String _zplField(String v) {
  final b = StringBuffer();
  for (final r in v.runes) {
    if (r == 0x5E || r == 0x7E || r == 0x5C || r < 0x20 || r > 0x7E) {
      // 출력 가능한 ASCII 밖은 UTF-8 바이트를 16진수로(^CI28).
      for (final byte in utf8.encode(String.fromCharCode(r))) {
        b.write('\\${byte.toRadixString(16).padLeft(2, '0').toUpperCase()}');
      }
    } else {
      b.writeCharCode(r);
    }
  }
  return b.toString();
}

/// 4×3인치(203dpi) ZPL 라벨. 기본 글꼴(A0)에 한글이 없어 라벨에는 영문·숫자만 쓴다.
String packageLabelZpl(PackageLabel l) {
  String f(String v) => _zplField(v);

  String text(int x, int y, int h, String v) =>
      '^FO$x,$y^A0N,$h,$h^FH\\^FD${f(v)}^FS';

  return [
    '^XA',
    '^CI28',
    '^PW812',
    '^LL609',
    '^FO30,40^BQN,2,9^FH\\^FDQA,${f(l.qrCode)}^FS',
    text(380, 50, 40, l.packageId),
    text(380, 100, 30, 'v${l.packageVersion}'),
    if (l.orderId != null) text(380, 150, 30, 'ORDER ${l.orderId}'),
    if (l.deliveryId != null) text(380, 195, 30, 'DLV ${l.deliveryId}'),
    if (l.temperatureZone != null) text(380, 260, 56, l.temperatureZone!),
    if (l.bagCount != null) text(380, 340, 30, 'BAGS ${l.bagCount}'),
    '^XZ',
  ].join('\n');
}

/// 상품 바코드 스티커(포장 라벨과 같은 용지). Code 128 로 바코드 원문을 그대로 찍는다 — 스캐너가 읽으면
/// 같은 글자가 나온다. (EAN-13 명령은 검증 숫자를 프린터가 다시 계산해 원문과 달라질 수 있어 쓰지 않는다.)
String productBarcodeLabelZpl(ProductBarcodeLabel l) {
  String f(String v) => _zplField(v);
  return [
    '^XA',
    '^CI28',
    '^PW812',
    '^LL609',
    '^FO60,60^BY3^BCN,220,Y,N,N^FH\\^FD${f(l.barcode)}^FS',
    '^FO60,380^A0N,40,40^FH\\^FDSKU ${f(l.sku)}^FS',
    '^XZ',
  ].join('\n');
}
