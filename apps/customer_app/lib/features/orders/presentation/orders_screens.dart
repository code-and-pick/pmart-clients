import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart' show PmartFailure;
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../address/presentation/address_screens.dart' show LoginRequired;
import '../../checkout/presentation/delivery_select_screen.dart'
    show windowText;
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
import '../data/orders_repository.dart' show OrdersRepository;
import '../domain/orders.dart';
import '../domain/tracking.dart';
import 'orders_providers.dart';
import '../../redelivery/presentation/redelivery_screens.dart'
    show RedeliveryPaymentsSection;
import '../../reviews/presentation/reviews_screens.dart'
    show OrderReviewsSection;

String _money(AppLocalizations l10n, int? v) => switch (v) {
  final int a => formatKrw(a),
  null => l10n.amountUnavailable,
};

/// SCR-ORDER-LIST-001. 조회 실패를 "주문 없음"으로 보이지 않는다.
class OrderListScreen extends ConsumerStatefulWidget {
  const OrderListScreen({super.key});

  @override
  ConsumerState<OrderListScreen> createState() => _OrderListScreenState();
}

class _OrderListScreenState extends ConsumerState<OrderListScreen> {
  /// 상태 필터. null 이면 전체. 서버에 `status` 로 묻는다(앱에서 거르지 않는다).
  OrderStatus? _status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = orderListProvider(_status);
    final value = ref.watch(provider);
    final filters = SizedBox(
      height: 50,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        children: [
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

  /// 주문 카드 한 장: 상태 · "주문 상세" 알약 / 주문 시각(크게) / 상품 수 · 금액.
  Widget _orderCard(
    BuildContext context,
    AppLocalizations l10n,
    OrderListItem o,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                orderStatusText(l10n, o.status),
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w800,
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
            if (o.itemCount case final n?)
              Expanded(
                child: Text(
                  l10n.ordersItemCount(n),
                  style: theme.textTheme.bodyMedium,
                ),
              )
            else
              const Spacer(),
            Text(
              _money(l10n, o.totalAmount),
              style: theme.textTheme.titleSmall,
            ),
          ],
        ),
      ],
    );
  }

  Widget _list(
    AppLocalizations l10n,
    FutureProvider<OrderPage?> provider,
    AsyncValue<OrderPage?> value,
  ) => UiStateView<OrderPage?>(
    state: uiStateOf(value, isEmpty: (p) => p!.items.isEmpty),
    onRetry: () => ref.invalidate(provider),
    // 필터가 걸려 있으면 "주문 없음"이 아니라 "이 상태의 주문 없음"이다.
    empty: (_) => Center(
      key: ValueKey(_status == null ? 'orders-empty' : 'orders-empty-filtered'),
      child: Text(
        _status == null ? l10n.ordersEmpty : l10n.ordersEmptyFiltered,
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
                    padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
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
          ),
        // 고객센터 문의(주문을 고른 상태로). 접수일 뿐 주문을 바꾸지 않는다.
        OutlinedButton(
          key: const ValueKey('order-inquiry'),
          onPressed: () => visit('/support/inquiries/new?orderId=${o.orderId}'),
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
                claimStateText(l10n, c.state),
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

/// SCR-TRACK-001. 위치 조회 실패는 배송 실패가 아니다. 라이더 좌표·다른 고객 정보는 받지도 보이지도 않는다.
///
/// 실시간 구독(`GET /deliveries/{id}/stream`)으로 갱신하고, 끊기면 재연결(1·2·4…초)을 시도하는 동안
/// 도착 예상(`GET /deliveries/{id}/eta`)을 주기 조회한다. 화면을 닫거나 앱이 가려지면 연결을 닫는다.
/// [orderId] 가 있으면(주문 상세에서 진입) 주문·배송 상태로 4단계와 예약 시각·변경/취소 진입을 보인다.
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
    return Scaffold(
      appBar: AppBar(title: Text(l10n.trackTitle)),
      body: switch (value) {
        _ when live != null => _trackBody(live, order),
        // 조회 실패: "배송 실패"가 아니라 "위치를 불러오지 못함"이다.
        AsyncError() when !value.hasValue => Center(
          key: const ValueKey('eta-failed'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
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
        _ => UiStateView<DeliveryEtaView>(
          state: uiStateOf(value),
          onRetry: () => ref.invalidate(provider),
          ready: (context, e) => _trackBody(e, order),
        ),
      },
    );
  }

  Widget _trackBody(DeliveryEtaView eta, AsyncValue<OrderDetail>? order) =>
      _TrackBody(
        eta: eta,
        deliveryId: widget.deliveryId,
        order: order,
        polling: _mode == _Live.polling,
        onVisit: _visit,
      );
}

class _TrackBody extends StatelessWidget {
  const _TrackBody({
    required this.eta,
    required this.deliveryId,
    required this.order,
    required this.polling,
    required this.onVisit,
  });

  final DeliveryEtaView eta;
  final String deliveryId;

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
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
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
        if (e.status == EtaStatus.available && e.remainingSeconds != null)
          Text(l10n.etaRemaining((e.remainingSeconds! / 60).ceil())),
        if (!scheduled && window != null) Text(windowText(window)),
        if ((e.delayedBySeconds ?? 0) > 0 && e.status == EtaStatus.available)
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
      ],
    );
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
        Row(
          children: [
            for (final step in TrackStep.values)
              Expanded(
                child: Column(
                  children: [
                    Icon(
                      current != null && step.index <= current.index
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      size: 18,
                      color: current != null && step.index <= current.index
                          ? theme.colorScheme.primary
                          : theme.disabledColor,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      labels[step]!,
                      key: ValueKey(
                        step == current
                            ? 'track-step-current-${step.name}'
                            : 'track-step-${step.name}',
                      ),
                      textAlign: TextAlign.center,
                      style: step == current
                          ? theme.textTheme.labelLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                            )
                          : theme.textTheme.labelMedium?.copyWith(
                              color: theme.disabledColor,
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
