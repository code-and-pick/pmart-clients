import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart'
    show
        CommandStatus,
        IdempotencyKey,
        PmartFailure,
        ProblemFailure,
        UnknownResultFailure;
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../address/presentation/address_screens.dart' show LoginRequired;
import '../../address/presentation/map_pick_screen.dart' show GeoPoint;
import '../../checkout/presentation/delivery_select_screen.dart'
    show modeLabel, windowText;
import '../../checkout/presentation/order_sheet_screen.dart' show tipReasonText;
import '../../checkout/presentation/shipping_address_view.dart';
import '../../claims/domain/claims.dart';
import '../../claims/presentation/claims_controller.dart'
    show claimProvider, orderClaimsProvider;
import '../../claims/presentation/claims_screens.dart'
    show claimStateText, claimTypeText;
import '../../../shared/order_status.dart';
import '../../cart/domain/cart.dart';
import '../../cart/presentation/cart_controller.dart';
import '../../cart/presentation/cart_messages.dart';
import '../../checkout/domain/checkout.dart' show OutOfStockPreference;
import '../data/orders_repository.dart'
    show OrdersRepository, orderNotFinishedCode;
import '../domain/orders.dart';
import '../domain/tracking.dart';
import 'tracking_map.dart';
import 'orders_providers.dart';
import 'receipt_confirmation.dart';
import '../../redelivery/presentation/redelivery_screens.dart'
    show RedeliveryPaymentsSection;
import '../../reviews/presentation/reviews_screens.dart'
    show OrderReviewsSection;

String _money(AppLocalizations l10n, int? v) => switch (v) {
  final int a => formatKrw(a),
  null => l10n.amountUnavailable,
};

/// SCR-ORDER-LIST-001. 조회 실패를 "주문 없음"으로 보이지 않는다.
/// 위 줄: 검색 · 조회 기간 · 상태(레퍼런스 9-1 "주문내역"). 기간 기본은 서버 기본(최근 3개월, order 0.12.0).
class OrderListScreen extends ConsumerStatefulWidget {
  const OrderListScreen({super.key});

  @override
  ConsumerState<OrderListScreen> createState() => _OrderListScreenState();
}

class _OrderListScreenState extends ConsumerState<OrderListScreen> {
  /// 상태 필터. null 이면 전체. 서버에 `status` 로 묻는다(앱에서 거르지 않는다).
  OrderStatus? _status;
  OrderPeriod _period = OrderPeriod.months3;

  /// 적용한 상품명 검색어(서버 `q`). null 이면 검색 안 함.
  String? _q;
  bool _searching = false;
  final _searchCtl = TextEditingController();

  /// 숨기기 진행 중인 주문(버튼 비활성).
  final _hiding = <String>{};

  OrderListQuery get _query =>
      OrderListQuery(status: _status, period: _period, q: _q);

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  String _periodText(AppLocalizations l10n, OrderPeriod p) => switch (p) {
    OrderPeriod.months3 => l10n.ordersPeriod3m,
    OrderPeriod.months6 => l10n.ordersPeriod6m,
    OrderPeriod.year1 => l10n.ordersPeriod1y,
    OrderPeriod.all => l10n.ordersPeriodAll,
  };

  Future<void> _pickPeriod(AppLocalizations l10n) async {
    final picked = await showModalBottomSheet<OrderPeriod>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                l10n.ordersPeriod,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final p in OrderPeriod.values)
              ListTile(
                key: ValueKey('orders-period-${p.name}'),
                title: Text(_periodText(l10n, p)),
                trailing: p == _period ? const Icon(Icons.check) : null,
                onTap: () => Navigator.of(context).pop(p),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (picked != null && picked != _period) setState(() => _period = picked);
  }

  void _applySearch() {
    final q = _searchCtl.text.trim();
    setState(() => _q = q.isEmpty ? null : q);
  }

  void _closeSearch() {
    _searchCtl.clear();
    setState(() {
      _searching = false;
      _q = null;
    });
  }

