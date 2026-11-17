import 'package:flutter/foundation.dart';

import '../../../shared/order_status.dart';
import '../../address/domain/address.dart' show EntranceMethod;
import '../../payment/domain/payment.dart' show PaymentEntry;

/// 한집(SINGLE) / 알뜰(BUNDLED) / 예약(SCHEDULED). 이름은 잠정("한집/알뜰/예약" 유지).
enum DeliveryMode { single, bundled, scheduled }

/// 배송 방식 가능 여부(`GET /delivery-options`, BR-13). 조회 실패(unknown)를 불가로 보이지 않는다.
enum OptionAvailability { available, unavailable, configRequired, unknown }

/// 불가 사유. NIGHT_TIME = 00:00~08:00 실제 배송 없음(예약만).
enum UnavailableReason {
  nightTime,
  centerClosed,
  noSlot,
  configRequired,
  lookupFailed,
  unknown,
}

/// 예상 소요시간(정책값). [notSet] 이면 "미설정"으로 보이고 0분으로 바꾸지 않는다.
@immutable
class Eta {
  const Eta({this.minMinutes, this.maxMinutes, this.notSet = false});

  const Eta.notSet() : minMinutes = null, maxMinutes = null, notSet = true;

  final int? minMinutes;
  final int? maxMinutes;
  final bool notSet;
}

/// 배달팁 안내. [applied] 는 상품액을 줬을 때만 있다(최종 금액은 주문 초안에서 확정).
@immutable
class OptionTip {
  const OptionTip({this.base, this.applied, this.reason = TipReason.unknown});

  final int? base;
  final int? applied;
  final TipReason reason;
}

/// 배송 방식 선택지. 값은 서버 판정을 그대로 옮긴다.
@immutable
class DeliveryOption {
  const DeliveryOption(
    this.mode, {
    this.availability = OptionAvailability.available,
    this.reason,
    this.eta,
    this.tip,
    this.earliestSlot,
  });

  final DeliveryMode mode;
  final OptionAvailability availability;
  final UnavailableReason? reason;
  final Eta? eta;
  final OptionTip? tip;
  final ArrivalWindow? earliestSlot;

  bool get available => availability == OptionAvailability.available;
}

/// 도착 구간. 날짜는 Asia/Seoul `YYYY-MM-DD`, 시각은 `HH:mm`.
@immutable
class ArrivalWindow {
  const ArrivalWindow({
    required this.date,
    required this.start,
    required this.end,
  });

  final String date;
  final String start;
  final String end;

  @override
  bool operator ==(Object other) =>
      other is ArrivalWindow &&
      other.date == date &&
      other.start == start &&
      other.end == end;

  @override
  int get hashCode => Object.hash(date, start, end);
}

/// 슬롯 상태. CONFIG_REQUIRED(정원 미설정)는 0도 무제한도 아니고 선택 불가다.
enum SlotAvailability { available, full, closed, configRequired, unavailable }

@immutable
class Slot {
  const Slot({
    required this.window,
    required this.availability,
    this.slotId,
    this.remaining,
    this.cutoffAt,
  });

  final String? slotId;
  final ArrivalWindow window;
  final SlotAvailability availability;

  /// 남은 정원 사본(선택 성공 보장 아님). 미설정이면 null.
  final int? remaining;
  final DateTime? cutoffAt;

  bool get selectable => availability == SlotAvailability.available;
}

enum OutOfStockPreference { cancelOutOfStockOnly, cancelAll }

/// 배달팁 사유. 서버 값만 표시한다(앱이 무료 여부를 계산하지 않는다).
enum TipReason { standard, over30000, firstPurchase, none, unknown }

@immutable
class Quote {
  const Quote({
    required this.version,
    required this.tipReason,
    this.expiresAt,
    this.itemAmount,
    this.deliveryTip,
    this.bagFee,
    this.totalAmount,
    this.minOrderSatisfied,
    this.plannedShipments,
    this.minOrderAmount,
    this.minOrderShortfall,
    this.deliveryTipBase,
    this.firstPurchase = FirstPurchaseBenefit.unknown,
  });

  final int version;

  /// 가격 동결 만료(초안 생성 + 10분). 재고 예약 만료와 별개다.
  final DateTime? expiresAt;
  final int? itemAmount;
  final int? deliveryTip;
  final TipReason tipReason;
  final int? bagFee;
  final int? totalAmount;

