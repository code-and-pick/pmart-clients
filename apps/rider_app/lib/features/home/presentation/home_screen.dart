import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/location.dart';
import '../../../shared/location_reporter.dart';
import '../../../shared/rider_map.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../appeals/data/appeals.dart';
import '../../appeals/presentation/appeal_screens.dart';
import '../../auth/data/pickup_points.dart';
import '../../delivery/data/trip_repository.dart';
import '../../delivery/presentation/delivery_controller.dart';
import '../../delivery/presentation/delivery_screen.dart';
import '../../offers/presentation/offer_detail_screen.dart'
    show deliveryMapRoute, offerMapRoute;
import '../../delivery/presentation/delivery_texts.dart';
import '../../my/data/profile.dart';
import '../../notifications/presentation/notification_screen.dart';
import '../../offers/domain/offer_list.dart';
import '../../offers/presentation/offer_actions.dart';
import '../../offers/presentation/offer_controllers.dart';

/// 운행 상태 바꾸기. 실패하면 서버 판정을 그대로 안내한다.
Future<void> changeDuty(
  BuildContext context,
  WidgetRef ref, {
  required bool onDuty,
  required bool newDispatch,
}) async {
  final l10n = AppLocalizations.of(context);
  final overlay = Overlay.of(context, rootOverlay: true);
  final code = await ref
      .read(dutyProvider.notifier)
      .change(onDuty: onDuty, newDispatch: newDispatch);
  if (code == null) return;
  if (code == restrictedCode) ref.invalidate(profileProvider);
  showRiderTopToast(overlay, switch (code) {
    ProblemCode.invalidState => l10n.cannotEndWithActive,
    restrictedCode => l10n.restrictedNoDispatch,
    _ => l10n.dutyChangeFailed,
  });
}

/// 진행 중 배송 ID: 서버 목록(재접속 복구)과 이번에 수락한 배송을 합친다.
/// 서버가 내 배송이 아니라고 확정한 배송(배차 취소 APPLIED)은 뺀다 — 목록이 늦게 따라와도 남지 않게.
List<String> watchActiveDeliveryIds(WidgetRef ref) {
  final released = ref.watch(releasedDeliveriesProvider);
  return {
    // 완료 카드를 띄운 배송이 앞(닫을 때까지 그 화면을 둔다).
    ...ref.watch(finishingDeliveriesProvider),
    ...?ref.watch(myActiveDeliveriesProvider).value?.map((d) => d.deliveryId),
    ...ref.watch(assignedDeliveriesProvider),
  }.where((id) => !released.contains(id)).toList();
}

