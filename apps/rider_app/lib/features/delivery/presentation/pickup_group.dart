import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/delivery.dart';

/// 같은 가게에서 함께 픽업하고, 정해진 순서로 고객에게 전달한다(사용자 2026-11-23
/// "가게가 하나고 알뜰배달 2건이면 가게는 한 번에 가서 2개 동시에 픽업하고 1번째 고객 - 2번째 고객 전달").
///
/// 서버 명령은 배송마다 따로다(execution — 묶음 명령은 없다). 앱이 같은 가게의 픽업 전 배송을 한 번에 보낸다:
/// 가게 도착 한 번 → 모두 가게 도착, QR 화면 하나에서 모든 포장 → 모두 인계 확정되면 모두 픽업.
/// 고객 방문 순서는 배송의 `stopSequence`(execution 0.40.0 — 배정 값 그대로)를 먼저 쓴다.
/// 그 값이 없는 서버면 수락할 때 받아 둔 제안의 `stopSequence`, 그것도 없으면 배정 목록 순서.

/// 수락할 때 받아 둔 묶음 안 방문 순서(배송 ID → 1부터). 이번 실행 동안.
final bundleStopsProvider = NotifierProvider<BundleStops, Map<String, int>>(
  BundleStops.new,
);

class BundleStops extends Notifier<Map<String, int>> {
  @override
  Map<String, int> build() => const {};

  void put(String deliveryId, int stop) {
    if (state[deliveryId] == stop) return;
    state = {...state, deliveryId: stop};
  }
}

bool _pickupStage(ExecutionState s) =>
    s == ExecutionState.assigned || s == ExecutionState.arrivedAtStore;

bool _toCustomer(ExecutionState s) =>
    s == ExecutionState.pickedUp || s == ExecutionState.arrivedAtCustomer;

/// [d] 와 같은 가게에서 아직 픽업 전인 내 배송(자기 포함, 방문 순서대로). 회수·반납 배송은 묶지 않는다.
/// [active] 를 못 읽었으면 [d] 하나.
List<DeliveryView> pickupGroup(
  DeliveryView d,
  List<DeliveryView>? active,
  Map<String, int> stops,
) {
  if (d.isRecovery || d.mfcId == null || !_pickupStage(d.state)) return [d];
  final others = (active ?? const <DeliveryView>[]).where(
    (o) =>
        o.deliveryId != d.deliveryId &&
        !o.isRecovery &&
        o.mfcId == d.mfcId &&
        _pickupStage(o.state),
  );
  return orderByStop([d, ...others], active, stops);
}

/// 방문 순서대로: 받아 둔 `stopSequence` 가 앞, 없으면 진행 중 목록(배정) 순서.
List<DeliveryView> orderByStop(
  List<DeliveryView> list,
  List<DeliveryView>? active,
  Map<String, int> stops,
) {
  final order = [
    for (final a in active ?? const <DeliveryView>[]) a.deliveryId,
  ];
  int rank(DeliveryView v) {
    final i = order.indexOf(v.deliveryId);
    return i < 0 ? 999 : i;
  }

  return [...list]..sort((a, b) {
    final sa = a.stopSequence ?? stops[a.deliveryId];
    final sb = b.stopSequence ?? stops[b.deliveryId];
    if (sa != null && sb != null && sa != sb) return sa.compareTo(sb);
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    return rank(a).compareTo(rank(b));
  });
}

/// 픽업을 마친 뒤 먼저 갈 고객 — 들고 있는 배송(픽업 뒤 ~ 전달 전) 가운데 방문 순서가 가장 앞.
/// [exceptId] 는 빼고 본다(방금 전달을 끝낸 배송). 없으면 null.
DeliveryView? nextCustomerStop(
  List<DeliveryView>? active,
  Map<String, int> stops, {
  String? exceptId,
}) {
  final carrying = (active ?? const <DeliveryView>[])
      .where(
        (o) =>
            o.deliveryId != exceptId && !o.isRecovery && _toCustomer(o.state),
      )
      .toList();
  if (carrying.isEmpty) return null;
  return orderByStop(carrying, active, stops).first;
}
