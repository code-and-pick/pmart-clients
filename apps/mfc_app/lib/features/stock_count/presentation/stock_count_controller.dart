import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../../../shared/field_repositories.dart';
import '../../../shared/product_hints.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../domain/stock_count.dart';

enum CountPhase {
  loading,

  /// 칸으로 가서 칸 바코드를 찍는다.
  goTo,

  /// 칸의 상품을 스캔해 센다(장부 수량은 보이지 않는다).
  counting,

  /// 다 세고 제출 전 확인.
  review,

  /// 제출 뒤 서버 결과(일치·재계수 필요·승인 대기).
  result,

  /// 칸에 갈 수 없어 문제를 보고했다.
  reported,

  /// 이 작업자는 셀 수 없다(재계수는 다른 사람).
  notMine,
  loadError,
}

/// 상품 스캔 결과.
/// chooseLot = 이 칸에 같은 상품의 소비기한이 다른 묶음이 있어 어느 것인지 골라야 한다.
/// extra = 계수표에 없는 상품(잘못 놓인 재고)으로 따로 센다.
enum CountScan { ok, chooseLot, extra, notCounting }

@immutable
class CountFlowState {
  const CountFlowState({
    this.phase = CountPhase.loading,
    this.session,
    this.locIndex = 0,
    this.counts = const {},
    this.extras = const {},
    this.lotChoice = const {},
    this.chooseFor,
    this.lastScan,
    this.busy = false,
    this.unknown = false,
    this.code,
    this.wrongPlace = false,
  });

  final CountPhase phase;
  final CountSessionView? session;

  /// 지금 세는 칸 순서.
  final int locIndex;

  /// 줄 key → 센 수량. 없으면 아직 안 셈.
  final Map<String, int> counts;

  /// 계수표 밖 상품. key = 칸|바코드.
  final Map<String, ExtraFind> extras;

  /// SKU → 지금 세는 묶음(줄 key). 같은 상품의 LOT 이 여럿일 때.
  final Map<String, String> lotChoice;

  /// 묶음을 골라야 하는 SKU(마지막 스캔은 아직 세지 않았다).
  final String? chooseFor;
  final CountScan? lastScan;
  final bool busy;
  final bool unknown;
  final String? code;
  final bool wrongPlace;

  List<String> get locations => session?.locationCodes ?? const [];
  String? get location =>
      locIndex < locations.length ? locations[locIndex] : null;

  List<CountSheetLine> linesAt(String loc) => [
    for (final l in session?.sheet ?? const <CountSheetLine>[])
      if (l.locationCode == loc) l,
  ];

  List<ExtraFind> extrasAt(String loc) => [
    for (final e in extras.values)
      if (e.locationCode == loc) e,
  ];

  /// 지금 칸의 줄을 모두 셌는지(0 도 직접 넣어야 센 것).
  bool get locationDone {
    final loc = location;
    return loc != null &&
        chooseFor == null &&
        linesAt(loc).every((l) => counts.containsKey(l.key));
  }

  CountFlowState copyWith({
    CountPhase? phase,
    CountSessionView? session,
    int? locIndex,
    Map<String, int>? counts,
    Map<String, ExtraFind>? extras,
    Map<String, String>? lotChoice,
    String? Function()? chooseFor,
    CountScan? Function()? lastScan,
    bool? busy,
    bool? unknown,
    String? Function()? code,
    bool? wrongPlace,
  }) => CountFlowState(
    phase: phase ?? this.phase,
    session: session ?? this.session,
    locIndex: locIndex ?? this.locIndex,
    counts: counts ?? this.counts,
    extras: extras ?? this.extras,
    lotChoice: lotChoice ?? this.lotChoice,
    chooseFor: chooseFor != null ? chooseFor() : this.chooseFor,
    lastScan: lastScan != null ? lastScan() : this.lastScan,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    code: code != null ? code() : this.code,
    wrongPlace: wrongPlace ?? this.wrongPlace,
  );
}

final countFlowProvider = NotifierProvider.autoDispose
    .family<CountController, CountFlowState, String>(CountController.new);

/// 실사 1회(세션): 칸마다 칸 확인 → 상품 스캔으로 세기(장부 비공개) → 전부 세면 확인 → 제출 → 서버 판정.
class CountController extends Notifier<CountFlowState> {
  CountController(this.sessionId);

  final String sessionId;
  IdempotencyKey? _key;

  @override
  CountFlowState build() {
    Future.microtask(load);
    return const CountFlowState();
  }

  CountFlowState get current => state;

  String get _mfc => ref.read(currentMfcIdProvider);

  ProductHints get _hints => ref.read(productHintsProvider);

  /// 줄 상품 바코드 — 서버 값(mfc-inventory 0.16.0) 먼저, 없으면 상품 정보. 모르면 null — 그 줄은 수량을
  /// 직접 넣는다.
  String? barcodeOf(CountSheetLine l) =>
      l.barcodes.firstOrNull ?? _hints.bySku(l.sku)?.barcode;

