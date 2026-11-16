import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../features/auth/data/auth_repository.dart';
import '../features/auth/presentation/auth_controller.dart';
import '../features/device/data/server_address.dart';

/// `X-Source-System` (값 확정은 BR-08).
const sourceSystem = 'mfc-app';

final envProvider = Provider<PmartEnv>((_) => PmartEnv.fromDefine());

final secureStoreProvider = Provider<SecureKeyValueStore>(
  (_) => FlutterSecureKeyValueStore(),
);

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(ref.watch(secureStoreProvider)),
);

/// 이 PDA 의 기기 ID. 로그인·티켓 교환·토큰 갱신이 같은 값을 보낸다(`X-Device-Id`).
final deviceIdProvider = Provider<DeviceIdProvider>(
  (ref) => DeviceIdProvider(ref.watch(secureStoreProvider)),
);

/// 실서버(local) 게이트웨이 주소. 목 모드에서는 만들지 않는다.
/// 기기 설정에서 저장한 주소가 있으면 그것(사용자 2026-11-17), 없으면 빌드 기본값.
final apiBaseUrlProvider = Provider<String>((ref) {
  final env = ref.watch(envProvider);
  if (env == PmartEnv.mock) {
    throw StateError('목 모드는 네트워크를 쓰지 않는다. Repository 목 구현을 써야 한다.');
  }
  return ref.watch(serverAddressProvider) ?? defaultApiBaseUrl(env);
});

/// 빌드 때 정한 기준 주소(`PMART_API_BASE_URL`, 없으면 환경 기본값).
String defaultApiBaseUrl(PmartEnv env) => apiBaseUrl(
  env,
  androidEmulator: const bool.fromEnvironment('PMART_ANDROID_EMULATOR'),
);

/// 갱신이 거절된 이유(로그인 화면 안내용).
final sessionEndRecorderProvider = Provider<SessionEndRecorder>(
  (_) => SessionEndRecorder(),
);

/// 직원 토큰 갱신(`POST /employee-auth/tokens/refresh`, 회전). 세션이 끝났으면 null.
final tokenRefresherProvider = Provider<TokenRefresher>(
  (ref) => employeeAuthRefresher(
    baseUrl: ref.watch(apiBaseUrlProvider),
    sourceSystem: sourceSystem,
    deviceId: ref.watch(deviceIdProvider),
    ended: ref.watch(sessionEndRecorderProvider),
  ),
);

/// 실서버(local) 연동용 Dio. 목 모드에서는 만들지 않는다.
///
/// 401 이면 인터셉터가 한 번 갱신한다(동시 요청도 한 번으로). 갱신이 거절되면(무활동 30분·최대 12시간·정지/퇴사)
/// 토큰을 지우고 세션 컨트롤러에 알린다 → 로그인 화면.
/// 그 401 이 `SUBJECT_BLOCKED`(정지·퇴사 즉시 차단)였으면 "이용할 수 없는 계정"으로 안내한다.
final dioProvider = Provider<Dio>(
  (ref) => watchSubjectBlocked(
    createPmartDio(
      baseUrl: ref.watch(apiBaseUrlProvider),
      sourceSystem: sourceSystem,
      tokens: ref.watch(tokenStoreProvider),
      deviceId: ref.watch(deviceIdProvider),
      refresher: ref.watch(tokenRefresherProvider),
      onSessionExpired: () =>
          ref.read(authControllerProvider.notifier).sessionExpired(),
      log: kDebugMode ? debugPrint : null,
    ),
    ref.watch(sessionEndRecorderProvider),
  ),
);