  /// 숨기기: 확인 창 → `POST /orders/{id}/hides`. 결과를 모르면 같은 키로 한 번 더 보낸다(계약: 같은 키는 같은 결과).
  Future<void> _hide(AppLocalizations l10n, OrderListItem o) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.ordersHideTitle),
        content: Text(l10n.ordersHideBody),
        actions: [
          TextButton(
            key: const ValueKey('orders-hide-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.ordersHideCancel),
          ),
          FilledButton(
            key: const ValueKey('orders-hide-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.ordersHideConfirm),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _hiding.add(o.orderId));
    final repo = ref.read(ordersRepositoryProvider);
    final key = IdempotencyKey.generate();
    String message;
    try {
      CommandStatus status;
      try {
        status = await repo.hide(o.orderId, key: key);
      } on UnknownResultFailure {
        status = await repo.hide(o.orderId, key: key);
      }
      message = switch (status) {
        CommandStatus.applied => l10n.ordersHideDone,
        CommandStatus.accepted => l10n.ordersHideAccepted,
        _ => l10n.ordersHideFailed,
      };
    } on ProblemFailure catch (f) {
      message = f.problem.code == orderNotFinishedCode
          ? l10n.ordersHideNotFinished
          : l10n.ordersHideFailed;
    } on PmartFailure {
      message = l10n.ordersHideFailed;
    }
    if (!mounted) return;
    setState(() => _hiding.remove(o.orderId));
    // 서버 목록이 정본이다. 숨겼든 못 했든 다시 읽는다.
    ref.invalidate(orderListProvider);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _pill({
    required Key key,
    required Widget label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        key: key,
        shape: StadiumBorder(
          side: BorderSide(
            color: selected ? scheme.onSurface : scheme.outlineVariant,
          ),
        ),
        color: scheme.surface,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: DefaultTextStyle.merge(
              style: Theme.of(context).textTheme.bodyMedium,
              child: label,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = orderListProvider(_query);
    final value = ref.watch(provider);
    final filters = SizedBox(
      height: 50,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        children: [
          _pill(
            key: const ValueKey('orders-search-open'),
            selected: _q != null,
            onTap: () => setState(() => _searching = true),
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const PmartLineIcon(PmartLineIcons.search, size: 16),
                const SizedBox(width: 4),
                Text(_q ?? l10n.ordersSearch),
              ],
            ),
          ),
          _pill(
            key: const ValueKey('orders-period'),
            selected: _period != OrderPeriod.months3,
            onTap: () => _pickPeriod(l10n),
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_periodText(l10n, _period)),
                const SizedBox(width: 2),
                const Icon(Icons.keyboard_arrow_down, size: 18),
              ],
            ),
          ),
          for (final s in <OrderStatus?>[null, ...orderListFilters])
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                key: ValueKey('orders-filter-${s?.name ?? 'all'}'),
                label: Text(
                  s == null ? l10n.ordersFilterAll : orderStatusText(l10n, s),
                ),
                selected: _status == s,
                onSelected: (_) => setState(() => _status = s),
              ),
            ),
        ],
      ),
    );
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.ordersTitle),
        // 결제 완료에서 주문 상세로 바로 오면(go) 뒤에 화면이 없다. 그때는 마이로 돌아간다.
        leading: context.canPop()
            ? null
            : IconButton(
                key: const ValueKey('orders-back'),
                icon: const BackButtonIcon(),
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => context.go('/my'),
              ),
      ),
      body: switch (value) {
        AsyncData(value: null) => LoginRequired(
          message: l10n.ordersLoginNeeded,
        ),
        _ => Column(
          children: [
            if (_searching)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 6, 6, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const ValueKey('orders-search-field'),
                        controller: _searchCtl,
                        autofocus: true,
                        maxLength: 100,
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          hintText: l10n.ordersSearchHint,
                          counterText: '',
                          isDense: true,
                          prefixIcon: const Padding(
                            padding: EdgeInsets.all(10),
                            child: PmartLineIcon(
                              PmartLineIcons.search,
                              size: 18,
                            ),
                          ),
                        ),
                        onSubmitted: (_) => _applySearch(),
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('orders-search-close'),
                      icon: const Icon(Icons.close),
                      tooltip: MaterialLocalizations.of(context)
                          .closeButtonTooltip,
                      onPressed: _closeSearch,
                    ),
                  ],
                ),
              ),
            filters,
            Expanded(
              child: ColoredBox(
                color: Theme.of(context).colorScheme.surfaceContainer,
                child: _list(l10n, provider, value),
              ),
            ),
          ],
        ),
      },
    );
  }

  /// 주문 카드 한 장: 배송 방식·상태 · "주문 상세" 알약 / 주문 시각(크게) / 대표 상품 · 금액 / (끝난 주문) 삭제.
  Widget _orderCard(
    BuildContext context,
    AppLocalizations l10n,
    OrderListItem o,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final mode = o.deliveryMode;
    final summary = switch ((o.representativeName, o.othersQty)) {
      (final String name, final int others) when others > 0 =>
        l10n.ordersRepresentative(name, others),
      (final String name, _) when o.representativeQty != null =>
        l10n.ordersRepresentativeOnly(name, o.representativeQty!),
      (final String name, _) => name,
      // 2026-11-02 전 주문은 상품명 사본이 없다 → "상품 N개".
      (null, _) when o.itemCount != null => l10n.ordersItemCount(o.itemCount!),
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (mode != null)
              Text(
                '${modeLabel(l10n, mode)} · ',
                key: ValueKey('order-mode-${o.orderId}'),
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            Expanded(
              child: Text(
                orderStatusText(l10n, o.status),
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: mode == null ? FontWeight.w800 : FontWeight.w500,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
              decoration: BoxDecoration(
                color: scheme.surfaceContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                l10n.orderDetailTitle,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 11.5,
                  color: scheme.onSurface,
                ),
              ),
            ),
          ],
        ),
        if (o.orderedAt case final t?) ...[
          const SizedBox(height: 10),
          Text(
            formatSeoulDateTime(t),
            style: theme.textTheme.titleLarge?.copyWith(fontSize: 19),
          ),
        ],
        const SizedBox(height: 6),
        Row(
          children: [
            if (summary != null)
              Expanded(
                child: Text(
                  summary,
                  key: ValueKey('order-summary-${o.orderId}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium,
                ),
              )
            else
              const Spacer(),
            const SizedBox(width: 8),
            Text(
              _money(l10n, o.totalAmount),
              style: theme.textTheme.titleSmall,
            ),
          ],
        ),
        if (o.canHide)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: ValueKey('order-hide-${o.orderId}'),
              style: TextButton.styleFrom(
                foregroundColor: scheme.onSurfaceVariant,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onPressed: _hiding.contains(o.orderId)
                  ? null
                  : () => _hide(l10n, o),
              child: Text(l10n.ordersHide),
            ),
          ),
      ],
    );
  }

  Widget _list(
    AppLocalizations l10n,
    FutureProvider<OrderPage?> provider,
    AsyncValue<OrderPage?> value,
  ) {
    final filtered = _status != null;
    final narrowed = _q != null || _period != OrderPeriod.months3;
    return UiStateView<OrderPage?>(
      state: uiStateOf(value, isEmpty: (p) => p!.items.isEmpty),
      onRetry: () => ref.invalidate(provider),
      // 조건이 걸려 있으면 "주문 없음"이 아니라 "이 조건의 주문 없음"이다.
      empty: (_) => Center(
        key: ValueKey(
          narrowed
              ? 'orders-empty-search'
              : filtered
              ? 'orders-empty-filtered'
              : 'orders-empty',
        ),
        child: Text(
          narrowed
              ? l10n.ordersEmptySearch
              : filtered
              ? l10n.ordersEmptyFiltered
              : l10n.ordersEmpty,
        ),
      ),
      ready: (context, page) => RefreshIndicator(
        onRefresh: () => ref.refresh(provider.future),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 20),
          children: [
            for (final o in page!.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Material(
                  key: ValueKey('order-${o.orderId}'),
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(16),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () async {
                      await context.push('/orders/${o.orderId}');
                      // 상세에서 취소·변경을 했을 수 있다. 돌아오면 목록을 다시 읽는다.
                      if (context.mounted) ref.invalidate(orderListProvider);
                    },
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        18,
                        14,
                        18,
                        o.canHide ? 6 : 16,
                      ),
                      child: _orderCard(context, l10n, o),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// SCR-ORDER-DETAIL-001. 주문 당시 스냅샷 + 원천별 기준시각. 분할배송은 배송별로 보인다.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final provider = orderDetailProvider(orderId);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.orderDetailTitle)),
      body: UiStateView<OrderDetail>(
        state: uiStateOf(ref.watch(provider)),
        onRetry: () => ref.invalidate(provider),
        ready: (context, o) => RefreshIndicator(
          onRefresh: () => ref.refresh(provider.future),
          child: _OrderBody(order: o),
        ),
      ),
    );
  }
}

class _OrderBody extends ConsumerWidget {
  const _OrderBody({required this.order});

  final OrderDetail order;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final o = order;
    final byLine = {for (final l in o.lines) l.orderLineId: l};

    /// 취소·변경·처리 내역 화면에 다녀오면 주문이 바뀌었을 수 있다. 돌아올 때 상세·목록을 다시 읽는다.
    Future<void> visit(String location) async {
      await context.push(location);
      if (!context.mounted) return;
      ref.invalidate(orderDetailProvider(o.orderId));
      ref.invalidate(orderClaimsProvider(o.orderId));
      ref.invalidate(orderListProvider);
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _DetailBox(
          children: [
            Text(
              orderStatusText(l10n, o.status),
              key: const ValueKey('order-status'),
              style: theme.textTheme.titleLarge,
            ),
            if (o.window case final w?)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(windowText(w), style: theme.textTheme.titleSmall),
              ),
            const SizedBox(height: 6),
            Text(
              l10n.payOrderNumber(o.displayNumber),
              key: const ValueKey('order-number'),
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
        // 배송현황(지도) — 결제가 끝나고 배송이 끝나기 전이면 늘 보인다. 배송 ID 를 몰라도 지도부터 뜬다(BR-61).
        if (_trackable(o.status))
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: FilledButton.icon(
              key: const ValueKey('order-track'),
              icon: const PmartLineIcon(PmartLineIcons.locate, size: 20),
              label: Text(l10n.trackOrder),
              onPressed: () => visit('/orders/${o.orderId}/tracking'),
            ),
          ),
        // 오배송 다시 배송비 결제(있을 때만). 알림 "결제 필요"(목적지 ORDER)를 열면 이 주문 상세로 온다.
        RedeliveryPaymentsSection(orderId: o.orderId),
        for (final s in o.staleSources)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              s.asOf == null
                  ? l10n.sourceStaleNoTime
                  : l10n.sourceStale(formatSeoulTime(s.asOf!)),
              key: ValueKey('stale-${s.system}'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ),
        if (o.isSplit)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(l10n.splitShipment(o.shipments.length)),
          ),
        for (final (i, s) in o.shipments.indexed)
          Card(
            key: ValueKey('shipment-${s.shipmentId}'),
            margin: const EdgeInsets.only(top: 10),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: theme.colorScheme.outlineVariant),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 6, 6, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          o.isSplit
                              ? l10n.shipmentN(
                                  i + 1,
                                  shipmentStateText(l10n, s.state),
                                )
                              : shipmentStateText(l10n, s.state),
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                      if (s.deliveryId case final id?)
                        TextButton(
                          key: ValueKey('track-$id'),
                          onPressed: () => visit(
                            '/deliveries/$id?orderId=${Uri.encodeQueryComponent(o.orderId)}',
                          ),
                          child: Text(l10n.trackDelivery),
                        ),
                    ],
                  ),
                  // 주문 당시 상품명·옵션 사본(BR-35). 없을 때만 sku.
                  for (final sl in s.lines)
                    Text(
                      '${byLine[sl.orderLineId]?.title ?? sl.orderLineId} · ${l10n.cartLineQuantity(sl.qty)}',
                    ),
                  // "받았어요"(수령 확인): 배송 중인 배송만 도착 예상 단계를 묻는다. 누른 뒤에는 결과를 남긴다.
                  if (s.deliveryId case final id?
                      when s.state == ShipmentState.handedOver ||
                          s.state == ShipmentState.inDelivery ||
                          ref.watch(
                            receiptConfirmationProvider((
                              orderId: o.orderId,
                              deliveryId: id,
                            )),
                          ) is! ReceiptIdle)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ReceiptConfirmation(
                        orderId: o.orderId,
                        deliveryId: id,
                      ),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        // 주문 당시 배송지 사본(BR-37). 주소록을 다시 부르지 않는다.
        _DetailTitle(l10n.checkoutAddress),
        _DetailBox(children: [ShippingAddressView(address: o.shippingAddress)]),
        // 배달 정보: 주문에 남은 요청사항·품절 시 처리(계약 `deliveryNote`·`outOfStockPreference`). 없으면 줄을 두지 않는다.
        if (o.deliveryNote != null || o.outOfStock != null) ...[
          const SizedBox(height: 16),
          _DetailTitle(l10n.orderDeliveryInfo),
          _DetailBox(
            children: [
              if (o.deliveryNote case final n?)
                _Row(
                  l10n.orderDeliveryNote,
                  n,
                  key: const ValueKey('order-note'),
                ),
              if (o.outOfStock case final p?)
                _Row(l10n.orderOutOfStock, switch (p) {
                  OutOfStockPreference.cancelOutOfStockOnly => l10n.oosOnly,
                  OutOfStockPreference.cancelAll => l10n.oosAll,
                }, key: const ValueKey('order-oos')),
            ],
          ),
        ],
        const SizedBox(height: 16),
        _OrderLinesSection(order: o),
        const SizedBox(height: 16),
        _DetailTitle(l10n.checkoutAmounts),
        _DetailBox(
          children: [
            _Row(l10n.amountItems, _money(l10n, o.quote?.itemAmount)),
            if (o.quote case final q?)
              _Row(
                '${l10n.amountTip} (${tipReasonText(l10n, q.tipReason)})',
                _money(l10n, q.deliveryTip),
              ),
            _Row(l10n.amountBag, _money(l10n, o.quote?.bagFee)),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Divider(),
            ),
            _Row(
              l10n.amountTotal,
              _money(l10n, o.quote?.totalAmount),
              strong: true,
            ),
            _PaymentMethodRow(paymentAttemptId: o.paymentAttemptId),
            if ((o.refundedAmount ?? 0) > 0)
              _Row(
                l10n.refundedAmount,
                formatKrw(o.refundedAmount!),
                key: const ValueKey('refunded'),
              ),
          ],
        ),
        _ClaimsSection(order: o, onVisit: visit),
        // 배송 완료된 배송이 있는 주문만 리뷰 자격을 묻는다(작성 가능 여부는 서버 자격 값으로만 판단).
        if (o.shipments.any((s) => s.state == ShipmentState.delivered))
          OrderReviewsSection(
            orderId: o.orderId,
            lineTitles: {for (final l in o.lines) l.orderLineId: l.title},
          ),
        const SizedBox(height: 16),
        // 버튼은 요청 진입일 뿐이다. 가능 여부는 서버가 판정한다.
        if (canRequestTimeChange(o))
          OutlinedButton(
            key: const ValueKey('reschedule'),
            onPressed: () => visit('/orders/${o.orderId}/reschedule'),
            child: Text(l10n.rescheduleTitle),
          ),
        if (canRequestCancel(o))
          OutlinedButton(
            key: const ValueKey('cancel-order'),
            onPressed: () => visit('/orders/${o.orderId}/cancel'),
            child: Text(l10n.cancelTitle),
          )
        else if (cancelClosedByPreparing(o))
          // 피킹이 시작되면 앱에서 취소할 수 없다(ADR-0060) — 버튼 대신 안내.
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              l10n.cancelClosedPreparing,
              key: const ValueKey('cancel-closed-preparing'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        // 고객센터 문의(주문을 고른 상태로). 접수일 뿐 주문을 바꾸지 않는다.
        OutlinedButton(
          key: const ValueKey('order-inquiry'),
          // 무엇을 도와드릴까요?(배송 신고 종류 · 그 외 문의) — 레퍼런스 9-2 3-1.
          onPressed: () => visit('/orders/${o.orderId}/help'),
          child: Text(l10n.orderInquiry),
        ),
      ],
    );
  }
}