  /// 최소 주문금액 충족 여부(서버 판정). 모르면 null.
  final bool? minOrderSatisfied;

  /// 2 이상이면 분할배송(10,000g 초과).
  final int? plannedShipments;

  /// 최소 주문 상품액(배달팁·봉투값 제외). 서버 값.
  final int? minOrderAmount;

  /// "N원 더 담기" 부족액(BR-14). 서버 값만 쓰고 앱이 빼기 계산하지 않는다.
  final int? minOrderShortfall;

  /// 무료 사유 적용 전 방식별 배달팁.
  final int? deliveryTipBase;
  final FirstPurchaseBenefit firstPurchase;
}

/// 첫 구매 무료배달 상태. 초안 단계는 EXPECTED 까지(확정은 결제 진입 때 서버가 한다).
enum FirstPurchaseBenefit {
  expected,
  checkingOtherOrder,
  confirmed,
  notEligible,
  unknown,
}

/// 결제 진입을 막는 사유(초안 `blockers`). 모두 보여 주고, 주버튼에는 서버가 준 순서의 첫 사유.
enum DraftBlocker {
  minOrderAmount,
  deliveryModeUnavailable,
  slotRequired,
  slotUnavailable,
  unknown,
}

enum HoldState { notNeeded, held, failed, released, unknown, other }

enum PaymentProgress {
  notStarted,
  started,
  approved,
  failed,
  unknown,
  mismatch,
}

@immutable
class DraftResources {
  const DraftResources({
    required this.inventory,
    required this.capacity,
    required this.slot,
    required this.payment,
    this.reservationExpiresAt,
  });

  final HoldState inventory;
  final HoldState capacity;
  final HoldState slot;
  final PaymentProgress payment;

  /// 재고 예약 만료. 가격 동결과 별개다.
  final DateTime? reservationExpiresAt;
}

/// 서버가 알려 준 다음 행동. 주문서의 결제 버튼은 결제 진입 전(DRAFT·[review])에만,
/// 결제창은 [pay] 일 때만 연다.
enum DraftNext { review, reQuote, pay, wait, done, expired, unknown }

/// 마지막 결제 진입의 자원 확보·결제 시작 실패(계약 `OrderDraft.checkoutFailure`).
/// 확보했던 것은 서버가 푼다. 견적이 유효하면 새 키로 다시 결제 진입할 수 있다.
@immutable
class CheckoutFailure {
  const CheckoutFailure({required this.code, this.step});

  /// INSUFFICIENT_STOCK·SKU_NOT_HANDLED·CAPACITY_EXCEEDED·SLOT_NOT_SELECTABLE·CONFIG_REQUIRED·RESOURCE_EXPIRED 등.
  final String code;
  final String? step;
}

/// 주문 당시 배송지·수령 연락처 사본(계약 `ShippingAddress`, BR-37). 초안을 만들 때 서버가 주소록에서
/// 복사해 고정하고 주문 확정 때 그대로 옮긴다. 주소록을 고치거나 지워도 바뀌지 않는다.
///
/// 2026-11-02 배포 전에 만든 초안·주문은 사본이 없다(null) — 그때 `shoppingAddressId` 로 현재 주소를
/// 대신 보이지 않는다. [entranceNote] 는 출입 비밀번호일 수 있어 로그·분석 이벤트에 넣지 않는다.
@immutable
class ShippingAddress {
  const ShippingAddress({
    required this.roadAddress,
    required this.detailAddress,
    required this.receiverName,
    required this.receiverPhone,
    this.postalCode,
    this.entranceMethod,
    this.entranceNote,
    this.lat,
    this.lng,
    this.capturedAt,
  });

  final String roadAddress;
  final String detailAddress;
  final String? postalCode;
  final String receiverName;
  final String receiverPhone;
  final EntranceMethod? entranceMethod;
  final String? entranceNote;
  final double? lat;
  final double? lng;
  final DateTime? capturedAt;

  @override
  String toString() => 'ShippingAddress(capturedAt: $capturedAt)';
}

@immutable
class OrderDraft {
  const OrderDraft({
    required this.draftId,
    required this.version,
    required this.status,
    required this.next,
    this.quote,
    this.resources,
    this.orderId,
    this.blockers = const [],
    this.payment,
    this.checkoutFailure,
    this.shippingAddress,
    this.lines = const [],
  });

