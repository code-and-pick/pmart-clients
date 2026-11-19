import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import 'rider_auth.dart' show RiderSocialProvider;

/// 휴대폰 본인 확인(OCTOMO — 라이더가 대표번호로 문자를 보내는 방식).
///
/// rider-service 0.17.0(백엔드 #250 병합·배포, 2026-11-20 실서버 연결):
/// - `POST /riders/me/phone-verifications {phone}` → `{verificationId, sendTo, text, expiresAt, phoneMasked, maxAttempts}`
///   (400 PHONE_NOT_SUPPORTED — 010 아님, 429 TOO_MANY_VERIFICATIONS — 하루 횟수 초과, 422 CONFIG_REQUIRED — 서버 설정 없음,
///   409 IDENTITY_ALREADY_REGISTERED·RIDER_REJOIN_BLOCKED — **시작 때** 온다)
/// - "보냈어요" 때만 `POST …/{id}/confirmations {phone}`(같은 번호 다시) → state VERIFIED·PENDING(remainingAttempts)·FAILED·EXPIRED,
///   503 = OCTOMO 장애(시도 횟수 줄지 않음 — 같은 키로 다시). `GET …/{id}` 는 응답을 못 받았을 때 짝 조회.
/// - 409 details 는 `[{field, reason}]` — IDENTITY_ALREADY_REGISTERED: provider(없을 수 있음)·emailMasked(없을 수 있음)·joinedAt,
///   RIDER_REJOIN_BLOCKED: until.
/// - 가입 `POST /riders/signups` 에 phoneVerificationId(확인 뒤 1시간 안).
/// 요청·회신: `docs/handoff/rider-app/2026-11-19-backend-rider-social-login-identity.md`,
/// `../pmart-backend/docs/handoff/clients/rider-app/2026-11-19-reply-rider-social-login-identity.md`.
@immutable
class PhoneIdentityStart {
  const PhoneIdentityStart({
    required this.verificationId,
    required this.sendTo,
    required this.text,
    required this.expiresAt,
    required this.phoneMasked,
    this.maxAttempts,
  });

  final String verificationId;

  /// 받는 번호(OCTOMO 대표번호). 라이더가 이 번호로 보낸다.
  final String sendTo;

  /// 보낼 문자 본문 — 고치면 확인되지 않는다(완전 일치).
  final String text;
  final DateTime expiresAt;
  final String phoneMasked;
  final int? maxAttempts;
}

/// 이 번호로 이미 가입한 다른 라이더 계정(계정 ID·전체 번호는 없다).
@immutable
class ExistingRiderAccount {
  const ExistingRiderAccount({
    required this.provider,
    required this.joinedAt,
    required this.emailMasked,
  });

  /// 가입한 로그인 수단. 서버가 로그인 정보를 찾지 못하면 details 에 없다(null — 화면은 그 줄·버튼을 뺀다).
  final RiderSocialProvider? provider;
  final DateTime? joinedAt;
  final String? emailMasked;
}

/// "보냈어요"(확인) 결과.
sealed class PhoneIdentityOutcome {
  const PhoneIdentityOutcome();
}

/// 아직 문자가 확인되지 않았다(시도 1번 줄어듦).
final class PhoneIdentityPending extends PhoneIdentityOutcome {
  const PhoneIdentityPending(this.remainingAttempts);
  final int remainingAttempts;
}

/// 본인 확인됨 — 이 번호로 가입을 이어 간다.
final class PhoneIdentityVerified extends PhoneIdentityOutcome {
  const PhoneIdentityVerified();
}

/// 확인 실패로 끝났다(시도 횟수 다 씀·번호 바뀜) — 처음부터 다시.
final class PhoneIdentityFailed extends PhoneIdentityOutcome {
  const PhoneIdentityFailed();
}

/// 시간이 지났다 — 처음부터 다시.
final class PhoneIdentityExpired extends PhoneIdentityOutcome {
  const PhoneIdentityExpired();
}

