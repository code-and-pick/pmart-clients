import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/session.dart';
import '../data/signup.dart';
import 'postcode_screen.dart';

String consentTitle(AppLocalizations l10n, ConsentItem c) {
  final title = switch (c.type) {
    'DELIVERY_AGENCY_CONTRACT' => l10n.consentContract,
    'PRIVACY_COLLECTION' => l10n.consentPrivacy,
    'LOCATION_SERVICE' => l10n.consentLocation,
    'PRIVACY_THIRD_PARTY' => l10n.consentThirdParty,
    _ => l10n.consentMarketing,
  };
  return c.required ? l10n.consentRequired(title) : l10n.consentOptional(title);
}

String vehicleText(AppLocalizations l10n, Vehicle v) => switch (v) {
  Vehicle.motorcycle => l10n.vehicleMotorcycle,
  Vehicle.bicycle => l10n.vehicleBicycle,
  Vehicle.eBike => l10n.vehicleEBike,
  Vehicle.kickboard => l10n.vehicleKickboard,
  Vehicle.car => l10n.vehicleCar,
  Vehicle.walk => l10n.vehicleWalk,
};

const _headline = TextStyle(fontSize: 26, height: 1.45, color: RiderColors.ink);
const _label = TextStyle(fontSize: 15, color: RiderColors.ink);

