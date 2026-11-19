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
import '../../work/presentation/work_controller.dart' show autoNextAllowed;
import '../../work/presentation/work_screens.dart' show backToSession;
import '../domain/stock_move.dart';
import 'stock_move_controllers.dart';

String locScanText(AppLocalizations l10n, LocScan r) => switch (r) {
  LocScan.ok => '',
  LocScan.wrongPlace => l10n.moveWrongPlace,
  LocScan.notLocation => l10n.moveNotLocation,
  LocScan.needCart => l10n.moveNeedCart,
  LocScan.needFrom => l10n.moveNeedFrom,
  LocScan.needLoad => l10n.moveNeedLoad,
  LocScan.wrongItem => l10n.moveWrongItem,
  LocScan.over => l10n.moveOver,
};

Future<void> _next(BuildContext context) async =>
    backToSession(context, WorkArea.stockMove);

/// 상품 확인 줄 — 바코드를 알면 "스캔해 센 수", 모르면 확인할 수 없다는 안내.
class _ProductCheck extends StatelessWidget {
  const _ProductCheck({required this.barcodeKnown, required this.counted});

  final bool barcodeKnown;
  final int counted;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Text(
      barcodeKnown ? l10n.moveScanned(counted) : l10n.moveNoBarcode,
      key: const ValueKey('product-check'),
      style: barcodeKnown
          ? theme.textTheme.titleMedium
          : TextStyle(color: theme.colorScheme.error),
    );
  }
}

/// 옮길 상품 카드 — 이름(굵게)·SKU·LOT(회색)·진행 한 줄(보라).
class _MoveProductCard extends StatelessWidget {
  const _MoveProductCard({
    required this.name,
    required this.meta,
    required this.line,
    this.urgent = false,
    this.warning,
  });

  final String name;
  final String meta;
  final String line;
  final bool urgent;
  final String? warning;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (urgent) Chip(label: Text(l10n.urgent)),
              ],
            ),
            Text(meta, style: const TextStyle(color: PdaColors.muted)),
            const SizedBox(height: 4),
            Text(
              line,
              style: theme.textTheme.titleSmall?.copyWith(
                color: PdaColors.primary,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (warning case final w?)
              Text(w, style: TextStyle(color: theme.colorScheme.error)),
          ],
        ),
      ),
    );
  }
}

/// 이동·보충 지시(사용자 2026-11-13 순서) — 세 쪽으로 나뉜다:
/// ① 위치 확인: 카트 스캔 → (그 뒤에야) 출발 칸 스캔. 둘 다 찍으면 다음 쪽으로.
/// ② 상품 싣기: 상품을 1개씩 스캔해 세고 "카트에 실었어요"(서버 `pickups` — 실은 수량을 여기서 기록).
/// ③ 내려놓기: "이동하세요" 안내 → 도착 칸 스캔 → "내려놓았어요"(`drops`).
class MoveScreen extends ConsumerWidget {
  const MoveScreen({super.key, required this.moveId});

  final String moveId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(moveFlowProvider(moveId));
    final ctl = ref.read(moveFlowProvider(moveId).notifier);
    final m = s.move;
    final title = m?.kind == MoveKind.replenish
        ? l10n.typeReplenish
        : l10n.typeMove;
    final barcode = ctl.productBarcode;
    final picking = s.phase == MovePhase.pickUp;
    // ① 위치 확인(카트·출발 칸을 아직 다 찍지 않았다) ② 상품 싣기 ③ 내려놓기
    final locating = picking && !(s.cart != null && s.atFrom);
    final loading = picking && !locating;