/// 주문 상세의 구획 제목(카드 밖).
class _DetailTitle extends StatelessWidget {
  const _DetailTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
    child: Text(
      text,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 14.5),
    ),
  );
}

/// 주문 상세의 테두리 카드.
class _DetailBox extends StatelessWidget {
  const _DetailBox({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    ),
  );
}

/// 주문의 처리 내역(취소·반품·교환). 서버는 주문 상세의 `claims` 를 아직 비워 보내므로 `GET /claims?orderId=` 로 받고,
/// 상세에 들어 있는 항목이 있으면 합친다. 조회 실패는 "내역 없음"으로 보이지 않는다.
class _ClaimsSection extends ConsumerWidget {
  const _ClaimsSection({required this.order, required this.onVisit});

  final OrderDetail order;
  final Future<void> Function(String location) onVisit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final provider = orderClaimsProvider(order.orderId);
    final value = ref.watch(provider);
    final fetched = value.value ?? const <ClaimSummaryView>[];
    final ids = {for (final c in fetched) c.claimId};
    final items = [
      ...fetched,
      for (final c in order.claims)
        if (!ids.contains(c.claimId))
          ClaimSummaryView(
            claimId: c.claimId,
            orderId: order.orderId,
            type: claimTypeFromWire(c.type),
            state: claimStateFromWire(c.state),
          ),
    ];
    // 취소한 주문이 아니면 처리 내역 영역을 두지 않는다. 조회 실패도 취소된 주문(내역이 있어야 하는 주문)에서만
    // 보인다 — 취소하지 않은 주문마다 실패 문구가 뜨지 않게(사용자 요청 2026-11-03).
    final failed =
        value.hasError &&
        !value.hasValue &&
        (order.status == OrderStatus.cancelled || order.claims.isNotEmpty);
    if (items.isEmpty && !failed) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Text(l10n.orderClaimsTitle, style: theme.textTheme.titleMedium),
        if (failed)
          Row(
            key: const ValueKey('order-claims-failed'),
            children: [
              Expanded(
                child: Text(
                  l10n.orderClaimsLoadFailed,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
              TextButton(
                onPressed: () => ref.invalidate(provider),
                child: Text(l10n.checkoutCheckAgain),
              ),
            ],
          ),
        // 취소된 주문이면 가장 최근 취소 클레임의 사유로 자동 취소인지 본다(주문 상세 `claims` 는 아직 비어 있다)
        if (order.status == OrderStatus.cancelled)
          if (items.where((c) => c.type == ClaimType.cancel).firstOrNull
              case final latest?)
            _AutoCancelNotice(claimId: latest.claimId),
        for (final c in items)
          ListTile(
            key: ValueKey('order-claim-${c.claimId}'),
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.assignment_return_outlined),
            title: Text(claimTypeText(l10n, c.type)),
            subtitle: Text(
              [
                claimStateText(l10n, c.state, type: c.type),
                if (c.openedAt case final t?)
                  l10n.claimOpenedAt(formatSeoulDateTime(t)),
              ].join(' · '),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onVisit('/claims/${c.claimId}'),
          ),
      ],
    );
  }
}

