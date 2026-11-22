import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../data/mock_offer_repository.dart';
import '../data/delivery_list_repository.dart';
import '../data/offer_repository.dart';
import '../domain/offer_list.dart';

/// 앱 목 모드의 서버 흉내. 운행 종료에서 시작하고, 첫 가입 기본값(AI 추천 배차)을 쓴다.
final mockOfferRepositoryProvider = Provider<MockOfferRepository>(
  (_) => MockOfferRepository(
    startOnDuty: false,
    mode: DispatchMode.aiRecommended,
    demoBundle: true,
    demoManyBundles: true,
    demoSingles: true,
  ),
);

final offerRepositoryProvider = Provider<OfferRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(mockOfferRepositoryProvider),
    PmartEnv.local => ApiOfferRepository(ref.watch(dioProvider)),
  },
);

/// 배달리스트(일반 배차모드).
final deliveryListRepositoryProvider = Provider<DeliveryListRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockDeliveryListRepository(
      onAssigned: (id) =>
          ref.read(mockOfferRepositoryProvider).assignedDeliveries.add(id),
    ),
    PmartEnv.local => ApiDeliveryListRepository(ref.watch(dioProvider)),
  },
);

final waitingListProvider = FutureProvider.autoDispose<WaitingList>(
  (ref) => ref.watch(deliveryListRepositoryProvider).list(),
);

final dutyRepositoryProvider = Provider<DutyRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(mockOfferRepositoryProvider),
    PmartEnv.local => ApiDutyRepository(ref.watch(dioProvider)),
  },
);

/// 단말의 단조 경과 시간. 남은 시간 표시는 벽시계가 아니라 이것으로 줄인다. 테스트에서 바꾼다.
final monotonicProvider = Provider<Duration Function()>((ref) {
  final sw = Stopwatch()..start();
  return () => sw.elapsed;
});

/// 조회 실패 재시도 상한(지수 백오프). 정상 간격은 서버 `pollAfterSec` 만 따른다.
final offerBackoffCapProvider = Provider<Duration>(
  (_) => const Duration(seconds: 30),
);

@immutable
class OfferPollState {
  const OfferPollState({
    this.list,
    this.fetchedAt = Duration.zero,
    this.reconnecting = false,
    this.failures = 0,
  });

  /// 마지막으로 받은 서버 목록. 조회가 실패해도 지우지 않는다("제안 없음"으로 바꾸지 않음).
  final OfferList? list;

  /// [list] 를 받은 시점의 단조 시간.
  final Duration fetchedAt;

  /// 조회가 실패해 재시도 중("연결 확인 중").
  final bool reconnecting;
  final int failures;

  /// 서버가 폴링 중지(pollAfterSec null)를 알렸다.
  bool get stopped => list != null && list!.pollAfter == null && !reconnecting;
}

final offerPollerProvider = NotifierProvider<OfferPoller, OfferPollState>(
  OfferPoller.new,
);

/// 제안 폴링. 간격은 서버 `pollAfterSec`, null 이면 멈춘다. 앱 실행·포그라운드 복귀·운행 시작·
/// 신규배차 ON 때는 간격과 상관없이 [refreshNow].
class OfferPoller extends Notifier<OfferPollState> {
  Timer? _timer;
  bool _fetching = false;

  /// 읽는 중에 다시 읽기를 부탁받았다 — 끝나면 한 번 더(수락 직후 새로 읽기가 버려지지 않게).
  bool _again = false;

  @override
  OfferPollState build() {
    ref.onDispose(() => _timer?.cancel());
    return const OfferPollState();
  }

  Future<void> refreshNow() async {
    _timer?.cancel();
    if (_fetching) {
      _again = true;
      return;
    }
    _fetching = true;
    try {
      final list = await ref.read(offerRepositoryProvider).activeOffers();
      if (!ref.mounted) return;
      state = OfferPollState(
        list: list,
        fetchedAt: ref.read(monotonicProvider)(),
      );
      final next = list.pollAfter;
      if (next != null) _timer = Timer(next, refreshNow);
    } on PmartFailure {
      if (!ref.mounted) return;
      final failures = state.failures + 1;
      final cap = ref.read(offerBackoffCapProvider);
      final wait = Duration(
        seconds: math.min(cap.inSeconds, math.pow(2, failures).toInt()),
      );
      state = OfferPollState(
        list: state.list,
        fetchedAt: state.fetchedAt,
        reconnecting: true,
        failures: failures,
      );
      _timer = Timer(wait, refreshNow);
    } finally {
      _fetching = false;
    }
    if (_again && ref.mounted) {
      _again = false;
      await refreshNow();
    }
  }

