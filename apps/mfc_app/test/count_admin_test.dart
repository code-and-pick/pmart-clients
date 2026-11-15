import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/stock_count/data/mock_stock_count_repository.dart';
import 'package:mfc_app/features/stock_count/domain/stock_count.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/field_repositories.dart';
import 'package:mfc_app/shared/providers.dart';

/// 센터 관리자 실사 시작·차이 승인(사용자 2026-11-16 — 잠금은 서버 판정, 승인 번호는 직접 입력).
void main() {
  setUpAll(initPmartFormatting);

  late MockStockCountRepository count;

  Future<void> pump(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    count = MockStockCountRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(
              session: const EmployeeSession(
                operatorId: 'OP-mock-sup',
                roles: [EmployeeSession.mfcSupervisorRole],
                centers: ['MFC-MOCK-01'],
              ),
            ),
          ),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          stockCountRepositoryProvider.overrideWithValue(count),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await tap(t, 'manage-counts');
  }

  Future<void> scan(WidgetTester t, String id, String code) async {
    await t.enterText(find.byKey(ValueKey(id)), code);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
  }

  bool enabled(WidgetTester t, String key) =>
      t.widget<ButtonStyleButton>(find.byKey(ValueKey(key))).onPressed != null;

  testWidgets('승인 대기 실사: 차이를 보고, 승인 번호를 넣어야 승인 → 조정됨', (t) async {
    await pump(t);
    await tap(t, 'count-recent-CNT-mock-2');
    expect(find.text('장부 12 → 10 (-2)'), findsOneWidget);
    expect(enabled(t, 'count-approve'), isFalse);
    expect(enabled(t, 'count-reject'), isTrue);

    await t.enterText(
      find.byKey(const ValueKey('count-approval-ref')),
      'APR-2026-001',
    );
    await t.pump();
    await t.ensureVisible(find.byKey(const ValueKey('count-approve')));
    await tap(t, 'count-approve');
    expect(
      (await t.runAsync(() => count.session('M', 'CNT-mock-2')))!.state,
      CountState.adjusted,
    );
    expect(find.byKey(const ValueKey('count-approve')), findsNothing);
  });

  testWidgets('센 사람은 승인할 수 없다(SELF_APPROVAL), 반려는 승인 번호 없이', (t) async {
    await pump(t);
    count.approver = 'OP-mock-2'; // 재계수한 사람
    await tap(t, 'count-recent-CNT-mock-2');
    await t.enterText(find.byKey(const ValueKey('count-approval-ref')), 'X');
    await t.pump();
    await t.ensureVisible(find.byKey(const ValueKey('count-approve')));
    await tap(t, 'count-approve');
    expect(find.byKey(const ValueKey('count-decide-rejected')), findsOneWidget);

    count.approver = 'OP-mock-sup';
    await t.enterText(find.byKey(const ValueKey('count-approval-ref')), '');
    await t.pump();
    await tap(t, 'count-reject');
    expect(
      (await t.runAsync(() => count.session('M', 'CNT-mock-2')))!.state,
      CountState.rejected,
    );
  });

  testWidgets('실사 시작: 칸을 찍고 시작하면 그 실사로 간다(계수 중 — 차이 없음)', (t) async {
    await pump(t);
    await tap(t, 'new-count');
    expect(
      t
          .widget<CommandButton>(
            find.byKey(const ValueKey('count-start-submit')),
          )
          .onPressed,
      isNull,
    );
    await scan(t, 'count-start-loc', 'hello');
    expect(find.byKey(const ValueKey('count-start-hello')), findsNothing);
    await scan(t, 'count-start-loc', 'A-S3-01-1-11');
    await scan(t, 'count-start-loc', 'C-S1-02-2-06');
    await scan(t, 'count-start-loc', 'C-S1-02-2-06'); // 같은 칸은 한 번
    expect(find.byType(InputChip), findsNWidgets(2));
    await tap(t, 'count-start-submit');

    expect(find.text('CNT-mock-3'), findsOneWidget);
    expect(find.byKey(const ValueKey('count-no-diff')), findsOneWidget);
    expect(find.byKey(const ValueKey('count-approve')), findsNothing);
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('count-recent-CNT-mock-3')),
      findsOneWidget,
    );
  });

  testWidgets('실사 번호로 찾기', (t) async {
    await pump(t);
    await scan(t, 'count-find', 'CNT-mock-1');
    expect(find.text('CNT-mock-1'), findsWidgets);
    expect(find.byKey(const ValueKey('count-admin-state')), findsOneWidget);
  });
}

Future<void> tap(WidgetTester t, String key) async {
  await t.tap(find.byKey(ValueKey(key)));
  await t.pumpAndSettle();
}
