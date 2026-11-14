import 'package:pmart_core/pmart_core.dart';

import '../domain/inbound.dart';
import 'inbound_repository.dart';

/// 목 입고 예정 2건. 도착 등록 → RECEIVING, 수령 → 접수(202) 뒤 조회 [applyPolls] 번째에 반영(TIN_POSTED).
/// 상품명·바코드는 계약에 없어 목만 준다(BR-53).
final class MockInboundRepository implements InboundRepository {
  /// 목 입고 예정 = 오전 차량 2대(MFC 업무 문서 §6 "매일 오전 차량 2대 이상", TMS §22 예시).
  /// - TRF-MOCK-001: 냉장 차량, 롤테이너 6개·120박스(TMS §22 부산진구 하차분과 같은 규모).
  /// - TRF-MOCK-002: 상온 차량, 롤테이너 4개·80박스.
  /// 합계 200박스 — MFC 기준안 하루 134박스·낙관 293박스 사이. 수량은 판매 단위(박스 × 입수).
  /// 상품명·바코드·박스·롤테이너 수는 계약에 없어 목만 준다(BR-53).
  /// [withBoxes] = false 면 박스 목록 없이(계약 그대로) — 상품별 계수 화면.
  MockInboundRepository({
    this.latency = const Duration(milliseconds: 300),
    this.withBoxes = true,
  }) {
    _add(
      'TRF-MOCK-001',
      const [
        InboundLine(
          sku: 'E-00000001',
          lotId: 'LOT-M-1110',
          productName: '서울우유 1L',
          barcodes: ['8801115114154'],
          unitsPerBox: 12,
          boxCount: 30,
          expectedQty: 360,
        ),
        InboundLine(
          sku: 'E-00000002',
          lotId: 'LOT-Y-1110',
          productName: '그릭요거트 플레인 400g',
          barcodes: ['8801115220015'],
          unitsPerBox: 12,
          boxCount: 20,
          expectedQty: 240,
        ),
        InboundLine(
          sku: 'E-00000011',
          lotId: 'LOT-T-1109',
          productName: '국산콩 두부 300g',
          barcodes: ['8801007001101'],
          unitsPerBox: 16,
          boxCount: 15,
          expectedQty: 240,
        ),
        InboundLine(
          sku: 'E-00000012',
          lotId: 'LOT-G-1109',
          productName: '무항생제 계란 10구',
          barcodes: ['8809001002112'],
          unitsPerBox: 10,
          boxCount: 15,
          expectedQty: 150,
        ),
        InboundLine(
          sku: 'E-00000013',
          lotId: 'LOT-Z-1105',
          productName: '슬라이스 치즈 180g',
          barcodes: ['8801115330013'],
          unitsPerBox: 20,
          boxCount: 10,
          expectedQty: 200,
        ),
        InboundLine(
          sku: 'E-00000014',
          lotId: 'LOT-J-1108',
          productName: '오렌지주스 1L',
          barcodes: ['8801056004014'],
          unitsPerBox: 12,
          boxCount: 15,
          expectedQty: 180,
        ),
        InboundLine(
          sku: 'E-00000015',
          lotId: 'LOT-S-1110',
          productName: '닭가슴살 샐러드',
          barcodes: ['8809002003115'],
          unitsPerBox: 8,
          boxCount: 15,
          expectedQty: 120,
        ),
      ],
      rollContainers: 6,
      zone: 'CHILLED',
      arrival: DateTime.utc(2026, 11, 9, 21), // 06:00 KST
    );
    _add(
      'TRF-MOCK-002',
      const [
        InboundLine(
          sku: 'E-00000005',
          lotId: 'LOT-C-1102',
          productName: '감자칩 오리지널 110g',
          barcodes: ['8801019606557'],
          unitsPerBox: 20,
          boxCount: 30,
          expectedQty: 600,
        ),
        InboundLine(
          sku: 'E-00000021',
          lotId: 'LOT-W-1101',
          productName: '생수 2L',
          barcodes: ['8801056021021'],
          unitsPerBox: 6,
          boxCount: 25,
          expectedQty: 150,
        ),
        InboundLine(
          sku: 'E-00000022',
          lotId: 'LOT-R-1020',
          productName: '컵라면 소컵 65g',
          barcodes: ['8801043022022'],
          unitsPerBox: 24,
          boxCount: 25,
          expectedQty: 600,
        ),
      ],
      rollContainers: 4,
      zone: 'AMBIENT',
      arrival: DateTime.utc(2026, 11, 9, 22), // 07:00 KST
    );
  }

  final Duration latency;
  final bool withBoxes;

  /// 수령 뒤 몇 번째 조회에서 반영되는지.
  int applyPolls = 1;

  /// 다음 수령 응답을 1회 잃는다(서버는 접수함).
  bool loseNextReceiptResponse = false;

  /// 재고 반영을 거절한다.
  bool rejectApply = false;

  final _promises = <String, InboundPromiseView>{};
  int _boxSeq = 0;
  final _receiptKeys = <String, String>{};
  final _receipts = <String, (String trfId, int polls, ReceiptView view)>{};
  final _arrivalKeys = <String>{};
  int _seq = 0;
  int receiptCalls = 0;

  /// 목 입고 예정 ID(다음 작업 받기 목이 고른다).
  Iterable<String> get trfIds => _promises.keys;
  InboundPromiseView peek(String trfId) => _promises[trfId]!;

