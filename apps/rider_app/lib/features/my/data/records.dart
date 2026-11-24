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
    this.deliveryId,
    this.note,
    this.compensation = false,
    this.appealId,
    this.payoutDate,
    this.rolledFrom,
  });

  final DateTime from;
  final DateTime to;

  /// null 이면 산정 불가.
  final int? amount;
  final SettlementStatus status;

  /// 배송마다 한 줄인 실서버 수행료의 배송 ID(목의 주 단위 묶음은 null) — 수행료 이의 신청 대상.
  final String? deliveryId;

  /// 조정·추가 배달료 결과 안내(서버 `note`).
  final String? note;

  /// 이의 인정 보상금 한 줄(execution 0.30.0 — 원래 수행료와 따로). [note] 는 보상 사유.
  final bool compensation;

  /// 보상금이면 그 이의.
  final String? appealId;

  /// 지급 예정일(서버, YYYY-MM-DD) — 보상금, 그리고 지급 실패로 넘어온 수행료.
  final String? payoutDate;

  /// 지급 실패로 넘어온 수행료면 원래(마지막으로 실패한) 지급일(execution 0.42.0 rolledFrom, YYYY-MM-DD).
  final String? rolledFrom;

  /// 이의 신청을 보일 줄(rider 0.15.0 — 산정 불가·조정·결과 안내가 있는 줄. 맞는지는 직원이 판단한다). 보상금 줄은 아니다.
  bool get appealable =>
      !compensation &&
      deliveryId != null &&
      (amount == null || status == SettlementStatus.adjusted || note != null);
}

SettlementStatus settlementStatusFromWire(String? w) => switch (w) {
  'PENDING_CONFIRMATION' => SettlementStatus.awaitingConfirm,
  'CONFIRMED' => SettlementStatus.confirmed,
  'PAYING' => SettlementStatus.paying,
  'PAID' => SettlementStatus.paid,
  'PAYMENT_FAILED' => SettlementStatus.payFailed,
  'ADJUSTED' => SettlementStatus.adjusted,
  _ => SettlementStatus.estimated,
};

@immutable
class DeliveryRecord {
  const DeliveryRecord({
    required this.code,
    required this.store,
    required this.completedAt,
    required this.fee,
    this.distanceKm,
    this.minutes,
    this.deliveryId,
  });

  /// 끝난 배송 보기(읽기 전용)로 가는 배송 ID — 없으면 줄을 누를 수 없다.
  final String? deliveryId;

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
/// 운행시간 `GET /riders/me/operating-time`(execution 0.11.0) — 배차 수락 ~ 전달 완료, 겹친 시간은 한 번.
/// 그 경로가 아직 없는 서버(404·405·501)면 "확인 불가"로 보인다.
abstract interface class RecordsRepository {
  Future<TodaySummary> today();
  Future<OperatingTime> operatingTime();
  Future<SettlementList> settlements();
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
  Future<SettlementList> settlements() async {
    await _wait();
    final all = [
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
        // 목: 산정 불가 한 줄은 이의 신청을 시험할 수 있게 배송 ID 를 둔다
        deliveryId: 'dlv-1',
      ),
      // 목: 이의 인정 보상금 한 줄(목 신청 AP-mock-A 와 짝)
      Settlement(
        from: DateTime(2026, 11, 17),
        to: DateTime(2026, 11, 17),
        amount: 1500,
        status: SettlementStatus.confirmed,
        deliveryId: 'dlv-old-2',
        note: '엘리베이터 고장 확인',
        compensation: true,
        appealId: 'AP-mock-A',
        payoutDate: '2026-11-20',
      ),
      // 목: 지급 실패로 넘어온 수행료(execution 0.42.0 — 11-21 실패 → 11-24 다시 지급)
      Settlement(
        from: DateTime(2026, 11, 17),
        to: DateTime(2026, 11, 17),
        amount: 4000,
        status: SettlementStatus.confirmed,
        deliveryId: 'dlv-rolled',
        payoutDate: '2026-11-24',
        rolledFrom: '2026-11-21',
      ),
    ];
    // 시험: 보상금만 못 읽은 경우(수행료는 보인다)
    if (failCompensations) {
      return SettlementList(
        items: [
          for (final s in all)
            if (!s.compensation) s,
        ],
        compensationsFailed: true,
      );
    }
    return SettlementList(items: all);
  }

  /// 시험용: 보상금 목록 읽기를 실패로.
  bool failCompensations = false;

