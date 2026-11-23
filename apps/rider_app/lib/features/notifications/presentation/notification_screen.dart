import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart'
    show formatSeoulDateTime, keepWords, toSeoulWallClock;

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
    if (e.latest.notice) {
      unawaited(context.push(noticeRoute(e.latest.id), extra: e.latest));
      return;
    }
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
              for (final (i, e) in value.entries.indexed) ...[
                if (i > 0)
                  const Divider(
                    height: 1,
                    indent: 78,
                    endIndent: 20,
                    color: RiderColors.gap,
                  ),
                _NotificationRow(e: e, onTap: () => _open(context, ref, e)),
              ],
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

/// 알림함·공지의 제목 글꼴(2026-11-24 사용자 "글자체, UI 다 촌스러워 … SUIT·Paperlogy·Gmarket Sans 비교").
/// PC 에 있는 글꼴(Noto Sans·Serif KR)로 바꿔 봤지만 사용자가 "더 별로야. 글씨체는 일단 그냥 둘게"(2026-11-24) — 앱 글꼴(Pretendard) 그대로.
const _displayFont = riderFontFamily;

/// 제목용 자간(em → px). 사용자 기준 -0.03~-0.05em.
double _tight(double size, [double em = -0.04]) => size * em;

/// 알림 종류: 작은 색 글자 이름 · 아이콘 · 색
(String, IconData, Color) _kindOf(AppLocalizations l10n, RiderNotification n) =>
    n.notice
    ? (l10n.noticeTag, Icons.campaign_rounded, RiderColors.pickup)
    : switch (n.target) {
        HelpRequestTarget() => (
          l10n.notiKindSupport,
          Icons.support_agent_rounded,
          RiderColors.drop,
        ),
        InquiryTarget() => (
          l10n.notiKindInquiry,
          Icons.chat_bubble_rounded,
          RiderColors.primary,
        ),
        NoTarget() => (
          l10n.notiKindAccount,
          Icons.notifications_rounded,
          RiderColors.sub,
        ),
      };

