import 'package:dio/dio.dart';
import 'package:pmart_api_notification/pmart_api_notification.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;

/// 본인 단말 푸시 토큰 등록·해제(notification-service push-tokens 태그, 0.3.0 — BR-09). 회원 토큰이 필요하다.
///
/// 단말은 앱이 이미 쓰는 기기 ID(`X-Device-Id` 와 같은 값)로 가리킨다. 토큰 값은 응답에 다시 오지 않는다.
abstract interface class PushTokensRepository {
  /// `PUT /me/push-tokens/{deviceId}` — 같은 단말이면 토큰을 바꾼다(멱등). 실패는 [PmartFailure] 로 던진다.
  Future<void> register(String token, {required IdempotencyKey key});

  /// `DELETE /me/push-tokens/{deviceId}` — 없어도 204(멱등).
  Future<void> unregister({required IdempotencyKey key});
}

final class ApiPushTokensRepository implements PushTokensRepository {
  ApiPushTokensRepository(Dio dio, this._deviceId)
    : _api = api.PmartApiNotification(dio: dio).getPushTokensApi();

  final api.PushTokensApi _api;
  final DeviceIdProvider _deviceId;

  @override
  Future<void> register(String token, {required IdempotencyKey key}) async {
    final deviceId = await _deviceId.get();
    await pmartGuard(
      () => _api.registerMyPushToken(
        deviceId: deviceId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        pushTokenRegistration: api.PushTokenRegistration(
          token: token,
          platform: api.PushPlatform.ANDROID,
        ),
        extra: commandOptions(key).extra,
      ),
    );
  }

  @override
  Future<void> unregister({required IdempotencyKey key}) async {
    final deviceId = await _deviceId.get();
    await pmartGuard(
      () => _api.unregisterMyPushToken(
        deviceId: deviceId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
  }
}

/// 목 — 서버 없이 등록·해제를 기억만 한다(토큰 값은 시험 확인용으로만 든다).
final class MockPushTokensRepository implements PushTokensRepository {
  /// 지금 등록된 토큰(없으면 null).
  String? registered;

  /// 부른 순서: `register`·`unregister`.
  final calls = <String>[];

  /// 다음 등록을 이 실패로 끝낸다(한 번).
  PmartFailure? failNextRegister;

  @override
  Future<void> register(String token, {required IdempotencyKey key}) async {
    calls.add('register');
    final failure = failNextRegister;
    if (failure != null) {
      failNextRegister = null;
      throw failure;
    }
    registered = token;
  }

  @override
  Future<void> unregister({required IdempotencyKey key}) async {
    calls.add('unregister');
    registered = null;
  }
}
