import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../auth/data/session.dart';
import '../../offers/presentation/offer_controllers.dart'
    show
        assignedDeliveriesProvider,
        mockOfferRepositoryProvider,
        offerPollerProvider;
import '../data/delivery_repository.dart';
import '../data/mock_delivery_repository.dart';
import '../domain/delivery.dart';

/// 앱 목 모드: 제안을 수락한 배송만 진행 목록에 보인다.
final _mockDelivery = Provider<MockDeliveryRepository>((ref) {
  final offers = ref.read(mockOfferRepositoryProvider);
  final repo = MockDeliveryRepository(
    demoBundle: true,
    visible: (id) => offers.assignedDeliveries.contains(id),
    returnAttempts: ref.read(returnAttemptsProvider),
  );
  // 끝난 배송은 최대 3건 계산에서 빠진다.
  offers.finished = repo.isFinished;
  return repo;
});

final deliveryRepositoryProvider = Provider<DeliveryRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiDeliveryRepository(
      ref.watch(dioProvider),
      returnAttempts: ref.watch(returnAttemptsProvider),
    ),
  },
);

final handoverRepositoryProvider = Provider<HandoverRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiHandoverRepository(ref.watch(dioProvider)),
  },
);

final assignmentCancelRepositoryProvider = Provider<AssignmentCancelRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiAssignmentCancelRepository(ref.watch(dioProvider)),
  },
);

/// 지원센터 상담 대화. 실서버는 계약이 없어 "준비 중"(백엔드 요청 §11).
final supportThreadRepositoryProvider = Provider<SupportThreadRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiSupportThreadRepository(ref.watch(dioProvider)),
  },
);

final evidencePhotoViewerProvider = Provider<EvidencePhotoViewer>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiEvidencePhotoViewer(ref.watch(dioProvider)),
  },
);

/// 도움요청에 올린 사진 참조(앱을 다시 켜도 서버에서).
final requestPhotoRefsProvider = FutureProvider.autoDispose
    .family<List<String>, ({String deliveryId, String requestId})>(
      (ref, k) => ref
          .watch(evidencePhotoViewerProvider)
          .requestPhotoRefs(k.deliveryId, k.requestId),
    );

/// 사진 원본(메모리에만 — 화면을 나가면 지운다).
final evidencePhotoProvider = FutureProvider.autoDispose
    .family<Uint8List, ({String deliveryId, String photoRef})>(
      (ref, k) => ref
          .watch(evidencePhotoViewerProvider)
          .photo(k.deliveryId, k.photoRef),
    );

final evidenceUploaderProvider = Provider<EvidenceUploader>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiEvidenceUploader(ref.watch(dioProvider)),
  },
);

/// 라이더 ID — 로그인 세션의 라이더(2026-11-18: 예전에는 BR-02 전 목 라이더로 고정이라 실서버 포장 인계가
/// MFC 에서 403 RIDER_MISMATCH 로 막혔다). 목 모드는 세션이 목 라이더라 그대로, 세션이 없으면 목 라이더.
final currentRiderIdProvider = Provider<String>(
  (ref) =>
      ref.watch(sessionProvider)?.riderId ?? MockDeliveryRepository.riderId,
);

/// 현장 큐 저장소. 실서버는 기기 보안 저장소(앱이 꺼져도 남는다).
/// 목 모드는 메모리 — 목 배송 데이터가 실행마다 새로 시작하므로, 지난 실행의 명령이
/// 새 목 데이터에 다시 보내져 거절(INVALID_STATE)되지 않게 한다.
final fieldQueueStoreProvider = Provider<SecureKeyValueStore>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MemoryKeyValueStore(),
    PmartEnv.local => ref.watch(secureStoreProvider),
  },
);

/// 라이더 현장 큐(수행 명령). 같은 키로 다시 보낸다.
final riderQueueProvider = Provider<FieldQueue>(
  (ref) => FieldQueue(ref.watch(fieldQueueStoreProvider), name: 'rider'),
);

/// 방금 수락한 배송을 배송 서버가 아직 모를 때 다시 묻는 간격(합 8초).
///
/// 배차 수락(dispatch)이 배송 수행(execution)에 배정으로 반영되기까지 0.2~0.7초 걸린다(백엔드 LAN 확인
/// 2026-11-18). 그 사이 `GET /deliveries/{id}` 는 "볼 수 없으면 404"(계약)라, 바로 부르면 실패로 보였다
/// (사용자: "배차 수락하면 배송 정보를 불러오지 못했어요 — 다시 시도를 눌러야 픽업지가 뜬다").
final acceptCatchUpDelaysProvider = Provider<List<Duration>>(
  (_) => const [
    Duration(milliseconds: 500),
    Duration(seconds: 1),
    Duration(milliseconds: 1500),
    Duration(seconds: 2),
    Duration(seconds: 3),
  ],
);

final deliveryProvider = FutureProvider.autoDispose
    .family<DeliveryView, String>((ref, id) async {
      final repo = ref.watch(deliveryRepositoryProvider);
      // 이번 실행에서 내가 수락한 배송만: 404 는 "아직 반영 전"으로 보고 잠깐씩 다시 묻는다(그동안은 불러오는 중).
      // 그 밖 배송·다른 실패는 바로 실패로(지어내지 않는다). 끝까지 404 면 그대로 실패.
      final justAccepted = ref.read(assignedDeliveriesProvider).contains(id);
      final delays = justAccepted
          ? ref.read(acceptCatchUpDelaysProvider)
          : const <Duration>[];
      // 화면을 나가 조회가 버려지면 기다리던 타이머도 끈다(남은 타이머가 다시 부르지 않게).
      Timer? waiting;
      ref.onDispose(() => waiting?.cancel());
      for (var i = 0; ; i++) {
        try {
          return await repo.get(id);
        } on ProblemFailure catch (e) {
          if (e.problem.status != 404 || i >= delays.length) rethrow;
          final done = Completer<void>();
          waiting = Timer(delays[i], done.complete);
          await done.future;
        }
      }
    });

