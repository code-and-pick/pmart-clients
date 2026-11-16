import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../auth/presentation/auth_controller.dart';
import '../../../shared/codes.dart';
import '../../../shared/providers.dart';
import '../data/mock_task_repository.dart';
import '../data/task_repository.dart';
import '../domain/task_list.dart';

final taskRepositoryProvider = Provider<TaskRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockTaskRepository(),
    PmartEnv.local => ApiTaskRepository(ref.watch(dioProvider)),
  },
);

/// 로그인 세션의 근무 센터(토큰 `centers` 클레임).
sealed class CenterScope {
  const CenterScope();
}

/// 센터가 하나 — 모든 요청 경로의 `mfcId`.
final class SingleCenter extends CenterScope {
  const SingleCenter(this.mfcId);
  final String mfcId;
}

/// 센터가 없다(권한 승인 대기 등) — 업무 API 를 부르지 않고 홈에서 안내한다.
final class NoCenter extends CenterScope {
  const NoCenter();
}

/// 센터가 여럿 — 어느 센터로 일할지 고르는 방법이 아직 정해지지 않았다.
/// 앞의 것을 골라 쓰지 않고 홈에서 안내한다.
final class MultipleCenters extends CenterScope {
  const MultipleCenters(this.centers);
  final List<String> centers;
}

/// 목 데이터의 센터.
const mockMfcId = 'MFC-MOCK-01';

/// 근무 센터. 목 모드는 목 데이터의 센터, 실서버는 로그인 세션의 센터.
/// 세션의 센터는 요청을 어디로 보낼지만 정한다 — 권한 판정은 서버가 토큰으로 다시 한다.
final centerScopeProvider = Provider<CenterScope>((ref) {
  if (ref.watch(envProvider) == PmartEnv.mock) {
    return const SingleCenter(mockMfcId);
  }
  final centers = ref.watch(employeeSessionProvider)?.centers ?? const [];
  return switch (centers) {
    [] => const NoCenter(),
    [final only] => SingleCenter(only),
    _ => MultipleCenters(centers),
  };
});

/// 요청 경로의 센터 ID. 센터가 하나가 아니면 빈 문자열 — 홈이 업무 화면으로 보내지 않는다.
final currentMfcIdProvider = Provider<String>(
  (ref) => switch (ref.watch(centerScopeProvider)) {
    SingleCenter(:final mfcId) => mfcId,
    _ => '',
  },
);

/// 작업자 ID = 로그인한 운영자 ID(토큰 `sub`, `OP-…` — 계약 mfc-capacity "workerId = 토큰 subject").
/// 목 모드는 목 데이터의 작업자. 로그인 전에는 빈 문자열(라우터가 로그인 화면에 둔다).
final currentWorkerIdProvider = Provider<String>((ref) {
  if (ref.watch(envProvider) == PmartEnv.mock) {
    return MockTaskRepository.workerId;
  }
  return ref.watch(employeeSessionProvider)?.operatorId ?? '';
});

/// 현장 실적 내구 큐(앱이 꺼져도 남는다).
final fieldQueueProvider = Provider<FieldQueue>(
  (ref) => FieldQueue(ref.watch(secureStoreProvider), name: 'mfc'),
);

/// 시작 결과 불명일 때 같은 키로 자동 재전송하는 횟수.
final startResendAttemptsProvider = Provider<int>((_) => 2);

final taskDetailProvider = FutureProvider.autoDispose
    .family<TaskDetailView, String>(
      (ref, taskId) => ref.watch(taskRepositoryProvider).task(taskId),
    );

/// 이 작업의 큐 항목(전송 상태 표시용).
final taskQueueProvider = FutureProvider.autoDispose
    .family<List<QueueItem>, String>((ref, taskId) async {
      final items = await ref.watch(fieldQueueProvider).items();
      return [
        for (final i in items)
          if (i.targetId == taskId) i,
      ];
    });

