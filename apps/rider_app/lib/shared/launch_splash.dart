import 'package:flutter/widgets.dart';

/// 시작 화면 그림 바탕 보라(Android `@color/pick_rider_splash` 와 같다 — 시스템 시작 화면에서 이어 보이게).
const pickRiderSplashColor = Color(0xFF7D04F2);

/// 앱을 켜고 준비(카카오·Firebase·저장된 로그인 불러오기)하는 동안 보이는 픽라이더 전체 시작 화면(사용자 2026-11-19).
/// 그림은 자르거나 키우지 않고 화면 폭에 맞춰 통째로 보인다(contain, 사용자 2026-11-20 "자르지마 … 너무 커지더라") — 남는 위아래는 같은 보라.
/// 앱(MaterialApp)보다 먼저 `runApp` 으로 그리므로 Material·l10n 에 기대지 않는다. 그림 속 글자는 그림 일부다.
class PickRiderSplash extends StatelessWidget {
  const PickRiderSplash({super.key});

  @override
  Widget build(BuildContext context) => const Directionality(
    textDirection: TextDirection.ltr,
    child: ColoredBox(
      color: pickRiderSplashColor,
      child: SizedBox.expand(
        child: Image(
          image: AssetImage('assets/splash/pick_rider_splash.png'),
          fit: BoxFit.contain,
          gaplessPlayback: true,
          excludeFromSemantics: true,
        ),
      ),
    ),
  );
}

/// 시작 화면이 번쩍 지나가지 않게 최소로 보이는 시간.
const pickRiderSplashMinimum = Duration(milliseconds: 1000);
