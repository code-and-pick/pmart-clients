import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:pmart_core/pmart_core.dart' show PmartEnv;

import 'features/auth/presentation/auth_controller.dart';
import 'features/push/presentation/push_controller.dart'
    show pushRegistrationProvider;
import 'l10n/gen/app_localizations.dart';
import 'router.dart';
import 'shared/providers.dart';

/// 화면 어디서든 세션 안내(스낵바)를 띄우기 위한 루트 메신저.
final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

class CustomerApp extends ConsumerWidget {
  const CustomerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 저장된 세션 확인(한 번). 결과는 sessionProvider 로 퍼진다.
    ref.watch(sessionRestoreProvider);
    // 휴대폰 푸시: 회원이 되면 알림 권한·토큰 등록, 비회원이 되면 단말 토큰을 버린다.
    ref.watch(pushRegistrationProvider);
    // 세션이 끝났을 때 한 번 알린다: 조용히 이어졌으면 짧게, 안 됐으면 "다시 로그인" 버튼과 함께.
    ref.listen(sessionNoticeProvider, (_, notice) {
      if (notice == null) return;
      ref.read(sessionNoticeProvider.notifier).clear();
      final messenger = rootScaffoldMessengerKey.currentState;
      final ctx = rootScaffoldMessengerKey.currentContext;
      if (messenger == null || ctx == null) return;
      final l10n = AppLocalizations.of(ctx);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(switch (notice) {
        SessionNotice.renewed => SnackBar(
          key: const ValueKey('session-renewed'),
          content: Text(l10n.sessionRenewed),
        ),
        SessionNotice.expired => SnackBar(
          key: const ValueKey('session-expired'),
          content: Text(l10n.sessionExpiredNotice),
          duration: const Duration(seconds: 8),
          action: SnackBarAction(
            label: l10n.sessionExpiredLogin,
            // 로그인은 현재 화면 위에 열리고, 끝나면 그 화면으로 돌아온다(입력값 유지).
            onPressed: () => ref.read(routerProvider).push('/login'),
          ),
        ),
        SessionNotice.unreachable => SnackBar(
          key: const ValueKey('session-unreachable'),
          content: Text(l10n.sessionUnreachableNotice),
          duration: const Duration(seconds: 8),
          action: SnackBarAction(
            label: l10n.sessionRetry,
            onPressed: () => ref.read(sessionProvider.notifier).retryRestore(),
          ),
        ),
      });
    });
    return _app(ref);
  }

  Widget _app(WidgetRef ref) => MaterialApp.router(
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
    theme: PmartCustomerTheme.light(fontFamily: 'Pretendard'),
    darkTheme: PmartCustomerTheme.dark(fontFamily: 'Pretendard'),
    locale: const Locale('ko'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      PmartUiLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    routerConfig: ref.watch(routerProvider),
    // 목 모드는 화면 모서리에 띠를 둔다(실서버와 헷갈리지 않게: 목 로그인은 Google 창 없이 항상 성공한다).
    builder: (context, child) => _RestoreOnResume(
      child: ref.watch(envProvider) == PmartEnv.mock
          ? Banner(
              message: AppLocalizations.of(context).mockBanner,
              location: BannerLocation.topStart,
              child: child ?? const SizedBox.shrink(),
            )
          : child ?? const SizedBox.shrink(),
    ),
  );
}

/// 저장된 세션을 확인하지 못한 채라면(연결 안 됨) 앱이 다시 앞으로 올 때 다시 확인한다.
class _RestoreOnResume extends ConsumerStatefulWidget {
  const _RestoreOnResume({required this.child});

  final Widget child;

  @override
  ConsumerState<_RestoreOnResume> createState() => _RestoreOnResumeState();
}

class _RestoreOnResumeState extends ConsumerState<_RestoreOnResume> {
  AppLifecycleListener? _listener;

  @override
  void initState() {
    super.initState();
    _listener = AppLifecycleListener(
      onResume: () => ref.read(sessionProvider.notifier).retryRestore(),
    );
  }

  @override
  void dispose() {
    _listener?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