// ---------------------------------------------------------------------------
// 작업 시작(§3-1)

enum StartPhase {
  idle,
  starting,
  applied,
  rejected,
  notStarted,
  unknown,
  clientError,
}

@immutable
class StartFlow {
  const StartFlow(this.phase, {this.rejectCode});

  final StartPhase phase;
  final String? rejectCode;
}

final startFlowProvider = NotifierProvider.autoDispose
    .family<StartController, StartFlow, String>(StartController.new);

class StartController extends Notifier<StartFlow> {
  StartController(this.taskId);

  final String taskId;

  /// 확정 전까지 같은 키를 쓴다(503·불명·처리 중 모두 같은 키로 다시 보낸다).
  IdempotencyKey? _key;

  @override
  StartFlow build() => const StartFlow(StartPhase.idle);

  Future<void> start(TaskDetailView task) async {
    if (state.phase == StartPhase.starting) return;
    state = const StartFlow(StartPhase.starting);
    final key = _key ??= IdempotencyKey.generate();
    final repo = ref.read(taskRepositoryProvider);
    final worker = ref.read(currentWorkerIdProvider);
    final device = await ref.read(deviceIdProvider).get();
    var outcome = await repo.start(
      taskId,
      workerId: worker,
      assignmentVersion: task.assignmentVersion ?? 0,
      deviceId: device,
      key: key,
    );
    final resend = ref.read(startResendAttemptsProvider);
    for (var i = 0; i < resend && outcome is StartUnknown; i++) {
      if (!ref.mounted) return;
      outcome = await repo.start(
        taskId,
        workerId: worker,
        assignmentVersion: task.assignmentVersion ?? 0,
        deviceId: device,
        key: key,
      );
    }
    if (!ref.mounted) return;
    switch (outcome) {
      case StartApplied():
        _key = null;
        state = const StartFlow(StartPhase.applied);
        ref.invalidate(taskDetailProvider(taskId));
      case StartRejected(:final code):
        _key = null;
        state = StartFlow(StartPhase.rejected, rejectCode: code);
        // 거절이면 최신 상태를 다시 본다.
        ref.invalidate(taskDetailProvider(taskId));
      case StartNotStarted():
        // 시작 안 됨 확정. 같은 키로 다시 시도할 수 있다.
        state = const StartFlow(StartPhase.notStarted);
      case StartUnknown():
        state = const StartFlow(StartPhase.unknown);
      case StartClientError():
        _key = null;
        state = const StartFlow(StartPhase.clientError);
    }
  }
}

// ---------------------------------------------------------------------------
// 피킹 — 장바구니 → [칸 → 상품 × 수량] 반복. 한 실행 = 한 칸(계약 fromLocation).

/// needLocation = 칸을 아직 확인하지 않았다(상품보다 칸 먼저).
enum ScanResult { matched, wrongItem, overRemaining, noTarget, needLocation }

/// 칸 스캔 결과.
enum PickLocScan { ok, wrongPlace, notLocation }

/// 지금 갈 칸 하나: 줄·LOT 조각·칸·이 칸에서 집을 양.
@immutable
class PickStop {
  const PickStop({
    required this.line,
    required this.location,
    required this.qty,
    this.lotId,
    this.expiresOn,
    this.pick,
    this.otherLocations = const [],
  });

  final TaskLineView line;
  final String location;
  final int qty;
  final String? lotId;
  final String? expiresOn;
  final PickInstruction? pick;

  /// 같은 LOT 이 있는 다른 칸(지시 칸이 비었을 때 여기서 집어도 된다).
  final List<String> otherLocations;
}

