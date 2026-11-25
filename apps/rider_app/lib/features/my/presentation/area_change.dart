import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/location.dart' show locationSourceProvider;
import '../../../shared/location_reporter.dart' show locationUploaderProvider;
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/pickup_points.dart';
import '../../auth/data/signup.dart';
import '../../auth/presentation/signup_screens.dart' show regionText;
import '../../offers/presentation/offer_controllers.dart';
import '../../offers/domain/offer_list.dart' show OperatingState;
import '../data/profile.dart';

/// 고를 수 없는 지점(없음·MFC 아님·운영 중 아님) — rider 0.23.0 `PATCH /riders/me` 422.
const mfcNotAvailableCode = 'MFC_NOT_AVAILABLE';

/// 마이페이지 "배달 지역" 바꾸기(사용자 2026-11-23 — 이사했거나 다른 지점 근처로 옮긴 라이더).
/// - 한 곳만(가입처럼 지점 하나를 다른 지점으로), 바로 반영(`PATCH /riders/me` deliveryAreas).
/// - 운행을 쉴 때만: 운행 중(진행 배송 포함)이면 바꾸지 않고 안내한다. 서버도 409 INVALID_STATE 로 막는다(rider 0.23.0, 백엔드 #361 — 요청
///   `docs/handoff/rider-app/2026-11-23-backend-delivery-area-change.md`).
/// - 결과를 모르면(연결 끊김·5xx) 내 정보를 다시 읽어 바뀌었는지 맞춘다. 서버가 돌려준 값만 바뀐 것으로 보인다.
/// 이미 진행 중이면 또 시작하지 않는다(2026-11-25 사용자 "연타하면 회색 팝업창이 뒤늦게 우루루 여러개 떠" — 누를 때마다 흐름이 새로 돌아
/// 늦게 끝난 것들의 안내가 차례로 떴다).
/// 앱 상태(ProviderContainer)마다 따로 — 시험마다 새 앱이라 서로 섞이지 않는다.
final _areaBusy = Expando<bool>();

Future<void> changeDeliveryArea(BuildContext context, WidgetRef ref) async {
  final owner = ProviderScope.containerOf(context, listen: false);
  if (_areaBusy[owner] ?? false) return;
  _areaBusy[owner] = true;
  try {
    await _changeDeliveryArea(context, ref);
  } finally {
    _areaBusy[owner] = false;
  }
}

