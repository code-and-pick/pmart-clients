import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/codes.dart';
import '../../../shared/field_outcome.dart';
import '../../../shared/field_repositories.dart';
import '../../../shared/product_hints.dart';
import '../../quality/domain/quality.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../domain/stock_move.dart';

/// 스캔 결과. 칸·카트·상품을 한 입력칸에서 받는다.
/// needCart = 카트를 먼저, needFrom = 출발 칸을 먼저, needLoad = 상품을 다 실었다고 누른 뒤에 도착 칸을,
/// wrongItem = 지시 상품이 아님, over = 옮길 양을 넘음.
enum LocScan {
  ok,
  wrongPlace,
  notLocation,
  needCart,
  needFrom,
  needLoad,
  wrongItem,
  over,
}

// ───────────────────────── 이동·보충 지시 ─────────────────────────

enum MovePhase { loading, pickUp, drop, done, cancelled, reported, loadError }

@immutable
class MoveFlowState {
  const MoveFlowState({
    this.phase = MovePhase.loading,
    this.move,
    this.atFrom = false,
    this.atTo = false,
    this.cart,
    this.qty = 0,
    this.busy = false,
    this.unknown = false,
    this.code,
    this.lastScan,
  });

  final MovePhase phase;
  final MoveOrderView? move;

  /// 출발 칸 바코드를 찍었다.
  final bool atFrom;

  /// 도착 칸(취소 뒤에는 출발 칸) 바코드를 찍었다.
  final bool atTo;

  /// 찍은 카트(`CRT-…`).
  final String? cart;
  final int qty;
  final bool busy;
  final bool unknown;
  final String? code;
  final LocScan? lastScan;

  MoveFlowState copyWith({
    MovePhase? phase,
    MoveOrderView? move,
    bool? atFrom,
    bool? atTo,
    String? Function()? cart,
    int? qty,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    LocScan? Function()? lastScan,
  }) => MoveFlowState(
    phase: phase ?? this.phase,
    move: move ?? this.move,
    atFrom: atFrom ?? this.atFrom,
    atTo: atTo ?? this.atTo,
    cart: cart != null ? cart() : this.cart,
    qty: qty ?? this.qty,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
  );
}

final moveFlowProvider = NotifierProvider.autoDispose
    .family<MoveController, MoveFlowState, String>(MoveController.new);

/// 이동·보충 지시 1건: 카트 스캔 → 출발 칸 확인 → 상품 스캔(수량) → 집어 올리기 → 도착 칸 확인 → 내려놓기.
class MoveController extends Notifier<MoveFlowState> {
  MoveController(this.moveId);

  final String moveId;
  IdempotencyKey? _key;

  MoveFlowState get current => state;

  @override
  MoveFlowState build() {
    Future.microtask(load);
    return const MoveFlowState();
  }

  MoveFlowState _phaseFor(MoveOrderView m, MoveFlowState s) {
    if (m.state == MoveState.completed) {
      return s.copyWith(phase: MovePhase.done, move: m);
    }
    if (m.state == MoveState.cancelled) {
      return s.copyWith(phase: MovePhase.cancelled, move: m);
    }
    if (m.onCartQty > 0) {
      return s.copyWith(
        phase: MovePhase.drop,
        move: m,
        qty: m.onCartQty,
        cart: () => m.cartLocation ?? s.cart,
      );
    }
    if (m.toPick > 0) {
      // 수량은 상품을 스캔해 센다(0부터). 상품 바코드를 모르면 직접 넣는다.
      return s.copyWith(
        phase: MovePhase.pickUp,
        move: m,
        qty: s.phase == MovePhase.pickUp ? s.qty : 0,
      );
    }
    return s.copyWith(phase: MovePhase.done, move: m);
  }

