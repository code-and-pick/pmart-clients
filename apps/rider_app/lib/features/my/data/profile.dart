import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 계정 제한(rider-service `AccountRestriction`, RS-1).
enum Restriction {
  normal,

  /// 신규배차 제한 — 진행 중 배송은 끝까지.
  dispatchRestricted,

  /// 일시 중지 — 운행 시작 불가.
  suspended,

  /// 계약 종료.
  terminated;

  bool get restricted => this != normal;

  static Restriction fromWire(String? w) => switch (w) {
    'DISPATCH_RESTRICTED' => dispatchRestricted,
    'SUSPENDED' => suspended,
    'TERMINATED' => terminated,
    _ => normal,
  };
}

/// 내 정보(`GET /riders/me`). 제한 사유는 운영자 기록이라 앱에 보이지 않는다.
@immutable
class RiderProfileView {
  const RiderProfileView({
    required this.riderId,
    this.name,
    this.restriction = Restriction.normal,
    this.restrictedUntil,
    this.deliveryAreaMfcId,
    this.version,
  });

  final String riderId;
  final String? name;
  final Restriction restriction;

  /// 제한 기한. null 이면 무기한.
  final DateTime? restrictedUntil;

  /// 배달 지역(가입 때 고른 MFC 지점 — 한 곳, 사용자 2026-11-23). 서버가 여러 곳을 주면 첫 곳.
  final String? deliveryAreaMfcId;

  /// 라이더 행 버전(`PATCH /riders/me` 의 X-Expected-Version).
  final int? version;
}

abstract interface class ProfileRepository {
  /// 미가입이면 404 [ProblemFailure].
  Future<RiderProfileView> me();

  /// 배달 지역을 [mfcId] 한 곳으로 바꾼다(`PATCH /riders/me` deliveryAreas — 바로 반영, 사용자 2026-11-23).
  /// 서버가 돌려준 프로필을 돌려준다. 실패는 [PmartFailure].
  Future<RiderProfileView> changeDeliveryArea({
    required String mfcId,
    required int? expectedVersion,
    required IdempotencyKey key,
  });
}

RiderProfileView _view(rd.RiderProfile p) => RiderProfileView(
  riderId: p.riderId ?? (throw const ContractViolationFailure('riderId 없음')),
  name: p.name,
  restriction: Restriction.fromWire(p.restriction?.state?.value),
  restrictedUntil: p.restriction?.until,
  deliveryAreaMfcId: p.deliveryAreas
      ?.map((a) => a.mfcId)
      .whereType<String>()
      .firstOrNull,
  version: p.version,
);

final class ApiProfileRepository implements ProfileRepository {
  ApiProfileRepository(Dio dio) : _me = rd.PmartApiRider(dio: dio).getMeApi();

  final rd.MeApi _me;

  @override
  Future<RiderProfileView> me() async {
    final res = await pmartGuard(() => _me.getMyRider());
    return _view(
      res.data ?? (throw const ContractViolationFailure('RiderProfile 본문 없음')),
    );
  }

  @override
  Future<RiderProfileView> changeDeliveryArea({
    required String mfcId,
    required int? expectedVersion,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _me.updateMyRider(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        riderProfileUpdate: rd.RiderProfileUpdate(
          deliveryAreas: [
            rd.RiderProfileUpdateDeliveryAreasInner(mfcId: mfcId),
          ],
        ),
        extra: commandOptions(key).extra,
      ),
    );
    return _view(
      res.data ?? (throw const ContractViolationFailure('RiderProfile 본문 없음')),
    );
  }
}

/// 목. [restriction] 을 바꿔 제한·해제를 흉내 낸다.
final class MockProfileRepository implements ProfileRepository {
  MockProfileRepository({this.latency = Duration.zero});

  final Duration latency;
  Restriction restriction = Restriction.normal;
  DateTime? until;
  String areaMfcId = 'MFC-BSJ-01';
  int version = 1;

  /// 시험용: 다음 배달 지역 변경을 이 실패로 끝낸다(반영하지 않음).
  PmartFailure? failNextChange;

  /// 시험용: 다음 배달 지역 변경은 반영하되 응답을 잃는다(결과 불명).
  bool loseNextReply = false;

  @override
  Future<RiderProfileView> me() async {
    await Future<void>.delayed(latency);
    return RiderProfileView(
      riderId: 'rider-mock-1',
      name: '홍길동',
      restriction: restriction,
      restrictedUntil: until,
      deliveryAreaMfcId: areaMfcId,
      version: version,
    );
  }

  @override
  Future<RiderProfileView> changeDeliveryArea({
    required String mfcId,
    required int? expectedVersion,
    required IdempotencyKey key,
  }) async {
    await Future<void>.delayed(latency);
    if (failNextChange case final f?) {
      failNextChange = null;
      throw f;
    }
    if (expectedVersion != null && expectedVersion != version) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.versionConflict),
      );
    }
    areaMfcId = mfcId;
    version += 1;
    if (loseNextReply) {
      loseNextReply = false;
      throw const UnknownResultFailure();
    }
    return me();
  }
}

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockProfileRepository(),
    PmartEnv.local => ApiProfileRepository(ref.watch(dioProvider)),
  },
);

/// 내 정보. 앱 실행·포그라운드 복귀·운행 상태 변경 실패 때 다시 읽는다.
final profileProvider = FutureProvider<RiderProfileView>(
  (ref) => ref.watch(profileRepositoryProvider).me(),
);

/// 인사말: 가입 때 쓴 이름이 있으면 "홍길동 라이더님", 없으면(조회 전·실패) "라이더님".
String riderGreetingText(
  String? name,
  String Function(String) named,
  String plain,
) {
  final n = name?.trim() ?? '';
  return n.isEmpty ? plain : named(n);
}