Future<void> _changeDeliveryArea(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  void toast(String text) {
    if (context.mounted) showRiderToast(context, text);
  }

  bool resting() {
    final d = ref.read(dutyProvider).value;
    return d != null && !d.onDuty && d.activeDeliveryCount == 0;
  }

  // 방금 운행을 끈 뒤일 수 있다 — 화면에 남은 운행 상태가 아니라 서버의 지금 상태로 판단한다.
  final OperatingState latest;
  try {
    latest = await ref.refresh(dutyProvider.future);
  } on PmartFailure {
    return toast(l10n.areaChangeFailed);
  }
  if (latest.onDuty || latest.activeDeliveryCount > 0) {
    return toast(l10n.areaChangeOnDuty);
  }

  final RiderProfileView profile;
  final Map<MfcRegion, List<AreaOption>> areas;
  try {
    profile = await ref.refresh(profileProvider.future);
  } on PmartFailure {
    return toast(l10n.areaChangeFailed);
  }
  try {
    areas = await ref.read(areaOptionsProvider.future);
  } on PmartFailure {
    return toast(l10n.areaLoadFailed);
  }
  // 지금 위치 한 점을 보내고(쉬는 동안은 위치를 안 보내 서버가 모른다 — 백엔드 회신 2026-11-25) 지금 위치 권역을 묻는다.
  // 권역을 못 읽으면(장애) 흐리게 하지 않는다 — 서버가 바꾸기에서 다시 검사한다.
  final repo = ref.read(profileRepositoryProvider);
  await _sendHere(ref);
  LocationArea? here;
  try {
    here = await repo.locationArea();
  } on PmartFailure {
    here = null;
  }
  if (!context.mounted) return;
  final current = profile.deliveryAreaMfcId;
  final initial = areas.values
      .expand((list) => list)
      .where((a) => a.mfcId == current)
      .firstOrNull;
  // 2026-11-25 사용자 "지역 바꾸기 팝업창 너무 별론데" — 아래 창 + 확인 팝업 대신 새 화면 하나(아래 버튼이 확인).
  final picked = await Navigator.of(context).push<AreaOption>(
    MaterialPageRoute(
      builder: (_) =>
          AreaChangeScreen(current: initial, areas: areas, here: here),
    ),
  );
  if (picked == null || picked.mfcId == current || !context.mounted) return;
  // 묻는 동안 운행을 시작했을 수 있다.
  if (!resting()) return toast(l10n.areaChangeOnDuty);
  // 바꾸기 직전에 한 번 더 지금 위치(화면에 오래 머물렀으면 5분이 지나 LOCATION_UNKNOWN 이 된다)
  await _sendHere(ref);

  final key = IdempotencyKey.generate();
  // 결과 불명 — 실패로 정하지 않고 내 정보로 맞춘다.
  Future<String> resolve() async {
    try {
      final now = await repo.me();
      return now.deliveryAreaMfcId == picked.mfcId
          ? l10n.areaChangeDone
          : l10n.areaChangeFailed;
    } on PmartFailure {
      return l10n.areaChangeUnknown;
    }
  }

  // 라이더 행 버전은 운행 시작·종료·신규배차·배차 설정을 바꿀 때도 오른다(rider-service 한 행).
  // 그래서 보내기 직전에 내 정보를 다시 읽어 그 버전으로 보낸다 — 전에는 마이페이지를 연 때의 버전을 보내
  // 운행을 끈 뒤 바꾸면 409 VERSION_CONFLICT 로 "바꾸지 못했어요"였다(사용자 2026-11-23 "운행 종료해도 안 바뀌어").
  // 그 사이 또 바뀌어 충돌하면 한 번만 다시 읽어 새 키로 다시 보낸다(내용은 같다).
  Future<void> patch(IdempotencyKey k) async {
    final fresh = await repo.me();
    await repo.changeDeliveryArea(
      mfcId: picked.mfcId,
      expectedVersion: fresh.version,
      key: k,
    );
  }

  String result;
  try {
    try {
      await patch(key);
    } on ProblemFailure catch (f) {
      if (f.problem.code != ProblemCode.versionConflict) rethrow;
      await patch(IdempotencyKey.generate());
    }
    result = l10n.areaChangeDone;
  } on ProblemFailure catch (f) {
    // rider 0.23.0(백엔드 #361): 운행 중·진행 배송 = 409 INVALID_STATE, 없는·운영 안 하는 지점 = 422 MFC_NOT_AVAILABLE.
    result = f.problem.status >= 500
        ? await resolve()
        : switch (f.problem.code) {
            ProblemCode.invalidState => l10n.areaChangeOnDuty,
            mfcNotAvailableCode => l10n.areaChangeUnavailable,
            // rider 0.27.0 — 지금 위치가 그 지점 배달 지역 밖 / 지금 위치를 모름
            outsideDeliveryAreaCode => l10n.areaOutside,
            locationUnknownCode => l10n.areaLocationUnknown,
            _ => l10n.areaChangeFailed,
          };
  } on PmartFailure {
    result = await resolve();
  }
  // 서버 값으로 다시 맞춘다(마이페이지 지점 이름·운행 지점).
  ref
    ..invalidate(profileProvider)
    ..invalidate(dutyProvider);
  toast(result);
}

