import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart'
    show formatSeoulDateTime, toSeoulWallClock;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/presentation/delivery_controller.dart'
    show deliveryRepositoryProvider;
import '../../delivery/presentation/delivery_texts.dart' show clockText;
import '../../my/presentation/delivery_record_screen.dart' show isEndedDelivery;
import '../data/notifications.dart';

/// 끝난 배송 id(이번 실행 동안 — 끝난 배송은 다시 진행하지 않으니 한 번 확인하면 된다).
final _endedDeliveriesProvider = Provider<Set<String>>((_) => <String>{});

/// 알림함에 보일 줄과 안 읽은 수(사용자 2026-11-24 "이렇게 다 쌓여있어야 하나?").
/// - 같은 도움요청의 알림은 한 줄로 묶는다.
/// - 배송이 끝난 도움요청 알림은 알림함에서 뺀다 — 그 대화는 배달기록 > 배달 내역에서 본다.
///   배송 상태를 못 읽으면 빼지 않는다(모르는 것을 끝난 것으로 치지 않는다).
/// - 안 읽은 수는 보이는 줄 기준(종 배지와 알림함이 같은 수를 보인다).
final notificationFeedProvider =
    FutureProvider.autoDispose<({List<NotificationEntry> entries, int unread})>(
      (ref) async {
        final inbox = await ref.watch(notificationInboxProvider.future);
        final ended = ref.read(_endedDeliveriesProvider);
        final repo = ref.read(deliveryRepositoryProvider);
        final ids = {
          for (final n in inbox.items)
            if (n.target case HelpRequestTarget(:final deliveryId)) deliveryId,
        }.difference(ended);
        await Future.wait([
          for (final id in ids)
            repo.get(id).then((d) {
              if (isEndedDelivery(d.state)) ended.add(id);
            }, onError: (Object _) {}),
        ]);
        final entries = [
          for (final e in groupNotifications(inbox.items))
            if (!_hidden(e, ended)) e,
        ];
        return (
          entries: entries,
          unread: entries.where((e) => e.unread).length,
        );
      },
    );

bool _hidden(NotificationEntry e, Set<String> ended) =>
    switch (e.latest.target) {
      HelpRequestTarget(:final deliveryId) => ended.contains(deliveryId),
      _ => false,
    };

/// 알림함: 지원센터 답장·처리 끝·문의 답변·계정 제한/해제. 누르면 읽음 처리 뒤 그 화면으로.
class NotificationScreen extends ConsumerWidget {
  const NotificationScreen({super.key});

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    NotificationEntry e,
  ) async {
    final unread = [
      for (final n in e.all)
        if (!n.read) n,
    ];
    if (unread.isNotEmpty) {
      // 묶인 알림을 모두 읽음으로(하나씩 차례로).
      for (final n in unread) {
        try {
          await ref
              .read(notificationRepositoryProvider)
              .markRead(n.id, key: IdempotencyKey.generate());
        } on PmartFailure {
          // 읽음 표시 실패는 다음에 다시 — 이동은 한다.
        }
      }
      ref.invalidate(notificationInboxProvider);
    }
    if (!context.mounted) return;
    switch (e.latest.target) {
      case HelpRequestTarget(:final deliveryId, :final requestId):
        unawaited(context.push('/deliveries/$deliveryId/support/$requestId'));
      case InquiryTarget(:final inquiryId):
        unawaited(context.push('/my/inquiries/$inquiryId'));
      case NoTarget():
        break;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final feed = ref.watch(notificationFeedProvider);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuNotifications),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notificationInboxProvider);
          await ref.read(notificationFeedProvider.future);
        },
        child: switch (feed) {
          AsyncData(:final value) when value.entries.isEmpty => ListView(
            children: [
              SupportEmpty(
                key: const ValueKey('noti-empty'),
                icon: Icons.notifications_none,
                text: l10n.notiEmpty,
              ),
            ],
          ),
          AsyncData(:final value) => ListView(
            key: const ValueKey('noti-list'),
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              for (final e in value.entries)
                _NotificationRow(e: e, onTap: () => _open(context, ref, e)),
            ],
          ),
          // 조회 실패를 "알림 없음"으로 보이지 않는다.
          // 당겨서 새로고침이 되게 목록 안에, 화면 가운데쯤.
          AsyncError() => LayoutBuilder(
            builder: (context, box) => ListView(
              children: [
                SizedBox(
                  height: box.maxHeight * 0.8,
                  child: RiderLoadError(
                    key: const ValueKey('noti-error'),
                    title: l10n.notiLoadFailed,
                    onRetry: () => ref.invalidate(notificationInboxProvider),
                  ),
                ),
              ],
            ),
          ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }
}