  Future<void> load() async {
    try {
      final m = await ref.read(stockMoveRepositoryProvider).move(moveId);
      if (ref.mounted) state = _phaseFor(m, state);
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: MovePhase.loadError);
    }
  }

  /// 지시 상품 바코드 — 서버 값(mfc-inbound 0.9.0) 먼저, 없으면 상품 정보. 모르면 null — 상품 확인 없이
  /// 수량을 직접 넣는다.
  String? get productBarcode {
    final m = state.move;
    if (m == null) return null;
    return m.barcode ?? ref.read(productHintsProvider).bySku(m.sku)?.barcode;
  }

  String? get productName {
    final m = state.move;
    if (m == null) return null;
    return m.productName ?? ref.read(productHintsProvider).bySku(m.sku)?.name;
  }

  /// 집기 단계에서 카트와 출발 칸을 둘 다 찍었다 → 상품을 스캔해 싣는 쪽으로 넘어간다.
  bool get located => state.cart != null && state.atFrom;

  /// 스캔(사용자 2026-11-13 순서). 집기 단계는 카트 → 출발 칸(여기까지 위치 확인) → 상품(1개씩),
  /// 내려놓기 단계는 도착 칸. 카트를 찍기 전에는 출발 칸을 받지 않는다.
  LocScan scan(String code) {
    final m = state.move;
    final c = code.trim();
    if (m == null || state.unknown) return LocScan.notLocation;
    final bc = productBarcode;
    final LocScan r;
    if (state.phase == MovePhase.pickUp && isCartLocation(c)) {
      // 카트는 싣기 전까지 다시 찍어 바꿀 수 있다.
      state = state.copyWith(cart: () => c);
      r = LocScan.ok;
    } else if (state.phase == MovePhase.pickUp && state.cart == null) {
      r = LocScan.needCart;
    } else if (state.phase == MovePhase.pickUp && !state.atFrom) {
      if (!isMfcLocation(c)) {
        r = LocScan.needFrom;
      } else if (c == m.fromLocation) {
        state = state.copyWith(atFrom: true);
        r = LocScan.ok;
      } else {
        r = LocScan.wrongPlace;
      }
    } else if (state.phase == MovePhase.pickUp) {
      // 위치 확인이 끝났다 — 상품을 하나씩 센다.
      if (isMfcLocation(c)) {
        r = c == m.fromLocation ? LocScan.ok : LocScan.wrongPlace;
      } else if (bc == null) {
        r = LocScan.notLocation;
      } else if (!(m.matchesBarcode(c) || c == bc)) {
        r = LocScan.wrongItem;
      } else if (state.qty >= m.toPick) {
        r = LocScan.over;
      } else {
        state = state.copyWith(qty: state.qty + 1);
        r = LocScan.ok;
      }
    } else if (!isMfcLocation(c)) {
      r = LocScan.notLocation;
    } else if (state.phase == MovePhase.drop && c == m.dropTarget) {
      state = state.copyWith(atTo: true);
      r = LocScan.ok;
    } else {
      r = LocScan.wrongPlace;
    }
    state = state.copyWith(lastScan: () => r);
    return r;
  }

  void setQty(int q) {
    if (!state.unknown) state = state.copyWith(qty: q);
  }

  bool get canPickUp =>
      state.atFrom && state.cart != null && state.qty > 0 || state.unknown;

  /// 문제를 보고했다 — 이 지시는 관리자가 처리한다(서버 처리 방식은 R19 7 회신 대기).
  void reported() => state = state.copyWith(phase: MovePhase.reported);

  bool get canDrop => state.atTo && state.qty > 0 || state.unknown;

  Future<void> submit() async {
    final m = state.move;
    if (m == null || state.busy) return;
    final picking = state.phase == MovePhase.pickUp;
    if (picking ? !canPickUp : !canDrop) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final repo = ref.read(stockMoveRepositoryProvider);
    final outcome = picking
        ? await repo.pickUp(
            moveId,
            cartLocation: state.cart!,
            qty: state.qty,
            key: key,
          )
        : await repo.drop(
            moveId,
            toLocation: m.dropTarget,
            qty: state.qty,
            key: key,
          );
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        state = _phaseFor(
          value,
          state.copyWith(
            busy: false,
            unknown: false,
            atFrom: false,
            atTo: false,
            lastScan: () => null,
          ),
        );
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }
}

// ───────────────────────── 적치 ─────────────────────────

enum PutawayPhase { loading, editing, done, reported, notFound, loadError }

@immutable
class PutawayState {
  const PutawayState({
    this.phase = PutawayPhase.loading,
    this.task,
    this.to,
    this.atFrom = false,
    this.loaded = false,
    this.qty = 0,
    this.busy = false,
    this.unknown = false,
    this.code,
    this.lastScan,
  });

  final PutawayPhase phase;
  final InboundTaskView? task;

  /// 출발 위치(입고 구역)를 찍었다.
  final bool atFrom;

  /// 상품을 세어 실었다고 눌렀다 — 이제 도착 선반으로 간다(화면 안의 단계. 서버 호출 없음).
  final bool loaded;

  /// 찍은 도착 선반.
  final String? to;
  final int qty;
  final bool busy;
  final bool unknown;
  final String? code;
  final LocScan? lastScan;

  PutawayState copyWith({
    PutawayPhase? phase,
    InboundTaskView? task,
    String? Function()? to,
    bool? atFrom,
    bool? loaded,
    int? qty,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    LocScan? Function()? lastScan,
  }) => PutawayState(
    phase: phase ?? this.phase,
    task: task ?? this.task,
    to: to != null ? to() : this.to,
    atFrom: atFrom ?? this.atFrom,
    loaded: loaded ?? this.loaded,
    qty: qty ?? this.qty,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
  );
}