  void _add(
    String id,
    List<InboundLine> lines, {
    required int rollContainers,
    required String zone,
    required DateTime arrival,
  }) => _promises[id] = InboundPromiseView(
    trfId: id,
    version: 1,
    state: PromiseState.expected,
    plannedArrivalAt: arrival,
    lines: lines,
    rollContainers: rollContainers,
    boxes: lines.fold(0, (s, l) => s! + (l.boxCount ?? 0)),
    temperatureZone: zone,
    boxList: [
      if (withBoxes)
        for (final l in lines)
          for (var i = 0; i < (l.boxCount ?? 0); i++)
            InboundBox(
              // CDC 발급 대역(00000001~49999999, 채번 지침 G-05).
              boxId: 'BOX-${(++_boxSeq).toString().padLeft(8, '0')}',
              lineKey: l.key,
              unitsPerBox: l.unitsPerBox ?? 1,
            ),
    ],
  );

  Future<void> _wait() => Future<void>.delayed(latency);

  InboundPromiseView _copy(
    InboundPromiseView p, {
    PromiseState? state,
    DateTime? arrivedAt,
    List<InboundLine>? lines,
    List<ReceiptView>? receipts,
  }) => InboundPromiseView(
    trfId: p.trfId,
    version: p.version + 1,
    state: state ?? p.state,
    plannedArrivalAt: p.plannedArrivalAt,
    eta: p.eta,
    arrivedAt: arrivedAt ?? p.arrivedAt,
    lines: lines ?? p.lines,
    receipts: receipts ?? p.receipts,
    rollContainers: p.rollContainers,
    boxes: p.boxes,
    temperatureZone: p.temperatureZone,
    boxList: p.boxList,
  );

  @override
  Future<InboundPromiseView> promise(String trfId) async {
    await _wait();
    return _promises[trfId] ??
        (throw const ProblemFailure(
          Problem(status: 404, code: ProblemCode.notFound),
        ));
  }

  @override
  Future<InboundCommandOutcome> recordArrival(
    String trfId, {
    required int version,
    required DateTime arrivedAt,
    required String recordedBy,
    required IdempotencyKey key,
  }) async {
    await _wait();
    final p = _promises[trfId]!;
    if (_arrivalKeys.contains(key.value)) return const InboundAccepted();
    if (p.state != PromiseState.expected) {
      return const InboundRejected(InboundProblemCode.invalidState);
    }
    if (p.version != version) {
      return const InboundRejected(InboundProblemCode.versionConflict);
    }
    _arrivalKeys.add(key.value);
    _promises[trfId] = _copy(
      p,
      state: PromiseState.receiving,
      arrivedAt: arrivedAt.toUtc(),
    );
    return const InboundAccepted();
  }

  @override
  Future<InboundCommandOutcome> recordReceipt(
    String trfId, {
    required int version,
    required List<(InboundLine, ReceiptCount)> counts,
    required DateTime receivedAt,
    required String receivedBy,
    required IdempotencyKey key,
  }) async {
    await _wait();
    receiptCalls++;
    final existing = _receiptKeys[key.value];
    if (existing != null) return InboundAccepted(resultId: existing);
    final p = _promises[trfId]!;
    if (p.state != PromiseState.receiving) {
      return const InboundRejected(InboundProblemCode.invalidState);
    }
    if (p.version != version) {
      return const InboundRejected(InboundProblemCode.versionConflict);
    }
    final id = 'rcp-${++_seq}';
    _receiptKeys[key.value] = id;
    final view = ReceiptView(
      receiptId: id,
      applyStatus: ApplyStatus.submitted,
      receivedAt: receivedAt.toUtc(),
    );
    _receipts[id] = (trfId, 0, view);
    _promises[trfId] = _copy(
      p,
      lines: [
        for (final l in p.lines)
          switch (counts.where((c) => c.$1.key == l.key).firstOrNull) {
            null => l,
            (_, final c) => InboundLine(
              sku: l.sku,
              lotId: l.lotId,
              productName: l.productName,
              barcodes: l.barcodes,
              unitsPerBox: l.unitsPerBox,
              boxCount: l.boxCount,
              expectedQty: l.expectedQty,
              receivedQty: c.total,
              quarantinedQty: c.quarantined,
              pendingQty: c.pending,
            ),
          },
      ],
      receipts: [...p.receipts, view],
    );
    if (loseNextReceiptResponse) {
      loseNextReceiptResponse = false;
      return const InboundUnknown();
    }
    return InboundAccepted(resultId: id);
  }

  @override
  Future<ReceiptView> receipt(String trfId, String receiptId) async {
    await _wait();
    final r = _receipts[receiptId]!;
    final polls = r.$2 + 1;
    var view = r.$3;
    if (!view.applyStatus.finished && polls >= applyPolls) {
      view = ReceiptView(
        receiptId: view.receiptId,
        applyStatus: rejectApply ? ApplyStatus.rejected : ApplyStatus.applied,
        commitId: rejectApply ? null : 'commit-$receiptId',
        receivedAt: view.receivedAt,
      );
      if (!rejectApply) {
        final p = _promises[trfId]!;
        _promises[trfId] = _copy(
          p,
          state: PromiseState.tinPosted,
          receipts: [
            for (final x in p.receipts) x.receiptId == receiptId ? view : x,
          ],
        );
      }
    }
    _receipts[receiptId] = (trfId, polls, view);
    return view;
  }
}
