import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/location_guide.dart';
import '../../../shared/pda_theme.dart';
import '../../../shared/issue_report.dart';
import '../../../shared/printer/reprint.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../work/domain/work.dart';
import '../../work/presentation/work_screens.dart' show backToSession;
import '../domain/stock_count.dart';
import 'stock_count_controller.dart';

/// 재고 실사: 칸마다 칸 바코드 → 상품을 스캔해 세기(장부는 안 보임) → 확인 → 제출 → 서버 판정.
/// 같은 상품의 소비기한이 다르면 묶음을 고르고, 계수표에 없는 상품은 따로 센다.
class CountScreen extends ConsumerWidget {
  const CountScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(countFlowProvider(sessionId));
    final ctl = ref.read(countFlowProvider(sessionId).notifier);
    Future<void> next() async => backToSession(context, WorkArea.stockCount);

    Widget header() =>
        StepCaption(l10n.countLocationOf(s.locIndex + 1, s.locations.length));

    String lotText(CountSheetLine l) => [
      if (l.expiryDate case final e?) l10n.expiresOn(e),
      l10n.lot(l.lotId),
    ].join(' · ');

    final Widget body = switch (s.phase) {
      CountPhase.loading => const Center(child: CircularProgressIndicator()),
      CountPhase.loadError => ResultView(
        icon: Icons.cloud_off,
        text: l10n.countLoadError,
        action: l10n.retry,
        onAction: ctl.load,
      ),
      CountPhase.notMine => ResultView(
        key: const ValueKey('count-not-mine'),
        icon: Icons.people_outline,
        text: l10n.countNotMine,
        action: l10n.nextTask,
        onAction: next,
      ),
      CountPhase.reported => ResultView(
        key: const ValueKey('count-reported'),
        icon: Icons.report_problem_outlined,
        text: l10n.issueReported,
        action: l10n.nextTask,
        onAction: next,
      ),
      CountPhase.result => ResultView(
        key: ValueKey('count-result-${s.session!.state.name}'),
        icon: switch (s.session!.state) {
          CountState.matched || CountState.adjusted => Icons.check_circle,
          _ => Icons.hourglass_top,
        },
        text: switch (s.session!.state) {
          CountState.matched => l10n.countMatched,
          CountState.recountRequired => l10n.countRecountRequired,
          CountState.pendingApproval => l10n.countPendingApproval,
          CountState.adjusted => l10n.countAdjusted,
          CountState.rejected => l10n.countRejected,
          _ => l10n.countSubmitted,
        },
        action: l10n.nextTask,
        onAction: next,
      ),
      CountPhase.goTo => StepBody(
        actions: [
          ScanInput(
            id: 'count-loc-scan',
            testValues: [
              TestScan(l10n.tsLocation, s.location!),
              for (final x in s.locations)
                if (x != s.location) TestScan(l10n.tsWrong, x),
            ],
            label: l10n.countScanLocation,
            cameraTitle: l10n.areaStockCount,
            continuous: false,
            autofocus: false,
            onScan: (code) => ctl.scanLocation(code)
                ? const ScanFeedback.ok()
                : ScanFeedback.error(l10n.moveWrongPlace),
          ),
        ],
        child: ListView(
          children: [
            const SizedBox(height: 14),
            header(),
            LocationGuide(
              key: const ValueKey('count-target'),
              code: s.location!,
              title: l10n.countGoTitle,
            ),
            if (s.wrongPlace)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  l10n.moveWrongPlace,
                  key: const ValueKey('count-wrong-place'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            NoticeBox(text: l10n.countBlindHelp),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: IssueButton(
                id: 'count-issue',
                area: 'count',
                targetId: sessionId,
                location: s.location,
                issues: const [FieldIssue.locationBlocked],
                onReported: (_) => ctl.reported(),
              ),
            ),
          ],
        ),
      ),
      CountPhase.counting => () {
        final lines = s.linesAt(s.location!);
        final extras = s.extrasAt(s.location!);
        final choosing = s.chooseFor;
        return StepBody(
          actions: [
            ScanInput(
              id: 'count-item-scan',
              reprint: [
                for (final l in lines)
                  ReprintTarget(
                    sku: l.sku,
                    name: ctl.nameOf(l),
                    barcode: ctl.barcodeOf(l),
                  ),
              ],
              testValues: [
                for (final l in lines)
                  if (ctl.barcodeOf(l) case final bc?)
                    TestScan(ctl.nameOf(l) ?? l.sku, bc),
                TestScan(l10n.tsNotOnSheet, '8801056021021'),
                TestScan(l10n.tsUnknownProduct, '0000000000000'),
              ],
              label: l10n.scanItemBtn,
              cameraTitle: l10n.areaStockCount,
              autofocus: false,
              onScan: (code) => switch (ctl.scanProduct(code)) {
                CountScan.ok => const ScanFeedback.ok(),
                CountScan.chooseLot => ScanFeedback.error(l10n.countChooseLot),
                CountScan.extra => ScanFeedback.error(l10n.countExtraFound),
                CountScan.notCounting => ScanFeedback.error(
                  l10n.countScanLocation,
                ),
              },
            ),
            FilledButton(
              key: const ValueKey('count-next'),
              onPressed: s.locationDone ? ctl.nextLocation : null,
              child: Text(
                s.locIndex + 1 < s.locations.length
                    ? l10n.countNextLocation
                    : l10n.inboundToReview,
              ),
            ),
          ],
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 14),
              header(),
              ScanPrompt(
                text: l10n.countCountTitle,
                detail: '${l10n.countAt} ${s.location!}',
              ),
              SizedBox(
                height: 20,
                child: s.lastScan == CountScan.extra
                    ? Text(
                        l10n.countExtraFound,
                        key: const ValueKey('count-extra-found'),
                        style: TextStyle(color: theme.colorScheme.error),
                      )
                    : null,
              ),
              // 같은 상품의 소비기한이 다른 묶음 — 지금 세는 묶음을 고른다(스캔이 그 묶음에 +1).
              for (final sku in {
                for (final l in lines)
                  if (lines.where((x) => x.sku == l.sku).length > 1) l.sku,
              })
                Card(
                  key: ValueKey('count-lots-$sku'),
                  color: choosing == sku ? PdaColors.warning : null,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          choosing == sku
                              ? l10n.countChooseLot
                              : l10n.countLotSwitch(
                                  ctl.nameOf(
                                        lines.firstWhere((l) => l.sku == sku),
                                      ) ??
                                      sku,
                                ),
                          key: choosing == sku
                              ? const ValueKey('count-choose-lot')
                              : null,
                          style: theme.textTheme.titleSmall,
                        ),
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final l in lines)
                              if (l.sku == sku)
                                ChoiceChip(
                                  key: ValueKey('lot-choice-${l.key}'),
                                  label: Text(lotText(l)),
                                  selected: s.lotChoice[sku] == l.key,
                                  onSelected: (_) => ctl.chooseLot(l),
                                ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              Expanded(
                child: ListView(
                  children: [
                    for (final l in lines)
                      Card(
                        key: ValueKey('count-line-${l.key}'),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                ctl.nameOf(l) ?? l.sku,
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                [l.sku, lotText(l)].join(' · '),
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: PdaColors.muted,
                                ),
                              ),
                              // 바코드를 알면 스캔이 +1(＋ 버튼 없음) — 많으면 하나 찍은 뒤 숫자를 눌러 넣는다.
                              QtyStepper(
                                id: 'count-${l.key}',
                                label: s.counts.containsKey(l.key)
                                    ? l10n.countCounted
                                    : l10n.countNotYet,
                                value: s.counts[l.key] ?? 0,
                                enabled: !s.unknown,
                                plusEnabled: ctl.barcodeOf(l) == null,
                                typeEnabled:
                                    ctl.barcodeOf(l) == null ||
                                    (s.counts[l.key] ?? 0) > 0,
                                onChanged: (v) => ctl.setCount(l, v),
                              ),
                              if (!s.counts.containsKey(l.key))
                                TextButton(
                                  key: ValueKey('count-zero-${l.key}'),
                                  onPressed: () => ctl.setCount(l, 0),
                                  child: Text(l10n.countNone),
                                ),
                            ],
                          ),
                        ),
                      ),
                    if (extras.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          l10n.countExtrasTitle,
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                      for (final e in extras)
                        Card(
                          key: ValueKey('count-extra-${e.barcode}'),
                          color: theme.colorScheme.errorContainer,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: QtyStepper(
                              id: 'extra-${e.barcode}',
                              label: e.productName ?? e.barcode,
                              value: e.qty,
                              plusEnabled: false,
                              onChanged: (v) => ctl.setExtra(e, v),
                            ),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      }(),
      CountPhase.review => StepBody(
        actions: [
          Row(
            children: [
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(96, 56),
                ),
                onPressed: s.busy || s.unknown ? null : ctl.back,
                child: Text(l10n.prev),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: CommandButton(
                  key: const ValueKey('count-submit'),
                  busy: s.busy,
                  label: s.unknown ? l10n.checkAgain : l10n.countSubmit,
                  onPressed: ctl.submit,
                ),
              ),
            ],
          ),
        ],
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 14),
            ScanPrompt(text: l10n.countReviewTitle),
            Expanded(
              child: Card(
                margin: EdgeInsets.zero,
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  children: [
                    for (final l in s.session!.sheet)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(
                          '${l.locationCode} · ${ctl.nameOf(l) ?? l.sku}',
                        ),
                        subtitle: Text(lotText(l)),
                        trailing: Text(
                          '${s.counts[l.key] ?? 0}',
                          style: theme.textTheme.titleLarge,
                        ),
                      ),
                    for (final e in s.extras.values)
                      ListTile(
                        key: ValueKey('review-extra-${e.barcode}'),
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(
                          '${e.locationCode} · ${e.productName ?? e.barcode}',
                        ),
                        subtitle: Text(
                          l10n.countExtraLabel,
                          style: TextStyle(color: theme.colorScheme.error),
                        ),
                        trailing: Text(
                          '${e.qty}',
                          style: theme.textTheme.titleLarge,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (s.code case final c?)
              Text(
                l10n.inspectRejected(c),
                key: const ValueKey('count-rejected'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (s.unknown)
              Text(l10n.inspectUnknown, key: const ValueKey('count-unknown')),
          ],
        ),
      ),
    };
    final stepped = switch (s.phase) {
      CountPhase.goTo || CountPhase.counting || CountPhase.review => true,
      _ => false,
    };
    return Scaffold(
      appBar: AppBar(title: Text(l10n.areaStockCount)),
      body: SafeArea(
        child: stepped
            ? body
            : Padding(padding: const EdgeInsets.all(16), child: body),
      ),
    );
  }
}