/// 지금 위치 한 점을 서버에 보낸다(`POST /riders/me/locations`). 권한이 없거나 못 잡았거나 실패해도 흐름을 막지 않는다
/// — 그때는 서버가 LOCATION_UNKNOWN 으로 알려 준다.
Future<void> _sendHere(WidgetRef ref) async {
  try {
    // 위치 잡기·올리기가 늦어도 화면을 오래 붙잡지 않는다(각 3초) — 못 보냈으면 서버가 LOCATION_UNKNOWN 으로 알려 준다.
    final point = await ref
        .read(locationSourceProvider)
        ?.current()
        .timeout(const Duration(seconds: 3), onTimeout: () => null);
    if (point == null) return;
    await ref
        .read(locationUploaderProvider)
        .upload([
          (lat: point.lat, lng: point.lng, recordedAt: DateTime.now().toUtc()),
        ], key: IdempotencyKey.generate())
        .timeout(const Duration(seconds: 3));
  } on Object {
    // 보내지 못했다 — 바꾸기에서 서버가 판단한다.
  }
}

/// 마이페이지 줄에 보일 배달 지역 이름. 읽는 중·실패를 빈 값으로 보이지 않는다.
String deliveryAreaText(
  AppLocalizations l10n,
  AsyncValue<RiderProfileView> profile,
) => switch (profile) {
  AsyncData(:final value) => switch (value.deliveryAreaMfcId) {
    final id? => l10n.storeLabel(shortStoreName(storeNameOf(id) ?? id)),
    null => l10n.statUnavailable,
  },
  AsyncError() => l10n.statUnavailable,
  _ => l10n.statLoading,
};

/// 배달 지역 바꾸기 화면(팝업·아래 창 대신 새 화면). 지점을 고르고 아래 "이 지점으로 바꾸기"를 누르면 그 지점을 돌려준다
/// (따로 묻는 창 없이 — 버튼이 확인). 뒤로 가면 null.
/// 사용자 2026-11-25 "지역 바꾸기 팝업창 너무 별론데" → 시안 둘 중 고른 "한 화면"(권역 칩 + 지점 목록).
class AreaChangeScreen extends StatefulWidget {
  const AreaChangeScreen({
    super.key,
    required this.current,
    required this.areas,
    this.here,
  });

  /// 지금 배달 지역(지점). 모르면 null.
  final AreaOption? current;
  final Map<MfcRegion, List<AreaOption>> areas;

  /// 지금 위치 권역(null = 못 읽음 — 흐리게 하지 않는다).
  final LocationArea? here;

  @override
  State<AreaChangeScreen> createState() => _AreaChangeScreenState();
}

class _AreaChangeScreenState extends State<AreaChangeScreen> {
  late MfcRegion? _region = widget.current?.region ?? _regions.firstOrNull;
  AreaOption? _branch;

  List<MfcRegion> get _regions => [
    for (final r in MfcRegion.values)
      if (widget.areas[r]?.isNotEmpty ?? false) r,
  ];

