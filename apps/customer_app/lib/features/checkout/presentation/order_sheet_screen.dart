import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart' show ProblemFailure;
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../address/presentation/address_controller.dart';
import '../../cart/domain/cart.dart' show Cart;
import '../../cart/presentation/cart_controller.dart';
import '../../payment/domain/payment.dart';
import '../../payment/presentation/payment_controller.dart';
import '../../payment/presentation/payment_screen.dart' show paymentPhaseText;
import '../../payment/presentation/pg_widget_session.dart';
import '../domain/checkout.dart';
import 'checkout_controller.dart';
import 'delivery_select_screen.dart' show modeLabel, windowText;
import 'shipping_address_view.dart';

String _money(AppLocalizations l10n, int? amount) => switch (amount) {
  final int a => formatKrw(a),
  null => l10n.amountUnavailable,
};

/// 주문서 품목 제목. 초안에 고정된 상품명·옵션 사본(BR-35) → 장바구니 이름 → sku 순. 사본은 cartItemId, 없으면 sku 로 맞춘다.
String orderSheetLineTitle(OrderDraft draft, Cart? cart, DraftLine l) {
  final server =
      draft.lines.where((d) => d.cartItemId == l.cartItemId).firstOrNull ??
      draft.lines.where((d) => d.sku == l.sku).firstOrNull;
  return server?.title ??
      cart?.lines
          .where((c) => c.cartItemId == l.cartItemId)
          .firstOrNull
          ?.name ??
      l.sku;
}

String tipReasonText(AppLocalizations l10n, TipReason r) => switch (r) {
  TipReason.standard => l10n.tipStandard,
  TipReason.over30000 => l10n.tipOver30000,
  TipReason.firstPurchase => l10n.tipFirstPurchase,
  TipReason.none => l10n.tipNone,
  TipReason.unknown => l10n.tipUnknown,
};

String blockerText(AppLocalizations l10n, DraftBlocker b) => switch (b) {
  DraftBlocker.minOrderAmount => l10n.blockerMinOrder,
  DraftBlocker.deliveryModeUnavailable => l10n.blockerModeUnavailable,
  DraftBlocker.slotRequired => l10n.blockerSlotRequired,
  DraftBlocker.slotUnavailable => l10n.blockerSlotUnavailable,
  DraftBlocker.unknown => l10n.blockerUnknown,
};

/// 최소주문 미달 안내. 부족액은 서버 값(minOrderShortfall)만 쓴다(BR-14).
String minOrderText(AppLocalizations l10n, Quote? q) =>
    switch (q?.minOrderShortfall) {
      final int n when n > 0 => l10n.minOrderShortfall(formatKrw(n)),
      _ => l10n.minOrderUnsatisfied,
    };

/// 결제 진입 실패 사유(초안 checkoutFailure.code·결제 흐름 실패 코드).
String checkoutFailureText(AppLocalizations l10n, String code) =>
    switch (code) {
      CheckoutProblemCode.insufficientStock => l10n.cfInsufficientStock,
      CheckoutProblemCode.skuNotHandled => l10n.cfSkuNotHandled,
      CheckoutProblemCode.capacityExceeded => l10n.cfCapacityExceeded,
      CheckoutProblemCode.slotNotSelectable => l10n.cfSlotNotSelectable,
      CheckoutProblemCode.configRequired => l10n.draftConfigRequired,
      CheckoutProblemCode.resourceExpired => l10n.cfResourceExpired,
      _ => l10n.payFailed,
    };

