import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../home/presentation/home_screen.dart';
import '../../offers/data/delivery_list_repository.dart';
import '../../offers/domain/offer_list.dart';
import '../../offers/presentation/offer_actions.dart';
import '../../offers/presentation/offer_controllers.dart';
import '../data/trip_repository.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'trip_widgets.dart' show packageCountText;

/// 배달리스트: 진행 중인 배송, (일반 배차모드면) 배차 대기 배송, 신규배차 켜기/끄기.
///
/// 레퍼런스의 예상 소요시간·새 경로 탐색은 계약에 값이 없어 두지 않는다.
class DeliveryListScreen extends ConsumerStatefulWidget {
  const DeliveryListScreen({super.key});

  @override
  ConsumerState<DeliveryListScreen> createState() => _DeliveryListScreenState();
}

class _DeliveryListScreenState extends ConsumerState<DeliveryListScreen> {
  /// 0 = 진행, 1 = 대기. 고르기 전에는 일반 배차모드면 대기부터(사용자 요청 2026-11-17).
  int? _picked;
  int _tab = 0;
  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  /// 대기 목록은 서버 `pollAfterSec` 간격으로 다시 읽는다(대기 탭을 볼 때만).
  void _schedule(WaitingList? list) {
    _poll?.cancel();
    final next = list?.pollAfter;
    if (_tab != 1 || next == null) return;
    _poll = Timer(next, () {
      if (mounted) ref.invalidate(waitingListProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final loaded = ref.watch(myActiveDeliveriesProvider);
    final ids = watchActiveDeliveryIds(ref);
    final duty = ref.watch(dutyProvider).value;
    final normalMode =
        ref.watch(dispatchModeProvider).value == DispatchMode.normal;
    _tab = _picked ?? (normalMode ? 1 : 0);
    final waiting = normalMode && _tab == 1
        ? ref.watch(waitingListProvider)
        : null;
    if (waiting != null) {
      ref.listen(waitingListProvider, (_, next) => _schedule(next.value));
    }
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(
        context,
        title: l10n.deliveryList,
        actions: [
          TextButton(
            key: const ValueKey('history'),
            onPressed: () => context.push('/my/history'),
            child: Text(
              l10n.pastList,
              style: const TextStyle(
                color: RiderColors.primary,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (normalMode)
            _Tabs(
              tab: _tab,
              active: ids.length,
              // 숨긴 배송은 세지 않는다
              waiting: waiting?.value?.items
                  .where(
                    (w) => !ref
                        .watch(hiddenWaitingProvider)
                        .contains(w.deliveryId),
                  )
                  .length,
              onTab: (i) {
                setState(() => _picked = i);
                if (i == 1) ref.invalidate(waitingListProvider);
              },
            ),
          if (waiting != null)
            Expanded(
              child: _Waiting(
                state: waiting,
                // 수락해도 대기 목록에 머문다 — 이어서 다른 배송을 수락할 수 있게(사용자 요청
                // 2026-11-17). 목록을 다시 읽어 수락한 배송을 빼고, 진행 수(탭)는 늘어난다.
                onAssigned: () => ref.invalidate(waitingListProvider),
              ),
            )
          else ...[
            // 2026-11-23 사용자 "상단 제목 부분이 검정으로 뜨는 거 답답" — 흰 머리줄에 맞춰 회색 띠도 연보라·짙은 글자로.
            // 목록을 못 읽었으면 "0건 진행 중"을 보이지 않는다(조회 실패를 0으로 보이지 않기 — 2026-11-24 폰 화면).
            if (!(loaded is AsyncError && ids.isEmpty))
              Container(
                width: double.infinity,
                color: RiderColors.primaryMist,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.listBannerTitle(ids.length),
                      style: const TextStyle(
                        color: RiderColors.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.listBannerBody,
                      style: const TextStyle(
                        color: RiderColors.sub,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            Expanded(
              // 조회 실패를 "배달 없음"으로 보이지 않는다.
              child: loaded is AsyncError && ids.isEmpty
                  ? RiderLoadError(
                      key: const ValueKey('list-error'),
                      title: l10n.listLoadFailed,
                      onRetry: () => ref.invalidate(myActiveDeliveriesProvider),
                    )
                  : loaded.isLoading && ids.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : ids.isEmpty
                  ? Center(
                      key: const ValueKey('list-empty'),
                      child: Text(
                        l10n.listEmpty,
                        style: const TextStyle(color: RiderColors.sub),
                      ),
                    )
                  : ListView(
                      children: [for (final id in ids) _Stop(deliveryId: id)],
                    ),
            ),
          ],
          Material(
            color: Colors.white,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        duty == null || !duty.onDuty
                            ? l10n.offDuty
                            : duty.newDispatchEnabled
                            ? l10n.newDispatchOn
                            : l10n.newDispatchOff,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: (duty?.newDispatchEnabled ?? false)
                              ? RiderColors.primary
                              : RiderColors.sub,
                        ),
                      ),
                    ),
                    Switch(
                      key: const ValueKey('list-new-dispatch'),
                      value: duty?.newDispatchEnabled ?? false,
                      onChanged: duty == null || !duty.onDuty
                          ? null
                          : (v) => changeDuty(
                              context,
                              ref,
                              onDuty: true,
                              newDispatch: v,
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stop extends ConsumerWidget {
  const _Stop({required this.deliveryId});

  final String deliveryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(deliveryId)).value;
    // 알뜰 여러 건이 모두 같은 점포로 보여 구분이 안 됐다(2026-11-20 S23) — 주문번호를 함께.
    final orderNo = ref.watch(tripInfoProvider(deliveryId)).value?.orderNo;
    final drop = d != null && !isPickupStage(d.state)
        ? ref.watch(dropInfoProvider(deliveryId)).value
        : null;
    final pickup = d == null || isPickupStage(d.state);
    final color = pickup ? RiderColors.pickup : RiderColors.drop;
    return Container(
      key: ValueKey('delivery-$deliveryId'),
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: () => context.push('/deliveries/$deliveryId'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 17,
                backgroundColor: color,
                child: Text(
                  pickup ? l10n.pinPickup : l10n.pinDrop,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d == null
                          ? l10n.deliveryNumber(deliveryId)
                          : pickup
                          ? storeText(l10n, d.mfcId)
                          : (drop?.roadAddress ?? l10n.dropInfoUnavailable),
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (d != null)
                      Text(
                        executionText(l10n, d.state),
                        style: const TextStyle(
                          fontSize: 15,
                          color: RiderColors.sub,
                        ),
                      ),
                    if (d != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          [
                            if (orderNo != null) l10n.orderNoShort(orderNo),
                            packageCountText(l10n, d.packageIds.length),
                          ].join(' · '),
                          style: const TextStyle(
                            fontSize: 15,
                            color: RiderColors.sub,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: RiderColors.sub),
            ],
          ),
        ),
      ),
    );
  }
}

class _Tabs extends StatelessWidget {
  const _Tabs({
    required this.tab,
    required this.active,
    required this.waiting,
    required this.onTab,
  });

  final int tab;
  final int active;
  final int? waiting;
  final ValueChanged<int> onTab;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    Widget item(int i, String label, int? count) => Expanded(
      child: InkWell(
        key: ValueKey('list-tab-$i'),
        onTap: () => onTab(i),
        child: Container(
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border(
              bottom: BorderSide(
                color: tab == i ? RiderColors.primary : RiderColors.line,
                width: tab == i ? 3 : 1,
              ),
            ),
          ),
          child: Text(
            count == null ? label : '$label $count',
            style: TextStyle(
              color: tab == i ? RiderColors.primary : RiderColors.sub,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
    return Row(
      children: [
        // 대기가 먼저(왼쪽) — 일반 배차모드에서 라이더가 고를 배송.
        item(1, l10n.tabWaiting, waiting),
        item(0, l10n.tabActive, active),
      ],
    );
  }
}

/// 배차 대기 배송(일반 배차모드). 목록에서 고르는 것 ≠ 확정 — 수락 판정은 서버가 한다.
/// 배달리스트(대기)에서 라이더가 "취소"로 숨긴 배송(사용자 요청 2026-11-18 — "배차수락 옆에 취소 버튼").
/// 서버에 거절 API 가 없어 이 앱 실행 동안 이 화면에서만 숨긴다(서버 판정·배차는 그대로 — 다시 켜면 다시 보인다).
final hiddenWaitingProvider = NotifierProvider<HiddenWaiting, Set<String>>(
  HiddenWaiting.new,
);

class HiddenWaiting extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void hide(String deliveryId) => state = {...state, deliveryId};
}

/// 일반 배차모드 수락 키(배송별). 판정을 받지 못하면 같은 키로만 다시 보낸다 — 화면이 바뀌어도 남게 앱 전역.
final waitingAcceptKeysProvider = Provider<Map<String, IdempotencyKey>>(
  (_) => <String, IdempotencyKey>{},
);

class _Waiting extends ConsumerStatefulWidget {
  const _Waiting({required this.state, required this.onAssigned});

  final AsyncValue<WaitingList> state;
  final VoidCallback onAssigned;

  @override
  ConsumerState<_Waiting> createState() => _WaitingState();
}

class _WaitingState extends ConsumerState<_Waiting> {
  final _busy = <String>{};

  Future<void> _accept(WaitingDelivery w) async {
    final l10n = AppLocalizations.of(context);
    // 키는 화면 밖(앱 전역)에 둔다 — 결과 불명 뒤 탭을 바꿨다 와도 같은 키로 다시 보낸다.
    final container = ProviderScope.containerOf(context, listen: false);
    final keys = container.read(waitingAcceptKeysProvider);
    final key = keys[w.deliveryId] ??= IdempotencyKey.generate();
    setState(() => _busy.add(w.deliveryId));
    OfferOutcome outcome;
    try {
      outcome = await container
          .read(deliveryListRepositoryProvider)
          .accept(w.deliveryId, key: key);
    } on UnknownResultFailure {
      outcome = const OfferUnknown();
    } on ProblemFailure catch (f) {
      outcome = OfferFailed(f.problem.code);
    } on PmartFailure {
      outcome = const OfferFailed(null);
    }
    if (outcome is! OfferUnknown) keys.remove(w.deliveryId);
    // 화면이 닫혔어도 배정·목록은 맞춘다.
    if (outcome case OfferAssigned(:final deliveryId)) {
      container
          .read(assignedDeliveriesProvider.notifier)
          .add(deliveryId ?? w.deliveryId);
    }
    if (outcome is! OfferRejected && outcome is! OfferLate) {
      // 배정됐거나 결과를 모르면 서버가 이미 배정했을 수 있다
      container.invalidate(myActiveDeliveriesProvider);
    }
    container.invalidate(waitingListProvider);
    if (!mounted) return;
    setState(() => _busy.remove(w.deliveryId));
    switch (outcome) {
      case OfferAssigned():
        showRiderToast(context, l10n.offerAssigned);
        widget.onAssigned();
      case OfferLate(:final reason):
        // 이미 배정·취소한 배송·최대 건수 초과 — 목록을 다시 읽는다.
        showRiderToast(context, lateText(l10n, reason));
      case OfferRejected():
        break;
      case OfferUnknown():
        showRiderToast(context, l10n.offerUnknown);
      case OfferFailed(:final code):
        showRiderToast(
          context,
          code == ProblemCode.notFound || code == ProblemCode.invalidState
              ? l10n.acceptGoneList
              : l10n.acceptFailed,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final hidden = ref.watch(hiddenWaitingProvider);
    final shown = switch (widget.state) {
      AsyncData(:final value) =>
        value.items.where((w) => !hidden.contains(w.deliveryId)).toList(),
      _ => const <WaitingDelivery>[],
    };
    return switch (widget.state) {
      AsyncData() when shown.isEmpty => Center(
        key: const ValueKey('waiting-empty'),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            // 위치가 안 오거나 위치 품질이 나빠도 목록이 빈다(서버가 구분해 주지 않는다).
            l10n.waitingEmpty,
            textAlign: TextAlign.center,
            style: const TextStyle(color: RiderColors.sub, height: 1.5),
          ),
        ),
      ),
      AsyncData() => ListView(
        children: [
          for (final w in shown)
            Container(
              key: ValueKey('waiting-${w.deliveryId}'),
              color: Colors.white,
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (modeText(l10n, w.mode) case final m?)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Text(
                            m,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: RiderColors.primary,
                            ),
                          ),
                        ),
                      Expanded(
                        child: Text(
                          w.dropAreaLabel ?? l10n.dropAreaUnknown,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      Text(
                        switch (w.estimatedFee) {
                          final int f => formatKrw(f),
                          null => l10n.offerFeeUnknown,
                        },
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    [
                      if (w.mfcId case final m?) storeText(l10n, m),
                      if (w.distanceKm case final d?)
                        l10n.distanceKm(d.toStringAsFixed(1)),
                      if (w.weightG case final g?)
                        l10n.weightKg((g / 1000).toStringAsFixed(1)),
                      if (w.bagCount case final b?) l10n.bagCount(b),
                      if (w.containsAlcohol ?? false) l10n.containsAlcohol,
                    ].join(' · '),
                    style: const TextStyle(
                      fontSize: 14,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      // 취소 = 이 목록에서 숨기기(서버에 보내지 않음 — 거절 API 없음).
                      // 배차 수락과 같은 사각형·높이·글씨, 바탕만 회색(사용자 2026-11-18 "같은 사각형으로").
                      // 가로는 배차 수락이 더 길게 2:3(사용자 2026-11-19 "취소가 더 면적이 작아야").
                      Expanded(
                        flex: 2,
                        child: RiderButton(
                          key: ValueKey('waiting-hide-${w.deliveryId}'),
                          height: 46,
                          color: RiderColors.sub,
                          label: l10n.waitingHide,
                          onPressed: _busy.contains(w.deliveryId)
                              ? null
                              : () {
                                  ref
                                      .read(hiddenWaitingProvider.notifier)
                                      .hide(w.deliveryId);
                                  showRiderToast(context, l10n.waitingHidden);
                                },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 3,
                        child: RiderButton(
                          key: ValueKey('waiting-accept-${w.deliveryId}'),
                          height: 46,
                          label: l10n.accept,
                          onPressed: _busy.contains(w.deliveryId)
                              ? null
                              : () => _accept(w),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
      AsyncError() => RiderLoadError(
        key: const ValueKey('waiting-error'),
        title: l10n.waitingLoadFailed,
        onRetry: () => ref.invalidate(waitingListProvider),
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}
