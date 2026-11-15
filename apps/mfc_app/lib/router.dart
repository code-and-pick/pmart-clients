import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/manage/presentation/manage_screens.dart';
import 'features/auth/domain/employee_auth.dart';
import 'features/auth/presentation/auth_controller.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/handover/presentation/handover_screens.dart';
import 'features/inbound/presentation/inbound_screen.dart';
import 'features/quality/presentation/quality_screens.dart';
import 'features/stock_count/presentation/stock_count_screen.dart';
import 'features/stock_move/presentation/stock_move_screens.dart';
import 'features/tasks/presentation/tasks_screen.dart';
import 'features/work/domain/work.dart';
import 'features/work/presentation/work_screens.dart';
import 'shared/printer/printer_ui.dart';

/// 라우트. 로그인 전·세션 종료 뒤에는 로그인 화면으로 보낸다(직원 로그인 — 백엔드 handoff 2026-11-13).
/// 화면을 막는 것은 편의일 뿐이고, 권한 판정은 서버가 한다.
/// 크루는 작업 목록을 보지 않는다(2026-11-10) — 메인 → 업무 안내 → 서버가 준 작업 하나.
final routerProvider = Provider<GoRouter>((ref) {
  // 세션 상태가 바뀌면 리다이렉트를 다시 계산한다.
  final auth = ValueNotifier<AuthState>(ref.read(authControllerProvider));
  ref
    ..listen(authControllerProvider, (_, next) => auth.value = next)
    ..onDispose(auth.dispose);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (_, s) {
      final at = s.matchedLocation;
      return switch (auth.value) {
        AuthRestoring() => at == '/starting' ? null : '/starting',
        AuthSignedOut() => at == '/login' ? null : '/login',
        AuthSignedIn() => at == '/login' || at == '/starting' ? '/' : null,
      };
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/starting', builder: (_, _) => const StartingScreen()),
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      // 센터 관리자 관리 메뉴(사용자 2026-11-16). 권한 판정은 서버 — 작업자가 열면 서버가 403.
      GoRoute(
        path: '/manage/tasks',
        builder: (_, _) => const CenterTasksScreen(),
      ),
      GoRoute(
        path: '/manage/workers',
        builder: (_, _) => const CenterWorkersScreen(),
      ),
      GoRoute(
        path: '/work/:area',
        redirect: (_, s) =>
            WorkArea.fromName(s.pathParameters['area']) == null ? '/' : null,
        builder: (_, s) => WorkSessionScreen(
          area: WorkArea.fromName(s.pathParameters['area'])!,
        ),
        routes: [
          GoRoute(
            path: 'guide',
            builder: (_, s) => WorkGuideScreen(
              area: WorkArea.fromName(s.pathParameters['area'])!,
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/inbound/:trfId',
        builder: (_, s) =>
            InboundReceiveScreen(trfId: s.pathParameters['trfId']!),
      ),
      GoRoute(
        path: '/quality/inspect/:taskId',
        builder: (_, s) => InspectScreen(taskId: s.pathParameters['taskId']!),
      ),
      GoRoute(
        path: '/quality/return/:id',
        builder: (_, s) =>
            ReturnInspectScreen(returnReceiptId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/stock/move/:id',
        builder: (_, s) => MoveScreen(moveId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/stock/putaway/:id',
        builder: (_, s) => PutawayScreen(taskId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/stock/count/:id',
        builder: (_, s) => CountScreen(sessionId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/settings/printer',
        builder: (_, _) => const PrinterSettingsScreen(),
      ),
      GoRoute(
        path: '/handover-checks',
        builder: (_, _) => const HandoverChecksScreen(),
      ),
      GoRoute(
        path: '/packages/:packageId/handover',
        builder: (_, s) => PackageHandoverScreen(
          packageId: s.pathParameters['packageId']!,
          scannedVersion: int.tryParse(s.uri.queryParameters['scanned'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/tasks/:taskId',
        builder: (_, s) => TaskRunScreen(taskId: s.pathParameters['taskId']!),
      ),
    ],
  );
});