/// 시스템 자동 전체 취소 안내(백엔드 공지 2026-11-07). 주문이 취소로 확정된 뒤에만 그린다.
/// 클레임 조회가 실패하거나 아직이면 아무것도 보이지 않는다 — 처리 내역 줄은 그대로 있어 눌러 볼 수 있다.
class _AutoCancelNotice extends ConsumerWidget {
  const _AutoCancelNotice({required this.claimId});

  final String claimId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auto = ref.watch(claimProvider(claimId)).value?.autoCancelled;
    if (auto != true) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(
        AppLocalizations.of(context).claimAutoCancelled,
        key: const ValueKey('order-auto-cancelled'),
      ),
    );
  }
}

/// 결제 수단(`GET /payments/{paymentAttemptId}.method`). 조회 실패는 "정보 없음"이 아니라 실패 + 다시 조회.
class _PaymentMethodRow extends ConsumerWidget {
  const _PaymentMethodRow({required this.paymentAttemptId});

  final String? paymentAttemptId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final id = paymentAttemptId;
    if (id == null) {
      return _Row(
        l10n.orderPaymentMethod,
        l10n.orderPaymentMethodNone,
        key: const ValueKey('order-payment-method'),
      );
    }
    final provider = orderPaymentProvider(id);
    final value = ref.watch(provider);
    if (value.hasError && !value.hasValue) {
      return Row(
        key: const ValueKey('order-payment-method-failed'),
        children: [
          Expanded(
            child: Text(
              l10n.orderPaymentMethodFailed,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
          TextButton(
            onPressed: () => ref.invalidate(provider),
            child: Text(l10n.checkoutCheckAgain),
          ),
        ],
      );
    }
    return _Row(l10n.orderPaymentMethod, switch (value) {
      AsyncData(:final value) => value.method ?? l10n.orderPaymentMethodNone,
      _ => l10n.orderPaymentMethodChecking,
    }, key: const ValueKey('order-payment-method'));
  }
}

/// 한 줄의 "같은 상품 담기" 결과. 서버 응답을 그대로 안내한다(담기 전 판정·추정 없음).
@immutable
sealed class _Reorder {
  const _Reorder();
}

final class _ReorderRunning extends _Reorder {
  const _ReorderRunning();
}

final class _ReorderDone extends _Reorder {
  const _ReorderDone(this.outcome);

  final CartChangeOutcome outcome;
}

/// 같은 SKU 가 이미 장바구니에 있다. 담기는 절대 수량 설정이라 보내면 담아 둔 수량을 바꾸므로 보내지 않는다.
final class _ReorderInCart extends _Reorder {
  const _ReorderInCart(this.quantity);

  final int quantity;
}

/// 장바구니가 다른 변경(결과 불명 포함)을 처리 중이라 보내지 않았다.
final class _ReorderBusy extends _Reorder {
  const _ReorderBusy();
}

/// 장바구니를 불러오지 못해 보내지 않았다.
final class _ReorderCartFailed extends _Reorder {
  const _ReorderCartFailed();
}

/// 주문 상품 + "같은 상품 담기"(Commerce 주문내역: 과거 주문 수정이 아니라 현재 조건의 새 담기, 성공 항목만 담김).
/// 품목마다 기존 장바구니 담기 경로(AddItem)로 보내고 결과를 그 줄에 보인다. "전체 다시 담기"는 차례로 보낸다.
class _OrderLinesSection extends ConsumerStatefulWidget {
  const _OrderLinesSection({required this.order});

  final OrderDetail order;

  @override
  ConsumerState<_OrderLinesSection> createState() => _OrderLinesSectionState();
}

class _OrderLinesSectionState extends ConsumerState<_OrderLinesSection> {
  final _results = <String, _Reorder>{};
  bool _running = false;

  bool _settled(_Reorder? r) =>
      r is _ReorderInCart ||
      (r is _ReorderDone && r.outcome is CartChangeApplied);

  /// 한 줄 담기. 다음 줄로 이어가도 되는지 돌려준다(결과 불명·장바구니 바쁨·조회 실패면 멈춘다).
  Future<bool> _add(OrderLineView line) async {
    setState(() => _results[line.orderLineId] = const _ReorderRunning());
    _Reorder result;
    try {
      final cart = await ref.read(cartControllerProvider.future);
      final inCart = cart.cart.lineForSku(line.sku);
      if (inCart != null) {
        result = _ReorderInCart(inCart.quantity);
      } else {
        final qty = line.originalQty ?? 1;
        final outcome = await ref
            .read(cartControllerProvider.notifier)
            .submitWhenReady(
              AddItem(sku: line.sku, quantity: qty < 1 ? 1 : qty),
            );
        result = outcome == null ? const _ReorderBusy() : _ReorderDone(outcome);
      }
    } on PmartFailure {
      result = const _ReorderCartFailed();
    }
    if (!mounted) return false;
    setState(() => _results[line.orderLineId] = result);
    return switch (result) {
      _ReorderDone(:final outcome) => outcome is! CartChangeUnknown,
      _ReorderInCart() => true,
      _ => false,
    };
  }

  Future<void> _run(List<OrderLineView> lines) async {
    if (_running) return;
    setState(() => _running = true);
    try {
      for (final l in lines) {
        if (_settled(_results[l.orderLineId])) continue;
        if (!await _add(l)) break;
      }
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  String? _text(AppLocalizations l10n, _Reorder? r) => switch (r) {
    null => null,
    _ReorderRunning() => l10n.reorderRunning,
    _ReorderInCart(:final quantity) => l10n.cartInCart(quantity),
    _ReorderBusy() => l10n.reorderBusy,
    _ReorderCartFailed() => l10n.cartUnavailableForAdd,
    _ReorderDone(:final outcome) => switch (outcome) {
      CartChangeApplied() => l10n.cartAdded,
      CartChangeRejected() => cartRejectionText(l10n, outcome),
      CartVersionConflict() => l10n.cartNoticeConflict,
      CartChangeUnknown() => l10n.cartChangeUnknown,
      CartChangeNotApplied() => l10n.cartNoticeNotApplied,
    },
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final lines = widget.order.lines;
    final anyAdded = _results.values.any(
      (r) => r is _ReorderDone && r.outcome is CartChangeApplied,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.checkoutItems,
                style: theme.textTheme.titleMedium,
              ),
            ),
            if (lines.isNotEmpty)
              TextButton.icon(
                key: const ValueKey('reorder-all'),
                icon: const Icon(Icons.add_shopping_cart, size: 18),
                label: Text(l10n.reorderAll),
                onPressed: _running ? null : () => _run(lines),
              ),
          ],
        ),
        if (lines.isNotEmpty)
          Text(l10n.reorderNote, style: theme.textTheme.bodySmall),
        for (final l in lines) ...[
          _LineTile(
            line: l,
            action: TextButton(
              key: ValueKey('reorder-${l.orderLineId}'),
              onPressed: (_running || _settled(_results[l.orderLineId]))
                  ? null
                  : () => _run([l]),
              child: Text(l10n.reorderLine),
            ),
          ),
          if (_text(l10n, _results[l.orderLineId]) case final t?)
            Text(
              t,
              key: ValueKey('reorder-result-${l.orderLineId}'),
              style: theme.textTheme.bodySmall?.copyWith(
                color:
                    (_settled(_results[l.orderLineId]) ||
                        _results[l.orderLineId] is _ReorderRunning)
                    ? null
                    : theme.colorScheme.error,
              ),
            ),
        ],
        if (anyAdded)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const ValueKey('reorder-go-cart'),
              onPressed: () => context.go('/cart'),
              child: Text(l10n.cartGoToCart),
            ),
          ),
      ],
    );
  }
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, this.action});

  final OrderLineView line;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final l = line;
    // 서버가 나눠 준 수량만 보인다(앱에서 빼거나 더하지 않는다).
    final notes = [
      if ((l.cancelledBeforeShipQty ?? 0) > 0)
        l10n.qtyCancelled(l.cancelledBeforeShipQty!),
      if ((l.deliveredQty ?? 0) > 0) l10n.qtyDelivered(l.deliveredQty!),
      if ((l.returnedQty ?? 0) > 0) l10n.qtyReturned(l.returnedQty!),
      if ((l.unfulfilledQty ?? 0) > 0) l10n.qtyUnfulfilled(l.unfulfilledQty!),
    ];
    return ListTile(
      key: ValueKey('line-${l.orderLineId}'),
      contentPadding: EdgeInsets.zero,
      // 주문 당시 상품명·옵션 사본(BR-35). 없을 때만 sku.
      title: Text(l.title),
      subtitle: notes.isEmpty ? null : Text(notes.join(' · ')),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            [
              if (l.originalQty case final q?) l10n.cartLineQuantity(q),
              if (l.unitPrice case final p?) formatKrw(p),
            ].join(' · '),
          ),
          ?action,
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {super.key, this.strong = false});

  final String label;
  final String value;

  /// 합계 줄처럼 굵고 크게.
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final style = strong
        ? text.titleMedium?.copyWith(fontSize: 16)
        : text.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}

