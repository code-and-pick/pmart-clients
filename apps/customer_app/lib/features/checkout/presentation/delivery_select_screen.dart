import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:pmart_core/pmart_core.dart' show ProblemFailure;
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../../address/domain/address.dart';
import '../../address/presentation/address_controller.dart';
import '../../address/presentation/address_screens.dart' show LoginRequired;
import '../domain/checkout.dart';
import 'checkout_controller.dart';
import '../../payment/presentation/payment_controller.dart'
    show paymentWidgetConfigProvider;
import 'order_sheet_screen.dart' show draftRejection;

String modeLabel(AppLocalizations l10n, DeliveryMode m) => switch (m) {
  DeliveryMode.single => l10n.modeSingle,
  DeliveryMode.bundled => l10n.modeBundled,
  DeliveryMode.scheduled => l10n.modeScheduled,
};

/// 도착 구간 `오후 1:00~2:00`. 날짜·시각은 서울 기준 문자열이다.
String windowText(ArrivalWindow w) => formatSeoulWindow(
  DateTime.parse('${w.date}T${w.start}:00+09:00'),
  DateTime.parse('${w.date}T${w.end}:00+09:00'),
);

/// 방식 한 줄 설명: 불가면 사유, 가능하면 방식 설명 + 예상시간·배달팁·가장 빠른 시간(서버 값만).
String optionSubtitle(AppLocalizations l10n, DeliveryOption o) {
  if (!o.available) {
    return switch (o.availability) {
      OptionAvailability.unknown => l10n.optionUnknown,
      OptionAvailability.configRequired => l10n.optionConfigRequired,
      _ => switch (o.reason) {
        UnavailableReason.nightTime => l10n.optionNightTime,
        UnavailableReason.centerClosed => l10n.optionCenterClosed,
        UnavailableReason.noSlot => l10n.optionNoSlot,
        UnavailableReason.configRequired => l10n.optionConfigRequired,
        // 조회 실패를 "배달 불가"로 보이지 않는다.
        UnavailableReason.lookupFailed => l10n.optionLookupFailed,
        UnavailableReason.unknown || null => l10n.optionUnavailable,
      },
    };
  }
  final eta = o.eta;
  final tip = o.tip?.applied ?? o.tip?.base;
  return [
    switch (o.mode) {
      DeliveryMode.single => l10n.modeSingleNote,
      DeliveryMode.bundled => l10n.modeBundledNote,
      DeliveryMode.scheduled => l10n.modeScheduledNote,
    },
    // ETA 미설정(NOT_SET)은 표시하지 않는다(0분·"곧"으로 그리지 않음, ⑤ 안내 §1).
    if (eta != null && !eta.notSet)
      switch ((eta.minMinutes, eta.maxMinutes)) {
        (final int a, final int b) => l10n.optionEta(a, b),
        _ => null,
      },
    if (tip != null) l10n.optionTip(formatKrw(tip)),
    if (o.earliestSlot case final w?) l10n.optionEarliestSlot(windowText(w)),
  ].nonNulls.join(' · ');
}

String seoulDate(DateTime instant) =>
    DateFormat('yyyy-MM-dd').format(toSeoulWallClock(instant));

/// SCR-DELIVERY-SELECT-001. 주문서 진입 전에 고른다. 주문서의 "변경"도 이 화면으로 온다.
class DeliverySelectScreen extends ConsumerWidget {
  const DeliverySelectScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final book = ref.watch(addressBookProvider);
    final Widget body = switch (book) {
      AsyncData(value: null) => LoginRequired(message: l10n.blockedNotMember),
      AsyncData(value: final b?) when b.shoppingAddress == null => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.needShoppingAddress),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => context.push('/addresses'),
              child: Text(l10n.goAddresses),
            ),
          ],
        ),
      ),
      AsyncData(value: final b?)
          when b.shoppingAddress!.serviceability !=
              Serviceability.serviceable =>
        Center(
          key: const ValueKey('address-not-serviceable'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.addressNotServiceable),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => context.push('/addresses'),
                child: Text(l10n.goAddresses),
              ),
            ],
          ),
        ),
      AsyncData() => const _DeliveryBody(),
      _ => UiStateView<Object?>(
        state: uiStateOf(book),
        onRetry: () => ref.invalidate(addressBookProvider),
        ready: (_, _) => const SizedBox.shrink(),
      ),
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.deliveryTitle), centerTitle: true),
      body: body,
    );
  }
}