final myActiveDeliveriesProvider =
    FutureProvider.autoDispose<List<DeliveryView>>(
      (ref) => ref.watch(deliveryRepositoryProvider).myActive(),
    );

/// 회수지 연락처·주소(개인정보). autoDispose — 화면을 나가면 메모리에서 지운다.
final recoveryContactProvider = FutureProvider.autoDispose
    .family<RecoveryContactView, String>(
      (ref, id) => ref.watch(deliveryRepositoryProvider).recoveryContact(id),
    );

/// 전달지(개인정보). autoDispose — 화면을 나가면 메모리에서 지운다.
final dropInfoProvider = FutureProvider.autoDispose.family<DropInfo, String>(
  (ref, id) => ref.watch(deliveryRepositoryProvider).dropInfo(id),
);

final deliveryQueueProvider = FutureProvider.autoDispose
    .family<List<QueueItem>, String>(
      (ref, id) async => [
        for (final i in await ref.watch(riderQueueProvider).items())
          if (i.targetId == id) i,
      ],
    );

@immutable
class DeliveryFlowState {
  const DeliveryFlowState({
    this.packages = const {},
    this.lastScan,
    this.lastRejectCode,
    this.photoRef,
    this.uploading = false,
    this.uploadFailed = false,
    this.contacts = const [],
    this.photo,
  });

  /// 마지막으로 찍은 사진(메모리에만 — 기사가 다시 찍기 전에 확인한다).
  final LocalPhoto? photo;

  final Map<String, PackageHandover> packages;
  final ScanVerdict? lastScan;
  final String? lastRejectCode;

  /// 업로드에 성공한 사진 참조. 이것이 있어야 전달 완료를 누를 수 있다.
  final String? photoRef;
  final bool uploading;
  final bool uploadFailed;

  /// 고객 연락 기록(전달 실패 등록에 쓴다).
  final List<ContactAttempt> contacts;

  PackageHandover phaseOf(String packageId) =>
      packages[packageId] ??
      PackageHandover(packageId: packageId, phase: HandoverPhase.waiting);

  List<String> get handoverIds => [
    for (final p in packages.values)
      if (p.phase == HandoverPhase.handedOver && p.handoverId != null)
        p.handoverId!,
  ];

  DeliveryFlowState copyWith({
    Map<String, PackageHandover>? packages,
    ScanVerdict? lastScan,
    String? Function()? lastRejectCode,
    String? photoRef,
    bool? uploading,
    bool? uploadFailed,
    List<ContactAttempt>? contacts,
    LocalPhoto? photo,
    bool clearPhotoRef = false,
  }) => DeliveryFlowState(
    photo: photo ?? this.photo,
    packages: packages ?? this.packages,
    lastScan: lastScan ?? this.lastScan,
    lastRejectCode: lastRejectCode != null
        ? lastRejectCode()
        : this.lastRejectCode,
    photoRef: clearPhotoRef ? null : (photoRef ?? this.photoRef),
    uploading: uploading ?? this.uploading,
    uploadFailed: uploadFailed ?? this.uploadFailed,
    contacts: contacts ?? this.contacts,
  );
}

final deliveryFlowProvider = NotifierProvider.autoDispose
    .family<DeliveryFlowController, DeliveryFlowState, String>(
      DeliveryFlowController.new,
    );

class DeliveryFlowController extends Notifier<DeliveryFlowState> {
  DeliveryFlowController(this.deliveryId);

  final String deliveryId;

  /// 포장별 승인·커밋 키. 결과가 확정될 때까지 같은 키로만 다시 보낸다.
  final _authKeys = <String, IdempotencyKey>{};
  final _commitKeys = <String, IdempotencyKey>{};
  final _auths = <String, HandoverAuthorized>{};

  /// 허가를 받은 라벨 숫자 → 포장(이 배송). 인계가 끝난 숫자를 다시 넣으면 서버에 보내지 않는다.
  final _usedCodes = <String, String>{};

  /// 라벨 숫자 허가 멱등 키(숫자별) — 결과를 모를 때 같은 숫자를 다시 넣으면 같은 키로 보낸다.
  final _codeKeys = <String, IdempotencyKey>{};

  @override
  DeliveryFlowState build() => const DeliveryFlowState();

  HandoverRepository get _handovers => ref.read(handoverRepositoryProvider);

  void _setPhase(
    String pkg,
    HandoverPhase phase, {
    String? handoverId,
    String? code,
  }) {
    if (!ref.mounted) return;
    state = state.copyWith(
      packages: {
        ...state.packages,
        pkg: PackageHandover(
          packageId: pkg,
          phase: phase,
          handoverId: handoverId,
          rejectCode: code,
        ),
      },
    );
  }

  /// 재진입 시 포장마다 서버 판정을 조회해 화면을 맞춘다.
  Future<void> hydrate(DeliveryView d) async {
    for (final pkg in d.packageIds) {
      if (state.packages.containsKey(pkg)) continue;
      await resolve(pkg, fromHydrate: true);
    }
  }