  bool get _canSubmit =>
      _branch != null && _branch!.mfcId != widget.current?.mfcId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final region = _region;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.areaChangeTitle),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                key: const ValueKey('area-change-list'),
                padding: const EdgeInsets.only(bottom: 12),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF4F5F7),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          Text(
                            l10n.areaNow,
                            style: const TextStyle(
                              fontSize: 13.5,
                              color: RiderColors.sub,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            switch (widget.current) {
                              final c? => l10n.storeLabel(
                                shortStoreName(c.name),
                              ),
                              null => '—',
                            },
                            key: const ValueKey('area-now'),
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: RiderColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // 지금 위치를 모르면(위치 꺼짐·오래됨) 한 줄 — 서버가 바꾸기를 거절한다(LOCATION_UNKNOWN)
                  if (widget.here case final h?
                      when h.state != LocationState.fresh)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                      child: Text(
                        l10n.areaLocationNote,
                        key: const ValueKey('area-location-note'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: RiderColors.pickup,
                        ),
                      ),
                    ),
                  _label(l10n.areaRegion),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final r in _regions)
                          _Chip(
                            key: ValueKey('area-${r.name}'),
                            label: regionText(l10n, r),
                            selected: r == region,
                            onTap: () => setState(() {
                              if (_region != r) _branch = null;
                              _region = r;
                            }),
                          ),
                      ],
                    ),
                  ),
                  _label(l10n.areaBranch),
                  ..._branches(region),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
              child: Column(
                children: [
                  Text(
                    l10n.areaChangeNote,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(height: 10),
                  RiderButton(
                    key: const ValueKey('area-change-confirm'),
                    label: l10n.areaChangeSubmit,
                    onPressed: _canSubmit
                        ? () => Navigator.of(context).pop(_branch)
                        : null,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 22, 20, 10),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: RiderColors.sub,
      ),
    ),
  );

  /// 지점 줄 — 이름(15.5) + 오른쪽 둥근 고르기 표시. 지금 지점에는 "지금" 꼬리표.
  List<Widget> _branches(MfcRegion? region) {
    final l10n = AppLocalizations.of(context);
    final list = widget.areas[region] ?? const <AreaOption>[];
    // 지금 위치가 들어가는 권역의 지점만 고를 수 있다(rider 0.27.0 — 2026-11-25 사용자 "배달 가능 지역 내부에 있을 때만").
    // 권역을 못 읽었으면(null) 흐리게 하지 않는다. 지금 지점은 그대로 둔다(바꾸는 게 아니다).
    final here = widget.here;
    bool outside(AreaOption a) =>
        here != null &&
        a.mfcId != widget.current?.mfcId &&
        (here.state != LocationState.fresh || !here.mfcIds.contains(a.mfcId));
    return [
      for (final (i, a) in list.indexed) ...[
        if (i > 0) const Divider(height: 1, indent: 20, endIndent: 20),
        InkWell(
          key: ValueKey('area-${a.name}'),
          // 권역 칩과 같게 물결 없이 옅은 눌림만.
          splashFactory: NoSplash.splashFactory,
          highlightColor: const Color(0x0A000000),
          onTap: outside(a)
              ? () => showRiderToast(context, l10n.areaOutsideShort)
              : () => setState(() => _branch = a),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 18, 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    shortStoreName(a.name),
                    style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: a.mfcId == _branch?.mfcId
                          ? FontWeight.w600
                          : FontWeight.w400,
                      color: outside(a) ? RiderColors.hint : RiderColors.ink,
                    ),
                  ),
                ),
                if (outside(a)) ...[
                  Text(
                    l10n.areaOutsideTag,
                    key: ValueKey('area-outside-${a.mfcId}'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: RiderColors.hint,
                    ),
                  ),
                  const SizedBox(width: 10),
                ],
                if (a.mfcId == widget.current?.mfcId) ...[
                  Text(
                    l10n.areaNow,
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(width: 10),
                ],
                Icon(
                  a.mfcId == _branch?.mfcId
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 22,
                  color: a.mfcId == _branch?.mfcId
                      ? RiderColors.primary
                      : RiderColors.disabled,
                ),
              ],
            ),
          ),
        ),
      ],
      // 사용자 2026-11-25 "맨 마지막에 있는 지역 밑에도 회색 구분선" — 마지막 줄 아래도 같은 선.
      if (list.isNotEmpty) const Divider(height: 1, indent: 20, endIndent: 20),
    ];
  }
}

/// 권역 칩 — 고르면 보라 바탕·흰 글씨, 아니면 흰 바탕·회색 테두리.
class _Chip extends StatelessWidget {
  const _Chip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? RiderColors.primary : Colors.white,
    shape: StadiumBorder(
      side: BorderSide(
        color: selected ? RiderColors.primary : RiderColors.line,
      ),
    ),
    child: InkWell(
      customBorder: const StadiumBorder(),
      // 사용자 2026-11-25 "권역 버튼 클릭할 때 물결효과 너무 강해" — 물결 없이 아주 옅은 눌림만.
      splashFactory: NoSplash.splashFactory,
      highlightColor: const Color(0x0F000000),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? Colors.white : RiderColors.ink,
          ),
        ),
      ),
    ),
  );
}
