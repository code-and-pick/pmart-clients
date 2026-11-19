import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../../shared/ui_state_of.dart';
import '../../appeals/data/appeals.dart';
import '../../appeals/presentation/appeal_screens.dart';
import '../data/records.dart';

String _day(AppLocalizations l10n, DateTime d) => l10n.monthDay(d.month, d.day);

String _span(AppLocalizations l10n, Duration d) =>
    l10n.hoursMinutes(d.inHours, d.inMinutes.remainder(60));

String settlementText(AppLocalizations l10n, SettlementStatus s) => switch (s) {
  SettlementStatus.estimated => l10n.stEstimated,
  SettlementStatus.awaitingConfirm => l10n.stAwaiting,
  SettlementStatus.confirmed => l10n.stConfirmed,
  SettlementStatus.paying => l10n.stPaying,
  SettlementStatus.paid => l10n.stPaid,
  SettlementStatus.payFailed => l10n.stPayFailed,
  SettlementStatus.adjusted => l10n.stAdjusted,
};

const _dark = Color(0xFF111111);

ThemeData _darkTheme(BuildContext context) => Theme.of(context).copyWith(
  textTheme: Theme.of(context).textTheme
      .apply(bodyColor: Colors.white, displayColor: Colors.white),
  iconTheme: const IconThemeData(color: Colors.white),
  progressIndicatorTheme: const ProgressIndicatorThemeData(color: Colors.white),
);

