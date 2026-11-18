import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../domain/offer_list.dart';
import 'offer_repository.dart';

/// 목 구현. 계약(`delivery-dispatch-service.yaml` listMyOffers) 모양 JSON 을 생성 모델로 읽는다.
///
/// 운행 중·신규배차 허용일 때만 제안을 주고 `pollAfterSec` 5 를 준다. 아니면 빈 목록 + null(폴링 중지).
base class MockOfferRepository implements OfferRepository, DutyRepository {
  /// [startOnDuty] 가 false 면 운행 종료에서 시작한다(앱을 켰을 때 "운행시작" 화면).
  MockOfferRepository({
    this.latency = const Duration(milliseconds: 300),
    bool startOnDuty = true,
    // 첫 가입 기본값(원문 §2.2).
    DispatchMode mode = DispatchMode.aiRecommended,
    bool demoBundle = false,
    bool demoManyBundles = false,
  }) {
    if (demoBundle) {
      // 시연: 첫 제안 다음에 알뜰배달 묶음(2건)이 온다.
      for (final (i, area) in [(1, '부산진구 부전동'), (2, '부산진구 범천동')]) {
        _offers.add({
          ...(fixture['items']! as List).first as Map<String, Object?>,
          'offerId': 'offer-bundle-$i',
          'deliveryId': 'dlv-b$i',
          'remainingSec': 60,
          'bundleId': 'bundle-1',
          'bundleSize': 2,
          'stopSequence': i,
          'summary': <String, Object?>{
            ...((fixture['items']! as List).first as Map)['summary']
                as Map<String, Object?>,
            'dropAreaLabel': area,
            'estimatedFee': 3000,
            'deliveryMode': 'BUNDLED',
          },
        });
      }
      // 반품 회수 제안 1건(dlv-r1): 거리 = 회수지 → MFC, 주소는 수락 뒤.
      _offers.add({
        ...(fixture['items']! as List).first as Map<String, Object?>,
        'offerId': 'offer-return-1',
        'deliveryId': 'dlv-r1',
        'remainingSec': 60,
        'deliveryType': 'RETURN',
        'purpose': 'CLAIM_RETURN',
        'summary': <String, Object?>{
          ...((fixture['items']! as List).first as Map)['summary']
              as Map<String, Object?>,
          'dropAreaLabel': '부산진구 가야동',
          'distanceKm': 2.4,
          'estimatedFee': 3500,
          'bagCount': null,
          'deliveryMode': 'SINGLE',
        },
      });
    }
    if (demoManyBundles) {
      // 시연(사용자 2026-11-18 "알뜰배달로 주문 여러개"): 알뜰 묶음 두 개 더 — 3건 묶음(dlv-b3~b5)·2건 묶음(dlv-b6·b7).
      for (final (bundle, ids, areas) in [
        ('bundle-2', [3, 4, 5], ['부산진구 전포동', '부산진구 부암동', '부산진구 당감동']),
        ('bundle-3', [6, 7], ['부산진구 개금동', '부산진구 가야동']),
      ]) {
        for (final (i, id) in ids.indexed) {
          _offers.add({
            ...(fixture['items']! as List).first as Map<String, Object?>,
            'offerId': 'offer-bundle-$id',
            'deliveryId': 'dlv-b$id',
            'remainingSec': 60,
            'bundleId': bundle,
            'bundleSize': ids.length,
            'stopSequence': i + 1,
            'summary': <String, Object?>{
              ...((fixture['items']! as List).first as Map)['summary']
                  as Map<String, Object?>,
              'dropAreaLabel': areas[i],
              'distanceKm': 1.1 + i * 0.7,
              'estimatedFee': 3000,
              'bagCount': 1,
              'deliveryMode': 'BUNDLED',
            },
          });
        }
      }
    }
    if (!startOnDuty) {
      _duty = {..._duty, 'status': 'OFF_DUTY', 'newDispatchEnabled': false};
    }
    _settings = {
      ..._settings,
      'dispatchMode': mode == DispatchMode.aiRecommended
          ? 'AI_RECOMMENDED'
          : 'NORMAL',
    };
  }

  final Duration latency;

  static const fixture = <String, Object?>{
    'items': [
      {
        'offerId': 'offer-mock-1',
        'attemptId': 'att-1',
        'deliveryId': 'dlv-1',
        'riderId': 'rider-mock-1',
        'sentAt': '2026-10-24T06:00:00Z',
        'expiresAt': '2026-10-24T06:01:00Z',
        'remainingSec': 42,
        'state': 'SENT',
        'summary': {
          'mfcId': 'MFC-BSJ-01',
          'dropAreaLabel': '부산진구 전포동',
          'distanceKm': 1.8,
          'weightG': 3200,
          'containsAlcohol': false,
          'estimatedFee': 3500,
          'pickupDistanceKm': 0.6,
          'pickupEtaSeconds': 180,
          'bagCount': 2,
          // 고객앱 목의 진행 중 주문(예약배송 18~19시)과 같은 배송.
          'deliveryMode': 'SCHEDULED',
        },
      },
    ],
    'page': {'nextCursor': null, 'size': 50},
    'serverTime': '2026-10-24T06:00:18Z',
    // 서버 잠정 기본값 5초. 클라이언트는 이 값을 하드코딩하지 않는다.
    'pollAfterSec': 5,
  };

  var _duty = <String, Object?>{
    'status': 'ON_DUTY',
    'newDispatchEnabled': true,
    'mfcId': 'MFC-BSJ-01',
    'activeDeliveryCount': 0,
    'version': 1,
  };
  final _offers = <Map<String, Object?>>[
    for (final o in fixture['items']! as List)
      Map<String, Object?>.from(o as Map),
  ];
  final _responses = <String, Map<String, Object?>>{};
  var _settings = <String, Object?>{
    'oneAtATime': false,
    'dispatchMode': 'AI_RECOMMENDED',
    'version': 1,
  };

  /// 서버 규칙(계약 delivery-dispatch acceptances·DispatchProperties.maxActiveDeliveries): 동시에 맡는 배송은 최대 3건,
  /// 하나씩 배달하기면 1건. 넘는 제안은 보내지 않고, 넘게 수락하면 늦은 수락(INELIGIBLE).
  /// 목은 끝난 배송을 모르므로 앱이 [finished] 를 연결한다(없으면 수락한 것 전부를 진행 중으로 본다).
  static const maxActiveDeliveries = 3;

  bool Function(String deliveryId)? finished;

  int get activeCount =>
      assignedDeliveries.where((id) => !(finished?.call(id) ?? false)).length;

  int get _capacity =>
      (_settings['oneAtATime'] == true ? 1 : maxActiveDeliveries) - activeCount;

  int _sizeOf(Map<String, Object?> offer) => (offer['bundleSize'] as int?) ?? 1;

  /// 조회 횟수(폴링 간격 확인용).
  int fetches = 0;

  /// 다음 조회 n번을 연결 실패로 만든다.
  int failNextFetches = 0;

  /// 다음 응답을 "판정은 됐지만 응답 잃음"으로 만든다.
  bool loseNextResponse = false;

  /// 다음 수락을 늦은 수락으로 판정한다.
  LateReason? lateNext;

  /// 수락된 배송(배송 수행 단계가 읽는다).
  final assignedDeliveries = <String>[];
  final respondKeys = <String>[];

  /// 상세를 연 제안(서버가 처음 연 시각을 기록한다).
  final openedOffers = <String>[];

  Future<void> _wait() => Future<void>.delayed(latency);

  /// 새 제안이 도착한 것처럼 만든다.
  void pushOffer(
    String offerId, {
    String deliveryId = 'dlv-9',
    int remainingSec = 60,
  }) => _offers.add({
    ...(fixture['items']! as List).first as Map<String, Object?>,
    'offerId': offerId,
    'deliveryId': deliveryId,
    'remainingSec': remainingSec,
  });

  @override
  Future<OfferList> activeOffers() async {
    await _wait();
    fetches++;
    if (failNextFetches > 0) {
      failNextFetches--;
      throw const NetworkFailure(DioExceptionType.connectionError);
    }
    final receiving =
        _duty['status'] == 'ON_DUTY' && _duty['newDispatchEnabled'] == true;
    // 일반 배차모드는 제안을 보내지 않는다 — 배달리스트에서 골라 수락(원문 §2.2·2.4).
    final aiMode = _settings['dispatchMode'] == 'AI_RECOMMENDED';
    return offerListFromContract(
      ListMyOffers200Response.fromJson({
        ...fixture,
        'items': receiving && aiMode
            ? [
                for (final o in _offers)
                  if (_sizeOf(o) <= _capacity) o,
              ]
            : const <Object?>[],
        'pollAfterSec': receiving ? 5 : null,
      }),
    );
  }

  @override
  Future<OfferOutcome> respond(
    String offerId, {
    required bool accept,
    RejectReason? reason,
    required IdempotencyKey key,
  }) async {
    await _wait();
    respondKeys.add(key.value);
    final previous = _responses[key.value];
    if (previous != null) {
      return offerOutcomeFromContract(OfferResponseResult.fromJson(previous));
    }
    final offer = _offers.where((o) => o['offerId'] == offerId).firstOrNull;
    final Map<String, Object?> result;
    if (lateNext != null || offer == null) {
      result = {
        'offerId': offerId,
        'outcome': 'LATE',
        'lateReason': switch (lateNext ?? LateReason.expired) {
          LateReason.alreadyAssigned => 'ALREADY_ASSIGNED',
          LateReason.orderCancelled => 'ORDER_CANCELLED',
          LateReason.ineligible => 'INELIGIBLE',
          _ => 'EXPIRED',
        },
      };
      lateNext = null;
    } else if (accept && _sizeOf(offer) > _capacity) {
      result = {
        'offerId': offerId,
        'outcome': 'LATE',
        'lateReason': 'INELIGIBLE',
      };
    } else if (accept) {
      result = {
        'offerId': offerId,
        'outcome': 'ASSIGNED',
        'deliveryId': offer['deliveryId'],
        'assignmentId': 'asg-$offerId',
      };
      // 묶음은 하나에만 응답해도 묶음 전체에 적용된다.
      final bundle = offer['bundleId'];
      for (final o in _offers.where(
        (o) =>
            o['offerId'] == offerId ||
            (bundle != null && o['bundleId'] == bundle),
      )) {
        assignedDeliveries.add(o['deliveryId']! as String);
      }
      _duty = {..._duty, 'activeDeliveryCount': activeCount};
    } else {
      result = {
        'offerId': offerId,
        'outcome': 'REJECTED',
        'consecutiveRejections': 1,
      };
    }
    final bundleOf = offer?['bundleId'];
    _offers.removeWhere(
      (o) =>
          o['offerId'] == offerId ||
          (bundleOf != null && o['bundleId'] == bundleOf),
    );
    _responses[key.value] = result;
    if (loseNextResponse) {
      loseNextResponse = false;
      return const OfferUnknown();
    }
    return offerOutcomeFromContract(OfferResponseResult.fromJson(result));
  }

  @override
  Future<void> openDetail(String offerId) async {
    await _wait();
    openedOffers.add(offerId);
  }

  @override
  Future<OperatingState> state() async {
    await _wait();
    return operatingStateFromContract(rd.OperatingState.fromJson(_duty));
  }

  @override
  Future<OperatingState> setState({
    required bool onDuty,
    required bool newDispatch,
    required int expectedVersion,
    String? mfcId,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (expectedVersion != _duty['version']) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.versionConflict),
      );
    }
    if (!onDuty && (_duty['activeDeliveryCount']! as int) > 0) {
      // 진행 중 배송이 있으면 운행 종료로 바꿀 수 없다.
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
    }
    _duty = {
      ..._duty,
      'status': onDuty ? 'ON_DUTY' : 'OFF_DUTY',
      'newDispatchEnabled': onDuty && newDispatch,
      'version': (_duty['version']! as int) + 1,
    };
    return operatingStateFromContract(rd.OperatingState.fromJson(_duty));
  }

  @override
  Future<DispatchMode> dispatchMode() async => (await settings()).mode;

  @override
  Future<DispatchSettingsView> settings() async {
    await _wait();
    return dispatchSettingsFromContract(
      rd.DispatchSettings.fromJson(_settings),
    );
  }

  @override
  Future<DispatchSettingsView> setSettings({
    required DispatchMode mode,
    required bool oneAtATime,
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (expectedVersion != _settings['version']) {
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.versionConflict),
      );
    }
    _settings = {
      'oneAtATime': oneAtATime,
      'dispatchMode': mode == DispatchMode.aiRecommended
          ? 'AI_RECOMMENDED'
          : 'NORMAL',
      'version': (_settings['version']! as int) + 1,
    };
    return dispatchSettingsFromContract(
      rd.DispatchSettings.fromJson(_settings),
    );
  }
}
