import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../../shared/mfc_directory.dart' show mfcBranches;
import '../../auth/data/signup.dart' show Vehicle;

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
    this.phoneMasked,
    this.vehicle,
    this.licenseNumberMasked,
    this.restriction = Restriction.normal,
    this.restrictedUntil,
    this.deliveryAreaMfcId,
    this.version,
  });

  final String riderId;
  final String? name;

  /// 가린 전화번호(예 010****5678) — 서버가 가려서 준다.
  final String? phoneMasked;

  /// 운행수단. 서버가 모르는 값이면 null.
  final Vehicle? vehicle;

  /// 등록된 운전면허(가린 값). 없으면 null — 오토바이·자동차·킥보드로 바꿀 때 번호가 필요하다.
  final String? licenseNumberMasked;
  final Restriction restriction;

  /// 제한 기한. null 이면 무기한.
  final DateTime? restrictedUntil;

  /// 배달 지역(가입 때 고른 MFC 지점 — 한 곳, 사용자 2026-11-23). 서버가 여러 곳을 주면 첫 곳.
  final String? deliveryAreaMfcId;

  /// 라이더 행 버전(`PATCH /riders/me` 의 X-Expected-Version).
  final int? version;
}

/// 지금 위치 상태(rider 0.27.0 `GET /riders/me/location-area`). FRESH 가 아니면 바꿀 수 있는 지점을 모른다.
enum LocationState { fresh, stale, unknown }

/// 지금 위치가 들어가는 배달 권역(rider 0.27.0, 2026-11-25 사용자 "배달 가능 지역 내부에 있을 때만 해당 지역으로 권역 변경").
/// [mfcIds] = 이 지점들로만 바꿀 수 있다(FRESH 가 아니면 빈 목록). 좌표는 오지 않는다.
@immutable
class LocationArea {
  const LocationArea({required this.state, required this.mfcIds, this.mfcId});

  final LocationState state;
  final Set<String> mfcIds;

  /// 지금 위치의 담당 지점(겹치면 판정 규칙대로 하나, 모르면 null).
  final String? mfcId;
}

/// 지금 위치를 모름(위치 없음·서버 수신 5분 넘음) — rider 0.27.0 `PATCH /riders/me` 409.
const locationUnknownCode = 'LOCATION_UNKNOWN';

/// 지금 위치가 바꿀 지점의 배달 지역 밖 — rider 0.27.0 `PATCH /riders/me` 422.
const outsideDeliveryAreaCode = 'OUTSIDE_DELIVERY_AREA';

abstract interface class ProfileRepository {
  /// 지금 위치가 들어가는 배달 권역. 실패는 [PmartFailure](권역 밖으로 보이지 않는다).
  Future<LocationArea> locationArea();

  /// 미가입이면 404 [ProblemFailure].
  Future<RiderProfileView> me();

  /// 운행수단을 바꾼다(`PATCH /riders/me` vehicleType — 사용자 2026-11-25). 등록된 면허가 없는데 오토바이·자동차·킥보드면
  /// [licenseNumber] 가 필요하다(422 LICENSE_REQUIRED). 진행 중 배송이 있으면 409 INVALID_STATE. 실패는 [PmartFailure].
  Future<RiderProfileView> changeVehicle({
    required Vehicle vehicle,
    String? licenseNumber,
    required int? expectedVersion,
    required IdempotencyKey key,
  });

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
  phoneMasked: p.phoneMasked,
  vehicle: switch (p.vehicleType) {
    rd.VehicleType.MOTORCYCLE => Vehicle.motorcycle,
    rd.VehicleType.BICYCLE => Vehicle.bicycle,
    rd.VehicleType.E_BIKE => Vehicle.eBike,
    rd.VehicleType.KICKBOARD => Vehicle.kickboard,
    rd.VehicleType.CAR => Vehicle.car,
    rd.VehicleType.WALK => Vehicle.walk,
    _ => null,
  },
  licenseNumberMasked: switch (p.licenseNumberMasked?.trim()) {
    final l? when l.isNotEmpty => l,
    _ => null,
  },
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
  Future<LocationArea> locationArea() async {
    final res = await pmartGuard(() => _me.getMyLocationArea());
    final a =
        res.data ??
        (throw const ContractViolationFailure('RiderLocationArea 본문 없음'));
    return LocationArea(
      state: switch (a.locationState) {
        rd.RiderLocationAreaLocationStateEnum.FRESH => LocationState.fresh,
        rd.RiderLocationAreaLocationStateEnum.STALE => LocationState.stale,
        _ => LocationState.unknown,
      },
      mfcIds: a.mfcIds.toSet(),
      mfcId: a.mfcId,
    );
  }

