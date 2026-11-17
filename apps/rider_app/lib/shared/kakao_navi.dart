import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_flutter_sdk_navi/kakao_flutter_sdk_navi.dart';
import 'package:url_launcher/url_launcher.dart';

import 'location.dart';
import 'rider_map.dart' show kakaoNativeAppKey;

/// 길찾기 결과.
enum NaviResult {
  /// 앱 안 음성 길안내(카카오내비 SDK with UI)를 했다(끝나고 돌아옴).
  inApp,

  /// 카카오내비 앱으로 넘겼다.
  started,

  /// 카카오내비가 없어 설치 페이지를 열었다.
  installPageOpened,
  unavailable,
}

/// 길찾기 결과 + 앱 안 길안내를 못 쓴 이유(KNError 코드, 예: C103 인증 실패).
typedef NaviOutcome = ({NaviResult result, String? inAppError});

/// 길안내. 먼저 앱 안 음성 길안내(KNSDK)를, 안 되면 카카오내비 앱을 연다.
/// [name] 은 내비 화면에 보일 이름 — 고객 이름·주소를 넣지 않는다(SDK 로그에 남는다).
typedef NaviLauncher = Future<NaviOutcome> Function({
  required String name,
  required GeoPoint to,
});

/// 카카오 SDK 초기화(앱 시작 때 한 번). 키가 없으면 길찾기를 쓸 수 없다.
void initKakaoNavi() {
  if (kakaoNativeAppKey.isEmpty) return;
  KakaoSdk.init(nativeAppKey: kakaoNativeAppKey);
}

/// 앱 안 길안내 채널(`MainActivity` → `KnNaviActivity`). 결과 null = 성공, 문자열 = 오류 코드.
const _inApp = MethodChannel('pmart.rider/knnavi');

/// 카카오내비 SDK 사용 권한 확인(화면 없이 인증만). null 이면 쓸 수 있다.
Future<String?> probeInAppNavi() async {
  if (kakaoNativeAppKey.isEmpty) return 'NO_APP_KEY';
  try {
    return await _inApp.invokeMethod<String>('probe', {
      'appKey': kakaoNativeAppKey,
    });
  } on PlatformException catch (e) {
    return e.code;
  } on MissingPluginException {
    return 'NO_PLUGIN';
  }
}

final naviLauncherProvider = Provider<NaviLauncher>(
  (ref) => ({required String name, required GeoPoint to}) async {
    if (Platform.environment.containsKey('FLUTTER_TEST') ||
        kakaoNativeAppKey.isEmpty) {
      return (result: NaviResult.unavailable, inAppError: null);
    }
    // 1) 앱 안 음성 길안내: 출발지 = 지금 위치(못 잡으면 앱으로 넘긴다).
    String? inAppError;
    final here = await ref.read(locationSourceProvider)?.current();
    if (here == null) {
      inAppError = 'NO_LOCATION';
    } else {
      try {
        final error = await _inApp.invokeMethod<String>('start', {
          'appKey': kakaoNativeAppKey,
          'goalName': name,
          'goalLat': to.lat,
          'goalLng': to.lng,
          'startLat': here.lat,
          'startLng': here.lng,
        });
        // CANCELLED: 경로를 받기 전에 라이더가 닫았다 — 그래도 앱 안 길안내를 쓴 것이다.
        if (error == null || error == 'CANCELLED') {
          return (result: NaviResult.inApp, inAppError: null);
        }
        inAppError = error;
      } on PlatformException catch (e) {
        inAppError = e.code;
      } on MissingPluginException {
        inAppError = 'NO_PLUGIN';
      }
    }
    // 오류 코드만 남긴다(좌표·키는 남기지 않는다).
    if (kDebugMode) debugPrint('in-app navi unavailable: $inAppError');
    // 2) 카카오내비 앱으로.
    return (result: await _openKakaoNaviApp(name, to), inAppError: inAppError);
  },
);

Future<NaviResult> _openKakaoNaviApp(String name, GeoPoint to) async {
  try {
    if (await NaviApi.instance.isKakaoNaviInstalled()) {
      await NaviApi.instance.navigate(
        destination: Location(
          name: name,
          x: to.lng.toString(),
          y: to.lat.toString(),
        ),
        option: NaviOption(coordType: CoordType.wgs84),
      );
      return NaviResult.started;
    }
    final opened = await launchUrl(
      Uri.parse(NaviApi.webNaviInstall),
      mode: LaunchMode.externalApplication,
    );
    return opened ? NaviResult.installPageOpened : NaviResult.unavailable;
  } on Exception {
    return NaviResult.unavailable;
  }
}
