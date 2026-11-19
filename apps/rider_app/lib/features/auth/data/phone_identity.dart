import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import 'rider_auth.dart' show RiderSocialProvider;

/// 휴대폰 본인 확인(OCTOMO — 라이더가 대표번호로 문자를 보내는 방식).
///
/// 모양은 백엔드 회신(PR #250, **병합 전** — 우리 생성 코드에는 아직 없다)의 rider 0.17.0 을 따른다:
/// - `POST /riders/me/phone-verifications {phone}` → `{verificationId, sendTo, text, expiresAt, phoneMasked, maxAttempts}`
///   (400 PHONE_NOT_SUPPORTED — 010 아님, 429 — 하루 횟수 초과)
/// - "보냈어요" 때만 `POST …/{id}/confirmations {phone}`(같은 번호 다시) → state VERIFIED·PENDING(remainingAttempts)·FAILED·EXPIRED,
///   503 = OCTOMO 장애(시도 횟수 줄지 않음). `GET …/{id}` 재조회.
/// - 409 IDENTITY_ALREADY_REGISTERED(details: provider·emailMasked(없을 수 있음)·joinedAt), 409 RIDER_REJOIN_BLOCKED(details: until, 30일).
/// - 가입 `POST /riders/signups` 에 phoneVerificationId(확인 뒤 1시간 안).
/// 계약이 병합되기 전에는 **목 구현만** 있고, 실서버 빌드는 [phoneIdentityRepositoryProvider] 가 null 이라
/// 가입 화면이 예전 중복 확인(phone-checks)만 한다. 병합 뒤 생성 클라이언트로 Api 구현을 붙인다.
/// 요청 문서 `docs/handoff/rider-app/2026-11-19-backend-rider-social-login-identity.md`.
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

/// 이 번호로 이미 가입한 다른 라이더 계정(본인 확인을 통과한 사람에게만 서버가 준다 — 계정 ID·전체 번호는 없다).
@immutable
class ExistingRiderAccount {
  const ExistingRiderAccount({
    required this.provider,
    required this.joinedAt,
    required this.emailMasked,
  });

  final RiderSocialProvider provider;
  final DateTime joinedAt;
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

/// 시작을 서버가 거절했다 — 400 PHONE_NOT_SUPPORTED(010 휴대폰 아님)·429(하루 시작 횟수 초과).
enum PhoneIdentityStartRejection { notSupported, tooMany }

final class PhoneIdentityStartRejected implements Exception {
  const PhoneIdentityStartRejected(this.reason);
  final PhoneIdentityStartRejection reason;
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
/// 목 번호(수동 확인용):
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
        return switch (phone) {
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
          _ => const PhoneIdentityVerified(),
        };
    }
  }

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

/// 본인 확인 저장소. 실서버는 계약이 없어 null — 가입 화면이 phone-checks(중복 확인)만 한다.
final phoneIdentityRepositoryProvider = Provider<PhoneIdentityRepository?>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockPhoneIdentityRepository(),
    // 라이더 본인 확인 계약이 생기면 Api 구현으로 바꾼다(R2).
    PmartEnv.local => null,
  },
);