/// 초안 생성 거절(422·409) 사유와 고객이 갈 곳. 모르는 코드는 null(일반 오류 화면).
({String text, String? route, String? action})? draftRejection(
  AppLocalizations l10n,
  Object? error,
) {
  if (error is! ProblemFailure) return null;
  return switch (error.problem.code) {
    CheckoutProblemCode.accountNotPurchasable => (
      text: l10n.draftAccountNotPurchasable,
      route: null,
      action: null,
    ),
    CheckoutProblemCode.outOfServiceArea => (
      text: l10n.addressNotServiceable,
      route: '/addresses',
      action: l10n.goAddresses,
    ),
    // 판정 불명은 배송 불가가 아니다.
    CheckoutProblemCode.serviceabilityUnknown => (
      text: l10n.draftServiceabilityUnknown,
      route: '/addresses',
      action: l10n.goAddresses,
    ),
    CheckoutProblemCode.mfcChanged => (
      text: l10n.draftMfcChanged,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    CheckoutProblemCode.skuNotSaleable => (
      text: l10n.draftSkuNotSaleable,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    CheckoutProblemCode.quantityLimitExceeded => (
      text: l10n.draftQuantityLimit,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    // 초안 생성 422(order 0.8.0). 결제 단계 자원 확보 실패(checkoutFailure)의 같은 코드와는 다른 자리다.
    CheckoutProblemCode.insufficientStock => (
      text: l10n.draftInsufficientStock,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    CheckoutProblemCode.priceNotSet => (
      text: l10n.draftPriceNotSet,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    CheckoutProblemCode.weightUnsplittable => (
      text: l10n.draftWeightUnsplittable,
      route: '/cart',
      action: l10n.cartGoToCart,
    ),
    CheckoutProblemCode.configRequired => (
      text: l10n.draftConfigRequired,
      route: null,
      action: null,
    ),
    _ => null,
  };
}

String _left(Duration d) {
  final s = d.inSeconds.clamp(0, 359999);
  return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
}

String blockedText(AppLocalizations l10n, CheckoutBlockReason r) => switch (r) {
  CheckoutBlockReason.notMember => l10n.blockedNotMember,
  CheckoutBlockReason.noShoppingAddress => l10n.blockedNoAddress,
  CheckoutBlockReason.noSelectedItems => l10n.blockedNoItems,
  CheckoutBlockReason.setupIncomplete => l10n.blockedSetup,
};

/// SCR-CHECKOUT-001. 금액·기한·자격은 서버 값만 보인다. 결제 버튼은 서버가 PAY 를 줬을 때만 열린다.
class OrderSheetScreen extends ConsumerStatefulWidget {
  const OrderSheetScreen({super.key});

  @override
  ConsumerState<OrderSheetScreen> createState() => _OrderSheetScreenState();
}

class _OrderSheetScreenState extends ConsumerState<OrderSheetScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(draftControllerProvider.notifier).enter());
    // 남은 시간 표시만 갱신한다. 앱 타이머로 확보를 풀거나 상태를 바꾸지 않는다.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(draftControllerProvider);
    final blocked = switch (value) {
      AsyncError(error: final CheckoutBlocked b) => b.reason,
      _ => null,
    };
    final rejection = switch (value) {
      AsyncError(:final error) => draftRejection(l10n, error),
      _ => null,
    };
    final surfaces = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: surfaces.surfaceContainer,
      appBar: AppBar(
        title: Text(l10n.checkoutTitle),
        centerTitle: true,
        backgroundColor: surfaces.surfaceContainer,
      ),
      body: blocked != null
          ? Center(child: Text(blockedText(l10n, blocked)))
          : rejection != null
          ? Center(
              key: const ValueKey('draft-rejected'),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(rejection.text, textAlign: TextAlign.center),
                    if (rejection case (
                      route: final String route,
                      action: final String action,
                      text: _,
                    )) ...[
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () => context.go(route),
                        child: Text(action),
                      ),
                    ],
                  ],
                ),
              ),
            )
          : switch (value) {
              AsyncData(value: null) => const Center(
                child: CircularProgressIndicator(),
              ),
              _ => UiStateView<DraftState?>(
                state: uiStateOf(value),
                onRetry: () =>
                    ref.read(draftControllerProvider.notifier).recreate(),
                ready: (context, s) => _Sheet(state: s!),
              ),
            },
    );
  }
}

/// 주문서 본문. 주문서형 결제위젯(BR-34): 결제수단·약관 위젯을 여기 그리고, "결제하기"는 결제 진입 →
/// 결제창 → 결과 확인까지 이 화면 위에서 진행한다. 완료·결과 불명·복구·환불일 때만 결제 화면으로 넘긴다.
/// 결제창 실패·취소는 여기 배너로 보이고, 새 키로 다시 결제 진입할 수 있다.
class _Sheet extends ConsumerStatefulWidget {
  const _Sheet({required this.state});

  final DraftState state;

  @override
  ConsumerState<_Sheet> createState() => _SheetState();
}

class _SheetState extends ConsumerState<_Sheet> {
  PgWidgetSession? _session;
  String? _sessionKey;
  bool _navigated = false;

