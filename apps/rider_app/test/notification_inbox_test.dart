// 알림함 정리(사용자 2026-11-24 "계속 반복되는 알림 … 몇시에 온 건지도 … 이렇게 다 쌓여있어야 하나?").
// - 같은 도움요청 알림은 한 줄로("알림 n개"), 누르면 묶인 알림을 모두 읽음.
// - 배송이 끝난 도움요청 알림은 뺀다(배달 내역에서 본다). 배송 상태를 못 읽으면 빼지 않는다.
// - 줄마다 날짜·시각. 종 배지는 보이는 줄의 안 읽은 수.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/notifications/data/notifications.dart';
import 'package:rider_app/features/notifications/presentation/notification_screen.dart';
import 'package:rider_app/l10n/gen/app_localizations.dart';
import 'package:rider_app/shared/providers.dart';

class _FakeInbox implements NotificationRepository {
  _FakeInbox(this.items);

  List<RiderNotification> items;
  final marked = <String>[];

  @override
  Future<NotificationInbox> inbox() async =>
      (items: items, unread: items.where((n) => !n.read).length);

  @override
  Future<void> markRead(String id, {required IdempotencyKey key}) async {
    marked.add(id);
    items = [
      for (final n in items)
        n.id == id
            ? RiderNotification(
                id: n.id,
                title: n.title,
                body: n.body,
                createdAt: n.createdAt,
                read: true,
                target: n.target,
                notice: n.notice,
              )
            : n,
    ];
  }
}

RiderNotification _n(
  String id,
  DateTime at, {
  NotificationTarget target = const NoTarget(),
  bool read = false,
  String title = '지원센터 답장이 왔어요',
}) => RiderNotification(
  id: id,
  title: title,
  body: '도움요청에 지원센터가 답했어요.',
  createdAt: at,
  read: read,
  target: target,
);