/// 서울 날짜(표시용 — 판정에 쓰지 않는다).
DateTime _day(DateTime t) {
  final s = toSeoulWallClock(t);
  return DateTime.utc(s.year, s.month, s.day);
}

/// 줄마다 날짜까지: "오늘 오후 7:51" · "어제 오후 5:41" · "11월 22일 (토) 오후 1:02"
/// (위로 올리면 날짜 머리글이 안 보여 언제 온 건지 모른다 — 사용자 2026-11-24).
String notiWhenText(AppLocalizations l10n, DateTime t, {DateTime? now}) {
  final today = _day(now ?? DateTime.now());
  final d = _day(t);
  if (d == today) return '${l10n.notiToday} ${clockText(t)}';
  if (d == today.subtract(const Duration(days: 1))) {
    return '${l10n.notiYesterday} ${clockText(t)}';
  }
  return formatSeoulDateTime(t);
}

/// 알림 한 줄: 종류 그림 · 제목 · 내용 2줄 · 날짜·시각(묶였으면 "알림 n개") · 안 읽음 점.
class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.e, required this.onTap});

  final NotificationEntry e;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final n = e.latest;
    final (icon, color) = switch (n.target) {
      HelpRequestTarget() => (Icons.support_agent, RiderColors.drop),
      InquiryTarget() => (Icons.chat_bubble_outline, RiderColors.primary),
      NoTarget() => (Icons.notifications_none, RiderColors.sub),
    };
    final body = n.body?.trim() ?? '';
    final unread = e.unread;
    return Material(
      color: unread ? RiderColors.primaryMist : Colors.white,
      child: InkWell(
        key: ValueKey('noti-${n.id}'),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(20, 14, 16, 14),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: RiderColors.gap)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 21, color: color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      n.title,
                      style: TextStyle(
                        fontSize: 15,
                        height: 1.35,
                        fontWeight: unread ? FontWeight.w700 : FontWeight.w500,
                        color: unread ? RiderColors.ink : RiderColors.sub,
                      ),
                    ),
                    if (body.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.4,
                          color: RiderColors.sub,
                        ),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      [
                        notiWhenText(l10n, n.createdAt),
                        if (e.count > 1) l10n.notiGrouped(e.count),
                      ].join(' · '),
                      key: ValueKey('noti-when-${n.id}'),
                      style: const TextStyle(
                        fontSize: 12,
                        color: RiderColors.hint,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 8,
                child: unread
                    ? Container(
                        key: ValueKey('noti-unread-${n.id}'),
                        margin: const EdgeInsets.only(top: 6),
                        height: 8,
                        decoration: const BoxDecoration(
                          color: RiderColors.primary,
                          shape: BoxShape.circle,
                        ),
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 홈 위쪽 종 버튼 + 안 읽은 수. 푸시가 없어 30초마다 확인한다(백엔드 회신 2026-11-17 "앱이 할 것").
class NotificationBell extends ConsumerStatefulWidget {
  const NotificationBell({super.key});

  @override
  ConsumerState<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends ConsumerState<NotificationBell> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) ref.invalidate(notificationInboxProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final unread = ref.watch(notificationFeedProvider).value?.unread ?? 0;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        MapCircleButton(
          key: const ValueKey('notifications'),
          icon: Icons.notifications_none,
          onTap: () async {
            await context.push('/notifications');
            ref.invalidate(notificationInboxProvider);
          },
        ),
        if (unread > 0)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              key: const ValueKey('noti-badge'),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: RiderColors.danger,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                unread > 99 ? '99+' : '$unread',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
