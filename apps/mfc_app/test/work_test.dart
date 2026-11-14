import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/data/work_repository.dart';
import 'package:mfc_app/features/work/domain/work.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockTaskRepository tasks;
  late MockWorkRepository work;

  setUp(() {
    tasks = MockTaskRepository(latency: Duration.zero);
    work = MockWorkRepository(tasks: tasks, latency: Duration.zero);
  });

  Future<void> pumpApp(WidgetTester t) async {
    // 안드로이드 폰 크기(412×915dp).
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          taskRepositoryProvider.overrideWithValue(tasks),
          packingRepositoryProvider.overrideWithValue(
            MockPackingRepository(latency: Duration.zero),
          ),
          workRepositoryProvider.overrideWithValue(work),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  test('권한: 업무는 유효 작업 유형이 하나라도 있으면, 메뉴는 요구 자격이 있으면', () {
    const me = WorkerProfile(workerId: 'w', allowedTaskTypes: {'INSPECT'});
    expect(me.can(WorkArea.inspection), isTrue);
    expect(me.can(WorkArea.inbound), isFalse);
    expect(me.can(WorkArea.pickPack), isFalse);
    expect(me.canUse(PdaMenu.rest), isTrue);
    expect(me.canUse(PdaMenu.printerSettings), isFalse);
    const left = WorkerProfile(
      workerId: 'w',
      allowedTaskTypes: {'PICK'},
      active: false,
    );
    expect(left.can(WorkArea.pickPack), isFalse);
  });

  test('업무 묶음(2026-11-10): 적치·보충·이동·복귀·회수품 반입은 재고 이동, 반품 검사는 품질검사', () {
    expect(WorkArea.inbound.taskTypes, {'RECEIVE'});
    expect(
      WorkArea.inspection.taskTypes,
      containsAll(['INSPECT', 'RETURN_INSPECT']),
    );
    expect(
      WorkArea.stockMove.taskTypes,
      containsAll(['PUTAWAY', 'REPLENISH', 'MOVE', 'RETURN', 'RETURN_RECEIPT']),
    );
    expect(WorkArea.stockCount.taskTypes, {'CYCLE_COUNT'});
    expect(WorkArea.pickPack.taskTypes, {'PICK', 'PACK'});
    // 한 작업 유형은 한 업무에만.
    final all = [for (final a in WorkArea.values) ...a.taskTypes];
    expect(all.toSet().length, all.length);
  });

  testWidgets('업무 5개의 설명은 모두 폰 한 화면에 스크롤 없이 들어간다', (t) async {
    await pumpApp(t);
    for (final a in WorkArea.values) {
      await tapKey(t, 'area-${a.name}');
      expect(find.byKey(const ValueKey('guide')), findsOneWidget);
      // 단계마다 픽토그램과 한 줄.
      for (var n = 1; n <= 4; n++) {
        expect(
          find.descendant(
            of: find.byKey(ValueKey('guide-step-$n')),
            matching: find.byType(Icon),
          ),
          findsOneWidget,
        );
      }
      expect(t.takeException(), isNull, reason: a.name);
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
    }
  });

  testWidgets('메인은 공통 — 작업 목록 없음, 권한 없는 업무·메뉴는 "권한이 없어요"', (t) async {
    work = MockWorkRepository(
      tasks: tasks,
      latency: Duration.zero,
      allowed: {'INSPECT'},
    );
    await pumpApp(t);
    expect(t.takeException(), isNull);

    for (final a in WorkArea.values) {
      expect(find.byKey(ValueKey('area-${a.name}')), findsOneWidget);
    }
    expect(find.textContaining('task-mock'), findsNothing);

    await tapKey(t, 'area-inbound');
    expect(find.byKey(const ValueKey('no-permission')), findsOneWidget);
    expect(find.text('입고 권한이 없어요. 센터 관리자에게 요청해 주세요.'), findsOneWidget);
    await t.tap(find.text('확인'));
    await t.pumpAndSettle();

    await tapKey(t, 'menu-printer');
    expect(find.byKey(const ValueKey('no-permission')), findsOneWidget);
    await t.tap(find.text('확인'));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('area-inbound')), findsOneWidget);

    // 작업 준비 완료 버튼 없음 — 권한 있는 업무를 누르면 바로 작업 순서 안내.
    expect(find.byKey(const ValueKey('ready')), findsNothing);
    await tapKey(t, 'area-inspection');
    expect(find.byKey(const ValueKey('no-permission')), findsNothing);
    expect(find.text('품질검사 안내'), findsOneWidget);
  });

  testWidgets('피패킹: 업무 누름 → 작업 순서 안내 → 확인 → 서버가 준 작업 → 돌아오면 다시 받기', (t) async {
    await pumpApp(t);
    await tapKey(t, 'area-pickPack');

    expect(find.byKey(const ValueKey('guide')), findsOneWidget);
    expect(find.text('피패킹 안내'), findsOneWidget);
    // 한 장 — 스크롤 없이 폰 화면에 다 들어간다(넘치면 레이아웃 오류).
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('guide')),
        matching: find.byType(Scrollable),
      ),
      findsNothing,
    );
    expect(t.takeException(), isNull);
    expect(work.nextCalls, 0); // 확인 전에는 작업을 받지 않는다

    await tapKey(t, 'guide-ok');
    expect(work.nextCalls, 1);
    // 주문은 피킹부터(같은 주문 패킹은 피킹이 끝나야 열린다).
    expect(find.byKey(const ValueKey('assigned-task-mock-1')), findsOneWidget);
    expect(
      t.widget<Text>(find.byKey(const ValueKey('assigned-type'))).data,
      '피킹',
    );

    // "작업 시작" 한 번 — 작업 상세 없이 바로 피킹(장바구니 단계).
    await tapKey(t, 'run-task');
    expect(find.text('작업 상세'), findsNothing);
    expect(find.byKey(const ValueKey('cart-scan')), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    // 돌아오면 다시 받는다 — 들고 있는 같은 피킹. 버튼이 돌지 않는다.
    expect(work.nextCalls, 2);
    expect(find.byKey(const ValueKey('assigned-task-mock-1')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('run-task')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsNothing,
    );

    await tapKey(t, 'session-end');
    expect(find.byKey(const ValueKey('area-pickPack')), findsOneWidget);
  });

  testWidgets('피패킹은 한 주문: 장바구니 → 칸마다 집기 → 패킹대로 → 같은 주문 패킹(같은 장바구니)', (t) async {
    await pumpApp(t);
    await tapKey(t, 'area-pickPack');
    await tapKey(t, 'guide-ok');
    await tapKey(t, 'run-task');

    Future<void> scanTo(String id, String code) async {
      await t.enterText(find.byKey(ValueKey(id)), code);
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pumpAndSettle();
    }

    await scanTo('cart-scan', 'CRT-C-02');
    for (final (loc, code) in [
      ('C-S1-01-1-01', MockTaskRepository.yogurtBarcode),
      ('C-S1-02-2-05', MockTaskRepository.milkBarcode),
      ('C-S2-04-1-10', MockTaskRepository.milkBarcode),
      ('F-S1-01-1-03', MockTaskRepository.dumplingBarcode),
      ('A-S3-01-1-10', MockTaskRepository.chipsBarcode),
    ]) {
      await scanTo('pick-loc-scan', loc);
      await scanTo('scan-field', code);
    }
    expect(find.text('피킹을 다 했어요.\n장바구니를 들고 패킹대로 가요'), findsOneWidget);
    expect(tasks.taskJson('shp-1-PACK')['state'], 'ASSIGNED');

    // 패킹대 도착 → 같은 주문의 패킹이 바로 열린다.
    await tapKey(t, 'to-pack');
    expect(find.text('패킹'), findsOneWidget);
    expect(find.text('주문 order-seed-1 · 상품 4종 5개'), findsOneWidget);
    await scanTo('station-scan', 'PAK-C-01');
    // 피킹한 장바구니가 아니면 받지 않는다.
    await scanTo('pack-cart-scan', 'CRT-C-01');
    expect(find.text('이 주문을 피킹한 장바구니가 아니에요'), findsWidgets);
    await scanTo('pack-cart-scan', 'CRT-C-02');
    expect(find.byKey(const ValueKey('request-dispatch')), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('검수: 줄 작업이 없으면 "지금 할 작업이 없어요" + 다시 받기', (t) async {
    await pumpApp(t);
    await tapKey(t, 'area-inspection');
    await tapKey(t, 'guide-ok');
    expect(find.text('지금 할 작업이 없어요. 잠시 뒤 다시 받아 주세요'), findsOneWidget);
    await tapKey(t, 'session-retry');
    expect(work.nextCalls, 2);
  });

  testWidgets('응답을 못 받으면 확인 중 — 다시 확인하면 들고 있는 작업', (t) async {
    work.loseNextResponse = true;
    await pumpApp(t);
    await tapKey(t, 'area-pickPack');
    await tapKey(t, 'guide-ok');
    expect(find.byKey(const ValueKey('session-unknown')), findsOneWidget);
    await tapKey(t, 'session-retry');
    expect(find.byKey(const ValueKey('assigned-task-mock-1')), findsOneWidget);
  });

  testWidgets('휴게 중에는 업무를 눌러도 안내로 가지 않는다', (t) async {
    await pumpApp(t);
    await tapKey(t, 'menu-break');
    expect(find.text('휴게 중'), findsOneWidget);
    await tapKey(t, 'area-pickPack');
    expect(find.byKey(const ValueKey('guide')), findsNothing);
    expect(find.byKey(const ValueKey('on-break-dialog')), findsOneWidget);
    await tapKey(t, 'end-break');
    expect(find.text('작업 대기'), findsOneWidget);
    await tapKey(t, 'area-pickPack');
    expect(find.byKey(const ValueKey('guide')), findsOneWidget);
  });

  group('연동', () {
    WorkRepository repo(FakeAdapter a) => ApiWorkRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: a,
        delay: (_) async {},
      ),
    );

    test('다음 작업 받기: 경로·멱등키, 201 상세, 409 NO_TASK_AVAILABLE, 타임아웃은 불명', () async {
      var i = 0;
      final adapter = FakeAdapter((_, _) async {
        i++;
        return switch (i) {
          1 => const FakeReply(
            201,
            body: {
              'assignmentId': 'as-1',
              'taskId': 'task-9',
              'taskType': 'PICK',
              'state': 'ACTIVE',
              'source': 'SYSTEM',
              'detail': {
                'available': true,
                'urgent': false,
                'promisedReadyAt': '2026-11-10T05:00:00Z',
                'lines': [
                  {
                    'sku': 'S-1',
                    'productName': '서울우유 1L',
                    'qty': 2,
                    'fromLocation': 'C-S1-02-2-05',
                  },
                ],
              },
            },
          ),
          2 => FakeReply.problem(409, problemBody('NO_TASK_AVAILABLE')),
          _ => const FakeReply.transport(DioExceptionType.receiveTimeout),
        };
      });
      final r = repo(adapter);
      Future<NextTaskOutcome> next() =>
          r.next('MFC-1', 'w-1', WorkArea.pickPack, key: IdempotencyKey('k-1'));

      final first = await next();
      expect(first, isA<NextAssigned>());
      final task = (first as NextAssigned).task;
      expect(task.taskId, 'task-9');
      expect(task.lines.single.fromLocation, 'C-S1-02-2-05');
      expect(task.runnable, isTrue);
      expect(
        await next(),
        isA<NextUnavailable>().having(
          (u) => u.code,
          'code',
          'NO_TASK_AVAILABLE',
        ),
      );
      expect(await next(), isA<NextUnknown>());
      final req = adapter.requests.first;
      expect(req.uri.path, '/api/v1/mfcs/MFC-1/workers/w-1/next-tasks');
      expect(req.method, 'POST');
      expect(req.headers['Idempotency-Key'], 'k-1');
      // 고른 업무를 본문으로 보낸다(mfc-capacity 0.13.0, BR-52 R1).
      expect(jsonDecode(req.data as String), {'workArea': 'PICK_PACK'});
    });

    test(
      '다음 작업 받기: 업무마다 계약 WorkArea 값, 422 WORK_AREA_NOT_ALLOWED 는 받을 수 없음(확정)',
      () async {
        final adapter = FakeAdapter(
          (_, _) async =>
              FakeReply.problem(422, problemBody('WORK_AREA_NOT_ALLOWED')),
        );
        final r = repo(adapter);
        const sent = {
          WorkArea.inbound: 'INBOUND',
          WorkArea.inspection: 'INSPECTION',
          WorkArea.stockMove: 'STOCK_MOVE',
          WorkArea.stockCount: 'STOCK_COUNT',
          WorkArea.pickPack: 'PICK_PACK',
        };
        for (final a in WorkArea.values) {
          final out = await r.next(
            'MFC-1',
            'w-1',
            a,
            key: IdempotencyKey('k-${a.name}'),
          );
          expect(
            out,
            isA<NextUnavailable>().having(
              (u) => u.code,
              'code',
              WorkProblemCode.workAreaNotAllowed,
            ),
          );
          expect(jsonDecode(adapter.requests.last.data as String), {
            'workArea': sent[a],
          });
        }
      },
    );

    test('본인 조회: 서버가 준 workAreas 가 고를 수 있는 업무 — 작업 유형으로 넓히지 않는다', () async {
      Future<WorkerProfile> me(Map<String, Object?> extra) => repo(
        FakeAdapter(
          (_, _) async => FakeReply(
            200,
            body: {
              'workerId': 'w-1',
              'state': 'ACTIVE',
              'effectiveTaskTypes': ['PICK', 'PACK', 'RETURN'],
              ...extra,
            },
          ),
        ),
      ).me('MFC-1', 'w-1');

      final some = await me({
        'workAreas': ['STOCK_MOVE', 'PICK_PACK'],
      });
      expect(some.workAreas, {WorkArea.stockMove, WorkArea.pickPack});
      expect(some.can(WorkArea.pickPack), isTrue);
      expect(some.can(WorkArea.stockMove), isTrue);
      expect(some.can(WorkArea.inbound), isFalse);

      // 빈 목록 = 고를 업무 없음(일일크루 근무 등록 전 등). 작업 유형이 있어도 열지 않는다.
      final none = await me({'workAreas': <String>[]});
      expect(none.workAreas, isEmpty);
      expect(WorkArea.values.where(none.can), isEmpty);

      // 필드가 없으면(0.12.0 이하 서버) 전처럼 작업 유형 겹침으로 본다.
      final old = await me({});
      expect(old.workAreas, isNull);
      expect(old.can(WorkArea.pickPack), isTrue);
      expect(old.can(WorkArea.inbound), isFalse);
    });

    test('본인 조회: 유효 작업 유형이 권한, 휴게 여부', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {
            'workerId': 'w-1',
            'displayName': '김크루',
            'state': 'ACTIVE',
            'effectiveTaskTypes': ['PICK', 'PACK'],
            'onBreak': true,
          },
        ),
      );
      final me = await repo(adapter).me('MFC-1', 'w-1');
      expect(me.allowedTaskTypes, {'PICK', 'PACK'});
      expect(me.onBreak, isTrue);
      expect(me.can(WorkArea.pickPack), isTrue);
      expect(me.can(WorkArea.inspection), isFalse);
      expect(
        adapter.requests.single.uri.path,
        '/api/v1/mfcs/MFC-1/workers/w-1',
      );
    });
  });
}
