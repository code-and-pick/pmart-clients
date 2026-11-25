import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/phone_format.dart' show LicenseNumberFormatter;
import '../../../shared/rider_widgets.dart';
import '../../auth/data/rider_auth.dart' show RiderSocialProvider;
import '../../auth/data/session.dart';
import '../../auth/data/signup.dart'
    show Vehicle, licensePattern, licenseRequired;
import '../../auth/presentation/signup_screens.dart' show vehicleText;
import '../../offers/presentation/offer_controllers.dart';
import '../data/profile.dart';
import '../data/profile_photo.dart';

/// 내 정보(마이페이지 "OOO 라이더님 ›", 사용자 2026-11-25): 이름 · 전화번호 · 로그인 계정(제공자 · 이메일) · 운행수단(바꾸기).
/// 이름·전화번호는 가입 때 본인 확인으로 정해져 계약에 바꾸는 길이 없다 — 보기만. 이메일은 로그인 토큰에서(이 기기에만).
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final profile = ref.watch(profileProvider);
    final account = ref.watch(loginAccountProvider).value;
    final provider = ref.watch(sessionProvider.select((s) => s?.provider));
    String fromProfile(String? Function(RiderProfileView p) pick) =>
        switch (profile) {
          AsyncData(:final value) => pick(value) ?? l10n.statUnavailable,
          AsyncError() => l10n.statUnavailable,
          _ => l10n.statLoading,
        };
    final providerName = switch (provider) {
      RiderSocialProvider.google => l10n.providerGoogle,
      RiderSocialProvider.naver => l10n.providerNaver,
      RiderSocialProvider.kakao => l10n.providerKakao,
      null => null,
    };
    final email = account?.email;
    final accountText = [?providerName, ?email].join(' · ');
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: AppBar(title: Text(l10n.myInfoTitle)),
      body: ListView(
        children: [
          ColoredBox(
            color: Colors.white,
            child: Column(
              children: [
                _InfoRow(
                  key: const ValueKey('info-name'),
                  label: l10n.myInfoName,
                  value: fromProfile((p) => p.name),
                ),
                const Divider(indent: 20, endIndent: 20),
                _InfoRow(
                  key: const ValueKey('info-phone'),
                  label: l10n.myInfoPhone,
                  value: fromProfile((p) => p.phoneMasked),
                ),
                const Divider(indent: 20, endIndent: 20),
                _InfoRow(
                  key: const ValueKey('info-account'),
                  label: l10n.myInfoAccount,
                  value: accountText.isEmpty
                      ? l10n.statUnavailable
                      : accountText,
                ),
                const Divider(indent: 20, endIndent: 20),
                _InfoRow(
                  key: const ValueKey('info-vehicle'),
                  label: l10n.myInfoVehicle,
                  value: fromProfile(
                    (p) => switch (p.vehicle) {
                      final v? => vehicleText(l10n, v),
                      null => null,
                    },
                  ),
                  onTap: profile.hasValue
                      ? () => changeVehicle(context, ref)
                      : null,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: EdgeInsets.fromLTRB(20, 15, onTap == null ? 20 : 12, 15),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 16, color: RiderColors.ink),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: RiderColors.ink,
              ),
            ),
          ),
          if (onTap != null)
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Icon(
                Icons.chevron_right,
                color: RiderColors.sub,
                size: 26,
              ),
            ),
        ],
      ),
    ),
  );
}

/// 운행수단 바꾸기(`PATCH /riders/me` vehicleType). 배송 중이면 서버가 409 INVALID_STATE 로 막는다 — 앱도 먼저 안내.
/// 오토바이·자동차·킥보드인데 등록된 면허가 없으면 면허 번호를 받아 함께 보낸다(422 LICENSE_REQUIRED).
/// 결과를 모르면(연결 끊김·5xx) 내 정보를 다시 읽어 맞춘다. 서버가 돌려준 값만 바뀐 것으로 보인다.
/// 이미 진행 중이면 또 시작하지 않는다(연타하면 안내가 여러 번 늦게 떴다 — 2026-11-25).
final _vehicleBusy = Expando<bool>();

Future<void> changeVehicle(BuildContext context, WidgetRef ref) async {
  final owner = ProviderScope.containerOf(context, listen: false);
  if (_vehicleBusy[owner] ?? false) return;
  _vehicleBusy[owner] = true;
  try {
    await _changeVehicle(context, ref);
  } finally {
    _vehicleBusy[owner] = false;
  }
}

