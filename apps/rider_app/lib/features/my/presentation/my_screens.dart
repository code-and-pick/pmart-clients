import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';
import 'package:pmart_core/pmart_core.dart' show ProblemCode;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/pickup_points.dart';
import '../../auth/data/session.dart';
import '../../delivery/presentation/delivery_texts.dart';
import '../../offers/domain/offer_list.dart';
import '../../offers/presentation/offer_controllers.dart';
import '../data/profile.dart';
import '../data/records.dart';
import 'area_change.dart';

/// 마이페이지. 레퍼런스의 친구초대·미션달성·오늘의 기록·명세서 발급은 PMart 업무 문서에 없는 기능이라 두지 않는다.
class MyPageScreen extends ConsumerWidget {
  const MyPageScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 서버 지점 이름(코드 대신 "PMart 부산진구지점")을 한 번 읽는다.
    ref.watch(storeNamesProvider);
    final l10n = AppLocalizations.of(context);
    final duty = ref.watch(dutyProvider).value;
    final today = ref.watch(todaySummaryProvider);
    final profile = ref.watch(profileProvider);
    // 쉬는 동안 운행 상태의 mfcId 는 예전 운행 지점이라, 배달 지역(내 정보)을 보인다.
    final storeId = (duty?.onDuty ?? false)
        ? duty?.mfcId
        : profile.value?.deliveryAreaMfcId ?? duty?.mfcId;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.myPage),
        actions: [
          IconButton(
            key: const ValueKey('settings'),
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/my/settings'),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        riderGreetingText(
                          profile.value?.name,
                          l10n.riderGreetingNamed,
                          l10n.riderGreeting,
                        ),
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        storeText(l10n, storeId),
                        style: const TextStyle(
                          fontSize: 14,
                          color: RiderColors.ink,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          _Stat(
                            label: l10n.statCompleted,
                            // 조회 실패·로딩을 0 으로 보이지 않는다.
                            value: switch (today) {
                              AsyncData(:final value) => l10n.countUnit(
                                value.completedCount,
                              ),
                              AsyncError() => l10n.statUnavailable,
                              _ => l10n.statLoading,
                            },
                          ),
                          const SizedBox(width: 36),
                          _Stat(
                            label: l10n.statEarnings,
                            value: switch (today) {
                              AsyncData(:final value) =>
                                switch (value.earnings) {
                                  final int e => formatKrw(e),
                                  null => l10n.feeUncalculated,
                                },
                              AsyncError() => l10n.statUnavailable,
                              _ => l10n.statLoading,
                            },
                          ),
                          const Spacer(),
                          OutlinedButton(
                            key: const ValueKey('today-history'),
                            onPressed: () => context.push('/my/history'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: RiderColors.ink,
                              side: const BorderSide(color: RiderColors.line),
                              shape: const StadiumBorder(),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                              ),
                            ),
                            child: Text(l10n.todayHistory),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: RiderColors.primaryMist,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    l10n.safetyBannerTitle,
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    l10n.safetyHelmet,
                                    style: const TextStyle(
                                      fontSize: 13,
                                      color: RiderColors.sub,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(
                              Icons.health_and_safety_outlined,
                              size: 40,
                              color: RiderColors.primary,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
                MenuRow(
                  key: const ValueKey('menu-settlements'),
                  icon: Icons.paid_outlined,
                  label: l10n.menuSettlements,
                  onTap: () => context.push('/my/settlements'),
                ),
                MenuRow(
                  key: const ValueKey('menu-history'),
                  icon: Icons.bar_chart,
                  label: l10n.menuHistory,
                  onTap: () => context.push('/my/history'),
                ),
                MenuRow(
                  key: const ValueKey('menu-time'),
                  icon: Icons.schedule,
                  label: l10n.menuTime,
                  onTap: () => context.push('/my/time'),
                ),
                // 배달 지역 바꾸기(사용자 2026-11-23) — 운행을 쉴 때만, 한 곳, 바로 반영.
                MenuRow(
                  key: const ValueKey('menu-area'),
                  icon: Icons.place_outlined,
                  label: l10n.menuArea,
                  value: deliveryAreaText(l10n, profile),
                  onTap: () => changeDeliveryArea(context, ref),
                ),
                // 지원센터: 배송과 상관없는 문의 + 소명·이의(사용자 2026-11-20 한 곳으로). 배송 건은 배송 화면의 도움요청.
                MenuRow(
                  key: const ValueKey('menu-inquiries'),
                  icon: Icons.support_agent,
                  label: l10n.menuSupport,
                  onTap: () => context.push('/my/inquiries'),
                ),
                MenuRow(
                  key: const ValueKey('menu-notifications'),
                  icon: Icons.notifications_none,
                  label: l10n.menuNotifications,
                  onTap: () => context.push('/notifications'),
                ),
              ],
            ),
          ),
          const _EndDutyBar(),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(fontSize: 13, color: RiderColors.sub)),
      const SizedBox(height: 4),
      Text(
        value,
        style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
      ),
    ],
  );
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    color: RiderColors.gap,
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, color: RiderColors.sub),
    ),
  );
}