  /// 포장 QR 스캔. 다른 배송·중복·읽기 실패는 서버에 보내기 전에 막고 사유를 보인다.
  Future<ScanVerdict> scan(DeliveryView d, String code) async {
    final pkg = packageIdFromQr(code);
    final ScanVerdict verdict;
    if (pkg == null) {
      verdict = ScanVerdict.unreadable;
    } else if (!d.packageIds.contains(pkg)) {
      verdict = ScanVerdict.otherDelivery;
    } else if (state.phaseOf(pkg).phase != HandoverPhase.waiting &&
        state.phaseOf(pkg).phase != HandoverPhase.rejected) {
      // 진행 중·확인 중·완료인 포장을 다시 찍어 새 인계를 만들지 않는다.
      verdict = ScanVerdict.duplicate;
    } else {
      verdict = ScanVerdict.accepted;
    }
    state = state.copyWith(lastScan: verdict, lastRejectCode: () => null);
    if (verdict == ScanVerdict.accepted) await _handover(d, pkg!, code.trim());
    return verdict;
  }

  Future<void> _handover(DeliveryView d, String pkg, String code) async {
    final rider = ref.read(currentRiderIdProvider);
    _setPhase(pkg, HandoverPhase.authorizing);
    final authKey = _authKeys[pkg] ??= IdempotencyKey.generate();
    HandoverStep step = const HandoverUnknown();
    for (var i = 0; i < 3 && step is HandoverUnknown; i++) {
      step = await _handovers.authorize(
        pkg,
        riderId: rider,
        deliveryId: d.deliveryId,
        scannedCode: code,
        key: authKey,
      );
    }
    switch (step) {
      case HandoverAuthorized():
        _auths[pkg] = step;
      // 이미 인계됨(점원·다른 기기)·확정 대기 — 거절이 아니다. 판정 조회로 맞춘다.
      case HandoverRejected(:final code) when _settledElsewhere(code):
        _authKeys.remove(pkg);
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
        return;
      case HandoverRejected(:final code):
        _authKeys.remove(pkg);
        _setPhase(pkg, HandoverPhase.rejected, code: code);
        if (ref.mounted) state = state.copyWith(lastRejectCode: () => code);
        _refreshIfReassigned(code);
        return;
      default:
        // 승인 여부를 모른다. 판정 조회로 확인한다.
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
        return;
    }
    await _commit(pkg);
  }

  /// 라벨 숫자로 인계(QR 이 안 찍힐 때). 숫자로 허가를 받으면 서버가 찾은 포장을 알게 되고, 확정은 QR 과 같다.
  /// 반환: 허가 [HandoverCodeAuthorized]·거절 [HandoverRejected](틀림 남은 횟수·잠김)·모름 [HandoverUnknown](같은 숫자로 다시 — 같은 키),
  /// 형식이 틀리면(4·6자리 숫자가 아님) 서버에 보내지 않고 null.
  Future<HandoverStep?> enterCode(DeliveryView d, String digits) async {
    final code = digits.trim();
    if (!PackageLabelNumber.pattern.hasMatch(code)) return null;
    state = state.copyWith(lastRejectCode: () => null);
    // 이미 이 숫자로 인계한 포장 — 서버에 다시 보내면 HANDOVER_CODE_MISMATCH 로 남은 횟수가 준다
    // (2026-11-20 S23 실서버 재현: 인계 끝난 3387 을 다시 넣자 "이 배달의 포장 숫자가 아니에요 · 3번 남음").
    if (_usedCodes[code] case final pkg?
        when state.phaseOf(pkg).phase == HandoverPhase.handedOver) {
      return const HandoverRejected(HandoverProblemCode.alreadyHandedOver);
    }
    final key = _codeKeys[code] ??= IdempotencyKey.generate();
    HandoverStep step = const HandoverUnknown();
    for (var i = 0; i < 3 && step is HandoverUnknown; i++) {
      step = await _handovers.authorizeByCode(
        riderId: ref.read(currentRiderIdProvider),
        deliveryId: d.deliveryId,
        handoverCode: code,
        key: key,
      );
    }
    if (step is! HandoverUnknown) _codeKeys.remove(code);
    // 이미 인계된 포장의 번호(fulfillment 0.31.1 — 틀린 횟수 안 셈). 어느 포장인지 응답에 없으니
    // 아직 인계 전으로 보이는 포장을 판정 조회로 맞춘다(점원·다른 기기가 인계했을 수 있다).
    if (step case HandoverRejected(:final code)
        when code == HandoverProblemCode.alreadyHandedOver) {
      for (final pkg in d.packageIds) {
        if (state.phaseOf(pkg).phase != HandoverPhase.handedOver) {
          await resolve(pkg);
        }
      }
    }
    if (step case HandoverCodeAuthorized(
      :final packageId,
      :final authorization,
    )) {
      _usedCodes[code] = packageId;
      final phase = state.phaseOf(packageId).phase;
      if (phase == HandoverPhase.handedOver) return step;
      _auths[packageId] = authorization;
      _setPhase(packageId, HandoverPhase.authorizing);
      await _commit(packageId);
    }
    return step;
  }

  Future<void> _commit(String pkg) async {
    final auth = _auths[pkg];
    if (auth == null) return;
    _setPhase(pkg, HandoverPhase.committing);
    // 커밋 키는 허가마다 — 새 허가(다시 찍기·번호)를 예전 키에 실어 IDEMPOTENCY_CONFLICT 가 나지 않게.
    final key = _commitKeys[auth.authorizationId] ??= IdempotencyKey.generate();
    HandoverStep step = const HandoverUnknown();
    for (var i = 0; i < 3 && step is HandoverUnknown; i++) {
      step = await _handovers.commit(
        pkg,
        authorizationId: auth.authorizationId,
        fenceVersion: auth.fenceVersion,
        riderId: ref.read(currentRiderIdProvider),
        key: key,
      );
    }
    switch (step) {
      case HandoverCommitted(:final handoverId):
        _forgetHandover(pkg, auth);
        _setPhase(pkg, HandoverPhase.handedOver, handoverId: handoverId);
      case HandoverRejected(:final code) when _settledElsewhere(code):
        _forgetHandover(pkg, auth);
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
      case HandoverRejected(:final code):
        // 거절(FENCE_EXPIRED 등)로 끝났다 — 다시 찍으면 새 허가·새 키로(예전 만료 허가를 되받지 않게).
        _forgetHandover(pkg, auth);
        _setPhase(pkg, HandoverPhase.rejected, code: code);
        if (ref.mounted) state = state.copyWith(lastRejectCode: () => code);
        _refreshIfReassigned(code);
      default:
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
    }
  }