/// SCR-TRACK-001. 위치 조회 실패는 배송 실패가 아니다. 다른 고객 정보는 받지도 보이지도 않는다.
///
/// 실시간 구독(`GET /deliveries/{id}/stream`)으로 갱신하고, 끊기면 재연결(1·2·4…초)을 시도하는 동안
/// 도착 예상(`GET /deliveries/{id}/eta`)을 주기 조회한다. 화면을 닫거나 앱이 가려지면 연결을 닫는다.
/// [orderId] 가 있으면(주문 상세에서 진입) 주문·배송 상태로 4단계와 예약 시각·변경/취소 진입을 보인다.
///
/// 라이더 지도(레퍼런스 8-5): 배달 중(TO_CUSTOMER·AT_CUSTOMER)이면 지도 위에 라이더·내 배송지 마커를 그리고
/// 아래 시트에 진행을 보인다. 라이더 위치는 구독의 `ETA_UPDATED` 에 실린 `eta.riderLocation` 으로 옮긴다
/// (PC 5 요청 2026-11-19 — 서버는 새 위치를 3초 안에 보낸다). 구독이 끊겼거나 다시 붙는 동안에만
/// `GET /eta` 를 [riderLocationRefreshIntervalProvider](10초)마다 읽는다. 서버가 위치를 주지 않으면 마커를 숨기고,
/// 받은 지 60초가 넘은 위치는 흐리게 + "라이더 위치를 확인하고 있어요".
class TrackingScreen extends ConsumerStatefulWidget {
  const TrackingScreen({super.key, required this.deliveryId, this.orderId});

  final String deliveryId;
  final String? orderId;

  @override
  ConsumerState<TrackingScreen> createState() => _TrackingScreenState();
}

/// 실시간 연결 상태. [polling] 일 때만 "주기적으로 확인" 문구를 보인다.
enum _Live { connecting, live, polling, ended, paused }