  @override
  Future<RiderProfileView> changeVehicle({
    required Vehicle vehicle,
    String? licenseNumber,
    required int? expectedVersion,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _me.updateMyRider(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        riderProfileUpdate: rd.RiderProfileUpdate(
          vehicleType: vehicleWire(vehicle),
          licenseNumber: licenseNumber,
        ),
        extra: commandOptions(key).extra,
      ),
    );
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
  Vehicle vehicle = Vehicle.bicycle;
  String? license;
  int version = 1;

  /// 시험용: 다음 운행수단 변경을 이 실패로 끝낸다(반영하지 않음).
  PmartFailure? failNextVehicle;

  /// 목 지금 위치 권역. null = 모든 지점 안(목 기본 — 어느 지점으로든 바꿀 수 있다).
  LocationArea? here;

  @override
  Future<LocationArea> locationArea() async {
    await Future<void>.delayed(latency);
    return here ??
        LocationArea(
          state: LocationState.fresh,
          mfcIds: {for (final m in mfcBranches) m.id},
        );
  }

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
      phoneMasked: '010****5678',
      vehicle: vehicle,
      licenseNumberMasked: license,
      restriction: restriction,
      restrictedUntil: until,
      deliveryAreaMfcId: areaMfcId,
      version: version,
    );
  }

  @override
  Future<RiderProfileView> changeVehicle({
    required Vehicle vehicle,
    String? licenseNumber,
    required int? expectedVersion,
    required IdempotencyKey key,
  }) async {
    await Future<void>.delayed(latency);
    if (failNextVehicle case final f?) {
      failNextVehicle = null;
      throw f;
    }
    if (expectedVersion != null && expectedVersion != version) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.versionConflict),
      );
    }
    final needs =
        vehicle == Vehicle.motorcycle ||
        vehicle == Vehicle.car ||
        vehicle == Vehicle.kickboard;
    if (needs && license == null && (licenseNumber ?? '').isEmpty) {
      throw const ProblemFailure(
        Problem(status: 422, code: licenseRequiredCode),
      );
    }
    if (licenseNumber != null && licenseNumber.isNotEmpty) {
      final d = licenseNumber.replaceAll(RegExp(r'[^0-9]'), '');
      if (d == '112233333344') {
        throw const ProblemFailure(
          Problem(status: 409, code: duplicateLicenseCode),
        );
      }
      license = '${d.substring(0, 2)}-**-******-${d.substring(10)}';
    }
    this.vehicle = vehicle;
    version += 1;
    return me();
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
    // 지금 위치 검사(rider 0.27.0) — 새로 넣는 지점만, 운행 상태 검사는 화면이 먼저 한다.
    if (here case final h? when mfcId != areaMfcId) {
      if (h.state != LocationState.fresh) {
        throw const ProblemFailure(
          Problem(status: 409, code: locationUnknownCode),
        );
      }
      if (!h.mfcIds.contains(mfcId)) {
        throw const ProblemFailure(
          Problem(status: 422, code: outsideDeliveryAreaCode),
        );
      }
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

/// 오토바이·자동차·킥보드로 바꾸는데 등록된 면허가 없음(rider `PATCH /riders/me` 422).
const licenseRequiredCode = 'LICENSE_REQUIRED';

/// 다른 라이더가 등록한 면허(409).
const duplicateLicenseCode = 'DUPLICATE_LICENSE';

/// 계약 값(`VehicleType`).
rd.VehicleType vehicleWire(Vehicle v) => switch (v) {
  Vehicle.motorcycle => rd.VehicleType.MOTORCYCLE,
  Vehicle.bicycle => rd.VehicleType.BICYCLE,
  Vehicle.eBike => rd.VehicleType.E_BIKE,
  Vehicle.kickboard => rd.VehicleType.KICKBOARD,
  Vehicle.car => rd.VehicleType.CAR,
  Vehicle.walk => rd.VehicleType.WALK,
};

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