/// 알림 한 줄(2026-11-24 다시 그림 — "ppt 같아, 트렌디하지 못해"):
/// 위에 작은 종류·시각 한 줄, 그 아래 큰 제목(촘촘한 자간), 본문 두 줄. 안 읽음은 바탕 칠 대신 점 하나와 굵기로.
class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.e, required this.onTap});

  final NotificationEntry e;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final n = e.latest;
    final (kind, icon, color) = _kindOf(l10n, n);
    final body = n.body?.trim() ?? '';
    final unread = e.unread;
    return InkWell(
      key: ValueKey('noti-${n.id}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: color.withValues(alpha: unread ? 0.12 : 0.07),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                icon,
                size: 22,
                color: unread ? color : color.withValues(alpha: 0.55),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        kind,
                        key: n.notice ? ValueKey('noti-notice-${n.id}') : null,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: unread ? color : RiderColors.hint,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          [
                            notiWhenText(l10n, n.createdAt),
                            if (e.count > 1) l10n.notiGrouped(e.count),
                          ].join(' · '),
                          key: ValueKey('noti-when-${n.id}'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: RiderColors.hint,
                          ),
                        ),
                      ),
                      if (unread)
                        Container(
                          key: ValueKey('noti-unread-${n.id}'),
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: RiderColors.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    n.title,
                    style: TextStyle(
                      fontFamily: _displayFont,
                      fontSize: 16.5,
                      height: 1.3,
                      letterSpacing: _tight(16.5, -0.03),
                      fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
                      color: unread ? RiderColors.ink : RiderColors.sub,
                    ),
                  ),
                  if (body.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(
                      body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.5,
                        letterSpacing: -0.2,
                        color: unread ? RiderColors.sub : RiderColors.hint,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 공지 전문(2026-11-24 사용자 "공지 보내는 곳은 있는데 라이더앱에 공지를 읽는 곳은 없네?") — 알림함 줄은 본문 2줄까지라 끝까지 읽을 곳.
/// 다시 그림(같은 날 "ppt 같아 … 정보의 크기 대비와 여백을 재설계"):
/// - 위 판: 옅은 주황 판 안에 분류 꼬리표 → 큰 제목(촘촘한 자간) → 받은 시각. 문서 머리처럼 한 덩어리로.
/// - 본문: 넓은 좌우 여백, 행간 1.75, 빈 줄로 나눈 문단마다 띄움(문단 간격).
/// 서버 알림 그대로(제목·본문·받은 시각). 지우기 API 가 없어 지우는 버튼은 없다.
class NoticeScreen extends ConsumerWidget {
  const NoticeScreen({super.key, required this.notice, this.notificationId});

  /// 알림함에서 고른 공지(있으면 바로)
  final RiderNotification? notice;

  /// 푸시로 열었거나 앱을 다시 켜 [notice] 가 없으면 이 ID 로 알림함에서 찾는다
  final String? notificationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final id = notificationId;
    // 넘겨받은 공지가 없으면(푸시로 열었거나 앱을 다시 켬) 그 한 건을 서버에서 읽는다 — 알림함 첫 쪽에 없는 오래된 공지도
    final one = notice == null && id != null
        ? ref.watch(notificationByIdProvider(id))
        : null;
    if (one != null && one.isLoading && !one.hasValue) {
      return Scaffold(
        backgroundColor: Colors.white,
        appBar: riderDarkBar(context, title: ''),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    // 못 읽었으면 "공지를 열 수 없어요"가 아니라 조회 실패로(실패를 없음으로 보이지 않는다)
    if (one != null && one.hasError && !one.hasValue) {
      return Scaffold(
        backgroundColor: Colors.white,
        appBar: riderDarkBar(context, title: ''),
        body: RiderLoadError(
          key: const ValueKey('notice-error'),
          title: l10n.notiLoadFailed,
          onRetry: () => ref.invalidate(notificationByIdProvider(id!)),
        ),
      );
    }
    final RiderNotification? n = notice ?? one?.value;
    final paragraphs = (n?.body ?? '')
        .trim()
        .split(RegExp(r'\n\s*\n'))
        .map((p) => p.trim())
        .where((p) => p.isNotEmpty)
        .toList();
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: ''),
      body: n == null
          // 앱을 다시 켜 공지 정보를 잃었으면 알림함으로 돌아가 다시 고르게 한다.
          ? Center(
              child: Text(
                l10n.noticeMissing,
                style: const TextStyle(color: RiderColors.sub),
              ),
            )
          : ListView(
              key: const ValueKey('notice-detail'),
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 48),
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(22, 22, 22, 24),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(24),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        RiderColors.pickup.withValues(alpha: 0.13),
                        RiderColors.pickup.withValues(alpha: 0.04),
                      ],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.fromLTRB(8, 4, 10, 4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.campaign_rounded,
                              size: 16,
                              color: RiderColors.pickup,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              l10n.noticeTag,
                              style: const TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w800,
                                color: RiderColors.pickup,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        keepWords(n.title),
                        key: const ValueKey('notice-title'),
                        style: TextStyle(
                          fontFamily: _displayFont,
                          fontSize: 27,
                          height: 1.3,
                          letterSpacing: _tight(27),
                          fontWeight: FontWeight.w800,
                          color: RiderColors.ink,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        notiWhenText(l10n, n.createdAt),
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w500,
                          color: RiderColors.sub,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 30),
                for (final (i, p) in paragraphs.indexed)
                  Padding(
                    padding: EdgeInsets.fromLTRB(8, i == 0 ? 0 : 20, 8, 0),
                    child: SelectableText(
                      p,
                      style: const TextStyle(
                        fontSize: 16.5,
                        height: 1.75,
                        letterSpacing: -0.25,
                        color: Color(0xFF2B2B30),
                      ),
                    ),
                  ),
              ],
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
