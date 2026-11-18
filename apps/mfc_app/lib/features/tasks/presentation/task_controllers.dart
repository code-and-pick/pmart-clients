import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../auth/presentation/auth_controller.dart';
import '../../../shared/codes.dart';
import '../../../shared/providers.dart';
import '../data/mock_task_repository.dart';
import '../data/task_repository.dart';
import '../domain/task_list.dart';

/// 거절된 실행의 사유(E1) — (작업 ID, 실행 ID). 화면이 거절 줄을 그릴 때만 부른다.
final executionRejectProvider = FutureProvider.autoDispose
    .family<ExecutionReject?, (String, String)>(
      (ref, k) => ref.watch(taskRepositoryProvider).executionReject(k.$1, k.$2),
    );

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

/// 다음 작업 받기로 받은 배정 버전(작업 ID → capacity assignmentVersion). 시작 때 작업 상세 값보다 먼저 쓴다 —
/// 배정 직후 fulfillment 상세에는 아직 배정 버전이 없다(서버 시작 판정은 capacity 배정과 비교, TaskRules.startRejection).
final knownAssignmentVersionsProvider =
    NotifierProvider<KnownAssignmentVersions, Map<String, int>>(
      KnownAssignmentVersions.new,
    );

class KnownAssignmentVersions extends Notifier<Map<String, int>> {
  @override
  Map<String, int> build() => const {};

  void put(String taskId, int? version) {
    if (version == null || state[taskId] == version) return;
    state = {...state, taskId: version};
  }
}

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
    // 배정 버전은 늘기만 한다 — 다음 작업 받기 값과 상세 값 중 큰 쪽.
    final known = ref.read(knownAssignmentVersionsProvider)[taskId];
    var version = [
      task.assignmentVersion ?? 0,
      known ?? 0,
    ].reduce((a, b) => a > b ? a : b);
    var outcome = await repo.start(
      taskId,
      workerId: worker,
      assignmentVersion: version,
      deviceId: device,
      key: key,
    );
    final resend = ref.read(startResendAttemptsProvider);
    for (var i = 0; i < resend && outcome is StartUnknown; i++) {
      if (!ref.mounted) return;
      outcome = await repo.start(
        taskId,
        workerId: worker,
        assignmentVersion: version,
        deviceId: device,
        key: key,
      );
    }
    // 그래도 VERSION_CONFLICT 면 상세를 다시 읽어 내 배정의 새 버전으로 한 번만 다시 보낸다(새 키 — 앞 요청은 거절 확정).
    // 다른 사람 배정이면 다시 보내지 않는다(거절 안내 그대로).
    if (outcome case StartRejected(code: TaskProblemCode.versionConflict)) {
      if (!ref.mounted) return;
      try {
        final fresh = await repo.task(taskId);
        final v = fresh.assignmentVersion;
        if (v != null &&
            v != version &&
            fresh.assignedWorkerId == worker &&
            ref.mounted) {
          version = v;
          outcome = await repo.start(
            taskId,
            workerId: worker,
            assignmentVersion: version,
            deviceId: device,
            key: IdempotencyKey.generate(),
          );
        }
      } on PmartFailure {
        // 다시 읽지 못하면 처음 거절을 보인다.
      }
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
enum PickLocScan {
  ok,
  wrongPlace,
  notLocation,

  /// 방금 다 집은 상품을 한 번 더 찍었다 — 지시 수량 초과(실적에 넣지 않음, 단계 그대로).
  overScan,
}

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

/// 지금 갈 칸: 남은 조각 중 서버 방문 순서(`visitSeq`, 냉장 → 냉동 → 상온, 걷는 거리 최단)가 가장 앞인 것.
/// 한 줄의 조각이 다른 줄 조각 사이에 끼어 있어도 서버 순서를 따른다(시뮬레이터 바코드 판과 같은 칸).
/// 방문 순서가 없으면 서버가 준 줄·조각 순서. 접수만 된(확정 대기) 양은 그 줄의 앞 조각에서 뺀다.
PickStop? nextPickStop(TaskDetailView task) {
  PickStop? best;
  int? bestSeq;
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
      final stop = PickStop(
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
      final seq = p.visitSeq;
      if (best == null) {
        best = stop;
        bestSeq = seq;
      } else if (seq != null && (bestSeq == null || seq < bestSeq)) {
        best = stop;
        bestSeq = seq;
      }
      // 방문 순서가 없으면 줄 안에서는 첫 남은 조각만(예전과 같게).
      if (seq == null) break;
    }
    // 재고 조회가 안 돼 지시가 비었으면 줄의 지시 칸.
    if (best == null && l.picks.isEmpty && l.locationId != null) {
      return PickStop(
        line: l,
        location: l.locationId!,
        qty: l.remainingQty - l.pendingQty,
        lotId: l.lotId,
        expiresOn: l.expiresOn,
      );
    }
  }
  return best;
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
    this.lastDoneLine,
  });

  /// 장바구니(`CRT-…`). 실행의 toLocation(집품 도착지 — fulfillment 0.8.0).
  final String? cart;

  /// 확인한 칸(스캔 값). 실행의 fromLocation.
  final String? at;

  /// 이번 칸에서 스캔해 모은 수량(서버 미전송·미확정). orderLineId → 수량.
  final Map<String, int> captured;
  final ScanResult? lastScan;
  final PickLocScan? lastLocScan;
  final bool syncing;

  /// 방금 칸 몫을 다 채워 보낸 줄(orderLineId). 그 상품을 또 찍으면 "칸 먼저"가 아니라 "수량 초과"로 알린다.
  final String? lastDoneLine;

  int capturedFor(String orderLineId) => captured[orderLineId] ?? 0;

  PickingState copyWith({
    String? Function()? cart,
    String? Function()? at,
    Map<String, int>? captured,
    ScanResult? Function()? lastScan,
    PickLocScan? Function()? lastLocScan,
    bool? syncing,
    String? Function()? lastDoneLine,
  }) => PickingState(
    cart: cart != null ? cart() : this.cart,
    at: at != null ? at() : this.at,
    captured: captured ?? this.captured,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
    lastLocScan: lastLocScan != null ? lastLocScan() : this.lastLocScan,
    syncing: syncing ?? this.syncing,
    lastDoneLine: lastDoneLine != null ? lastDoneLine() : this.lastDoneLine,
  );
}

