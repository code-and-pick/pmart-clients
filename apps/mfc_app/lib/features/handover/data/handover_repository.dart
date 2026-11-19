import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_tracking/pmart_api_delivery_tracking.dart'
    as trk;
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart'
    as api;
import 'package:pmart_api_rider/pmart_api_rider.dart' as rider;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../../packing/domain/packing.dart' show FenceState, PackageState;
import '../domain/handover.dart';

abstract interface class HandoverRepository {
  /// `GET /packages?mfcId=&checkRequired=true` — 점원 확인이 필요한 포장(허가 만료 오래된 순).
  Future<HandoverCheckList> toCheck(String mfcId);

  /// `GET /packages/{id}/handover-resolution`.
  Future<HandoverView> resolution(String packageId);

  /// `POST /packages/{id}/handover-checks`. 같은 키는 같은 결과.
  Future<CheckOutcome> check(
    String packageId,
    HandoverCheck result, {
    String? note,
    required IdempotencyKey key,
  });

  /// `GET /deliveries/{id}/eta` 의 픽업 구간.
  Future<PickupEtaView> pickupEta(String deliveryId);

  /// 라이더 화면 표기 묶음 조회(50개까지). 모르는 ID 는 빠진다.
  Future<Map<String, RiderLabel>> riderLabels(List<String> riderIds);
}

final class ApiHandoverRepository implements HandoverRepository {
  ApiHandoverRepository(Dio dio)
    : _handovers = api.PmartApiMfcFulfillment(dio: dio).getHandoversApi(),
      _eta = trk.PmartApiDeliveryTracking(dio: dio).getEtaApi(),
      _riders = rider.PmartApiRider(dio: dio).getOperatorApi();

  final api.HandoversApi _handovers;
  final trk.EtaApi _eta;
  final rider.OperatorApi _riders;

  @override
  Future<Map<String, RiderLabel>> riderLabels(List<String> riderIds) async {
    if (riderIds.isEmpty) return const {};
    // 서버는 한 번에 50개까지 — 넘으면 50개씩 나눠 묻는다(목록 뒤쪽 라이더가 "라이더"로만 보이지 않게).
    final out = <String, RiderLabel>{};
    for (var i = 0; i < riderIds.length; i += 50) {
      final chunk = riderIds.skip(i).take(50).join(',');
      final res = await pmartGuard(
        () => _riders.getRiderDisplayNames(riderIds: chunk),
      );
      final items =
          res.data?.items ?? (throw const ContractViolationFailure('items 없음'));
      for (final r in items) {
        out[r.riderId] = RiderLabel(
          riderNumber: r.riderNumber,
          nameMasked: r.nameMasked,
        );
      }
    }
    return out;
  }

  @override
  Future<HandoverCheckList> toCheck(String mfcId) async {
    final res = await pmartGuard(
      () => _handovers.listPackagesToCheck(mfcId: mfcId, checkRequired: true),
    );
    final body = res.data ?? (throw const ContractViolationFailure('목록 본문 없음'));
    final items =
        body.items ?? (throw const ContractViolationFailure('items 없음'));
    return HandoverCheckList(
      items: [for (final r in items) handoverFromContract(r)],
      fresh:
          body.asOf?.freshness ==
          api.ListTasks200ResponseAsOfFreshnessEnum.CURRENT,
    );
  }

  @override
  Future<HandoverView> resolution(String packageId) async {
    final res = await pmartGuard(
      () => _handovers.getHandoverResolution(packageId: packageId),
    );
    return handoverFromContract(
      res.data ?? (throw const ContractViolationFailure('판정 본문 없음')),
    );
  }