  String? nameOf(CountSheetLine l) =>
      l.productName ?? _hints.bySku(l.sku)?.name;

  Future<void> load() async {
    try {
      final s = await ref
          .read(stockCountRepositoryProvider)
          .session(_mfc, sessionId);
      if (!ref.mounted) return;
      final me = ref.read(currentWorkerIdProvider);
      state = state.copyWith(
        session: s,
        phase: switch (s.state) {
          CountState.counting ||
          CountState.recountRequired when s.canCount(me) => CountPhase.goTo,
          CountState.counting ||
          CountState.recountRequired => CountPhase.notMine,
          _ => CountPhase.result,
        },
      );
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(phase: CountPhase.loadError);
    }
  }

  /// 칸 바코드. 지금 칸이면 세기 시작.
  bool scanLocation(String code) {
    final ok = code.trim() == state.location;
    state = state.copyWith(
      wrongPlace: !ok,
      phase: ok ? CountPhase.counting : state.phase,
    );
    return ok;
  }

  void _add(String key) => state = state.copyWith(
    counts: {...state.counts, key: (state.counts[key] ?? 0) + 1},
  );

  /// 상품 바코드 하나 = 1개.
  CountScan scanProduct(String code) {
    final loc = state.location;
    if (state.phase != CountPhase.counting || state.unknown || loc == null) {
      return CountScan.notCounting;
    }
    final c = code.trim();
    final lines = [
      for (final l in state.linesAt(loc))
        if (l.matchesBarcode(c) || barcodeOf(l) == c) l,
    ];
    final CountScan r;
    if (lines.isEmpty) {
      // 계수표 밖 — 잘못 놓인 재고. 바코드를 모르는 상품도 따로 센다.
      final hit = _hints.byBarcode(c);
      final k = '$loc|$c';
      final prev = state.extras[k];
      state = state.copyWith(
        extras: {
          ...state.extras,
          k: ExtraFind(
            locationCode: loc,
            barcode: c,
            sku: hit?.$1,
            productName: hit?.$2.name,
            qty: (prev?.qty ?? 0) + 1,
          ),
        },
      );
      r = CountScan.extra;
    } else if (lines.length == 1) {
      _add(lines.single.key);
      r = CountScan.ok;
    } else if (state.lotChoice[lines.first.sku] case final k?) {
      _add(k);
      r = CountScan.ok;
    } else {
      state = state.copyWith(chooseFor: () => lines.first.sku);
      r = CountScan.chooseLot;
    }
    state = state.copyWith(lastScan: () => r);
    return r;
  }

  /// 소비기한으로 묶음을 고른다 — 방금 스캔한 1개를 그 묶음에 센다. 다음 스캔도 그 묶음.
  void chooseLot(CountSheetLine l) {
    final pending = state.chooseFor == l.sku;
    state = state.copyWith(
      lotChoice: {...state.lotChoice, l.sku: l.key},
      chooseFor: () => null,
    );
    if (pending) _add(l.key);
  }

  void setCount(CountSheetLine l, int qty) {
    if (state.unknown) return;
    state = state.copyWith(counts: {...state.counts, l.key: qty});
  }

  void setExtra(ExtraFind e, int qty) {
    final next = {...state.extras};
    if (qty <= 0) {
      next.remove(e.key);
    } else {
      next[e.key] = ExtraFind(
        locationCode: e.locationCode,
        barcode: e.barcode,
        sku: e.sku,
        productName: e.productName,
        qty: qty,
      );
    }
    state = state.copyWith(extras: next);
  }

  /// 다음 칸 또는 확인으로.
  void nextLocation() {
    if (!state.locationDone) return;
    state = state.locIndex + 1 < state.locations.length
        ? state.copyWith(
            locIndex: state.locIndex + 1,
            phase: CountPhase.goTo,
            wrongPlace: false,
            lotChoice: const {},
            lastScan: () => null,
          )
        : state.copyWith(phase: CountPhase.review);
  }

  void back() {
    if (state.unknown) return;
    state = state.copyWith(phase: CountPhase.counting);
  }

  /// 칸에 갈 수 없어 보고했다 — 이 실사는 관리자가 다시 배정한다(R19 7).
  void reported() => state = state.copyWith(phase: CountPhase.reported);

  Future<void> submit() async {
    final s = state.session;
    if (s == null || state.busy) return;
    state = state.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await ref
        .read(stockCountRepositoryProvider)
        .submit(
          _mfc,
          sessionId,
          [
            for (final l in s.sheet)
              CountedLine(line: l, countedQty: state.counts[l.key] ?? 0),
          ],
          key: key,
          extras: state.extras.values.toList(),
        );
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          session: value,
          phase: CountPhase.result,
        );
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          code: () => code,
          phase: code == CountProblemCode.sameCounter
              ? CountPhase.notMine
              : state.phase,
        );
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }
}