  final String draftId;
  final int version;
  final OrderStatus status;
  final Quote? quote;
  final DraftResources? resources;
  final DraftNext next;

  /// 초안 생성 때 고정된 배송지 사본(`delivery.shippingAddress`). 주문서의 "받는 곳"은 이 값이다.
  final ShippingAddress? shippingAddress;

  /// 서버가 받아들인 품목(`lines[]`). 상품명·옵션 라벨은 초안 때 고정된 사본(BR-35)이다.
  final List<DraftLineView> lines;

  /// 결제 진입 때 발급된다. 확정 상태와 함께 있어야 "주문 완료"다.
  final String? orderId;

  /// 결제창 진입 정보. [next] 가 [DraftNext.pay] 일 때만 있다.
  final PaymentEntry? payment;
  final CheckoutFailure? checkoutFailure;

  /// 결제 진입 전(또는 실패로 돌아온) 초안. 주문서의 결제 버튼은 이때만 연다.
  bool get awaitingCheckout =>
      status == OrderStatus.draft && next == DraftNext.review;

  /// 결제 진입을 막는 사유(서버 순서). 최소주문 미달·방식 불가·슬롯 문제는 422 가 아니라 여기로 온다.
  final List<DraftBlocker> blockers;

  /// 견적 유효시간(10분)이 지난 초안. 서버는 status=EXPIRED·nextAction=RE_QUOTE 로 알린다(⑤ 안내 §3).
  /// 새 주문 의도(purchaseIntentId)로 다시 만든다.
  bool get expired =>
      next == DraftNext.expired || status == OrderStatus.expired;

  /// 가격 동결·재고 예약 중 더 이른 만료(안내용). 앱 타이머로 확보를 풀지 않는다.
  DateTime? get earliestExpiry {
    final a = quote?.expiresAt;
    final b = resources?.reservationExpiresAt;
    if (a == null) return b;
    if (b == null) return a;
    return a.isBefore(b) ? a : b;
  }
}

/// 초안 응답의 품목. 이름·옵션 라벨은 주문 당시 사본(BR-35) — 조회 실패면 null(지어내지 않는다).
@immutable
class DraftLineView {
  const DraftLineView({
    required this.sku,
    this.cartItemId,
    this.productName,
    this.optionLabel,
    this.quantity,
    this.unitPrice,
  });

  final String sku;
  final String? cartItemId;
  final String? productName;
  final String? optionLabel;
  final int? quantity;
  final int? unitPrice;

  /// 화면 제목: 상품명(+ 옵션). 이름 사본이 없으면 null(호출 쪽이 장바구니 이름 → sku 순으로 대신한다).
  String? get title => switch (productName) {
    final n? => [n, ?optionLabel].join(' · '),
    null => null,
  };
}

@immutable
class DraftLine {
  const DraftLine({
    required this.cartItemId,
    required this.sku,
    required this.quantity,
  });

  final String cartItemId;
  final String sku;
  final int quantity;
}

@immutable
class DraftRequest {
  const DraftRequest({
    required this.purchaseIntentId,
    required this.lines,
    required this.shoppingAddressId,
    required this.mode,
    required this.outOfStock,
    this.expectedMfcId,
    this.window,
    this.deliveryNote,
  });

  /// 같은 주문 의도 식별. "주문하기" 한 번에 하나.
  final String purchaseIntentId;
  final List<DraftLine> lines;
  final String shoppingAddressId;
  final String? expectedMfcId;
  final DeliveryMode mode;
  final ArrivalWindow? window;
  final OutOfStockPreference outOfStock;
  final String? deliveryNote;
}

/// 결제 진입 요청 결과. ACCEPTED 는 사가 시작일 뿐 재고·슬롯·결제 성공이 아니다.
@immutable
sealed class CheckoutStart {
  const CheckoutStart();
}

final class CheckoutAccepted extends CheckoutStart {
  const CheckoutAccepted(this.requestId);

  final String requestId;
}

/// 가격 동결이 끝났거나 가격이 바뀌었다. 새 견적을 받아 전후 비교·재동의한다.
final class CheckoutReQuote extends CheckoutStart {
  const CheckoutReQuote();
}

final class CheckoutDraftExpired extends CheckoutStart {
  const CheckoutDraftExpired();
}

