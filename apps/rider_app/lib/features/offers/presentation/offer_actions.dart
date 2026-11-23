import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_widgets.dart';
import '../../../shared/rider_style.dart';
import '../../delivery/presentation/delivery_controller.dart';
import '../domain/offer_list.dart';
import 'offer_controllers.dart';

String lateText(AppLocalizations l10n, LateReason r) => switch (r) {
  LateReason.expired => l10n.lateExpired,
  LateReason.alreadyAssigned => l10n.lateAlreadyAssigned,
  LateReason.orderCancelled => l10n.lateOrderCancelled,
  LateReason.ineligible => l10n.lateIneligible,
  LateReason.unknown => l10n.lateExpired,
};

/// 응답이 거절됐을 때(Problem) 문구. 없음·상태 다름은 "이미 처리된 제안", 권한은 "지금 받을 수 없음".
String offerFailedText(AppLocalizations l10n, String? code) => switch (code) {
  ProblemCode.notFound ||
  ProblemCode.invalidState ||
  ProblemCode.versionConflict ||
  ProblemCode.idempotencyConflict => l10n.offerGone,
  ProblemCode.forbidden => l10n.offerForbidden,
  _ => l10n.offerFailed,
};

/// 응답을 보내는 중인 제안(버튼을 막는다).
final respondingOffersProvider =
    NotifierProvider<RespondingOffers, Set<String>>(RespondingOffers.new);

class RespondingOffers extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void add(String id) => state = {...state, id};

  void remove(String id) => state = {...state}..remove(id);
}

/// 제안에 응답하고 판정을 안내한다. 판정은 서버 수신 시각 기준이다.
Future<OfferOutcome> respondToOffer(
  BuildContext context,
  WidgetRef ref,
  OfferItem offer, {
  required bool accept,
}) async {
  final l10n = AppLocalizations.of(context);
  final overlay = Overlay.of(context, rootOverlay: true);
  final navigator = Navigator.of(context, rootNavigator: true);
  // 응답을 기다리는 동안 화면이 닫혀도 끝까지 처리하도록 컨테이너를 잡아 둔다.
  final container = ProviderScope.containerOf(context, listen: false);
  final busy = container.read(respondingOffersProvider.notifier)
    ..add(offer.offerId);
  final OfferOutcome outcome;
  try {
    outcome = await container
        .read(offerResponderProvider)
        .respond(
          offer,
          accept: accept,
          reason: accept ? null : RejectReason.other,
        );
  } finally {
    // 어떤 경우에도 버튼을 다시 연다(전에는 예외면 앱을 다시 켤 때까지 막혔다).
    busy.remove(offer.offerId);
  }
  void toast(String text) => showRiderTopToast(overlay, text);
  switch (outcome) {
    case OfferAssigned():
      container.invalidate(myActiveDeliveriesProvider);
      toast(l10n.offerAssigned);
    case OfferLate(:final reason):
      toast(lateText(l10n, reason));
    case OfferRejected(:final rejectionNotice):
      if (rejectionNotice && navigator.mounted) {
        await showDialog<void>(
          context: navigator.context,
          builder: (context) => RiderAlertDialog(
            content: Text(l10n.rejectionNotice),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(l10n.ok),
              ),
            ],
          ),
        );
      }
    case OfferUnknown():
      // 서버가 이미 배정했을 수 있다 — 진행 중 배송을 다시 읽는다.
      container.invalidate(myActiveDeliveriesProvider);
      toast(l10n.offerUnknown);
    case OfferFailed(:final code):
      container.invalidate(myActiveDeliveriesProvider);
      toast(offerFailedText(l10n, code));
  }
  return outcome;
}

/// 제안 응답 버튼 줄: [거절] [배차 수락 | n초 남음].
///
/// 남은 시간은 서버 값에서 출발해 단말 경과 시간으로 줄인다. 0 이어도 만료 확정이 아니라 버튼은 남는다.
/// 거절 버튼은 AI 추천 배차 모드에만 있다(일반 모드는 응답하지 않으면 만료).
class OfferResponseBar extends ConsumerStatefulWidget {
  const OfferResponseBar({super.key, required this.offer, this.onResponded});

  final OfferItem offer;
  final void Function(OfferOutcome outcome)? onResponded;

  @override
  ConsumerState<OfferResponseBar> createState() => _OfferResponseBarState();
}

class _OfferResponseBarState extends ConsumerState<OfferResponseBar> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _respond(bool accept) async {
    final outcome = await respondToOffer(
      context,
      ref,
      widget.offer,
      accept: accept,
    );
    widget.onResponded?.call(outcome);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final offer = widget.offer;
    final busy = ref.watch(respondingOffersProvider).contains(offer.offerId);
    final aiMode =
        ref.watch(dispatchModeProvider).value == DispatchMode.aiRecommended;
    final remaining = ref
        .read(offerPollerProvider.notifier)
        .remainingFor(offer);
    return Row(
      children: [
        if (aiMode) ...[
          SizedBox(
            width: 76,
            height: 54,
            child: OutlinedButton(
              key: ValueKey('reject-${offer.offerId}'),
              onPressed: busy ? null : () => _respond(false),
              style: OutlinedButton.styleFrom(
                foregroundColor: RiderColors.sub,
                side: const BorderSide(color: RiderColors.line, width: 1.5),
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              child: Text(
                l10n.reject,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
        Expanded(
          child: SizedBox(
            height: 54,
            child: FilledButton(
              key: ValueKey('accept-${offer.offerId}'),
              onPressed: busy ? null : () => _respond(true),
              style: FilledButton.styleFrom(
                backgroundColor: RiderColors.primary,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    l10n.accept,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Container(
                    width: 1,
                    height: 16,
                    margin: const EdgeInsets.symmetric(horizontal: 10),
                    color: Colors.white70,
                  ),
                  Text(
                    l10n.offerRemaining(remaining),
                    key: ValueKey('remaining-${offer.offerId}'),
                    style: const TextStyle(fontSize: 16),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
