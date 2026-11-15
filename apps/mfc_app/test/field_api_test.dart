import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';

import 'package:mfc_app/features/quality/data/mock_quality_repository.dart';
import 'package:mfc_app/features/quality/data/quality_repository.dart';
import 'package:mfc_app/features/quality/domain/quality.dart';
import 'package:mfc_app/features/stock_count/data/mock_stock_count_repository.dart';
import 'package:mfc_app/features/stock_count/data/stock_count_repository.dart';
import 'package:mfc_app/features/stock_count/domain/stock_count.dart';
import 'package:mfc_app/features/stock_move/data/mock_stock_move_repository.dart';
import 'package:mfc_app/features/stock_move/data/stock_move_repository.dart';
import 'package:mfc_app/features/stock_move/domain/stock_move.dart';
import 'package:mfc_app/shared/field_outcome.dart';
import 'package:mfc_app/shared/providers.dart';

Dio _dio(FakeAdapter a) => createPmartDio(
  baseUrl: 'http://test.invalid/api/v1',
  sourceSystem: sourceSystem,
  tokens: TokenStore(MemoryKeyValueStore()),
  refresher: (_) async => null,
  adapter: a,
  delay: (_) async {},
);

Map<String, dynamic> _body(RequestOptions o) =>
    jsonDecode(o.data as String) as Map<String, dynamic>;

const _task = {
  'taskId': 'TSK-INS-mock-1',
  'taskType': 'INSPECT',
  'mfcId': 'MFC-1',
  'receiptId': 'rcp-1',
  'sku': 'S-1',
  'lotId': 'L-1',
  'locationCode': 'RCV-C-01',
  'plannedQty': 12,
  'doneQty': 0,
  'state': 'READY',
  'version': 1,
};

const _move = {
  'moveId': 'MV-mock-1',
  'kind': 'REPLENISH',
  'state': 'ACTIVE',
  'sku': 'S-1',
  'lotId': 'L-1',
  'fromLocation': 'C-R1-01-1-01',
  'toLocation': 'C-S1-02-2-05',
  'qty': 6,
  'pickedQty': 6,
  'droppedQty': 0,
  'onCartQty': 6,
  'cartLocation': 'CRT-C-01',
};