    final Widget body = switch (s.phase) {
      MovePhase.loading => const Center(child: CircularProgressIndicator()),
      MovePhase.loadError => ResultView(
        icon: Icons.cloud_off,
        text: l10n.moveLoadError,
        action: l10n.retry,
        onAction: ctl.load,
      ),
      MovePhase.cancelled => ResultView(
        key: const ValueKey('move-cancelled'),
        icon: Icons.cancel_outlined,
        text: l10n.moveCancelled,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      MovePhase.reported => ResultView(
        key: const ValueKey('move-reported'),
        icon: Icons.report_problem_outlined,
        text: l10n.issueReported,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      // 서버가 이 지시를 끝났다고(COMPLETED) 답한 뒤에만 나온다.
      MovePhase.done => TaskDoneView(
        key: const ValueKey('move-done'),
        title: m?.kind == MoveKind.replenish
            ? l10n.moveDoneTitleReplenish
            : l10n.moveDoneTitle,
        message: l10n.moveDone(m?.droppedQty ?? 0, m?.toLocation ?? '-'),
        rows: [
          if (m != null) ...[
            (l10n.moveDoneProduct, ctl.productName ?? m.sku),
            (l10n.moveDoneLot, [m.sku, l10n.lot(m.lotId)].join(' · ')),
            (l10n.moveDoneQty, l10n.moveDoneQtyValue(m.droppedQty, m.qty)),
            (l10n.moveFrom, m.fromLocation),
            (l10n.moveTo, m.toLocation),
            if ((m.cartLocation ?? s.cart) case final c?) (l10n.moveCart, c),
          ],
        ],
        onNext: () => _next(context),
        autoNext: autoNextAllowed(ref),
      ),
      MovePhase.pickUp || MovePhase.drop => StepBody(
        actions: [
          ScanInput(
            id: 'move-scan',
            reprint: loading
                ? [
                    ReprintTarget(
                      sku: m!.sku,
                      name: ctl.productName,
                      barcode: barcode,
                    ),
                  ]
                : null,
            testValues: locating
                ? [
                    TestScan(l10n.tsCart, 'CRT-C-01'),
                    TestScan(l10n.tsFrom, m!.fromLocation),
                    TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                  ]
                : loading
                ? [
                    if (barcode != null) TestScan(l10n.tsProduct, barcode),
                    TestScan(l10n.tsWrongProduct, '0000000000000'),
                  ]
                : [
                    TestScan(l10n.tsTo, m!.dropTarget),
                    TestScan(l10n.tsWrong, 'A-S9-09-9-99'),
                  ],
            testActions: [
              if (loading && barcode != null)
                TestAction('fill', l10n.testFillMove, () {
                  while (ctl.current.qty < m!.toPick &&
                      ctl.scan(barcode) == LocScan.ok) {}
                }),
            ],
            label: locating
                ? (s.cart == null ? l10n.moveScanCart : l10n.moveScanPick)
                : loading
                ? l10n.moveScanItem
                : l10n.moveScanDrop,
            cameraTitle: title,
            continuous: false,
            autofocus: false,
            onScan: (code) => switch (ctl.scan(code)) {
              LocScan.ok => const ScanFeedback.ok(),
              final r => ScanFeedback.error(locScanText(l10n, r)),
            },
          ),
          if (!locating || s.unknown)
            CommandButton(
              key: const ValueKey('move-submit'),
              busy: s.busy,
              label: s.unknown
                  ? l10n.checkAgain
                  : picking
                  ? l10n.movePickUp
                  : l10n.moveDrop,
              onPressed: (picking ? ctl.canPickUp : ctl.canDrop)
                  ? ctl.submit
                  : null,
            ),
        ],
        child: ListView(
          children: [
            StepHeader(
              names: [
                l10n.moveStepLocate,
                l10n.moveStepLoad,
                l10n.moveStepDrop,
              ],
              current: locating
                  ? 0
                  : loading
                  ? 1
                  : 2,
            ),
            if (locating) ...[
              ScanPrompt(
                text: s.cart == null ? l10n.moveCartTitle : l10n.moveFromTitle,
              ),
              // 카트가 먼저다. 카트를 찍기 전에는 출발 칸을 받지 않는다(흐리게 보인다).
              TargetLine(
                key: const ValueKey('target-cart'),
                label: l10n.moveCart,
                code: s.cart ?? l10n.moveCartScan,
                confirmed: s.cart != null,
              ),
              const SizedBox(height: 8),
              Opacity(
                key: const ValueKey('target-from-lock'),
                opacity: s.cart == null ? 0.4 : 1,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StepCaption(l10n.moveFrom),
                    LocationCard(
                      code: m!.fromLocation,
                      codeKey: const ValueKey('target-from'),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 8),
                // ① 위치 확인 쪽에는 수량·싣기 버튼이 없다 — 둘 다 찍으면 상품 싣기 쪽으로 넘어간다.
                child: Text(
                  s.cart == null
                      ? l10n.moveLocateCartFirst
                      : l10n.moveLocateFrom,
                  key: const ValueKey('move-locate-hint'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: PdaColors.muted,
                  ),
                ),
              ),
            ] else if (loading)
              ScanPrompt(
                text: l10n.moveLoadTitle(m!.toPick),
                detail: '${l10n.moveFrom} ${m.fromLocation}',
              )
            else ...[
              if (!s.atTo)
                GoBanner(
                  key: const ValueKey('move-go'),
                  text: m!.state == MoveState.cancelPending
                      ? l10n.moveGoBack
                      : l10n.moveGo,
                ),
              ScanPrompt(
                text: s.atTo ? l10n.moveDropReady : l10n.moveDropTitle,
                detail:
                    '${m!.state == MoveState.cancelPending ? l10n.moveBackTo : l10n.moveTo} ${m.dropTarget}',
              ),
              if (!s.atTo)
                LocationCard(
                  key: const ValueKey('target-to'),
                  code: m.dropTarget,
                ),
            ],
            _MoveProductCard(
              name: ctl.productName ?? m.sku,
              meta: [m.sku, l10n.lot(m.lotId)].join(' · '),
              line: l10n.moveProgress(m.qty, m.pickedQty, m.droppedQty),
              urgent: m.urgent,
              warning: m.state == MoveState.cancelPending
                  ? l10n.moveCancelPending
                  : null,
            ),
            if (s.lastScan != null && s.lastScan != LocScan.ok)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  locScanText(l10n, s.lastScan!),
                  key: const ValueKey('move-scan-error'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            if (loading) ...[
              // 바코드를 알면 첫 개를 스캔한 뒤 수량 칸(스캔·+·수기, 피킹과 같게). 모르면 직접 넣는다.
              if (barcode == null || s.qty == 0)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: _ProductCheck(
                    barcodeKnown: barcode != null,
                    counted: s.qty,
                  ),
                ),
              if (barcode == null)
                QtyStepper(
                  id: 'move-qty',
                  label: l10n.moveQtyPick,
                  value: s.qty,
                  max: m.toPick,
                  enabled: !s.unknown,
                  onChanged: ctl.setQty,
                )
              else if (s.qty > 0)
                CountQtyField(
                  id: 'move-qty',
                  label: l10n.moveQtyPick,
                  help: l10n.countQtyHelp(m.toPick),
                  addLabel: l10n.pickQtyAdd,
                  value: s.qty,
                  max: m.toPick,
                  onAdd: () => ctl.scan(barcode),
                  onSet: (n) => ctl.setQty(n.clamp(1, m.toPick)),
                ),
            ] else if (!locating)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: QtyStepper(
                  id: 'move-qty',
                  label: l10n.moveQtyDrop,
                  value: s.qty,
                  max: m.onCartQty,
                  enabled: !s.unknown,
                  onChanged: ctl.setQty,
                ),
              ),
            if (s.code case final c?)
              Text(
                fieldRejectedText(l10n, c),
                key: const ValueKey('move-rejected'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (s.unknown)
              Text(l10n.inspectUnknown, key: const ValueKey('move-unknown')),
            if (!s.unknown)
              Align(
                alignment: Alignment.centerLeft,
                child: IssueButton(
                  id: 'move-issue',
                  area: 'move',
                  targetId: moveId,
                  location: s.phase == MovePhase.pickUp
                      ? m.fromLocation
                      : m.dropTarget,
                  qty: s.phase == MovePhase.pickUp ? m.toPick : m.onCartQty,
                  issues: s.phase == MovePhase.pickUp
                      ? const [
                          FieldIssue.sourceEmpty,
                          FieldIssue.sourceShort,
                          FieldIssue.damaged,
                          FieldIssue.locationBlocked,
                        ]
                      : const [
                          FieldIssue.targetUnusable,
                          FieldIssue.locationBlocked,
                        ],
                  onReported: (_) => ctl.reported(),
                ),
              ),
          ],
        ),
      ),
    };
    final stepped = s.phase == MovePhase.pickUp || s.phase == MovePhase.drop;
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: Padding(
          padding: stepped
              ? const EdgeInsets.only(top: 14)
              : const EdgeInsets.all(16),
          child: body,
        ),
      ),
    );
  }
}

