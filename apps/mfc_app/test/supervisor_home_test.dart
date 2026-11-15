import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/data/task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

/// 로그인 역할에 따라 홈이 다르다(사용자 2026-11-16): 센터 관리자는 관리 메뉴 + 작업 업무, 작업자는 업무만.
void main() {
  setUpAll(initPmartFormatting);

  const supervisor = EmployeeSession(
    operatorId: 'OP-mock-sup',
    roles: [EmployeeSession.mfcSupervisorRole],
    centers: ['MFC-MOCK-01'],
  );

  Future<void> pump(WidgetTester t, EmployeeSession session) async {
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
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(session: session),
          ),
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

  Future<void> tap(WidgetTester t, String key) async {
    await t.tap(find.byKey(ValueKey(key)));
    await t.pumpAndSettle();
  }

  testWidgets('작업자: 관리 메뉴 없이 업무만', (t) async {
    await pump(t, MockAuthRepository.mockSession);
    expect(find.byKey(const ValueKey('area-pickPack')), findsOneWidget);
    expect(find.byKey(const ValueKey('manage-menu')), findsNothing);
  });

  testWidgets('센터 관리자: 관리 메뉴 + 작업 업무, 작업 현황은 센터 전체·거르기', (t) async {
    await pump(t, supervisor);
    expect(find.byKey(const ValueKey('manage-menu')), findsOneWidget);
    expect(find.byKey(const ValueKey('area-pickPack')), findsOneWidget);

    await tap(t, 'manage-tasks');
    // 진행 중(ASSIGNED·IN_PROGRESS) — 목 작업 모두 담당이 있다.
    expect(
      find.byKey(const ValueKey('center-task-task-mock-1')),
      findsOneWidget,
    );
    expect(find.text('담당 ${MockTaskRepository.workerId}'), findsWidgets);
    expect(find.byKey(const ValueKey('center-task-task-mock-3')), findsNothing);
    // 막힘(결품 보고로 고객 확인 대기).
    await tap(t, 'task-filter-blocked');
    expect(
      find.byKey(const ValueKey('center-task-task-mock-3')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('center-task-task-mock-1')), findsNothing);
  });

  testWidgets('센터 관리자: 작업자 현황 — 근무·휴게·정지', (t) async {
    await pump(t, supervisor);
    await tap(t, 'manage-workers');
    expect(find.text('근무 3명 · 휴게 1명'), findsOneWidget);
    expect(find.text('정지'), findsOneWidget);
    expect(find.text('휴게 중'), findsOneWidget);
  });

  test('목 로그인: claude-mfc-sup 은 센터 관리자, mfcw-* 는 작업자', () async {
    final repo = MockPasswordAuthRepository();
    final sup = await repo.loginWithPassword(
      loginId: MockPasswordAuthRepository.supervisorAccount,
      password: 'x',
    );
    expect(sup.isSupervisor, isTrue);
    final w = await repo.loginWithPassword(
      loginId: 'mfcw-pp-01',
      password: 'x',
    );
    expect(w.isSupervisor, isFalse);
  });

  test('작업 현황 목록: 담당·늦음·실적 없음을 옮긴다', () {
    final l = taskListFromContract(
      api.ListTasks200Response.fromJson({
        'items': [
          {
            'taskId': 't-1',
            'taskType': 'PICK',
            'state': 'IN_PROGRESS',
            'assignment': {'workerId': 'OP-1', 'assignmentVersion': 1},
            'late': true,
            'idle': false,
          },
        ],
        'page': {'nextCursor': null, 'size': 50},
        'asOf': {'asOf': '2026-11-16T00:00:00Z', 'freshness': 'CURRENT'},
      }),
    );
    final t = l.tasks.single;
    expect(t.assigneeId, 'OP-1');
    expect(t.late, isTrue);
    expect(t.idle, isFalse);
  });
}
