import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../catalog/domain/catalog.dart' show SaleState;
import '../../catalog/presentation/widgets/product_tile_card.dart'
    show ProductImage;
import '../domain/cart.dart';
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../checkout/domain/checkout.dart'
    show DeliveryOption, StockShortage, TipReason;
import '../../checkout/presentation/checkout_controller.dart';
import 'cart_controller.dart';
import 'cart_messages.dart';

/// SCR-CART-001. 화면은 서버가 확정한 장바구니만 그린다(낙관적 반영 없음).
class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(cartControllerProvider);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.surfaceContainer,
      appBar: AppBar(
        title: Text(l10n.cartTitle),
        centerTitle: true,
        backgroundColor: scheme.surface,
      ),
      body: UiStateView<CartState>(
        state: uiStateOf(value),
        onRetry: () => ref.invalidate(cartControllerProvider),
        ready: (context, s) => _CartBody(state: s),
      ),
    );
  }
}

class _CartBody extends ConsumerWidget {
  const _CartBody({required this.state});

  final CartState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(cartControllerProvider.notifier);
    final cart = state.cart;
    final notice = state.notice;
    final shortages = ref.watch(stockShortageProvider);
    // 지금 주소로 배달하지 않는 품목은 숨긴다. 서버 장바구니에는 남아 있어 주소를 바꾸면 다시 보인다.
    final lines = [
      for (final l in cart.lines)
        if (!hiddenAtCurrentAddress(l, shortages)) l,
    ];
    return Column(
      children: [
        if (state.sync == CartSync.unknown)
          MaterialBanner(
            key: const ValueKey('cart-change-unknown'),
            leading: const Icon(Icons.hourglass_top),
            content: Text(
              '${l10n.cartChangeUnknown}\n${l10n.cartChangeUnknownNote}',
            ),
            actions: [
              TextButton(
                key: const ValueKey('cart-check-again'),
                onPressed: controller.checkAgain,
                child: Text(l10n.cartCheckAgain),
              ),
            ],
          ),
        if (notice != null)
          MaterialBanner(
            key: const ValueKey('cart-notice'),
            leading: const Icon(Icons.info_outline),
            content: Text(cartNoticeText(l10n, notice)),
            actions: [
              TextButton(
                onPressed: controller.dismissNotice,
                child: Text(l10n.cartDismiss),
              ),
            ],
          ),
        Expanded(
          child: lines.isEmpty
              ? Center(
                  key: const ValueKey('cart-empty'),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(l10n.cartEmpty),
                      const SizedBox(height: 12),
                      const _AddMoreButton(),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: controller.refresh,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
                    children: [
                      Material(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius: BorderRadius.circular(16),
                        clipBehavior: Clip.antiAlias,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _CartHeader(state: state),
                            for (final line in lines) ...[
                              const Divider(),
                              _CartLineTile(
                                line: line,
                                enabled: state.canChange,
                                unknown: state.sync == CartSync.unknown,
                                busy:
                                    state.busyItemId == line.cartItemId &&
                                    state.sync != CartSync.stable,
                                mfcKnown: cart.mfcId != null,
                                stockUnavailable: cart.inventoryUnavailable,
                              ),
                            ],
                            const Divider(),
                            const _AddMoreButton(),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
        ),
        _CartSummaryBar(cart: cart, state: state),
      ],
    );
  }
}

/// 목록 머리: 보관 기한(서버 `expiresAt` 날짜만 보인다) · 선택 삭제.
class _CartHeader extends ConsumerWidget {
  const _CartHeader({required this.state});

  final CartState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final shortages = ref.watch(stockShortageProvider);
    final selected = state.cart.lines
        .where((l) => l.selected && !hiddenAtCurrentAddress(l, shortages))
        .length;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
      child: Row(
        children: [
          if (state.cart.expiresAt case final at?)
            Expanded(
              child: Text(
                l10n.cartExpiresAt(seoulDate(at)),
                key: const ValueKey('cart-expires'),
                style: theme.textTheme.bodySmall,
              ),
            )
          else
            const Spacer(),
          TextButton(
            key: const ValueKey('cart-remove-selected'),
            style: TextButton.styleFrom(
              foregroundColor: theme.colorScheme.onSurface,
              side: BorderSide(color: theme.colorScheme.outlineVariant),
              minimumSize: const Size(0, 28),
              padding: const EdgeInsets.symmetric(horizontal: 9),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
              textStyle: theme.textTheme.labelMedium,
            ),
            onPressed: (state.canChange && selected > 0)
                ? () => _confirmRemoveSelected(context, ref, selected)
                : null,
            child: Text(l10n.cartRemoveSelected),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmRemoveSelected(
    BuildContext context,
    WidgetRef ref,
    int count,
  ) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cartRemoveSelectedConfirmTitle(count)),
        content: Text(l10n.cartRemoveSelectedConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cartRemoveConfirmCancel),
          ),
          FilledButton(
            key: const ValueKey('cart-remove-selected-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.cartRemoveConfirmOk),
          ),
        ],
      ),
    );
    // 결과 안내(거절·충돌·불명)는 컨트롤러가 장바구니 안내 띠로 올린다.
    if (ok ?? false) {
      await ref.read(cartControllerProvider.notifier).removeSelected();
    }
  }
}

