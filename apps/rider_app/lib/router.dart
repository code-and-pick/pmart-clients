import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/appeals/data/appeals.dart';
import 'features/appeals/presentation/appeal_screens.dart';
import 'features/auth/data/phone_identity.dart' show PhoneIdentityOutcome;
import 'features/auth/data/session.dart';
import 'features/auth/presentation/fee_guide_screen.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/auth/presentation/phone_identity_screen.dart';
import 'features/auth/presentation/signup_screens.dart';
import 'features/delivery/domain/delivery.dart' show FailureReason;
import 'features/delivery/presentation/delivery_list_screen.dart';
import 'features/delivery/presentation/delivery_screen.dart';
import 'features/delivery/presentation/photo_screen.dart';
import 'features/delivery/presentation/failure_screen.dart';
import 'features/delivery/presentation/qr_pickup_screen.dart';
import 'features/delivery/presentation/support_screen.dart';
import 'features/delivery/presentation/support_thread_screen.dart';
import 'features/home/presentation/home_screen.dart';
import 'features/inquiries/presentation/inquiry_screens.dart';
import 'features/inquiries/presentation/live_chat_screen.dart';
import 'features/notifications/data/notifications.dart';
import 'features/notifications/presentation/notification_screen.dart';
import 'features/my/presentation/my_screens.dart';
import 'features/my/presentation/account_screen.dart';
import 'features/my/presentation/phone_verify_prompt.dart';
import 'features/my/presentation/deduction_screens.dart';
import 'features/my/presentation/record_screens.dart';
import 'features/my/presentation/delivery_record_screen.dart';
import 'features/my/presentation/withdraw_screen.dart';
import 'features/offers/presentation/offer_detail_screen.dart';

/// 라우트. 로그인하지 않았으면 로그인·가입 화면만 열린다. 알림 딥링크는 푸시(BR-09) 결정 뒤 붙인다.
final routerProvider = Provider<GoRouter>((ref) {
  final loggedIn = ref.watch(sessionProvider.select((s) => s != null));
  final registered = ref.watch(
    sessionProvider.select((s) => s?.registered ?? false),
  );
  return GoRouter(
    initialLocation: '/',
    // 로그인(Google) → 가입 여부 확인(`GET /riders/me` 404 = 미가입) → 가입 화면 또는 홈
    // (백엔드 안내 2026-11-13 rider-app-notice-dispatch-apis §1).
    redirect: (_, state) {
      final at = state.matchedLocation;
      final signup = at.startsWith('/signup');
      if (!loggedIn) {
        return at == '/login' || at == '/signup/intro' ? null : '/login';
      }
      if (!registered) {
        return signup && at != '/signup/intro' ? null : '/signup';
      }
      if (at == '/login' || (signup && at != '/signup/done')) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/signup/intro',
        builder: (_, _) => const SignupIntroScreen(),
      ),
      GoRoute(path: '/signup', builder: (_, _) => const SignupFlowScreen()),
      GoRoute(path: '/signup/fees', builder: (_, _) => const FeeGuideScreen()),
      // 휴대폰 본인 확인(OCTOMO, rider 0.17.0) — 가입 전화번호 단계에서 연다.
      GoRoute(
        path: '/signup/phone',
        builder: (_, s) => PhoneIdentityScreen(phone: s.extra as String? ?? ''),
      ),
      // 가입한 라이더의 전화번호 인증(rider 0.28.0, 2026-11-25) — 번호 넣기 → 같은 본인 확인 화면 → 내 정보에 붙이기
      GoRoute(
        path: '/my/phone-verify',
        builder: (_, _) => const PhoneVerifyScreen(),
      ),
      GoRoute(
        path: '/my/phone-verify/check',
        builder: (_, s) => PhoneIdentityScreen(phone: s.extra as String? ?? ''),
      ),
      // 가입이 409(다른 계정·탈퇴한 번호)로 거절됐을 때 안내.
      GoRoute(
        path: '/signup/identity-ended',
        builder: (_, s) =>
            IdentityEndedScreen(outcome: s.extra! as PhoneIdentityOutcome),
      ),
      GoRoute(
        path: '/signup/terms/:type',
        builder: (_, s) => TermsScreen(type: s.pathParameters['type']!),
      ),
      GoRoute(
        path: '/signup/done',
        builder: (_, _) => const SignupDoneScreen(),
      ),
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      GoRoute(
        path: '/offers/:offerId',
        builder: (_, s) =>
            OfferDetailScreen(offerId: s.pathParameters['offerId']!),
      ),
      GoRoute(
        path: '/deliveries',
        builder: (_, _) => const DeliveryListScreen(),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId',
        builder: (_, s) =>
            DeliveryScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/qr',
        builder: (_, s) => QrPickupScreen(
          deliveryId: s.pathParameters['deliveryId']!,
          // ?with=id2,id3 — 같은 가게에서 함께 픽업하는 배송.
          withIds: [
            for (final id in (s.uri.queryParameters['with'] ?? '').split(','))
              if (id.isNotEmpty) id,
          ],
        ),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/photo',
        builder: (_, s) =>
            PhotoScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/failure',
        pageBuilder: (_, s) => _overMap(
          s,
          FailureScreen(
            deliveryId: s.pathParameters['deliveryId']!,
            // ?reason=unreachable|addressError — 지원센터 갈림길에서 미리 고른 사유.
            initialReason: FailureReason.values
                .where((r) => r.name == s.uri.queryParameters['reason'])
                .firstOrNull,
          ),
        ),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/support',
        pageBuilder: (_, s) => _riseUp(
          s,
          SupportScreen(deliveryId: s.pathParameters['deliveryId']!),
        ),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/support/:requestId',
        pageBuilder: (_, s) => _overMap(
          s,
          SupportThreadScreen(
            deliveryId: s.pathParameters['deliveryId']!,
            requestId: s.pathParameters['requestId']!,
          ),
        ),
      ),
      GoRoute(path: '/my', builder: (_, _) => const MyPageScreen()),
      GoRoute(path: '/my/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(path: '/my/account', builder: (_, _) => const AccountScreen()),
      GoRoute(
        path: '/my/dispatch-mode',
        builder: (_, _) => const DispatchModeScreen(),
      ),
      GoRoute(path: '/my/time', builder: (_, _) => const OperatingTimeScreen()),
      GoRoute(
        path: '/my/settlements',
        builder: (_, _) => const SettlementsScreen(),
      ),
      GoRoute(path: '/my/history', builder: (_, _) => const HistoryScreen()),
      // 오배송 차감·이의(execution 0.41.0 — 2026-11-24)
      GoRoute(
        path: '/my/deductions',
        builder: (_, _) => const DeductionsScreen(),
      ),
      GoRoute(
        path: '/my/deductions/:id/objection',
        builder: (_, s) =>
            DeductionObjectionScreen(deductionId: s.pathParameters['id']!),
      ),
      // 끝난 배송 보기(읽기 전용 — 2026-11-23)
      GoRoute(
        path: '/my/history/:deliveryId',
        builder: (_, s) =>
            DeliveryRecordScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      // 소명·이의 신청(rider 0.15.0) — ?type=restriction|earning&deliveryId=
      // 지원센터 "내 문의"(사용자 2026-11-25 탭 없이 문의·소명·이의 한 목록)
      GoRoute(
        path: '/my/appeals',
        builder: (_, _) => const SupportCenterScreen(),
      ),
      GoRoute(
        path: '/my/appeals/new',
        builder: (_, s) => AppealNewScreen(
          target: s.uri.queryParameters['type'] == 'earning'
              ? AppealTarget.earning
              : AppealTarget.restriction,
          deliveryId: s.uri.queryParameters['deliveryId'],
        ),
      ),
      // 배송 밖 문의(case-service, 라이더 토큰)·알림함(notification).
      GoRoute(
        path: '/my/inquiries',
        builder: (_, _) => const SupportCenterScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/chat',
        builder: (_, _) => const LiveChatScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/new',
        builder: (_, _) => const InquiryNewScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/:inquiryId',
        builder: (_, s) =>
            InquiryDetailScreen(inquiryId: s.pathParameters['inquiryId']!),
      ),
      GoRoute(path: '/my/withdraw', builder: (_, _) => const WithdrawScreen()),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => const NotificationScreen(),
      ),
      // 공지 전문 — 알림함에서 고른 공지를 extra 로(2026-11-24)
      GoRoute(
        path: '/notifications/notice',
        builder: (_, s) => NoticeScreen(
          notice: s.extra is RiderNotification
              ? s.extra! as RiderNotification
              : null,
          notificationId: s.uri.queryParameters['id'],
        ),
      ),
    ],
  );
});

