import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 소명·이의 신청(rider 0.15.0, 사용자 2026-11-18 "앱에서 신청 → 백오피스 결정").
/// - 계정 제한 소명(RESTRICTION): 지금 걸린 제한 — 대상은 서버가 잡는다(targetRef 없음). 제한이 없으면 409.
/// - 수행료 이의(EARNING): 배송 수행료 — targetRef = deliveryId.
/// 같은 대상에는 한 번(409 APPEAL_EXISTS). 결정(유지·인정)과 결과 설명은 라이더 운영이 백오피스에서 — 알림함 RIDER_APPEAL_DECIDED.
enum AppealTarget { restriction, earning }

enum AppealState {
  open,
  upheld,
  accepted;

  static AppealState fromWire(String? w) => switch (w) {
    'UPHELD' => upheld,
    'ACCEPTED' => accepted,
    _ => open,
  };
}

@immutable
class Appeal {
  const Appeal({
    required this.appealId,
    required this.target,
    required this.targetRef,
    required this.body,
    required this.state,
    required this.submittedAt,
    this.decidedAt,
    this.decisionNote,
  });

  final String appealId;
  final AppealTarget target;

  /// 수행료 이의면 배송 ID.
  final String targetRef;
  final String body;
  final AppealState state;
  final DateTime submittedAt;
  final DateTime? decidedAt;

  /// 결정 이유(라이더 운영이 쓴 글 그대로).
  final String? decisionNote;
}

/// 같은 대상에 이미 신청이 있다(409 APPEAL_EXISTS).
final class AppealExistsFailure implements Exception {
  const AppealExistsFailure();
}

/// 소명할 계정 제한이 없다(제한이 이미 풀렸다 — 409).
final class NothingToAppealFailure implements Exception {
  const NothingToAppealFailure();
}

abstract interface class AppealRepository {
  Future<Appeal> submit({
    required AppealTarget target,
    String? deliveryId,
    required String body,
    required IdempotencyKey key,
  });

  Future<List<Appeal>> mine();
}

const appealBodyMax = 1000;
const appealExistsCode = 'APPEAL_EXISTS';

Appeal appealFromContract(rd.RiderAppeal a) => Appeal(
  appealId: a.appealId,
  target: a.targetType == rd.RiderAppealTargetTypeEnum.RESTRICTION
      ? AppealTarget.restriction
      : AppealTarget.earning,
  targetRef: a.targetRef,
  body: a.body,
  state: AppealState.fromWire(a.state.value),
  submittedAt: a.submittedAt,
  decidedAt: a.decidedAt,
  decisionNote: a.decisionNote,
);

final class ApiAppealRepository implements AppealRepository {
  ApiAppealRepository(Dio dio)
    : _api = rd.PmartApiRider(dio: dio).getAppealsApi();

  final rd.AppealsApi _api;

  @override
  Future<Appeal> submit({
    required AppealTarget target,
    String? deliveryId,
    required String body,
    required IdempotencyKey key,
  }) async {
    final Response<rd.RiderAppeal> res;
    try {
      res = await pmartGuard(
        () => _api.submitRiderAppeal(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          submitRiderAppealRequest: rd.SubmitRiderAppealRequest(
            targetType: target == AppealTarget.restriction
                ? rd.SubmitRiderAppealRequestTargetTypeEnum.RESTRICTION
                : rd.SubmitRiderAppealRequestTargetTypeEnum.EARNING,
            targetRef: target == AppealTarget.earning ? deliveryId : null,
            body: body,
          ),
          extra: commandOptions(key).extra,
        ),
      );
    } on ProblemFailure catch (f) {
      if (f.problem.code == appealExistsCode) throw const AppealExistsFailure();
      if (f.problem.status == 409 && target == AppealTarget.restriction) {
        throw const NothingToAppealFailure();
      }
      rethrow;
    }
    return appealFromContract(
      res.data ?? (throw const ContractViolationFailure('신청 응답 본문 없음')),
    );
  }

  @override
  Future<List<Appeal>> mine() async {
    final res = await pmartGuard(() => _api.listMyRiderAppeals());
    return [
      for (final a in res.data?.items ?? const <rd.RiderAppeal>[])
        appealFromContract(a),
    ];
  }
}

/// 목: 신청을 메모리에 둔다. 같은 키는 같은 신청, 같은 대상 두 번이면 APPEAL_EXISTS.
final class MockAppealRepository implements AppealRepository {
  MockAppealRepository({this.latency = const Duration(milliseconds: 300)});

  final Duration latency;
  final _items = <Appeal>[
    Appeal(
      appealId: 'AP-mock-0',
      target: AppealTarget.earning,
      targetRef: 'dlv-old-1',
      body: '거리 계산이 틀린 것 같아요.',
      state: AppealState.upheld,
      submittedAt: DateTime.utc(2026, 11, 16, 5),
      decidedAt: DateTime.utc(2026, 11, 16, 7),
      decisionNote: '경로 확인 결과 정상 산정이에요.',
    ),
  ];
  final _byKey = <String, Appeal>{};
  var _seq = 0;

  @override
  Future<Appeal> submit({
    required AppealTarget target,
    String? deliveryId,
    required String body,
    required IdempotencyKey key,
  }) async {
    await Future<void>.delayed(latency);
    final again = _byKey[key.value];
    if (again != null) return again;
    final ref = target == AppealTarget.earning
        ? (deliveryId ?? '')
        : 'restriction';
    if (_items.any((a) => a.target == target && a.targetRef == ref)) {
      throw const AppealExistsFailure();
    }
    final a = Appeal(
      appealId: 'AP-mock-${++_seq}',
      target: target,
      targetRef: ref,
      body: body,
      state: AppealState.open,
      submittedAt: DateTime.now().toUtc(),
    );
    _items.add(a);
    _byKey[key.value] = a;
    return a;
  }

  @override
  Future<List<Appeal>> mine() async {
    await Future<void>.delayed(latency);
    return _items.reversed.toList();
  }
}

final appealRepositoryProvider = Provider<AppealRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockAppealRepository(),
    PmartEnv.local => ApiAppealRepository(ref.watch(dioProvider)),
  },
);

/// 내 신청(최근 것 먼저 — 목은 뒤집어 둔다, 서버 순서는 그대로).
final myAppealsProvider = FutureProvider<List<Appeal>>(
  (ref) => ref.watch(appealRepositoryProvider).mine(),
);
