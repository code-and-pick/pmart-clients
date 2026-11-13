import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:pmart_core/pmart_core.dart';

import 'app.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/presentation/auth_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPmartFormatting();
  runApp(
    ProviderScope(
      // Riverpod 3 의 자동 재시도를 끈다. 재시도 규칙은 pmart_core(429·retryable)만 따른다.
      retry: (_, _) => null,
      overrides: [
        // 목 모드로 실행한 앱은 임시 아이디·비밀번호 로그인 화면에서 시작한다(계약에 없는 임시 화면 —
        // 실서버 빌드는 그대로 Keycloak 화면을 연다). 테스트는 이 파일을 거치지 않아 로그인된 상태로 시작한다.
        if (PmartEnv.fromDefine() == PmartEnv.mock)
          authRepositoryProvider.overrideWithValue(MockPasswordAuthRepository()),
      ],
      child: const MfcApp(),
    ),
  );
}
