import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/providers.dart';

/// 실서버 모드의 센터·작업자 ID 는 로그인 세션(토큰 `centers`·`sub`)에서 온다(2026-11-16 PC 1 알림 —
/// 목 값 `MFC-MOCK-01` 로 다른 센터를 불러 홈이 403 이던 문제).
void main() {
  setUpAll(initPmartFormatting);

  EmployeeSession worker(List<String> centers, {List<String>? roles}) =>
      EmployeeSession(
        operatorId: 'OP-0000000011',
        roles: roles ?? const ['MFC_WORKER'],
        centers: centers,
      );

  Future<FakeAdapter> pump(WidgetTester t, EmployeeSession session) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final adapter = FakeAdapter(
      (o, _) async => FakeReply(
        200,
        body: {
          'workerId': 'OP-0000000011',
          'displayName': '피패킹 11',
          'state': 'ACTIVE',
          'effectiveTaskTypes': ['PICK', 'PACK'],
          'workAreas': ['PICK_PACK'],
        },
      ),
    );
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.local),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(session: session),
          ),
          taskRepositoryProvider.overrideWithValue(
            MockTaskRepository(latency: Duration.zero),
          ),
          workRepositoryProvider.overrideWithValue(
            ApiWorkRepository(
              createPmartDio(
                baseUrl: 'http://test.invalid/api/v1',
                sourceSystem: sourceSystem,
                tokens: TokenStore(MemoryKeyValueStore()),
                refresher: (_) async => null,
                adapter: adapter,
                delay: (_) async {},
              ),
            ),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    return adapter;
  }

  testWidgets('센터가 하나면 그 센터·본인 운영자 ID 로 본인 조회 — 목 값을 쓰지 않는다', (t) async {
    final http = await pump(t, worker(['MFC-SEED-01']));
    expect(
      http.requests.map((r) => r.uri.path),
      contains('/api/v1/mfcs/MFC-SEED-01/workers/OP-0000000011'),
    );
    expect(
      http.requests.where((r) => r.uri.path.contains('MFC-MOCK-01')),
      isEmpty,
    );
    expect(find.byKey(const ValueKey('area-pickPack')), findsOneWidget);
    expect(find.byKey(const ValueKey('center-notice')), findsNothing);
  });

  testWidgets('센터가 없으면 업무 API 를 부르지 않고 안내', (t) async {
    final http = await pump(t, worker(const []));
    expect(http.requests, isEmpty);
    expect(find.text('근무 센터가 정해지지 않았어요. 센터 관리자에게 문의해 주세요.'), findsOneWidget);
    expect(find.byKey(const ValueKey('area-pickPack')), findsNothing);
  });

  testWidgets('권한 승인 대기(역할·센터 없음)면 승인 대기 안내만', (t) async {
    final http = await pump(t, worker(const [], roles: const []));
    expect(http.requests, isEmpty);
    expect(find.byKey(const ValueKey('awaiting-grant')), findsOneWidget);
    expect(find.byKey(const ValueKey('center-notice')), findsNothing);
  });

  testWidgets('센터가 여럿이면 앞의 것을 고르지 않고 안내', (t) async {
    final http = await pump(t, worker(['MFC-SEED-01', 'MFC-SEED-02']));
    expect(http.requests, isEmpty);
    expect(find.byKey(const ValueKey('center-notice')), findsOneWidget);
    expect(find.byKey(const ValueKey('area-pickPack')), findsNothing);
  });

  test('목 모드는 목 데이터의 센터·작업자(로그인 세션과 무관)', () {
    final c = ProviderContainer(
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        authRepositoryProvider.overrideWithValue(
          MockAuthRepository(session: worker(['MFC-SEED-01'])),
        ),
      ],
    );
    addTearDown(c.dispose);
    expect(c.read(currentMfcIdProvider), mockMfcId);
    expect(c.read(currentWorkerIdProvider), MockTaskRepository.workerId);
  });

  test('실서버 모드는 세션 값, 로그인 전이면 빈 값', () {
    ProviderContainer container(EmployeeSession? s) {
      final c = ProviderContainer(
        overrides: [
          envProvider.overrideWithValue(PmartEnv.local),
          authRepositoryProvider.overrideWithValue(
            s == null
                ? MockAuthRepository(signedIn: false)
                : MockAuthRepository(session: s),
          ),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    final signedIn = container(worker(['MFC-SEED-01']));
    expect(signedIn.read(currentMfcIdProvider), 'MFC-SEED-01');
    expect(signedIn.read(currentWorkerIdProvider), 'OP-0000000011');
    expect(signedIn.read(employeeSessionProvider), isNotNull);

    final signedOut = container(null);
    expect(signedOut.read(currentMfcIdProvider), '');
    expect(signedOut.read(currentWorkerIdProvider), '');
  });
}
