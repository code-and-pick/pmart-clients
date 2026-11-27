import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/field_repositories.dart';
import '../../../shared/pda_theme.dart';
import '../../../shared/product_hints.dart';
import '../../../shared/ui_state_of.dart';
import '../../inbound/domain/inbound.dart';
import '../../inbound/presentation/inbound_controller.dart'
    show inboundRepositoryProvider;
import '../../tasks/presentation/task_controllers.dart';
import '../data/my_work_repository.dart';

/// 내 오늘 업무 내역(사용자 2026-11-17 "작업자마다 본인의 금일 작업내용을 체크").
/// mfc-capacity `GET /mfcs/{mfcId}/workers/me/activities`(0.17.0) — 피킹·포장·복귀·입고·품질검사·적치·이동·
/// 회수품 반입·실사·품질 판정을 서버가 모아 준다. 오늘은 서버가 정한다(Asia/Seoul). 합계는 서버 값.
final myTodayWorkProvider = FutureProvider.autoDispose<WorkActivities>(
  (ref) => ref
      .watch(myWorkRepositoryProvider)
      .today(ref.watch(currentMfcIdProvider)),
);

String activityTypeText(AppLocalizations l10n, String type) => switch (type) {
  'PICK' => l10n.typePick,
  'PACK' => l10n.typePack,
  'RETURN' => l10n.typeReturn,
  'RECEIVE' => l10n.typeReceive,
  'INSPECT' => l10n.typeInspect,
  'PUTAWAY' => l10n.typePutaway,
  'MOVE' => l10n.typeMove,
  'RETURN_RECEIPT' => l10n.typeReturnReceipt,
  'COUNT' => l10n.actCount,
  'RECOUNT' => l10n.actRecount,
  'QUARANTINE' => l10n.actQuarantine,
  'RELEASE' => l10n.actRelease,
  'DISPOSE' => l10n.actDispose,
  'RETURN_INSPECTION' => l10n.typeReturnInspect,
  _ => type,
};

String? activityResultText(AppLocalizations l10n, String? r) => switch (r) {
  null => null,
  'APPLIED' => l10n.actApplied,
  'REJECTED' => l10n.actRejected,
  'RECORDED' || 'INVENTORY_PENDING' => l10n.actPending,
  'UNKNOWN_RESULT' => l10n.actUnknown,
  _ => r,
};

/// 업무 고르기·업무 진행 화면 맨 위의 작은 바 — "업무 내역" 칩을 누르면 오늘 업무 내역.
/// AppBar `bottom` 에 둔다. 조회 실패는 칩에 건수를 빼고 보일 뿐(내역 화면에서 오류를 보인다).
/// 입고 기록(taskId = trfId)의 TRF 화면 번호 — 입고 예정 조회(mfc-inbound 0.25.0 `trfNumber`). 모르면 null.
final inboundPromiseProvider = FutureProvider.autoDispose
    .family<InboundPromiseView, String>(
      (ref, trfId) => ref.watch(inboundRepositoryProvider).promise(trfId),
    );

final trfNumberProvider = FutureProvider.autoDispose.family<String?, String>((
  ref,
  trfId,
) async {
  try {
    return (await ref.watch(inboundPromiseProvider(trfId).future)).trfNumber;
  } on Object {
    return null;
  }
});

/// 작업을 다시 읽어 상품을 보는 업무 종류 — 출고 작업(fulfillment) · 입고 작업(mfc-inbound)
const _fulfillmentTypes = {'PICK', 'PACK', 'RETURN'};
const _inboundTaskTypes = {'INSPECT', 'PUTAWAY'};
const _taskTypes = {..._fulfillmentTypes, ..._inboundTaskTypes};

typedef WorkTaskProduct = ({String sku, String? name, int qty, String sub});

/// 업무 내역 한 건(종류, 작업 번호)의 상품 줄 — 서버 작업 조회 값 그대로
final workTaskProductsProvider = FutureProvider.autoDispose
    .family<List<WorkTaskProduct>, (String, String)>((ref, key) async {
      final (type, taskId) = key;
      if (_inboundTaskTypes.contains(type)) {
        final t = await ref
            .watch(qualityRepositoryProvider)
            .inboundTask(taskId);
        return [
          (
            sku: t.sku,
            name: t.productName,
            qty: t.doneQty,
            sub: ['LOT ${t.lotId}', t.locationCode].join(' · '),
          ),
        ];
      }
      final t = await ref.watch(taskRepositoryProvider).task(taskId);
      return [
        for (final l in t.lines)
          (
            sku: l.sku,
            name: l.productName,
            qty: l.completedQty,
            sub: '${l.completedQty} / ${l.plannedQty}',
          ),
      ];
    });

