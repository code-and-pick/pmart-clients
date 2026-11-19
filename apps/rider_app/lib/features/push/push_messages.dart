import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../router.dart';
import '../../shared/rider_widgets.dart';
import '../notifications/data/notifications.dart';
import '../offers/presentation/offer_controllers.dart';
import 'push_tokens.dart';

/// 받은 푸시 한 건(notification-service — 백엔드 회신 2026-11-17 `reply-rider-push-send`).
///
/// - 알림함 알림: data `notificationId`·`templateKey`·`type`·`ref`(HELP_REQUEST · INQUIRY · NONE).
/// - 새 배차 제안: data `type: DISPATCH_OFFER`·`offerId`·`deliveryId`·`expiresAt`(알림함에는 없음).
/// - 일반 배차모드 새 배달: data `type: DELIVERY_LIST`·`newCount`·`sentAt`(백엔드 PR #192 — 라이더마다 1분에 한 번까지,
///   알림함에는 없음, 요청 2026-11-18 request-background-location-and-list-push §3). 누르면 배달리스트를 열고 다시 읽는다.
/// 푸시 내용으로 상태를 확정하지 않는다 — 화면을 열 때 서버에서 다시 읽는다.
@immutable
class PushMessage {
  const PushMessage({
    this.type,
    this.ref,
    this.notificationId,
    this.offerId,
    this.title,
    this.body,
  });

  factory PushMessage.fromData(
    Map<String, dynamic> data, {
    String? title,
    String? body,
  }) {
    String? s(String k) => switch (data[k]) {
      final String v when v.isNotEmpty => v,
      _ => null,
    };
    return PushMessage(
      type: s('type') ?? s('destinationType'),
      ref: s('ref') ?? s('destinationRef'),
      notificationId: s('notificationId'),
      offerId: s('offerId'),
      title: title,
      body: body,
    );
  }

  static const dispatchOffer = 'DISPATCH_OFFER';
  static const deliveryList = 'DELIVERY_LIST';

  final String? type;
  final String? ref;
  final String? notificationId;
  final String? offerId;
  final String? title;
  final String? body;

  bool get isOffer => type == dispatchOffer;
  bool get isDeliveryList => type == deliveryList;
}

/// 배달리스트 화면 경로(일반 배차모드 대기 목록).
const deliveryListRoute = '/deliveries';

/// 누르면 갈 곳. 배차 제안은 홈(제안 카드 — 다시 읽는다), 알림함 알림은 알림함과 같은 곳,
/// 목적지가 없으면 알림함. 모르는 것은 null(그대로 둔다).
String? pushRoute(PushMessage m) {
  if (m.isOffer) return '/';
  if (m.isDeliveryList) return deliveryListRoute;
  return switch (notificationTarget(m.type, m.ref)) {
    HelpRequestTarget(:final deliveryId, :final requestId) =>
      '/deliveries/$deliveryId/support/$requestId',
    InquiryTarget(:final inquiryId) => '/my/inquiries/$inquiryId',
    NoTarget() => m.notificationId == null ? null : '/notifications',
  };
}

/// 앱을 보고 있을 때 받은 푸시를 띄울 곳(시스템은 포그라운드에서 띄우지 않는다 — 앱이 직접).
final riderMessengerKeyProvider = Provider<GlobalKey<ScaffoldMessengerState>>(
  (_) => GlobalKey<ScaffoldMessengerState>(),
);

/// 받은 푸시 처리: 누름 → 화면 이동, 앱을 보고 있을 때 → 짧은 배너 + 목록 새로 읽기.
class PushHandler {
  PushHandler(this._ref);

  final Ref _ref;
  final _subs = <StreamSubscription<PushMessage>>[];

  void start() {
    final source = _ref.read(pushTokenSourceProvider);
    _subs
      ..add(source.onOpened.listen(open))
      ..add(source.onForeground.listen(foreground));
    // 앱이 꺼져 있을 때 알림을 눌러 켰다 — 첫 화면이 그려진 뒤 옮긴다.
    unawaited(
      source.initialMessage().then((m) {
        if (m != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) => open(m));
        }
      }),
    );
  }

  void _refresh(PushMessage m) {
    if (m.isOffer) {
      unawaited(_ref.read(offerPollerProvider.notifier).refreshNow());
    } else if (m.isDeliveryList) {
      // 서버 목록을 다시 읽는다(푸시의 newCount 로 목록을 만들지 않는다)
      _ref.invalidate(waitingListProvider);
    } else {
      _ref.invalidate(notificationInboxProvider);
    }
  }

  /// 알림을 눌렀다.
  void open(PushMessage m) {
    _refresh(m);
    // 알림함 알림은 눌렀으니 읽음(실패해도 이동은 한다).
    final id = m.notificationId;
    if (id != null && !m.isOffer && !m.isDeliveryList) {
      unawaited(
        _ref
            .read(notificationRepositoryProvider)
            .markRead(id, key: IdempotencyKey.generate())
            .catchError((Object _) {}),
      );
    }
    final route = pushRoute(m);
    if (route == null) return;
    final router = _ref.read(routerProvider);
    // 이미 배달리스트를 보고 있으면 옮기지 않는다(위에서 다시 읽음)
    if (m.isDeliveryList && _currentPath() == deliveryListRoute) return;
    if (route == '/') {
      router.go(route);
    } else {
      unawaited(router.push(route));
    }
  }

  /// 앱을 보고 있을 때 받았다.
  void foreground(PushMessage m) {
    _refresh(m);
    // 배달리스트를 보고 있으면 알림 없이 목록만 새로(요청 §3)
    if (m.isDeliveryList && _currentPath() == deliveryListRoute) return;
    // 화면 위쪽 안내 — 아래 버튼을 가리지 않고, "보기" 가 있어도 저절로 사라진다(사용자 2026-11-19).
    final overlay = _ref
        .read(routerProvider)
        .routerDelegate
        .navigatorKey
        .currentState
        ?.overlay;
    final title = m.title;
    if (overlay == null || title == null) return;
    final route = pushRoute(m);
    final withView = route != null && !(m.isOffer && _onHome());
    showRiderTopToast(
      overlay,
      [title, ?m.body].join('\n'),
      key: const ValueKey('push-banner'),
      // 읽고 "보기"를 누를 시간 — 일반 안내(2초)보다 조금 길게
      duration: Duration(seconds: m.isOffer ? 5 : 4),
      actionLabel: withView
          ? lookupAppLocalizations(const Locale('ko')).pushView
          : null,
      onAction: withView ? () => open(m) : null,
    );
  }

  /// 지금 맨 위 화면 경로 — push 로 연 화면도(routeInformationProvider 는 push 를 반영하지 않는다)
  String _currentPath() {
    final config = _ref
        .read(routerProvider)
        .routerDelegate
        .currentConfiguration;
    return config.isEmpty ? '/' : config.last.matchedLocation;
  }

  bool _onHome() => _currentPath() == '/';

  void dispose() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
  }
}

final pushHandlerProvider = Provider<PushHandler>((ref) {
  final h = PushHandler(ref)..start();
  ref.onDispose(h.dispose);
  return h;
});