void main() {
  group(
    '품질검사 연결(mfc-inbound inbound-tasks · mfc-quality return-inspections)',
    () {
      test(
        '입고 품질검사: 경로·멱등키·본문(판정·LOT·소비기한·제조일), APPLIED 만 확정, CAPTURED·503 은 불명',
        () async {
          var i = 0;
          final a = FakeAdapter((_, _) async {
            i++;
            return switch (i) {
              1 => const FakeReply(
                200,
                body: {
                  'executionId': 'exe-1',
                  'taskId': 'TSK-INS-mock-1',
                  'applyStatus': 'APPLIED',
                  'inventoryCommitId': 'c-1',
                  'createdTaskIds': ['TSK-PUT-mock-1'],
                  'task': _task,
                },
              ),
              2 => const FakeReply(
                200,
                body: {
                  'executionId': 'exe-2',
                  'taskId': 'TSK-INS-mock-1',
                  'applyStatus': 'CAPTURED',
                },
              ),
              3 => const FakeReply(
                200,
                body: {
                  'executionId': 'exe-3',
                  'taskId': 'TSK-INS-mock-1',
                  'applyStatus': 'REJECTED',
                  'rejectReason': 'LOT_EXPIRED',
                },
              ),
              _ => FakeReply.problem(503, problemBody('UNKNOWN_RESULT')),
            };
          });
          final r = ApiQualityRepository(_dio(a));
          Future<FieldOutcome<InboundTaskExecutionView>> send() =>
              r.inspect('TSK-INS-mock-1', const [
                InspectionResult(
                  qty: 10,
                  quarantined: false,
                  sourceLotRef: 'A123',
                  expiryDate: '2026-11-30',
                  manufactureDate: '2026-11-01',
                ),
                InspectionResult(qty: 2, quarantined: true),
              ], key: IdempotencyKey('k-1'));

          final first = await send();
          expect(first, isA<FieldDone<InboundTaskExecutionView>>());
          expect(
            (first as FieldDone<InboundTaskExecutionView>).value.createdTaskIds,
            ['TSK-PUT-mock-1'],
          );
          expect(await send(), isA<FieldUnknown<InboundTaskExecutionView>>());
          expect(
            await send(),
            isA<FieldRejected<InboundTaskExecutionView>>().having(
              (x) => x.code,
              'code',
              'LOT_EXPIRED',
            ),
          );
          expect(await send(), isA<FieldUnknown<InboundTaskExecutionView>>());

          final req = a.requests.first;
          expect(
            req.uri.path,
            '/api/v1/inbound-tasks/TSK-INS-mock-1/inspections',
          );
          expect(req.headers['Idempotency-Key'], 'k-1');
          final results = _body(req)['results'] as List;
          expect(results[0], {
            'qty': 10,
            'resultQuality': 'NORMAL',
            'sourceLotRef': 'A123',
            'expiryDate': '2026-11-30',
            'manufactureDate': '2026-11-01',
          });
          expect((results[1] as Map)['resultQuality'], 'QUARANTINED');
        },
      );

      test('입고 작업 목록: READY·유형 거르기, 적치 경로', () async {
        final a = FakeAdapter(
          (o, _) async => o.method == 'GET'
              ? const FakeReply(
                  200,
                  body: {
                    'items': [_task],
                  },
                )
              : const FakeReply(
                  200,
                  body: {
                    'executionId': 'exe-9',
                    'taskId': 'TSK-PUT-mock-1',
                    'applyStatus': 'APPLIED',
                  },
                ),
        );
        final r = ApiQualityRepository(_dio(a));
        final list = await r.inboundTasks(
          'MFC-1',
          kind: InboundTaskKind.inspect,
        );
        expect(list.single.remainingQty, 12);
        expect(a.requests.first.uri.queryParameters, {
          'mfcId': 'MFC-1',
          'state': 'READY',
          'taskType': 'INSPECT',
          // mfc-inbound 0.9.0: 기본값 true 를 생성 클라이언트가 그대로 보낸다 — 앱은 상품명·바코드가 필요하다.
          'withLabels': 'true',
        });
        await r.putaway(
          'TSK-PUT-mock-1',
          toLocationCode: 'C-S1-01-1-01',
          qty: 10,
          key: IdempotencyKey('k-2'),
        );
        expect(
          a.requests.last.uri.path,
          '/api/v1/inbound-tasks/TSK-PUT-mock-1/putaways',
        );
        expect(_body(a.requests.last), {
          'toLocationCode': 'C-S1-01-1-01',
          'qty': 10,
        });
      });

      test(
        '회수품 검수: 본문 판정·온도대·개봉, 202 resultId, 422 RESALE_NOT_ALLOWED 는 거절',
        () async {
          var i = 0;
          final a = FakeAdapter((_, _) async {
            i++;
            return i == 1
                ? const FakeReply(
                    202,
                    body: {
                      'status': 'ACCEPTED',
                      'requestId': 'k-3',
                      'resultId': 'RIN-mock-1',
                    },
                  )
                : FakeReply.problem(422, problemBody('RESALE_NOT_ALLOWED'));
          });
          final r = ApiQualityRepository(_dio(a));
          Future<FieldOutcome<String?>> send() => r.inspectReturn(
            mfcId: 'MFC-1',
            claimId: 'clm-1',
            returnReceiptId: 'rr-1',
            inspectedBy: 'w-1',
            lines: const [
              ReturnInspectionLine(
                sku: 'S-1',
                qty: 1,
                verdict: ReturnVerdict.dispose,
                zone: TempZone.chilled,
                opened: true,
                disposeReason: DisposeReason.opened,
              ),
            ],
            key: IdempotencyKey('k-3'),
          );
          expect(
            await send(),
            isA<FieldDone<String?>>().having(
              (x) => x.value,
              'id',
              'RIN-mock-1',
            ),
          );
          expect(
            await send(),
            isA<FieldRejected<String?>>().having(
              (x) => x.code,
              'code',
              'RESALE_NOT_ALLOWED',
            ),
          );
          expect(a.requests.first.uri.path, '/api/v1/return-inspections');
          final line = (_body(a.requests.first)['lines'] as List).single as Map;
          expect(line['verdict'], 'DISPOSE');
          expect(line['temperatureZone'], 'CHILLED');
          expect(line['opened'], true);
          expect(line['disposeReason'], 'OPENED');
        },
      );

      test('목: 검사하면 정상 결과마다 적치 작업, 같은 키는 한 번, 냉장 재판매는 거절', () async {
        final m = MockQualityRepository(latency: Duration.zero);
        final key = IdempotencyKey('k');
        Future<FieldOutcome<InboundTaskExecutionView>> send() =>
            m.inspect('TSK-INS-mock-1', const [
              InspectionResult(qty: 10, quarantined: false, sourceLotRef: 'A'),
              InspectionResult(qty: 2, quarantined: true),
            ], key: key);
        final o = await send() as FieldDone<InboundTaskExecutionView>;
        expect(o.value.createdTaskIds, hasLength(1));
        await send();
        expect(m.task('TSK-INS-mock-1')!.doneQty, 12);
        expect(
          await m.inspectReturn(
            mfcId: 'M',
            claimId: 'c',
            returnReceiptId: 'r',
            inspectedBy: 'w',
            lines: const [
              ReturnInspectionLine(
                sku: 'S',
                qty: 1,
                verdict: ReturnVerdict.resale,
                zone: TempZone.chilled,
                opened: false,
              ),
            ],
            key: IdempotencyKey('k2'),
          ),
          isA<FieldRejected<String?>>(),
        );
      });
    },
  );

  group('재고 이동 연결(mfc-inbound move-orders · return-receipts)', () {
    test('집어 올리기·내려놓기: 경로·본문, 409 NOT_PICKER 는 거절, 타임아웃은 불명', () async {
      var i = 0;
      final a = FakeAdapter((o, _) async {
        i++;
        return switch (i) {
          1 => const FakeReply(200, body: _move),
          2 => FakeReply.problem(409, problemBody('NOT_PICKER')),
          _ => const FakeReply.transport(DioExceptionType.receiveTimeout),
        };
      });
      final r = ApiStockMoveRepository(_dio(a));
      final up = await r.pickUp(
        'MV-mock-1',
        cartLocation: 'CRT-C-01',
        qty: 6,
        key: IdempotencyKey('k-1'),
      );
      expect((up as FieldDone<MoveOrderView>).value.onCartQty, 6);
      expect(a.requests[0].uri.path, '/api/v1/move-orders/MV-mock-1/pickups');
      expect(_body(a.requests[0]), {'cartLocation': 'CRT-C-01', 'qty': 6});

      final drop = await r.drop(
        'MV-mock-1',
        toLocation: 'C-S1-02-2-05',
        qty: 6,
        key: IdempotencyKey('k-2'),
      );
      expect(
        drop,
        isA<FieldRejected<MoveOrderView>>().having(
          (x) => x.code,
          'code',
          'NOT_PICKER',
        ),
      );
      expect(a.requests[1].uri.path, '/api/v1/move-orders/MV-mock-1/drops');
      expect(
        await r.drop(
          'MV-mock-1',
          toLocation: 'C-S1-02-2-05',
          qty: 6,
          key: IdempotencyKey('k-2'),
        ),
        isA<FieldUnknown<MoveOrderView>>(),
      );
    });

    test('회수품 반입: 경로·본문, 202 resultId', () async {
      final a = FakeAdapter(
        (_, _) async => const FakeReply(
          202,
          body: {'status': 'ACCEPTED', 'requestId': 'k', 'resultId': 'rr-1'},
        ),
      );
      final r = ApiStockMoveRepository(_dio(a));
      final o = await r.receiveReturn(
        mfcId: 'MFC-1',
        claimId: 'clm-1',
        returnPickupId: 'rp-1',
        toLocationCode: 'RTN-A-01',
        receivedBy: 'w-1',
        receivedAt: DateTime.utc(2026, 11, 10, 7),
        lines: const [ReturnReceiptLine(sku: 'S-1', qty: 2)],
        key: IdempotencyKey('k'),
      );
      expect(o, isA<FieldDone<String?>>().having((x) => x.value, 'id', 'rr-1'));
      final b = _body(a.requests.single);
      expect(a.requests.single.uri.path, '/api/v1/return-receipts');
      expect(b['toLocationCode'], 'RTN-A-01');
      expect(b['claimId'], 'clm-1');
      expect(b['lines'], [
        {'sku': 'S-1', 'qty': 2},
      ]);
    });

    test('목: 집은 만큼만 내려놓고, 다 내려놓으면 완료. 같은 키는 한 번', () async {
      final m = MockStockMoveRepository(latency: Duration.zero);
      final k = IdempotencyKey('up');
      await m.pickUp('MV-mock-1', cartLocation: 'CRT-C-01', qty: 6, key: k);
      await m.pickUp('MV-mock-1', cartLocation: 'CRT-C-01', qty: 6, key: k);
      expect((await m.move('MV-mock-1')).onCartQty, 6);
      expect(
        await m.drop(
          'MV-mock-1',
          toLocation: 'WRONG',
          qty: 6,
          key: IdempotencyKey('d0'),
        ),
        isA<FieldRejected<MoveOrderView>>(),
      );
      await m.drop(
        'MV-mock-1',
        toLocation: 'C-S1-02-2-05',
        qty: 6,
        key: IdempotencyKey('d1'),
      );
      expect((await m.move('MV-mock-1')).state, MoveState.completed);
    });
  });

  group('재고 실사 연결(mfc-inventory count-sessions)', () {
    test('실사 시작·계수 제출: 경로·본문, 계수 중에는 차이 없음, 409 SAME_COUNTER 는 거절', () async {
      var i = 0;
      final a = FakeAdapter((_, _) async {
        i++;
        return switch (i) {
          1 => const FakeReply(
            201,
            body: {
              'sessionId': 'CNT-mock-1',
              'state': 'COUNTING',
              'locationCodes': ['C-S1-01-1-01'],
              'sheet': [
                {'locationCode': 'C-S1-01-1-01', 'sku': 'S-1', 'lotId': 'L-1'},
              ],
              'differences': null,
            },
          ),
          _ => FakeReply.problem(409, problemBody('SAME_COUNTER')),
        };
      });
      final r = ApiStockCountRepository(_dio(a));
      final started = await r.start(
        'MFC-1',
        locationCodes: const ['C-S1-01-1-01'],
        key: IdempotencyKey('k-1'),
      ) as FieldDone<CountSessionView>;
      expect(started.value.differences, isNull);
      expect(started.value.sheet.single.sku, 'S-1');
      expect(a.requests[0].uri.path, '/api/v1/mfcs/MFC-1/count-sessions');

      final sub = await r.submit('MFC-1', 'CNT-mock-1', [
        CountedLine(line: started.value.sheet.single, countedQty: 7),
      ], key: IdempotencyKey('k-2'));
      expect(
        sub,
        isA<FieldRejected<CountSessionView>>().having(
          (x) => x.code,
          'code',
          'SAME_COUNTER',
        ),
      );
      expect(
        a.requests[1].uri.path,
        '/api/v1/mfcs/MFC-1/count-sessions/CNT-mock-1/counts',
      );
      expect(_body(a.requests[1])['lines'], [
        {
          'locationCode': 'C-S1-01-1-01',
          'sku': 'S-1',
          'lotId': 'L-1',
          'countedQty': 7,
        },
      ]);
    });

    test('목: 다르면 다른 작업자 재계수, 같은 사람은 SAME_COUNTER, 재계수도 다르면 승인 대기', () async {
      final m = MockStockCountRepository(latency: Duration.zero);
      final s = (await m.start(
        'M',
        locationCodes: const ['C-S1-01-1-01'],
        key: IdempotencyKey('s'),
      ) as FieldDone<CountSessionView>).value;
      List<CountedLine> all(int q) => [
        for (final l in s.sheet) CountedLine(line: l, countedQty: q),
      ];
      final first = (await m.submit(
        'M',
        s.sessionId,
        all(5),
        key: IdempotencyKey('a'),
      ) as FieldDone<CountSessionView>).value;
      expect(first.state, CountState.recountRequired);
      expect(first.differences, isNull); // 재계수 전에는 장부를 안 보인다
      expect(first.canCount('OP-mock-1'), isFalse);
      expect(
        await m.submit('M', s.sessionId, all(5), key: IdempotencyKey('b')),
        isA<FieldRejected<CountSessionView>>().having(
          (x) => x.code,
          'code',
          CountProblemCode.sameCounter,
        ),
      );
      m.counter = 'OP-mock-2';
      final second = (await m.submit(
        'M',
        s.sessionId,
        all(6),
        key: IdempotencyKey('c'),
      ) as FieldDone<CountSessionView>).value;
      expect(second.state, CountState.pendingApproval);
      expect(second.differences, isNotNull);
    });
  });
}