  /// 이 화면에서 "결제하기"로 시작한 결제 흐름이 진행 중인지. 흐름 상태의 초기값(preparing)과 구분한다.
  bool _flowStarted = false;

  /// dispose 에서는 ref 를 쓸 수 없어 세션을 등록할 때 받아 둔다.
  ActivePgLauncher? _active;

  DraftState get state => widget.state;

  @override
  void dispose() {
    final s = _session;
    if (s != null) {
      _active?.clear(s);
      s.dispose();
    }
    super.dispose();
  }

  /// 결제위젯 설정이 있으면 세션을 만들어 결제 흐름이 쓰게 등록한다. 설정(계정)이 바뀌면 새로 만든다.
  PgWidgetSession? _ensureSession(PaymentWidgetConfig? cfg) {
    if (cfg == null) return null;
    final key = '${cfg.clientKey}|${cfg.customerKey}';
    if (_session != null && _sessionKey == key) return _session;
    _session?.dispose();
    final s = ref.read(pgWidgetSessionFactoryProvider)(cfg);
    final active = ref.read(activePgLauncherProvider);
    _session = s;
    _sessionKey = key;
    _active = active;
    active.set(s);
    return s;
  }

  bool _working(PaymentFlowState f) =>
      _flowStarted &&
      switch (f.phase) {
        PaymentPhase.preparing ||
        PaymentPhase.authenticating ||
        PaymentPhase.confirming => !f.stillChecking,
        _ => false,
      };

  /// 결제 화면으로 넘길 상태: 완료·복구·환불, 또는 확인이 오래 걸려 "다시 확인"이 필요할 때.
  bool _handoff(PaymentFlowState f) => switch (f.phase) {
    PaymentPhase.done ||
    PaymentPhase.recovering ||
    PaymentPhase.refunding => true,
    _ => f.stillChecking,
  };

  void _onFlow(PaymentFlowState? prev, PaymentFlowState next, String draftId) {
    if (!_flowStarted) return;
    if (next.phase == PaymentPhase.failed &&
        prev?.phase != PaymentPhase.failed) {
      // 이번 결제 시도는 끝났다. 초안을 다시 읽어 결제 버튼을 새 키로 다시 연다.
      setState(() => _flowStarted = false);
      ref.read(draftControllerProvider.notifier).refresh();
      return;
    }
    if (_handoff(next) && !_navigated) {
      _navigated = true;
      setState(() => _flowStarted = false);
      context.push('/payments/$draftId');
    }
  }