/// 가입 안내(레퍼런스 "누구나 할 수 있는" 화면). 캐릭터 그림 대신 이동 수단 아이콘을 쓴다.
class SignupIntroScreen extends ConsumerWidget {
  const SignupIntroScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  icon: const Icon(Icons.close, size: 28),
                  onPressed: () => context.pop(),
                ),
              ),
              const SizedBox(height: 28),
              Text(l10n.signupIntroTitle, style: _headline),
              const SizedBox(height: 36),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(24, 28, 16, 28),
                decoration: BoxDecoration(
                  color: RiderColors.field,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.signupIntroBody,
                        style: const TextStyle(
                          fontSize: 16,
                          height: 1.5,
                          color: RiderColors.ink,
                        ),
                      ),
                    ),
                    const Column(
                      children: [
                        Icon(
                          Icons.two_wheeler,
                          color: RiderColors.primary,
                          size: 40,
                        ),
                        SizedBox(height: 10),
                        Icon(
                          Icons.pedal_bike,
                          color: RiderColors.primary,
                          size: 36,
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    const Column(
                      children: [
                        Icon(
                          Icons.directions_car_outlined,
                          color: RiderColors.primary,
                          size: 40,
                        ),
                        SizedBox(height: 10),
                        Icon(
                          Icons.directions_walk,
                          color: RiderColors.primary,
                          size: 36,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              RiderButton(
                key: const ValueKey('signup-start'),
                label: l10n.signupStart,
                // 가입은 로그인한 계정으로 한다 — Google 로그인 뒤 미가입이면 가입 화면으로 넘어간다.
                onPressed: () async {
                  final result = await ref
                      .read(sessionProvider.notifier)
                      .loginWithGoogle(newAccount: true);
                  if (result == LoginResult.notConnected && context.mounted) {
                    showRiderToast(context, l10n.loginNotConnected);
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 가입 4단계: ① 약관 ② 휴대폰 번호·이름 ③ 정산 계좌 ④ 배달 정보.
///
/// 계약(`RiderSignupRequest`)에 본인인증·아이디/비밀번호·면허가 없어서 레퍼런스의 그 화면들은 두지 않는다.
class SignupFlowScreen extends ConsumerStatefulWidget {
  const SignupFlowScreen({super.key});

  @override
  ConsumerState<SignupFlowScreen> createState() => _SignupFlowScreenState();
}

class _SignupFlowScreenState extends ConsumerState<SignupFlowScreen> {
  int _step = 1;
  SignupDraft _draft = const SignupDraft();
  bool _busy = false;

  final _phone = TextEditingController();
  final _name = TextEditingController();
  final _holder = TextEditingController();
  final _account = TextEditingController();
  final _detail = TextEditingController();
  final _license = TextEditingController();

  /// 면허 중복 확인 결과. null 이면 아직 확인 안 함.
  bool? _licenseAvailable;
  bool _checkingLicense = false;

  @override
  void dispose() {
    for (final c in [_phone, _name, _holder, _account, _detail, _license]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _bankStarted =>
      _draft.bankName != null ||
      _draft.holderName.isNotEmpty ||
      _draft.accountNumber.isNotEmpty;

  bool get _holderMismatch =>
      _draft.holderName.trim().isNotEmpty &&
      !holderMatchesName(_draft.holderName, _draft.name);

  /// 면허: 오토바이·자동차·킥보드는 필수. 넣었으면(필수든 선택이든) 형식 + 중복확인 통과.
  bool get _licenseOk {
    final number = _draft.licenseNumber.trim();
    if (number.isEmpty) return !licenseRequired(_draft.vehicle);
    return licensePattern.hasMatch(number) && _draft.licenseChecked;
  }

  Future<void> _checkLicense() async {
    final number = _draft.licenseNumber.trim();
    if (!licensePattern.hasMatch(number)) {
      showRiderToast(context, AppLocalizations.of(context).licenseFormat);
      return;
    }
    setState(() => _checkingLicense = true);
    final ok = await ref
        .read(signupRepositoryProvider)
        .isLicenseAvailable(number);
    if (!mounted) return;
    setState(() {
      _checkingLicense = false;
      _licenseAvailable = ok;
      _draft = _draft.copyWith(licenseChecked: ok);
    });
  }

  Future<void> _searchAddress() async {
    final picked = await ref.read(addressSearchProvider)(context);
    if (picked == null || !mounted) return;
    _set(
      _draft.copyWith(
        roadAddress: picked.roadAddress,
        addressLabel: picked.label,
      ),
    );
  }

  void _set(SignupDraft d) => setState(() => _draft = d);

  bool get _requiredConsents => SignupOptions.consents
      .where((c) => c.required)
      .every((c) => _draft.consents.contains(c.type));

  static final _phonePattern = RegExp(r'^01[0-9]{8,9}$');

  bool get _canNext => switch (_step) {
    1 => _requiredConsents,
    2 => _phonePattern.hasMatch(_draft.phone),
    // 계좌는 선택(가입 뒤 프로필에서도 넣는다). 넣기 시작했으면 세 칸을 다 채우고,
    // 예금주는 가입자 본인 이름과 같아야 한다.
    3 =>
      !_bankStarted ||
          (_draft.bankName != null &&
              _draft.accountNumber.isNotEmpty &&
              holderMatchesName(_draft.holderName, _draft.name)),
    // 거주지는 주소 검색으로 고른 실제 주소만. 면허는 넣었으면 중복 확인까지.
    _ =>
      _draft.roadAddress.isNotEmpty &&
          _draft.area != null &&
          _draft.vehicle != null &&
          _licenseOk,
  };

  Future<void> _next() async {
    final l10n = AppLocalizations.of(context);
    if (_step == 3 && _draft.bankName != null) {
      showRiderToast(context, l10n.bankSaved);
    }
    if (_step < 4) {
      setState(() => _step += 1);
      return;
    }
    setState(() => _busy = true);
    await ref.read(signupRepositoryProvider).submit(_draft);
    if (!mounted) return;
    // 가입하면 바로 운행할 수 있다(심사 없음). 완료 화면에서 "시작하기"를 누르면 홈으로 간다.
    context.go('/signup/done');
  }

  void _back() {
    if (_step == 1) {
      // 가입을 그만두면 로그인 화면으로 돌아간다(로그아웃).
      ref.read(sessionProvider.notifier).logout();
    } else {
      setState(() => _step -= 1);
    }
  }

  Future<void> _pickArea() async {
    final picked = await showModalBottomSheet<AreaOption>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _AreaSheet(initial: _draft.area),
    );
    if (picked != null) _set(_draft.copyWith(area: picked));
  }

  Future<void> _pickVehicle() async {
    final l10n = AppLocalizations.of(context);
    final picked = await showModalBottomSheet<Vehicle>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            for (final v in Vehicle.values) ...[
              ListTile(
                key: ValueKey('vehicle-${v.name}'),
                title: Text(
                  vehicleText(l10n, v),
                  style: const TextStyle(fontSize: 16),
                ),
                trailing: _draft.vehicle == v
                    ? const Icon(Icons.check, color: RiderColors.primary)
                    : null,
                onTap: () => Navigator.of(context).pop(v),
              ),
              const Divider(indent: 16, endIndent: 16),
            ],
          ],
        ),
      ),
    );
    if (picked != null) _set(_draft.copyWith(vehicle: picked));
  }

  Future<void> _pickBank() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final b in SignupOptions.banks)
              ListTile(
                key: ValueKey('bank-$b'),
                title: Text(b),
                onTap: () => Navigator.of(context).pop(b),
              ),
          ],
        ),
      ),
    );
    if (picked != null) _set(_draft.copyWith(bankName: picked));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PopScope(
      canPop: _step == 1,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
                child: Row(
                  children: [
                    StepDots(current: _step),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close, size: 28),
                      onPressed: () =>
                          ref.read(sessionProvider.notifier).logout(),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                  children: switch (_step) {
                    1 => _terms(l10n),
                    2 => _phoneStep(l10n),
                    3 => _bankStep(l10n),
                    _ => _deliveryStep(l10n),
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: RiderButton(
                  key: const ValueKey('signup-next'),
                  label: switch (_step) {
                    1 => l10n.signupAgree,
                    4 => l10n.signupFinish,
                    _ => l10n.signupNext,
                  },
                  onPressed: (_canNext && !_busy) ? _next : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _terms(AppLocalizations l10n) => [
    const SizedBox(height: 32),
    const Divider(),
    for (final c in SignupOptions.consents)
      InkWell(
        key: ValueKey('consent-${c.type}'),
        onTap: () {
          final next = {..._draft.consents};
          next.contains(c.type) ? next.remove(c.type) : next.add(c.type);
          _set(_draft.copyWith(consents: next));
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Row(
            children: [
              _Check(checked: _draft.consents.contains(c.type)),
              const SizedBox(width: 12),
              Expanded(child: Text(consentTitle(l10n, c), style: _label)),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.chevron_right, color: RiderColors.hint),
                onPressed: () => context.push('/signup/terms/${c.type}'),
              ),
            ],
          ),
        ),
      ),
  ];

  List<Widget> _phoneStep(AppLocalizations l10n) => [
    Text(l10n.signupPhoneTitle, style: _headline),
    const SizedBox(height: 28),
    Text(
      l10n.signupPhoneGuide,
      style: const TextStyle(fontSize: 15, height: 1.5, color: RiderColors.sub),
    ),
    const SizedBox(height: 24),
    Text(l10n.fieldPhone, style: _label),
    const SizedBox(height: 8),
    TextField(
      key: const ValueKey('signup-phone'),
      controller: _phone,
      keyboardType: TextInputType.phone,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(hintText: l10n.fieldPhoneHint),
      onChanged: (v) => _set(_draft.copyWith(phone: v)),
    ),
    const SizedBox(height: 20),
    Text(l10n.fieldName, style: _label),
    const SizedBox(height: 8),
    TextField(
      key: const ValueKey('signup-name'),
      controller: _name,
      decoration: InputDecoration(hintText: l10n.fieldNameHint),
      onChanged: (v) => _set(_draft.copyWith(name: v)),
    ),
    const SizedBox(height: 20),
    _InfoBox(title: l10n.signupNoticeTitle, body: l10n.signupNoticeBody),
  ];

  List<Widget> _bankStep(AppLocalizations l10n) => [
    Text(l10n.signupBankTitle, style: _headline),
    const SizedBox(height: 28),
    Text(l10n.fieldBank, style: _label),
    const SizedBox(height: 8),
    _SelectBox(
      key: const ValueKey('signup-bank'),
      text: _draft.bankName,
      hint: l10n.selectHint,
      onTap: _pickBank,
    ),
    const SizedBox(height: 20),
    Text(l10n.fieldHolder, style: _label),
    const SizedBox(height: 8),
    TextField(
      key: const ValueKey('signup-holder'),
      controller: _holder,
      decoration: InputDecoration(
        hintText: l10n.fieldHolderHint,
        errorText: _holderMismatch ? l10n.holderMismatch : null,
      ),
      onChanged: (v) => _set(_draft.copyWith(holderName: v)),
    ),
    const SizedBox(height: 20),
    Text(l10n.fieldAccount, style: _label),
    const SizedBox(height: 8),
    TextField(
      key: const ValueKey('signup-account'),
      controller: _account,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onChanged: (v) => _set(_draft.copyWith(accountNumber: v)),
    ),
    const SizedBox(height: 20),
    _InfoBox(title: l10n.bankNoticeTitle, body: l10n.bankNoticeBody),
  ];

  List<Widget> _deliveryStep(AppLocalizations l10n) => [
    Text(l10n.signupDeliveryTitle, style: _headline),
    const SizedBox(height: 28),
    Text(l10n.fieldResidence, style: _label),
    const SizedBox(height: 8),
    // 직접 입력하지 않는다 — 주소 검색에서 고른 실제 도로명·지번 주소만 받는다.
    _SelectBox(
      key: const ValueKey('signup-road'),
      text: _draft.addressLabel.isEmpty ? null : _draft.addressLabel,
      hint: l10n.fieldResidenceSearch,
      icon: Icons.search,
      onTap: _searchAddress,
    ),
    const SizedBox(height: 8),
    TextField(
      key: const ValueKey('signup-detail'),
      controller: _detail,
      decoration: InputDecoration(hintText: l10n.fieldResidenceDetailHint),
      onChanged: (v) => _set(_draft.copyWith(addressDetail: v)),
    ),
    const SizedBox(height: 24),
    Text(l10n.fieldArea, style: _label),
    const SizedBox(height: 8),
    _SelectBox(
      key: const ValueKey('signup-area'),
      text: switch (_draft.area) {
        final a? => '${regionText(l10n, a.region)} · ${a.name}',
        null => null,
      },
      hint: l10n.selectHint,
      onTap: _pickArea,
    ),
    const SizedBox(height: 8),
    Container(
      padding: const EdgeInsets.all(14),
      color: RiderColors.primaryMist,
      child: Text(
        l10n.areaNotice,
        style: const TextStyle(
          fontSize: 13,
          height: 1.5,
          color: RiderColors.sub,
        ),
      ),
    ),
    const SizedBox(height: 24),
    Text(l10n.fieldVehicle, style: _label),
    const SizedBox(height: 8),
    _SelectBox(
      key: const ValueKey('signup-vehicle'),
      text: switch (_draft.vehicle) {
        final v? => vehicleText(l10n, v),
        null => null,
      },
      hint: l10n.selectHint,
      onTap: _pickVehicle,
    ),
    const SizedBox(height: 24),
    Text(
      licenseRequired(_draft.vehicle)
          ? l10n.fieldLicenseRequired
          : l10n.fieldLicenseOptional,
      key: const ValueKey('license-label'),
      style: _label,
    ),
    const SizedBox(height: 8),
    Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextField(
            key: const ValueKey('signup-license'),
            controller: _license,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9-]')),
            ],
            decoration: InputDecoration(hintText: l10n.fieldLicenseHint),
            onChanged: (v) {
              // 번호가 바뀌면 중복 확인을 다시 받는다.
              _licenseAvailable = null;
              _set(_draft.copyWith(licenseNumber: v, licenseChecked: false));
            },
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            key: const ValueKey('license-check'),
            onPressed: _checkingLicense || _draft.licenseNumber.trim().isEmpty
                ? null
                : _checkLicense,
            child: Text(l10n.licenseCheck),
          ),
        ),
      ],
    ),
    if (_licenseAvailable case final ok?)
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(
          ok ? l10n.licenseAvailable : l10n.licenseDuplicate,
          key: const ValueKey('license-result'),
          style: TextStyle(
            fontSize: 13,
            color: ok ? RiderColors.primary : RiderColors.danger,
          ),
        ),
      )
    else
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(
          licenseRequired(_draft.vehicle)
              ? l10n.licenseRequiredNote
              : l10n.licenseOptional,
          style: const TextStyle(fontSize: 13, color: RiderColors.hint),
        ),
      ),
  ];
}