  /// 서버 값에서 출발해 단조 경과로 줄인 남은 시간. 0 이어도 만료 확정이 아니다.
  int remainingFor(OfferItem offer) {
    final base = offer.remainingSec;
    if (base == null) return 0;
    final passed = (ref.read(monotonicProvider)() - state.fetchedAt).inSeconds;
    return math.max(0, base - passed);
  }

  void stop() => _timer?.cancel();
}

// ---------------------------------------------------------------------------
// 운행 상태

final dutyProvider = AsyncNotifierProvider<DutyController, OperatingState>(
  DutyController.new,
);

/// [DutyController.change] 가 계정 제한(403)일 때 돌려주는 값.
const restrictedCode = 'RIDER_RESTRICTED';

class DutyController extends AsyncNotifier<OperatingState> {
  @override
  Future<OperatingState> build() => ref.watch(dutyRepositoryProvider).state();

  /// 실패 code 를 돌려준다(null 이면 반영됨). 바뀐 뒤 제안을 즉시 다시 조회한다.
  Future<String?> change({
    required bool onDuty,
    required bool newDispatch,
  }) async {
    final current = state.value;
    if (current == null) return null;
    try {
      final next = await ref
          .read(dutyRepositoryProvider)
          .setState(
            onDuty: onDuty,
            newDispatch: newDispatch,
            expectedVersion: current.version,
            // 운행을 새로 시작할 때는 비워 보낸다 — 서버가 배달 지역(한 곳)으로 정한다. 쉬는 동안 남은 mfcId 는
            // 예전 운행 지점이라, 마이페이지에서 배달 지역을 바꾼 뒤에는 그대로 보내면 MFC_NOT_IN_AREAS 로 거절된다(2026-11-23).
            mfcId: current.onDuty ? current.mfcId : null,
            key: IdempotencyKey.generate(),
          );
      if (!ref.mounted) return null;
      state = AsyncData(next);
      await ref.read(offerPollerProvider.notifier).refreshNow();
      return null;
    } on ProblemFailure catch (f) {
      ref.invalidateSelf();
      // 403 = 계정 제한(신규배차 제한이면 신규배차 ON, 일시 중지·계약 종료면 운행 시작이 막힌다).
      if (f.problem.status == 403) return restrictedCode;
      return f.problem.code;
    } on PmartFailure {
      ref.invalidateSelf();
      return ProblemCode.unknown;
    }
  }
}

final dispatchModeProvider = FutureProvider<DispatchMode>(
  (ref) => ref.watch(dutyRepositoryProvider).dispatchMode(),
);

final dispatchSettingsProvider =
    AsyncNotifierProvider<DispatchSettingsController, DispatchSettingsView>(
      DispatchSettingsController.new,
    );

/// 배차 설정(모드·하나씩 배달하기). 서버가 돌려준 값만 화면에 반영한다.
class DispatchSettingsController extends AsyncNotifier<DispatchSettingsView> {
  @override
  Future<DispatchSettingsView> build() =>
      ref.watch(dutyRepositoryProvider).settings();

