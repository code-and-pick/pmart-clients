import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

import 'support.dart';

/// 내 오늘 업무 내역(사용자 2026-11-17) — 업무 고르기·업무 진행 화면 위 작은 바의 칩으로 들어간다.
void main() {
  setUpAll(initPmartFormatting);

  Future<void> pump(WidgetTester t) async {
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
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
  }

  testWidgets('업무 고르기 화면 위 칩: 오늘 완료 건수, 누르면 오늘 내역만(어제 것은 빠진다)', (t) async {
    await pump(t);
    expect(find.text('업무 내역 · 오늘 2건'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();

    expect(find.text('오늘 업무 내역'), findsOneWidget);
    expect(find.byKey(const ValueKey('my-work-task-done-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('my-work-task-done-2')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('my-work-task-done-yesterday')),
      findsNothing,
    );
    expect(find.text('서울우유 1L 외 2건'), findsOneWidget);
    expect(find.textContaining('2/3개'), findsOneWidget); // 부분 종결 — 서버 수량 그대로
  });

  testWidgets('업무 진행 화면 위에도 같은 칩', (t) async {
    await pump(t);
    await openRoute(t, '/work/pickPack');
    expect(find.byKey(const ValueKey('my-work-chip')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('my-work-chip')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-work-summary')), findsOneWidget);
  });
}
