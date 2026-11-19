import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart'
    show KakaoSdk;
import 'package:kakao_map_sdk/kakao_map_sdk.dart';
import 'package:pmart_core/pmart_core.dart' show trustPmartLanRootCa;
import 'package:pmart_ui/pmart_ui.dart';

import 'app.dart';
import 'features/address/presentation/map_pick_screen.dart' show kakaoNativeAppKey;
import 'features/auth/presentation/auth_controller.dart'
    show sessionExpiryHandlerProvider;
import 'features/push/presentation/push_controller.dart'
    show pushRegistrationProvider;
import 'shared/providers.dart'
    show beforeSignOutProvider, onSessionExpiredProvider;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPmartFormatting();
  // LAN HTTPS 게이트웨이(사설 CA, ADR-0057)를 믿는다 — 운영(release) 빌드에는 넣지 않는다(T6).
  if (!kReleaseMode) trustPmartLanRootCa();
  // 카카오 지도는 키가 있을 때만 켠다(빌드 때 --dart-define-from-file=.secrets/customer.env). 키는 로그에 남기지 않는다.
  if (kakaoNativeAppKey.isNotEmpty) {
    await KakaoMapSdk.instance.initialize(kakaoNativeAppKey);
    // 카카오 로그인도 같은 네이티브 앱 키(BR-65).
    await KakaoSdk.init(nativeAppKey: kakaoNativeAppKey);
  }
  runApp(
    // Riverpod 3 의 자동 재시도를 끈다. 재시도 규칙은 pmart_core(429·retryable)만 따른다.
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        // 세션 종료(갱신 거절) → 조용한 재로그인 → 안 되면 비회원 + 안내
        onSessionExpiredProvider.overrideWith(
          (ref) => ref.read(sessionExpiryHandlerProvider),
        ),
        // 로그아웃 직전 서버에서 이 단말의 푸시 토큰을 지운다
        beforeSignOutProvider.overrideWith(
          (ref) =>
              () => ref
                  .read(pushRegistrationProvider.notifier)
                  .unregisterBeforeSignOut(),
        ),
      ],
      child: const CustomerApp(),
    ),
  );
}
