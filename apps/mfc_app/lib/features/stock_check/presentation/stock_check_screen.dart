import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/location_guide.dart';
import '../../../shared/product_hints.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../data/stock_check_repository.dart';

/// 찍은 값 하나의 조회 결과.
sealed class StockCheckResult {
  const StockCheckResult();
}

/// 모르는 바코드(상품에 매핑되지 않음 — product 404).
final class UnknownProduct extends StockCheckResult {
  const UnknownProduct(this.code);
  final String code;
}

final class StockFound extends StockCheckResult {
  const StockFound(this.view);
  final StockView view;
}

final stockCheckProvider = FutureProvider.autoDispose
    .family<StockCheckResult, String>((ref, code) async {
      final repo = ref.watch(stockCheckRepositoryProvider);
      final sku = await repo.resolveSku(code);
      if (sku == null) return UnknownProduct(code);
      return StockFound(
        await repo.centerStock(ref.watch(currentMfcIdProvider), sku),
      );
    });

String qualityStateText(AppLocalizations l10n, String? s) => switch (s) {
  'NORMAL' => l10n.stockQualityNormal,
  'PENDING_INSPECTION' => l10n.stockQualityPendingInspection,
  'QUARANTINED' => l10n.stockQualityQuarantined,
  'DISPOSAL_PENDING' => l10n.stockQualityDisposalPending,
  _ => s ?? '—',
};

String workStateText(AppLocalizations l10n, String? s) => switch (s) {
  'UNSTOWED' => l10n.stockWorkUnstowed,
  'STORED' => l10n.stockWorkStored,
  'PICKED' => l10n.stockWorkPicked,
  'PACKED' => l10n.stockWorkPacked,
  'CANCEL_RETURN_PENDING' => l10n.stockWorkCancelReturnPending,
  _ => s ?? '—',
};

/// 재고 확인 — 상품 바코드(또는 SKU)를 찍으면 이 센터의 LOT 요약과 칸별 재고. 보기만 한다.
class StockCheckScreen extends ConsumerStatefulWidget {
  const StockCheckScreen({super.key});

  @override
  ConsumerState<StockCheckScreen> createState() => _StockCheckScreenState();
}

class _StockCheckScreenState extends ConsumerState<StockCheckScreen> {
  String? _code;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final code = _code;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.stockCheckTitle)),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: ScanInput(
                id: 'stock-check-scan',
                label: l10n.stockCheckScanHint,
                cameraTitle: l10n.stockCheckScanHint,
                testValues: [
                  TestScan(l10n.stockCheckTestMilk, '8801115114154'),
                  TestScan(l10n.stockCheckTestChips, '8801019606557'),
                  TestScan(l10n.tsUnknownProduct, '0000000000000'),
                ],
                onScan: (c) {
                  setState(() => _code = c.trim());
                  return const ScanFeedback.ok();
                },
              ),
            ),
            Expanded(
              child: code == null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          l10n.stockCheckIdle,
                          key: const ValueKey('stock-check-idle'),
                          textAlign: TextAlign.center,
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                    )
                  : UiStateView<StockCheckResult>(
                      state: uiStateOf(ref.watch(stockCheckProvider(code))),
                      onRetry: () => ref.invalidate(stockCheckProvider(code)),
                      ready: (context, r) => switch (r) {
                        UnknownProduct(:final code) => Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                              l10n.stockCheckUnknown(code),
                              key: const ValueKey('stock-check-unknown'),
                              textAlign: TextAlign.center,
                              style: theme.textTheme.titleMedium,
                            ),
                          ),
                        ),
                        StockFound(:final view) => _StockResult(view: view),
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StockResult extends ConsumerWidget {
  const _StockResult({required this.view});

  final StockView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final name = ref.watch(productHintsProvider).bySku(view.sku)?.name;
    String n(int? v) => v == null ? '—' : l10n.qtyUnit(v);
    return ListView(
      key: const ValueKey('stock-check-result'),
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      children: [
        Text(name ?? view.sku, style: theme.textTheme.titleLarge),
        if (name != null)
          Text(
            view.sku,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        const SizedBox(height: 12),
        if (view.isEmpty)
          Text(
            l10n.stockCheckNone,
            key: const ValueKey('stock-check-none'),
            style: theme.textTheme.titleMedium,
          ),
        for (final lot in view.lots)
          Card(
            key: ValueKey('stock-lot-${lot.lotId}'),
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(lot.lotId, style: theme.textTheme.titleMedium),
                  if (lot.expiryDate != null)
                    Text(l10n.stockCheckExpiry(lot.expiryDate!)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 16,
                    runSpacing: 4,
                    children: [
                      Text('${l10n.stockCheckOnHand} ${n(lot.onHand)}'),
                      Text('${l10n.stockCheckAvailable} ${n(lot.available)}'),
                      Text('${l10n.stockCheckReserved} ${n(lot.reserved)}'),
                      Text(
                        '${l10n.stockCheckQuarantined} ${n(lot.quarantined)}',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        if (view.lines.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(l10n.stockCheckByLocation, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          for (final line in view.lines)
            Padding(
              key: ValueKey('stock-line-${line.locationCode}-${line.lotId}'),
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          line.locationCode,
                          style: theme.textTheme.titleMedium,
                        ),
                        if (ShelfCode.parse(line.locationCode) != null) ...[
                          const SizedBox(height: 4),
                          LocationBlocks(code: line.locationCode, height: 32),
                        ],
                        const SizedBox(height: 4),
                        Text(
                          '${line.lotId} · '
                          '${qualityStateText(l10n, line.qualityState)} · '
                          '${workStateText(l10n, line.workState)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: line.qualityState == 'NORMAL'
                                ? scheme.onSurfaceVariant
                                : scheme.error,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    l10n.qtyUnit(line.qty),
                    style: theme.textTheme.titleLarge,
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}
