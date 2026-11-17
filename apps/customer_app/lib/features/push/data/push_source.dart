import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// 단말 푸시(FCM)의 단말 쪽 — 초기화·알림 권한·토큰·받은 푸시. 화면·컨트롤러는 이 인터페이스에만 기댄다.
///
/// 토큰 값은 서버 등록에만 쓴다. 로그·오류 문구·분석 이벤트에 남기지 않는다.
abstract interface class PushSource {
  /// 푸시를 쓸 수 있게 준비한다. 쓸 수 없으면 false(목 모드, `google-services.json` 없는 빌드 등) —
  /// false 면 나머지를 부르지 않는다.
  Future<bool> ready();

  /// 알림 권한(Android 13+ 는 물어본다). 허용이면 true.
  Future<bool> requestPermission();

  /// 지금 단말의 FCM 등록 토큰. 받지 못하면 null.
  Future<String?> token();

  /// 토큰이 바뀔 때마다 새 토큰.
  Stream<String> get tokenRefreshes;

  /// 이 단말의 토큰을 버린다(로그아웃·세션 종료) — 서버에 남은 옛 토큰으로는 더 오지 않게.
  Future<void> deleteToken();

  /// 푸시를 눌러 앱이 열렸다(꺼져 있다가 열린 경우 포함).
  Stream<void> get opened;

  /// 앱을 보고 있는 동안 푸시를 받았다(Android 는 이때 알림을 띄우지 않는다).
  Stream<void> get received;
}

/// 푸시 없음(목 모드·시험).
final class NoPushSource implements PushSource {
  const NoPushSource();

  @override
  Future<bool> ready() async => false;

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get tokenRefreshes => const Stream.empty();

  @override
  Future<void> deleteToken() async {}

  @override
  Stream<void> get opened => const Stream.empty();

  @override
  Stream<void> get received => const Stream.empty();
}

/// Firebase Cloud Messaging(Android). 설정은 `android/app/google-services.json`(git 제외)에서 읽는다 —
/// FlutterFire CLI·`firebase_options.dart` 를 쓰지 않아 Firebase 프로젝트를 바꿀 때 그 파일만 바꾸면 된다.
/// 파일 없이 빌드한 앱은 초기화가 실패하고 푸시 없이 돈다.
final class FirebasePushSource implements PushSource {
  Future<bool>? _ready;

  @override
  Future<bool> ready() => _ready ??= _init();

  Future<bool> _init() async {
    try {
      await Firebase.initializeApp();
      return true;
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> requestPermission() async {
    final settings = await FirebaseMessaging.instance.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  // firebase_messaging 17 은 getToken·onTokenRefresh·deleteToken 을 "쓰지 말 것"으로 표시하고
  // register()·onRegistered(값이 FCM 토큰이 아니라 Firebase 설치 ID)를 권한다. 서버 계약
  // (`PushTokenRegistration.token` = FCM 등록 토큰, FCM HTTP v1 로 발송)은 토큰을 받으므로 토큰 API 를 그대로 쓴다.
  // 설치 ID 로 바꿀지는 백엔드 답을 받은 뒤(질문 2026-11-17 customer-push-fcm Q8).
  @override
  // ignore: deprecated_member_use
  Future<String?> token() => FirebaseMessaging.instance.getToken();

  @override
  // ignore: deprecated_member_use
  Stream<String> get tokenRefreshes => FirebaseMessaging.instance.onTokenRefresh;

  @override
  // ignore: deprecated_member_use
  Future<void> deleteToken() => FirebaseMessaging.instance.deleteToken();

  @override
  Stream<void> get opened async* {
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) yield null;
    yield* FirebaseMessaging.onMessageOpenedApp.map<void>((_) {});
  }

  @override
  Stream<void> get received => FirebaseMessaging.onMessage.map<void>((_) {});
}