final putawayFlowProvider = NotifierProvider.autoDispose
    .family<PutawayController, PutawayState, String>(PutawayController.new);

/// 적치 1건(입고 작업 PUTAWAY) — 이동·보충과 같은 순서(사용자 2026-11-13):
/// 출발 위치 확인 → 상품 스캔(수량) → "실었어요" → 도착 선반 스캔 → 적치. 나눠 놓으면 남은 양으로 다시.
/// 카트 스캔은 없다 — 적치 계약(`putaways`)에 카트가 없다.
/// 목적지 검사(등록·온도대·구역)는 서버(mfc-inventory)가 한다.
class PutawayController extends Notifier<PutawayState> {
  PutawayController(this.taskId);

  final String taskId;
  IdempotencyKey? _key;

  PutawayState get current => state;

  @override
  PutawayState build() {
    Future.microtask(load);
    return const PutawayState();
  }

  Future<void> load() async {
    try {
      final list = await ref
          .read(qualityRepositoryProvider)
          .inboundTasks(
            ref.read(currentMfcIdProvider),
            kind: InboundTaskKind.putaway,
          );
      if (!ref.mounted) return;
      final t = list.where((t) => t.taskId == taskId).firstOrNull;
      state = t == null
          ? state.copyWith(phase: PutawayPhase.notFound)
          : state.copyWith(phase: PutawayPhase.editing, task: t, qty: 0);
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: PutawayPhase.loadError);
    }
  }

  String? get productBarcode {
    final t = state.task;
    if (t == null) return null;
    return t.barcode ?? ref.read(productHintsProvider).bySku(t.sku)?.barcode;
  }

  /// 출발 위치 → 상품(1개씩) → (실었어요) → 도착 칸. 추천 칸이 아니어도 받는다(진열 판정은 서버).
  LocScan scan(String code) {
    final t = state.task;
    final c = code.trim();
    if (state.unknown || t == null) return LocScan.notLocation;
    final bc = productBarcode;
    final LocScan r;
    if (!state.atFrom) {
      r = c == t.locationCode
          ? LocScan.ok
          : isMfcLocation(c)
          ? LocScan.wrongPlace
          : LocScan.needFrom;
      if (r == LocScan.ok) state = state.copyWith(atFrom: true);
    } else if (!state.loaded) {
      // 상품 싣기: 상품만 센다. 도착 칸은 "실었어요" 뒤에 받는다.
      if (isMfcLocation(c)) {
        r = c == t.locationCode ? LocScan.ok : LocScan.needLoad;
      } else if (bc == null) {
        r = LocScan.notLocation;
      } else if (!(t.matchesBarcode(c) || c == bc)) {
        r = LocScan.wrongItem;
      } else if (state.qty >= t.remainingQty) {
        r = LocScan.over;
      } else {
        state = state.copyWith(qty: state.qty + 1);
        r = LocScan.ok;
      }
    } else if (isMfcLocation(c) && !isCartLocation(c) && c != t.locationCode) {
      state = state.copyWith(to: () => c);
      r = LocScan.ok;
    } else {
      r = LocScan.notLocation;
    }
    state = state.copyWith(lastScan: () => r);
    return r;
  }

  void reported() => state = state.copyWith(phase: PutawayPhase.reported);

  void setQty(int q) {
    if (!state.unknown) state = state.copyWith(qty: q);
  }

  /// 상품을 다 실었다 → 도착 선반으로(화면 안의 단계).
  void markLoaded() {
    if (state.unknown || !state.atFrom || state.qty < 1) return;
    state = state.copyWith(loaded: true, lastScan: () => null);
  }

  /// 수량을 다시 센다 → 상품 싣기로 돌아간다.
  void recount() {
    if (state.unknown || state.busy) return;
    state = state.copyWith(loaded: false, to: () => null, lastScan: () => null);
  }

  Future<void> submit() async {
    final t = state.task;
    if (t == null || state.busy) return;
    if (!state.unknown && (state.to == null || state.qty < 1)) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await ref
        .read(qualityRepositoryProvider)
        .putaway(taskId, toLocationCode: state.to!, qty: state.qty, key: key);
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        final next = value.task;
        state = next == null || next.completed || next.remainingQty <= 0
            ? state.copyWith(
                phase: PutawayPhase.done,
                busy: false,
                unknown: false,
              )
            : state.copyWith(
                task: next,
                qty: 0,
                loaded: false,
                to: () => null,
                busy: false,
                unknown: false,
                lastScan: () => null,
              );
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }
}
