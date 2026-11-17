import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 오늘 실적. [earnings] 가 null 이면 요율 미등록이라 "산정 불가"다(0원이 아니다).
@immutable
class TodaySummary {
  const TodaySummary({required this.completedCount, required this.earnings});

  final int completedCount;
  final int? earnings;
}

@immutable
class OperatingTime {
  const OperatingTime({
    required this.today,
    required this.todayTotal,
    required this.weekStart,
    required this.weekEnd,
    required this.weekTotal,
    required this.days,
  });

  final DateTime today;
  final Duration todayTotal;
  final DateTime weekStart;
  final DateTime weekEnd;
  final Duration weekTotal;
  final List<({DateTime day, Duration total})> days;
}

/// 정산 상태(라이더 앱 문서 "정산").
enum SettlementStatus {
  estimated,
  awaitingConfirm,
  confirmed,
  paying,
  paid,
  payFailed,
  adjusted,
}

@immutable
class Settlement {
  const Settlement({
    required this.from,
    required this.to,
    required this.amount,
    required this.status,
  });

  final DateTime from;
  final DateTime to;

  /// null 이면 산정 불가.
  final int? amount;
  final SettlementStatus status;
}

@immutable
class DeliveryRecord {
  const DeliveryRecord({
    required this.code,
    required this.store,
    required this.completedAt,
    required this.fee,
    this.distanceKm,
    this.minutes,
  });

  final String code;
  final String store;
  final DateTime completedAt;
  final int? fee;
  final double? distanceKm;
  final int? minutes;
}

/// 내역·수행료·운행시간.
///
/// 실서버: 내 배송 `GET /riders/me/deliveries`, 수행료 `GET /riders/me/earnings`(delivery-execution 0.3+).
/// 운행시간은 계약 경로가 없어 실서버에서는 "확인 불가"로 보인다.
abstract interface class RecordsRepository {
  Future<TodaySummary> today();
  Future<OperatingTime> operatingTime();
  Future<List<Settlement>> settlements();
  Future<List<DeliveryRecord>> history();
}

final class MockRecordsRepository implements RecordsRepository {
  MockRecordsRepository({this.latency = const Duration(milliseconds: 250)});

  final Duration latency;

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<TodaySummary> today() async {
    await _wait();
    return const TodaySummary(completedCount: 3, earnings: 11300);
  }

  @override
  Future<OperatingTime> operatingTime() async {
    await _wait();
    return OperatingTime(
      today: DateTime(2026, 11, 13),
      todayTotal: const Duration(hours: 1, minutes: 48),
      weekStart: DateTime(2026, 11, 9),
      weekEnd: DateTime(2026, 11, 15),
      weekTotal: const Duration(hours: 19, minutes: 59),
      days: [
        (
          day: DateTime(2026, 11, 10),
          total: const Duration(hours: 4, minutes: 47),
        ),
        (
          day: DateTime(2026, 11, 11),
          total: const Duration(hours: 7, minutes: 6),
        ),
        (
          day: DateTime(2026, 11, 12),
          total: const Duration(hours: 6, minutes: 18),
        ),
        (
          day: DateTime(2026, 11, 13),
          total: const Duration(hours: 1, minutes: 48),
        ),
      ],
    );
  }

  @override
  Future<List<Settlement>> settlements() async {
    await _wait();
    return [
      Settlement(
        from: DateTime(2026, 11, 2),
        to: DateTime(2026, 11, 8),
        amount: 187120,
        status: SettlementStatus.estimated,
      ),
      Settlement(
        from: DateTime(2026, 10, 26),
        to: DateTime(2026, 11, 1),
        amount: 92247,
        status: SettlementStatus.paid,
      ),
      Settlement(
        from: DateTime(2026, 10, 19),
        to: DateTime(2026, 10, 25),
        amount: 187790,
        status: SettlementStatus.paid,
      ),
      Settlement(
        from: DateTime(2026, 10, 12),
        to: DateTime(2026, 10, 18),
        amount: null,
        status: SettlementStatus.awaitingConfirm,
      ),
    ];
  }

  @override
  Future<List<DeliveryRecord>> history() async {
    await _wait();
    return [
      DeliveryRecord(
        code: 'ORD-5111EHNE',
        store: 'PMart 부산진구지점',
        completedAt: DateTime(2026, 11, 13, 21, 56),
        fee: 4200,
        distanceKm: 0.7,
        minutes: 24,
      ),
      DeliveryRecord(
        code: 'ORD-0247VZZU',
        store: 'PMart 부산진구지점',
        completedAt: DateTime(2026, 11, 13, 21, 49),
        fee: 3900,
        distanceKm: 0.4,
        minutes: 20,
      ),
      DeliveryRecord(
        code: 'ORD-0318WYDM',
        store: 'PMart 부산진구지점',
        completedAt: DateTime(2026, 11, 13, 21, 25),
        fee: null,
        distanceKm: 0.4,
        minutes: 23,
      ),
    ];
  }
}

