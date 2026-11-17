import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'app.dart';
import 'features/auth/data/session.dart';
import 'shared/kakao_navi.dart';
import 'shared/rider_map.dart' show kakaoNativeAppKey;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPmartFormatting();
  // 카카오 지도·내비는 키가 있을 때만 켠다(빌드 때 --dart-define-from-file=.secrets/rider.env). 키는 로그에 남기지 않는다.
  if (kakaoNativeAppKey.isNotEmpty) {
    await KakaoMapSdk.instance.initialize(kakaoNativeAppKey);
    initKakaoNavi();
  }
  // 앱이 내려졌다 다시 켜져도(카메라 등) 로그인 상태를 잇는다.
  final saved = await loadSavedSession(FlutterSecureKeyValueStore());
  runApp(
    // Riverpod 3 의 자동 재시도를 끈다. 재시도 규칙은 pmart_core(429·retryable)만 따른다.
    ProviderScope(
      retry: (_, _) => null,
      overrides: [initialSessionProvider.overrideWithValue(saved)],
      child: const RiderApp(),
    ),
  );
  // 카카오내비 SDK 사용 권한 확인용 빌드(--dart-define=KNSDK_PROBE=true)에서만: 인증 결과 코드를 로그에 남긴다.
  if (const bool.fromEnvironment('KNSDK_PROBE')) {
    final code = await probeInAppNavi();
    debugPrint('KNSDK probe: ${code ?? 'OK'}');
  }
}