Future<void> _changeVehicle(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  void toast(String text) {
    if (context.mounted) showRiderToast(context, text);
  }

  final RiderProfileView profile;
  try {
    profile = await ref.refresh(profileProvider.future);
  } on PmartFailure {
    return toast(l10n.vehicleChangeFailed);
  }
  final active = ref.read(dutyProvider).value?.activeDeliveryCount ?? 0;
  if (active > 0) return toast(l10n.vehicleChangeOnDelivery);
  if (!context.mounted) return;

  final picked = await showModalBottomSheet<Vehicle>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    // 작은 화면·큰 글자에서도 넘치지 않게 스크롤.
    builder: (context) => SafeArea(
      child: SingleChildScrollView(
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
                trailing: profile.vehicle == v
                    ? const Icon(Icons.check, color: RiderColors.primary)
                    : null,
                onTap: () => Navigator.of(context).pop(v),
              ),
              if (v != Vehicle.values.last)
                const Divider(indent: 16, endIndent: 16),
            ],
          ],
        ),
      ),
    ),
  );
  if (picked == null || picked == profile.vehicle || !context.mounted) return;

  String? license;
  if (licenseRequired(picked) && profile.licenseNumberMasked == null) {
    license = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => LicenseInputScreen(vehicle: vehicleText(l10n, picked)),
      ),
    );
    if (license == null) return;
  }

  final repo = ref.read(profileRepositoryProvider);
  Future<String> resolve() async {
    try {
      final now = await repo.me();
      return now.vehicle == picked
          ? l10n.vehicleChangeDone
          : l10n.vehicleChangeFailed;
    } on PmartFailure {
      return l10n.vehicleChangeUnknown;
    }
  }

  // 라이더 행 버전은 운행·설정을 바꿀 때도 오른다 — 보내기 직전에 다시 읽은 버전으로(배달 지역 바꾸기와 같게).
  Future<void> patch(IdempotencyKey k) async {
    final fresh = await repo.me();
    await repo.changeVehicle(
      vehicle: picked,
      licenseNumber: license,
      expectedVersion: fresh.version,
      key: k,
    );
  }

  String result;
  try {
    try {
      await patch(IdempotencyKey.generate());
    } on ProblemFailure catch (f) {
      if (f.problem.code != ProblemCode.versionConflict) rethrow;
      await patch(IdempotencyKey.generate());
    }
    result = l10n.vehicleChangeDone;
  } on ProblemFailure catch (f) {
    result = f.problem.status >= 500
        ? await resolve()
        : switch (f.problem.code) {
            ProblemCode.invalidState => l10n.vehicleChangeOnDelivery,
            licenseRequiredCode => l10n.vehicleLicenseNeeded,
            duplicateLicenseCode => l10n.licenseDuplicate,
            _ => l10n.vehicleChangeFailed,
          };
  } on PmartFailure {
    result = await resolve();
  }
  ref.invalidate(profileProvider);
  toast(result);
}

/// 면허 번호 받기 — 새 화면(사용자 2026-11-25 "팝업창이 너무 구려 그냥 새 창이 열리게"). 가입 화면의 면허 칸과 같은 모양
/// (하이픈 자동·12자리). 숫자 12자리를 다 넣어야 버튼이 켜진다. 뒤로 가면 null(바꾸지 않음).
class LicenseInputScreen extends StatefulWidget {
  const LicenseInputScreen({super.key, required this.vehicle});

  final String vehicle;

  @override
  State<LicenseInputScreen> createState() => _LicenseInputScreenState();
}

class _LicenseInputScreenState extends State<LicenseInputScreen> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  bool get _complete => licensePattern.hasMatch(_c.text.trim());

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(l10n.vehicleLicenseScreenTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.vehicleLicenseHeadline(widget.vehicle),
                style: const TextStyle(
                  fontSize: 22,
                  height: 1.4,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
              const SizedBox(height: 28),
              Text(
                l10n.fieldLicenseRequired,
                style: const TextStyle(fontSize: 15, color: RiderColors.ink),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('license-input'),
                controller: _c,
                autofocus: true,
                keyboardType: TextInputType.number,
                // 00-00-000000-00 처럼 하이픈 자동, 12자리 넘게는 입력 불가(가입 화면과 같음).
                inputFormatters: const [LicenseNumberFormatter()],
                decoration: InputDecoration(hintText: l10n.fieldLicenseHint),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) {
                  if (_complete) Navigator.of(context).pop(_c.text.trim());
                },
              ),
              const Spacer(),
              RiderButton(
                key: const ValueKey('license-ok'),
                label: l10n.vehicleLicenseSubmit,
                onPressed: _complete
                    ? () => Navigator.of(context).pop(_c.text.trim())
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