/// 지도(카카오맵 — 안드로이드가 직접 그리는 화면) 위로 여닫는 화면의 전환. 기본 전환은 아래 화면을
/// 확대·축소해 지도가 함께 다시 그려지면서 끊긴다(사용자 지적 2026-11-17 "버벅거리면서 돌아간다") —
/// 지도를 움직이지 않는 짧은 페이드로 바꾼다.
Page<void> _overMap(GoRouterState s, Widget child) =>
    CustomTransitionPage<void>(
      key: s.pageKey,
      child: child,
      // 아래 지도 화면을 계속 그린다 — 다 가려지면 지도(안드로이드 화면)가 멈췄다가, 닫을 때 멈췄던 옛 그림이
      // 잔상처럼 남았다(사용자 2026-11-23 "잔상 남기면서 없어졌어").
      opaque: false,
      transitionDuration: const Duration(milliseconds: 180),
      reverseTransitionDuration: const Duration(milliseconds: 140),
      transitionsBuilder: (_, animation, _, child) =>
          FadeTransition(opacity: animation, child: child),
    );

/// 도움요청 화면 — 바로 뜨지 않고 아래에서 올라온다(사용자 2026-11-23 "바로 뜨는 거 말고 애니메이션").
/// 닫을 때는 아래로 내려가며 사라진다. 투명도를 바꾸지 않는다(반투명하게 겹치면 지도 위에 잔상이 남았다 —
/// 사용자 2026-11-23 "잔상 남기면서 없어졌어. 휴대폰에 문제 있는 것처럼 보여").
/// 아래 지도 화면은 계속 그린다(opaque: false) — 다 가려진 동안 지도가 멈췄다가 닫을 때 옛 그림이 보이지 않게.
Page<void> _riseUp(GoRouterState s, Widget child) => CustomTransitionPage<void>(
  key: s.pageKey,
  child: child,
  opaque: false,
  transitionDuration: const Duration(milliseconds: 300),
  reverseTransitionDuration: const Duration(milliseconds: 240),
  transitionsBuilder: (_, animation, _, child) => SlideTransition(
    position: Tween(begin: const Offset(0, 1), end: Offset.zero).animate(
      CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      ),
    ),
    child: child,
  ),
);
