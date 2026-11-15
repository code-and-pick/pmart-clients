import 'package:flutter/foundation.dart';

/// 순환 실사(mfc-inventory count-sessions, IV-11).
/// 계수 중에는 장부·차이를 보이지 않는다(계수표에 수량 없음).
enum CountState {
  counting,

  /// 첫 계수가 장부와 달라 **다른 작업자**가 다시 센다.
  recountRequired,
  pendingApproval,
  matched,
  adjusted,
  rejected,
  unknown,
}

/// 계수표 한 줄(수량 없음).
@immutable
class CountSheetLine {
  const CountSheetLine({
    required this.locationCode,
    required this.sku,
    required this.lotId,
    this.expiryDate,
    this.productName,
    this.barcodes = const [],
  });

  final String locationCode;
  final String sku;
  final String lotId;
  final String? expiryDate;

  /// (mfc-inventory 0.16.0, BR-52 R19-1) 표시용 상품명. 모르면 null.
  final String? productName;

  /// 활성 바코드 전부(선행 0 보존). 모르면 빈 배열 — 그 줄은 수량을 직접 넣는다.
  final List<String> barcodes;

  bool matchesBarcode(String code) => barcodes.contains(code.trim());

  String get key => '$locationCode|$sku|$lotId';
}

/// 계수가 끝난 뒤에만 오는 차이.
@immutable
class CountDifference {
  const CountDifference({
    required this.line,
    required this.bookQty,
    required this.countedQty,
    required this.deltaQty,
    this.heldQty = 0,
  });

  final CountSheetLine line;
  final int bookQty;
  final int heldQty;
  final int countedQty;
  final int deltaQty;
}

@immutable
class CountSessionView {
  const CountSessionView({
    required this.sessionId,
    required this.state,
    required this.locationCodes,
    required this.sheet,
    this.differences,
    this.firstCounter,
    this.recounter,
    this.version,
  });

  final String sessionId;
  final CountState state;
  final List<String> locationCodes;
  final List<CountSheetLine> sheet;

  /// 계수 중에는 null.
  final List<CountDifference>? differences;
  final String? firstCounter;
  final String? recounter;
  final int? version;

  /// 이 작업자가 지금 셀 수 있는지(안내용). 재계수는 첫 계수자와 다른 사람만 — 최종 판정은 서버(409 SAME_COUNTER).
  bool canCount(String workerId) => switch (state) {
    CountState.counting => true,
    CountState.recountRequired => firstCounter != workerId,
    _ => false,
  };
}

/// 칸에서 찾은 계수표 밖 상품(잘못 놓인 재고). 보낼 곳이 계약에 없다(BR-52 R19 6) — 목만 받는다.
@immutable
class ExtraFind {
  const ExtraFind({
    required this.locationCode,
    required this.barcode,
    required this.qty,
    this.sku,
    this.productName,
  });

  final String locationCode;
  final String barcode;
  final String? sku;
  final String? productName;
  final int qty;

  String get key => '$locationCode|$barcode';
}

/// 센 수량 한 줄. 계수표에 있는데 안 보내면 0 으로 센 것.
@immutable
class CountedLine {
  const CountedLine({required this.line, required this.countedQty});

  final CountSheetLine line;
  final int countedQty;
}

abstract final class CountProblemCode {
  static const sameCounter = 'SAME_COUNTER';
  static const locationNotLocked = 'LOCATION_NOT_LOCKED';
  static const countInProgress = 'COUNT_IN_PROGRESS';
}