  @override
  Future<List<DeliveryRecord>> history() async {
    await _wait();
    return [
      DeliveryRecord(
        deliveryId: 'dlv-1',
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
    : _me = ex.PmartApiDeliveryExecution(dio: dio).getMeApi(),
      _comp = ex.PmartApiDeliveryExecution(dio: dio).getCompensationsApi();

  final ex.MeApi _me;
  final ex.CompensationsApi _comp;

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

  static DateTime _parseDate(String s) => DateTime.parse(s);

  static Duration _secs(int s) => Duration(seconds: s);

  /// 오늘(서버 기본 = 한국 날짜 오늘)과 이번 주(월~일) 두 번 묻는다. 날짜는 한국 자정 기준.
  @override
  Future<OperatingTime> operatingTime() async {
    final today = await pmartGuard(() => _me.getMyOperatingTime());
    final t =
        today.data ??
        (throw const ContractViolationFailure('operating-time 본문 없음'));
    final day = _parseDate(t.from);
    final weekStart = day.subtract(Duration(days: day.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 6));
    final week = await pmartGuard(
      () => _me.getMyOperatingTime(from: _ymd(weekStart), to: _ymd(weekEnd)),
    );
    final w =
        week.data ??
        (throw const ContractViolationFailure('operating-time 본문 없음'));
    return OperatingTime(
      today: day,
      todayTotal: _secs(t.totalSeconds),
      weekStart: weekStart,
      weekEnd: weekEnd,
      weekTotal: _secs(w.totalSeconds),
      days: [
        for (final d in w.days)
          if (d.seconds > 0) (day: _parseDate(d.date), total: _secs(d.seconds)),
      ],
    );
  }

  static String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Future<SettlementList> settlements() async {
    // 수행료와 이의 인정 보상금(execution 0.30.0)을 함께. 보상금만 못 읽으면 수행료는 보이고 "일부만"으로 알린다
    // (백엔드 회신 2026-11-19 권고) — 빠진 채 정상처럼 보이지 않게 compensationsFailed 를 둔다. 수행료를 못 읽으면 실패.
    final compFuture = pmartGuard(() => _comp.listMyCompensations())
        .then<ex.ListRiderCompensations200Response?>((r) => r.data)
        .catchError((Object _) => null, test: (e) => e is PmartFailure);
    final res = await pmartGuard(() => _me.listMyEarnings());
    final compData = await compFuture;
    return SettlementList(
      compensationsFailed: compData == null,
      items: [
        for (final c in compData?.items ?? const <ex.RiderCompensation>[])
          Settlement(
            from: c.recordedAt.toLocal(),
            to: c.recordedAt.toLocal(),
            amount: c.amount,
            deliveryId: c.deliveryId,
            note: c.reason,
            compensation: true,
            appealId: c.appealId,
            payoutDate: c.payoutDate,
            status: settlementStatusFromWire(c.settlementState.value),
          ),
        for (final e in res.data?.items ?? const <ex.Earning>[])
          Settlement(
            from: (e.recordedAt ?? DateTime.now()).toLocal(),
            to: (e.recordedAt ?? DateTime.now()).toLocal(),
            amount: (e.calculable ?? false) ? e.total : null,
            deliveryId: e.deliveryId,
            note: e.note,
            payoutDate: e.payoutDate,
            rolledFrom: e.rolledFrom,
            status: settlementStatusFromWire(e.settlementState?.value),
          ),
      ],
    );
  }

  @override
  Future<List<DeliveryRecord>> history() async {
    final res = await pmartGuard(() => _me.listMyDeliveries());
    return [
      for (final d in res.data?.items ?? const <ex.DeliveryExecution>[])
        if (d.state == ex.ExecutionState.COMPLETED)
          DeliveryRecord(
            deliveryId: d.deliveryId,
            // 주문번호·마트 이름(execution 0.11.0 — 그 배포 뒤 배정부터). 없으면 예전 값.
            code: d.orderNumber ?? d.orderId ?? d.deliveryId ?? '-',
            store: d.mfcName ?? d.mfcId ?? '-',
            completedAt: (d.completedAt ?? d.assignedAt ?? DateTime.now())
                .toLocal(),
            fee: (d.earning?.calculable ?? false) ? d.earning?.total : null,
            // 소요시간 = 배정 ~ 완료(서버 시각 그대로 뺀 표시값).
            minutes: d.assignedAt != null && d.completedAt != null
                ? d.completedAt!.difference(d.assignedAt!).inMinutes
                : null,
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

final settlementsProvider = FutureProvider.autoDispose<SettlementList>(
  (ref) => ref.watch(recordsRepositoryProvider).settlements(),
);

final historyProvider = FutureProvider.autoDispose<List<DeliveryRecord>>(
  (ref) => ref.watch(recordsRepositoryProvider).history(),
);

/// 정산내역 — 수행료 줄 + 이의 인정 보상금 줄.
@immutable
class SettlementList {
  const SettlementList({required this.items, this.compensationsFailed = false});

  final List<Settlement> items;

  /// 보상금 목록을 못 읽었다(수행료만 보인다 — 화면은 "일부만"으로 알린다).
  final bool compensationsFailed;
}