/// 환경설정. 레퍼런스의 소식받기 지역·알림음·광고성 정보 수신은 계약·업무 문서에 없어 두지 않는다.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(dispatchSettingsProvider);
    final value = settings.value;
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: [
          _GroupLabel(l10n.settingsBasic),
          ColoredBox(
            color: Colors.white,
            child: Column(
              children: [
                MenuRow(
                  key: const ValueKey('settings-mode'),
                  label: l10n.settingsMode,
                  value: switch (value?.mode) {
                    DispatchMode.aiRecommended => l10n.modeAi,
                    DispatchMode.normal => l10n.modeNormal,
                    null =>
                      settings is AsyncError
                          ? l10n.statUnavailable
                          : l10n.statLoading,
                  },
                  onTap: () => context.push('/my/dispatch-mode'),
                ),
                const Divider(indent: 20, endIndent: 20),
                MenuRow(
                  label: l10n.settingsOneAtATime,
                  trailing: Switch(
                    key: const ValueKey('settings-one'),
                    value: value?.oneAtATime ?? false,
                    onChanged: value == null
                        ? null
                        : (v) async {
                            final ok = await ref
                                .read(dispatchSettingsProvider.notifier)
                                .change(oneAtATime: v);
                            if (!ok && context.mounted) {
                              showRiderToast(context, l10n.settingsSaveFailed);
                            }
                          },
                  ),
                ),
                const Divider(indent: 20, endIndent: 20),
                // 길찾기는 앱 안 카카오내비 길안내(KNSDK), 안 되면 카카오내비 앱(2026-11-16).
                MenuRow(
                  key: const ValueKey('settings-nav-app'),
                  label: l10n.settingsNavApp,
                  value: l10n.navAppKakao,
                  onTap: () => showRiderToast(context, l10n.navigateHow),
                ),
              ],
            ),
          ),
          _GroupLabel(l10n.settingsPolicy),
          ColoredBox(
            color: Colors.white,
            child: MenuRow(
              key: const ValueKey('settings-licenses'),
              label: l10n.settingsLicenses,
              onTap: () => showLicensePage(context: context),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton(
                  key: const ValueKey('logout'),
                  onPressed: () => ref.read(sessionProvider.notifier).logout(),
                  child: Text(
                    l10n.logout,
                    style: const TextStyle(
                      fontSize: 15,
                      color: RiderColors.ink,
                    ),
                  ),
                ),
                Container(width: 1, height: 12, color: RiderColors.hint),
                TextButton(
                  key: const ValueKey('withdraw'),
                  // 탈퇴(`POST /riders/me/withdrawals`) — 진행 배송·미정산은 서버가 거절한다.
                  onPressed: () => context.push('/my/withdraw'),
                  child: Text(
                    l10n.withdraw,
                    style: const TextStyle(
                      fontSize: 15,
                      color: RiderColors.ink,
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

/// 배차 방식 선택(AI 추천 / 일반). 서버가 돌려준 값만 선택으로 보인다.
class DispatchModeScreen extends ConsumerWidget {
  const DispatchModeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(dispatchSettingsProvider);
    final mode = settings.value?.mode;
    Future<void> pick(DispatchMode m) async {
      final ok = await ref
          .read(dispatchSettingsProvider.notifier)
          .change(mode: m);
      if (!ok && context.mounted) {
        showRiderToast(context, l10n.settingsSaveFailed);
      }
    }

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
              Text(
                l10n.modeTitle,
                style: const TextStyle(fontSize: 26, height: 1.45),
              ),
              const SizedBox(height: 36),
              if (settings is AsyncError)
                Row(
                  children: [
                    Expanded(child: Text(l10n.settingsLoadFailed)),
                    TextButton(
                      onPressed: () => ref.invalidate(dispatchSettingsProvider),
                      child: Text(l10n.retry),
                    ),
                  ],
                ),
              _ModeCard(
                key: const ValueKey('mode-ai'),
                label: l10n.modeAi,
                note: l10n.modeAiNote,
                selected: mode == DispatchMode.aiRecommended,
                onTap: mode == null
                    ? null
                    : () => pick(DispatchMode.aiRecommended),
              ),
              const SizedBox(height: 16),
              _ModeCard(
                key: const ValueKey('mode-normal'),
                label: l10n.modeNormal,
                note: l10n.modeNormalNote,
                selected: mode == DispatchMode.normal,
                onTap: mode == null ? null : () => pick(DispatchMode.normal),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    super.key,
    required this.label,
    required this.note,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String note;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 22),
      decoration: BoxDecoration(
        border: Border.all(
          color: selected ? RiderColors.primary : RiderColors.line,
          width: selected ? 1.5 : 1,
        ),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? RiderColors.primary : RiderColors.line,
            ),
            alignment: Alignment.center,
            child: Container(
              width: 9,
              height: 9,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: selected ? RiderColors.primary : RiderColors.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  note,
                  style: const TextStyle(fontSize: 13, color: RiderColors.sub),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// 마이페이지 아래 운행종료(사용자 2026-11-23 "운행종료 눌러도 된 건지 안 된 건지 확실 안 하고").
/// 누르면 그 자리에서 "종료하는 중…", 서버가 확정하면 버튼이 "운행 종료됨"으로 바뀌고 위에 한 줄 안내가 남는다.
/// 거절(진행 배송 있음 등)도 버튼 바로 위 글로 남긴다 — 위로 뜨는 알림이 버튼을 가리지 않게.
class _EndDutyBar extends ConsumerStatefulWidget {
  const _EndDutyBar();

  @override
  ConsumerState<_EndDutyBar> createState() => _EndDutyBarState();
}

class _EndDutyBarState extends ConsumerState<_EndDutyBar> {
  bool _busy = false;
  String? _error;

  /// 이 화면에서 방금 끝냈다(그때만 "운행을 종료했어요"를 보인다).
  bool _justEnded = false;

  Future<void> _end() async {
    final l10n = AppLocalizations.of(context);
    // 한 번 묻는다(레퍼런스 "오늘도 수고하셨습니다 · 운행을 종료하시겠습니까? [취소 | 운행종료]").
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => RiderAlertDialog(
        title: Text(l10n.endDutyAskTitle),
        content: Text(l10n.endDutyAsk),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.wdCancel),
          ),
          TextButton(
            key: const ValueKey('end-duty-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.endDuty),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final code = await ref
        .read(dutyProvider.notifier)
        .change(onDuty: false, newDispatch: false);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (code == null) {
        _justEnded = true;
      } else {
        _error = switch (code) {
          ProblemCode.invalidState => l10n.cannotEndWithActive,
          _ => l10n.dutyChangeFailed,
        };
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final duty = ref.watch(dutyProvider).value;
    final onDuty = duty?.onDuty ?? false;
    final ended = duty != null && !onDuty;
    final note =
        _error ??
        (ended ? (_justEnded ? l10n.dutyEndedNow : l10n.dutyOffNote) : null);
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: RiderColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (note != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    key: const ValueKey('end-duty-note'),
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _error != null
                            ? Icons.error_outline
                            : Icons.check_circle,
                        size: 18,
                        color: _error != null
                            ? RiderColors.danger
                            : RiderColors.primary,
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          note,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: _error != null
                                ? RiderColors.danger
                                : RiderColors.ink,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              // 레퍼런스처럼 흰 바탕 위에 빨간 글자 "운행종료"(사용자 2026-11-23). 끝난 뒤는 회색 "운행 종료됨".
              SizedBox(
                width: double.infinity,
                height: 54,
                child: TextButton(
                  key: const ValueKey('end-duty'),
                  style: TextButton.styleFrom(
                    foregroundColor: RiderColors.danger,
                    disabledForegroundColor: RiderColors.hint,
                    backgroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(),
                  ),
                  // 진행 배송이 있으면 서버가 거절한다(버튼 위 글로 안내).
                  onPressed: onDuty && !_busy ? _end : null,
                  child: _busy
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: RiderColors.danger,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Text(
                              l10n.endingDuty,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        )
                      : Text(
                          ended ? l10n.dutyEndedButton : l10n.endDuty,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