/// 출하 → 피킹에 쓴 장바구니. 패킹대에서 장바구니를 찍어 같은 주문인지 확인한다.
/// 서버도 집품 도착지로 알지만(작업 상세 packingLocations) 패킹 화면은 이 기기 값으로 바로 비교한다.
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
    if (_isJustDone(task, c)) {
      r = PickLocScan.overScan;
    } else if (stop == null || !isMfcLocation(c) || isCartLocation(c)) {
      r = PickLocScan.notLocation;
    } else if (c == stop.location || stop.otherLocations.contains(c)) {
      r = PickLocScan.ok;
      state = state.copyWith(at: () => c, lastDoneLine: () => null);
    } else {
      r = PickLocScan.wrongPlace;
    }
    state = state.copyWith(lastLocScan: () => r);
    return r;
  }

  /// 방금 다 채워 보낸 줄의 상품 바코드인가(칸 확인 전 연타·카메라 중복 인식).
  bool _isJustDone(TaskDetailView task, String code) {
    final id = state.lastDoneLine;
    if (id == null) return false;
    final line = task.lines.where((l) => l.orderLineId == id).firstOrNull;
    return line != null && line.matchesBarcode(code);
  }

  /// 상품 바코드 스캔. 칸 확인 전·다른 상품·이 칸 몫 초과는 수량 0 + 원인 안내.
  ScanResult scan(TaskDetailView task, String code) {
    final stop = nextPickStop(task);
    final ScanResult result;
    if (state.at == null && _isJustDone(task, code)) {
      result = ScanResult.overRemaining;
    } else if (stop == null) {
      result = ScanResult.noTarget;
    } else if (state.at == null) {
      result = ScanResult.needLocation;
    } else if (!stop.line.matchesBarcode(code)) {
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

  /// 담은 수량을 직접 고친다(사용자 2026-11-17 — 첫 개는 스캔, 그다음은 스캔·+·수기).
  /// 첫 스캔 전에는 고칠 수 없고, 1 ~ 이 칸 지시 수량으로 맞춘다. 지시 수량에 닿으면 바로 보낸다.
  Future<void> setCount(TaskDetailView task, int n) async {
    final stop = nextPickStop(task);
    if (stop == null || state.at == null) return;
    final id = stop.line.orderLineId;
    if (state.capturedFor(id) < 1) return;
    final v = n.clamp(1, stop.qty);
    state = state.copyWith(
      captured: {...state.captured, id: v},
      lastScan: () => null,
    );
    await submitIfFull(task);
  }

  /// + 버튼 — 한 개 더.
  Future<void> addOne(TaskDetailView task) {
    final stop = nextPickStop(task);
    if (stop == null) return Future.value();
    return setCount(task, state.capturedFor(stop.line.orderLineId) + 1);
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
            toLocation: state.cart,
          ),
        );
    if (!ref.mounted) return;
    state = state.copyWith(
      at: () => null,
      captured: {...state.captured}..remove(line.orderLineId),
      lastScan: () => null,
      lastLocScan: () => null,
      lastDoneLine: () => shortage == null ? line.orderLineId : null,
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