/// 이 번호로 가입한 다른 계정이 있다(한 번호 한 계정 — 409 `IDENTITY_ALREADY_REGISTERED`).
final class PhoneIdentityAlreadyRegistered extends PhoneIdentityOutcome {
  const PhoneIdentityAlreadyRegistered(this.account);
  final ExistingRiderAccount account;
}

/// 탈퇴한 번호 — 서버가 준 날(`until`, 탈퇴 뒤 30일)부터 다시 가입할 수 있다(409 `RIDER_REJOIN_BLOCKED`).
final class PhoneIdentityRejoinBlocked extends PhoneIdentityOutcome {
  const PhoneIdentityRejoinBlocked(this.until);
  final DateTime until;
}

/// 확인 서버(OCTOMO) 조회 실패·한도 초과(503 DEPENDENCY_UNAVAILABLE) — 시도 횟수는 줄지 않았다. 잠시 뒤 다시.
final class PhoneIdentityBusy implements Exception {
  const PhoneIdentityBusy();
}

/// 시작을 서버가 거절했다 — 400 PHONE_NOT_SUPPORTED(010 휴대폰 아님)·429(하루 시작 횟수 초과)·
/// 422 CONFIG_REQUIRED(서버에 확인 설정이 없음 — 준비 중).
enum PhoneIdentityStartRejection { notSupported, tooMany, notReady }

final class PhoneIdentityStartRejected implements Exception {
  const PhoneIdentityStartRejected(this.reason);
  final PhoneIdentityStartRejection reason;
}

/// 확인 없이 계속(서버에 확인 설정이 없음 — 422 CONFIG_REQUIRED)일 때 본인 확인 화면이 돌려주는 값.
/// 확인 ID 가 아니다 — 가입 요청에 phoneVerificationId 를 넣지 않는다.
const phoneIdentitySkipped = '';

/// 시작에서 끝났다 — 이 번호로 가입한 다른 계정이 있거나([PhoneIdentityAlreadyRegistered]) 탈퇴한 번호
/// ([PhoneIdentityRejoinBlocked]). 서버는 이 둘을 시작(·가입) 때 409 로 준다.
final class PhoneIdentityStartEnded implements Exception {
  const PhoneIdentityStartEnded(this.outcome);
  final PhoneIdentityOutcome outcome;
}

RiderSocialProvider? _providerOf(String? v) => switch (v) {
  'GOOGLE' => RiderSocialProvider.google,
  'KAKAO' => RiderSocialProvider.kakao,
  'NAVER' => RiderSocialProvider.naver,
  _ => null,
};

/// 409 IDENTITY_ALREADY_REGISTERED·RIDER_REJOIN_BLOCKED → 화면 결과. 그 밖의 코드는 null.
/// 시작(`POST /riders/me/phone-verifications`)과 가입(`POST /riders/signups`)이 같은 모양을 준다.
PhoneIdentityOutcome? identityConflictOf(Problem problem) {
  String? detail(String field) => problem.details
      .where((d) => d.field == field)
      .map((d) => d.reason)
      .firstOrNull;
  switch (problem.code) {
    case 'IDENTITY_ALREADY_REGISTERED':
      final email = detail('emailMasked');
      return PhoneIdentityAlreadyRegistered(
        ExistingRiderAccount(
          provider: _providerOf(detail('provider')),
          joinedAt: DateTime.tryParse(detail('joinedAt') ?? '')?.toUtc(),
          emailMasked: email == null || email.isEmpty ? null : email,
        ),
      );
    case 'RIDER_REJOIN_BLOCKED':
      final until = DateTime.tryParse(detail('until') ?? '');
      // 다시 가입할 수 있는 때가 없으면 날짜를 지어내지 않는다 — 계약 위반으로 올린다.
      if (until == null) {
        throw const ContractViolationFailure('RIDER_REJOIN_BLOCKED until 없음');
      }
      return PhoneIdentityRejoinBlocked(until.toUtc());
    default:
      return null;
  }
}