  /// 배정이 바뀌었거나 단계가 달라진 거절 — 배송을 다시 읽어 화면을 서버 상태로(예전 버튼이 남지 않게).
  void _refreshIfReassigned(String? code) {
    const codes = {
      'NOT_ASSIGNED',
      'RIDER_MISMATCH',
      HandoverProblemCode.handoverRiderMismatch,
      ProblemCode.invalidState,
      ProblemCode.notFound,
    };
    if (ref.mounted && codes.contains(code)) {
      ref.invalidate(deliveryProvider(deliveryId));
    }
  }

  static bool _settledElsewhere(String? code) =>
      code == HandoverProblemCode.alreadyHandedOver ||
      code == HandoverProblemCode.resultPending;

  void _forgetHandover(String pkg, HandoverAuthorized auth) {
    _authKeys.remove(pkg);
    _auths.remove(pkg);
    _commitKeys.remove(auth.authorizationId);
  }

  /// 인계 판정 조회(`handover-resolution`). 시간이 지났다고 원상복구하지 않는다.
  Future<void> resolve(String pkg, {bool fromHydrate = false}) async {
    try {
      final r = await _handovers.resolution(pkg);
      switch (r.verdict) {
        case HandoverVerdict.handedOver:
          _setPhase(pkg, HandoverPhase.handedOver, handoverId: r.handoverId);
        case HandoverVerdict.stopped:
          _setPhase(pkg, HandoverPhase.stopped);
        case HandoverVerdict.inProgress:
          _setPhase(pkg, HandoverPhase.checking);
        case HandoverVerdict.unknown:
          if (!fromHydrate) _setPhase(pkg, HandoverPhase.checking);
      }
    } on PmartFailure {
      if (!fromHydrate) _setPhase(pkg, HandoverPhase.checking);
    }
  }

  /// "다시 확인": 먼저 판정을 조회하고, 아직 진행 중이면 같은 키로 커밋을 다시 보낸다(새 인계를 만들지 않는다).
  Future<void> checkAgain(String pkg) async {
    await resolve(pkg);
    final auth = _auths[pkg];
    if (state.phaseOf(pkg).phase == HandoverPhase.checking &&
        auth != null &&
        _commitKeys.containsKey(auth.authorizationId)) {
      await _commit(pkg);
    }
  }

  // -------------------------------------------------------------- 수행 명령

  Future<void> _send(String kind, Map<String, Object?> payload) async {
    final queue = ref.read(riderQueueProvider);
    // 같은 명령이 아직 열려 있으면(두 번 누름·결과 확인 중) 새로 넣지 않고 그 명령을 같은 키로 다시 보낸다.
    // 전에는 두 번째 누름이 새 키로 들어가 409 INVALID_STATE "상태가 맞지 않아요" 가 떴다.
    // 이미 그 단계를 지났다(첫 누름이 방금 반영됨 — 화면이 바뀌기 전 연타). 새 키로 또 보내면 409 INVALID_STATE
    // "상태가 맞지 않아요" 가 뜬다(2026-11-20 S23 실서버에서 가게 도착 연타로 재현).
    final known = ref.read(deliveryProvider(deliveryId)).value?.state;
    if (known != null && _reached(kind, known)) return;
    final open = (await queue.items()).any(
      (i) => i.targetId == deliveryId && i.kind == kind && i.isOpen,
    );
    if (open) {
      await sync();
      return;
    }
    await queue.enqueue(
      kind: kind,
      targetId: deliveryId,
      payload: {
        'occurredAt': DateTime.now().toUtc().toIso8601String(),
        ...payload,
      },
    );
    await sync();
  }

  bool _syncing = false;
  bool _syncAgain = false;

  /// 전송 대기·확인 중을 같은 키로 보내고, 접수분은 배송 상태로 확정을 확인한다.
  /// 겹쳐 부르면(누름·주기·복귀) 끝난 뒤 한 번 더 — 큐를 동시에 고치지 않는다.
  Future<void> sync() async {
    if (_syncing) {
      _syncAgain = true;
      return;
    }
    _syncing = true;
    try {
      await _syncOnce();
    } finally {
      _syncing = false;
    }
    if (_syncAgain && ref.mounted) {
      _syncAgain = false;
      await sync();
    }
  }

