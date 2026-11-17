import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../../shared/shopping_context.dart';
import '../../auth/domain/auth.dart' show MemberSession;
import '../../auth/presentation/auth_controller.dart';
import '../data/cart_repository.dart';
import '../data/mock_cart_repository.dart';
import '../../checkout/domain/checkout.dart' show StockShortage;
import '../domain/cart.dart';

final cartRepositoryProvider = Provider<CartRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockCartRepository(),
    // 회원은 회원 토큰, 비회원은 비회원 토큰(POST /auth/guest-sessions, ADR-0022)으로 같은 API 를 부른다.
    PmartEnv.local => ApiCartRepository(
      ref.watch(sessionProvider) is MemberSession
          ? ref.watch(dioProvider)
          : ref.watch(guestDioProvider),
    ),
  },
);

/// 결과 불명 원결과 조회 간격·횟수. 화면이 열려 있는 동안만 짧게 확인한다.
final cartResolvePolicyProvider = Provider<({Duration interval, int attempts})>(
  (_) => (interval: const Duration(seconds: 2), attempts: 5),
);

/// 수량 ± 를 모아 보내는 대기 시간. 연속 탭을 최종 수량 한 번으로 보낸다(탭마다 왕복 2번 하지 않게).
final cartStepperDelayProvider = Provider<Duration>(
  (_) => const Duration(milliseconds: 350),
);

/// 장바구니 변경 상태(C 1265: CART_STABLE / CHANGE_PENDING / CHANGE_UNKNOWN).
enum CartSync { stable, pending, unknown }

/// 직전 변경의 안내. 화면은 이 값으로 문구를 고른다.
@immutable
sealed class CartNotice {
  const CartNotice();
}

final class NoticeRejected extends CartNotice {
  const NoticeRejected(this.rejection);

  final CartChangeRejected rejection;
}

/// 다른 곳에서 장바구니가 바뀌어 최신으로 다시 불러왔다. 고객이 다시 확인한다.
final class NoticeReloadedAfterConflict extends CartNotice {
  const NoticeReloadedAfterConflict();
}

/// 원결과 조회 결과 반영되지 않았다. 다시 시도할 수 있다.
final class NoticeNotApplied extends CartNotice {
  const NoticeNotApplied();
}

/// 반영 뒤 최신 장바구니를 받지 못했다. 보이는 목록은 직전 확정본이다.
final class NoticeReloadFailed extends CartNotice {
  const NoticeReloadFailed();
}

/// 선택돼 있던 품절·판매 불가 품목을 선택에서 뺐다(삭제하지 않음). 고객에게 바뀐 사실을 알린다(Commerce §장바구니 재진입).
final class NoticeSoldOutDeselected extends CartNotice {
  const NoticeSoldOutDeselected(this.count);

  final int count;
}

@immutable
class CartState {
  const CartState({
    required this.cart,
    this.sync = CartSync.stable,
    this.busyItemId,
    this.notice,
    this.amountStale = false,
  });

  /// 서버가 마지막으로 확정한 장바구니. 낙관적 반영을 하지 않는다 — 수량·선택·삭제는 서버가 APPLIED 로 확정한 뒤에만
  /// 응답 버전으로 반영한다([amountStale] 동안 합계는 비어 있고 뒤에서 다시 읽는다).
  final Cart cart;
  final CartSync sync;

  /// 진행 중·불명인 변경이 걸린 품목(담기는 null).
  final String? busyItemId;
  final CartNotice? notice;

  /// 변경은 확정됐지만 서버 합계·표시 사본을 아직 다시 읽지 못했다(합계 "확인 중").
  final bool amountStale;

  bool get canChange => sync == CartSync.stable;
}

/// 마지막 초안 생성이 422 `INSUFFICIENT_STOCK` 으로 거절됐을 때 서버가 짚은 상품(SKU 별, order 0.8.0).
/// 장바구니가 줄마다 "남은 수량"을 보인다. 다음 초안이 만들어지거나 담당 센터(주소)가 바뀌면 지운다 —
/// 센터마다 재고·취급이 다르다.
final stockShortageProvider =
    NotifierProvider<StockShortageController, Map<String, StockShortage>>(
      StockShortageController.new,
    );

class StockShortageController extends Notifier<Map<String, StockShortage>> {
  @override
  Map<String, StockShortage> build() {
    ref.watch(currentMfcIdProvider);
    return const {};
  }

  void set(Map<String, StockShortage> next) => state = next;

