import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/mfc_directory.dart';

/// 배달 수단. motorcycle·bicycle·car·walk 는 rider-service `VehicleType`,
/// eBike(전기자전거)·kickboard(킥보드)는 계약에 아직 없다 — 목에서만 쓴다
/// (백엔드 요청: 계약 추가 + 수행료는 자전거와 같게, 사용자 요청 2026-11-16).
enum Vehicle { motorcycle, bicycle, eBike, kickboard, car, walk }

/// 약관 한 줄. 본문은 약관 확정 뒤 서버·문서에서 받는다(지금은 제목만).
@immutable
class ConsentItem {
  const ConsentItem({required this.type, required this.required});

  final String type;
  final bool required;
}

/// 배달 지역 = MFC 지점(계약 `RiderSignupRequest.deliveryAreas[].mfcId`).
/// 지점 목록을 주는 경로가 계약에 없어 사용자가 준 26개 지점(목 코드)을 쓴다.
@immutable
class AreaOption {
  const AreaOption({
    required this.region,
    required this.mfcId,
    required this.name,
  });

  final MfcRegion region;
  final String mfcId;
  final String name;
}

/// 가입 입력(`POST /riders/signups` 본문 + 면허).
@immutable
class SignupDraft {
  const SignupDraft({
    this.consents = const {},
    this.phone = '',
    this.name = '',
    this.bankName,
    this.holderName = '',
    this.accountNumber = '',
    this.roadAddress = '',
    this.addressLabel = '',
    this.addressDetail = '',
    this.area,
    this.vehicle,
    this.licenseNumber = '',
    this.licenseChecked = false,
  });

  final Set<String> consents;
  final String phone;
  final String name;
  final String? bankName;
  final String holderName;
  final String accountNumber;

  /// 주소 검색에서 고른 도로명주소(직접 친 글자는 받지 않는다).
  final String roadAddress;

  /// 라이더가 고른 표기(도로명 또는 지번).
  final String addressLabel;
  final String addressDetail;
  final AreaOption? area;
  final Vehicle? vehicle;

  /// 운전면허 번호. 오토바이·자동차·킥보드는 필수, 그 밖은 선택. 넣었으면 중복 확인을 통과해야 한다.
  final String licenseNumber;
  final bool licenseChecked;

  SignupDraft copyWith({
    Set<String>? consents,
    String? phone,
    String? name,
    String? bankName,
    String? holderName,
    String? accountNumber,
    String? roadAddress,
    String? addressLabel,
    String? addressDetail,
    AreaOption? area,
    Vehicle? vehicle,
    String? licenseNumber,
    bool? licenseChecked,
  }) => SignupDraft(
    consents: consents ?? this.consents,
    phone: phone ?? this.phone,
    name: name ?? this.name,
    bankName: bankName ?? this.bankName,
    holderName: holderName ?? this.holderName,
    accountNumber: accountNumber ?? this.accountNumber,
    roadAddress: roadAddress ?? this.roadAddress,
    addressLabel: addressLabel ?? this.addressLabel,
    addressDetail: addressDetail ?? this.addressDetail,
    area: area ?? this.area,
    vehicle: vehicle ?? this.vehicle,
    licenseNumber: licenseNumber ?? this.licenseNumber,
    licenseChecked: licenseChecked ?? this.licenseChecked,
  );
}

String _compact(String s) => s.replaceAll(RegExp(r'\s'), '');

/// 예금주가 가입자 이름과 같은지(공백 무시). 실제 계좌 실명 확인은 서버·외부 기관 몫이다.
bool holderMatchesName(String holder, String name) =>
    _compact(holder).isNotEmpty && _compact(holder) == _compact(name);

/// 운전면허가 필요한 수단(사용자 결정 2026-11-16: 오토바이·자동차·킥보드는 필수).
/// 자전거·전기자전거·도보는 선택 — 넣었으면 중복 확인까지 해야 한다.
bool licenseRequired(Vehicle? v) =>
    v == Vehicle.motorcycle || v == Vehicle.car || v == Vehicle.kickboard;

/// 운전면허 번호 형식(지역 2 · 연도 2 · 일련 6 · 검증 2 = 12자리, 하이픈 선택).
final licensePattern = RegExp(r'^\d{2}-?\d{2}-?\d{6}-?\d{2}$');

String normalizeLicense(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

/// 가입 화면에 쓰는 선택지(목).
abstract final class SignupOptions {
  static const consents = [
    ConsentItem(type: 'DELIVERY_AGENCY_CONTRACT', required: true),
    ConsentItem(type: 'PRIVACY_COLLECTION', required: true),
    ConsentItem(type: 'LOCATION_SERVICE', required: true),
    ConsentItem(type: 'PRIVACY_THIRD_PARTY', required: true),
    ConsentItem(type: 'MARKETING', required: false),
  ];

  static const banks = [
    '국민은행',
    '신한은행',
    '우리은행',
    '하나은행',
    '농협은행',
    '카카오뱅크',
    '토스뱅크',
  ];

  /// 권역별 지점(충청·강원 9 / 경상·전라 17).
  static Map<MfcRegion, List<AreaOption>> get areas => {
    for (final r in MfcRegion.values)
      r: [
        for (final b in mfcBranches.where((b) => b.region == r))
          AreaOption(region: r, mfcId: b.id, name: b.name),
      ],
  };
}

/// 가입(`POST /riders/signups`). 서버가 프로필을 돌려주면 바로 운행할 수 있다(즉시 승인).
abstract interface class SignupRepository {
  Future<void> submit(SignupDraft draft);

  /// 운전면허 중복 확인. true 면 쓸 수 있다(다른 라이더가 등록하지 않음).
  /// 계약에 없다(2026-11-13 면허 칸을 뺐음) — 백엔드 요청 중, 목에서만.
  Future<bool> isLicenseAvailable(String licenseNumber);
}

/// 목 구현. 실서버 연결(`POST /riders/signups`)은 라이더 로그인 연동과 함께 붙인다.
final class MockSignupRepository implements SignupRepository {
  MockSignupRepository({this.latency = const Duration(milliseconds: 400)});

  final Duration latency;
  SignupDraft? submitted;

  /// 이미 등록된 면허(시연용 가짜 번호).
  final registeredLicenses = <String>{'112233333344'};

  @override
  Future<void> submit(SignupDraft draft) async {
    await Future<void>.delayed(latency);
    submitted = draft;
    if (draft.licenseNumber.isNotEmpty) {
      registeredLicenses.add(normalizeLicense(draft.licenseNumber));
    }
  }

  @override
  Future<bool> isLicenseAvailable(String licenseNumber) async {
    await Future<void>.delayed(latency);
    return !registeredLicenses.contains(normalizeLicense(licenseNumber));
  }
}

final signupRepositoryProvider = Provider<SignupRepository>(
  (_) => MockSignupRepository(),
);