  @override
  Future<CheckOutcome> check(
    String packageId,
    HandoverCheck result, {
    String? note,
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _handovers.checkPackageHandover(
          packageId: packageId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          checkPackageHandoverRequest: api.CheckPackageHandoverRequest(
            result: switch (result) {
              HandoverCheck.atStation =>
                api.CheckPackageHandoverRequestResultEnum.AT_STATION,
              HandoverCheck.takenByRider =>
                api.CheckPackageHandoverRequestResultEnum.TAKEN_BY_RIDER,
            },
            note: note,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      final r = res.data;
      if (r == null) return const CheckUnknown();
      return CheckDone(handoverFromContract(r));
    } on PmartFailure catch (f) {
      return checkFailureToOutcome(f);
    }
  }

  @override
  Future<PickupEtaView> pickupEta(String deliveryId) async {
    final res = await pmartGuard(
      () => _eta.getDeliveryEta(deliveryId: deliveryId),
    );
    return etaFromContract(
      res.data ?? (throw const ContractViolationFailure('ETA 본문 없음')),
    );
  }
}

CheckOutcome checkFailureToOutcome(PmartFailure f) => switch (f) {
  UnknownResultFailure() => const CheckUnknown(),
  ProblemFailure(:final problem)
      when problem.code == ProblemCode.idempotencyConflict &&
          problem.retryable =>
    const CheckUnknown(),
  ProblemFailure(:final problem) => CheckRejected(problem.code),
  _ => throw f,
};

HandoverView handoverFromContract(api.HandoverResolution r) => HandoverView(
  packageId:
      r.packageId ?? (throw const ContractViolationFailure('packageId 없음')),
  packageVersion: r.packageVersion,
  packageState: switch (r.packageState?.value) {
    'OPEN' => PackageState.open,
    'SEALED' => PackageState.sealed,
    'HANDED_OVER' => PackageState.handedOver,
    'INVALIDATED' => PackageState.invalidated,
    'VOIDED' => PackageState.voided,
    _ => PackageState.unknown,
  },
  verdict: switch (r.verdict?.value) {
    'READY' => HandoverVerdict.ready,
    'STOPPED' => HandoverVerdict.stopped,
    'HANDOVER_IN_PROGRESS' => HandoverVerdict.inProgress,
    'HANDED_OVER' => HandoverVerdict.handedOver,
    _ => HandoverVerdict.unknown,
  },
  fence: switch (r.fence?.state?.value) {
    null || 'NONE' => FenceState.none,
    'HANDOVER_IN_PROGRESS' => FenceState.inProgress,
    'COMMITTED' => FenceState.committed,
    'EXPIRED' => FenceState.expired,
    _ => FenceState.unknown,
  },
  fenceExpiresAt: r.fence?.expiresAt,
  orderNumber: r.orderNumber,
  handoverCode: r.handoverCode,
  handoverId: r.handoverId,
  inventory: switch (r.inventoryApplyStatus?.value) {
    'NOT_REQUESTED' => InventoryApply.notRequested,
    'PROCESSING' => InventoryApply.processing,
    'APPLIED' => InventoryApply.applied,
    'REJECTED' => InventoryApply.rejected,
    // 값이 없거나 모르는 값이면 확정으로 보지 않는다.
    _ => InventoryApply.unknownResult,
  },
  checkRequired: r.checkRequired ?? false,
  shipmentId: r.shipmentId,
  orderId: r.orderId,
  packingLocation: r.packingLocation,
  riderId: r.riderId,
  lastCheck: switch (r.lastCheck) {
    final c? when c.result != null => LastCheckView(
      result: c.result!.value == 'TAKEN_BY_RIDER'
          ? HandoverCheck.takenByRider
          : HandoverCheck.atStation,
      checkedBy: c.checkedBy,
      checkedAt: c.checkedAt,
    ),
    _ => null,
  },
  fresh: r.asOf?.freshness == api.ListTasks200ResponseAsOfFreshnessEnum.CURRENT,
);

PickupEtaView etaFromContract(trk.DeliveryEta e) => PickupEtaView(
  stage: switch (e.stage?.value) {
    'UNASSIGNED' => DeliveryStage.unassigned,
    'TO_STORE' => DeliveryStage.toStore,
    'AT_STORE' => DeliveryStage.atStore,
    'TO_CUSTOMER' => DeliveryStage.toCustomer,
    'AT_CUSTOMER' => DeliveryStage.atCustomer,
    'DONE' => DeliveryStage.done,
    _ => DeliveryStage.unknown,
  },
  status: switch (e.pickupEta?.status?.value) {
    'AVAILABLE' => EtaStatus.available,
    'LOCATING' => EtaStatus.locating,
    'ETA_PENDING' => EtaStatus.pending,
    'FINAL' => EtaStatus.finalized,
    _ => EtaStatus.unknown,
  },
  etaAt: e.pickupEta?.etaAt,
  remainingSeconds: e.pickupEta?.remainingSeconds,
  fresh: e.asOf?.freshness?.value == 'CURRENT',
);