  Future<void> _syncOnce() async {
    final repo = ref.read(deliveryRepositoryProvider);
    final queue = ref.read(riderQueueProvider);
    await queue.flush(repo.send);
    var finishedOne = false;
    await queue.confirm((item) async {
      try {
        final d = await repo.get(item.targetId);
        final reached = _reached(item.kind, d.state);
        if (reached &&
            (item.kind == DeliveryCommandKind.completion ||
                item.kind == DeliveryCommandKind.returnToStore)) {
          finishedOne = true;
        }
        if (reached) return ConfirmResult.applied;
        // 다른 주체가 배송을 바꿨다(취소·배정 해제·실패 확정·운영자 반려 등) — 기다려도 도달하지 않는다.
        // 명령을 닫아 버튼을 풀고, 화면은 서버 상태를 그대로 그린다(전에는 영영 잠겼다).
        if (_overtaken(item, d)) return ConfirmResult.applied;
        return ConfirmResult.pending;
      } on PmartFailure {
        return ConfirmResult.unknown;
      }
    });
    if (!ref.mounted) return;
    ref
      ..invalidate(deliveryProvider(deliveryId))
      ..invalidate(deliveryQueueProvider(deliveryId));
    // 배송이 끝났다(서버 확정) — 제안을 바로 다시 본다. 하나씩 배달하기·최대 3건이 차 있던 동안 서버는
    // 폴링을 멈추게(pollAfterSec null) 하므로, 끝난 뒤 다시 묻지 않으면 새 제안이 앱을 다시 열 때까지 안 보인다.
    if (finishedOne) {
      unawaited(ref.read(offerPollerProvider.notifier).refreshNow());
    }
  }

  static bool _overtaken(QueueItem item, DeliveryView d) {
    const ended = {
      ExecutionState.cancelled,
      ExecutionState.unassigned,
      ExecutionState.failed,
      ExecutionState.returnedToStore,
      ExecutionState.completed,
    };
    if (ended.contains(d.state)) return true;
    // 전달 불가 신고가 접수됐는데 배송이 원래 단계에 있다 = 운영자가 이미 반려했다(재개 요청이 있었거나 충분히 지났다).
    if (item.kind == DeliveryCommandKind.failure &&
        (d.state == ExecutionState.pickedUp ||
            d.state == ExecutionState.arrivedAtCustomer)) {
      return d.resumeRequestedAt != null ||
          DateTime.now().difference(item.createdAt) >
              const Duration(minutes: 2);
    }
    return false;
  }

  static bool _reached(String kind, ExecutionState s) {
    // 회수: 받음 → RETURN_PICKED_UP(→ 반납 RETURNED_TO_STORE).
    if (kind == DeliveryCommandKind.returnPickup) {
      return s == ExecutionState.returnPickedUp ||
          s == ExecutionState.returnedToStore;
    }
    if (kind == DeliveryCommandKind.returnToStore) {
      return s == ExecutionState.returnedToStore;
    }
    const order = [
      ExecutionState.assigned,
      ExecutionState.arrivedAtStore,
      ExecutionState.pickedUp,
      ExecutionState.arrivedAtCustomer,
      ExecutionState.completed,
    ];
    final target = switch (kind) {
      DeliveryCommandKind.storeArrival => ExecutionState.arrivedAtStore,
      DeliveryCommandKind.pickup => ExecutionState.pickedUp,
      DeliveryCommandKind.customerArrival => ExecutionState.arrivedAtCustomer,
      DeliveryCommandKind.completion => ExecutionState.completed,
      _ => ExecutionState.failureReported,
    };
    if (target == ExecutionState.failureReported) {
      return s == ExecutionState.failureReported || s == ExecutionState.failed;
    }
    final i = order.indexOf(s);
    return i >= 0 && i >= order.indexOf(target);
  }

  Future<void> arriveAtStore() =>
      _send(DeliveryCommandKind.storeArrival, const {});

  /// 픽업 완료는 서버가 확정한 인계(handoverIds)가 있어야 한다.
  Future<void> pickup() =>
      _send(DeliveryCommandKind.pickup, {'handoverIds': state.handoverIds});

  Future<void> arriveAtCustomer() =>
      _send(DeliveryCommandKind.customerArrival, const {});

  /// 회수: 회수지에서 받았다. 올린 사진이 있어야 한다(서버가 1장 이상 확인 — 422 EVIDENCE_REQUIRED).
  Future<void> returnPickup() {
    final photo = state.photoRef;
    if (photo == null) return Future.value();
    return _send(DeliveryCommandKind.returnPickup, {
      'evidenceRefs': [photo],
    });
  }

  /// 회수: MFC 에 반납했다(배송 끝 — 수행료).
  /// [code] = MFC 직원 화면에 뜬 반납 인증번호(execution 0.27.0 `handoverCode`).
  Future<void> returnToStore({String? code}) => _send(
    DeliveryCommandKind.returnToStore,
    code == null ? const {} : {'handoverCode': code},
  );

  /// 사진 올리기 키. 같은 사진을 다시 올릴 때만 같은 키다(새로 찍으면 새 키).
  IdempotencyKey? _photoKey;
  LocalPhoto? _photo;

  /// 증빙 사진 올리기. 성공해야 전달 완료·전달 실패를 보낼 수 있다.
  /// [photo] 가 null 이면 마지막으로 찍은 사진을 같은 키로 다시 올린다.
  Future<void> uploadPhoto([LocalPhoto? photo]) async {
    if (photo != null) {
      _photo = photo;
      _photoKey = IdempotencyKey.generate();
    }
    final current = _photo ?? (bytes: Uint8List(0), filename: 'evidence.jpg');
    final key = _photoKey ??= IdempotencyKey.generate();
    // 새로 찍었으면 이전 사진 참조는 더 쓰지 않는다(미리보기와 올린 사진이 달라지지 않게).
    state = state.copyWith(
      uploading: true,
      uploadFailed: false,
      photo: photo,
      clearPhotoRef: photo != null,
    );
    try {
      final ref0 = await ref
          .read(evidenceUploaderProvider)
          .upload(deliveryId, current, key: key);
      if (ref.mounted) state = state.copyWith(uploading: false, photoRef: ref0);
    } on PmartFailure {
      if (ref.mounted) {
        state = state.copyWith(uploading: false, uploadFailed: true);
      }
    }
  }