/// 서버 순서대로 첫 남은 칸. 접수만 된(확정 대기) 양은 앞 조각에서 뺀다.
PickStop? nextPickStop(TaskDetailView task) {
  for (final l in task.lines) {
    if (l.remainingQty - l.pendingQty <= 0) continue;
    var sent = l.pendingQty;
    for (final p in l.picks) {
      if (p.status == PickStatus.done) continue;
      var r = p.remainingQty ?? 0;
      final used = sent < r ? sent : r;
      sent -= used;
      r -= used;
      if (r <= 0) continue;
      final withStock = p.locations.where((c) => (c.qty ?? 0) > 0).toList();
      final allocated = p.locations
          .where((c) => (c.allocatedQty ?? 0) > 0)
          .firstOrNull;
      final c = allocated ?? withStock.firstOrNull ?? p.locations.firstOrNull;
      if (c == null) continue;
      final here = (c.allocatedQty ?? 0) > 0
          ? c.allocatedQty!
          : (c.qty ?? 0) > 0
          ? c.qty!
          : r;
      return PickStop(
        line: l,
        location: c.code,
        qty: here < r ? here : r,
        lotId: p.lotId,
        expiresOn: p.expiresOn,
        pick: p,
        otherLocations: [
          for (final o in withStock)
            if (o.code != c.code) o.code,
        ],
      );
    }
    // 재고 조회가 안 돼 지시가 비었으면 줄의 지시 칸.
    if (l.picks.isEmpty && l.locationId != null) {
      return PickStop(
        line: l,
        location: l.locationId!,
        qty: l.remainingQty - l.pendingQty,
        lotId: l.lotId,
        expiresOn: l.expiresOn,
      );
    }
  }
  return null;
}

@immutable
class PickingState {
  const PickingState({
    this.cart,
    this.at,
    this.captured = const {},
    this.lastScan,
    this.lastLocScan,
    this.syncing = false,
  });

  /// 장바구니(`CRT-…`). 실행 본문에 넣을 곳이 없다(BR-52 R19 3) — 화면에만.
  final String? cart;

  /// 확인한 칸(스캔 값). 실행의 fromLocation.
  final String? at;

  /// 이번 칸에서 스캔해 모은 수량(서버 미전송·미확정). orderLineId → 수량.
  final Map<String, int> captured;
  final ScanResult? lastScan;
  final PickLocScan? lastLocScan;
  final bool syncing;

  int capturedFor(String orderLineId) => captured[orderLineId] ?? 0;

  PickingState copyWith({
    String? Function()? cart,
    String? Function()? at,
    Map<String, int>? captured,
    ScanResult? Function()? lastScan,
    PickLocScan? Function()? lastLocScan,
    bool? syncing,
  }) => PickingState(
    cart: cart != null ? cart() : this.cart,
    at: at != null ? at() : this.at,
    captured: captured ?? this.captured,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
    lastLocScan: lastLocScan != null ? lastLocScan() : this.lastLocScan,
    syncing: syncing ?? this.syncing,
  );
}

/// 출하 → 피킹에 쓴 장바구니. 패킹대에서 장바구니를 찍어 같은 주문인지 확인한다.
/// 실행 본문에 넣을 곳이 없어(BR-52 R19 3) 이 기기에만 둔다.
final orderCartProvider = NotifierProvider<OrderCarts, Map<String, String>>(
  OrderCarts.new,
);

class OrderCarts extends Notifier<Map<String, String>> {
  @override
  Map<String, String> build() => const {};

  void set(String shipmentId, String cart) =>
      state = {...state, shipmentId: cart};
}

final pickingProvider = NotifierProvider.autoDispose
    .family<PickingController, PickingState, String>(PickingController.new);

class PickingController extends Notifier<PickingState> {
  PickingController(this.taskId);

  final String taskId;

  @override
  PickingState build() => const PickingState();

  /// 장바구니 바코드. 장바구니 코드가 아니면 false. 패킹대에서 같은 장바구니인지 본다.
  bool scanCart(String code, {String? shipmentId}) {
    final c = code.trim();
    if (!isCartLocation(c)) return false;
    state = state.copyWith(cart: () => c);
    if (shipmentId != null) {
      ref.read(orderCartProvider.notifier).set(shipmentId, c);
    }
    return true;
  }