class _TrackingScreenState extends ConsumerState<TrackingScreen>
    with WidgetsBindingObserver {
  late final OrdersRepository _repo;
  StreamSubscription<TrackingEvent>? _sub;
  Timer? _poll;
  Timer? _retry;

  /// 구독이 없는 동안의 라이더 위치 다시 읽기(10초).
  Timer? _locPoll;
  int _failures = 0;
  String? _lastEventId;

  /// 구독으로 받은 최신 도착 예상. 주기 조회로 넘어가면 비운다(조회 값이 더 새롭다).
  DeliveryEtaView? _live;
  _Live _mode = _Live.connecting;

  @override
  void initState() {
    super.initState();
    _repo = ref.read(ordersRepositoryProvider);
    WidgetsBinding.instance.addObserver(this);
    _connect();
    _startLocationPoll();
  }

  /// 구독이 끊겼거나 다시 붙는 동안(배달 중일 때만) 도착 예상을 다시 읽어 라이더 위치를 새로 받는다.
  /// 구독이 붙어 있으면 읽지 않는다 — 위치는 `ETA_UPDATED` 로 온다. 픽업 전·끝난 뒤엔 서버가 위치를 주지 않는다.
  void _startLocationPoll() {
    _locPoll?.cancel();
    _locPoll = Timer.periodic(ref.read(riderLocationRefreshIntervalProvider), (
      _,
    ) {
      if (!mounted ||
          _mode == _Live.paused ||
          _mode == _Live.ended ||
          _mode == _Live.live) {
        return;
      }
      final stage =
          (_live ?? ref.read(deliveryEtaProvider(widget.deliveryId)).value)
              ?.stage;
      if (_isDelivering(stage)) {
        ref.invalidate(deliveryEtaProvider(widget.deliveryId));
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        if (_mode == _Live.paused) _resume();
      case AppLifecycleState.hidden ||
          AppLifecycleState.paused ||
          AppLifecycleState.detached:
        _pause();
      case AppLifecycleState.inactive:
        break;
    }
  }

  void _stop() {
    _sub?.cancel();
    _sub = null;
    _poll?.cancel();
    _poll = null;
    _retry?.cancel();
    _retry = null;
    _locPoll?.cancel();
    _locPoll = null;
  }

  void _pause() {
    if (_mode == _Live.paused || _mode == _Live.ended) return;
    _stop();
    if (mounted) setState(() => _mode = _Live.paused);
  }

  void _resume() {
    if (_mode != _Live.paused) return;
    _failures = 0;
    _refreshAll();
    setState(() {
      _live = null;
      _mode = _Live.connecting;
    });
    _connect();
    _startLocationPoll();
  }

  void _refreshAll() {
    ref.invalidate(deliveryEtaProvider(widget.deliveryId));
    _refreshOrder();
  }

  void _refreshOrder() {
    if (widget.orderId case final id?) ref.invalidate(orderDetailProvider(id));
  }

  void _connect() {
    _sub?.cancel();
    _sub = _repo
        .track(widget.deliveryId, lastEventId: _lastEventId)
        .listen(
          _onEvent,
          onError: (Object _) => _onDrop(),
          onDone: _onDone,
          cancelOnError: true,
        );
  }

  void _onEvent(TrackingEvent e) {
    if (!mounted) return;
    _lastEventId = e.id ?? _lastEventId;
    _failures = 0;
    _retry?.cancel();
    _retry = null;
    _poll?.cancel();
    _poll = null;
    final current =
        _live ?? ref.read(deliveryEtaProvider(widget.deliveryId)).value;
    setState(() {
      _mode = e.type == TrackingEventType.streamEnd ? _Live.ended : _Live.live;
      if (e.eta case final eta?) {
        _live = eta;
      } else if (e.type == TrackingEventType.stageChanged &&
          e.stage != null &&
          current != null) {
        _live = current.withStage(e.stage!);
      }
    });
    // 단계가 바뀌거나 배송이 끝나면 주문·배송 상태를 서버에 다시 묻는다(완료 여부는 그 값으로만).
    if (e.type == TrackingEventType.stageChanged ||
        e.type == TrackingEventType.streamEnd) {
      _refreshOrder();
    }
  }

  void _onDone() {
    _sub = null;
    if (!mounted) return;
    if (_mode == _Live.ended) {
      // 서버가 배송 종료 뒤 닫았다. 다시 붙지 않고 마지막 값을 한 번 확인한다.
      _refreshAll();
      return;
    }
    _onDrop();
  }

  /// 끊김·연결 실패: 주기 조회로 넘어가고, 늘어나는 간격으로 다시 붙는다. 배송 실패가 아니다.
  void _onDrop() {
    _sub = null;
    if (!mounted || _mode == _Live.paused || _mode == _Live.ended) return;
    _failures++;
    setState(() {
      _mode = _Live.polling;
      _live = null;
    });
    if (_poll == null) {
      ref.invalidate(deliveryEtaProvider(widget.deliveryId));
      _poll = Timer.periodic(ref.read(etaRefreshIntervalProvider), (_) {
        if (mounted) _refreshAll();
      });
    }
    _retry?.cancel();
    _retry = Timer(ref.read(trackingReconnectDelayProvider)(_failures), () {
      if (mounted && _mode == _Live.polling) _connect();
    });
  }

  /// 취소·시간 변경 화면에 다녀오는 동안은 연결을 닫고, 돌아오면 주문·배송을 다시 읽고 다시 붙는다.
  Future<void> _visit(String location) async {
    _pause();
    await context.push(location);
    if (!mounted) return;
    ref.invalidate(orderListProvider);
    _refreshAll();
    _resume();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = deliveryEtaProvider(widget.deliveryId);
    final value = ref.watch(provider);
    final order = switch (widget.orderId) {
      final id? => ref.watch(orderDetailProvider(id)),
      null => null,
    };
    final live = _live;
    // 배송현황은 늘 지도 화면이다(사용자 2026-11-19 "지도 바로 뜨게"). 라이더 위치는 배달 중에만 서버가 준다 —
    // 구독 값이 있으면 그것만(null 이면 숨김 — 예전 조회 값으로 채우지 않는다), 구독이 없으면 조회 값.
    final current = live ?? value.value;
    final rider = _isDelivering(current?.stage) ? current?.riderLocation : null;
    final ship = order?.value?.shippingAddress;
    final home = switch ((ship?.lat, ship?.lng)) {
      (final double lat, final double lng) => (lat: lat, lng: lng),
      // 사본에 핀이 없으면 배송지 도로명을 서버 주소 변환으로 찾아 지도 가운데·집 마커로 쓴다.
      _ => switch (ship?.roadAddress) {
        final road? => ref.watch(trackingHomeProvider(road)).value,
        null => null,
      },
    };
    final Widget sheet = switch (value) {
      _ when current != null => _TrackBody(
        eta: current,
        deliveryId: widget.deliveryId,
        order: order,
        polling: _mode == _Live.polling,
        onVisit: _visit,
        sheet: true,
        rider: rider,
      ),
      // 조회 실패: "배송 실패"가 아니라 "위치를 불러오지 못함"이다.
      AsyncError() => Padding(
        key: const ValueKey('eta-failed'),
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
        child: Column(
          children: [
            Text(l10n.etaLoadFailed, textAlign: TextAlign.center),
            if (_mode == _Live.polling) ...[
              const SizedBox(height: 8),
              Text(
                l10n.trackLiveFallback,
                key: const ValueKey('track-live-fallback'),
              ),
            ],
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => ref.invalidate(provider),
              child: Text(l10n.checkoutCheckAgain),
            ),
          ],
        ),
      ),
      _ => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
    };
    return _mapScaffold(context, sheet, rider, home);
  }

  Widget _mapScaffold(
    BuildContext context,
    Widget sheet,
    RiderPosition? rider,
    GeoPoint? home,
  ) {
    final orderId = widget.orderId;
    return TrackMapLayout(
      map: TrackingMap(
        rider: switch (rider) {
          final r? => (lat: r.lat, lng: r.lng),
          null => null,
        },
        riderStale: rider?.stale ?? false,
        home: home,
      ),
      sheet: sheet,
      onInquiry: orderId == null ? null : () => _visit('/orders/$orderId/help'),
    );
  }
}

/// 레퍼런스 8-5: 지도 전체 + 아래 끌어 올리는 시트(진행·도착 예상). 위 왼쪽 뒤로, 오른쪽 문의하기.
class TrackMapLayout extends StatelessWidget {
  const TrackMapLayout({
    super.key,
    required this.map,
    required this.sheet,
    this.onInquiry,
  });

  final Widget map;
  final Widget sheet;
  final VoidCallback? onInquiry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey('track-map-mode'),
      body: Stack(
        children: [
          Positioned.fill(child: map),
          DraggableScrollableSheet(
            initialChildSize: TrackingMap.sheetFraction,
            minChildSize: 0.3,
            maxChildSize: 0.92,
            builder: (context, scroll) => DecoratedBox(
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(20),
                ),
                boxShadow: const [
                  BoxShadow(blurRadius: 12, color: Color(0x22000000)),
                ],
              ),
              child: SingleChildScrollView(controller: scroll, child: sheet),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Material(
                    color: theme.colorScheme.surface,
                    shape: const CircleBorder(),
                    elevation: 2,
                    child: const BackButton(),
                  ),
                  const Spacer(),
                  if (onInquiry case final tap?)
                    Material(
                      color: theme.colorScheme.surface,
                      shape: const StadiumBorder(),
                      elevation: 2,
                      child: InkWell(
                        key: const ValueKey('track-map-inquiry'),
                        customBorder: const StadiumBorder(),
                        onTap: tap,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const PmartLineIcon(
                                PmartLineIcons.headset,
                                size: 20,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                l10n.orderInquiry,
                                style: theme.textTheme.titleSmall,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 주문 단위 배송 현황(`/orders/{orderId}/tracking`). 주문 응답에 배송 ID(`shipments[].deliveryId`)가 있으면
/// 그 배송의 실시간 화면([TrackingScreen])을 그대로 보이고, 없으면(BR-61 — 지금 서버는 shipments 를 비워 준다)
/// 지도(내 배송지)·주문 단계만 보인다. 라이더 위치는 배송 ID 가 있어야 서버에 물을 수 있어 그때까지 보이지 않는다.
class OrderTrackingScreen extends ConsumerStatefulWidget {
  const OrderTrackingScreen({super.key, required this.orderId});

  final String orderId;

  @override
  ConsumerState<OrderTrackingScreen> createState() =>
      _OrderTrackingScreenState();
}

/// 배송 ID 가 아직 없으면(배차 전 — 서버는 배송이 생긴 뒤 shipments 를 채운다, BR-61) [orderLinkPollIntervalProvider]
/// 마다 주문을 다시 읽어, 배송이 생기는 대로 실시간 화면(라이더 위치)으로 넘어간다. 앱이 가려지면 멈춘다.
class _OrderTrackingScreenState extends ConsumerState<OrderTrackingScreen>
    with WidgetsBindingObserver {
  Timer? _poll;

  String get orderId => widget.orderId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  void _start() {
    _poll?.cancel();
    _poll = Timer.periodic(ref.read(orderLinkPollIntervalProvider), (_) {
      if (!mounted) return;
      final o = ref.read(orderDetailProvider(orderId)).value;
      final linked = o?.shipments.any((s) => s.deliveryId != null) ?? false;
      if (linked) {
        _poll?.cancel();
        return;
      }
      ref.invalidate(orderDetailProvider(orderId));
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        ref.invalidate(orderDetailProvider(orderId));
        _start();
      case AppLifecycleState.hidden ||
          AppLifecycleState.paused ||
          AppLifecycleState.detached:
        _poll?.cancel();
      case AppLifecycleState.inactive:
        break;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(orderDetailProvider(orderId));
    final o = value.value;
    final deliveryIds = [
      for (final s in o?.shipments ?? const <ShipmentView>[]) ?s.deliveryId,
    ];
    if (deliveryIds.isNotEmpty) {
      // 분할 배송이면 아직 끝나지 않은 첫 배송.
      final open = o!.shipments
          .where(
            (s) =>
                s.deliveryId != null &&
                s.state != ShipmentState.delivered &&
                s.state != ShipmentState.cancelled,
          )
          .firstOrNull;
      return TrackingScreen(
        deliveryId: open?.deliveryId ?? deliveryIds.first,
        orderId: orderId,
      );
    }
    final ship = o?.shippingAddress;
    final home = switch ((ship?.lat, ship?.lng)) {
      (final double lat, final double lng) => (lat: lat, lng: lng),
      _ => switch (ship?.roadAddress) {
        final road? => ref.watch(trackingHomeProvider(road)).value,
        null => null,
      },
    };
    final Widget sheet = switch (value) {
      _ when o != null => Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TrackSheetHead(
              mode: deliveryModeText(l10n, o.deliveryMode),
              headline: orderStatusText(l10n, o.status),
              headlineKey: 'order-track-status',
              subtitle: o.window == null ? null : windowText(o.window!),
            ),
            Text(
              l10n.trackRiderNotLinked,
              key: const ValueKey('track-no-delivery'),
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            _TrackSteps(progress: trackProgressOf(order: o.status)),
            OrderSheetDetails(order: o),
          ],
        ),
      ),
      AsyncError() => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Text(l10n.trackOrderFailed, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => ref.invalidate(orderDetailProvider(orderId)),
              child: Text(l10n.checkoutCheckAgain),
            ),
          ],
        ),
      ),
      _ => const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      ),
    };
    return TrackMapLayout(
      map: TrackingMap(rider: null, home: home),
      sheet: sheet,
      onInquiry: () => context.push('/orders/$orderId/help'),
    );
  }
}

/// 주문 상세에 "배송현황 보기"를 보일 주문 상태 — 결제 확정 뒤 ~ 배달이 끝나기 전.
bool _trackable(OrderStatus s) => switch (s) {
  OrderStatus.confirmed ||
  OrderStatus.preparing ||
  OrderStatus.partiallyHandedOver ||
  OrderStatus.inDelivery ||
  OrderStatus.partiallyDelivered => true,
  _ => false,
};

/// 배달 중(라이더가 내 상품을 받은 뒤 ~ 끝나기 전) — 서버가 고객에게 라이더 위치를 주는 단계(tracking 0.6.0).
bool _isDelivering(DeliveryStage? s) =>
    s == DeliveryStage.toCustomer || s == DeliveryStage.atCustomer;

class _TrackBody extends StatelessWidget {
  const _TrackBody({
    required this.eta,
    required this.deliveryId,
    required this.order,
    required this.polling,
    required this.onVisit,
    this.sheet = false,
    this.rider,
  });

  final DeliveryEtaView eta;
  final String deliveryId;

  /// 지도 아래 시트로 그린다(남은 시간을 크게, 라이더 위치 시각). 아니면 원래 목록.
  final bool sheet;

  /// 시트일 때 라이더 위치(없거나 오래됐으면 "확인하고 있어요").
  final RiderPosition? rider;

  /// null 이면 주문을 모르고 들어왔다(알림 등). 배송 정보만으로 그린다.
  final AsyncValue<OrderDetail>? order;
  final bool polling;
  final Future<void> Function(String location) onVisit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final e = eta;
    final o = order?.value;
    final shipment = o?.shipments
        .where((s) => s.deliveryId == deliveryId)
        .firstOrNull;
    final progress = trackProgressOf(
      order: o?.status,
      shipment: shipment?.state,
      stage: e.stage,
    );
    final scheduled = o?.deliveryMode == 'SCHEDULED';
    final window = o?.window ?? e.window;
    final etaLine = switch (e.status) {
      EtaStatus.available when e.etaAt != null => l10n.etaAt(
        formatSeoulTime(e.etaAt!),
      ),
      EtaStatus.locating => l10n.etaLocating,
      EtaStatus.pending => l10n.etaPending,
      EtaStatus.finalized => l10n.stDone,
      _ => l10n.etaPending,
    };
    final remainingMin =
        e.status == EtaStatus.available && e.remainingSeconds != null
        ? (e.remainingSeconds! / 60).ceil()
        : null;
    final children = <Widget>[
      // 시트 머리(레퍼런스 8-5): 배달 방식 → "N분 남음 오후 6:50" → 단계 문장(오른쪽 그림) → 라이더 위치 시각.
      if (sheet) ...[
        TrackSheetHead(
          mode: deliveryModeText(l10n, o?.deliveryMode),
          headline: remainingMin != null
              ? l10n.trackRemainingShort(remainingMin)
              : etaLine,
          headlineKey: remainingMin != null
              ? 'track-sheet-remaining'
              : 'eta-line',
          time: remainingMin != null && e.etaAt != null
              ? formatSeoulTime(e.etaAt!)
              : null,
          subtitle: stageText(l10n, e.stage),
        ),
        // 위치가 없거나(서버가 주지 않음) 받은 지 60초가 넘었으면 지어내지 않고 확인 중이라고만.
        if (rider case final r? when !r.stale && r.recordedAt != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.trackRiderLocationAt(formatSeoulTime(r.recordedAt!)),
              key: const ValueKey('track-rider-at'),
              style: theme.textTheme.bodySmall,
            ),
          )
        else if (_isDelivering(e.stage) && (rider == null || rider!.stale))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.trackRiderLocating,
              key: const ValueKey('track-rider-locating'),
              style: theme.textTheme.bodySmall,
            ),
          ),
        if ((e.delayedBySeconds ?? 0) > 0 && e.status == EtaStatus.available)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              l10n.etaDelayed((e.delayedBySeconds! / 60).ceil()),
              key: const ValueKey('eta-delayed'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        const SizedBox(height: 8),
      ],
      // 예약배달: 서버가 준 도착 구간을 크게. 변경·취소는 진입만, 가능 여부는 서버가 판정한다.
      if (scheduled && window != null) ...[
        Text(
          l10n.trackReservedWindow(windowText(window)),
          key: const ValueKey('track-reserved'),
          style: theme.textTheme.headlineSmall,
        ),
        if (o != null && canRequestTimeChange(o))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.trackRescheduleNote,
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
      if (o != null && (canRequestTimeChange(o) || canRequestCancel(o)))
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(
            spacing: 8,
            children: [
              if (canRequestCancel(o))
                OutlinedButton(
                  key: const ValueKey('track-cancel'),
                  onPressed: () => onVisit('/orders/${o.orderId}/cancel'),
                  child: Text(l10n.cancelTitle),
                ),
              if (canRequestTimeChange(o))
                OutlinedButton(
                  key: const ValueKey('track-reschedule'),
                  onPressed: () => onVisit('/orders/${o.orderId}/reschedule'),
                  child: Text(l10n.rescheduleTitle),
                ),
            ],
          ),
        ),
      if (order case AsyncError() when o == null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            l10n.trackOrderFailed,
            key: const ValueKey('track-order-failed'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      const SizedBox(height: 16),
      _TrackSteps(progress: progress),
      if (sheet && o != null) OrderSheetDetails(order: o),
      if (progress.halted)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            switch ((shipment?.state, o?.status)) {
              (ShipmentState.failed || ShipmentState.cancelled, _) =>
                shipmentStateText(l10n, shipment!.state),
              (_, final s?) => orderStatusText(l10n, s),
              _ => l10n.osUnknown,
            },
            key: const ValueKey('track-halted'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      // 주문 일부만 다음 단계에 갔다(PARTIALLY_*). 단계는 앞당기지 않고 그대로 알린다.
      if (progress.partial && o != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            orderStatusText(l10n, o.status),
            key: const ValueKey('track-partial'),
          ),
        ),
      const SizedBox(height: 24),
      if (!sheet) ...[
        Text(
          stageText(l10n, e.stage),
          key: const ValueKey('eta-stage'),
          style: theme.textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(
          etaLine,
          key: const ValueKey('eta-line'),
          style: theme.textTheme.titleMedium,
        ),
        if (remainingMin != null) Text(l10n.etaRemaining(remainingMin)),
        // 배달 중인데 서버가 아직 라이더 위치를 주지 않음 — 위치를 지어내지 않고 확인 중이라고만.
        if (_isDelivering(e.stage))
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              l10n.trackRiderLocating,
              key: const ValueKey('track-rider-locating'),
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
      if (!scheduled && window != null) Text(windowText(window)),
      if (!sheet &&
          (e.delayedBySeconds ?? 0) > 0 &&
          e.status == EtaStatus.available)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            l10n.etaDelayed((e.delayedBySeconds! / 60).ceil()),
            key: const ValueKey('eta-delayed'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      if (polling)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Text(
            l10n.trackLiveFallback,
            key: const ValueKey('track-live-fallback'),
            style: theme.textTheme.bodySmall,
          ),
        ),
      if (e.asOf case final t?)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Text(
            e.freshness == Freshness.current
                ? l10n.asOfTime(formatSeoulTime(t))
                : l10n.sourceStale(formatSeoulTime(t)),
            style: theme.textTheme.bodySmall,
          ),
        ),
    ];
    if (sheet) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      );
    }
    return ListView(padding: const EdgeInsets.all(24), children: children);
  }
}

/// 4단계 진행 표시. 서버 상태로 정한 [TrackProgress] 만 그린다(멈춤이면 어느 단계도 진행으로 칠하지 않는다).
class _TrackSteps extends StatelessWidget {
  const _TrackSteps({required this.progress});

  final TrackProgress progress;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final current = progress.halted ? null : progress.step;
    final labels = {
      TrackStep.confirmed: l10n.trackStepConfirmed,
      TrackStep.preparing: l10n.trackStepPreparing,
      TrackStep.delivering: l10n.trackStepDelivering,
      TrackStep.delivered: l10n.trackStepDelivered,
    };
    return Column(
      key: const ValueKey('track-steps'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // 레퍼런스 8-5: 점을 선으로 잇고, 지난 단계는 채운 점, 지금 단계는 오토바이, 남은 단계는 회색 점.
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final step in TrackStep.values)
              Expanded(
                child: Column(
                  children: [
                    SizedBox(
                      height: 26,
                      child: Row(
                        children: [
                          Expanded(
                            child: step.index == 0
                                ? const SizedBox()
                                : _StepLine(
                                    on:
                                        current != null &&
                                        step.index <= current.index,
                                  ),
                          ),
                          _StepDot(
                            done: current != null && step.index < current.index,
                            current: step == current,
                          ),
                          Expanded(
                            child: step.index == TrackStep.values.length - 1
                                ? const SizedBox()
                                : _StepLine(
                                    on:
                                        current != null &&
                                        step.index < current.index,
                                  ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      labels[step]!,
                      key: ValueKey(
                        step == current
                            ? 'track-step-current-${step.name}'
                            : 'track-step-${step.name}',
                      ),
                      textAlign: TextAlign.center,
                      style: step == current
                          ? theme.textTheme.titleSmall?.copyWith(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            )
                          : theme.textTheme.bodyMedium?.copyWith(
                              fontSize: 14,
                              color: theme.colorScheme.outline,
                            ),
                    ),
                  ],
                ),
              ),
          ],
        ),
        if (current == null && !progress.halted)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              l10n.trackStepChecking,
              key: const ValueKey('track-step-unknown'),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      height: 3,
      decoration: BoxDecoration(
        color: on ? scheme.primary : scheme.outlineVariant,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({required this.done, required this.current});

  final bool done;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (current) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: ScooterGlyph(size: 26, color: scheme.primary),
      );
    }
    return Container(
      width: 13,
      height: 13,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? scheme.primary : scheme.outlineVariant,
      ),
    );
  }
}

/// 주문 `deliveryMode`(SINGLE·BUNDLED·SCHEDULED) → 화면 이름. 모르는 값·없음이면 null(보이지 않는다).
String? deliveryModeText(AppLocalizations l10n, String? mode) => switch (mode) {
  'SINGLE' => l10n.modeSingle,
  'BUNDLED' => l10n.modeBundled,
  'SCHEDULED' => l10n.modeScheduled,
  _ => null,
};

/// 배송 현황 시트 머리(레퍼런스 8-5): 손잡이, 배달 방식, 큰 제목(+시각), 단계 문장, 오른쪽 배달 그림.
class TrackSheetHead extends StatelessWidget {
  const TrackSheetHead({
    super.key,
    required this.headline,
    required this.headlineKey,
    this.mode,
    this.time,
    this.subtitle,
  });

  final String? mode;
  final String headline;
  final String headlineKey;
  final String? time;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: theme.colorScheme.outlineVariant,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (mode case final m?)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        m,
                        key: const ValueKey('track-mode'),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.end,
                    spacing: 8,
                    children: [
                      Text(
                        headline,
                        key: ValueKey(headlineKey),
                        style: theme.textTheme.headlineMedium?.copyWith(
                          fontSize: 27,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (time case final t?)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: Text(
                            t,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontSize: 17,
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (subtitle case final sub?)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        sub,
                        key: const ValueKey('eta-stage'),
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontSize: 16,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            // 오른쪽 배달 그림(직접 그린 선 그림 — 레퍼런스 캐릭터 그림은 쓰지 않는다).
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: ScooterGlyph(size: 44, color: theme.colorScheme.primary),
            ),
          ],
        ),
        const SizedBox(height: 20),
      ],
    );
  }
}