  /// 실패하면 false(서버 값으로 다시 맞춘다).
  Future<bool> change({DispatchMode? mode, bool? oneAtATime}) async {
    final current = state.value;
    if (current == null) return false;
    try {
      final next = await ref
          .read(dutyRepositoryProvider)
          .setSettings(
            mode: mode ?? current.mode,
            oneAtATime: oneAtATime ?? current.oneAtATime,
            expectedVersion: current.version,
            key: IdempotencyKey.generate(),
          );
      if (!ref.mounted) return true;
      state = AsyncData(next);
      ref.invalidate(dispatchModeProvider);
      return true;
    } on PmartFailure {
      ref.invalidateSelf();
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// 제안 응답

/// 수락된 배송(이번 실행 동안). 배송 수행 화면 진입점이다.
final assignedDeliveriesProvider =
    NotifierProvider<AssignedDeliveries, List<String>>(AssignedDeliveries.new);

class AssignedDeliveries extends Notifier<List<String>> {
  @override
  List<String> build() => const [];

  void add(String deliveryId) {
    // 다시 내게 배정됐다(운영자 재배정 등) — 내려놓은 표시를 지운다.
    ref.read(releasedDeliveriesProvider.notifier).forget(deliveryId);
    if (!state.contains(deliveryId)) state = [...state, deliveryId];
  }

  void remove(String deliveryId) => state = [...state]..remove(deliveryId);
}

/// 서버가 "이제 내 배송이 아니다"라고 확정한 배송(이번 실행 동안) — 진행 중 목록에서 뺀다.
/// - 배차 취소가 APPLIED 로 끝남(dispatch 확정).
/// 배차 취소 직후에는 수행 서비스가 아직 반영 전이라 `GET /riders/me/deliveries` 가 그 배송을 한동안 더 준다 —
/// 그 사이 다시 읽은 목록에 남아 "진행 중"으로 계속 보이던 문제(사용자 2026-11-19).
final releasedDeliveriesProvider =
    NotifierProvider<ReleasedDeliveries, Set<String>>(ReleasedDeliveries.new);

class ReleasedDeliveries extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void add(String deliveryId) {
    if (!state.contains(deliveryId)) state = {...state, deliveryId};
  }

  void forget(String deliveryId) {
    if (state.contains(deliveryId)) state = {...state}..remove(deliveryId);
  }
}

/// 제안 응답 1회. 판정을 받지 못하면 같은 키로만 다시 보낸다(새 수락이 아니다).
final offerResponderProvider = Provider<OfferResponder>(OfferResponder.new);

class OfferResponder {
  OfferResponder(
    this._ref, {
    this.retryDelay = const Duration(milliseconds: 600),
  });

  /// 결과 불명 재전송 간격(같은 키, 점점 길게).
  final Duration retryDelay;

  final Ref _ref;
  final _pendingKeys = <String, IdempotencyKey>{};
  final _inFlight = <String, Future<OfferOutcome>>{};

  /// 같은 제안·같은 동작을 보내는 중이면 그 결과를 같이 기다린다 — 버튼이 다시 그려지기 전 같은 프레임의 연타가
  /// 요청을 두 번 보내던 것(2026-11-20 S23 알뜰 묶음 수락 3연타 → POST 2번).
  Future<OfferOutcome> respond(
    OfferItem offer, {
    required bool accept,
    RejectReason? reason,
  }) {
    // 키는 제안 + 동작마다 — 수락 결과를 모르는 채로 거절을 누르면 같은 키에 다른 본문이 가지 않게.
    final slot = '${offer.offerId}:${accept ? 'A' : 'R'}';
    return _inFlight[slot] ??=
        _respond(offer, slot, accept: accept, reason: reason).whenComplete(() {
          _inFlight.remove(slot); // 화살표로 쓰면 지운 Future 를 돌려줘 자기 자신을 기다린다
        });
  }

  Future<OfferOutcome> _respond(
    OfferItem offer,
    String slot, {
    required bool accept,
    RejectReason? reason,
  }) async {
    final key = _pendingKeys[slot] ??= IdempotencyKey.generate();
    final repo = _ref.read(offerRepositoryProvider);
    OfferOutcome outcome = const OfferUnknown();
    for (var i = 0; i < 3 && outcome is OfferUnknown; i++) {
      if (i > 0) await Future<void>.delayed(retryDelay * i);
      try {
        outcome = await repo.respond(
          offer.offerId,
          accept: accept,
          reason: reason,
          key: key,
        );
      } on ProblemFailure catch (f) {
        // 판정이 아니라 거절된 요청(없음·상태 다름·권한) — 다음 누름은 새 키.
        outcome = OfferFailed(f.problem.code);
      } on PmartFailure {
        outcome = const OfferFailed(null);
      }
    }
    if (outcome is! OfferUnknown) {
      _pendingKeys
        ..remove('${offer.offerId}:A')
        ..remove('${offer.offerId}:R');
    }
    if (outcome case OfferAssigned(:final deliveryId?)) {
      final assigned = _ref.read(assignedDeliveriesProvider.notifier)
        ..add(deliveryId);
      // 묶음은 하나에만 응답해도 묶음 전체가 배정된다.
      final bundle = offer.bundleId;
      if (bundle != null) {
        for (final o
            in _ref.read(offerPollerProvider).list?.offers ??
                const <OfferItem>[]) {
          if (o.bundleId == bundle && o.deliveryId != null) {
            assigned.add(o.deliveryId!);
          }
        }
      }
    }
    // 결과를 모를 때도 다시 읽는다 — 서버가 이미 배정했으면 제안이 빠지고 진행 중 배송에 나타난다.
    unawaited(_ref.read(offerPollerProvider.notifier).refreshNow());
    return outcome;
  }
}
