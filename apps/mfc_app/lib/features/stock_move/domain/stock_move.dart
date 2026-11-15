import 'package:flutter/foundation.dart';

/// 재고 이동 지시(mfc-inbound MoveOrder). MOVE = 센터 관리자 지시, REPLENISH = 자동 선반 보충.
/// 실행은 두 단계: 출발 칸 → 카트(집어 올리기) → 도착 칸(내려놓기).
enum MoveKind { move, replenish, unknown }

enum MoveState { active, cancelPending, completed, cancelled, unknown }

@immutable
class MoveOrderView {
  const MoveOrderView({
    required this.moveId,
    required this.kind,
    required this.state,
    required this.sku,
    required this.lotId,
    required this.fromLocation,
    required this.toLocation,
    required this.qty,
    required this.pickedQty,
    required this.droppedQty,
    required this.onCartQty,
    this.cartLocation,
    this.urgent = false,
    this.assigneeId,
    this.pickedBy,
    this.reason,
    this.productName,
    this.barcodes = const [],
  });

  final String moveId;
  final MoveKind kind;
  final MoveState state;
  final String sku;
  final String lotId;
  final String fromLocation;
  final String toLocation;
  final String? cartLocation;
  final int qty;
  final int pickedQty;
  final int droppedQty;

  /// 카트에 실린 채 아직 안 내려놓은 양.
  final int onCartQty;
  final bool urgent;

  /// 담당 — 있으면 담당만 집어 올린다.
  final String? assigneeId;

  /// 카트에 실은 사람 — 그 사람만 내려놓는다.
  final String? pickedBy;
  final String? reason;

  /// (mfc-inbound 0.9.0, BR-52 R19-1) 표시용 상품명. 모르면 null.
  final String? productName;

  /// 활성 바코드 전부(선행 0 보존). 모르면 빈 배열 — 그때는 상품 확인 스캔을 건너뛴다.
  final List<String> barcodes;

  /// 대표 바코드(재출력용) — 첫 번째.
  String? get barcode => barcodes.firstOrNull;

  bool matchesBarcode(String code) => barcodes.contains(code.trim());

  /// 더 집을 양.
  int get toPick => state == MoveState.active ? qty - pickedQty : 0;

  /// 취소 뒤(CANCEL_PENDING)에는 카트 물건을 출발 칸으로 되돌려 놓는다.
  String get dropTarget =>
      state == MoveState.cancelPending ? fromLocation : toLocation;
}

/// 회수품(반품) 반입 한 줄. 반품 위치에 격리로만 들어간다.
@immutable
class ReturnReceiptLine {
  const ReturnReceiptLine({
    required this.sku,
    required this.qty,
    this.orderLineId,
    this.sourceLotRef,
    this.expiryDate,
    this.conditionNote,
  });

  final String sku;
  final int qty;
  final String? orderLineId;

  /// 상품 표기 LOT(없으면 서버가 RET-claimId).
  final String? sourceLotRef;
  final String? expiryDate;
  final String? conditionNote;
}

/// 반입된 회수품 한 줄(반영 뒤 inventory lotId).
@immutable
class ReturnedLine {
  const ReturnedLine({
    required this.sku,
    required this.qty,
    this.orderLineId,
    this.lotId,
    this.conditionNote,
    this.productName,
    this.zone,
    this.fresh,
  });

  final String sku;
  final int qty;
  final String? orderLineId;
  final String? lotId;
  final String? conditionNote;

  /// 표시용 — 계약에 없다(목만).
  final String? productName;

  /// 보관 온도대(AMBIENT·CHILLED·FROZEN)·신선 여부 — 상품 정보 값. 반입 조회에 없다(BR-52 R12). 목만.
  /// 작업자가 고르지 않는다.
  final String? zone;
  final bool? fresh;
}

@immutable
class ReturnReceiptView {
  const ReturnReceiptView({
    required this.returnReceiptId,
    required this.applyStatus,
    required this.inspected,
    this.claimId,
    this.lines = const [],
    this.rejectReason,
    this.putawayTaskIds = const [],
  });

  final String returnReceiptId;
  final String? claimId;
  final List<ReturnedLine> lines;

  /// SUBMITTED / APPLIED / REJECTED / UNKNOWN_RESULT — APPLIED 만 반입 확정.
  final String applyStatus;
  final bool inspected;
  final String? rejectReason;

  /// 재판매 분 적치 작업.
  final List<String> putawayTaskIds;
}

abstract final class MoveProblemCode {
  static const notAssignee = 'NOT_ASSIGNEE';
  static const notPicker = 'NOT_PICKER';
}