/// 실서버. 수행료는 배송마다 한 줄(완료 직후 확정 대기 → 5시간 뒤 확정). 산정 불가(`calculable: false`)는 금액 대신 "산정 불가".
final class ApiRecordsRepository implements RecordsRepository {
  ApiRecordsRepository(Dio dio)
    : _me = ex.PmartApiDeliveryExecution(dio: dio).getMeApi();

  final ex.MeApi _me;

  /// 서울 날짜(YYYY-MM-DD).
  static String _seoulDate(DateTime now) {
    final s = now.toUtc().add(const Duration(hours: 9));
    return '${s.year.toString().padLeft(4, '0')}-'
        '${s.month.toString().padLeft(2, '0')}-${s.day.toString().padLeft(2, '0')}';
  }

  @override
  Future<TodaySummary> today() async {
    final date = _seoulDate(DateTime.now());
    final deliveries = await pmartGuard(() => _me.listMyDeliveries(date: date));
    final earnings = await pmartGuard(
      () => _me.listMyEarnings(from: date, to: date),
    );
    final done = (deliveries.data?.items ?? const <ex.DeliveryExecution>[])
        .where((d) => d.state == ex.ExecutionState.COMPLETED)
        .length;
    final totals = earnings.data?.totals;
    return TodaySummary(
      completedCount: done,
      // 서버 합계가 없으면 0원이 아니라 산정 불가.
      earnings: totals == null
          ? null
          : (totals.estimated ?? 0) +
                (totals.confirmed ?? 0) +
                (totals.paid ?? 0),
    );
  }

  @override
  Future<OperatingTime> operatingTime() async => throw const ProblemFailure(
    Problem(status: 501, code: ProblemCode.unsupportedAction),
  );

  @override
  Future<List<Settlement>> settlements() async {
    final res = await pmartGuard(() => _me.listMyEarnings());
    return [
      for (final e in res.data?.items ?? const <ex.Earning>[])
        Settlement(
          from: (e.recordedAt ?? DateTime.now()).toLocal(),
          to: (e.recordedAt ?? DateTime.now()).toLocal(),
          amount: (e.calculable ?? false) ? e.total : null,
          status: switch (e.settlementState?.value) {
            'PENDING_CONFIRMATION' => SettlementStatus.awaitingConfirm,
            'CONFIRMED' => SettlementStatus.confirmed,
            'PAYING' => SettlementStatus.paying,
            'PAID' => SettlementStatus.paid,
            'PAYMENT_FAILED' => SettlementStatus.payFailed,
            'ADJUSTED' => SettlementStatus.adjusted,
            _ => SettlementStatus.estimated,
          },
        ),
    ];
  }

  @override
  Future<List<DeliveryRecord>> history() async {
    final res = await pmartGuard(() => _me.listMyDeliveries());
    return [
      for (final d in res.data?.items ?? const <ex.DeliveryExecution>[])
        if (d.state == ex.ExecutionState.COMPLETED)
          DeliveryRecord(
            code: d.orderId ?? d.deliveryId ?? '-',
            store: d.mfcId ?? '-',
            completedAt: d.completedAt ?? d.assignedAt ?? DateTime.now(),
            fee: (d.earning?.calculable ?? false) ? d.earning?.total : null,
          ),
    ];
  }
}

final recordsRepositoryProvider = Provider<RecordsRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockRecordsRepository(),
    PmartEnv.local => ApiRecordsRepository(ref.watch(dioProvider)),
  },
);

final todaySummaryProvider = FutureProvider.autoDispose<TodaySummary>(
  (ref) => ref.watch(recordsRepositoryProvider).today(),
);

final operatingTimeProvider = FutureProvider.autoDispose<OperatingTime>(
  (ref) => ref.watch(recordsRepositoryProvider).operatingTime(),
);

final settlementsProvider = FutureProvider.autoDispose<List<Settlement>>(
  (ref) => ref.watch(recordsRepositoryProvider).settlements(),
);

final historyProvider = FutureProvider.autoDispose<List<DeliveryRecord>>(
  (ref) => ref.watch(recordsRepositoryProvider).history(),
);
