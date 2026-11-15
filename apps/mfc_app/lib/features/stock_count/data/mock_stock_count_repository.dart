import 'package:pmart_core/pmart_core.dart';

import '../../../shared/field_outcome.dart';
import '../domain/stock_count.dart';
import 'stock_count_repository.dart';

/// 목: 위치마다 장부 2줄. 첫 계수가 장부와 같으면 MATCHED, 다르면 RECOUNT_REQUIRED(다른 작업자),
/// 재계수가 다르면 PENDING_APPROVAL. 계수자는 [counter] 로 바꿔 본다(실서버는 토큰 주체).
final class MockStockCountRepository implements StockCountRepository {
  MockStockCountRepository({
    this.latency = const Duration(milliseconds: 300),
    bool seed = true,
  }) {
    // 목: 센터 관리자가 시작해 둔 실사 1건(선반 2칸) — 실사 배정은 계약에 없다(BR-52 R14).
    if (seed) {
      _seed(const ['A-S3-01-1-10', 'C-S1-02-2-05']);
      _seedPendingApproval();
    }
  }

  /// 목: 두 작업자가 세어 차이가 남은 실사(승인 대기) — 센터 관리자 승인 화면용.
  void _seedPendingApproval() {
    const line = CountSheetLine(
      locationCode: 'A-S3-02-1-01',
      sku: 'E-00000005',
      lotId: 'LOT-C-0901',
      expiryDate: '2027-03-01',
    );
    _book[line.key] = 12;
    final s = CountSessionView(
      sessionId: 'CNT-mock-${++_seq}',
      state: CountState.pendingApproval,
      locationCodes: const ['A-S3-02-1-01'],
      sheet: const [line],
      differences: const [
        CountDifference(line: line, bookQty: 12, countedQty: 10, deltaQty: -2),
      ],
      firstCounter: 'OP-mock-1',
      recounter: 'OP-mock-2',
      version: 3,
    );
    _sessions[s.sessionId] = s;
  }

  /// 목 실사 번호(센터 관리자 목록 — 실서버는 목록 API 가 없다, MB-1).
  Iterable<String> get sessionIds => _sessions.keys;

  /// 승인하는 사람(실서버는 토큰 주체). 실사를 시작·계수한 사람이면 SELF_APPROVAL.
  String approver = 'OP-mock-sup';

  void _seed(List<String> locs) {
    final sheet = [
      for (final loc in locs) ...[
        CountSheetLine(
          locationCode: loc,
          sku: 'E-00000001',
          lotId: 'LOT-M-1022',
          expiryDate: '2026-11-12',
        ),
        // 같은 우유의 다른 LOT(소비기한이 다름) — 작업자가 소비기한으로 나눠 센다.
        if (loc.startsWith('C-'))
          CountSheetLine(
            locationCode: loc,
            sku: 'E-00000001',
            lotId: 'LOT-M-1029',
            expiryDate: '2026-11-16',
          ),
        CountSheetLine(
          locationCode: loc,
          sku: 'E-00000005',
          lotId: 'LOT-C-0901',
          expiryDate: '2027-03-01',
        ),
      ],
    ];
    for (final l in sheet) {
      _book[l.key] = l.lotId == 'LOT-M-1029'
          ? 3
          : l.sku == 'E-00000001'
          ? 8
          : 12;
    }
    final s = CountSessionView(
      sessionId: 'CNT-mock-${++_seq}',
      state: CountState.counting,
      locationCodes: locs,
      sheet: sheet,
      version: 1,
    );
    _sessions[s.sessionId] = s;
  }

  /// 이 작업자가 셀 수 있는 실사(다음 작업 받기 목이 고른다).
  Iterable<CountSessionView> openFor(String workerId) =>
      _sessions.values.where((s) => s.canCount(workerId));

  /// 장부 수량(테스트 확인용).
  int bookOf(CountSheetLine l) => _book[l.key]!;