  Future<void> _pay(BuildContext context, AppLocalizations l10n) async {
    final ctl = ref.read(draftControllerProvider.notifier);
    final session = _session;
    if (session != null && !await session.requiredTermsAgreed()) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.tossAgreementRequired)));
      return;
    }
    final draftId = state.draft.draftId;
    final start = await ctl.pay();
    // 사가가 시작됐을 뿐이다. 결제 흐름이 PAY 를 기다렸다가 이 화면의 위젯으로 결제창을 연다.
    if (start is CheckoutAccepted && mounted) {
      setState(() {
        _flowStarted = true;
        _navigated = false;
      });
      unawaited(ref.read(paymentFlowProvider(draftId).notifier).run());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final ctl = ref.read(draftControllerProvider.notifier);
    final draft = state.draft;
    final quote = state.agreedQuote ?? draft.quote;
    final now = ref.watch(clockProvider)();
    final cart = ref.watch(cartControllerProvider).value?.cart;
    final address = ref.watch(addressBookProvider).value?.shoppingAddress;
    final req = state.request;
    final config = ref.watch(paymentWidgetConfigProvider);
    final session = _ensureSession(config.value);
    final flowProvider = paymentFlowProvider(draft.draftId);
    final flow = ref.watch(flowProvider);
    ref.listen(
      flowProvider,
      (prev, next) => _onFlow(prev, next, draft.draftId),
    );

    final banners = <Widget>[
      // 결제창 실패·취소(이번 시도 끝). 서버가 확보분을 풀었고, 새 키로 다시 결제할 수 있다.
      if (flow.phase == PaymentPhase.failed &&
          flow.failureCode != draft.checkoutFailure?.code)
        _Banner(
          key: const ValueKey('pg-failed'),
          icon: Icons.error_outline,
          text: paymentPhaseText(l10n, flow),
        ),
      if (draft.next == DraftNext.wait)
        _Banner(
          key: const ValueKey('draft-waiting'),
          icon: Icons.hourglass_top,
          text: l10n.checkoutPreparing,
          action: TextButton(
            onPressed: ctl.refresh,
            child: Text(l10n.checkoutCheckAgain),
          ),
        ),
      if (draft.expired)
        _Banner(
          key: const ValueKey('draft-expired'),
          icon: Icons.timer_off_outlined,
          text: l10n.draftExpired,
          action: TextButton(
            onPressed: ctl.recreate,
            child: Text(l10n.draftRecreate),
          ),
        ),
      if (draft.quote?.minOrderSatisfied == false ||
          draft.blockers.contains(DraftBlocker.minOrderAmount))
        _Banner(
          key: const ValueKey('min-order'),
          icon: Icons.info_outline,
          text: minOrderText(l10n, draft.quote),
          action: TextButton(
            onPressed: () => context.go('/cart'),
            child: Text(l10n.cartGoToCart),
          ),
        ),
      // 최소주문 밖의 막는 사유도 모두 보인다(서버 순서).
      for (final b in draft.blockers)
        if (b != DraftBlocker.minOrderAmount)
          _Banner(
            key: ValueKey('blocker-${b.name}'),
            icon: Icons.block,
            text: blockerText(l10n, b),
            action: TextButton(
              onPressed: () => context.push('/checkout/delivery'),
              child: Text(l10n.checkoutChange),
            ),
          ),
      if (state.checkoutUnknown)
        _Banner(
          key: const ValueKey('checkout-unknown'),
          icon: Icons.hourglass_top,
          text: l10n.checkoutUnknown,
          action: TextButton(
            onPressed: ctl.refresh,
            child: Text(l10n.checkoutCheckAgain),
          ),
        ),
      if (state.lastStart is CheckoutAccepted)
        _Banner(
          key: const ValueKey('checkout-accepted'),
          icon: Icons.payment,
          text: l10n.checkoutAccepted,
        ),
      // 지난 결제 진입이 자원 확보·결제에서 실패했다. 서버가 확보분을 풀었고, 견적이 유효하면 다시 결제할 수 있다.
      if (draft.checkoutFailure case final f?
          when state.lastStart is! CheckoutAccepted)
        _Banner(
          key: const ValueKey('checkout-failure'),
          icon: Icons.error_outline,
          text: checkoutFailureText(l10n, f.code),
        ),
      if (state.lastStart case CheckoutRejected(:final code))
        _Banner(
          key: const ValueKey('checkout-rejected'),
          icon: Icons.error_outline,
          text: switch (code) {
            CheckoutProblemCode.unsupported => l10n.checkoutNotYetSupported,
            CheckoutProblemCode.checkoutBlocked => l10n.checkoutBlocked,
            // 초안 뒤 계정이 구매 불가로 바뀜(결제 진입 때 다시 확인, BR-37 회신 4).
            CheckoutProblemCode.accountNotPurchasable =>
              l10n.draftAccountNotPurchasable,
            _ => l10n.checkoutRejected,
          },
        ),
      if (state.needsReconsent) _ReQuoteCard(state: state),
    ];

    final expiry = draft.earliestExpiry;
    final body = Column(
      children: [
        Expanded(
          // ListView 는 화면 밖 항목을 늦게 만든다 — 맨 아래 결제수단(토스 위젯)이 스크롤이 닿을 때에야
          // 로딩을 시작해 늦게 떴다. 주문서는 길지 않아 한 번에 만든다.
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ...banners,
                if (expiry != null && draft.awaitingCheckout)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(6, 10, 6, 2),
                    child: Row(
                      children: [
                        Icon(
                          Icons.schedule,
                          size: 18,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            expiry.isAfter(now)
                                ? l10n.payWithin(_left(expiry.difference(now)))
                                : l10n.holdExpired,
                            key: const ValueKey('pay-within'),
                            style: theme.textTheme.titleMedium,
                          ),
                        ),
                      ],
                    ),
                  ),
                _Section(
                  title: l10n.checkoutItems,
                  children: [
                    for (final l in req.lines)
                      Text(
                        '${orderSheetLineTitle(draft, cart, l)} · ${l10n.cartLineQuantity(l.quantity)}',
                      ),
                  ],
                ),
                _Section(
                  title: l10n.checkoutDelivery,
                  trailing: TextButton(
                    key: const ValueKey('change-delivery'),
                    onPressed: () => context.pop(),
                    child: Text(l10n.checkoutChange),
                  ),
                  children: [
                    Text(
                      [
                        modeLabel(l10n, req.mode),
                        if (req.window case final w?) windowText(w),
                      ].join(' · '),
                    ),
                    if ((quote?.plannedShipments ?? 1) > 1)
                      Text(l10n.splitShipment(quote!.plannedShipments!)),
                  ],
                ),
                _Section(
                  title: l10n.checkoutAddress,
                  children: [
                    // 초안에 고정된 배송지 사본(BR-37). 사본이 없는 옛 초안만 초안을 만든 현재 쇼핑 주소를 보인다.
                    if (draft.shippingAddress case final a?)
                      ShippingAddressView(address: a)
                    else if (address != null) ...[
                      Text(address.label ?? address.roadAddress),
                      Text('${address.roadAddress} ${address.detailAddress}'),
                    ],
                  ],
                ),
                _Section(
                  title: l10n.checkoutOptions,
                  children: [
                    Text(switch (req.outOfStock) {
                      OutOfStockPreference.cancelOutOfStockOnly => l10n.oosOnly,
                      OutOfStockPreference.cancelAll => l10n.oosAll,
                    }),
                    if (req.deliveryNote case final n?) Text(n),
                  ],
                ),
                _Section(
                  title: l10n.checkoutAmounts,
                  children: [
                    _AmountRow(
                      l10n.amountItems,
                      _money(l10n, quote?.itemAmount),
                    ),
                    _AmountRow(
                      '${l10n.amountTip} (${tipReasonText(l10n, quote?.tipReason ?? TipReason.unknown)})',
                      _money(l10n, quote?.deliveryTip),
                    ),
                    if (quote?.firstPurchase case final f
                        when f == FirstPurchaseBenefit.expected ||
                            f == FirstPurchaseBenefit.checkingOtherOrder)
                      Text(
                        f == FirstPurchaseBenefit.expected
                            ? l10n.firstPurchaseExpected
                            : l10n.firstPurchaseChecking,
                        key: const ValueKey('first-purchase'),
                        style: theme.textTheme.bodySmall,
                      ),
                    _AmountRow(l10n.amountBag, _money(l10n, quote?.bagFee)),
                    const Divider(),
                    _AmountRow(
                      l10n.amountTotal,
                      _money(l10n, quote?.totalAmount),
                      key: const ValueKey('amount-total'),
                      strong: true,
                    ),
                    if (quote?.expiresAt case final e?)
                      Text(
                        e.isAfter(now)
                            ? l10n.priceHoldLeft(_left(e.difference(now)))
                            : l10n.holdExpired,
                        key: const ValueKey('price-hold'),
                        style: theme.textTheme.bodySmall,
                      ),
                    if (draft.resources?.reservationExpiresAt case final e?)
                      Text(
                        e.isAfter(now)
                            ? l10n.stockHoldLeft(_left(e.difference(now)))
                            : l10n.holdExpired,
                        key: const ValueKey('stock-hold'),
                        style: theme.textTheme.bodySmall,
                      ),
                  ],
                ),
                _Section(
                  title: l10n.payMethods,
                  children: [
                    _PaymentWidgetArea(
                      config: config,
                      session: session,
                      amount: quote?.totalAmount,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        Material(
          color: theme.colorScheme.surface,
          elevation: 12,
          shadowColor: Colors.black26,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: SizedBox(
                width: double.infinity,
                height: 58,
                child: ValueListenableBuilder<bool>(
                  valueListenable: session?.ready ?? _neverReady,
                  builder: (context, widgetReady, _) => CommandButton(
                    key: const ValueKey('pay'),
                    busy: state.paying || _working(flow),
                    // 막는 사유가 있으면 주버튼에 첫 사유를 쓴다(DraftBlocker 설명의 순서).
                    label: switch ((
                      draft.blockers.firstOrNull,
                      quote?.totalAmount,
                    )) {
                      (final DraftBlocker b, _) => blockerText(l10n, b),
                      (null, final int t) => l10n.payButton(formatKrw(t)),
                      (null, null) => l10n.payButtonNoAmount,
                    },
                    // 결제위젯이 그려져야 연다(설정 실패·비회원이면 열지 않는다).
                    onPressed: state.canPay && widgetReady
                        ? () => _pay(context, l10n)
                        : null,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
    if (!_working(flow)) return body;
    // 결제 진행 중(진입 대기·결제창·결과 확인). 이 화면 위에서 진행하고, 뒤로가기·재탭을 막는다.
    return Stack(
      children: [
        body,
        const ModalBarrier(dismissible: false, color: Colors.black38),
        Center(
          child: Card(
            key: const ValueKey('pay-progress'),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(
                    paymentPhaseText(l10n, flow),
                    key: const ValueKey('pay-phase-inline'),
                    style: theme.textTheme.titleMedium,
                  ),
                  if (flow.phase == PaymentPhase.confirming) ...[
                    const SizedBox(height: 8),
                    Text(l10n.payDoNotRetry, textAlign: TextAlign.center),
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 결제위젯 세션이 없을 때(비회원·설정 실패) 결제 버튼을 닫아 두는 값.
final _neverReady = ValueNotifier<bool>(false);

/// 결제수단·약관 위젯 영역. 설정 조회 중·실패·비회원은 위젯을 그리지 않는다(결제 버튼도 닫힌다).
class _PaymentWidgetArea extends ConsumerWidget {
  const _PaymentWidgetArea({
    required this.config,
    required this.session,
    required this.amount,
  });

  final AsyncValue<PaymentWidgetConfig?> config;
  final PgWidgetSession? session;
  final int? amount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return switch (config) {
      AsyncLoading() => Row(
        key: const ValueKey('pg-config-loading'),
        children: [
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text(l10n.payMethodsLoading),
        ],
      ),
      // 422 CONFIG_REQUIRED(서버에 키 없음)·조회 실패 모두 결제를 열지 않는다. 다시 받을 수 있다.
      AsyncError() => _Banner(
        key: const ValueKey('pg-config-failed'),
        icon: Icons.error_outline,
        text: l10n.payConfigRequired,
        action: TextButton(
          onPressed: () => ref.invalidate(paymentWidgetConfigProvider),
          child: Text(l10n.payConfigRetry),
        ),
      ),
      _ => switch ((session, amount)) {
        (final PgWidgetSession s, final int a) => s.build(context, amount: a),
        _ => const SizedBox.shrink(),
      },
    };
  }
}

class _ReQuoteCard extends ConsumerWidget {
  const _ReQuoteCard({required this.state});

  final DraftState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final before = state.previousQuote!;
    final after = state.draft.quote;
    return Card(
      key: const ValueKey('re-quote'),
      color: Theme.of(context).colorScheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.reQuoteTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(l10n.reQuoteBefore(_money(l10n, before.totalAmount))),
            Text(
              l10n.reQuoteAfter(_money(l10n, after?.totalAmount)),
              key: const ValueKey('re-quote-after'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              key: const ValueKey('re-quote-agree'),
              onPressed: () =>
                  ref.read(draftControllerProvider.notifier).agreeToNewQuote(),
              child: Text(l10n.reQuoteAgree),
            ),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    super.key,
    required this.icon,
    required this.text,
    this.action,
  });

  final IconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(top: 8),
      color: scheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ListTile(
        leading: Icon(icon, color: scheme.primary),
        title: Text(text),
        trailing: action,
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children, this.trailing});

  final String title;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 10),
    padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ConstrainedBox(
          // 오른쪽 동작(변경 등)이 있어도 없어도 제목 줄 높이가 같게
          constraints: const BoxConstraints(minHeight: 32),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              ?trailing,
            ],
          ),
        ),
        const SizedBox(height: 6),
        ...children,
      ],
    ),
  );
}

class _AmountRow extends StatelessWidget {
  const _AmountRow(this.label, this.value, {super.key, this.strong = false});

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: strong ? 8 : 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: strong
                  ? theme.textTheme.titleMedium
                  : theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
            ),
          ),
          Text(
            value,
            style: strong
                ? theme.textTheme.headlineSmall?.copyWith(
                    color: theme.colorScheme.primary,
                  )
                : theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
          ),
        ],
      ),
    );
  }
}
