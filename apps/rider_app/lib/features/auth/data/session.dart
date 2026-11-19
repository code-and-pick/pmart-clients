import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../delivery/data/mock_delivery_repository.dart';
import '../../push/push_tokens.dart';
import 'rider_auth.dart';

@immutable
class RiderSession {
  const RiderSession({required this.riderId, this.registered = true});

  final String riderId;

  /// 가입(rider-service 프로필)이 있는지. 로그인 뒤 `GET /riders/me` 가 404 면 false — 가입 화면으로 간다.
  final bool registered;
}

/// 앱을 켰을 때의 세션. 시험에서 로그인된 상태로 시작하려면 이것을 바꾼다.
final initialSessionProvider = Provider<RiderSession?>((_) => null);

const _sessionKey = 'pmart.rider.session';

/// 저장된 세션(라이더 ID·가입 여부만 — 토큰은 TokenStore 가 따로 갖는다).
/// 카메라를 여는 동안 Android 가 앱을 내렸다가 다시 켜도 로그인 화면으로 돌아가지 않게 한다.
Future<RiderSession?> loadSavedSession(SecureKeyValueStore store) async {
  try {
    final raw = await store.read(_sessionKey);
    if (raw == null || raw.isEmpty) return null;
    final m = jsonDecode(raw) as Map<String, dynamic>;
    final id = m['riderId'];
    if (id is! String) return null;
    // 가입을 마치지 않은 세션(지원하기 중)은 이어 열지 않는다 — 껐다 켜면 로그인 화면부터
    // (사용자 요청 2026-11-17). 가입한 라이더만 그대로 이어 간다.
    if (m['registered'] != true) {
      await store.delete(_sessionKey);
      return null;
    }
    return RiderSession(riderId: id);
  } on Object {
    return null;
  }
}

final sessionProvider = NotifierProvider<SessionController, RiderSession?>(
  SessionController.new,
);

/// 로그인 결과.
enum LoginResult {
  loggedIn,

  /// 계정 선택 창을 닫았다.
  canceled,

  /// 이 앱의 Google Android 클라이언트(패키지·서명 SHA-1)가 콘솔에 없다 등.
  misconfigured,

  /// 서버가 거절했다(계정 비활성·로그인 제한 등).
  rejected,

  /// 연결·Google 장애 — 잠시 뒤 다시.
  unavailable,

  /// 이 앱에 그 제공자 로그인이 없다 — 서버를 부르지 않았다.
  unsupported,

  /// 서버에 그 제공자 설정이 아직 없다(422 CONFIG_REQUIRED) — 이 실행 동안 그 버튼을 숨겼다.
  notReady,
}

/// 라이더 세션.
///
/// 목 모드는 버튼만으로 목 라이더로 들어간다. 실서버는 Google 로그인 → rider-auth-service
/// `POST /rider-auth/social-logins`(라이더 토큰) → `GET /riders/me`(404 = 미가입).
class SessionController extends Notifier<RiderSession?> {
  @override
  RiderSession? build() => ref.watch(initialSessionProvider);

  /// [newAccount] 는 목 모드에서 "처음 로그인한 계정(미가입)"을 흉내 낸다(실서버는 서버가 정한다).
  Future<LoginResult> loginWithGoogle({bool newAccount = false}) =>
      login(RiderSocialProvider.google, newAccount: newAccount);

  /// 이 번호로 가입한 다른 계정이 있다는 안내에서 "그 계정으로 로그인" — 지금(가입 중) 세션을 끝내고
  /// 그 제공자로 다시 로그인한다.
  /// 가입 중 세션의 서버 로그아웃·토큰 지우기를 **기다린 뒤** 로그인한다(늦게 끝난 로그아웃이 새 토큰을 지우지 않게).
  Future<LoginResult> switchAccount(RiderSocialProvider provider) async {
    await _endSession();
    return login(provider);
  }

  /// 제공자로 로그인. 목 모드는 버튼만으로 목 라이더로 들어간다(구글·카카오·네이버 같음).
  Future<LoginResult> login(
    RiderSocialProvider provider, {
    bool newAccount = false,
  }) async {
    if (ref.read(envProvider) == PmartEnv.mock) {
      _set(
        RiderSession(
          riderId: MockDeliveryRepository.riderId,
          registered: !newAccount,
        ),
      );
      return LoginResult.loggedIn;
    }
    final outcome = await ref
        .read(riderLoginProvider)
        .login(provider: provider);
    return switch (outcome) {
      RiderLoggedIn(:final riderId, :final registered) => () {
        _set(RiderSession(riderId: riderId, registered: registered));
        return LoginResult.loggedIn;
      }(),
      RiderLoginCanceled() => LoginResult.canceled,
      RiderLoginMisconfigured() => LoginResult.misconfigured,
      RiderLoginRejected() => LoginResult.rejected,
      RiderLoginUnavailable() => LoginResult.unavailable,
      RiderLoginUnsupported() => LoginResult.unsupported,
      RiderLoginProviderNotReady(:final provider) => () {
        ref.read(unavailableSocialProvidersProvider.notifier).hide(provider);
        return LoginResult.notReady;
      }(),
    };
  }

  /// 서버가 세션을 끝냈다(토큰 갱신 거절) — 토큰은 이미 지워졌다. 로그인 화면으로.
  void sessionExpired() => _set(null);

  /// 가입이 끝났다(서버가 프로필을 돌려준 뒤에만 부른다).
  void markRegistered() {
    final s = state;
    if (s != null) _set(RiderSession(riderId: s.riderId, registered: true));
  }

  void logout() => unawaited(_endSession());

  /// 세션을 바로 끝내고(화면은 로그인으로), 푸시 등록 해제·서버 로그아웃·토큰 지우기가 끝나면 완료되는 Future.
  Future<void> _endSession() {
    // 토큰을 지우기 전에 이 단말의 푸시 등록을 푼다(다른 라이더 알림이 이 단말로 오지 않게).
    final unregister = ref.read(pushUnregisterProvider);
    final real = ref.read(envProvider) != PmartEnv.mock;
    final login = real ? ref.read(riderLoginProvider) : null;
    final done = () async {
      // 오래 걸려도 로그아웃(토큰 지우기)을 붙잡지 않는다.
      await unregister().timeout(const Duration(seconds: 5), onTimeout: () {});
      await login?.logout();
    }();
    _set(null);
    return done;
  }

  void _set(RiderSession? s) {
    state = s;
    final store = ref.read(secureStoreProvider);
    unawaited(
      s == null
          ? store.delete(_sessionKey)
          : store.write(
              _sessionKey,
              jsonEncode({'riderId': s.riderId, 'registered': s.registered}),
            ),
    );
  }
}