  final Duration latency;
  String counter = 'OP-mock-1';
  final _sessions = <String, CountSessionView>{};
  final _book = <String, int>{};
  final _keys = <String, FieldOutcome<CountSessionView>>{};
  int _seq = 0;

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<FieldOutcome<CountSessionView>> start(
    String mfcId, {
    required List<String> locationCodes,
    String? reason,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final sheet = [
      for (final loc in locationCodes) ...[
        CountSheetLine(
          locationCode: loc,
          sku: 'E-00000001',
          lotId: 'LOT-M-1022',
        ),
        CountSheetLine(
          locationCode: loc,
          sku: 'E-00000005',
          lotId: 'LOT-C-0901',
        ),
      ],
    ];
    for (final l in sheet) {
      _book[l.key] = l.sku == 'E-00000001' ? 8 : 12;
    }
    final s = CountSessionView(
      sessionId: 'CNT-mock-${++_seq}',
      state: CountState.counting,
      locationCodes: locationCodes,
      sheet: sheet,
      version: 1,
    );
    _sessions[s.sessionId] = s;
    return _keys[key.value] = FieldDone(s);
  }

  @override
  Future<FieldOutcome<CountSessionView>> decide(
    String mfcId,
    String sessionId, {
    required bool approve,
    String? approvalRef,
    String? note,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    final s = _sessions[sessionId];
    if (s == null) return const FieldRejected(ProblemCode.notFound);
    if (s.state != CountState.pendingApproval) {
      return const FieldRejected(ProblemCode.invalidState);
    }
    if (approver == s.firstCounter || approver == s.recounter) {
      return const FieldRejected(CountProblemCode.selfApproval);
    }
    if (approve && (approvalRef == null || approvalRef.trim().isEmpty)) {
      return const FieldRejected(CountProblemCode.approvalRequired);
    }
    final next = CountSessionView(
      sessionId: s.sessionId,
      state: approve ? CountState.adjusted : CountState.rejected,
      locationCodes: s.locationCodes,
      sheet: s.sheet,
      differences: s.differences,
      firstCounter: s.firstCounter,
      recounter: s.recounter,
      version: (s.version ?? 0) + 1,
    );
    _sessions[sessionId] = next;
    return _keys[key.value] = FieldDone(next);
  }

  /// 마지막 제출의 계수표 밖 상품(목만 받는다).
  List<ExtraFind> lastExtras = const [];

  @override
  Future<CountSessionView> session(String mfcId, String sessionId) async {
    await _wait();
    return _sessions[sessionId]!;
  }

  @override
  Future<FieldOutcome<CountSessionView>> submit(
    String mfcId,
    String sessionId,
    List<CountedLine> lines, {
    required IdempotencyKey key,
    List<ExtraFind> extras = const [],
  }) async {
    await _wait();
    if (_keys[key.value] case final o?) return o;
    lastExtras = extras;
    final s = _sessions[sessionId]!;
    if (s.state == CountState.recountRequired && s.firstCounter == counter) {
      return const FieldRejected(CountProblemCode.sameCounter);
    }
    if (!s.canCount(counter)) {
      return const FieldRejected(ProblemCode.invalidState);
    }
    final counted = {for (final l in lines) l.line.key: l.countedQty};
    final diffs = [
      for (final l in s.sheet)
        CountDifference(
          line: l,
          bookQty: _book[l.key]!,
          countedQty: counted[l.key] ?? 0,
          deltaQty: (counted[l.key] ?? 0) - _book[l.key]!,
        ),
    ];
    final same = diffs.every((d) => d.deltaQty == 0);
    final first = s.state == CountState.counting;
    final next = CountSessionView(
      sessionId: s.sessionId,
      state: same
          ? CountState.matched
          : first
          ? CountState.recountRequired
          : CountState.pendingApproval,
      locationCodes: s.locationCodes,
      sheet: s.sheet,
      // 재계수가 필요할 때는 아직 계수 중이라 차이를 보이지 않는다.
      differences: same || !first ? diffs : null,
      firstCounter: first ? counter : s.firstCounter,
      recounter: first ? null : counter,
      version: (s.version ?? 0) + 1,
    );
    _sessions[sessionId] = next;
    return _keys[key.value] = FieldDone(next);
  }
}