/// 적치 — 이동·보충과 같은 순서(사용자 2026-11-13): ① 출발 위치 확인 ② 상품(1개씩 스캔) → "실었어요"
/// ③ "이동하세요" → 도착 선반(추천) → 적치(이때부터 판매 가능). 카트 스캔은 없다(계약에 카트가 없다).
class PutawayScreen extends ConsumerWidget {
  const PutawayScreen({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(putawayFlowProvider(taskId));
    final ctl = ref.read(putawayFlowProvider(taskId).notifier);
    final barcode = ctl.productBarcode;

    final Widget body = switch (s.phase) {
      PutawayPhase.loading => const Center(child: CircularProgressIndicator()),
      PutawayPhase.loadError => ResultView(
        icon: Icons.cloud_off,
        text: l10n.moveLoadError,
        action: l10n.retry,
        onAction: ctl.load,
      ),
      PutawayPhase.notFound => ResultView(
        key: const ValueKey('putaway-not-found'),
        icon: Icons.search_off,
        text: l10n.inspectNotFound,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      PutawayPhase.reported => ResultView(
        key: const ValueKey('putaway-reported'),
        icon: Icons.report_problem_outlined,
        text: l10n.issueReported,
        action: l10n.nextTask,
        onAction: () => _next(context),
      ),
      // 서버가 적치를 끝났다고 답한 뒤에만 나온다.
      PutawayPhase.done => TaskDoneView(
        key: const ValueKey('putaway-done'),
        title: l10n.putawayDoneTitle,
        message: l10n.putawayDone,
        rows: [
          if (s.task case final t?) ...[
            (l10n.moveDoneProduct, t.productName ?? t.sku),
            (l10n.moveDoneLot, '${t.sku} · ${l10n.lot(t.lotId)}'),
            (l10n.moveFrom, t.locationCode),
            if (s.to case final to?) (l10n.moveTo, to),
          ],
        ],
        onNext: () => _next(context),
        autoNext: autoNextAllowed(ref),
      ),
      PutawayPhase.editing => () {
        final t = s.task!;
        final suggested = t.suggestedLocations;
        // ① 위치 확인(출발 위치) ② 상품 싣기 ③ 내려놓기(도착 선반) — 이동·보충과 같은 순서.
        final step = !s.atFrom
            ? 0
            : !s.loaded
            ? 1
            : 2;
        return StepBody(
          actions: [
            ScanInput(
              id: 'putaway-scan',
              reprint: step == 1
                  ? [
                      ReprintTarget(
                        sku: t.sku,
                        name: t.productName,
                        barcode: barcode,
                      ),
                    ]
                  : null,
              testValues: switch (step) {
                0 => [
                  TestScan(l10n.tsFrom, t.locationCode),
                  TestScan(l10n.tsWrong, 'hello'),
                ],
                1 => [
                  if (barcode != null) TestScan(l10n.tsProduct, barcode),
                  TestScan(l10n.tsWrongProduct, '0000000000000'),
                ],
                _ => [
                  for (final x in suggested) TestScan(l10n.tsShelf, x),
                  TestScan(l10n.tsShelf, 'C-S1-03-2-05'),
                  TestScan(l10n.tsWrong, 'hello'),
                ],
              },
              testActions: [
                if (step == 1 && barcode != null)
                  TestAction('fill', l10n.testFillMove, () {
                    while (ctl.current.qty < t.remainingQty &&
                        ctl.scan(barcode) == LocScan.ok) {}
                  }),
              ],
              label: switch (step) {
                0 => l10n.putawayScanFrom,
                1 => l10n.moveScanItem,
                _ => l10n.moveScanDrop,
              },
              cameraTitle: l10n.typePutaway,
              continuous: false,
              autofocus: false,
              onScan: (code) => switch (ctl.scan(code)) {
                LocScan.ok => const ScanFeedback.ok(),
                final r => ScanFeedback.error(locScanText(l10n, r)),
              },
            ),
            if (step == 1 && !s.unknown)
              // 화면 안의 단계 — 서버에는 적치할 때 한 번만 보낸다.
              CommandButton(
                key: const ValueKey('putaway-load'),
                busy: false,
                label: l10n.moveLoaded,
                onPressed: s.qty > 0 ? () async => ctl.markLoaded() : null,
              )
            else if (step == 2 || s.unknown)
              CommandButton(
                key: const ValueKey('putaway-submit'),
                busy: s.busy,
                label: s.unknown ? l10n.checkAgain : l10n.putawaySubmit,
                onPressed: s.unknown || (s.to != null && s.qty > 0)
                    ? ctl.submit
                    : null,
              ),
          ],
          child: ListView(
            children: [
              StepHeader(
                names: [
                  l10n.moveStepLocate,
                  l10n.moveStepLoad,
                  l10n.moveStepDrop,
                ],
                current: step,
              ),
              if (step == 0) ...[
                LocationGuide(
                  key: const ValueKey('target-putaway-from'),
                  code: t.locationCode,
                  title: l10n.putawayFromTitle,
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    l10n.moveLocateFrom,
                    key: const ValueKey('putaway-locate-hint'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: PdaColors.muted,
                    ),
                  ),
                ),
              ] else if (step == 1)
                ScanPrompt(
                  text: l10n.moveLoadTitle(t.remainingQty),
                  detail: '${l10n.moveFrom} ${t.locationCode}',
                )
              else ...[
                if (s.to == null)
                  GoBanner(
                    key: const ValueKey('putaway-go'),
                    text: l10n.putawayGo,
                  ),
                ScanPrompt(
                  text: s.to == null
                      ? l10n.putawayDropTitle
                      : l10n.putawayDropReady,
                  detail: s.to == null ? null : '${l10n.moveTo} ${s.to}',
                ),
                if (s.to == null && suggested.isNotEmpty)
                  LocationCard(
                    key: const ValueKey('target-putaway'),
                    code: suggested.first,
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: suggested.isNotEmpty
                      ? Text(
                          l10n.returnShelfSuggested(suggested.join(', ')),
                          key: const ValueKey('putaway-suggested'),
                          style: const TextStyle(color: PdaColors.muted),
                        )
                      : Text(
                          l10n.putawayNoSuggestion,
                          key: const ValueKey('putaway-no-suggestion'),
                          style: theme.textTheme.bodySmall,
                        ),
                ),
                if (s.to case final to?
                    when suggested.isNotEmpty && !suggested.contains(to))
                  NoticeBox(text: l10n.returnShelfNotSuggested, warning: true),
              ],
              _MoveProductCard(
                name: t.productName ?? t.sku,
                meta: '${t.sku} · ${l10n.lot(t.lotId)}',
                line: l10n.putawayRemaining(t.remainingQty),
              ),
              if (s.lastScan != null && s.lastScan != LocScan.ok)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    locScanText(l10n, s.lastScan!),
                    key: const ValueKey('putaway-scan-error'),
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              if (step == 1) ...[
                if (barcode == null || s.qty == 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: _ProductCheck(
                      barcodeKnown: barcode != null,
                      counted: s.qty,
                    ),
                  ),
                if (barcode == null)
                  QtyStepper(
                    id: 'putaway-qty',
                    label: l10n.putawayQty,
                    value: s.qty,
                    max: t.remainingQty,
                    enabled: !s.unknown,
                    onChanged: ctl.setQty,
                  )
                else if (s.qty > 0)
                  CountQtyField(
                    id: 'putaway-qty',
                    label: l10n.putawayQty,
                    help: l10n.countQtyHelp(t.remainingQty),
                    addLabel: l10n.pickQtyAdd,
                    value: s.qty,
                    max: t.remainingQty,
                    onAdd: () => ctl.scan(barcode),
                    onSet: (n) => ctl.setQty(n.clamp(1, t.remainingQty)),
                  ),
              ] else if (step == 2)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          l10n.moveLoadedQty(s.qty),
                          key: const ValueKey('putaway-loaded-qty'),
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      if (!s.unknown)
                        TextButton(
                          key: const ValueKey('putaway-recount'),
                          onPressed: s.busy ? null : ctl.recount,
                          child: Text(l10n.moveRecount),
                        ),
                    ],
                  ),
                ),
              if (s.code case final c?)
                Text(
                  fieldRejectedText(l10n, c),
                  key: const ValueKey('putaway-rejected'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              if (s.unknown)
                Text(
                  l10n.inspectUnknown,
                  key: const ValueKey('putaway-unknown'),
                ),
              if (!s.unknown)
                Align(
                  alignment: Alignment.centerLeft,
                  child: IssueButton(
                    id: 'putaway-issue',
                    area: 'putaway',
                    targetId: taskId,
                    location: s.to ?? t.locationCode,
                    qty: t.remainingQty,
                    issues: const [
                      FieldIssue.targetUnusable,
                      FieldIssue.sourceShort,
                      FieldIssue.damaged,
                    ],
                    onReported: (_) => ctl.reported(),
                  ),
                ),
            ],
          ),
        );
      }(),
    };
    final stepped = s.phase == PutawayPhase.editing;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.typePutaway)),
      body: SafeArea(
        child: Padding(
          padding: stepped
              ? const EdgeInsets.only(top: 14)
              : const EdgeInsets.all(16),
          child: body,
        ),
      ),
    );
  }
}