final class CheckoutRejected extends CheckoutStart {
  const CheckoutRejected(this.code);

  final String code;
}

/// 시작됐는지 모른다. 초안 조회로 확인한다(결제를 다시 누르게 하지 않는다).
final class CheckoutUnknown extends CheckoutStart {
  const CheckoutUnknown();
}

abstract final class CheckoutProblemCode {
  static const reQuoteRequired = 'RE_QUOTE_REQUIRED';
  static const draftExpired = 'DRAFT_EXPIRED';
  static const minOrderAmount = 'MIN_ORDER_AMOUNT';
  static const outOfServiceArea = 'OUT_OF_SERVICE_AREA';
  static const weightUnsplittable = 'WEIGHT_UNSPLITTABLE';
  static const unsupported = 'UNSUPPORTED_ACTION';
  static const accountNotPurchasable = 'ACCOUNT_NOT_PURCHASABLE';
  static const serviceabilityUnknown = 'SERVICEABILITY_UNKNOWN';
  static const skuNotSaleable = 'SKU_NOT_SALEABLE';
  static const quantityLimitExceeded = 'QUANTITY_LIMIT_EXCEEDED';
  static const priceNotSet = 'PRICE_NOT_SET';
  static const configRequired = 'CONFIG_REQUIRED';
  static const mfcChanged = 'MFC_CHANGED';
  static const checkoutBlocked = 'CHECKOUT_BLOCKED';
  static const insufficientStock = 'INSUFFICIENT_STOCK';
  static const skuNotHandled = 'SKU_NOT_HANDLED';
  static const capacityExceeded = 'CAPACITY_EXCEEDED';
  static const slotNotSelectable = 'SLOT_NOT_SELECTABLE';
  static const resourceExpired = 'RESOURCE_EXPIRED';

  /// 초안 생성 거절(422·409 MFC_CHANGED). 같은 조건으로 다시 보내도 안 되므로 주문서로 넘어가지 않는다.
  static const draftRejections = {
    accountNotPurchasable,
    outOfServiceArea,
    serviceabilityUnknown,
    skuNotSaleable,
    quantityLimitExceeded,
    priceNotSet,
    weightUnsplittable,
    configRequired,
    mfcChanged,
    // order 0.8.0: 담당 센터 가용 < 주문 수량이거나 취급 안 함 — 초안을 만들지 않는다(주문서 진입 금지).
    insufficientStock,
  };
}

/// 초안 생성 422 `INSUFFICIENT_STOCK` 의 상품 한 줄(order 0.8.0 `details[]` — field = sku).
@immutable
final class StockShortage {
  const StockShortage({
    required this.sku,
    this.requestedQty,
    this.availableQty,
    this.notHandled = false,
  });

  final String sku;

  /// 서버가 본 주문 수량(`requestedQty=<q>`).
  final int? requestedQty;

  /// 서버가 본 담당 센터 가용(`availableQty=<a>`). 0 이면 품절.
  final int? availableQty;

  /// `NOT_HANDLED` — 담당 센터가 취급하지 않는다(이 지역에서 살 수 없음).
  final bool notHandled;

  /// 장바구니 수량이 [quantity] 일 때도 아직 부족한지. 수량을 줄여 맞췄으면 더 표시하지 않는다.
  bool stillShortAt(int quantity) => switch (availableQty) {
    _ when notHandled => true,
    final int a => quantity > a,
    null => true,
  };
}

/// `details[]` 를 SKU 별로 읽는다. 모르는 모양의 reason 은 수량 없이(부족함만) 둔다 — 지어내지 않는다.
Map<String, StockShortage> stockShortagesOf(
  Iterable<({String? field, String? reason})> details,
) {
  final out = <String, StockShortage>{};
  for (final d in details) {
    final sku = d.field;
    if (sku == null || sku.isEmpty) continue;
    final reason = d.reason ?? '';
    if (reason == 'NOT_HANDLED') {
      out[sku] = StockShortage(sku: sku, notHandled: true);
      continue;
    }
    int? part(String name) =>
        switch (RegExp('(?:^|;)$name=(\\d+)(?:;|\$)').firstMatch(reason)) {
          final m? => int.tryParse(m.group(1)!),
          null => null,
        };
    out[sku] = StockShortage(
      sku: sku,
      requestedQty: part('requestedQty'),
      availableQty: part('availableQty'),
    );
  }
  return out;
}