void main() {
  setUpAll(initPmartFormatting);

  test('같은 도움요청 알림은 한 줄로, 최신 것이 앞', () {
    final t = DateTime.utc(2026, 11, 24, 1);
    const a = HelpRequestTarget('dlv-1', 'req-a');
    final g = groupNotifications([
      _n('1', t, target: a, read: true),
      _n('2', t.add(const Duration(minutes: 5)), target: a),
      _n('3', t.add(const Duration(minutes: 1))),
      _n('4', t.add(const Duration(minutes: 9)), target: a, read: true),
    ]);
    expect(g.map((e) => e.latest.id), ['4', '3']);
    expect(g.first.count, 3);
    expect(g.first.unread, isTrue, reason: '묶인 것 중 하나라도 안 읽었으면 안 읽음');
  });

  test('줄 시각: 오늘·어제는 그 말과 시각, 그 전은 날짜까지', () async {
    final l10n = await AppLocalizations.delegate.load(const Locale('ko'));
    final now = DateTime.utc(2026, 11, 24, 6); // 서울 15시
    expect(
      notiWhenText(l10n, DateTime.utc(2026, 11, 24, 1, 2), now: now),
      '오늘 오전 10:02',
    );
    expect(
      notiWhenText(l10n, DateTime.utc(2026, 11, 23, 8, 41), now: now),
      '어제 오후 5:41',
    );
    expect(
      notiWhenText(l10n, DateTime.utc(2026, 11, 22, 4, 2), now: now),
      '11월 22일 (일) 오후 1:02',
    );
  });

  test('끝난 배송의 도움요청 알림은 빠지고, 반복 답장은 한 줄', () async {
    final repo = MockDeliveryRepository(
      latency: Duration.zero,
      demoBundle: true,
    );
    repo.deliveryJson('dlv-b1')['state'] = 'COMPLETED';
    final now = DateTime.now();
    const live = HelpRequestTarget('dlv-1', 'req-live');
    const done = HelpRequestTarget('dlv-b1', 'req-done');
    const unknown = HelpRequestTarget('dlv-gone', 'req-x');
    final inbox = _FakeInbox([
      _n('l1', now.subtract(const Duration(minutes: 30)), target: live),
      _n('l2', now.subtract(const Duration(minutes: 20)), target: live),
      _n('l3', now.subtract(const Duration(minutes: 10)), target: live),
      _n('d1', now.subtract(const Duration(minutes: 50)), target: done),
      _n('d2', now.subtract(const Duration(minutes: 40)), target: done),
      _n('x1', now.subtract(const Duration(hours: 1)), target: unknown),
    ]);
    final c = ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        deliveryRepositoryProvider.overrideWithValue(repo),
        notificationRepositoryProvider.overrideWithValue(inbox),
      ],
    );
    addTearDown(c.dispose);
    final feed = await c.read(notificationFeedProvider.future);
    expect(feed.entries.map((e) => e.latest.id), ['l3', 'x1']);
    expect(feed.entries.first.count, 3);
    expect(feed.unread, 2, reason: '종 배지 = 보이는 줄의 안 읽은 수');
  });

  testWidgets('알림함 화면: 한 줄에 날짜·"알림 3개", 누르면 묶인 3건 읽음', (t) async {
    final repo = MockDeliveryRepository(latency: Duration.zero);
    final now = DateTime.now();
    const live = HelpRequestTarget('dlv-1', 'req-live');
    final inbox = _FakeInbox([
      for (var i = 0; i < 3; i++)
        _n('l$i', now.subtract(Duration(minutes: 30 - i)), target: live),
    ]);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          deliveryRepositoryProvider.overrideWithValue(repo),
          notificationRepositoryProvider.overrideWithValue(inbox),
        ],
        child: MaterialApp.router(
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: GoRouter(
            routes: [
              GoRoute(path: '/', builder: (_, _) => const NotificationScreen()),
              GoRoute(
                path: '/deliveries/:d/support/:r',
                builder: (_, s) => Text('thread ${s.pathParameters['r']}'),
              ),
            ],
          ),
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('noti-l2')), findsOneWidget);
    expect(find.byKey(const ValueKey('noti-l0')), findsNothing);
    final when = t.widget<Text>(find.byKey(const ValueKey('noti-when-l2')));
    expect(when.data, startsWith('오늘 '));
    expect(when.data, endsWith(' · 알림 3개'));
    await t.tap(find.byKey(const ValueKey('noti-l2')));
    await t.pumpAndSettle();
    expect(inbox.marked.toSet(), {'l0', 'l1', 'l2'});
    expect(find.text('thread req-live'), findsOneWidget);
  });

  testWidgets('공지(RIDER_NOTICE)는 꼬리표가 붙고, 누르면 전문 화면 — 읽음 표시(2026-11-24)', (
    t,
  ) async {
    final repo = MockDeliveryRepository(latency: Duration.zero);
    const long = '첫 줄이에요.\n둘째 줄이에요.\n셋째 줄 — 알림함에서는 두 줄까지만 보여요.\n넷째 줄 끝.';
    final inbox = _FakeInbox([
      RiderNotification(
        id: 'nt-1',
        title: '12월 운영 안내',
        body: long,
        createdAt: DateTime.now().subtract(const Duration(minutes: 5)),
        read: false,
        target: const NoTarget(),
        notice: true,
      ),
    ]);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          deliveryRepositoryProvider.overrideWithValue(repo),
          notificationRepositoryProvider.overrideWithValue(inbox),
        ],
        child: MaterialApp.router(
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: GoRouter(
            routes: [
              GoRoute(path: '/', builder: (_, _) => const NotificationScreen()),
              GoRoute(
                path: '/notifications/notice',
                builder: (_, st) =>
                    NoticeScreen(notice: st.extra as RiderNotification?),
              ),
            ],
          ),
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('noti-notice-nt-1')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('noti-nt-1')));
    await t.pumpAndSettle();
    expect(inbox.marked, ['nt-1']);
    expect(find.byKey(const ValueKey('notice-detail')), findsOneWidget);
    expect(find.text(long), findsOneWidget, reason: '본문 전문이 잘리지 않고 보인다');
  });
}
