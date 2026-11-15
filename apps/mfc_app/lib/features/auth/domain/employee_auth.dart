import 'dart:convert';

import 'package:flutter/foundation.dart';

/// 로그인한 직원. 역할·센터는 화면 안내용이다(판정은 서버).
@immutable
final class EmployeeSession {
  const EmployeeSession({
    required this.operatorId,
    required this.roles,
    required this.centers,
  });

  /// 운영자 ID(`OP-…`, 토큰 `sub`)
  final String operatorId;
  final List<String> roles;
  final List<String> centers;

  /// 역할이 없으면 권한 승인 대기(업무 API 는 403).
  bool get awaitingGrant => roles.isEmpty;

  /// 센터 관리자(`MFC_SUPERVISOR`) — 홈에 관리 메뉴를 더 보인다(사용자 2026-11-16). 판정은 서버.
  bool get isSupervisor => roles.contains(mfcSupervisorRole);

  static const mfcSupervisorRole = 'MFC_SUPERVISOR';

  /// access token 의 클레임(`sub`·`roles`·`centers`)을 읽는다. 서명은 검증하지 않는다(안내용).
  /// 형식이 아니면 null. 토큰 값을 오류 문구·로그에 남기지 않는다.
  static EmployeeSession? fromAccessToken(String token) {
    final parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      final claims = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
      );
      if (claims is! Map<String, dynamic>) return null;
      final sub = claims['sub'];
      if (sub is! String || sub.isEmpty) return null;
      List<String> strings(Object? v) =>
          v is List ? v.whereType<String>().toList() : const [];
      return EmployeeSession(
        operatorId: sub,
        roles: strings(claims['roles']),
        centers: strings(claims['centers']),
      );
    } on FormatException {
      return null;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is EmployeeSession &&
      other.operatorId == operatorId &&
      listEquals(other.roles, roles) &&
      listEquals(other.centers, centers);

  @override
  int get hashCode =>
      Object.hash(operatorId, Object.hashAll(roles), Object.hashAll(centers));
}

/// 로그인이 끝나지 않은 이유(백엔드 handoff 2026-11-13 mfc-app-employee-login §4).
enum LoginError {
  /// PMart 직원으로 등록되지 않은 계정(`EMPLOYEE_NOT_REGISTERED`)
  notRegistered,

  /// 정지·퇴사·근무 시작일 전(`ACCOUNT_NOT_AVAILABLE`)
  accountNotAvailable,

  /// 로그인 창을 닫았거나 Keycloak 에서 취소·오류(`IDP_ERROR`)
  cancelled,

  /// 일시 오류(`IDP_REJECTED`·`IDP_UNAVAILABLE`)
  temporary,

  /// 티켓이 없거나 서버가 거절(만료·사용됨·다른 기기·verifier 불일치 — 서버가 이유를 나누지 않는다)
  ticketInvalid,

  /// 티켓 교환 결과를 모른다(네트워크·5xx). 티켓은 1회용이라 다시 로그인한다.
  network,

  /// 아이디·비밀번호가 맞지 않음 — 임시 아이디·비밀번호 로그인(목 전용)에서만 나온다.
  badCredentials,

  /// 계약에 없는 error 값
  unknown,
}

final class LoginFailure implements Exception {
  const LoginFailure(this.error);

  final LoginError error;

  /// 복귀 주소 `?error=` 코드 → 이유.
  static LoginError fromReturnCode(String code) => switch (code) {
    'EMPLOYEE_NOT_REGISTERED' => LoginError.notRegistered,
    'ACCOUNT_NOT_AVAILABLE' => LoginError.accountNotAvailable,
    'IDP_ERROR' => LoginError.cancelled,
    'IDP_REJECTED' || 'IDP_UNAVAILABLE' => LoginError.temporary,
    _ => LoginError.unknown,
  };

  @override
  String toString() => 'LoginFailure(${error.name})';
}

/// 세션이 끝난 이유(로그인 화면 안내).
enum SessionEnd {
  /// 무활동 30분·최대 12시간·다른 곳에서 끝남 — 다시 로그인하면 된다.
  expired,

  /// 정지·퇴사 — 이미 받은 토큰도 막힌다.
  accountBlocked,
}

sealed class AuthState {
  const AuthState();
}

/// 앱을 켠 직후: 보관한 refresh token 으로 세션을 되살리는 중.
final class AuthRestoring extends AuthState {
  const AuthRestoring();
}

final class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.ended});

  /// 세션이 끝나서 나온 경우의 이유. 직접 로그아웃했거나 처음이면 null.
  final SessionEnd? ended;
}

final class AuthSignedIn extends AuthState {
  const AuthSignedIn(this.session);

  final EmployeeSession session;
}