class _DeliveryBody extends ConsumerStatefulWidget {
  const _DeliveryBody();

  @override
  ConsumerState<_DeliveryBody> createState() => _DeliveryBodyState();
}

class _DeliveryBodyState extends ConsumerState<_DeliveryBody> {
  bool _preparing = false;

  /// 서버가 최소 주문 미달이라고 하면 주문서로 넘어가지 않고 장바구니로 안내한다.
  Future<void> _next() async {
    setState(() => _preparing = true);
    // 결제창 설정을 초안과 동시에 받아 둔다(주문서에 들어간 뒤 차례로 받으면 결제수단이 늦게 뜬다).
    // 실패는 주문서가 결제수단 자리에 "다시 시도"로 보인다.
    ref.read(paymentWidgetConfigProvider.future).ignore();
    final gate = await ref.read(draftControllerProvider.notifier).prepare();
    if (!mounted) return;
    setState(() => _preparing = false);
    switch (gate) {
      case CheckoutGate.proceed:
        await context.push('/checkout');
      case CheckoutGate.rejected:
        final l10n = AppLocalizations.of(context);
        final error = ref.read(draftControllerProvider).error;
        final rejection = draftRejection(l10n, error);
        // 재고 부족(order 0.8.0)은 장바구니에서 고칠 일이라 장바구니로 돌아가 줄마다 보인다.
        final stock =
            error is ProblemFailure &&
            error.problem.code == CheckoutProblemCode.insufficientStock;
        if (stock) context.go('/cart');
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              // 버튼이 달린 SnackBar 는 Flutter 기본값으로 자동으로 닫히지 않는다(persist). 알림은 잠시 뒤 닫는다.
              persist: false,
              key: const ValueKey('delivery-rejected'),
              content: Text(rejection?.text ?? l10n.checkoutRejected),
              action: switch (rejection) {
                _ when stock => null,
                (
                  route: final String route,
                  action: final String label,
                  text: _,
                ) =>
                  SnackBarAction(
                    label: label,
                    onPressed: () => context.go(route),
                  ),
                _ => null,
              },
            ),
          );
      case CheckoutGate.minOrderUnmet:
        final l10n = AppLocalizations.of(context);
        final shortfall = ref
            .read(draftControllerProvider)
            .value
            ?.draft
            .quote
            ?.minOrderShortfall;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              // 버튼이 달린 SnackBar 는 Flutter 기본값으로 자동으로 닫히지 않는다(persist). 알림은 잠시 뒤 닫는다.
              persist: false,
              key: const ValueKey('delivery-min-order'),
              // BR-14: 부족액은 서버 값(minOrderShortfall)만 쓴다. 없으면 금액 없이 안내한다.
              content: Text(switch (shortfall) {
                final int n when n > 0 => l10n.minOrderShortfall(formatKrw(n)),
                _ => l10n.minOrderUnsatisfied,
              }),
              action: SnackBarAction(
                label: l10n.cartGoToCart,
                onPressed: () => context.go('/cart'),
              ),
            ),
          );
    }
  }

  bool _tomorrow = false;
  late final _note = TextEditingController(
    text: ref.read(checkoutSetupProvider).deliveryNote,
  );

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final setup = ref.watch(checkoutSetupProvider);
    final setupCtl = ref.read(checkoutSetupProvider.notifier);
    final options = ref.watch(deliveryOptionsProvider);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              UiStateView<List<DeliveryOption>>(
                state: uiStateOf(options, isEmpty: (o) => o.isEmpty),
                onRetry: () => ref.invalidate(deliveryOptionsProvider),
                ready: (context, list) => RadioGroup<DeliveryMode>(
                  groupValue: setup.mode,
                  onChanged: (m) {
                    if (m != null) setupCtl.setMode(m);
                  },
                  child: Column(
                    children: [
                      for (final o in list)
                        _ChoiceFrame(
                          selected: o.mode == setup.mode,
                          child: RadioListTile<DeliveryMode>(
                            key: ValueKey('mode-${o.mode.name}'),
                            value: o.mode,
                            enabled: o.available,
                            contentPadding: const EdgeInsets.only(
                              left: 4,
                              right: 16,
                            ),
                            visualDensity: VisualDensity.compact,
                            title: Text(
                              modeLabel(l10n, o.mode),
                              style: Theme.of(context).textTheme.titleSmall
                                  ?.copyWith(fontSize: 15),
                            ),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                optionSubtitle(l10n, o),
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(fontSize: 12.5),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              if (setup.mode == DeliveryMode.scheduled) ...[
                const SizedBox(height: 8),
                SegmentedButton<bool>(
                  segments: [
                    ButtonSegment(value: false, label: Text(l10n.slotToday)),
                    ButtonSegment(value: true, label: Text(l10n.slotTomorrow)),
                  ],
                  selected: {_tomorrow},
                  onSelectionChanged: (v) =>
                      setState(() => _tomorrow = v.first),
                ),
                const SizedBox(height: 8),
                _SlotPicker(tomorrow: _tomorrow),
              ],
              const Divider(height: 32),
              Text(
                l10n.orderOptionsTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              RadioGroup<OutOfStockPreference>(
                groupValue: setup.outOfStock,
                onChanged: (p) {
                  if (p != null) setupCtl.setOutOfStock(p);
                },
                child: Column(
                  children: [
                    RadioListTile(
                      value: OutOfStockPreference.cancelOutOfStockOnly,
                      title: Text(l10n.oosOnly),
                    ),
                    RadioListTile(
                      value: OutOfStockPreference.cancelAll,
                      title: Text(l10n.oosAll),
                    ),
                  ],
                ),
              ),
              TextField(
                key: const ValueKey('delivery-note'),
                controller: _note,
                maxLength: 200,
                decoration: InputDecoration(labelText: l10n.deliveryNote),
                onChanged: setupCtl.setNote,
              ),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                key: const ValueKey('delivery-next'),
                onPressed: setup.complete && !_preparing ? _next : null,
                child: _preparing
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.deliveryNext),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 고르는 항목 하나의 테두리. 고른 항목은 주 색 테두리 + 옅은 바탕.
class _ChoiceFrame extends StatelessWidget {
  const _ChoiceFrame({required this.selected, required this.child});

  final bool selected;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        clipBehavior: Clip.antiAlias,
        color: selected ? scheme.surfaceContainer : scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: child,
      ),
    );
  }
}

class _SlotPicker extends ConsumerWidget {
  const _SlotPicker({required this.tomorrow});

  final bool tomorrow;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final now = ref.watch(clockProvider)();
    final date = seoulDate(tomorrow ? now.add(const Duration(days: 1)) : now);
    final provider = slotsProvider(date);
    final setup = ref.watch(checkoutSetupProvider);
    final slots = ref.watch(provider);
    return UiStateView<List<Slot>>(
      state: uiStateOf(slots),
      // 슬롯 조회 실패는 자동 재시도하지 않는다. 고객이 "다시 조회"를 누른다.
      onRetry: () => ref.invalidate(provider),
      ready: (context, list) {
        if (!list.any((s) => s.selectable)) {
          return Padding(
            padding: const EdgeInsets.all(8),
            child: Text(l10n.slotEmpty),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final s in list)
                  ChoiceChip(
                    key: ValueKey('slot-${s.window.date}-${s.window.start}'),
                    selected: setup.window == s.window,
                    onSelected: s.selectable
                        ? (_) => ref
                              .read(checkoutSetupProvider.notifier)
                              .setWindow(s.window)
                        : null,
                    label: Text(
                      [
                        windowText(s.window),
                        switch (s.availability) {
                          SlotAvailability.available => switch (s.remaining) {
                            final int n => l10n.slotRemaining(n),
                            null => null,
                          },
                          SlotAvailability.full => l10n.slotFull,
                          SlotAvailability.closed => l10n.slotClosed,
                          SlotAvailability.configRequired =>
                            l10n.slotConfigRequired,
                          SlotAvailability.unavailable => l10n.slotUnavailable,
                        },
                      ].nonNulls.join(' · '),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(l10n.slotNote, style: Theme.of(context).textTheme.bodySmall),
          ],
        );
      },
    );
  }
}