class MyWorkBar extends ConsumerWidget implements PreferredSizeWidget {
  const MyWorkBar({super.key});

  @override
  Size get preferredSize => const Size.fromHeight(44);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final n = ref.watch(myTodayWorkProvider).value?.items.length;
    return SizedBox(
      height: preferredSize.height,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
        child: Row(
          children: [
            ActionChip(
              key: const ValueKey('my-work-chip'),
              avatar: const Icon(Icons.history, size: 18),
              visualDensity: VisualDensity.compact,
              label: Text(
                n == null ? l10n.myWorkChip : l10n.myWorkChipCount(n),
              ),
              onPressed: () => context.push('/my-work'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 오늘 업무 내역 화면.
class MyWorkScreen extends ConsumerWidget {
  const MyWorkScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      resizeToAvoidBottomInset: false,
      appBar: AppBar(title: Text(l10n.myWorkTitle)),
      body: SafeArea(
        child: UiStateView<WorkActivities>(
          state: uiStateOf(ref.watch(myTodayWorkProvider)),
          onRetry: () => ref.invalidate(myTodayWorkProvider),
          ready: (context, a) => RefreshIndicator(
            onRefresh: () => ref.refresh(myTodayWorkProvider.future),
            child: _MyWorkList(a: a),
          ),
        ),
      ),
    );
  }
}

class _MyWorkList extends ConsumerStatefulWidget {
  const _MyWorkList({required this.a});

  final WorkActivities a;

  @override
  ConsumerState<_MyWorkList> createState() => _MyWorkListState();
}

class _MyWorkListState extends ConsumerState<_MyWorkList> {
  /// 거르기(참고 화면 "전체·피킹·패킹·적치") — null 이면 전체
  String? _type;

  @override
  Widget build(BuildContext context) {
    final a = widget.a;
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hints = ref.watch(productHintsProvider);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (a.unavailableSources.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              l10n.myWorkPartial(a.unavailableSources.join(', ')),
              key: const ValueKey('my-work-partial'),
              style: TextStyle(color: scheme.error),
            ),
          ),
        // 오늘 합계 — 옅은 보라 상자에 종류별 칸을 폭에 고르게(왼쪽으로 몰리지 않게, 사용자 2026-11-20).
        Container(
          key: const ValueKey('my-work-summary'),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          decoration: BoxDecoration(
            color: PdaColors.softer,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: PdaColors.lilac),
          ),
          child: a.totals.isEmpty
              ? Center(child: Text(l10n.myWorkNoTotals))
              : LayoutBuilder(
                  builder: (context, c) {
                    final per = a.totals.length < 3 ? a.totals.length : 3;
                    final w = c.maxWidth / per;
                    return Wrap(
                      runSpacing: 12,
                      children: [
                        for (final t in a.totals)
                          SizedBox(
                            width: w,
                            child: Column(
                              key: ValueKey('my-work-total-${t.type}'),
                              children: [
                                Text(
                                  activityTypeText(l10n, t.type),
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    color: PdaColors.onNotice,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  l10n.myWorkCount(t.count),
                                  style: theme.textTheme.headlineMedium
                                      ?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: PdaColors.primary,
                                      ),
                                ),
                                Text(
                                  l10n.myWorkTotalQty(t.qty),
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: PdaColors.body,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    );
                  },
                ),
        ),
        const SizedBox(height: 12),
        if (a.items.isNotEmpty)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final (t, label) in [
                  (null, l10n.myWorkFilterAll(a.items.length)),
                  for (final type in {for (final i in a.items) i.type})
                    (
                      type,
                      l10n.myWorkFilterType(
                        activityTypeText(l10n, type),
                        a.items.where((i) => i.type == type).length,
                      ),
                    ),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 6, bottom: 10),
                    child: ChoiceChip(
                      key: ValueKey('my-work-filter-${t ?? 'ALL'}'),
                      label: Text(label),
                      selected: _type == t,
                      showCheckmark: false,
                      selectedColor: PdaColors.primary,
                      labelStyle: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _type == t ? Colors.white : PdaColors.body,
                      ),
                      onSelected: (_) => setState(() => _type = t),
                    ),
                  ),
              ],
            ),
          ),
        if (a.items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Text(
              l10n.myWorkEmpty,
              key: const ValueKey('my-work-empty'),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
          ),
        // 한 건 = 한 상자. 결과는 색 칩(반영 초록·거절 빨강·그 밖 회색) — 오른쪽 작은 글씨로는 안 보였다.
        for (final i in a.items.where((i) => _type == null || i.type == _type))
          // 누르면 그 작업의 상품 목록(사용자 2026-11-27 "업무 내역 누르면 제품 목록도 나오게")
          GestureDetector(
            key: ValueKey('my-work-tap-${i.refId}'),
            behavior: HitTestBehavior.opaque,
            onTap: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              showDragHandle: true,
              builder: (_) => _WorkProducts(
                item: i,
                siblings: [
                  for (final x in a.items)
                    if (i.taskId != null &&
                        x.taskId == i.taskId &&
                        x.type == i.type)
                      x,
                ],
              ),
            ),
            child: Container(
              key: ValueKey('my-work-${i.refId}'),
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x145E3BB2),
                    blurRadius: 10,
                    offset: Offset(0, 3),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: PdaColors.softer,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                activityTypeText(l10n, i.type),
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: PdaColors.primary,
                                ),
                              ),
                            ),
                            if (i.sku case final s?) ...[
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  hints.bySku(s)?.name ?? s,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 4),
                        const SizedBox(height: 2),
                        // 어떤 건을 작업했는지 — 작업 번호(입고는 TRF, 실사는 실사 번호 등)·기록 번호(사용자 2026-11-27)
                        // 긴 내부 id(TRF-SR-uuid·RCV-TRF-uuid)는 내지 않는다 — 입고는 TRF 화면 번호(T…)를 찾아서(사용자 2026-11-27 "뭘 바꾼 거야")
                        Text(
                          [
                            if (i.type == 'RECEIVE' && i.taskId != null)
                              switch (ref
                                  .watch(trfNumberProvider(i.taskId!))
                                  .value) {
                                final n? => l10n.myWorkTrfNo(n),
                                _ => l10n.myWorkTrfLoading,
                              }
                            else if (i.taskId case final t? when t.length <= 16)
                              l10n.myWorkTaskNo(t),
                            if (i.refId.length <= 16) l10n.myWorkRefNo(i.refId),
                          ].join(' · '),
                          key: ValueKey('my-work-no-${i.refId}'),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: PdaColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            formatSeoulTime(i.at),
                            if (i.qty case final q?) l10n.myWorkItemQty(q),
                          ].join(' · '),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: PdaColors.body,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (activityResultText(l10n, i.result) case final r?)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: switch (i.result) {
                          'APPLIED' => PdaColors.okSoft,
                          'REJECTED' => PdaColors.dangerSoft,
                          _ => PdaColors.soft,
                        },
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        r,
                        style: theme.textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: switch (i.result) {
                            'APPLIED' => PdaColors.okInk,
                            'REJECTED' => scheme.error,
                            _ => PdaColors.body,
                          },
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          l10n.myWorkScopeNote,
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

/// 업무 내역 한 건의 상품 목록.
/// - 입고(RECEIVE, taskId = trfId): 입고 예정 조회의 상품 줄(예정·정상·격리·미판정) — 서버 값 그대로.
/// - 그 밖: 같은 작업(taskId·종류)의 내역 줄마다 상품·수량(작업 이력 원장 값).
class _WorkProducts extends ConsumerWidget {
  const _WorkProducts({required this.item, required this.siblings});