  /// 고객 연락 한 번을 기록한다(전화를 걸고 결과를 고른다).
  void recordContact({required bool answered}) {
    state = state.copyWith(
      contacts: [
        ...state.contacts,
        ContactAttempt(attemptedAt: DateTime.now().toUtc(), answered: answered),
      ],
    );
  }

  Future<void> complete(CompletionMethod method, Placement placement) {
    final photo = state.photoRef;
    if (photo == null) return Future.value();
    return _send(DeliveryCommandKind.completion, {
      'method': method == CompletionMethod.face ? 'FACE' : 'CONTACTLESS',
      'photoRefs': [photo],
      'takenAt': DateTime.now().toUtc().toIso8601String(),
      'placement': switch (placement) {
        Placement.handedToCustomer => 'HANDED_TO_CUSTOMER',
        Placement.frontDoor => 'FRONT_DOOR',
        Placement.securityOffice => 'SECURITY_OFFICE',
        Placement.deliveryBox => 'DELIVERY_BOX',
        Placement.other => 'OTHER',
      },
    });
  }

  /// 전달 실패 알리기. 사진과(고객 사유면) 연락 기록 2회 이상이 필요하다 — 서버가 최종 판정한다.
  /// 운영자가 확정하기 전까지 배송은 진행 중(FAILURE_REPORTED)이다.
  Future<void> reportFailure(FailureReason reason, {String? detail}) =>
      _send(DeliveryCommandKind.failure, {
        'reason': switch (reason) {
          FailureReason.customerAbsent => 'CUSTOMER_ABSENT',
          FailureReason.addressError => 'ADDRESS_ERROR',
          FailureReason.unreachable => 'UNREACHABLE',
          FailureReason.refused => 'REFUSED',
          FailureReason.damaged => 'DAMAGED',
          FailureReason.riderIncident => 'RIDER_INCIDENT',
          FailureReason.other => 'OTHER',
        },
        'detail': ?detail,
        'evidenceRefs': [?state.photoRef],
        'contactAttempts': [
          for (final c in state.contacts)
            {
              'attemptedAt': c.attemptedAt.toIso8601String(),
              'answered': c.answered,
            },
        ],
      });
}

/// 전달 불가 사유 → 지원센터 대화를 열 때의 도움요청 유형.
HelpCategory helpCategoryForFailure(FailureReason r) => switch (r) {
  FailureReason.customerAbsent ||
  FailureReason.unreachable ||
  FailureReason.refused => HelpCategory.customerUnreachable,
  FailureReason.addressError => HelpCategory.addressIssue,
  FailureReason.damaged => HelpCategory.goodsIssue,
  FailureReason.riderIncident => HelpCategory.accident,
  FailureReason.other => HelpCategory.other,
};

/// 연락 기록이 2회 이상 필요한 고객 사유(백엔드 안내 2026-11-13 §3).
bool needsContactAttempts(FailureReason r) => switch (r) {
  FailureReason.customerAbsent ||
  FailureReason.unreachable ||
  FailureReason.addressError ||
  FailureReason.refused => true,
  _ => false,
};

/// 지원센터에 보낸 도움요청 한 건.
@immutable
class HelpTicket {
  const HelpTicket({
    required this.key,
    required this.category,
    required this.sentAt,
    this.detail,
    this.state,
    this.caseId,
    this.photo,
  });

  /// 함께 보낸 사진(이 기기에서 찍은 것 — 메모리에만, 대화에서 "사진"을 누르면 보인다).
  final LocalPhoto? photo;

  /// 요청 ID(= 멱등 키). 같은 요청을 다시 보낼 때만 같은 키다.
  final IdempotencyKey key;
  final HelpCategory category;
  final String? detail;
  final DateTime sentAt;

  /// 처리 상태. null 이면 아직 접수 확인 전.
  final HelpState? state;

  /// 지원센터(사건함) 접수번호 — 사건이 열린 뒤에만.
  final String? caseId;

  HelpTicket withStatus(HelpStatusView s) => HelpTicket(
    key: key,
    category: category,
    sentAt: sentAt,
    detail: detail,
    state: s.state,
    caseId: s.caseId ?? caseId,
    photo: photo,
  );
}

@immutable
class HelpFlowState {
  const HelpFlowState({
    this.tickets = const [],
    this.sending = false,
    this.rejectedCode,
  });

  /// 이 배송에서 보낸 도움요청(오래된 것부터).
  final List<HelpTicket> tickets;
  final bool sending;

  /// 방금 보낸 도움요청을 서버가 거절했다(4xx — 접수되지 않음). 값은 Problem code(없으면 빈 글자).
  /// 거절된 요청은 "보낸 요청"에 남기지 않는다 — 보낸 것처럼 보이면 안 된다(사용자 2026-11-19 "백오피스에 안 떠").
  final String? rejectedCode;

  HelpTicket? get last => tickets.lastOrNull;

  /// 마지막 도움요청의 처리 상태. null 이면 아직 보내지 않았다.
  HelpState? get state => last?.state;
  IdempotencyKey? get key => last?.key;
  HelpCategory? get category => last?.category;
  int get sentCount => tickets.length;
}

/// 배송별 도움요청 기록. 배송 화면·지원센터 화면을 오가도 남는다(앱을 끄면 지워진다 —
/// 라이더용 도움요청 목록 API 가 없다, 백엔드 요청 중).
final helpFlowProvider =
    NotifierProvider.family<HelpFlowController, HelpFlowState, String>(
      HelpFlowController.new,
    );