abstract interface class PhoneIdentityRepository {
  /// 시작 — 보낼 문자 본문과 대표번호. 거절은 [PhoneIdentityStartRejected], 그 밖 실패는 [PmartFailure].
  Future<PhoneIdentityStart> start(String phone, IdempotencyKey key);

  /// 라이더가 "보냈어요"를 눌렀을 때만 부른다(자동으로 되풀이하지 않는다 — 조회마다 OCTOMO 한도가 준다).
  /// 503 은 [PhoneIdentityBusy], 그 밖의 실패는 [PmartFailure].
  /// 본문에 같은 번호([phone])를 다시 보낸다.
  Future<PhoneIdentityOutcome> confirm(
    String verificationId,
    String phone,
    IdempotencyKey key,
  );
}

/// 목 시나리오 — 시험·목 앱에서 실패를 흉내 낸다.
enum MockConfirmStep { verified, notYet, busy, expired, failed }

/// 목 본인 확인. "보냈어요"를 누르면 잠깐 뒤 확인된다.
///
/// 목 번호(수동 확인용 — 앞 셋은 서버처럼 **시작 때** 409 로 끝난다):
/// - 010-9999-0000 → 카카오로 가입한 계정이 있음(가입일 2026-03-02, ri***@kakao.com)
/// - 010-9999-0001 → 네이버로 가입한 계정이 있음
/// - 010-7777-0000 → 탈퇴한 번호(2026-12-19부터 다시 가입)
/// - 010-5555-0000 → 첫 "보냈어요"는 아직 안 옴, 둘째에 확인
/// - 010-4444-0000 → 확인 서버 혼잡(첫 번째만 503)
/// - 010-3333-0000 → 확인 시간이 지남
/// - 010-2222-0000 → 오늘 시작 횟수 초과(429), 010 이 아닌 번호 → PHONE_NOT_SUPPORTED
/// 시험은 [script] 에 단계를 넣어 순서대로 쓴다(비면 번호 규칙 → 확인됨).
final class MockPhoneIdentityRepository implements PhoneIdentityRepository {
  MockPhoneIdentityRepository({
    this.delay = const Duration(milliseconds: 400),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration delay;
  final DateTime Function() _now;
  final script = <MockConfirmStep>[];

  /// 확인 호출 횟수(503 이 시도를 줄이지 않는지 시험에서 본다).
  int confirmCalls = 0;

  /// 확인 호출에 쓴 멱등키(503 뒤 다시 누르면 같은 키인지 시험에서 본다).
  final confirmKeys = <String>[];

  static const maxAttempts = 5;
  static const sendTo = '1666-3538';

  final _phones = <String, String>{};
  final _remaining = <String, int>{};
  final _confirmsByPhone = <String, int>{};
  var _seq = 0;

  @override
  Future<PhoneIdentityStart> start(String phone, IdempotencyKey key) async {
    await Future<void>.delayed(delay);
    if (!phone.startsWith('010') || phone.length != 11) {
      throw const PhoneIdentityStartRejected(
        PhoneIdentityStartRejection.notSupported,
      );
    }
    if (phone == '01022220000') {
      throw const PhoneIdentityStartRejected(
        PhoneIdentityStartRejection.tooMany,
      );
    }
    if (_conflict(phone) case final ended?) {
      throw PhoneIdentityStartEnded(ended);
    }
    final id = 'mock-pv-${++_seq}';
    _phones[id] = phone;
    _remaining[id] = maxAttempts;
    return PhoneIdentityStart(
      verificationId: id,
      sendTo: sendTo,
      text: (100000 + (phone.hashCode.abs() + _seq) % 900000).toString(),
      expiresAt: _now().toUtc().add(const Duration(minutes: 5)),
      phoneMasked: _mask(phone),
      maxAttempts: maxAttempts,
    );
  }

  @override
  Future<PhoneIdentityOutcome> confirm(
    String verificationId,
    String phone,
    IdempotencyKey key,
  ) async {
    confirmCalls++;
    confirmKeys.add(key.value);
    await Future<void>.delayed(delay);
    if (_phones[verificationId] == null) return const PhoneIdentityExpired();
    // 시작 때와 다른 번호면 확인되지 않는다.
    if (_phones[verificationId] != phone) return const PhoneIdentityFailed();
    final n = (_confirmsByPhone[phone] ?? 0) + 1;
    _confirmsByPhone[phone] = n;
    final step = script.isNotEmpty ? script.removeAt(0) : _byPhone(phone, n);
    switch (step) {
      case MockConfirmStep.busy:
        // 시도 횟수를 줄이지 않는다.
        throw const PhoneIdentityBusy();
      case MockConfirmStep.expired:
        return const PhoneIdentityExpired();
      case MockConfirmStep.failed:
        return const PhoneIdentityFailed();
      case MockConfirmStep.notYet:
        final left = (_remaining[verificationId] ?? 1) - 1;
        _remaining[verificationId] = left;
        return left <= 0
            ? const PhoneIdentityFailed()
            : PhoneIdentityPending(left);
      case MockConfirmStep.verified:
        return const PhoneIdentityVerified();
    }
  }

  /// 서버처럼 시작 때 409 로 끝나는 번호(다른 계정·탈퇴한 번호).
  static PhoneIdentityOutcome? _conflict(String phone) => switch (phone) {
    '01099990000' => PhoneIdentityAlreadyRegistered(
      ExistingRiderAccount(
        provider: RiderSocialProvider.kakao,
        joinedAt: DateTime.utc(2026, 3, 1, 15),
        emailMasked: 'ri***@kakao.com',
      ),
    ),
    '01099990001' => PhoneIdentityAlreadyRegistered(
      ExistingRiderAccount(
        provider: RiderSocialProvider.naver,
        joinedAt: DateTime.utc(2026, 7, 10, 3),
        emailMasked: 'pm***@naver.com',
      ),
    ),
    '01077770000' => PhoneIdentityRejoinBlocked(
      DateTime.utc(2026, 12, 18, 15), // 서울 2026-12-19 00:00
    ),
    _ => null,
  };

  static MockConfirmStep _byPhone(String phone, int n) => switch (phone) {
    '01055550000' when n == 1 => MockConfirmStep.notYet,
    '01044440000' when n == 1 => MockConfirmStep.busy,
    '01033330000' => MockConfirmStep.expired,
    _ => MockConfirmStep.verified,
  };

  static String _mask(String phone) => phone.length == 11
      ? '${phone.substring(0, 3)}-****-${phone.substring(7)}'
      : '***';
}

/// 실서버 본인 확인(rider-service 0.17.0 phone-verifications). 라이더 토큰(로그인 뒤)이 있어야 부를 수 있다.
///
/// 키: 시작은 화면이 준 키("다시 시도" = 같은 키, "다시 시작" = 새 키), 확인은 한 번 누름 단위(503 뒤 다시 = 같은 키).
/// 번호는 로그에 남기지 않는다(본문은 공통 로깅이 가린다).
final class ApiPhoneIdentityRepository implements PhoneIdentityRepository {
  ApiPhoneIdentityRepository(Dio dio)
    : _api = rd.PmartApiRider(dio: dio).getPhoneVerificationsApi();

  final rd.PhoneVerificationsApi _api;

  @override
  Future<PhoneIdentityStart> start(String phone, IdempotencyKey key) async {
    final rd.StartRiderPhoneVerification200Response body;
    try {
      final res = await pmartGuard(
        () => _api.startRiderPhoneVerification(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          startRiderPhoneVerificationRequest:
              rd.StartRiderPhoneVerificationRequest(phone: phone),
          extra: commandOptions(key).extra,
        ),
      );
      body =
          res.data ??
          (throw const ContractViolationFailure('phone-verifications 본문 없음'));
    } on ProblemFailure catch (f) {
      final p = f.problem;
      if (identityConflictOf(p) case final ended?) {
        throw PhoneIdentityStartEnded(ended);
      }
      throw switch (p.code) {
        'PHONE_NOT_SUPPORTED' ||
        ProblemCode.validationFailed => const PhoneIdentityStartRejected(
          PhoneIdentityStartRejection.notSupported,
        ),
        'TOO_MANY_VERIFICATIONS' => const PhoneIdentityStartRejected(
          PhoneIdentityStartRejection.tooMany,
        ),
        ProblemCode.configRequired => const PhoneIdentityStartRejected(
          PhoneIdentityStartRejection.notReady,
        ),
        _ => f,
      };
    }
    return PhoneIdentityStart(
      verificationId: body.verificationId,
      sendTo: body.sendTo,
      text: body.text,
      expiresAt: body.expiresAt.toUtc(),
      phoneMasked: body.phoneMasked,
      maxAttempts: body.maxAttempts,
    );
  }

  @override
  Future<PhoneIdentityOutcome> confirm(
    String verificationId,
    String phone,
    IdempotencyKey key,
  ) async {
    try {
      final res = await pmartGuard(
        () => _api.confirmRiderPhoneVerification(
          verificationId: verificationId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          startRiderPhoneVerificationRequest:
              rd.StartRiderPhoneVerificationRequest(phone: phone),
          extra: commandOptions(key).extra,
        ),
      );
      return _outcome(
        res.data ??
            (throw const ContractViolationFailure('confirmations 본문 없음')),
      );
    } on ProblemFailure catch (f) {
      // 확인이 없다(다른 주체·지워짐) — 처음부터 다시.
      if (f.problem.status == 404) return const PhoneIdentityExpired();
      rethrow;
    } on UnknownResultFailure catch (f) {
      // OCTOMO 장애(503 DEPENDENCY_UNAVAILABLE) — 시도로 세지 않았다. 같은 키로 다시 누르게 둔다.
      if (f.problem?.code == ProblemCode.dependencyUnavailable) {
        throw const PhoneIdentityBusy();
      }
      // 응답을 받지 못했다 — 짝 조회로 끝났는지 본다. 끝난 결과만 확정하고, 아직이면 같은 키로 다시 누르게 둔다.
      final settled = await _lookup(verificationId);
      if (settled != null) return settled;
      throw const PhoneIdentityBusy();
    }
  }

  /// `GET …/{id}` — 끝난 결과(VERIFIED·FAILED·EXPIRED)면 그 결과, 아직 PENDING 이거나 못 읽으면 null.
  Future<PhoneIdentityOutcome?> _lookup(String verificationId) async {
    try {
      final res = await pmartGuard(
        () => _api.getRiderPhoneVerification(verificationId: verificationId),
      );
      final v = res.data;
      if (v == null || v.state == rd.RiderPhoneVerificationStateEnum.PENDING) {
        return null;
      }
      return _outcome(v);
    } on PmartFailure {
      return null;
    }
  }

  static PhoneIdentityOutcome _outcome(
    rd.RiderPhoneVerification v,
  ) => switch (v.state) {
    rd.RiderPhoneVerificationStateEnum.VERIFIED =>
      const PhoneIdentityVerified(),
    rd.RiderPhoneVerificationStateEnum.PENDING => PhoneIdentityPending(
      v.remainingAttempts,
    ),
    rd.RiderPhoneVerificationStateEnum.FAILED => const PhoneIdentityFailed(),
    rd.RiderPhoneVerificationStateEnum.EXPIRED => const PhoneIdentityExpired(),
  };
}

/// 본인 확인 저장소. 목은 [MockPhoneIdentityRepository], 실서버는 [ApiPhoneIdentityRepository].
final phoneIdentityRepositoryProvider = Provider<PhoneIdentityRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockPhoneIdentityRepository(),
    PmartEnv.local => ApiPhoneIdentityRepository(ref.watch(dioProvider)),
  },
);
