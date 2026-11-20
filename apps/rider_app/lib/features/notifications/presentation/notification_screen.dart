import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart' show formatSeoulDate, toSeoulWallClock;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/presentation/delivery_texts.dart' show clockText;
import '../data/notifications.dart';

/// 알림함: 지원센터 답장·처리 끝·문의 답변·계정 제한/해제. 누르면 읽음 처리 뒤 그 화면으로.
class NotificationScreen extends ConsumerWidget {
  const NotificationScreen({super.key});

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    RiderNotification n,
  ) async {
    if (!n.read) {
      try {
        await ref
            .read(notificationRepositoryProvider)
            .markRead(n.id, key: IdempotencyKey.generate());
      } on PmartFailure {
        // 읽음 표시 실패는 다음에 다시 — 이동은 한다.
      }
      ref.invalidate(notificationInboxProvider);
    }
    if (!context.mounted) return;
    switch (n.target) {
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
    final inbox = ref.watch(notificationInboxProvider);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuNotifications),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(notificationInboxProvider.future),
        child: switch (inbox) {
          AsyncData(:final value) when value.items.isEmpty => ListView(
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
              for (final (i, n) in value.items.indexed) ...[
                if (i == 0 ||
                    _day(value.items[i - 1].createdAt) != _day(n.createdAt))
                  _DayHeader(text: _dayText(l10n, n.createdAt)),
                _NotificationRow(n: n, onTap: () => _open(context, ref, n)),
              ],
            ],
          ),
          // 조회 실패를 "알림 없음"으로 보이지 않는다.
          AsyncError() => ListView(
            children: [
              Padding(
                padding: const EdgeInsets.all(24),
                child: Row(
                  key: const ValueKey('noti-error'),
                  children: [
                    Expanded(child: Text(l10n.notiLoadFailed)),
                    TextButton(
                      onPressed: () =>
                          ref.invalidate(notificationInboxProvider),
                      child: Text(l10n.retry),
                    ),
                  ],
                ),
              ),
            ],
          ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }
}

/// 서울 날짜(표시 묶음용 — 판정에 쓰지 않는다).
DateTime _day(DateTime t) {
  final s = toSeoulWallClock(t);
  return DateTime.utc(s.year, s.month, s.day);
}

String _dayText(AppLocalizations l10n, DateTime t) {
  final today = _day(DateTime.now());
  final d = _day(t);
  if (d == today) return l10n.notiToday;
  if (d == today.subtract(const Duration(days: 1))) return l10n.notiYesterday;
  return formatSeoulDate(t);
}

class _DayHeader extends StatelessWidget {
  const _DayHeader({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: RiderColors.sub,
      ),
    ),
  );
}

/// 알림 한 줄: 종류 그림(지원센터 답장·문의 답변·계정 안내) · 제목 · 내용 2줄 · 시각 · 안 읽음 점.
class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.n, required this.onTap});

  final RiderNotification n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (n.target) {
      HelpRequestTarget() => (Icons.support_agent, RiderColors.drop),
      InquiryTarget() => (Icons.chat_bubble_outline, RiderColors.primary),
      NoTarget() => (Icons.notifications_none, RiderColors.sub),
    };
    final body = n.body?.trim() ?? '';
    return Material(
      color: n.read ? Colors.white : RiderColors.primaryMist,
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
                        fontWeight: n.read ? FontWeight.w500 : FontWeight.w700,
                        color: n.read ? RiderColors.sub : RiderColors.ink,
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
                      clockText(n.createdAt),
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
                child: n.read
                    ? null
                    : Container(
                        key: ValueKey('noti-unread-${n.id}'),
                        margin: const EdgeInsets.only(top: 6),
                        height: 8,
                        decoration: const BoxDecoration(
                          color: RiderColors.primary,
                          shape: BoxShape.circle,
                        ),
                      ),
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
    final unread = ref.watch(notificationInboxProvider).value?.unread ?? 0;
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
