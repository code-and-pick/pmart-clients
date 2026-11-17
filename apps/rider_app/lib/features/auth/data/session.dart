import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../delivery/data/mock_delivery_repository.dart';

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
    return RiderSession(riderId: id, registered: m['registered'] == true);
  } on Object {
    return null;
  }
}

final sessionProvider = NotifierProvider<SessionController, RiderSession?>(
  SessionController.new,
);

/// 로그인 결과.
enum LoginResult { loggedIn, notConnected }

/// 라이더 세션.
///
/// 목 모드는 버튼만으로 목 라이더로 들어간다. 실서버 Google 로그인(rider-auth-service
/// `POST /rider-auth/social-logins`)은 아직 붙이지 않았다 — 붙이기 전에는 [LoginResult.notConnected].
class SessionController extends Notifier<RiderSession?> {
  @override
  RiderSession? build() => ref.watch(initialSessionProvider);

  /// [newAccount] 는 목 모드에서 "처음 로그인한 계정(미가입)"을 흉내 낸다.
  Future<LoginResult> loginWithGoogle({bool newAccount = false}) async {
    if (ref.read(envProvider) != PmartEnv.mock) return LoginResult.notConnected;
    _set(
      RiderSession(
        riderId: MockDeliveryRepository.riderId,
        registered: !newAccount,
      ),
    );
    return LoginResult.loggedIn;
  }

  /// 가입이 끝났다(서버가 프로필을 돌려준 뒤에만 부른다).
  void markRegistered() {
    final s = state;
    if (s != null) _set(RiderSession(riderId: s.riderId, registered: true));
  }

  void logout() => _set(null);

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
