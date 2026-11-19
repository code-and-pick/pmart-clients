import 'package:flutter/widgets.dart';
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
import 'features/return_handover/presentation/return_handover_screen.dart';
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
        pageBuilder: (_, s) => _page(s, const DeviceSetupScreen()),
        routes: [
          GoRoute(
            path: 'printer',
            pageBuilder: (_, s) => _page(s, const PrinterSettingsScreen()),
          ),
          GoRoute(
            path: 'scanner',
            pageBuilder: (_, s) => _page(s, const ScannerCheckScreen()),
          ),
          GoRoute(
            path: 'device',
            pageBuilder: (_, s) => _page(s, const DeviceInfoScreen()),
          ),
        ],
      ),
      GoRoute(
        path: '/login',
        pageBuilder: (_, s) => _page(s, const LoginScreen()),
      ),
      GoRoute(
        path: '/starting',
        pageBuilder: (_, s) => _page(s, const StartingScreen()),
      ),
      GoRoute(
        path: '/start',
        pageBuilder: (_, s) => _page(s, const StartScreen()),
      ),
      GoRoute(
        path: '/',
        pageBuilder: (_, s) => _page(s, const HomeScreen()),
        routes: [
          // 메인 위에 쌓인다(뒤로 → 메인).
          GoRoute(
            path: 'stock-check',
            pageBuilder: (_, s) => _page(s, const StockCheckScreen()),
          ),
          GoRoute(
            path: 'my-work',
            pageBuilder: (_, s) => _page(s, const MyWorkScreen()),
          ),
        ],
      ),
      // 센터 관리자 관리 메뉴(사용자 2026-11-16). 권한 판정은 서버 — 작업자가 열면 서버가 403.
      GoRoute(
        path: '/manage/tasks',
        pageBuilder: (_, s) => _page(s, const CenterTasksScreen()),
      ),
      GoRoute(
        path: '/manage/moves',
        pageBuilder: (_, s) => _page(s, const MoveOrdersScreen()),
      ),
      GoRoute(
        path: '/manage/moves/new',
        pageBuilder: (_, s) => _page(s, const NewMoveScreen()),
      ),
      GoRoute(
        path: '/manage/counts',
        pageBuilder: (_, s) => _page(s, const CountAdminScreen()),
      ),
      GoRoute(
        path: '/manage/counts/new',
        pageBuilder: (_, s) => _page(s, const StartCountScreen()),
      ),
      GoRoute(
        path: '/manage/counts/:id',
        pageBuilder: (_, s) => _page(
          s,
          CountSessionAdminScreen(sessionId: s.pathParameters['id']!),
        ),
      ),
      GoRoute(
        path: '/manage/workers',
        pageBuilder: (_, s) => _page(s, const CenterWorkersScreen()),
      ),
      GoRoute(
        path: '/work/:area',
        redirect: (_, s) =>
            WorkArea.fromName(s.pathParameters['area']) == null ? '/' : null,
        pageBuilder: (_, s) => _page(
          s,
          WorkSessionScreen(area: WorkArea.fromName(s.pathParameters['area'])!),
        ),
      ),
      // 안내는 첫 화면 바로 위 한 장(업무 화면 아래에 두지 않는다) — 고른 칸이 커지며 안내 카드가 되게
      // (Hero, 사용자 2026-11-19). 확인을 누르면 업무 화면으로 바꾼다.
      GoRoute(
        path: '/guide/:area',
        redirect: (_, s) =>
            WorkArea.fromName(s.pathParameters['area']) == null ? '/' : null,
        // 넘김 효과가 있어야 칸이 커지는 모습(Hero)이 보인다 — 이 화면만 페이지 넘김을 직접 정한다.
        pageBuilder: (_, s) => CustomTransitionPage<void>(
          key: s.pageKey,
          transitionDuration: const Duration(milliseconds: 380),
          reverseTransitionDuration: const Duration(milliseconds: 300),
          transitionsBuilder: (_, animation, _, child) => FadeTransition(
            opacity: CurvedAnimation(
              parent: animation,
              // 앞 절반에 바탕을 다 덮어 겹쳐 보이지 않게 — 뒤 절반은 칸이 커지는 것만 보인다.
              curve: const Interval(0, 0.45, curve: Curves.easeOut),
            ),
            child: child,
          ),
          child: WorkGuideScreen(
            area: WorkArea.fromName(s.pathParameters['area'])!,
          ),
        ),
      ),
      GoRoute(
        path: '/inbound/:trfId',
        pageBuilder: (_, s) =>
            _page(s, InboundReceiveScreen(trfId: s.pathParameters['trfId']!)),
      ),
      GoRoute(
        path: '/quality/inspect/:taskId',
        pageBuilder: (_, s) =>
            _page(s, InspectScreen(taskId: s.pathParameters['taskId']!)),
      ),
      GoRoute(
        path: '/quality/return/:id',
        pageBuilder: (_, s) => _page(
          s,
          ReturnInspectScreen(returnReceiptId: s.pathParameters['id']!),
        ),
      ),
      GoRoute(
        path: '/stock/move/:id',
        pageBuilder: (_, s) =>
            _page(s, MoveScreen(moveId: s.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/stock/putaway/:id',
        pageBuilder: (_, s) =>
            _page(s, PutawayScreen(taskId: s.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/stock/count/:id',
        pageBuilder: (_, s) =>
            _page(s, CountScreen(sessionId: s.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/settings/printer',
        pageBuilder: (_, s) => _page(s, const PrinterSettingsScreen()),
      ),
      GoRoute(
        path: '/handover-checks',
        pageBuilder: (_, s) => _page(s, const HandoverChecksScreen()),
      ),
      // 반납 인증번호(delivery-execution 0.28.0) — 센터 직원 누구나(권한 판정은 서버).
      GoRoute(
        path: '/return-handovers',
        pageBuilder: (_, s) => _page(s, const ReturnHandoversScreen()),
      ),
      GoRoute(
        path: '/packages/:packageId/handover',
        pageBuilder: (_, s) => _page(
          s,
          PackageHandoverScreen(
            packageId: s.pathParameters['packageId']!,
            scannedVersion: int.tryParse(
              s.uri.queryParameters['scanned'] ?? '',
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/tasks/:taskId',
        pageBuilder: (_, s) =>
            _page(s, TaskRunScreen(taskId: s.pathParameters['taskId']!)),
      ),
    ],
  );
});

/// 화면 넘김 — 모든 화면이 짧게 흐려지며 넘어간다(같은 느낌, 사용자 2026-11-19).
/// go_router 기본이 이 앱에서 넘김 없음(0초)으로 잡혀 직접 정한다.
Page<void> _page(GoRouterState s, Widget child) => CustomTransitionPage<void>(
  key: s.pageKey,
  transitionDuration: const Duration(milliseconds: 220),
  reverseTransitionDuration: const Duration(milliseconds: 180),
  transitionsBuilder: (_, animation, _, child) => FadeTransition(
    opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
    child: child,
  ),
  child: child,
);