/// 라이더 홈(지도). 운행 시작 → 신규배차 → 제안 카드 → 진행 중 배송. 화면 상태는 서버 확정 결과로만 바꾼다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late final AppLifecycleListener _lifecycle;
  bool _askedLocation = false;

  @override
  void initState() {
    super.initState();
    // 앱 실행·포그라운드 복귀 때는 간격과 상관없이 바로 조회한다(알림 유실 복구).
    Future.microtask(() => ref.read(offerPollerProvider.notifier).refreshNow());
    _lifecycle = AppLifecycleListener(
      onResume: () {
        ref.read(offerPollerProvider.notifier).refreshNow();
        // 설정에서 위치 권한을 켜고 돌아온 경우
        ref.read(locationReporterProvider.notifier).retryAfterPermission();
        ref
          ..invalidate(profileProvider)
          ..invalidate(myActiveDeliveriesProvider);
      },
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  /// 위치 전송이 켜질 때 이번 실행에 한 번:
  /// 1) 위치 권한이 없으면 안내하고 묻는다. "앱 사용 중에만 허용"·"항상 허용" 어느 쪽이든 있으면 묻지 않는다(라이더가 고른다).
  /// 2) 배터리 최적화 예외가 아니면 안내하고 묻는다 — 절전이 앱을 종료해 위치가 끊기는 일을 줄인다.
  Future<void> _askLocation() async {
    if (_askedLocation) return;
    _askedLocation = true;
    final permission = ref.read(locationPermissionProvider);
    if (permission != null &&
        await permission.check() == LocationAccess.denied &&
        mounted) {
      final l10n = AppLocalizations.of(context);
      final go = await _confirm(
        'location',
        l10n.locationAskTitle,
        l10n.locationAskBody,
      );
      if (go) await permission.request();
      // 권한을 받았으면 못 켠 위치 전송을 지금 켠다(앱을 다시 열지 않아도).
      if (mounted) {
        ref.read(locationReporterProvider.notifier).retryAfterPermission();
      }
    }
    final battery = ref.read(batteryOptimizationProvider);
    if (battery == null || await battery.isExempt() || !mounted) return;
    final l10n = AppLocalizations.of(context);
    final go = await _confirm(
      'battery',
      l10n.batteryAskTitle,
      l10n.batteryAskBody,
    );
    if (go) await battery.request();
  }

  /// [나중에] / [설정하기] 안내창. 키: `<id>-ask`, `<id>-allow`.
  Future<bool> _confirm(String id, String title, String body) async {
    final l10n = AppLocalizations.of(context);
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => RiderAlertDialog(
        key: ValueKey('$id-ask'),
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.later),
          ),
          TextButton(
            key: ValueKey('$id-allow'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.locationAskAllow),
          ),
        ],
      ),
    );
    return go ?? false;
  }

  @override
  Widget build(BuildContext context) {
    // 서버 지점 이름을 한 번 읽는다(카드·시트의 "PMart ○○지점").
    ref.watch(storeNamesProvider);
    final l10n = AppLocalizations.of(context);
    final duty = ref.watch(dutyProvider);
    final st = duty.value;
    final onDuty = st?.onDuty ?? false;
    final poll = ref.watch(offerPollerProvider);
    // 일반 배차모드는 홈에 AI 제안을 띄우지 않는다 — 배달리스트에서 골라 수락(원문 §2.2·2.4).
    final normalMode =
        ref.watch(dispatchModeProvider).value == DispatchMode.normal;
    final group = onDuty && !normalMode
        ? groupOffers(poll.list?.offers ?? const []).firstOrNull
        : null;
    final offer = group?.first;
    final active = watchActiveDeliveryIds(ref);
    final profile = ref.watch(profileProvider).value;

    // 배달 중이면 운행 종료 뒤에도 위치를 보낸다(3분 끊기면 위치 끊김 기록).
    // 보내는 동안은 상시 알림을 띄워 앱을 내려도 계속 보낸다.
    // 위치 공유 = 맡은 배송이 있음 또는 (운행 중·신규배차 켬). 둘 다 아니면 쉬는 중 — 표본·올리기·상시 알림을 멈춘다
    // (사용자 2026-11-19 "신규배차도 끄고 배송 중인 것도 없으면 위치 공유가 안 되어야", 백엔드 tracking 0.12.0).
    final reportLocation =
        active.isNotEmpty || (onDuty && (st?.newDispatchEnabled ?? false));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final wasActive = ref.read(locationReporterProvider);
      ref
          .read(locationReporterProvider.notifier)
          .setActive(
            reportLocation,
            notice: (
              title: l10n.locationNoticeTitle,
              text: l10n.locationNoticeText,
              channel: l10n.locationNoticeChannel,
            ),
            delivering: active.isNotEmpty,
          );
      if (reportLocation && !wasActive) unawaited(_askLocation());
    });
    // 제한이 풀리면 한 번 알린다(신규배차는 라이더가 다시 켠다).
    ref.listen(profileProvider.select((p) => p.value?.restriction), (
      prev,
      next,
    ) {
      if (prev != null && prev.restricted && next == Restriction.normal) {
        showRiderToast(context, l10n.restrictionLifted);
      }
    });

    final Widget bottom;
    if (st == null) {
      bottom = _Panel(
        child: duty is AsyncError
            ? RiderLoadError(
                compact: true,
                title: l10n.dutyLoadFailed,
                onRetry: () => ref.invalidate(dutyProvider),
              )
            : const LinearProgressIndicator(),
      );
    } else if (!st.onDuty) {
      bottom = _StartPanel(
        onStart: () =>
            changeDuty(context, ref, onDuty: true, newDispatch: true),
      );
    } else if (offer != null) {
      bottom = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (active.isNotEmpty)
            _ActiveSlim(deliveryId: active.first, count: active.length),
          _OfferCard(group: group!, mfcId: st.mfcId),
        ],
      );
    } else if (active.isNotEmpty) {
      // 진행 중 배송은 아래 시트(배송 화면)를 홈에 바로 띄운다(아래 Stack).
      bottom = const SizedBox.shrink();
    } else if (normalMode && st.newDispatchEnabled) {
      // 일반 배차모드: 배달리스트(대기)로 안내.
      bottom = GestureDetector(
        onTap: () => context.push('/deliveries'),
        child: _DarkNotice(
          key: const ValueKey('normal-mode-notice'),
          text: l10n.normalModeNotice,
        ),
      );
    } else if (!st.newDispatchEnabled || poll.stopped) {
      bottom = _DarkNotice(
        key: const ValueKey('polling-stopped'),
        text: st.newDispatchEnabled
            ? l10n.pollingStopped
            : l10n.newDispatchOffNotice,
      );
    } else if (poll.reconnecting) {
      // 조회 실패(503 등)는 "제안 없음"이 아니다. 위쪽 "찾고 있어요" 띠 자리에서 글자만 바뀐다 —
      // 전에는 안내가 사라지고 가운데에 알약이 떴다가 다시 바뀌어 홈 배치가 흔들렸다(2026-11-21 S23).
      bottom = const SizedBox.shrink();
    } else if (poll.list != null) {
      // 제안을 기다리는 중 — 아래 안내 대신 위쪽 "적합한 배달을 찾고 있어요" 띠(아래 Stack, 사용자 2026-11-25 레퍼런스).
      bottom = const SizedBox.shrink();
    } else {
      bottom = const SizedBox.shrink();
    }

    // 제안을 기다리는 동안(또는 그 사이 조회가 잠깐 실패하면) 위쪽 띠 — 사용자 2026-11-25 레퍼런스.
    final banner =
        bottom is SizedBox &&
        (poll.list != null || poll.reconnecting) &&
        offer == null &&
        active.isEmpty &&
        onDuty &&
        !normalMode &&
        (st?.newDispatchEnabled ?? false) &&
        !poll.stopped &&
        !(profile?.restriction.restricted ?? false);

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            // 핀·경로는 제안이 왔거나 진행 중인 배송이 있을 때만(운행 전·제안 없을 때는 지도만).
            child: RiderMap(
              showRoute: offer != null || active.isNotEmpty,
              // 핀 위 예정시간: 제안이면 픽업까지·도착 예상, 진행 중이면 픽업·전달 예정.
              route: switch ((offer, active.firstOrNull)) {
                (final OfferItem o, _) when o.deliveryId != null =>
                  offerMapRoute(
                    o,
                    ref.watch(tripInfoProvider(o.deliveryId!)).value,
                    st?.mfcId,
                  ),
                (null, final String id) => deliveryMapRoute(
                  ref.watch(tripInfoProvider(id)).value,
                  ref.watch(deliveryProvider(id)).value?.mfcId ?? st?.mfcId,
                  pickupStage: switch (ref.watch(deliveryProvider(id)).value) {
                    final d? => isPickupStage(d.state),
                    null => true,
                  },
                ),
                _ => null,
              },
            ),
          ),
          SafeArea(
            child: Padding(
              // 레퍼런스(사용자 2026-11-25)에서 잰 값: 위 15.6, 왼쪽 16, 오른쪽 18, 둥근 단추 지름 48·사이 27,
              // 신규배차 알약은 단추와 가운데를 맞춘다.
              padding: const EdgeInsets.fromLTRB(16, 15.6, 18, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  if (onDuty)
                    _NewDispatchPill(
                      enabled: st!.newDispatchEnabled,
                      onTap: () => changeDuty(
                        context,
                        ref,
                        onDuty: true,
                        newDispatch: !st.newDispatchEnabled,
                      ),
                    )
                  else
                    NotificationBell(
                      child: MapPill(
                        key: const ValueKey('my-page'),
                        onTap: () => context.push('/my'),
                        child: _PillLabel(
                          icon: Icons.person_outline,
                          text: l10n.myPage,
                        ),
                      ),
                    ),
                  const Spacer(),
                  if (onDuty) ...[
                    // 안 읽은 알림 수는 마이페이지 단추에(알림함은 마이페이지 "알림" 메뉴).
                    NotificationBell(
                      child: MapCircleButton(
                        key: const ValueKey('my-page'),
                        size: 48,
                        iconSize: 26,
                        icon: Icons.person_outline,
                        onTap: () => context.push('/my'),
                      ),
                    ),
                    const SizedBox(width: 27),
                    MapCircleButton(
                      key: const ValueKey('delivery-list'),
                      size: 48,
                      icon: Icons.format_list_bulleted,
                      child: const SortListIcon(),
                      onTap: () => context.push('/deliveries'),
                    ),
                  ] else
                    MapPill(
                      key: const ValueKey('delivery-list'),
                      onTap: () => context.push('/deliveries'),
                      child: _PillLabel(
                        icon: Icons.format_list_bulleted,
                        text: l10n.deliveryList,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (banner)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15.5, 71.5, 15.5, 0),
                child: poll.reconnecting
                    ? _SearchingBanner(
                        key: const ValueKey('reconnecting'),
                        text: l10n.reconnectingShort,
                        waiting: false,
                      )
                    : _SearchingBanner(
                        key: const ValueKey('offers-empty'),
                        text: l10n.searchingOffers,
                      ),
              ),
            ),
          if (profile != null && profile.restriction.restricted)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 68, 12, 0),
                child: _RestrictionBanner(profile: profile),
              ),
            ),
          // 위 띠에 이미 보이면 띄우지 않는다. 제안·배송 시트가 아래를 쓰고 있을 때만 알약을 띄운다.
          if (poll.reconnecting && !banner)
            SafeArea(
              child: Align(
                alignment: const Alignment(0, -0.72),
                child: Container(
                  key: const ValueKey('reconnecting'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xE6333333),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  // 조회 실패는 "제안 없음"이 아니다.
                  child: Text(
                    l10n.reconnecting,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                  ),
                ),
              ),
            ),
          Align(alignment: Alignment.bottomCenter, child: bottom),
          // 배차 수락 뒤(제안이 없을 때): 레퍼런스 image 14처럼 홈 지도 위에 배송 시트
          // (예정·장소·도움요청|길찾기, 누르거나 위로 올리면 배달 정보). 따로 "배달 정보 보기"를 누르지 않는다.
          if (offer == null && active.isNotEmpty)
            Positioned.fill(
              child: DeliveryScreen(
                key: ValueKey('delivery-${active.first}'),
                deliveryId: active.first,
                embedded: true,
              ),
            ),
          if (offer == null && active.length > 1)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.only(top: 68),
                child: Align(
                  alignment: Alignment.topCenter,
                  child: MapPill(
                    key: const ValueKey('active-count'),
                    onTap: () => context.push('/deliveries'),
                    child: _PillLabel(
                      icon: Icons.format_list_bulleted,
                      text: l10n.activeCount(active.length),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PillLabel extends StatelessWidget {
  const _PillLabel({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 22, color: RiderColors.ink),
      const SizedBox(width: 6),
      Text(
        text,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: RiderColors.ink,
        ),
      ),
    ],
  );
}

/// 제안을 기다리는 동안 위쪽 띠(레퍼런스 사용자 2026-11-25): 주 색 → 파랑 번짐 바탕, 흰 굵은 글자,
/// 오른쪽에 차례로 밝아지는 점 다섯 개.
class _SearchingBanner extends StatefulWidget {
  const _SearchingBanner({super.key, required this.text, this.waiting = true});

  final String text;

  /// false 면(연결 확인 중) 회색 바탕·점 없음 — 같은 자리·같은 높이에서 글자만 바뀐다.
  final bool waiting;

  @override
  State<_SearchingBanner> createState() => _SearchingBannerState();
}

class _SearchingBannerState extends State<_SearchingBanner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _dots = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _dots.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 31,
      padding: const EdgeInsets.fromLTRB(12.2, 0, 21, 0),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        color: widget.waiting ? null : const Color(0xE6333333),
        gradient: widget.waiting
            ? LinearGradient(
                colors: [
                  RiderColors.primary.withValues(alpha: 0.92),
                  RiderColors.drop.withValues(alpha: 0.92),
                ],
              )
            : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              widget.text,
              style: const TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
          if (widget.waiting)
            AnimatedBuilder(
              animation: _dots,
              builder: (context, _) => Row(
                children: [
                  for (var i = 0; i < 5; i++)
                    Container(
                      width: 2.6,
                      height: 2.6,
                      margin: const EdgeInsets.only(left: 5.2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(
                          alpha: (_dots.value * 5).floor() % 5 == i ? 1 : 0.45,
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

/// 신규배차 켜기/끄기. 끄면 새 제안만 멈추고 진행 중인 배송은 그대로다.
class _NewDispatchPill extends StatelessWidget {
  const _NewDispatchPill({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // 레퍼런스: 신규배차 알약은 둥근 단추보다 약 5 위에 있다.
    return Transform.translate(
      offset: const Offset(0, -4.9),
      child: MapPill(
        key: const ValueKey('new-dispatch'),
        // 레퍼런스 알약 높이 43·글자 앞 14.9(2026-11-25 잰 값)
        padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
        onTap: onTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.newDispatch,
              style: TextStyle(
                fontSize: 14.3,
                fontWeight: FontWeight.w700,
                color: enabled ? RiderColors.primary : RiderColors.ink,
              ),
            ),
            const SizedBox(width: 8),
            MiniSwitch(on: enabled),
          ],
        ),
      ),
    );
  }
}

/// 표시만 하는 작은 토글(누르는 곳은 바깥 알약).
class MiniSwitch extends StatelessWidget {
  const MiniSwitch({super.key, required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
    duration: const Duration(milliseconds: 150),
    width: 27,
    height: 15.5,
    padding: const EdgeInsets.all(2),
    alignment: on ? Alignment.centerRight : Alignment.centerLeft,
    decoration: BoxDecoration(
      color: on ? RiderColors.primary : const Color(0xFF555555),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Container(
      width: 11.5,
      height: 11.5,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
      ),
    ),
  );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    child: SafeArea(
      top: false,
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    ),
  );
}

class _StartPanel extends ConsumerWidget {
  const _StartPanel({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return _Panel(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Text(
            riderGreetingText(
              ref.watch(profileProvider).value?.name,
              l10n.riderGreetingNamed,
              l10n.riderGreeting,
            ),
            key: const ValueKey('rider-greeting'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.safetyHelmet,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: RiderColors.ink),
          ),
          const SizedBox(height: 20),
          RiderButton(
            key: const ValueKey('start-duty'),
            label: l10n.startDuty,
            onPressed: onStart,
          ),
        ],
      ),
    );
  }
}

class _DarkNotice extends StatelessWidget {
  const _DarkNotice({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 22),
      decoration: BoxDecoration(
        color: const Color(0xE6333333),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          height: 1.5,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}

String? modeText(AppLocalizations l10n, DeliveryMode? m) => switch (m) {
  DeliveryMode.single => l10n.modeSingle,
  DeliveryMode.bundled => l10n.modeBundled,
  DeliveryMode.scheduled => l10n.modeScheduled,
  null => null,
};

/// 배차 제안(지도 아래) — 사용자 2026-11-25 레퍼런스: 옆으로 넘기는 구간 카드(묶음이면 고객마다 한 장,
/// 다음 카드가 오른쪽에 살짝 보인다) · 흰 판 위 "총 배달료" · [모두 거절][n건 모두 수락 · n초].
/// 알뜰배달 묶음은 하나에 응답하면 묶음 전체에 적용된다.
class _OfferCard extends ConsumerWidget {
  const _OfferCard({required this.group, required this.mfcId});

  final List<OfferItem> group;
  final String? mfcId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final offer = group.first;
    final fees = group.map((o) => o.estimatedFee);
    final fee = fees.contains(null)
        ? null
        : fees.whereType<int>().fold<int>(0, (a, b) => a + b);
    final width = MediaQuery.sizeOf(context).width;
    // 카드 폭 = 화면의 80%(레퍼런스 299/375), 다음 카드가 9 사이를 두고 보인다.
    final cardWidth = group.length > 1 ? width * 0.8 : width - 38;
    return Column(
      key: ValueKey('offer-${offer.offerId}'),
      mainAxisSize: MainAxisSize.min,
      children: [
        // 카드 높이는 147 이상(레퍼런스에서 잰 값 2026-11-25) — 글자가 크면 카드가 늘어난다. 묶음 카드끼리 높이를 맞춘다.
        Stack(
          children: [
            // 카드 아래 49 뒤로 흰 판이 깔린다.
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              height: 49,
              child: ColoredBox(color: Colors.white),
            ),
            SingleChildScrollView(
              key: const ValueKey('offer-cards'),
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(19, 4, 19, 8),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, o) in group.indexed) ...[
                      if (i > 0) const SizedBox(width: 6),
                      ConstrainedBox(
                        constraints: BoxConstraints.tightFor(width: cardWidth)
                            .copyWith(minHeight: 147),
                        child: _StopCard(
                          offer: o,
                          mfcId: mfcId,
                          detailKey: i == 0
                              ? ValueKey('offer-detail-${offer.offerId}')
                              : null,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
        ColoredBox(
          color: Colors.white,
          child: SafeArea(
            top: false,
            // 아래 시스템 막대가 없어도 레퍼런스처럼 버튼 아래 34 를 비운다(흰 판 높이를 맞춤).
            minimum: const EdgeInsets.only(bottom: 34),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(15.5, 5.2, 15.5, 14),
              child: Column(
                children: [
                  Text(
                    switch (fee) {
                      final int f => l10n.offerTotalFee(formatKrw(f)),
                      null => l10n.offerFeeUnknown,
                    },
                    key: const ValueKey('offer-total'),
                    style: const TextStyle(
                      fontSize: 22.5,
                      fontWeight: FontWeight.w700,
                      color: RiderColors.ink,
                    ),
                  ),
                  const SizedBox(height: 13),
                  OfferResponseBar(offer: offer, count: group.length),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 구간 카드 한 장: [꼬리표] ··· › / 픽업지 · 전달지 · 배달료(주황).
class _StopCard extends StatelessWidget {
  const _StopCard({required this.offer, required this.mfcId, this.detailKey});

  final OfferItem offer;
  final String? mfcId;
  final Key? detailKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final rec = offer.recovery;
    final store = storeText(l10n, offer.mfcId ?? mfcId);
    final tag = rec != null
        ? recoveryPurposeText(l10n, rec)
        : offer.bundleSize != null && offer.bundleSize! > 1
        ? l10n.stopLabel(offer.stopSequence ?? 0)
        : modeText(l10n, offer.mode);
    return Material(
      color: Colors.white,
      // 레퍼런스 카드: 또렷한 그림자 + 둥글기 8
      elevation: 4,
      shadowColor: Colors.black38,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        key: detailKey,
        borderRadius: BorderRadius.circular(8),
        onTap: () => context.push('/offers/${offer.offerId}'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(15, 12.4, 12.4, 15.2),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 19.7,
                child: Row(
                  children: [
                    if (tag != null)
                      Container(
                        key: ValueKey(
                          rec != null ? 'offer-recovery' : 'offer-mode',
                        ),
                        height: 19.7,
                        padding: const EdgeInsets.fromLTRB(4.7, 0, 4, 0),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: rec != null
                              ? RiderColors.danger.withValues(alpha: 0.10)
                              : const Color(0xFFEDF7FF),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (rec == null) ...[
                              const Icon(
                                Icons.add_location,
                                size: 16,
                                color: Color(0xFF266CC2),
                              ),
                              const SizedBox(width: 2),
                            ],
                            Text(
                              tag,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: rec != null
                                    ? RiderColors.danger
                                    : const Color(0xFF266CC2),
                              ),
                            ),
                          ],
                        ),
                      ),
                    const Spacer(),
                    const SizedBox(
                      width: 26,
                      child: OverflowBox(
                        maxHeight: 26,
                        child: Icon(
                          Icons.chevron_right,
                          size: 26,
                          color: Color(0xFF8B8B8B),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 7.5),
              _PlaceLine(
                label: rec != null ? l10n.pinRecovery : l10n.pickupPlace,
                value: rec != null
                    ? offer.dropAreaLabel ?? l10n.dropAreaUnknown
                    : store,
              ),
              const SizedBox(height: 0.9),
              _PlaceLine(
                label: rec != null ? l10n.pinReturn : l10n.dropPlace,
                value: rec != null
                    ? store
                    : offer.dropAreaLabel ?? l10n.dropAreaUnknown,
                maxLines: 2,
              ),
              const SizedBox(height: 0.9),
              _PlaceLine(
                label: l10n.deliveryFee,
                value: switch (offer.estimatedFee) {
                  final f? => formatKrw(f),
                  null => l10n.offerFeeUnknown,
                },
                accent: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 계정 제한 안내 띠. 사유는 보이지 않는다(운영자 기록).
class _RestrictionBanner extends StatelessWidget {
  const _RestrictionBanner({required this.profile});

  final RiderProfileView profile;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final until = profile.restrictedUntil;
    return Material(
      key: const ValueKey('restriction-banner'),
      color: RiderColors.danger,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            const Icon(Icons.block, color: Colors.white, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                [
                  switch (profile.restriction) {
                    Restriction.dispatchRestricted => l10n.restrictDispatch,
                    Restriction.suspended => l10n.restrictSuspended,
                    Restriction.terminated => l10n.restrictTerminated,
                    Restriction.normal => '',
                  },
                  until == null
                      ? l10n.restrictForever
                      : l10n.restrictUntil(formatSeoulDateTime(until)),
                ].join(' · '),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            // 계정 제한 소명(rider 0.15.0) — 결정은 라이더 운영, 결과는 알림함
            TextButton(
              key: const ValueKey('appeal-restriction'),
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                side: const BorderSide(color: Colors.white70),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onPressed: () =>
                  context.push(appealNewRoute(AppealTarget.restriction)),
              child: Text(
                l10n.appealRestrictionButton,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlaceLine extends StatelessWidget {
  const _PlaceLine({
    required this.label,
    required this.value,
    this.accent = false,
    this.maxLines = 1,
  });

  final String label;
  final String value;
  final int maxLines;

  /// 배달료 — 주황 굵게.
  final bool accent;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(
        width: 47.5,
        child: Text(
          label,
          style: const TextStyle(fontSize: 16, color: RiderColors.hint),
        ),
      ),
      Expanded(
        child: Text(
          value,
          maxLines: maxLines,
          overflow: TextOverflow.ellipsis,
          // 배달료는 주황 보통 굵기 15(레퍼런스에서 잰 값).
          style: TextStyle(
            fontSize: accent ? 15 : 16,
            fontWeight: accent ? FontWeight.w500 : FontWeight.w400,
            color: accent ? const Color(0xFFE8821E) : RiderColors.ink,
          ),
        ),
      ),
    ],
  );
}

/// 제안 카드 위에 얹는 진행 중 배송 한 줄.
class _ActiveSlim extends StatelessWidget {
  const _ActiveSlim({required this.deliveryId, required this.count});

  final String deliveryId;
  final int count;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Card(
      key: ValueKey('delivery-$deliveryId'),
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      color: Colors.white,
      surfaceTintColor: Colors.white,
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      child: InkWell(
        onTap: () => context.push('/deliveries/$deliveryId'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.activeCount(count),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right, color: RiderColors.sub),
            ],
          ),
        ),
      ),
    );
  }
}