/// 운행시간.
class OperatingTimeScreen extends ConsumerWidget {
  const OperatingTimeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(context, title: l10n.menuTime, centerTitle: true),
      body: UiStateView<OperatingTime>(
        state: uiStateOf(ref.watch(operatingTimeProvider)),
        onRetry: () => ref.invalidate(operatingTimeProvider),
        ready: (context, t) => ListView(
          children: [
            _TimeBlock(
              title: l10n.timeToday,
              range: _day(l10n, t.today),
              total: _span(l10n, t.todayTotal),
            ),
            const SizedBox(height: 10),
            _TimeBlock(
              title: l10n.timeWeek,
              range: '${_day(l10n, t.weekStart)} - ${_day(l10n, t.weekEnd)}',
              total: _span(l10n, t.weekTotal),
              children: [
                const Divider(),
                const SizedBox(height: 14),
                for (final d in t.days)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _day(l10n, d.day),
                            style: const TextStyle(
                              fontSize: 15,
                              color: RiderColors.sub,
                            ),
                          ),
                        ),
                        Text(
                          _span(l10n, d.total),
                          style: const TextStyle(fontSize: 15),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TimeBlock extends StatelessWidget {
  const _TimeBlock({
    required this.title,
    required this.range,
    required this.total,
    this.children = const [],
  });

  final String title;
  final String range;
  final String total;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    color: Colors.white,
    padding: const EdgeInsets.all(20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(title, style: const TextStyle(fontSize: 17))),
            Text(
              range,
              style: const TextStyle(fontSize: 14, color: RiderColors.sub),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          total,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        if (children.isNotEmpty) const SizedBox(height: 18),
        ...children,
      ],
    ),
  );
}

/// 정산내역(어두운 화면). 금액은 서버 값만 보이고, 산정 전이면 "산정 불가"다.
class SettlementsScreen extends ConsumerWidget {
  const SettlementsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Theme(
      data: _darkTheme(context),
      child: Scaffold(
        backgroundColor: _dark,
        appBar: AppBar(
          backgroundColor: _dark,
          foregroundColor: Colors.white,
          centerTitle: true,
          title: Text(l10n.menuSettlements),
          titleTextStyle: riderTitleStyle(context, color: Colors.white),
        ),
        body: UiStateView<List<Settlement>>(
          state: uiStateOf(
            ref.watch(settlementsProvider),
            isEmpty: (l) => l.isEmpty,
          ),
          onRetry: () => ref.invalidate(settlementsProvider),
          ready: (context, list) => ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: list.length,
            separatorBuilder: (_, _) => const Divider(color: Color(0xFF3A3A3A)),
            itemBuilder: (context, i) {
              final s = list[i];
              return Padding(
                key: ValueKey('settlement-$i'),
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.compensation
                                // 이의 인정 보상금(원래 수행료와 따로 한 줄)
                                ? l10n.compensationLine(
                                    _day(l10n, s.from),
                                    s.payoutDate ?? '-',
                                  )
                                : s.from.year == s.to.year &&
                                      s.from.month == s.to.month &&
                                      s.from.day == s.to.day
                                ? _day(l10n, s.from)
                                : '${_day(l10n, s.from)} ~ ${_day(l10n, s.to)}',
                            key: s.compensation
                                ? ValueKey('compensation-$i')
                                : null,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            switch (s.amount) {
                              final int a => formatKrw(a),
                              null => l10n.feeUncalculated,
                            },
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          settlementText(l10n, s.status),
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: s.status == SettlementStatus.paid
                                ? RiderColors.gold
                                : s.status == SettlementStatus.payFailed
                                ? RiderColors.danger
                                : Colors.white,
                          ),
                        ),
                        // 수행료 이의 신청(rider 0.15.0) — 산정 불가·조정·결과 안내가 있는 줄
                        if (s.appealable)
                          TextButton(
                            key: ValueKey('appeal-earning-$i'),
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.white70,
                              padding: const EdgeInsets.only(top: 4),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            onPressed: () => context.push(
                              appealNewRoute(
                                AppealTarget.earning,
                                deliveryId: s.deliveryId,
                              ),
                            ),
                            child: Text(
                              l10n.appealButton,
                              style: const TextStyle(
                                fontSize: 14,
                                decoration: TextDecoration.underline,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// 배달기록(어두운 화면).
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Theme(
      data: _darkTheme(context),
      child: Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: const Color(0xFF333333),
          foregroundColor: Colors.white,
          centerTitle: true,
          title: Text(l10n.menuHistory),
          titleTextStyle: riderTitleStyle(context, color: Colors.white),
        ),
        body: UiStateView<List<DeliveryRecord>>(
          state: uiStateOf(
            ref.watch(historyProvider),
            isEmpty: (l) => l.isEmpty,
          ),
          onRetry: () => ref.invalidate(historyProvider),
          ready: (context, list) {
            final fees = list.map((r) => r.fee).whereType<int>();
            final km = list
                .map((r) => r.distanceKm)
                .whereType<double>()
                .fold<double>(0, (a, b) => a + b);
            return ListView(
              children: [
                Container(
                  margin: const EdgeInsets.all(8),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  color: Colors.white,
                  child: Row(
                    children: [
                      _Total(l10n.totalCount, l10n.countUnit(list.length)),
                      _Total(
                        l10n.totalFee,
                        // 산정 불가 건이 섞여 있으면 합계를 확정 값처럼 보이지 않는다.
                        fees.length == list.length
                            ? formatKrw(fees.fold(0, (a, b) => a + b))
                            : l10n.feeUncalculated,
                      ),
                      _Total(
                        l10n.totalDistance,
                        l10n.distanceKm(km.toStringAsFixed(1)),
                      ),
                    ],
                  ),
                ),
                for (final r in list) ...[
                  Padding(
                    key: ValueKey('record-${r.code}'),
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                r.code,
                                style: const TextStyle(
                                  color: Color(0xFFB9A8FF),
                                  fontSize: 19,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Text(
                              switch (r.fee) {
                                final int f => formatKrw(f),
                                null => l10n.feeUncalculated,
                              },
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        if (r.minutes case final m?)
                          Text(
                            l10n.tookMinutes(m),
                            style: const TextStyle(
                              color: Color(0xFFBBBBBB),
                              fontSize: 13,
                            ),
                          ),
                        Text(
                          r.store,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          [
                            formatSeoulDateTime(r.completedAt),
                            if (r.distanceKm case final d?)
                              l10n.distanceKm(d.toStringAsFixed(1)),
                          ].join('  |  '),
                          style: const TextStyle(
                            color: Color(0xFF999999),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(height: 6, color: const Color(0xFF333333)),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 14, color: RiderColors.ink),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w800,
            color: RiderColors.ink,
          ),
        ),
      ],
    ),
  );
}
