import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../router.dart' show routerProvider;
import '../../../shared/providers.dart';
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../notifications/presentation/notifications_controller.dart'
    show inboxProvider;
import '../data/push_source.dart';
import '../data/push_tokens_repository.dart';

final pushSourceProvider = Provider<PushSource>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => const NoPushSource(),
    PmartEnv.local => FirebasePushSource(),
  },
);

final pushTokensRepositoryProvider = Provider<PushTokensRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockPushTokensRepository(),
    PmartEnv.local => ApiPushTokensRepository(
      ref.watch(dioProvider),
      ref.watch(deviceIdProvider),
    ),
  },
);

/// 이 단말의 푸시 등록 상태. 화면에 "푸시가 온다"고 확정해 보이는 데 쓰지 않는다 —
/// [registered] 는 서버가 토큰을 받았다는 뜻일 뿐, 실제 발송·도달은 서버·단말 몫이다.
enum PushStatus {
  /// 비회원이거나 아직 시작 전.
  off,

  /// 이 빌드·모드에서는 푸시를 쓸 수 없다(목, 설정 파일 없음, 초기화 실패).
  unavailable,

  /// 고객이 알림 권한을 허용하지 않았다.
  denied,

  /// 서버가 이 단말의 토큰을 받았다.
  registered,

  /// 토큰을 받지 못했거나 서버 등록에 실패했다 — 다음 로그인·앱 시작·토큰 갱신 때 다시 한다.
  failed,
}

/// 회원이 되면 알림 권한을 묻고 FCM 토큰을 서버에 등록한다. 토큰이 바뀌면 다시 등록하고,
/// 비회원이 되면(로그아웃·세션 종료) 단말 토큰을 버린다. 비회원은 등록하지 않는다(본인 알림함이 없다).
///
/// 앱 루트(`CustomerApp`)가 지켜본다. 실패는 화면을 막지 않는다(푸시가 안 올 뿐 알림함은 그대로).
final pushRegistrationProvider =
    NotifierProvider<PushRegistrationController, PushStatus>(
      PushRegistrationController.new,
    );

class PushRegistrationController extends Notifier<PushStatus> {
  final _subscriptions = <StreamSubscription<void>>[];
  bool _listening = false;

  @override
  PushStatus build() {
    ref.onDispose(() {
      for (final s in _subscriptions) {
        unawaited(s.cancel());
      }
    });
    ref.listen<Session>(sessionProvider, (previous, next) {
      final wasMember = previous is MemberSession;
      if (next is MemberSession && !wasMember) unawaited(_start());
      if (next is GuestSession && wasMember) unawaited(_stop());
    }, fireImmediately: true);
    return PushStatus.off;
  }

  PushSource get _source => ref.read(pushSourceProvider);

  bool get _member => ref.read(sessionProvider) is MemberSession;

  void _set(PushStatus status) {
    if (ref.mounted) state = status;
  }

  Future<void> _start() async {
    try {
      if (!await _source.ready()) return _set(PushStatus.unavailable);
      if (!ref.mounted || !_member) return;
      _listen();
      if (!await _source.requestPermission()) return _set(PushStatus.denied);
      final token = await _source.token();
      if (!ref.mounted || !_member) return;
      if (token == null || token.isEmpty) return _set(PushStatus.failed);
      await _register(token);
    } on Object {
      // 단말 쪽 오류(Play 서비스 없음 등) — 푸시 없이 간다. 토큰이 섞일 수 있어 오류 내용은 남기지 않는다.
      _set(PushStatus.failed);
    }
  }

  void _listen() {
    if (_listening) return;
    _listening = true;
    _subscriptions
      ..add(
        _source.tokenRefreshes.listen((token) {
          if (_member && token.isNotEmpty) unawaited(_register(token));
        }, onError: (Object _) {}),
      )
      // 푸시를 누르면 알림함으로. 푸시 data 로 갈 화면을 고르는 것은 계약이 정해진 뒤(백엔드 질문 2026-11-17 Q4).
      ..add(
        _source.opened.listen((_) {
          if (ref.mounted) ref.read(routerProvider).push('/notifications');
        }, onError: (Object _) {}),
      )
      // 앱을 보고 있을 때 온 푸시는 알림을 띄우지 않으니 알림함(안 읽음 수)을 다시 읽는다.
      ..add(
        _source.received.listen((_) {
          if (ref.mounted && _member) ref.invalidate(inboxProvider);
        }, onError: (Object _) {}),
      );
  }

  /// 서버에 토큰을 등록한다. 결과를 모르면 같은 키로 한 번 더 보낸다(같은 단말 PUT 은 멱등).
  Future<void> _register(String token) async {
    final repo = ref.read(pushTokensRepositoryProvider);
    final key = IdempotencyKey.generate();
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        await repo.register(token, key: key);
        return _set(PushStatus.registered);
      } on UnknownResultFailure {
        continue;
      } on PmartFailure {
        break;
      }
    }
    _set(PushStatus.failed);
  }

  /// 비회원이 됐다 — 이 단말의 토큰을 버려, 서버에서 지우지 못한 옛 토큰으로도 더 오지 않게 한다.
  Future<void> _stop() async {
    _set(PushStatus.off);
    try {
      if (await _source.ready()) await _source.deleteToken();
    } on Object {
      // 못 버려도 로그아웃은 끝난다.
    }
  }

  /// 로그아웃 직전(회원 토큰이 아직 있을 때) 서버에서 이 단말을 지운다. 실패해도 로그아웃을 막지 않는다.
  Future<void> unregisterBeforeSignOut() async {
    try {
      if (!await _source.ready()) return;
      await ref
          .read(pushTokensRepositoryProvider)
          .unregister(key: IdempotencyKey.generate());
    } on Object {
      // 서버에서 못 지웠다 — 뒤이어 단말 토큰을 버리므로([_stop]) 그 토큰으로는 오지 않는다.
    }
  }
}