  final WorkActivity item;
  final List<WorkActivity> siblings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final hints = ref.watch(productHintsProvider);
    final trfId = item.type == 'RECEIVE' ? item.taskId : null;
    final rows = <Widget>[];
    if (trfId != null) {
      switch (ref.watch(inboundPromiseProvider(trfId))) {
        case AsyncData(:final value):
          for (final l in value.lines) {
            rows.add(
              _ProductRow(
                name: l.productName ?? hints.bySku(l.sku)?.name ?? l.sku,
                sku: l.sku,
                main: l10n.myWorkProductQty(l.receivedQty),
                sub: l10n.myWorkProductReceive(
                  l.expectedQty,
                  l.quarantinedQty,
                  l.pendingQty,
                ),
              ),
            );
          }
        case AsyncError():
          rows.add(
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                l10n.myWorkProductsFailed,
                key: const ValueKey('my-work-products-failed'),
                style: const TextStyle(color: PdaColors.danger, fontSize: 16),
              ),
            ),
          );
        default:
          rows.add(
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          );
      }
    } else if (item.taskId != null && _taskTypes.contains(item.type)) {
      // 피킹·포장·취소품 복귀(출고 작업)·품질검사·적치(입고 작업) — 기록에 상품이 없어도 작업을 다시 읽어 상품을(사용자 2026-11-27)
      switch (ref.watch(workTaskProductsProvider((item.type, item.taskId!)))) {
        case AsyncData(:final value) when value.isNotEmpty:
          for (final x in value) {
            rows.add(
              _ProductRow(
                name: x.name ?? hints.bySku(x.sku)?.name ?? x.sku,
                sku: x.sku,
                main: l10n.myWorkProductQty(x.qty),
                sub: x.sub,
              ),
            );
          }
        case AsyncData():
          rows.add(
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                l10n.myWorkProductsNone,
                style: const TextStyle(color: PdaColors.muted, fontSize: 16),
              ),
            ),
          );
        case AsyncError():
          // 작업을 못 읽으면 기록에 있는 상품이라도(없으면 실패 안내 — 빈 목록으로 꾸미지 않음)
          final own = [
            for (final x in siblings.isEmpty ? [item] : siblings)
              if (x.sku != null) x,
          ];
          if (own.isEmpty) {
            rows.add(
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  l10n.myWorkProductsFailed,
                  key: const ValueKey('my-work-products-failed'),
                  style: const TextStyle(color: PdaColors.danger, fontSize: 16),
                ),
              ),
            );
          }
          for (final x in own) {
            rows.add(
              _ProductRow(
                name: hints.bySku(x.sku!)?.name ?? x.sku!,
                sku: x.sku!,
                main: x.qty == null ? '—' : l10n.myWorkProductQty(x.qty!),
                sub: formatSeoulTime(x.at),
              ),
            );
          }
        default:
          rows.add(
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          );
      }
    } else {
      final list = siblings.isEmpty ? [item] : siblings;
      for (final x in list) {
        if (x.sku case final sku?) {
          rows.add(
            _ProductRow(
              name: hints.bySku(sku)?.name ?? sku,
              sku: sku,
              main: x.qty == null ? '—' : l10n.myWorkProductQty(x.qty!),
              sub: [
                formatSeoulTime(x.at),
                ?activityResultText(l10n, x.result),
              ].join(' · '),
            ),
          );
        }
      }
      if (rows.isEmpty) {
        rows.add(
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              l10n.myWorkProductsNone,
              style: const TextStyle(color: PdaColors.muted, fontSize: 16),
            ),
          ),
        );
      }
    }
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.75,
        ),
        child: ListView(
          key: const ValueKey('my-work-products'),
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text(
              l10n.myWorkProductsTitle(activityTypeText(l10n, item.type)),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 14),
            for (final (i, r) in rows.indexed) ...[
              if (i > 0) const Divider(height: 20),
              r,
            ],
          ],
        ),
      ),
    );
  }
}

class _ProductRow extends StatelessWidget {
  const _ProductRow({
    required this.name,
    required this.sku,
    required this.main,
    required this.sub,
  });

  final String name;
  final String sku;
  final String main;
  final String sub;

  @override
  Widget build(BuildContext context) => Row(
    key: ValueKey('my-work-product-$sku'),
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              sub,
              style: const TextStyle(fontSize: 14, color: PdaColors.muted),
            ),
          ],
        ),
      ),
      const SizedBox(width: 12),
      Text(
        main,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          color: PdaColors.primary,
        ),
      ),
    ],
  );
}
