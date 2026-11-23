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
    show helpStateLook;
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
        AsyncError() => _Message(
          text: l10n.recordLoadFailed,
          onRetry: () => ref.invalidate(deliveryProvider(deliveryId)),
        ),
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () async {
            ref
              ..invalidate(deliveryProvider(deliveryId))
              ..invalidate(deliveryHelpRecordsProvider(deliveryId));
          },
          child: ListView(
            key: const ValueKey('delivery-record'),
            children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      executionText(l10n, value.state),
                      key: const ValueKey('record-state'),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: RiderColors.primary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      storeText(l10n, value.mfcId),
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.recordReadOnly,
                      style: const TextStyle(
                        fontSize: 13,
                        color: RiderColors.sub,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              ColoredBox(
                color: Colors.white,
                child: OrderInfoSection(
                  trip: trip,
                  orderId: value.orderId,
                  mfcId: value.mfcId,
                ),
              ),
              const SizedBox(height: 8),
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
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
                  Container(
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                    child: Text(
                      l10n.recordNoHelp,
                      style: const TextStyle(color: RiderColors.sub),
                    ),
                  ),
                ],
                AsyncData(:final value) => [
                  for (final h in value)
                    ColoredBox(
                      color: Colors.white,
                      child: MenuRow(
                        key: ValueKey('record-help-${h.requestId}'),
                        icon: Icons.support_agent,
                        label: helpCategoryText(l10n, h.category),
                        value: helpStateLook(l10n, h.state).$1,
                        onTap: () => context.push(
                          '/deliveries/$deliveryId/support/${h.requestId}',
                        ),
                      ),
                    ),
                ],
                // 못 읽으면 "없음"으로 보이지 않는다.
                AsyncError() => [
                  Container(
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                    child: Text(
                      l10n.recordHelpFailed,
                      style: const TextStyle(color: RiderColors.danger),
                    ),
                  ),
                ],
                _ => [
                  const ColoredBox(
                    color: Colors.white,
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  ),
                ],
              },
              const SizedBox(height: 24),
            ],
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, required this.onRetry});

  final String text;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(text, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            TextButton(onPressed: onRetry, child: Text(l10n.retry)),
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