  void clear() {
    if (state.isNotEmpty) state = const {};
  }
}

/// 지금 주소(담당 센터)로는 배달하지 않는 품목 — 장바구니 목록에서 숨긴다(사용자 2026-11-17).
/// 서버 장바구니에는 그대로 있어서, 그 상품을 취급하는 주소로 돌아오면 다시 보인다.
/// 근거는 서버 값만: 장바구니 가용 `NOT_CARRIED` 또는 초안 422 의 `NOT_HANDLED`.
bool hiddenAtCurrentAddress(
  CartLine line,
  Map<String, StockShortage> shortages,
) =>
    line.availability == LineAvailability.notCarried ||
    (shortages[line.sku]?.notHandled ?? false);

final cartControllerProvider = AsyncNotifierProvider<CartController, CartState>(
  CartController.new,
);

class CartController extends AsyncNotifier<CartState> {
  /// 결과 불명인 변경의 키. 원결과 조회에만 쓴다(같은 행위의 재전송도 이 키).
  IdempotencyKey? _unknownKey;

  /// 결과 불명인 변경 자체(확정되면 반영할 내용).
  CartChange? _unknownChange;

  /// 변경 세대. 뒤에서 다시 읽은 장바구니가 그 사이 생긴 새 변경을 덮지 않게 한다.
  int _epoch = 0;

  CartRepository get _repo => ref.read(cartRepositoryProvider);

  /// 자동 선택 해제를 이미 시도한 품목(같은 품목을 반복해서 보내지 않는다 — 거절·불명이어도 다시 자동으로 보내지 않음).
  final Set<String> _autoTried = {};

  /// 이번 자동 해제로 뺀 품목 수(끝나면 안내로 한 번 보인다).
  int _autoDeselected = 0;
  bool _autoRunning = false;

  /// 선택 삭제가 품목을 차례로 지우는 중. 그동안 자동 선택 해제가 끼어들지 않는다.
  bool _bulkRunning = false;

  @override
  Future<CartState> build() async {
    _unknownKey = null;
    // 로그인·로그아웃하면 그 주체의 장바구니를 연다(일반 로그인은 자동 병합 없음).
    ref.watch(sessionProvider);
    final cart = await ref
        .watch(cartRepositoryProvider)
        .open(mfcId: ref.watch(currentMfcIdProvider));
    _autoTried.clear();
    _autoDeselected = 0;
    // 초안 422 가 "취급 안 함"을 짚으면 그 품목도 선택에서 뺀다(숨긴 품목이 합계·주문에 남지 않게).
    ref.listen(stockShortageProvider, (_, _) => _scheduleAutoDeselect());
    _scheduleAutoDeselect();
    return CartState(cart: cart);
  }

  CartState? get _current => state.value;

  void _set(CartState next) {
    if (!ref.mounted) return;
    state = AsyncData(next);
    _scheduleAutoDeselect();
  }

  /// 선택된 채 품절·판매 불가가 된 품목은 바로 선택에서 뺀다. 선택의 정본은 서버라 SetSelected(false) 를 보내고,
  /// 서버가 확정한 장바구니·합계로 다시 그린다(합계를 화면에서 계산하지 않는다). 품목은 지우지 않는다.
  void _scheduleAutoDeselect() {
    if (_autoRunning) return;
    // 이벤트 큐 다음 차례에 — build 가 끝나 상태가 놓인 뒤에 본다.
    Future<void>(_autoDeselectNext);
  }

  Future<void> _autoDeselectNext() async {
    if (!ref.mounted || _autoRunning || _bulkRunning) return;
    final current = _current;
    if (current == null || !current.canChange) return;
    final shortages = ref.read(stockShortageProvider);
    final target = current.cart.lines
        .where(
          (l) =>
              l.selected &&
              (l.definitelyUnavailable ||
                  hiddenAtCurrentAddress(l, shortages)) &&
              !_autoTried.contains(l.cartItemId),
        )
        .firstOrNull;
    if (target == null) {
      if (_autoDeselected > 0) {
        final n = _autoDeselected;
        _autoDeselected = 0;
        // 다른 안내(거절 등)가 떠 있으면 그것을 덮지 않는다.
        if (current.notice == null) {
          state = AsyncData(
            CartState(
              cart: current.cart,
              amountStale: current.amountStale,
              notice: NoticeSoldOutDeselected(n),
            ),
          );
        }
      }
      return;
    }
    _autoTried.add(target.cartItemId);
    _autoRunning = true;
    try {
      final outcome = await submit(
        SetSelected(cartItemId: target.cartItemId, selected: false),
      );
      // 숨긴 품목(지금 주소로 배달 안 함)은 "선택에서 뺐어요" 안내에 세지 않는다 — 고객에게 보이지 않는 품목이다.
      if (outcome is CartChangeApplied &&
          !hiddenAtCurrentAddress(target, shortages)) {
        _autoDeselected++;
      }
    } finally {
      _autoRunning = false;
    }
    _scheduleAutoDeselect();
  }

