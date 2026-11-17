import 'package:pmart_api_cart/pmart_api_cart.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../catalog/data/mock_catalog_repository.dart' show mockProducts;
import '../domain/cart.dart';
import 'cart_repository.dart';

/// 목 장바구니 품목.
final class _MockLine {
  _MockLine(this.cartItemId, this.sku, this.quantity);

  final String cartItemId;
  final String sku;
  int quantity;
  bool selected = true;
}

/// 목 구현. 메모리에 장바구니 하나를 두고 계약 규칙(절대 수량, cartVersion, 상한, 가용)을 흉내 낸다.
/// 응답은 계약 JSON → 생성 모델 → 실서버와 같은 변환을 거친다.
base class MockCartRepository implements CartRepository {
  MockCartRepository({
    this.latency = const Duration(milliseconds: 300),
    bool seeded = true,
  }) {
    if (seeded) {
      _lines
        ..add(_MockLine('ci-1', 'E-00000001', 2))
        ..add(_MockLine('ci-2', 'E-00000005', 1));
      _nextId = 3;
    }
  }

  final Duration latency;

  /// 시험용: 담을 수 없는 상태(품절 등)가 된 품목을 이미 담겨 선택된 채로 둔다(담기 검사를 거치지 않음).
  void seedLine(String sku, int quantity, {bool selected = true}) {
    _lines.add(
      _MockLine('ci-${_nextId++}', sku, quantity)..selected = selected,
    );
  }

  static const cartId = 'cart-mock-1';

  /// 기초상품 낱개 환산 합계 상한(C 1068). 실제 값은 서버(product) 판정이다.
  static const limitUnits = 10;

  /// 낮은 가용 상품의 공개 가용 수량.
  static const lowStockQty = 3;

  final _lines = <_MockLine>[];
  final _results = <String, Map<String, Object?>>{};
  int version = 3;
  int _nextId = 1;

  /// 다음 변경 1회를 "반영은 됐지만 응답을 잃음"으로 만든다(결과 불명 시연).
  bool loseNextResponse = false;

  /// 다음 변경 1회를 "서버에 닿지 않음"으로 만든다(미적용인데 응답 불명).
  bool dropNextRequest = false;

  /// 원결과 조회가 몇 번 더 실패할지(조회 불가 시연).
  int lookupFailures = 0;

  /// 재고 원천(mfc-inventory-service)을 못 받은 상태: 모든 줄 가용 UNKNOWN + `sources` 에 UNAVAILABLE.
  bool inventoryDown = false;

  /// 담당 MFC 가 없는 장바구니(배송지 미정): 재고를 조회하지 않아 가용 UNKNOWN, `mfcId` null.
  bool noMfc = false;

  /// 센터별로 취급하지 않는 SKU(가용 `NOT_CARRIED`). [open] 에 받은 `mfcId` 기준으로 정한다.
  Map<String, Set<String>> notCarriedAt = const {};

  /// 마지막 [open] 의 담당 센터(null 이면 목 기본 센터).
  String? _openedMfcId;

  bool _notCarried(String sku) =>
      notCarriedAt[_openedMfcId ?? 'MFC-MOCK-01']?.contains(sku) ?? false;

  /// 받은 변경 명령(재전송 포함) 순서대로. 테스트가 "몇 번 보냈는지"를 본다.
  final changes = <CartChange>[];

  /// 변경 응답에 `cart` 를 넣지 않는다(BR-43 전 서버 시연 — 앱이 다시 읽는 경로).
  bool omitCartInResult = false;

  /// 다른 기기에서 장바구니를 바꾼 것처럼 버전을 올린다(버전 충돌 시연).
  void bumpVersionElsewhere() => version++;

  Future<void> _wait() => Future<void>.delayed(latency);

  ({
    String productId,
    String name,
    String label,
    int price,
    String saleState,
    String availability,
    int units,
  })?
  _sku(String sku) {
    for (final p in mockProducts) {
      if (p.sku == sku) {
        return (
          productId: p.productId,
          name: p.name,
          label: '1개',
          price: p.price,
          saleState: p.saleState,
          availability: p.availability,
          units: 1,
        );
      }
      if (p.bundleSku == sku) {
        return (
          productId: p.productId,
          name: p.name,
          label: '2개 묶음',
          price: p.bundlePrice!,
          saleState: p.saleState,
          availability: 'AVAILABLE',
          units: 2,
        );
      }
    }
    return null;
  }

  Map<String, Object?> cartJson() {
    var amount = 0;
    final items = <Map<String, Object?>>[];
    for (final l in _lines) {
      final s = _sku(l.sku)!;
      final notCarried = !noMfc && _notCarried(l.sku);
      final purchasable =
          s.saleState == 'ON_SALE' &&
          s.availability != 'SOLD_OUT' &&
          !notCarried;
      if (l.selected && purchasable) amount += s.price * l.quantity;
      items.add({
        'cartItemId': l.cartItemId,
        'sku': l.sku,
        'productId': s.productId,
        'quantity': l.quantity,
        'selected': l.selected,
        'display': {
          'name': s.name,
          'optionLabel': s.label,
          'unitPrice': s.price,
          'priceVersion': 1,
          'saleState': s.saleState,
          'availability': (inventoryDown || noMfc)
              ? 'UNKNOWN'
              : notCarried
              ? 'NOT_CARRIED'
              : s.availability,
          'availableQty': s.availability == 'LOW' && !inventoryDown && !noMfc
              ? lowStockQty
              : null,
        },
      });
    }
    return {
      'cartId': cartId,
      'cartVersion': version,
      'ownerType': 'GUEST',
      'accountId': null,
      'mfcId': noMfc ? null : 'MFC-MOCK-01',
      'items': items,
      'selectedItemAmount': amount,
      'lastChangedAt': '2026-10-24T06:00:00Z',
      'expiresAt': '2026-11-23T06:00:00Z',
      'sources': [
        {
          'system': 'pricing-service',
          'asOf': {'asOf': '2026-10-24T06:00:00Z', 'freshness': 'CURRENT'},
        },
        if (!noMfc)
          {
            'system': 'mfc-inventory-service',
            'asOf': {
              'asOf': '2026-10-24T06:00:00Z',
              'freshness': inventoryDown ? 'UNAVAILABLE' : 'CURRENT',
            },
          },
      ],
    };
  }

  Cart _cart() => cartFromContract(api.Cart.fromJson(cartJson()));

  @override
  Future<Cart> open({String? mfcId}) async {
    await _wait();
    _openedMfcId = mfcId;
    return _cart();
  }

  @override
  Future<Cart> get(String cartId) async {
    gets++;
    await Future<void>.delayed(getLatency ?? latency);
    return _cart();
  }

  /// 조회(`GET /carts/{id}`)만 따로 늦추고 싶을 때. null 이면 [latency].
  Duration? getLatency;

  /// 조회 횟수(왕복 수 시험용).
  int gets = 0;

  ProblemFailure _reject(String code, {Map<String, Object?> raw = const {}}) =>
      ProblemFailure(
        Problem(status: 422, code: code, raw: {'code': code, ...raw}),
      );

  int _unitsFor(String productId, {String? exceptItemId}) {
    var total = 0;
    for (final l in _lines) {
      if (l.cartItemId == exceptItemId) continue;
      final s = _sku(l.sku)!;
      if (s.productId == productId) total += s.units * l.quantity;
    }
    return total;
  }

  /// 판매 상태 → 구매 상한 → 가용 순서로 검증한다(계약 addCartItem 설명).
  void _validate(String sku, int quantity, {String? itemId}) {
    final s = _sku(sku);
    if (s == null || s.saleState != 'ON_SALE') {
      throw _reject(CartProblemCode.skuNotSaleable);
    }
    final others = _unitsFor(s.productId, exceptItemId: itemId);
    final total = others + s.units * quantity;
    if (total > limitUnits) {
      throw _reject(
        CartProblemCode.quantityLimitExceeded,
        raw: {
          'limit': {
            'baseProductId': s.productId,
            'totalUnits': total,
            'limitUnits': limitUnits,
            'suggestedQuantity': (limitUnits - others) ~/ s.units,
          },
        },
      );
    }
    if (s.availability == 'SOLD_OUT' ||
        (s.availability == 'LOW' && quantity > lowStockQty)) {
      throw _reject(
        CartProblemCode.insufficientAvailableQuantity,
        raw: {'availableQty': s.availability == 'LOW' ? lowStockQty : 0},
      );
    }
  }

  @override
  Future<CartChangeOutcome> change(
    String cartId,
    CartChange change, {
    required IdempotencyKey key,
    required int expectedVersion,
  }) async {
    await _wait();
    changes.add(change);
    // 같은 키 재전송은 기존 결과를 돌려준다(중복 적용 없음).
    if (dropNextRequest) {
      dropNextRequest = false;
      return const CartChangeUnknown();
    }
    final previous = _results[key.value];
    if (previous != null) {
      return changeResultFromContract(api.CartChangeResult.fromJson(previous));
    }
    try {
      if (expectedVersion != version) {
        throw ProblemFailure(
          Problem(
            status: 409,
            code: CartProblemCode.versionConflict,
            raw: {'cartVersion': version},
          ),
        );
      }
      final (itemId, sku, quantity, selected) = _apply(change);
      version++;
      final result = <String, Object?>{
        'status': 'APPLIED',
        'requestId': key.value,
        'resultId': itemId,
        'version': version,
        'cartId': cartId,
        'cartItemId': itemId,
        'sku': sku,
        'quantity': quantity,
        'selected': selected,
        'cartVersion': version,
        'appliedRequestId': key.value,
        // BR-43 회신: 응답에 장바구니 전체(GET 과 같은 모양). 옛 서버 시연은 [omitCartInResult].
        if (!omitCartInResult) 'cart': cartJson(),
      };
      _results[key.value] = result;
      if (loseNextResponse) {
        loseNextResponse = false;
        throw UnknownResultFailure(requestId: key.value, httpStatus: 503);
      }
      return changeResultFromContract(api.CartChangeResult.fromJson(result));
    } on PmartFailure catch (f) {
      return changeFailureToOutcome(f);
    }
  }

  (String, String, int, bool) _apply(CartChange change) {
    switch (change) {
      case AddItem(:final sku, :final quantity):
        final existing = _lines.where((l) => l.sku == sku).firstOrNull;
        _validate(sku, quantity, itemId: existing?.cartItemId);
        // 같은 SKU 는 합산이 아니라 절대 수량 설정.
        final line = existing ?? _MockLine('ci-${_nextId++}', sku, quantity);
        if (existing == null) _lines.add(line);
        line
          ..quantity = quantity
          ..selected = true;
        return (line.cartItemId, sku, quantity, true);
      case SetQuantity(:final cartItemId, :final quantity):
        final line = _line(cartItemId);
        _validate(line.sku, quantity, itemId: cartItemId);
        line.quantity = quantity;
        return (cartItemId, line.sku, quantity, line.selected);
      case SetSelected(:final cartItemId, :final selected):
        final line = _line(cartItemId)..selected = selected;
        return (cartItemId, line.sku, line.quantity, selected);
      case RemoveItem(:final cartItemId):
        final line = _lines
            .where((l) => l.cartItemId == cartItemId)
            .firstOrNull;
        _lines.remove(line);
        return (cartItemId, line?.sku ?? 'E-00000000', 0, false);
    }
  }

  _MockLine _line(String id) =>
      _lines.where((l) => l.cartItemId == id).firstOrNull ??
      (throw const ProblemFailure(Problem(status: 404, code: 'NOT_FOUND')));

  @override
  Future<CartChangeOutcome> lookup(String cartId, IdempotencyKey key) async {
    await _wait();
    if (lookupFailures > 0) {
      lookupFailures--;
      return const CartChangeUnknown();
    }
    final result = _results[key.value];
    if (result == null) return const CartChangeNotApplied();
    return changeResultFromContract(api.CartChangeResult.fromJson(result));
  }
}