/// 도움요청 → 지원센터(delivery-execution 기록 → case-service RIDER_HELP 사건 → 백오피스 사건함).
/// 새로 보낼 때마다 새 요청(새 키)이다. 접수 결과를 모르는 같은 내용만 같은 키로 다시 보낸다
/// (사건이 두 번 생기지 않게). 처리된 뒤에도 다른 도움요청을 보낼 수 있다.
class HelpFlowController extends Notifier<HelpFlowState> {
  HelpFlowController(this.deliveryId);

  final String deliveryId;

  @override
  HelpFlowState build() => const HelpFlowState();

  Future<void> send(
    HelpCategory category, {
    String? detail,
    List<String>? evidenceRefs,
    LocalPhoto? photo,
  }) async {
    if (state.sending) return;
    final text = detail?.trim();
    final note = text == null || text.isEmpty ? null : text;
    final last = state.last;
    final retry =
        last != null &&
        last.state == HelpState.unknown &&
        last.category == category &&
        last.detail == note;
    final ticket = retry
        ? last
        : HelpTicket(
            key: IdempotencyKey.generate(),
            category: category,
            detail: note,
            sentAt: DateTime.now(),
            photo: photo,
          );
    final others = retry
        ? state.tickets.sublist(0, state.tickets.length - 1)
        : state.tickets;
    state = HelpFlowState(tickets: [...others, ticket], sending: true);
    final repo = ref.read(deliveryRepositoryProvider);
    var sent = false;
    for (var i = 0; i < 3 && !sent; i++) {
      try {
        await repo.requestHelp(
          deliveryId,
          category,
          detail: note,
          evidenceRefs: evidenceRefs,
          key: ticket.key,
        );
        sent = true;
      } on UnknownResultFailure {
        continue;
      } on ProblemFailure catch (f) {
        // 서버가 거절(4xx) — 접수되지 않았다. "접수 확인 중"으로 남기지 않고 실패로 알린다
        // (전에는 상태 조회 404 → "확인하는 중"으로 남아 보낸 것처럼 보였다, 2026-11-19).
        final status = f.problem.status;
        if (status >= 400 && status < 500 && status != 408 && status != 429) {
          if (!ref.mounted) return;
          // 기다리는 사이 받은 다른 요청의 상태 변화는 살리고, 이 요청만 뺀다.
          state = HelpFlowState(
            tickets: [
              for (final x in state.tickets)
                if (x.key.value != ticket.key.value) x,
            ],
            rejectedCode: f.problem.code,
          );
          // 409(배송이 끝났거나 단계가 바뀜) — 배송을 다시 읽어 화면을 서버 상태로 맞춘다.
          ref.invalidate(deliveryProvider(deliveryId));
          return;
        }
        break;
      } on PmartFailure {
        break;
      }
    }
    if (!ref.mounted) return;
    // 접수 응답을 끝내 못 받았어도 상태 조회로 확인한다(새 요청을 만들지 않는다).
    final s = await repo.helpStatus(deliveryId, ticket.key);
    if (ref.mounted) _replace(ticket.withStatus(s), sending: false);
  }

  /// 서버가 대신 연 도움요청(전달 불가 신고가 연 대화, execution 0.14.0)을 이 배송의 요청으로 넣는다.
  /// 이미 있으면 그대로 둔다.
  void adopt(HelpTicket t) {
    if (state.tickets.any((x) => x.key.value == t.key.value)) return;
    state = HelpFlowState(
      tickets: [...state.tickets, t],
      sending: state.sending,
    );
  }

  bool _refreshing = false;

  /// 서버의 지난 도움요청 목록을 한 번 받아 합쳤다(앱을 다시 켠 뒤).
  bool _restored = false;

  /// 아직 처리되지 않은 도움요청의 상태를 다시 조회한다. 겹쳐 부르면 건너뛴다(늦은 응답이 새 상태를 되돌리지 않게).
  Future<void> refresh() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      await _refresh();
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _refresh() async {
    final repo = ref.read(deliveryRepositoryProvider);
    // 앱을 다시 켰으면 보낸 도움요청을 서버 목록에서 되찾는다(execution 0.7.0).
    if (!_restored) {
      try {
        final records = await repo.helpRequests(deliveryId);
        if (!ref.mounted) return;
        _restored = true;
        // 서버 목록을 앞에, 그 사이 이 앱이 보낸 요청은 뒤에 — 키로 합친다(전에는 읽는 동안 하나라도 보내면
        // 서버 목록을 버려 예전 요청이 영영 안 보였다).
        final local = {for (final t in state.tickets) t.key.value: t};
        final merged = [
          for (final r in records)
            local.remove(r.requestId) ??
                HelpTicket(
                  key: IdempotencyKey(r.requestId),
                  category: r.category,
                  detail: r.detail,
                  sentAt: r.sentAt,
                  state: r.state,
                  caseId: r.caseId,
                ),
          ...state.tickets.where((t) => local.containsKey(t.key.value)),
        ];
        state = HelpFlowState(
          tickets: merged,
          sending: state.sending,
          rejectedCode: state.rejectedCode,
        );
      } on PmartFailure {
        // 목록을 못 읽으면 빈 목록으로 단정하지 않는다 — 다음에 다시.
        return;
      }
    }
    for (final t in state.tickets) {
      if (t.state == HelpState.resolved) continue;
      final s = await repo.helpStatus(deliveryId, t.key);
      if (!ref.mounted) return;
      _replace(t.withStatus(s));
    }
  }

  void _replace(HelpTicket t, {bool? sending}) {
    state = HelpFlowState(
      tickets: [
        for (final x in state.tickets) x.key.value == t.key.value ? t : x,
      ],
      sending: sending ?? state.sending,
    );
  }
}

/// 대화 한 줄기 = 도움요청 한 건.
typedef SupportThreadId = ({String deliveryId, String requestId});

