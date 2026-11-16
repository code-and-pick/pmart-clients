import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/manage/presentation/count_admin_screens.dart';
import 'features/manage/presentation/manage_screens.dart';
import 'features/manage/presentation/move_admin_screens.dart';
import 'features/auth/domain/employee_auth.dart';
import 'features/auth/presentation/auth_controller.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/device/presentation/device_setup_screens.dart';
import 'features/handover/presentation/handover_screens.dart';
import 'features/inbound/presentation/inbound_screen.dart';
import 'features/my_work/presentation/my_work.dart';
import 'features/quality/presentation/quality_screens.dart';
import 'features/stock_check/presentation/stock_check_screen.dart';
import 'features/stock_count/presentation/stock_count_screen.dart';
import 'features/stock_move/presentation/stock_move_screens.dart';
import 'features/tasks/presentation/tasks_screen.dart';
import 'features/work/domain/work.dart';
import 'features/work/presentation/work_screens.dart';
import 'shared/printer/printer_ui.dart';

/// 라우트. 로그인 전에는 시작 메뉴(로그인·기기 설정·재고 확인, 사용자 2026-11-17)로, 세션이 끝나면 로그인 화면으로 보낸다
/// (직원 로그인 — 백엔드 handoff 2026-11-13).
/// 화면을 막는 것은 편의일 뿐이고, 권한 판정은 서버가 한다.
/// 크루는 작업 목록을 보지 않는다(2026-11-10) — 메인 → 업무 안내 → 서버가 준 작업 하나.
/// 로그인 뒤 갈 곳(시작 메뉴의 "재고 확인" — 사용자 2026-11-17 "로그인 화면 → 끝나면 그 메뉴로").
final afterLoginProvider = NotifierProvider<AfterLogin, String?>(
  AfterLogin.new,
);

class AfterLogin extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? location) => state = location;

  /// 한 번 쓰고 지운다.
  String? take() {
    final v = state;
    state = null;
    return v;
  }
}

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
        // 로그인 전 첫 화면은 시작 메뉴(로그인·기기 설정·재고 확인, 사용자 2026-11-17).
        // 세션이 끝나 나온 경우만 이유 안내를 위해 바로 로그인 화면.
        AuthSignedOut(:final ended) =>
          at == '/start' || at == '/login' || at.startsWith('/setup')
              ? null
              : ended != null
              ? '/login'
              : '/start',
        // 로그인되면 메인 — 시작 메뉴에서 고른 곳(재고 확인)이 있으면 그리로(메인 위에 쌓인다).
        AuthSignedIn() =>
          at == '/start' ||
                  at == '/starting' ||
                  at == '/login' ||
                  at.startsWith('/setup')
              ? ref.read(afterLoginProvider.notifier).take() ?? '/'
              : null,
      };
    },
    routes: [
      GoRoute(
        path: '/setup',
        builder: (_, _) => const DeviceSetupScreen(),
        routes: [
          GoRoute(
            path: 'network',
            builder: (_, _) => const NetworkSettingsScreen(),
          ),
          GoRoute(
            path: 'printer',
            builder: (_, _) => const PrinterSettingsScreen(),
          ),
          GoRoute(
            path: 'scanner',
            builder: (_, _) => const ScannerCheckScreen(),
          ),
          GoRoute(path: 'device', builder: (_, _) => const DeviceInfoScreen()),
        ],
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/starting', builder: (_, _) => const StartingScreen()),
      GoRoute(path: '/start', builder: (_, _) => const StartScreen()),
      GoRoute(
        path: '/',
        builder: (_, _) => const HomeScreen(),
        routes: [
          // 메인 위에 쌓인다(뒤로 → 메인).
          GoRoute(
            path: 'stock-check',
            builder: (_, _) => const StockCheckScreen(),
          ),
          GoRoute(path: 'my-work', builder: (_, _) => const MyWorkScreen()),
        ],
      ),
      // 센터 관리자 관리 메뉴(사용자 2026-11-16). 권한 판정은 서버 — 작업자가 열면 서버가 403.
      GoRoute(
        path: '/manage/tasks',
        builder: (_, _) => const CenterTasksScreen(),
      ),
      GoRoute(
        path: '/manage/moves',
        builder: (_, _) => const MoveOrdersScreen(),
      ),
      GoRoute(
        path: '/manage/moves/new',
        builder: (_, _) => const NewMoveScreen(),
      ),
      GoRoute(
        path: '/manage/counts',
        builder: (_, _) => const CountAdminScreen(),
      ),
      GoRoute(
        path: '/manage/counts/new',
        builder: (_, _) => const StartCountScreen(),
      ),
      GoRoute(
        path: '/manage/counts/:id',
        builder: (_, s) =>
            CountSessionAdminScreen(sessionId: s.pathParameters['id']!),
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
