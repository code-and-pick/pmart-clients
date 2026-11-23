import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/pickup_points.dart';
import '../../auth/data/signup.dart';
import '../../auth/presentation/signup_screens.dart' show AreaSheet;
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
Future<void> changeDeliveryArea(BuildContext context, WidgetRef ref) async {
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
  // 2026-11-23 사용자 "배달지역 바꾸기 팝업창 UI 별로야" — 글만 있던 기본 창 대신 "지금 → 바꿀 곳"을 칸으로 보이는 확인 창.
  final sure = await showDialog<bool>(
    context: context,
    builder: (context) => _AreaChangeDialog(
      from: current == null
          ? null
          : l10n.storeLabel(shortStoreName(storeNameOf(current) ?? current)),
      to: l10n.storeLabel(shortStoreName(picked.name)),
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

/// 배달 지역 바꾸기 확인 — 제목, "지금 → 바꿀 곳" 두 칸, 반영 안내, 꽉 찬 두 버튼(취소 · 바꾸기).
class _AreaChangeDialog extends StatelessWidget {
  const _AreaChangeDialog({required this.from, required this.to});

  final String? from;
  final String to;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // 한 줄: 왼쪽 "지금"/"바꿀 곳", 오른쪽 지점 이름 — 이름이 길어도 꺾이지 않게 가로 한 줄 칸을 위아래로 둔다.
    Widget place(String label, String? name, {required bool next}) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: next ? RiderColors.primaryMist : RiderColors.gap,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: next ? RiderColors.primary : RiderColors.line,
          width: next ? 1.5 : 1,
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 56,
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, color: RiderColors.sub),
            ),
          ),
          Expanded(
            child: Text(
              name ?? '—',
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: next ? RiderColors.primary : RiderColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
    return Dialog(
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.areaChangeTitle,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 16),
            place(l10n.areaNow, from, next: false),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 4),
              child: Icon(
                Icons.arrow_downward_rounded,
                size: 20,
                color: RiderColors.sub,
              ),
            ),
            place(l10n.areaNext, to, next: true),
            const SizedBox(height: 14),
            Text(
              l10n.areaChangeNote,
              style: const TextStyle(
                fontSize: 13,
                height: 1.45,
                color: RiderColors.sub,
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      foregroundColor: RiderColors.ink,
                      side: const BorderSide(color: RiderColors.line),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    onPressed: () => Navigator.of(context).pop(false),
                    child: Text(l10n.wdCancel),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    key: const ValueKey('area-change-confirm'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: RiderColors.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    onPressed: () => Navigator.of(context).pop(true),
                    child: Text(
                      l10n.areaChangeConfirm,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