/// 시트 아래(레퍼런스 8-5·예약 화면): "배달정보 자세히"(배달주소·요청사항), 주문한 센터·"상세내역", 주문 상품, 총 결제금액.
/// 모두 주문 응답의 서버 값. 센터 이름은 `mfcName`(order 0.15.0), 없으면 브랜드만.
class OrderSheetDetails extends StatefulWidget {
  const OrderSheetDetails({super.key, required this.order});

  final OrderDetail order;

  @override
  State<OrderSheetDetails> createState() => _OrderSheetDetailsState();
}

class _OrderSheetDetailsState extends State<OrderSheetDetails> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final o = widget.order;
    final divider = Divider(
      height: 28,
      color: theme.colorScheme.outlineVariant,
    );
    final small = theme.textTheme.bodyMedium?.copyWith(
      fontSize: 15,
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        // "배달정보 자세히 ∨" — 회색 둥근 칸, 누르면 배달주소·요청사항.
        Material(
          color: theme.colorScheme.surfaceContainerHigh,
          shape: const StadiumBorder(),
          child: InkWell(
            key: const ValueKey('track-delivery-info'),
            customBorder: const StadiumBorder(),
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    l10n.trackDeliveryInfo,
                    style: theme.textTheme.bodyLarge?.copyWith(fontSize: 15),
                  ),
                  const SizedBox(width: 4),
                  PmartLineIcon(
                    _open
                        ? PmartLineIcons.chevronUp
                        : PmartLineIcons.chevronDown,
                    size: 18,
                  ),
                ],
              ),
            ),
          ),
        ),
        if (_open)
          Padding(
            key: const ValueKey('track-delivery-info-body'),
            padding: const EdgeInsets.fromLTRB(4, 16, 4, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.trackAddress,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                ShippingAddressView(address: o.shippingAddress),
                const SizedBox(height: 14),
                Text(
                  l10n.trackRequest,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  o.deliveryNote?.trim().isNotEmpty ?? false
                      ? o.deliveryNote!
                      : l10n.trackRequestNone,
                  key: const ValueKey('track-request'),
                ),
              ],
            ),
          ),
        const SizedBox(height: 28),
        // 주문한 센터 + 상세내역
        Row(
          children: [
            Expanded(
              child: Text(
                // 센터 이름(BR-62) — 없으면 브랜드만(ID 를 보이지 않는다).
                switch (o.mfcName) {
                  final n? => '${l10n.trackStoreName} $n',
                  null => l10n.trackStoreName,
                },
                key: const ValueKey('track-store'),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            OutlinedButton(
              key: const ValueKey('track-order-detail'),
              style: OutlinedButton.styleFrom(
                shape: const StadiumBorder(),
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
              onPressed: () => context.push('/orders/${o.orderId}'),
              child: Text(l10n.trackOrderDetail),
            ),
          ],
        ),
        divider,
        for (final l in o.lines)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('•  ', style: small),
                Expanded(
                  child: Text(
                    '${l.title} ${l10n.cartLineQuantity(l.originalQty ?? 0)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: small,
                  ),
                ),
              ],
            ),
          ),
        divider,
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.trackTotalAmount,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text(
              switch (o.quote?.totalAmount) {
                final int a => formatKrw(a),
                null => l10n.amountUnavailable,
              },
              key: const ValueKey('track-total'),
              style: theme.textTheme.titleMedium?.copyWith(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