  /// 변경 1회. 진행 중이거나 결과 불명인 변경이 있으면 받지 않는다(null).
  Future<CartChangeOutcome?> submit(CartChange change) async {
    final current = _current;
    if (current == null || !current.canChange) return null;
    final key = IdempotencyKey.generate();
    _epoch++;
    final itemId = switch (change) {
      AddItem() => null,
      SetQuantity(:final cartItemId) => cartItemId,
      SetSelected(:final cartItemId) => cartItemId,
      RemoveItem(:final cartItemId) => cartItemId,
    };
    _set(
      CartState(cart: current.cart, sync: CartSync.pending, busyItemId: itemId),
    );
    final outcome = await _repo.change(
      current.cart.cartId,
      change,
      key: key,
      expectedVersion: current.cart.version,
    );
    if (!ref.mounted) return outcome;
    if (outcome is CartChangeUnknown) {
      _unknownKey = key;
      _unknownChange = change;
      _set(
        CartState(
          cart: current.cart,
          sync: CartSync.unknown,
          busyItemId: itemId,
        ),
      );
      return _resolve(attempts: ref.read(cartResolvePolicyProvider).attempts);
    }
    return _settle(outcome, change);
  }

  /// 선택 삭제. 일괄 삭제 경로가 없어(계약은 품목별 `DELETE /carts/{id}/items/{itemId}` 만) 선택된 품목을 하나씩
  /// [submit]([RemoveItem]) 으로 지운다. 반영(APPLIED)이 아닌 결과(거절·충돌·미적용·불명)가 나오면 거기서 멈추고
  /// 그 결과의 안내를 그대로 둔다 — 나머지는 지우지 않는다. 마지막 결과를 돌려준다(시작하지 못하면 null).
  Future<CartChangeOutcome?> removeSelected() async {
    final current = _current;
    if (current == null || !current.canChange || _bulkRunning) return null;
    final shortages = ref.read(stockShortageProvider);
    // 숨긴 품목(지금 주소로 배달 안 함)은 고객이 볼 수 없으니 선택 삭제에서 지우지 않는다.
    final ids = [
      for (final l in current.cart.lines)
        if (l.selected && !hiddenAtCurrentAddress(l, shortages)) l.cartItemId,
    ];
    if (ids.isEmpty) return null;
    _bulkRunning = true;
    CartChangeOutcome? last;
    try {
      for (final id in ids) {
        final now = _current;
        if (now == null) break;
        // 그 사이 이미 빠진 품목(다시 읽은 장바구니에 없음)은 건너뛴다.
        if (now.cart.lines.every((l) => l.cartItemId != id)) continue;
        last = await submit(RemoveItem(cartItemId: id));
        if (last is! CartChangeApplied || !ref.mounted) break;
      }
    } finally {
      _bulkRunning = false;
    }
    if (ref.mounted) _scheduleAutoDeselect();
    return last;
  }

  /// 다른 화면(주문 상세의 "같은 상품 담기" 등)에서 보내는 변경. 장바구니를 아직 안 읽었으면 읽고, 다른 변경이 진행 중이면
  /// 끝날 때까지 잠깐 기다렸다가 [submit] 한다. 결과 불명인 변경이 걸려 있거나 끝내 바쁘면 null(보내지 않음).
  /// 장바구니 조회 실패는 [PmartFailure] 로 던진다.
  Future<CartChangeOutcome?> submitWhenReady(
    CartChange change, {
    int attempts = 20,
    Duration step = const Duration(milliseconds: 100),
  }) async {
    for (var i = 0; ; i++) {
      final s = await future;
      if (!ref.mounted || s.sync == CartSync.unknown) return null;
      if (s.canChange && !_bulkRunning && !_autoRunning) {
        final outcome = await submit(change);
        if (outcome != null) return outcome;
      }
      if (i >= attempts) return null;
      await Future<void>.delayed(step);
    }
  }

