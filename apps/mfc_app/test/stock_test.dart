import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/inbound/data/mock_inbound_repository.dart';
import 'package:mfc_app/features/inbound/presentation/inbound_controller.dart';
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/quality/data/mock_quality_repository.dart';
import 'package:mfc_app/features/quality/domain/quality.dart';
import 'package:mfc_app/features/stock_count/data/mock_stock_count_repository.dart';
import 'package:mfc_app/features/stock_count/domain/stock_count.dart';
import 'package:mfc_app/features/stock_move/data/mock_stock_move_repository.dart';
import 'package:mfc_app/features/stock_move/domain/stock_move.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/shared/codes.dart';
import 'package:mfc_app/shared/field_repositories.dart';
import 'package:mfc_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  test('코드 형식(채번 지침 5장): 선반·기타 구역·카트·SKU', () {
    expect(isMfcLocation('C-S1-03-2-04'), isTrue);
    expect(isMfcLocation('RCV-C-01'), isTrue);
    expect(isMfcLocation('C01-01-101'), isFalse); // 옛 목 형식
    expect(isCartLocation('CRT-C-01'), isTrue);
    expect(isCartLocation('RCV-C-01'), isFalse);
    expect(isSku('E-00000001'), isTrue);
    expect(isSku('8801115114154'), isFalse);
  });

  late MockStockMoveRepository stockMove;
  late MockQualityRepository quality;
  late MockStockCountRepository count;

  setUp(() {
    stockMove = MockStockMoveRepository(latency: Duration.zero);
    quality = MockQualityRepository(latency: Duration.zero, returns: stockMove);
    count = MockStockCountRepository(latency: Duration.zero);
  });

  Future<void> pumpApp(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          taskRepositoryProvider.overrideWithValue(
            MockTaskRepository(latency: Duration.zero),
          ),
          packingRepositoryProvider.overrideWithValue(
            MockPackingRepository(latency: Duration.zero),
          ),
          inboundRepositoryProvider.overrideWithValue(
            MockInboundRepository(latency: Duration.zero),
          ),
          qualityRepositoryProvider.overrideWithValue(quality),
          stockMoveRepositoryProvider.overrideWithValue(stockMove),
          stockCountRepositoryProvider.overrideWithValue(count),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester t, String key) async {
    await t.ensureVisible(find.byKey(ValueKey(key)));
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  Future<void> scan(WidgetTester t, String field, String code) async {
    await t.enterText(find.byKey(ValueKey(field)), code);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
  }

  Future<void> setQty(WidgetTester t, String id, int v) async {
    await tapKey(t, '$id-value');
    await t.enterText(find.byKey(const ValueKey('qty-input')), '$v');
    await tapKey(t, 'qty-ok');
  }

  bool enabled(WidgetTester t, String key) =>
      t
          .widget<FilledButton>(
            find.descendant(
              of: find.byKey(ValueKey(key)),
              matching: find.byType(FilledButton),
            ),
          )
          .onPressed !=
      null;

  Future<void> open(WidgetTester t, String area) async {
    await pumpApp(t);
    await tapKey(t, 'area-$area');
    await tapKey(t, 'guide-ok');
  }

  testWidgets('재고 이동(보충): 카트 → 출발 칸(위치 확인) → 다음 쪽에서 상품 스캔·싣기 → "이동하세요" → 도착 칸 → 내려놓기', (t) async {
    await open(t, 'stockMove');
    expect(find.byKey(const ValueKey('assigned-MV-mock-1')), findsOneWidget);
    expect(find.text('선반 보충'), findsOneWidget);
    await tapKey(t, 'run-task');

    // ① 위치 확인: 카트가 먼저다. 카트를 찍기 전에는 출발 칸도 받지 않는다.
    expect(find.byKey(const ValueKey('step-0')), findsOneWidget);
    expect(find.text('카트 스캔'), findsOneWidget);
    expect(find.byKey(const ValueKey('move-submit')), findsNothing); // 이 쪽에는 싣기 버튼·수량이 없다
    expect(find.byKey(const ValueKey('move-qty-value')), findsNothing);
    expect(t.widget<Opacity>(find.byKey(const ValueKey('target-from-lock'))).opacity, lessThan(1));
    await scan(t, 'move-scan', 'C-R1-01-1-01');
    expect(find.text('카트 바코드를 먼저 스캔해요'), findsWidgets);
    await scan(t, 'move-scan', MockTaskRepository.milkBarcode);
    expect(find.text('카트 바코드를 먼저 스캔해요'), findsWidgets);
    expect(find.byKey(const ValueKey('step-0')), findsOneWidget);

    await scan(t, 'move-scan', 'CRT-C-01');
    expect(t.widget<Opacity>(find.byKey(const ValueKey('target-from-lock'))).opacity, 1);
    expect(find.text('출발 칸 스캔'), findsOneWidget);
    // 다른 칸·칸 아닌 값·상품은 거절 — 아직 위치 확인 쪽이다.
    await scan(t, 'move-scan', 'C-S1-01-1-01');
    expect(find.text('지시한 칸이 아니에요. 화면의 칸으로 가 주세요'), findsWidgets);
    await scan(t, 'move-scan', 'hello');
    expect(find.text('출발 칸 바코드를 먼저 스캔해요'), findsWidgets);
    await scan(t, 'move-scan', MockTaskRepository.milkBarcode);
    expect(find.text('출발 칸 바코드를 먼저 스캔해요'), findsWidgets);
    expect(find.byKey(const ValueKey('step-0')), findsOneWidget);

    // 둘 다 찍으면 ② 상품 싣기 쪽으로 넘어간다.
    await scan(t, 'move-scan', 'C-R1-01-1-01');
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    expect(find.text('상품을 하나씩 스캔'), findsOneWidget);
    // 수량은 0부터 — 상품을 스캔해 센다. 다른 상품은 세지 않는다.
    expect(find.text('스캔해 센 수량 0'), findsOneWidget);
    expect(enabled(t, 'move-submit'), isFalse); // 상품 아직
    await scan(t, 'move-scan', MockTaskRepository.yogurtBarcode);
    expect(find.text('지시한 상품이 아니에요 — 세지 않았어요'), findsWidgets);
    for (var i = 0; i < 6; i++) {
      await scan(t, 'move-scan', MockTaskRepository.milkBarcode);
    }
    expect(find.text('스캔해 센 수량 6'), findsOneWidget);
    await scan(t, 'move-scan', MockTaskRepository.milkBarcode);
    expect(find.text('옮길 양을 넘었어요'), findsWidgets);
    expect(enabled(t, 'move-submit'), isTrue);
    expect(t.takeException(), isNull);
    // 서버에는 아직 실은 것이 없다 — "카트에 실었어요"를 눌러야 기록된다.
    expect((await t.runAsync(() => stockMove.move('MV-mock-1')))!.onCartQty, 0);
    await tapKey(t, 'move-submit');

    // ③ 내려놓기: "이동하세요" 안내 → 도착 칸.
    expect(find.byKey(const ValueKey('step-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('move-go')), findsOneWidget);
    expect(find.textContaining('이동하세요'), findsOneWidget);
    expect((await t.runAsync(() => stockMove.move('MV-mock-1')))!.onCartQty, 6);
    expect(enabled(t, 'move-submit'), isFalse); // 도착 칸 아직
    await scan(t, 'move-scan', 'C-S1-02-2-05');
    expect(find.byKey(const ValueKey('move-go')), findsNothing);
    await tapKey(t, 'move-submit');
    // 이동 하나가 끝나면 완료 화면: 무엇을 몇 개, 어디서 어디로.
    expect(find.byKey(const ValueKey('move-done')), findsOneWidget);
    expect(find.text('보충 완료'), findsOneWidget);
    expect(find.text('6개를 C-S1-02-2-05 에 옮겼어요'), findsOneWidget);
    expect(find.text('6개 (지시 6개)'), findsOneWidget);
    final summary = find.byKey(const ValueKey('done-summary'));
    for (final v in ['C-R1-01-1-01', 'C-S1-02-2-05', 'CRT-C-01']) {
      expect(find.descendant(of: summary, matching: find.text(v)), findsOneWidget, reason: v);
    }
    expect(find.byKey(const ValueKey('move-scan')), findsNothing);
    expect(t.takeException(), isNull);
    expect(
      (await t.runAsync(() => stockMove.move('MV-mock-1')))!.state,
      MoveState.completed,
    );

    // 다음 작업 — 남은 이동·적치가 없어 취소품 복귀.
    await tapKey(t, 'result-action');
    expect(find.byKey(const ValueKey('assigned-shp-9-RETURN')), findsOneWidget);
  });

  testWidgets('재고 이동 완료 화면: "다음 작업"을 10초 안에 누르지 않으면 자동으로 다음 작업을 받는다', (t) async {
    await open(t, 'stockMove');
    await tapKey(t, 'run-task');
    await scan(t, 'move-scan', 'CRT-C-01');
    await scan(t, 'move-scan', 'C-R1-01-1-01');
    for (var i = 0; i < 6; i++) {
      await scan(t, 'move-scan', MockTaskRepository.milkBarcode);
    }
    await tapKey(t, 'move-submit');
    await scan(t, 'move-scan', 'C-S1-02-2-05');
    await tapKey(t, 'move-submit');

    expect(find.byKey(const ValueKey('move-done')), findsOneWidget);
    expect(find.text('10초 뒤 자동으로 다음 작업을 받아요'), findsOneWidget);
    await t.pump(const Duration(seconds: 3));
    expect(find.text('7초 뒤 자동으로 다음 작업을 받아요'), findsOneWidget);
    expect(find.byKey(const ValueKey('move-done')), findsOneWidget); // 아직 완료 화면

    await t.pump(const Duration(seconds: 7));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('move-done')), findsNothing);
    expect(find.byKey(const ValueKey('assigned-shp-9-RETURN')), findsOneWidget); // 다음 작업을 받았다
    expect(t.takeException(), isNull);
  });

  testWidgets('재고 이동: 출발 칸에 없으면 문제 보고 → 이 지시는 관리자에게', (t) async {
    await open(t, 'stockMove');
    await tapKey(t, 'run-task');
    await scan(t, 'move-scan', 'CRT-C-01');
    await scan(t, 'move-scan', 'C-R1-01-1-01');
    await tapKey(t, 'move-issue');
    expect(find.text('출발 칸에 물건이 없어요'), findsOneWidget);
    await tapKey(t, 'move-issue-sourceEmpty');
    expect(find.byKey(const ValueKey('move-reported')), findsOneWidget);
    expect(find.text('문제를 보고했어요. 관리자가 처리해요'), findsOneWidget);
  });

  testWidgets('적치: 품질검사가 만든 적치 작업 → 선반 스캔 → 나눠 놓기 → 다 놓으면 끝', (t) async {
    await t.runAsync(() async {
      // 보충을 끝내 두고, 품질검사로 적치 작업(정상 10개)을 만든다.
      await stockMove.pickUp(
        'MV-mock-1',
        cartLocation: 'CRT-C-01',
        qty: 6,
        key: IdempotencyKey('u'),
      );
      await stockMove.drop(
        'MV-mock-1',
        toLocation: 'C-S1-02-2-05',
        qty: 6,
        key: IdempotencyKey('d'),
      );
      await quality.inspect('TSK-INS-mock-1', const [
        InspectionResult(
          qty: 10,
          quarantined: false,
          sourceLotRef: 'L1',
          expiryDate: '2026-11-30',
        ),
        InspectionResult(qty: 2, quarantined: true),
      ], key: IdempotencyKey('i'));
    });
    await open(t, 'stockMove');
    expect(
      find.byKey(const ValueKey('assigned-TSK-PUT-mock-1')),
      findsOneWidget,
    );
    await tapKey(t, 'run-task');
    expect(find.text('놓을 수량 10개'), findsOneWidget);

    // ① 위치 확인: 출발 위치(입고 구역)부터. 이 쪽에는 수량·버튼이 없다.
    expect(find.byKey(const ValueKey('step-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('putaway-submit')), findsNothing);
    expect(find.byKey(const ValueKey('putaway-load')), findsNothing);
    await scan(t, 'putaway-scan', 'nope');
    expect(find.byKey(const ValueKey('putaway-scan-error')), findsOneWidget);
    await scan(t, 'putaway-scan', 'RCV-C-01');

    // ② 상품 싣기: 상품을 세고 "실었어요". 그 전에는 도착 선반을 받지 않는다.
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    expect(enabled(t, 'putaway-load'), isFalse);
    for (var i = 0; i < 6; i++) {
      await scan(t, 'putaway-scan', MockTaskRepository.yogurtBarcode);
    }
    await scan(t, 'putaway-scan', 'C-S1-01-1-01');
    expect(find.text("상품을 다 세었으면 '실었어요'를 먼저 눌러 주세요"), findsWidgets);
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    await tapKey(t, 'putaway-load');

    // ③ 내려놓기: "이동하세요" → 도착 선반(추천 칸 안내).
    expect(find.byKey(const ValueKey('step-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('putaway-go')), findsOneWidget);
    expect(find.text('추천 칸: C-S1-01-1-01, C-S1-01-1-02'), findsOneWidget);
    expect(find.text('실은 수량 6'), findsOneWidget);
    expect(enabled(t, 'putaway-submit'), isFalse); // 도착 선반 아직
    await scan(t, 'putaway-scan', 'C-S1-01-1-01');
    expect(find.byKey(const ValueKey('putaway-go')), findsNothing);
    await tapKey(t, 'putaway-submit');

    // 남은 4개 — 상품 싣기부터 다시, 다른 칸으로(추천 밖이면 안내만).
    expect(find.text('놓을 수량 4개'), findsOneWidget);
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    for (var i = 0; i < 4; i++) {
      await scan(t, 'putaway-scan', MockTaskRepository.yogurtBarcode);
    }
    await tapKey(t, 'putaway-load');
    // "다시 세기"로 상품 싣기로 돌아갈 수 있다.
    await tapKey(t, 'putaway-recount');
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    await tapKey(t, 'putaway-load');
    await scan(t, 'putaway-scan', 'C-S1-03-2-05');
    expect(find.textContaining('추천 칸이 아니에요'), findsOneWidget);
    await tapKey(t, 'putaway-submit');

    // 완료 화면 — 10초 안에 누르지 않으면 자동으로 다음 작업.
    expect(find.byKey(const ValueKey('putaway-done')), findsOneWidget);
    expect(find.text('적치 완료'), findsOneWidget);
    expect(find.byKey(const ValueKey('done-auto-next')), findsOneWidget);
    expect(quality.task('TSK-PUT-mock-1')!.completed, isTrue);
    await t.pump(const Duration(seconds: 10));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('putaway-done')), findsNothing);
    expect(t.takeException(), isNull);
  });

  testWidgets(
    '재고 실사: 칸 확인 → 상품 스캔으로 세기(장부 없음) · 소비기한 묶음 · 계수표 밖 상품 → 제출 → 다르면 다른 작업자 재계수',
    (t) async {
      await open(t, 'stockCount');
      expect(find.byKey(const ValueKey('assigned-CNT-mock-1')), findsOneWidget);
      await tapKey(t, 'run-task');
      const milk = MockTaskRepository.milkBarcode;
      const chips = MockTaskRepository.chipsBarcode;
      const water = '8801056021021'; // 생수 — 계수표에 없다

      // 1번 칸.
      await scan(t, 'count-loc-scan', 'C-S1-02-2-05');
      expect(find.byKey(const ValueKey('count-wrong-place')), findsOneWidget);
      await scan(t, 'count-loc-scan', 'A-S3-01-1-10');
      const a1 = 'A-S3-01-1-10|E-00000001|LOT-M-1022';
      const a2 = 'A-S3-01-1-10|E-00000005|LOT-C-0901';
      expect(
        t
            .widget<FilledButton>(find.byKey(const ValueKey('count-next')))
            .onPressed,
        isNull,
      ); // 다 세야
      // ＋ 버튼 없음 — 스캔이 +1. 많으면 하나 찍은 뒤 숫자를 눌러 넣는다.
      expect(
        t
            .widget<IconButton>(find.byKey(const ValueKey('count-$a1-plus')))
            .onPressed,
        isNull,
      );
      await scan(t, 'count-item-scan', milk);
      expect(find.text('서울우유 1L'), findsOneWidget);
      await setQty(t, 'count-$a1', 8);
      await scan(t, 'count-item-scan', chips);
      await setQty(t, 'count-$a2', 12);
      // 계수표에 없는 상품 — 따로 센다.
      await scan(t, 'count-item-scan', water);
      await scan(t, 'count-item-scan', water);
      expect(find.byKey(const ValueKey('count-extra-found')), findsOneWidget);
      expect(find.text('생수 2L'), findsOneWidget);
      expect(t.takeException(), isNull);
      await tapKey(t, 'count-next');

      // 2번 칸: 우유 두 묶음(소비기한 11-12 · 11-16), 과자 없음.
      await scan(t, 'count-loc-scan', 'C-S1-02-2-05');
      const b1 = 'C-S1-02-2-05|E-00000001|LOT-M-1022';
      const b2 = 'C-S1-02-2-05|E-00000001|LOT-M-1029';
      await scan(t, 'count-item-scan', milk);
      // 어느 묶음인지 골라야 센다.
      expect(find.byKey(const ValueKey('count-choose-lot')), findsOneWidget);
      await tapKey(t, 'lot-choice-$b2');
      await scan(t, 'count-item-scan', milk);
      await scan(t, 'count-item-scan', milk);
      expect(
        t
            .widget<Text>(
              find.descendant(
                of: find.byKey(const ValueKey('count-$b2-value')),
                matching: find.byType(Text),
              ),
            )
            .data,
        '3',
      );
      await tapKey(t, 'lot-choice-$b1');
      await scan(t, 'count-item-scan', milk);
      await setQty(t, 'count-$b1', 7); // 장부 8 과 다름
      await tapKey(t, 'count-zero-C-S1-02-2-05|E-00000005|LOT-C-0901');
      await tapKey(t, 'count-next');

      expect(find.text('센 수량을 확인해 주세요'), findsOneWidget);
      expect(find.byKey(const ValueKey('review-extra-$water')), findsOneWidget);
      await tapKey(t, 'count-submit');
      expect(
        find.byKey(const ValueKey('count-result-recountRequired')),
        findsOneWidget,
      );
      final s = await t.runAsync(() => count.session('M', 'CNT-mock-1'));
      expect(s!.state, CountState.recountRequired);
      expect(s.firstCounter, MockTaskRepository.workerId);
      expect(count.lastExtras.single.sku, 'E-00000021');
      expect(count.lastExtras.single.qty, 2);

      // 같은 사람에게는 재계수를 주지 않는다.
      await tapKey(t, 'result-action');
      expect(find.text('지금 할 작업이 없어요. 잠시 뒤 다시 받아 주세요'), findsOneWidget);
    },
  );

  testWidgets('재고 실사: 칸에 갈 수 없으면 문제 보고', (t) async {
    await open(t, 'stockCount');
    await tapKey(t, 'run-task');
    await tapKey(t, 'count-issue');
    await tapKey(t, 'count-issue-locationBlocked');
    expect(find.byKey(const ValueKey('count-reported')), findsOneWidget);
  });

  testWidgets('피패킹: 폰 화면에서 피킹 시작 → 바로 피킹 화면(넘침 없음) → 뒤로 오면 같은 작업', (t) async {
    await open(t, 'pickPack');
    expect(find.byKey(const ValueKey('assigned-task-mock-1')), findsOneWidget);
    await tapKey(t, 'run-task');
    expect(find.text('피킹'), findsOneWidget);
    expect(find.byKey(const ValueKey('cart-scan')), findsOneWidget);
    expect(t.takeException(), isNull);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('assigned-task-mock-1')), findsOneWidget);
  });

  testWidgets('취소품 복귀: 시작 → 포장 위치 확인 → 추천 선반 스캔 → 실적(큐·같은 키) → 확정 → 끝', (
    t,
  ) async {
    final tasks = MockTaskRepository(latency: Duration.zero);
    await t.runAsync(() async {
      // 재고 이동 앞 순서(보충)를 끝내 둔다.
      await stockMove.pickUp(
        'MV-mock-1',
        cartLocation: 'CRT-C-01',
        qty: 6,
        key: IdempotencyKey('u'),
      );
      await stockMove.drop(
        'MV-mock-1',
        toLocation: 'C-S1-02-2-05',
        qty: 6,
        key: IdempotencyKey('d'),
      );
    });
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
          inboundRepositoryProvider.overrideWithValue(
            MockInboundRepository(latency: Duration.zero),
          ),
          qualityRepositoryProvider.overrideWithValue(quality),
          stockMoveRepositoryProvider.overrideWithValue(stockMove),
          stockCountRepositoryProvider.overrideWithValue(count),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await tapKey(t, 'area-stockMove');
    await tapKey(t, 'guide-ok');
    expect(find.byKey(const ValueKey('assigned-shp-9-RETURN')), findsOneWidget);
    await tapKey(t, 'run-task');

    // 복귀 화면.
    expect(find.text('돌려놓을 수량 2개'), findsOneWidget);
    // ① 위치 확인: 포장 위치부터.
    expect(find.byKey(const ValueKey('step-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('return-submit')), findsNothing);
    await scan(t, 'return-scan', 'C-S1-01-1-01'); // 포장 위치 확인 전
    expect(find.byKey(const ValueKey('return-scan-error')), findsOneWidget);
    await scan(t, 'return-scan', 'PAK-C-03');

    // ② 상품 싣기: 상품을 세고 "실었어요". 그 전에는 선반을 받지 않는다.
    expect(find.byKey(const ValueKey('step-1')), findsOneWidget);
    await scan(t, 'return-scan', MockTaskRepository.yogurtBarcode);
    await scan(t, 'return-scan', MockTaskRepository.yogurtBarcode);
    expect(find.text('스캔해 센 수량 2'), findsOneWidget);
    await scan(t, 'return-scan', 'C-S1-01-1-01');
    expect(find.text("상품을 다 세었으면 '실었어요'를 먼저 눌러 주세요"), findsWidgets);
    await tapKey(t, 'return-load');

    // ③ 내려놓기: "이동하세요" → 선반(추천 칸 안내).
    expect(find.byKey(const ValueKey('step-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('return-go')), findsOneWidget);
    expect(find.text('추천 칸: C-S1-01-1-01'), findsOneWidget);
    expect(find.text('실은 수량 2'), findsOneWidget);
    await scan(t, 'return-scan', 'C-S1-01-1-01');
    expect(find.byKey(const ValueKey('return-go')), findsNothing);
    // 요거트는 냉장 — 차갑게 보관됐는지 답해야 복귀할 수 있다.
    expect(enabled(t, 'return-submit'), isFalse);
    await tapKey(t, 'return-cold');
    await t.tap(find.text('예, 차가워요'));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    await tapKey(t, 'return-submit');

    // 큐에 넣고 같은 키로 보냄 → 확정 조회로 반영 확인 → 끝.
    expect(find.byKey(const ValueKey('return-done')), findsOneWidget);
    expect(find.text('복귀 완료'), findsOneWidget);
    expect(find.byKey(const ValueKey('done-auto-next')), findsOneWidget);
    expect(tasks.taskJson('shp-9-RETURN')['state'], 'COMPLETED');
    final lines = (tasks.taskJson('shp-9-RETURN')['lines']! as List)
        .cast<Map<String, Object?>>();
    expect(lines.single['completedQty'], 2);

    // 다음 작업 → 근무 화면이 다시 받는다(남은 재고 이동 없음).
    await tapKey(t, 'result-action');
    expect(find.text('지금 할 작업이 없어요. 잠시 뒤 다시 받아 주세요'), findsOneWidget);
  });
}
