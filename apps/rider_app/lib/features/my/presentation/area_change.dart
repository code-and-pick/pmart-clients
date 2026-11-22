import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/pickup_points.dart';
import '../../auth/data/signup.dart';
import '../../auth/presentation/signup_screens.dart' show AreaSheet;
import '../../offers/presentation/offer_controllers.dart';
import '../data/profile.dart';

/// 마이페이지 "배달 지역" 바꾸기(사용자 2026-11-23 — 이사했거나 다른 지점 근처로 옮긴 라이더).
/// - 한 곳만(가입처럼 지점 하나를 다른 지점으로), 바로 반영(`PATCH /riders/me` deliveryAreas).
/// - 운행을 쉴 때만: 운행 중(진행 배송 포함)이면 바꾸지 않고 안내한다. 서버는 아직 운행 중 변경을 막지 않는다 — 백엔드에 요청
///   (`docs/handoff/rider-app/2026-11-23-backend-delivery-area-change.md`).
/// - 결과를 모르면(연결 끊김·5xx) 내 정보를 다시 읽어 바뀌었는지 맞춘다. 서버가 돌려준 값만 바뀐 것으로 보인다.
Future<void> changeDeliveryArea(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  void toast(String text) {
    if (context.mounted) showRiderToast(context, text);
  }

  bool resting() {
    final d = ref.read(dutyProvider).value;
    return d != null && !d.onDuty && d.activeDeliveryCount == 0;
  }

  if (ref.read(dutyProvider).value == null) return toast(l10n.areaChangeFailed);
  if (!resting()) return toast(l10n.areaChangeOnDuty);

  final RiderProfileView profile;
  final Map<MfcRegion, List<AreaOption>> areas;
  try {
    profile = await ref.read(profileProvider.future);
  } on PmartFailure {
    return toast(l10n.areaChangeFailed);
  }
  try {
    areas = await ref.read(areaOptionsProvider.future);
  } on PmartFailure {
    return toast(l10n.areaLoadFailed);
  }
  if (!context.mounted) return;
  final current = profile.deliveryAreaMfcId;
  final initial = areas.values
      .expand((list) => list)
      .where((a) => a.mfcId == current)
      .firstOrNull;
  final picked = await showModalBottomSheet<AreaOption>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (_) => AreaSheet(initial: initial, areas: areas),
  );
  if (picked == null || picked.mfcId == current || !context.mounted) return;
  final sure = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.areaChangeTitle),
      content: Text(l10n.areaChangeAsk(picked.name)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.wdCancel),
        ),
        TextButton(
          key: const ValueKey('area-change-confirm'),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(l10n.areaChangeConfirm),
        ),
      ],
    ),
  );
  if (sure != true) return;
  // 묻는 동안 운행을 시작했을 수 있다.
  if (!resting()) return toast(l10n.areaChangeOnDuty);

  final repo = ref.read(profileRepositoryProvider);
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

  String result;
  try {
    await repo.changeDeliveryArea(
      mfcId: picked.mfcId,
      expectedVersion: profile.version,
      key: key,
    );
    result = l10n.areaChangeDone;
  } on ProblemFailure catch (f) {
    result = f.problem.status >= 500
        ? await resolve()
        : f.problem.code == ProblemCode.invalidState
        ? l10n.areaChangeOnDuty
        : l10n.areaChangeFailed;
  } on PmartFailure {
    result = await resolve();
  }
  // 서버 값으로 다시 맞춘다(마이페이지 지점 이름·운행 지점).
  ref
    ..invalidate(profileProvider)
    ..invalidate(dutyProvider);
  toast(result);
}

/// 마이페이지 줄에 보일 배달 지역 이름. 읽는 중·실패를 빈 값으로 보이지 않는다.
String deliveryAreaText(
  AppLocalizations l10n,
  AsyncValue<RiderProfileView> profile,
) => switch (profile) {
  AsyncData(:final value) => switch (value.deliveryAreaMfcId) {
    final id? => storeNameOf(id) ?? id,
    null => l10n.statUnavailable,
  },
  AsyncError() => l10n.statUnavailable,
  _ => l10n.statLoading,
};
