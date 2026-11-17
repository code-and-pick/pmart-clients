import 'package:flutter/foundation.dart';

import '../../../shared/location.dart';
import '../../../shared/mfc_directory.dart';

/// 주문 품목 한 줄.
@immutable
class OrderLine {
  const OrderLine({
    required this.name,
    required this.qty,
    required this.amount,
  });

  final String name;
  final int qty;

  /// 줄 금액(원, 서버 값 표시만).
  final int amount;
}

/// 배달 한 건의 주문·픽업지·전달지 요약(라이더 화면용).
///
/// 계약(제안 요약·배송 수행)에 아직 없는 값이다 — 목에서만 채운다(백엔드 요청
/// `docs/handoff/rider-app/2026-11-16-backend-trip-info-and-signup.md`). 실서버에서는 null 이라
/// 화면은 계약에 있는 값(주문 ID·전달지)만 보인다.
@immutable
class TripInfo {
  const TripInfo({
    required this.orderNo,
    required this.store,
    this.items = const [],
    this.menuTotal,
    this.storeRequest,
    this.deliveryRequest,
    this.dropLabel,
    this.drop,
    this.pickupDueAt,
    this.dropDueAt,
    this.dropEtaSeconds,
  });

  /// 주문번호 8자리.
  final String orderNo;

  /// 픽업지(주문 장소).
  final MfcBranch store;
  final List<OrderLine> items;

  /// 메뉴 금액 합계(서버 값).
  final int? menuTotal;

  /// 고객이 가게에 남긴 요청사항.
  final String? storeRequest;

  /// 배달 요청사항(수락 전 공개분).
  final String? deliveryRequest;

  /// 전달지 대략 위치(동 이름).
  final String? dropLabel;

  /// 전달지 좌표(지도 핀).
  final GeoPoint? drop;

  /// 픽업 예정·전달 예정 시각.
  final DateTime? pickupDueAt;
  final DateTime? dropDueAt;

  /// 픽업지 → 전달지 예상 소요(초). 수락 전 카드의 도착 예상에 쓴다.
  final int? dropEtaSeconds;
}