String regionText(AppLocalizations l10n, MfcRegion r) => switch (r) {
  MfcRegion.chungcheongGangwon => l10n.regionChungcheongGangwon,
  MfcRegion.gyeongsangJeolla => l10n.regionGyeongsangJeolla,
};

class _Check extends StatelessWidget {
  const _Check({required this.checked});

  final bool checked;

  @override
  Widget build(BuildContext context) => Container(
    width: 24,
    height: 24,
    decoration: BoxDecoration(
      color: checked ? RiderColors.primary : RiderColors.line,
      borderRadius: BorderRadius.circular(2),
    ),
    child: const Icon(Icons.check, size: 18, color: Colors.white),
  );
}

class _InfoBox extends StatelessWidget {
  const _InfoBox({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: RiderColors.field,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          body,
          style: const TextStyle(
            fontSize: 13,
            height: 1.5,
            color: RiderColors.sub,
          ),
        ),
      ],
    ),
  );
}

class _SelectBox extends StatelessWidget {
  const _SelectBox({
    super.key,
    required this.text,
    required this.hint,
    required this.onTap,
    this.icon = Icons.expand_more,
  });

  final String? text;
  final String hint;
  final VoidCallback onTap;
  final IconData icon;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        border: Border.all(color: RiderColors.line),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text ?? hint,
              style: TextStyle(
                fontSize: 15,
                color: text == null ? RiderColors.hint : RiderColors.ink,
              ),
            ),
          ),
          Icon(icon, color: RiderColors.sub),
        ],
      ),
    ),
  );
}