  /// 칸 바코드. 지시 칸 또는 같은 LOT 이 있는 다른 칸이면 확인.
  PickLocScan scanLocation(TaskDetailView task, String code) {
    final stop = nextPickStop(task);
    final c = code.trim();
    final PickLocScan r;
    if (stop == null || !isMfcLocation(c) || isCartLocation(c)) {
      r = PickLocScan.notLocation;
    } else if (c == stop.location || stop.otherLocations.contains(c)) {
      r = PickLocScan.ok;
      state = state.copyWith(at: () => c);
    } else {
      r = PickLocScan.wrongPlace;
    }
    state = state.copyWith(lastLocScan: () => r);
    return r;
  }

  /// 상품 바코드 스캔. 칸 확인 전·다른 상품·이 칸 몫 초과는 수량 0 + 원인 안내.
  ScanResult scan(TaskDetailView task, String code) {
    final stop = nextPickStop(task);
    final ScanResult result;
    if (stop == null) {
      result = ScanResult.noTarget;
    } else if (state.at == null) {
      result = ScanResult.needLocation;
    } else if (stop.line.barcode != code.trim()) {
      result = ScanResult.wrongItem;
    } else if (state.capturedFor(stop.line.orderLineId) >= stop.qty) {
      result = ScanResult.overRemaining;
    } else {
      state = state.copyWith(
        captured: {
          ...state.captured,
          stop.line.orderLineId: state.capturedFor(stop.line.orderLineId) + 1,
        },
        lastScan: () => ScanResult.matched,
      );
      return ScanResult.matched;
    }
    state = state.copyWith(lastScan: () => result);
    return result;
  }

  /// 이 칸 몫을 다 집었으면 바로 보낸다(버튼 없음).
  Future<void> submitIfFull(TaskDetailView task) async {
    final stop = nextPickStop(task);
    if (stop == null) return;
    if (state.capturedFor(stop.line.orderLineId) >= stop.qty) {
      await submitStop(task);
    }
  }

  /// 지금 칸의 실적을 큐에 넣고 보낸다. [shortage] 는 결품·파손·차단 보고(이 줄의 남은 양).
  Future<void> submitStop(
    TaskDetailView task, {
    ({int qty, ShortageReason reason, String? note})? shortage,
  }) async {
    final stop = nextPickStop(task);
    if (stop == null) return;
    final line = stop.line;
    final picked = state.capturedFor(line.orderLineId);
    if (picked == 0 && shortage == null) return;
    await ref
        .read(fieldQueueProvider)
        .enqueue(
          kind: FieldCommandKind.pickExecution,
          targetId: taskId,
          payload: pickPayload(
            workerId: ref.read(currentWorkerIdProvider),
            assignmentVersion: task.assignmentVersion,
            line: line,
            pickedQty: picked,
            shortage: shortage,
            fromLocation: state.at ?? stop.location,
            lotId: stop.lotId,
          ),
        );
    if (!ref.mounted) return;
    state = state.copyWith(
      at: () => null,
      captured: {...state.captured}..remove(line.orderLineId),
      lastScan: () => null,
      lastLocScan: () => null,
    );
    await sync();
  }

  /// 전송 대기·확인 중을 같은 키로 보내고, 확정 대기를 조회한다.
  Future<void> sync() async {
    if (state.syncing) return;
    state = state.copyWith(syncing: true);
    final repo = ref.read(taskRepositoryProvider);
    final queue = ref.read(fieldQueueProvider);
    await queue.flush(repo.sendExecution);
    await queue.confirm(
      (item) => item.resultId == null
          ? Future.value(ConfirmResult.unknown)
          : repo.execution(item.targetId, item.resultId!),
    );
    if (!ref.mounted) return;
    state = state.copyWith(syncing: false);
    ref
      ..invalidate(taskQueueProvider(taskId))
      ..invalidate(taskDetailProvider(taskId));
  }
}
