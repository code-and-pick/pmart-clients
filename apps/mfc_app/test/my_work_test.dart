import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/my_work/data/my_work_repository.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

import 'support.dart';

/// 내 오늘 업무 내역(사용자 2026-11-17) — 업무 고르기·업무 진행 화면 위 작은 바의 칩으로 들어간다.
void main() {
  setUpAll(initPmartFormatting);

  Future<void> pump(
    WidgetTester t, {
    String? nextRejectCode,
    List<String> unavailable = const [],
    bool empty = false,
    List<WorkActivity> extra = const [],
  }) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(MockAuthRepository()),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero)
              ..nextRejectCode = nextRejectCode,
          ),
          myWorkRepositoryProvider.overrideWithValue(
            MockMyWorkRepository(latency: Duration.zero)
              ..unavailable = unavailable
              ..empty = empty
              ..extra = extra,
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  testWidgets('업무 고르기 화면 위 칩: 오늘 처리 건수(서버 내역), 누르면 종류별 합계·최근 순 내역(거절 표시)', (
    t,
  ) async {
    await pump(t);
    // 홈 "오늘 작업" 카드 — 오늘 처리 건수(서버 내역)
    expect(find.text('4건'), findsWidgets);
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();

    expect(find.text('오늘 업무 내역'), findsOneWidget);
    // 합계는 서버 값 그대로(피킹 2건 중 거절 1 — 수량은 거절 뺀 2개)
    final pick = find.byKey(const ValueKey('my-work-total-PICK'));
    expect(
      find.descendant(of: pick, matching: find.text('2건')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: pick, matching: find.text('2개')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('my-work-total-PUTAWAY')), findsOneWidget);
    // 입고 쪽 일(적치)도 같은 목록에
    expect(find.byKey(const ValueKey('my-work-INB-M-1')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('my-work-EXE-M-2')),
        matching: find.text('거절'),
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('my-work-partial')), findsNothing);
    // 어떤 건을 작업했는지 번호(작업 번호·기록 번호)
    expect(find.text('작업 INB-T-1 · 기록 INB-M-1'), findsOneWidget);
  });

  testWidgets('입고 기록은 긴 trfId·기록 id 대신 TRF 화면 번호(입고 예정 조회)', (t) async {
    await pump(
      t,
      extra: [
        WorkActivity(
          source: 'mfc-inbound',
          type: 'RECEIVE',
          refId: 'RCV-TRF-0698a8c3-0268-4750-a216-4f3aae3362e7',
          taskId: 'TRF-MOCK-001',
          qty: 4,
          result: 'APPLIED',
          at: DateTime.now().toUtc(),
        ),
      ],
    );
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();
    expect(find.text('TRF T100001'), findsOneWidget);
    expect(find.textContaining('RCV-TRF-'), findsNothing);
    expect(find.textContaining('TRF-MOCK-001'), findsNothing);

    // 누르면 그 입고의 상품 목록(입고 예정 줄 — 서버 값)
    await t.tap(
      find.byKey(
        const ValueKey(
          'my-work-tap-RCV-TRF-0698a8c3-0268-4750-a216-4f3aae3362e7',
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-work-products')), findsOneWidget);
    expect(find.text('입고 상품'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('my-work-products')),
        matching: find.text('서울우유 1L'),
      ),
      findsWidgets,
    );
    expect(find.textContaining('예정 '), findsWidgets);
  });

  testWidgets('입고 아닌 기록도 누르면 그 작업의 상품·수량', (t) async {
    await pump(t);
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-work-tap-INB-M-1')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-work-products')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('my-work-product-E-00000003')),
      findsOneWidget,
    );
    expect(find.text('12개'), findsWidgets);
  });

  testWidgets('취소품 복귀·적치 기록은 상품이 기록에 없어도 작업을 다시 읽어 상품을', (t) async {
    await pump(
      t,
      extra: [
        WorkActivity(
          source: 'mfc-fulfillment',
          type: 'RETURN',
          refId: 'RET-REC-1',
          taskId: 'shp-9-RETURN',
          result: 'APPLIED',
          at: DateTime.now().toUtc(),
        ),
        WorkActivity(
          source: 'mfc-inbound',
          type: 'PUTAWAY',
          refId: 'PUT-REC-1',
          taskId: 'TSK-INS-mock-1',
          result: 'APPLIED',
          at: DateTime.now().toUtc(),
        ),
      ],
    );
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-work-tap-RET-REC-1')));
    await t.pumpAndSettle();
    final sheet = find.byKey(const ValueKey('my-work-products'));
    expect(
      find.descendant(of: sheet, matching: find.text('그릭요거트 플레인 400g')),
      findsWidgets,
    );
    expect(find.text('이 기록에는 상품 정보가 없어요'), findsNothing);
    await t.tapAt(const Offset(200, 40));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-work-tap-PUT-REC-1')));
    await t.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('my-work-products')),
        matching: find.textContaining('LOT-Y-1110'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('못 읽은 원장이 있으면 빈 내역으로 두지 않고 "일부 내역을 못 불러왔어요"', (t) async {
    await pump(t, unavailable: ['mfc-quality'], empty: true);
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-work-partial')), findsOneWidget);
    expect(find.textContaining('mfc-quality'), findsOneWidget);
    expect(find.byKey(const ValueKey('my-work-empty')), findsOneWidget);
  });

  testWidgets('업무 진행 화면: 단계 카드의 "이전" 줄을 누르면 오늘 업무 내역', (t) async {
    await pump(t);
    await openRoute(t, '/work/pickPack');
    await t.tap(find.byKey(const ValueKey('run-task')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('trail-previous')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('trail')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-work-summary')), findsOneWidget);
  });

  testWidgets('작업을 받을 수 없으면 사유와 서버 코드를 보인다', (t) async {
    await pump(t, nextRejectCode: 'WORKER_NOT_ACTIVE');
    await openRoute(t, '/work/pickPack');
    expect(find.textContaining('작업자 상태가 활동이 아니에요'), findsOneWidget);
    expect(find.text('사유 WORKER_NOT_ACTIVE'), findsOneWidget);
  });
}