@immutable
class SupportThreadState {
  const SupportThreadState({
    this.messages = const [],
    this.loaded = false,
    this.unavailable = false,
    this.failed = false,
    this.sending = false,
    this.missing = false,
    this.closedOnSend = false,
  });

  final List<SupportMessage> messages;
  final bool loaded;

  /// 볼 수 없는 요청(404 — 없거나 다른 라이더의 것). 확인을 멈추고 입력을 막는다.
  final bool missing;

  /// 보내는 순간 지원센터가 처리를 끝냈다(409 HELP_REQUEST_CLOSED) — 보내지 못했다.
  final bool closedOnSend;

  /// 실서버: 대화 API 가 없다.
  final bool unavailable;

  /// 마지막 조회·보내기가 실패했다(빈 대화로 보이지 않게 구분한다).
  final bool failed;
  final bool sending;

  SupportThreadState copyWith({
    List<SupportMessage>? messages,
    bool? loaded,
    bool? unavailable,
    bool? failed,
    bool? sending,
    bool? missing,
    bool? closedOnSend,
  }) => SupportThreadState(
    messages: messages ?? this.messages,
    loaded: loaded ?? this.loaded,
    unavailable: unavailable ?? this.unavailable,
    failed: failed ?? this.failed,
    sending: sending ?? this.sending,
    missing: missing ?? this.missing,
    closedOnSend: closedOnSend ?? this.closedOnSend,
  );
}

final supportThreadProvider = NotifierProvider.autoDispose
    .family<SupportThreadController, SupportThreadState, SupportThreadId>(
      SupportThreadController.new,
    );

/// 지원센터 상담 대화. 보내지 못한 같은 글을 다시 보낼 때만 같은 키다.
class SupportThreadController extends Notifier<SupportThreadState> {
  SupportThreadController(this.id);

  final SupportThreadId id;
  IdempotencyKey? _pendingKey;
  String? _pendingText;

  @override
  SupportThreadState build() => const SupportThreadState();

  SupportThreadRepository get _repo =>
      ref.read(supportThreadRepositoryProvider);

  int _gen = 0;

  /// 대화와 처리 상태를 새로 받는다. 늦게 온 예전 응답은 버린다(보낸 직후 다시 읽은 것을 덮지 않게).
  Future<void> load() async {
    if (state.missing) return;
    final gen = ++_gen;
    try {
      final messages = await _repo.threadMessages(id.deliveryId, id.requestId);
      if (!ref.mounted || gen != _gen) return;
      state = state.copyWith(messages: messages, loaded: true, failed: false);
    } on SupportThreadUnavailable {
      if (ref.mounted) state = state.copyWith(loaded: true, unavailable: true);
    } on PmartFailure catch (f) {
      if (f is ProblemFailure && f.problem.status == 404) {
        if (ref.mounted) state = state.copyWith(loaded: true, missing: true);
        return;
      }
      if (ref.mounted && gen == _gen) {
        state = state.copyWith(loaded: true, failed: true);
      }
    }
    if (ref.mounted) {
      await ref.read(helpFlowProvider(id.deliveryId).notifier).refresh();
    }
  }

  /// 보냈으면 true.
  Future<bool> send(String text) async {
    final t = text.trim();
    if (t.isEmpty || state.sending) return false;
    final key = t == _pendingText && _pendingKey != null
        ? _pendingKey!
        : IdempotencyKey.generate();
    _pendingKey = key;
    _pendingText = t;
    state = state.copyWith(sending: true, closedOnSend: false);
    try {
      await _repo.sendMessage(id.deliveryId, id.requestId, t, key: key);
      _pendingKey = null;
      _pendingText = null;
      if (!ref.mounted) return true;
      state = state.copyWith(sending: false);
      await load();
      return true;
    } on SupportThreadUnavailable {
      if (ref.mounted) {
        state = state.copyWith(sending: false, unavailable: true);
      }
      return false;
    } on UnknownResultFailure {
      // 들어갔는지 모른다 — 다시 읽어 내 말이 있으면 보낸 것으로(같은 키라 다시 보내도 하나).
      if (!ref.mounted) return false;
      state = state.copyWith(sending: false);
      await load();
      final arrived = state.messages.any(
        (m) => m.sender == SupportSender.rider && m.text == t,
      );
      if (arrived) {
        _pendingKey = null;
        _pendingText = null;
        return true;
      }
      if (ref.mounted) state = state.copyWith(failed: true);
      return false;
    } on PmartFailure catch (f) {
      if (f is ProblemFailure && f.problem.code == helpRequestClosedCode) {
        // 보내는 순간 처리 완료됐다 — 일반 실패가 아니다. 상태를 바로 다시 받아 입력칸을 닫는다.
        _pendingKey = null;
        if (!ref.mounted) return false;
        state = state.copyWith(sending: false, closedOnSend: true);
        await ref.read(helpFlowProvider(id.deliveryId).notifier).refresh();
        return false;
      }
      if (f is ProblemFailure && f.problem.status == 404) {
        if (ref.mounted) state = state.copyWith(sending: false, missing: true);
        return false;
      }
      if (ref.mounted) state = state.copyWith(sending: false, failed: true);
      return false;
    }
  }
}

/// 처리가 끝난 도움요청에 보냄(execution postHelpRequestMessage 409).
const helpRequestClosedCode = 'HELP_REQUEST_CLOSED';

/// 반납 인증번호를 틀렸을 때 남은 횟수(배송별) — 저장소가 기록하고 배송 화면이 거절 알림에 쓴다.
final returnAttemptsProvider = Provider<ReturnAttempts>(
  (_) => ReturnAttempts(),
);
