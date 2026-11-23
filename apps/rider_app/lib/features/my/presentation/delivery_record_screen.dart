import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/data/trip_repository.dart';
import '../../delivery/domain/delivery.dart';
import '../../delivery/presentation/delivery_controller.dart';
import '../../delivery/presentation/delivery_texts.dart';
import '../../delivery/presentation/support_thread_screen.dart'
    show HelpStateChip, helpStateLook;
import '../../delivery/presentation/trip_widgets.dart';

/// 이 배송에서 내가 보낸 도움요청(서버 목록 — execution `GET /deliveries/{id}/help-requests`, 라이더 본인 것만).
final deliveryHelpRecordsProvider = FutureProvider.autoDispose
    .family<List<HelpRecord>, String>(
      (ref, id) => ref.watch(deliveryRepositoryProvider).helpRequests(id),
    );

/// 끝난 배송 보기(읽기 전용) — 사용자 2026-11-23 "배송 끝난 건 주문 내역도 라이더도 나중에 문제 생겼을 때 확인할 수 있게".
/// 배달기록에서 줄을 누르거나, 끝난 배송의 도움요청 대화에서 "배송 내역"으로 들어온다.
/// 배송 상태·주문 요약(품목·요청사항)·그때 보낸 도움요청(누르면 대화 — 처리 완료면 읽기만). 할 일 버튼은 없다.
class DeliveryRecordScreen extends ConsumerWidget {
  const DeliveryRecordScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final delivery = ref.watch(deliveryProvider(deliveryId));
    final trip = ref.watch(tripInfoProvider(deliveryId)).value;
    final helps = ref.watch(deliveryHelpRecordsProvider(deliveryId));
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(context, title: l10n.recordTitle),
      body: switch (delivery) {
        AsyncError() => RiderLoadError(
          title: l10n.recordLoadFailed,
          onRetry: () => ref.invalidate(deliveryProvider(deliveryId)),
        ),
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () async {
            ref
              ..invalidate(deliveryProvider(deliveryId))
              ..invalidate(deliveryHelpRecordsProvider(deliveryId));
          },
          // 화면 끝까지 붙은 흰 띠가 답답해 보인다(사용자 2026-11-24) — 회색 바탕에 둥근 카드, 상태는 색 칩.
          child: ListView(
            key: const ValueKey('delivery-record'),
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
            children: [
              _Card(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HelpStateChip(
                      key: const ValueKey('record-state'),
                      text: executionText(l10n, value.state),
                      color: _stateColor(value.state),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      storeText(l10n, value.mfcId),
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(
                          Icons.lock_outline_rounded,
                          size: 15,
                          color: RiderColors.hint,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            l10n.recordReadOnly,
                            style: const TextStyle(
                              fontSize: 13,
                              color: RiderColors.sub,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _Card(
                child: OrderInfoSection(
                  trip: trip,
                  orderId: value.orderId,
                  mfcId: value.mfcId,
                ),
              ),
              const SizedBox(height: 12),
              _Card(
                padding: const EdgeInsets.only(top: 16, bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 6),
                      child: Text(
                        l10n.recordHelpTitle,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    ...switch (helps) {
                      AsyncData(:final value) when value.isEmpty => [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
                          child: Text(
                            l10n.recordNoHelp,
                            style: const TextStyle(color: RiderColors.sub),
                          ),
                        ),
                      ],
                      AsyncData(:final value) => [
                        for (final (i, h) in value.indexed) ...[
                          if (i > 0)
                            const Divider(
                              height: 1,
                              indent: 18,
                              endIndent: 18,
                              color: RiderColors.gap,
                            ),
                          _HelpRow(
                            key: ValueKey('record-help-${h.requestId}'),
                            record: h,
                            onTap: () => context.push(
                              '/deliveries/$deliveryId/support/${h.requestId}',
                            ),
                          ),
                        ],
                      ],
                      // 못 읽으면 "없음"으로 보이지 않는다.
                      AsyncError() => [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
                          child: Text(
                            l10n.recordHelpFailed,
                            style: const TextStyle(color: RiderColors.danger),
                          ),
                        ),
                      ],
                      _ => [
                        const Padding(
                          padding: EdgeInsets.all(16),
                          child: Center(child: CircularProgressIndicator()),
                        ),
                      ],
                    },
                  ],
                ),
              ),
            ],
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

/// 둥근 흰 카드(배달 내역 칸).
class _Card extends StatelessWidget {
  const _Card({required this.child, this.padding = EdgeInsets.zero});

  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
    ),
    child: child,
  );
}

/// 끝난 상태 칩 색 — 전달 완료는 보라, 반납·취소·실패는 회색·빨강.
Color _stateColor(ExecutionState s) => switch (s) {
  ExecutionState.completed => RiderColors.primary,
  ExecutionState.failed => RiderColors.danger,
  _ => RiderColors.sub,
};

/// 도움요청 한 줄: 둥근 아이콘 · 유형 · 보낸 시각 · 처리 상태 칩 · >.
class _HelpRow extends StatelessWidget {
  const _HelpRow({super.key, required this.record, required this.onTap});

  final HelpRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = helpStateLook(l10n, record.state);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 12, 12, 12),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(
                color: RiderColors.primaryMist,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.support_agent,
                size: 20,
                color: RiderColors.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    helpCategoryText(l10n, record.category),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: RiderColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    clockText(record.sentAt),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: RiderColors.hint,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            HelpStateChip(text: text, color: color),
            const Icon(Icons.chevron_right, color: RiderColors.hint),
          ],
        ),
      ),
    );
  }
}

/// 끝난 배송인지(더 진행하지 않는 상태) — 도움요청 대화에서 "배송 내역" 길을 보일지 정한다.
bool isEndedDelivery(ExecutionState s) => switch (s) {
  ExecutionState.completed ||
  ExecutionState.returnedToStore ||
  ExecutionState.cancelled ||
  ExecutionState.failed => true,
  _ => false,
};