/// 배달 지역 고르기: 권역(충청·강원 / 경상·전라) → MFC 지점(레퍼런스의 두 단계 시트).
class _AreaSheet extends StatefulWidget {
  const _AreaSheet({this.initial});

  final AreaOption? initial;

  @override
  State<_AreaSheet> createState() => _AreaSheetState();
}

class _AreaSheetState extends State<_AreaSheet> {
  late MfcRegion? _region = widget.initial?.region;
  late AreaOption? _branch = widget.initial;
  bool _second = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final areas = SignupOptions.areas;
    final selected = _second ? _branch : _region;
    final crossAxisCount = _second ? 3 : 2;
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 18),
            child: Text(
              l10n.areaSheetTitle,
              style: const TextStyle(fontSize: 15),
            ),
          ),
          const Divider(),
          Flexible(
            child: GridView.count(
              padding: const EdgeInsets.all(12),
              crossAxisCount: crossAxisCount,
              shrinkWrap: true,
              mainAxisSpacing: 10,
              crossAxisSpacing: 8,
              childAspectRatio: _second ? 2.2 : 3.2,
              children: [
                if (_second)
                  for (final a in areas[_region]!)
                    PillOption(
                      key: ValueKey('area-${a.name}'),
                      label: a.name,
                      selected: a.mfcId == _branch?.mfcId,
                      onTap: () => setState(() => _branch = a),
                    )
                else
                  for (final r in MfcRegion.values)
                    PillOption(
                      key: ValueKey('area-${r.name}'),
                      label: regionText(l10n, r),
                      selected: r == _region,
                      onTap: () => setState(() {
                        if (_region != r) _branch = null;
                        _region = r;
                      }),
                    ),
              ],
            ),
          ),
          const Divider(),
          SizedBox(
            height: 56,
            child: Row(
              children: [
                if (_second) ...[
                  Expanded(
                    child: TextButton(
                      onPressed: () => setState(() => _second = false),
                      child: Text(
                        l10n.areaPrev,
                        style: const TextStyle(
                          fontSize: 16,
                          color: RiderColors.ink,
                        ),
                      ),
                    ),
                  ),
                  const VerticalDivider(width: 1),
                ],
                Expanded(
                  child: TextButton(
                    key: const ValueKey('area-confirm'),
                    onPressed: selected == null
                        ? null
                        : () {
                            if (!_second) {
                              setState(() => _second = true);
                            } else {
                              Navigator.of(context).pop(_branch);
                            }
                          },
                    child: Text(
                      _second ? l10n.areaDone : l10n.signupNext,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: selected == null
                            ? RiderColors.hint
                            : RiderColors.ink,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 약관 본문. 본문은 약관이 확정되면 넣는다(지금은 제목과 안내만).
class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key, required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final item = SignupOptions.consents.firstWhere(
      (c) => c.type == type,
      orElse: () => SignupOptions.consents.first,
    );
    return Scaffold(
      appBar: riderDarkBar(context, title: l10n.termsTitle),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  consentTitle(l10n, item),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  l10n.termsPending,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.6,
                    color: RiderColors.sub,
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: RiderButton(
                label: l10n.termsConfirm,
                onPressed: () => context.pop(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 가입 완료. 가입하면 바로 운행할 수 있다(백엔드 안내 2026-11-13: 즉시 운행 승인).
class SignupDoneScreen extends ConsumerWidget {
  const SignupDoneScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 76),
              Text(l10n.signupDoneTitle, style: _headline),
              const SizedBox(height: 24),
              Text(
                l10n.signupDoneBody,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.6,
                  color: RiderColors.sub,
                ),
              ),
              const Spacer(),
              const Center(
                child: CircleAvatar(
                  radius: 56,
                  backgroundColor: RiderColors.primarySoft,
                  child: Icon(
                    Icons.celebration_outlined,
                    size: 56,
                    color: RiderColors.primary,
                  ),
                ),
              ),
              const SizedBox(height: 40),
              RiderButton(
                key: const ValueKey('signup-finish'),
                label: l10n.signupToHome,
                // 가입됨으로 바뀌면 라우터가 홈으로 보낸다.
                onPressed: () =>
                    ref.read(sessionProvider.notifier).markRegistered(),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
