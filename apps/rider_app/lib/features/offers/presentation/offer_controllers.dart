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
  (_) =>
      MockOfferRepository(startOnDuty: false, mode: DispatchMode.aiRecommended),
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

  @override
  OfferPollState build() {
    ref.onDispose(() => _timer?.cancel());
    return const OfferPollState();
  }

  Future<void> refreshNow() async {
    _timer?.cancel();
    if (_fetching) return;
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
            mfcId: current.mfcId,
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
    if (!state.contains(deliveryId)) state = [...state, deliveryId];
  }

  void remove(String deliveryId) => state = [...state]..remove(deliveryId);
}

/// 제안 응답 1회. 판정을 받지 못하면 같은 키로만 다시 보낸다(새 수락이 아니다).
final offerResponderProvider = Provider<OfferResponder>(OfferResponder.new);

class OfferResponder {
  OfferResponder(this._ref);

  final Ref _ref;
  final _pendingKeys = <String, IdempotencyKey>{};

  Future<OfferOutcome> respond(
    OfferItem offer, {
    required bool accept,
    RejectReason? reason,
  }) async {
    final key = _pendingKeys[offer.offerId] ??= IdempotencyKey.generate();
    final repo = _ref.read(offerRepositoryProvider);
    OfferOutcome outcome = const OfferUnknown();
    for (var i = 0; i < 3 && outcome is OfferUnknown; i++) {
      outcome = await repo.respond(
        offer.offerId,
        accept: accept,
        reason: reason,
        key: key,
      );
    }
    if (outcome is! OfferUnknown) _pendingKeys.remove(offer.offerId);
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
    if (outcome is! OfferUnknown) {
      unawaited(_ref.read(offerPollerProvider.notifier).refreshNow());
    }
    return outcome;
  }
}