  /// "다시 확인". 원결과만 조회한다(변경을 다시 보내지 않는다).
  Future<CartChangeOutcome?> checkAgain() => _resolve(attempts: 1);

  Future<CartChangeOutcome?> _resolve({required int attempts}) async {
    final key = _unknownKey;
    final current = _current;
    if (key == null || current == null) return null;
    final interval = ref.read(cartResolvePolicyProvider).interval;
    for (var i = 0; i < attempts; i++) {
      if (i > 0) await Future<void>.delayed(interval);
      if (!ref.mounted) return null;
      final outcome = await _repo.lookup(current.cart.cartId, key);
      if (!ref.mounted) return null;
      if (outcome is! CartChangeUnknown) {
        _unknownKey = null;
        final change = _unknownChange;
        _unknownChange = null;
        return _settle(outcome, change);
      }
    }
    // 아직 모른다. "확인 중"을 유지하고 같은 행위를 새로 실행하지 못하게 둔다.
    return const CartChangeUnknown();
  }

  Future<CartChangeOutcome> _settle(
    CartChangeOutcome outcome,
    CartChange? change,
  ) async {
    final current = _current!;
    switch (outcome) {
      case CartChangeApplied(:final cartVersion, :final cart):
        // 응답에 장바구니 전체가 오면(BR-43, cart-service 2026-11-03 배포) 그걸로 끝낸다 — 왕복 1회, 합계도 서버 값.
        // 결과 조회로 받은 cart 는 "지금" 장바구니라 이 변경보다 뒤일 수 있지만 더 최신이므로 그대로 쓴다.
        if (cart != null) {
          _set(CartState(cart: cart));
          break;
        }
        // (cart 가 없는 옛 서버) 담기(새 행)는 표시용 사본이 필요해 다시 읽는다. 수량·선택·삭제는 서버가 확정한 내용을
        // 응답 버전으로 바로 반영하고(왕복 1회), 서버 합계·사본은 뒤에서 다시 읽어 채운다.
        if (change == null || change is AddItem) {
          await _reload(current.cart, notice: null);
        } else {
          final local = current.cart.applied(change, cartVersion: cartVersion);
          _set(CartState(cart: local, amountStale: true));
          unawaited(_reloadInBackground(local));
        }
      case CartVersionConflict():
        await _reload(
          current.cart,
          notice: const NoticeReloadedAfterConflict(),
        );
      case CartChangeRejected():
        _set(CartState(cart: current.cart, notice: NoticeRejected(outcome)));
      case CartChangeNotApplied():
        _set(CartState(cart: current.cart, notice: const NoticeNotApplied()));
      case CartChangeUnknown():
        break;
    }
    return outcome;
  }

  Future<void> _reload(Cart previous, {required CartNotice? notice}) async {
    try {
      final fresh = await _repo.get(previous.cartId);
      _set(CartState(cart: fresh, notice: notice));
    } on PmartFailure {
      _set(CartState(cart: previous, notice: const NoticeReloadFailed()));
    }
  }

  /// 확정된 변경을 반영한 뒤 서버 합계·표시 사본을 뒤에서 다시 읽는다. 그 사이 새 변경이 시작됐으면 결과를 버린다
  /// (그 변경이 끝날 때 다시 읽는다). 실패하면 합계는 "확인할 수 없어요"로 남고 안내를 올린다.
  Future<void> _reloadInBackground(Cart local) async {
    final epoch = _epoch;
    try {
      final fresh = await _repo.get(local.cartId);
      if (!ref.mounted || _epoch != epoch) return;
      final current = _current;
      _set(CartState(cart: fresh, notice: current?.notice));
    } on PmartFailure {
      if (!ref.mounted || _epoch != epoch) return;
      _set(CartState(cart: local, notice: const NoticeReloadFailed()));
    }
  }

  /// 안내를 지운다(고객이 확인함).
  void dismissNotice() {
    final current = _current;
    if (current == null || current.notice == null) return;
    _set(
      CartState(
        cart: current.cart,
        sync: current.sync,
        busyItemId: current.busyItemId,
        amountStale: current.amountStale,
      ),
    );
  }

  /// 최신 장바구니를 다시 받는다. 변경 진행 중에는 하지 않는다.
  Future<void> refresh() async {
    final current = _current;
    if (current == null) {
      ref.invalidateSelf();
      return;
    }
    if (!current.canChange) return;
    await _reload(current.cart, notice: null);
  }
}
