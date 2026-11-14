import 'package:flutter/foundation.dart';

/// 입고 작업(mfc-inbound InboundTask) — 품질검사(INSPECT)·적치(PUTAWAY).
enum InboundTaskKind { inspect, putaway, unknown }

@immutable
class InboundTaskView {
  const InboundTaskView({
    required this.taskId,
    required this.kind,
    required this.receiptId,
    required this.sku,
    required this.lotId,
    required this.locationCode,
    required this.plannedQty,
    required this.doneQty,
    required this.completed,
    required this.version,
    this.parentTaskId,
    this.productName,
    this.barcodes = const [],
    this.minRemainingDays,
    this.maxDaysSinceManufacture,
    this.zone,
    this.suggestedLocations = const [],
  });

  final String taskId;

  /// 적치 추천 칸 — 계약에 없다(BR-52 R19 4). 목만.
  final List<String> suggestedLocations;
  final InboundTaskKind kind;

  /// 상품명·바코드 — 서버 값(mfc-inbound 0.8.0 `productName`·`barcodes`, BR-53 R8). 상품명은 상품 관리용
  /// 명칭(internalName). 서버가 모르면(옛 상품·조회 실패) null·빈 목록 → SKU 로 보이고 바코드 대조를 건너뛴다.
  final String? productName;

  /// 그 SKU 의 활성 바코드 전부(선행 0 보존). 스캔 값이 이 중 하나면 맞는 상품.
  final List<String> barcodes;

  /// 화면·재출력에 쓰는 대표 바코드(첫 번째).
  String? get barcode => barcodes.firstOrNull;

  bool matchesBarcode(String code) => barcodes.contains(code.trim());

  /// 판정 기준·보관 온도대 — 입고 작업 계약에 없다(BR-52 R18). 목만.
  /// 기준은 상품 정보(product-service `minRemainingDays`·`maxDaysSinceManufacture`)의 값.
  final int? minRemainingDays;
  final int? maxDaysSinceManufacture;
  final TempZone? zone;
  final String receiptId;
  final String? parentTaskId;
  final String sku;

  /// 품질검사 = 수령 LOT, 적치 = 나뉜 LOT.
  final String lotId;

  /// 출발 위치.
  final String locationCode;
  final int plannedQty;
  final int doneQty;
  final bool completed;
  final int version;

  int get remainingQty => plannedQty - doneQty;
}

/// 품질검사 결과 한 줄. 같은 제조 LOT 표기·소비기한은 같은 LOT 이 된다.
@immutable
class InspectionResult {
  const InspectionResult({
    required this.qty,
    required this.quarantined,
    this.sourceLotRef,
    this.expiryDate,
    this.manufactureDate,
  });

  final int qty;

  /// 격리 판정. 아니면 정상.
  final bool quarantined;

  /// 상품에 찍힌 제조 LOT 표기.
  final String? sourceLotRef;

  /// 소비기한(yyyy-MM-dd).
  final String? expiryDate;

  /// 제조일(yyyy-MM-dd). 오늘 이후·소비기한 이후면 서버가 400.
  final String? manufactureDate;
}

/// 품질검사·적치 실행 결과(APPLIED 일 때만 확정).
@immutable
class InboundTaskExecutionView {
  const InboundTaskExecutionView({
    required this.executionId,
    required this.task,
    this.commitId,
    this.createdTaskIds = const [],
  });

  final String executionId;
  final InboundTaskView? task;
  final String? commitId;

  /// 품질검사가 만든 적치 작업.
  final List<String> createdTaskIds;
}

/// 회수품 검수 판정.
enum ReturnVerdict { resale, dispose }

enum TempZone { ambient, chilled, frozen }

/// 폐기 사유(계약 값).
enum DisposeReason {
  temperatureZone('TEMPERATURE_ZONE'),
  fresh('FRESH'),
  opened('OPENED'),
  damaged('DAMAGED'),
  expired('EXPIRED'),
  other('OTHER');

  const DisposeReason(this.wire);

  final String wire;
}

/// 회수품 검수 한 줄. 재판매는 상온·미개봉·신선 아님일 때만(아니면 서버 422 RESALE_NOT_ALLOWED).
@immutable
class ReturnInspectionLine {
  const ReturnInspectionLine({
    required this.sku,
    required this.qty,
    required this.verdict,
    required this.zone,
    required this.opened,
    this.orderLineId,
    this.lotId,
    this.fresh = false,
    this.disposeReason,
    this.evidenceRef,
  });

  final String sku;
  final String? orderLineId;
  final String? lotId;
  final int qty;
  final ReturnVerdict verdict;
  final TempZone zone;
  final bool fresh;
  final bool opened;
  final DisposeReason? disposeReason;

  /// 증빙 사진 참조(폐기 줄 필수 — 앱 규칙).
  final String? evidenceRef;

  /// 화면 안내용 — 최종 판정은 서버.
  bool get resaleAllowed => zone == TempZone.ambient && !fresh && !opened;
}

abstract final class QualityProblemCode {
  static const resaleNotAllowed = 'RESALE_NOT_ALLOWED';
  static const qtyExceedsReceived = 'QTY_EXCEEDS_RECEIVED';
}