/// 서버 시각 → 서울 날짜 `YYYY-MM-DD`(표시 전용. 기한 판정에 쓰지 않는다).
String seoulDate(DateTime instant) {
  final d = toSeoulWallClock(instant);
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// "+ 상품 추가" — 쇼핑(홈)으로 돌아간다. 장바구니는 그대로.
class _AddMoreButton extends StatelessWidget {
  const _AddMoreButton();

  @override
  Widget build(BuildContext context) => TextButton.icon(
    key: const ValueKey('cart-add-more'),
    style: TextButton.styleFrom(
      minimumSize: const Size.fromHeight(52),
      foregroundColor: Theme.of(context).colorScheme.onSurface,
      textStyle: Theme.of(context).textTheme.titleSmall,
      shape: const RoundedRectangleBorder(),
    ),
    icon: const Icon(Icons.add),
    label: Text(AppLocalizations.of(context).cartAddMore),
    onPressed: () => context.go('/'),
  );
}

class _CartLineTile extends ConsumerStatefulWidget {
  const _CartLineTile({
    required this.line,
    required this.enabled,
    required this.unknown,
    required this.busy,
    required this.mfcKnown,
    required this.stockUnavailable,
  });

  final CartLine line;

  /// 지금 바로 변경을 보낼 수 있는지(선택·삭제용). 수량 ± 는 모아 보내므로 진행 중에도 누를 수 있다.
  final bool enabled;

  /// 직전 변경이 결과 불명 — 확인될 때까지 모든 변경을 막는다.
  final bool unknown;
  final bool busy;

  /// 장바구니에 담당 MFC 가 있는지(없으면 재고를 조회하지 않아 가용이 불명이다).
  final bool mfcKnown;

  /// 재고 원천을 못 받았다(응답 `sources`).
  final bool stockUnavailable;

  @override
  ConsumerState<_CartLineTile> createState() => _CartLineTileState();
}

class _CartLineTileState extends ConsumerState<_CartLineTile> {
  CartLine get line => widget.line;
  bool get enabled => widget.enabled;
  bool get busy => widget.busy;

  /// 아직 보내지 않은 목표 수량(연속 탭을 모은다). null 이면 서버 확정 수량 그대로.
  int? _pending;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// ± 한 번. 잠깐 기다렸다가 최종 수량 한 번만 보낸다(탭마다 왕복 2번 하지 않게). 1 아래로는 삭제 확인.
  void _bump(int delta) {
    final next = (_pending ?? line.quantity) + delta;
    if (next < 1) {
      _timer?.cancel();
      setState(() => _pending = null);
      unawaited(_confirmRemove(context, ref));
      return;
    }
    setState(() => _pending = next);
    _arm(ref.read(cartStepperDelayProvider));
  }

  void _arm(Duration delay) {
    _timer?.cancel();
    _timer = Timer(delay, () => unawaited(_flush()));
  }

  Future<void> _flush() async {
    if (!mounted) return;
    final qty = _pending;
    if (qty == null) return;
    final state = ref.read(cartControllerProvider).value;
    if (state == null) return;
    // 다른 변경이 진행 중이면 끝난 뒤 다시 시도한다(결과 불명이면 버튼이 막혀 있어 여기 오지 않는다).
    if (!state.canChange) return _arm(const Duration(milliseconds: 100));
    if (qty == line.quantity) {
      setState(() => _pending = null);
      return;
    }
    final outcome = await ref
        .read(cartControllerProvider.notifier)
        .submit(SetQuantity(cartItemId: line.cartItemId, quantity: qty));
    if (!mounted) return;
    if (outcome == null) return _arm(const Duration(milliseconds: 100));
    // 보내는 동안 또 눌렀으면(_pending 이 바뀜) 타이머가 다시 보낸다. 아니면 서버 확정본으로 돌아간다.
    if (_pending == qty) setState(() => _pending = null);
  }

  Future<void> _confirmRemove(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cartRemoveConfirmTitle),
        content: Text(l10n.cartRemoveConfirmBody(line.name ?? line.sku)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cartRemoveConfirmCancel),
          ),
          FilledButton(
            key: const ValueKey('cart-remove-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.cartRemoveConfirmOk),
          ),
        ],
      ),
    );
    if (ok ?? false) {
      await ref
          .read(cartControllerProvider.notifier)
          .submit(RemoveItem(cartItemId: line.cartItemId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final controller = ref.read(cartControllerProvider.notifier);
    // 주문하기가 422 INSUFFICIENT_STOCK 으로 막혔을 때 서버가 짚은 상품(order 0.8.0). 수량을 맞추면 사라진다.
    final shortage = switch (ref.watch(stockShortageProvider)[line.sku]) {
      final s? when s.stillShortAt(line.quantity) => s,
      _ => null,
    };
    final reason = switch ((line.saleState, line.availability)) {
      (SaleState.saleStopped, _) => l10n.cartLineSaleStopped,
      (SaleState.temporarilySoldOut, _) ||
      (_, LineAvailability.soldOut) => l10n.cartLineSoldOut,
      // 취급 안 함(NOT_HANDLED)은 목록에서 숨기므로 여기 오지 않는다.
      _ when shortage != null => switch (shortage) {
        StockShortage(availableQty: 0) => l10n.cartLineSoldOut,
        StockShortage(availableQty: final int a) => l10n.cartLineAvailableQty(
          a,
        ),
        _ => l10n.cartLineLowStock,
      },
      (_, LineAvailability.notCarried) => l10n.cartLineNotCarried,
      (SaleState.unknown, _) => l10n.cartLineUnknown,
      // 가용 불명은 "확인 중"이 아니라 왜 모르는지로 나눈다: 배송지 미정(재고 조회 안 함) / 재고 원천 장애.
      (_, LineAvailability.unknown) when !widget.mfcKnown => l10n.cartLineNoMfc,
      (_, LineAvailability.unknown) when widget.stockUnavailable =>
        l10n.cartLineStockUnavailable,
      (_, LineAvailability.unknown) => l10n.cartLineUnknown,
      (_, LineAvailability.low) => switch (line.availableQty) {
        final int n => l10n.cartLineAvailableQty(n),
        null => l10n.cartLineLowStock,
      },
      _ => null,
    };
    final id = line.cartItemId;
    final shown = _pending ?? line.quantity;
    final scheme = theme.colorScheme;
    final pendingLook = _pending != null || busy;
    return Padding(
      key: ValueKey('cart-line-$id'),
      padding: const EdgeInsets.fromLTRB(4, 4, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1줄: 선택 + 상품 이름
          Row(
            children: [
              Checkbox(
                key: ValueKey('cart-select-$id'),
                value: line.selected,
                // 구매 불가 품목은 새로 고르는 것만 막는다. 이미 선택된 채 품절·미취급이 됐으면
                // 해제는 할 수 있어야 한다(선택 합계에서 빼려면). 삭제는 언제나 가능.
                onChanged: (enabled && (line.purchasable || line.selected))
                    ? (v) => controller.submit(
                        SetSelected(cartItemId: id, selected: v ?? false),
                      )
                    : null,
              ),
              Expanded(
                child: Text(
                  line.name ?? line.sku,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(fontSize: 15),
                ),
              ),
            ],
          ),
          // 2줄: 사진 + 옵션·금액
          Padding(
            padding: const EdgeInsets.only(left: 48),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ProductImage(url: line.imageUrl, size: 58, radius: 6),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (line.optionLabel case final String label)
                        Text(label, style: theme.textTheme.bodySmall),
                      if (reason != null)
                        Text(
                          reason,
                          key: ValueKey('cart-reason-$id'),
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: scheme.error,
                          ),
                        ),
                      const SizedBox(height: 2),
                      // 담은 수량만큼의 금액(단가 × 수량). 서버 합계(selectedItemAmount)와 같은 식이며 표시용이다.
                      // 주문 금액은 견적·주문서의 서버 값으로만 확정한다(사용자 요청 2026-11-03: "개당" 대신 수량 금액).
                      Text(
                        switch (line.unitPrice) {
                          final int p => l10n.cartLineAmount(
                            formatKrw(p * line.quantity),
                          ),
                          null => l10n.priceUnavailable,
                        },
                        key: ValueKey('cart-amount-$id'),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontSize: 15,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 3줄: 삭제 + 수량 상자(오른쪽)
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                key: ValueKey('cart-remove-$id'),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onSurfaceVariant,
                ),
                onPressed: enabled ? () => _confirmRemove(context, ref) : null,
                child: Text(l10n.cartRemove),
              ),
              const SizedBox(width: 4),
              DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: scheme.outlineVariant),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // 1개에서는 - 대신 휴지통(누르면 같은 삭제 확인).
                    IconButton(
                      key: ValueKey('cart-dec-$id'),
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints.tightFor(
                        width: 32,
                        height: 30,
                      ),
                      padding: EdgeInsets.zero,
                      iconSize: 17,
                      tooltip: shown <= 1 ? l10n.cartRemove : l10n.cartDecrease,
                      icon: Icon(
                        shown <= 1 ? Icons.delete_outline : Icons.remove,
                      ),
                      onPressed: widget.unknown ? null : () => _bump(-1),
                    ),
                    // 모아 보내는 중·서버 반영 중에는 목표 수량을 흐리게 + 진행 표시. 확정되면 보통 글씨.
                    ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 26),
                      child: Center(
                        child: DefaultTextStyle.merge(
                          style: theme.textTheme.labelLarge,
                          child: Text(
                            l10n.cartLineQuantity(_pending ?? line.quantity),
                            key: ValueKey('cart-qty-$id'),
                            style: pendingLook
                                ? TextStyle(color: scheme.outline)
                                : null,
                          ),
                        ),
                      ),
                    ),
                    if (pendingLook)
                      const SizedBox.square(
                        dimension: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    IconButton(
                      key: ValueKey('cart-inc-$id'),
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints.tightFor(
                        width: 32,
                        height: 30,
                      ),
                      padding: EdgeInsets.zero,
                      iconSize: 17,
                      tooltip: l10n.cartIncrease,
                      icon: const Icon(Icons.add),
                      onPressed: (!widget.unknown && line.purchasable)
                          ? () => _bump(1)
                          : null,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CartSummaryBar extends ConsumerWidget {
  const _CartSummaryBar({required this.cart, required this.state});

  final Cart cart;
  final CartState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final shortages = ref.watch(stockShortageProvider);
    final purchasable = cart.lines
        .where(
          (l) =>
              l.selected &&
              l.purchasable &&
              !hiddenAtCurrentAddress(l, shortages),
        )
        .length;
    return Material(
      color: theme.colorScheme.surface,
      elevation: 12,
      shadowColor: Colors.black26,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(
                    l10n.cartSelectedTotal,
                    style: theme.textTheme.titleSmall,
                  ),
                  const Spacer(),
                  Text(
                    // 서버 합계만 보인다. 변경 확정 뒤 다시 읽는 동안은 "확인 중", 없으면 0원이 아니라 "확인할 수 없어요".
                    switch (cart.selectedItemAmount) {
                      final int a => formatKrw(a),
                      null when state.amountStale => l10n.cartAmountChecking,
                      null => l10n.cartAmountUnavailable,
                    },
                    key: const ValueKey('cart-total'),
                    style: theme.textTheme.titleLarge,
                  ),
                ],
              ),
              Text(
                l10n.cartSelectedAmountNote,
                style: theme.textTheme.bodySmall,
              ),
              if (state.sync == CartSync.pending)
                Text(l10n.cartChangePending, style: theme.textTheme.bodySmall),
              if (cart.hasSelectedPurchasable) const _FirstPurchaseHint(),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: const ValueKey('cart-fee-info'),
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    visualDensity: VisualDensity.compact,
                  ),
                  icon: const Icon(Icons.info_outline, size: 16),
                  label: Text(l10n.cartFeeInfo),
                  onPressed: () => _showFeeInfo(context),
                ),
              ),
              const SizedBox(height: 4),
              FilledButton(
                key: const ValueKey('cart-order'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  textStyle: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                // "주문하기"는 PG 진입이 아니다. 배송 방식 선택 → 주문서로 간다.
                onPressed: (state.canChange && cart.hasSelectedPurchasable)
                    ? () => _order(context, ref)
                    : null,
                // 개수는 지금 고를 수 있는 선택 품목 수(안내), 금액은 서버 합계 그대로(앱에서 더하지 않는다).
                child: Text(switch ((purchasable, cart.selectedItemAmount)) {
                  (0, _) => l10n.cartOrder,
                  (final n, final int a) => l10n.cartOrderCountAmount(
                    n,
                    formatKrw(a),
                  ),
                  (final n, null) => l10n.cartOrderCount(n),
                }, key: const ValueKey('cart-order-label')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 첫 구매 무료배달 "적용 예상" 한 줄. 서버 `GET /delivery-options?itemAmount=` 의 `deliveryTip.reason=FIRST_PURCHASE`
/// (회원만)가 있을 때만 보인다. 확정은 주문서·결제 때 서버가 한다. 조회 실패·미정이면 줄을 두지 않는다(무료 아님으로 단정하지 않음).
class _FirstPurchaseHint extends ConsumerWidget {
  const _FirstPurchaseHint();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(sessionProvider) is! MemberSession) {
      return const SizedBox.shrink();
    }
    final options = ref.watch(deliveryOptionsProvider).value;
    final expected = (options ?? const <DeliveryOption>[]).any(
      (o) => o.available && o.tip?.reason == TipReason.firstPurchase,
    );
    if (!expected) return const SizedBox.shrink();
    return Text(
      AppLocalizations.of(context).firstPurchaseExpected,
      key: const ValueKey('cart-first-purchase'),
      style: Theme.of(context).textTheme.bodySmall,
    );
  }
}

/// 배달팁·봉투값 안내(정적 문구. 업무 문서 Commerce §8.3 기준. 금액은 서버 견적으로만 보인다).
Future<void> _showFeeInfo(BuildContext context) {
  final l10n = AppLocalizations.of(context);
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) {
      final theme = Theme.of(context);
      return SafeArea(
        child: Padding(
          key: const ValueKey('cart-fee-sheet'),
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.cartFeeTipTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(l10n.cartFeeTipBody),
              const SizedBox(height: 16),
              Text(l10n.cartFeeBagTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(l10n.cartFeeBagBody),
              const SizedBox(height: 16),
              Text(l10n.cartFeeMinOrderNote, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      );
    },
  );
}

/// 상품 상세 하단의 담기 막대. 수량은 절대값이다(이미 담겼으면 그 수량에서 시작).
class AddToCartBar extends ConsumerStatefulWidget {
  const AddToCartBar({super.key, required this.sku, required this.enabled});

  final String? sku;

  /// 옵션이 담기를 권해도 되는지(판매 상태·가용 사본).
  final bool enabled;

  @override
  ConsumerState<AddToCartBar> createState() => _AddToCartBarState();
}

class _AddToCartBarState extends ConsumerState<AddToCartBar> {
  int? _quantity;
  String? _skuForQuantity;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(cartControllerProvider);
    final cartState = value.value;
    final sku = widget.sku;
    final inCart = (sku == null) ? null : cartState?.cart.lineForSku(sku);
    if (_skuForQuantity != sku) {
      _skuForQuantity = sku;
      _quantity = null;
    }
    final quantity = _quantity ?? inCart?.quantity ?? 1;
    final canSubmit =
        sku != null &&
        widget.enabled &&
        cartState != null &&
        cartState.canChange;
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      shape: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (value.hasError && cartState == null)
                Text(l10n.cartUnavailableForAdd),
              if (inCart != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    l10n.cartInCart(inCart.quantity),
                    key: const ValueKey('in-cart'),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
              Row(
                children: [
                  IconButton(
                    key: const ValueKey('add-dec'),
                    tooltip: l10n.cartDecrease,
                    onPressed: quantity > 1
                        ? () => setState(() => _quantity = quantity - 1)
                        : null,
                    icon: const Icon(Icons.remove),
                  ),
                  Text(
                    l10n.cartLineQuantity(quantity),
                    key: const ValueKey('add-qty'),
                  ),
                  IconButton(
                    key: const ValueKey('add-inc'),
                    tooltip: l10n.cartIncrease,
                    onPressed: () => setState(() => _quantity = quantity + 1),
                    icon: const Icon(Icons.add),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: CommandButton(
                      key: const ValueKey('add-to-cart'),
                      label: inCart == null
                          ? l10n.cartAdd
                          : l10n.cartUpdateQuantity,
                      onPressed: canSubmit
                          ? () => _submit(sku, quantity, inCart)
                          : null,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submit(String sku, int quantity, CartLine? inCart) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final controller = ref.read(cartControllerProvider.notifier);
    final outcome = await controller.submit(
      inCart == null
          ? AddItem(sku: sku, quantity: quantity)
          : SetQuantity(cartItemId: inCart.cartItemId, quantity: quantity),
    );
    if (!mounted) return;
    final text = switch (outcome) {
      CartChangeApplied() => l10n.cartAdded,
      CartChangeRejected() => cartRejectionText(l10n, outcome),
      CartVersionConflict() => l10n.cartNoticeConflict,
      CartChangeUnknown() => l10n.cartChangeUnknown,
      CartChangeNotApplied() => l10n.cartNoticeNotApplied,
      null => null,
    };
    if (outcome is CartChangeApplied) setState(() => _quantity = null);
    if (text == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          // 버튼이 달린 SnackBar 는 Flutter 기본값으로 자동으로 닫히지 않는다(persist). 알림은 잠시 뒤 닫는다.
          persist: false,
          content: Text(text),
          action: outcome is CartChangeApplied
              ? SnackBarAction(
                  label: l10n.cartGoToCart,
                  onPressed: () => context.go('/cart'),
                )
              : null,
        ),
      );
  }
}

/// 비회원은 주문 목적으로 로그인한 뒤 이어간다(자동 병합 없음).
Future<void> _order(BuildContext context, WidgetRef ref) async {
  if (ref.read(sessionProvider) is! MemberSession) {
    final ok = await context.push<bool>('/login?purpose=checkout');
    if (ok != true || !context.mounted) return;
  }
  ref.read(checkoutSetupProvider.notifier).begin();
  await context.push('/checkout/delivery');
}
