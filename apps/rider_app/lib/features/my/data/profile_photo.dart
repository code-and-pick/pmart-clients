import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../auth/data/session.dart';
import 'profile.dart';

/// 로그인한 제공자(구글·네이버·카카오) 계정에서 받은 것 — 마이페이지 프로필 사진·내 정보의 "로그인 계정" 이메일.
/// (사용자 2026-11-25 "네이버랑 구글에서 로그인할 때 받아온 프로필 사진이 떠야 해" · "로그인한 계정 이메일")
///
/// 로그인 때 제공자 ID 토큰의 `picture`·`email`(OIDC 표준, 네이버식 `profile_image` 도)을 읽는다.
/// 계약(rider-service `RiderProfile`)에 사진·이메일 칸이 없어 **이 기기에만** 둔다 — 서버로 보내지 않는다.
/// 로그에 남기지 않는다. 라이더마다 따로 두고, 로그인할 때마다 그 계정 값으로 바꾸며, 탈퇴하면 지운다.
@immutable
class LoginAccountInfo {
  const LoginAccountInfo({this.pictureUrl, this.email});

  final String? pictureUrl;
  final String? email;

  bool get isEmpty => pictureUrl == null && email == null;
}

String _key(String riderId) => 'pmart.rider.loginAccount.$riderId';

/// ID 토큰 본문의 사진(https 만)·이메일. 화면에 보이기만 하므로 서명은 보지 않는다(검증은 서버 몫). 못 읽으면 빈 값.
LoginAccountInfo accountFromIdToken(String idToken) {
  try {
    final parts = idToken.split('.');
    if (parts.length < 2) return const LoginAccountInfo();
    final payload = utf8.decode(
      base64Url.decode(base64Url.normalize(parts[1])),
    );
    final claims = jsonDecode(payload);
    if (claims is! Map) return const LoginAccountInfo();
    // 디버그 빌드에서만 claim **이름**(값 아님)을 남긴다 — 제공자가 사진·이메일을 주는지 실기기에서 확인용.
    if (kDebugMode) {
      debugPrint('[rider-profile] id_token claims: ${claims.keys.join(',')}');
    }
    final email = claims['email'];
    return LoginAccountInfo(
      pictureUrl: httpsOrNull(claims['picture'] ?? claims['profile_image']),
      email: email is String && email.contains('@') ? email : null,
    );
  } on Object {
    return const LoginAccountInfo();
  }
}

/// https 주소만 통과.
String? httpsOrNull(Object? v) {
  if (v is! String) return null;
  final uri = Uri.tryParse(v);
  return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty ? v : null;
}

/// 기기 저장(보안 저장소) — 라이더마다 하나.
final class LoginAccountStore {
  const LoginAccountStore(this._store);

  final SecureKeyValueStore _store;

  Future<LoginAccountInfo> load(String riderId) async {
    try {
      final raw = await _store.read(_key(riderId));
      if (raw == null || raw.isEmpty) return const LoginAccountInfo();
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final email = m['email'];
      return LoginAccountInfo(
        pictureUrl: httpsOrNull(m['picture']),
        email: email is String ? email : null,
      );
    } on Object {
      return const LoginAccountInfo();
    }
  }

  /// 이번 로그인에서 받은 값으로 바꾼다(없는 것은 지운다 — 보이는 값 = 지금 로그인한 계정의 값).
  Future<void> save(String riderId, LoginAccountInfo info) => info.isEmpty
      ? _store.delete(_key(riderId))
      : _store.write(
          _key(riderId),
          jsonEncode({'picture': ?info.pictureUrl, 'email': ?info.email}),
        );

  Future<void> delete(String riderId) => _store.delete(_key(riderId));
}

final loginAccountStoreProvider = Provider<LoginAccountStore>(
  (ref) => LoginAccountStore(ref.watch(secureStoreProvider)),
);

/// 지금 라이더의 로그인 계정 정보. 로그인 안 했으면 빈 값.
final loginAccountProvider = FutureProvider<LoginAccountInfo>((ref) async {
  final riderId = ref.watch(sessionProvider.select((s) => s?.riderId));
  if (riderId == null) return const LoginAccountInfo();
  return ref.read(loginAccountStoreProvider).load(riderId);
});

/// 서버가 둔 소셜 프로필 사진(rider 0.31.0) — `profileImageUrl` 이 있을 때만 받는다(주소의 `v` 가 바뀌면 다시).
/// 없음(404)·실패는 null — 아래 기기 사진 주소나 기본 그림으로.
final serverProfileImageProvider = FutureProvider<Uint8List?>((ref) async {
  final url = ref.watch(
    profileProvider.select((p) => p.value?.profileImageUrl),
  );
  if (url == null) return null;
  try {
    return await ref.read(profileRepositoryProvider).profileImage();
  } on PmartFailure {
    return null;
  }
});

/// 마이페이지 동그라미 사진 주소(로그인 ID 토큰의 사진 — 서버 사본이 없을 때). 없으면 null.
final profilePhotoProvider = Provider<String?>(
  (ref) => ref.watch(loginAccountProvider).value?.pictureUrl,
);
