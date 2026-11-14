import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/gen/app_localizations.dart';
import '../product_hints.dart';
import 'label.dart';
import 'printer_ui.dart';

/// 그 스캔 자리에서 찍을 수 있는 상품 — 바코드가 안 찍힐 때 다시 뽑을 후보.
/// [name]·[barcode] 를 화면이 모르면 비워 둔다. 그러면 상품 정보([productHintsProvider])에서 찾는다.
@immutable
class ReprintTarget {
  const ReprintTarget({required this.sku, this.name, this.barcode});

  final String sku;
  final String? name;
  final String? barcode;
}

/// "바코드가 안 찍혀요" — 상품 바코드 스티커를 사내 라벨 프린터로 다시 뽑는다(사용자 2026-11-14).
///
/// - 후보가 여럿이면 먼저 고른다. 작업자가 **실물이 이 상품이 맞는지** 확인해야 뽑는다(작업자 확인만 —
///   관리자 승인·서버 기록 없음, 사용자 2026-11-14. 계약에 재출력 API 가 없다).
/// - 값은 서버(목)가 준 그 상품의 바코드 그대로다. 바코드를 모르면 뽑지 않고 그렇게 알린다.
/// - 뽑은 스티커를 붙이고 다시 찍으면 화면은 평소 스캔과 같이 처리한다 — 재출력은 실적이 아니다.
class BarcodeReprintButton extends ConsumerWidget {
  const BarcodeReprintButton({
    super.key,
    required this.id,
    required this.targets,
  });

  /// 버튼 키는 `ValueKey('$id-reprint')`.
  final String id;
  final List<ReprintTarget> targets;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton.icon(
        key: ValueKey('$id-reprint'),
        icon: const Icon(Icons.print_outlined),
        label: Text(l10n.reprintButton),
        onPressed: targets.isEmpty ? null : () => _start(context, ref),
      ),
    );
  }

  Future<void> _start(BuildContext context, WidgetRef ref) async {
    final hints = ref.read(productHintsProvider);
    final resolved = [
      for (final t in targets)
        ReprintTarget(
          sku: t.sku,
          name: t.name ?? hints.bySku(t.sku)?.name,
          barcode: t.barcode ?? hints.bySku(t.sku)?.barcode,
        ),
    ];
    final picked = resolved.length == 1
        ? resolved.first
        : await showDialog<ReprintTarget>(
            context: context,
            builder: (_) => _PickDialog(targets: resolved),
          );
    if (picked == null || !context.mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _ConfirmDialog(target: picked),
    );
    if (ok != true || !context.mounted) return;
    await printLabel(
      context,
      ref,
      ProductBarcodeLabel(
        sku: picked.sku,
        barcode: picked.barcode!,
        productName: picked.name,
      ),
      sentText: AppLocalizations.of(context).reprintSent,
    );
  }
}

class _PickDialog extends StatelessWidget {
  const _PickDialog({required this.targets});

  final List<ReprintTarget> targets;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SimpleDialog(
      key: const ValueKey('reprint-pick'),
      title: Text(l10n.reprintPickTitle),
      children: [
        for (final t in targets)
          SimpleDialogOption(
            key: ValueKey('reprint-pick-${t.sku}'),
            onPressed: () => Navigator.of(context).pop(t),
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(t.name ?? t.sku),
              subtitle: Text(l10n.reprintSku(t.sku)),
            ),
          ),
      ],
    );
  }
}

class _ConfirmDialog extends StatelessWidget {
  const _ConfirmDialog({required this.target});

  final ReprintTarget target;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final barcode = target.barcode;
    return AlertDialog(
      key: const ValueKey('reprint-confirm'),
      title: Text(
        barcode == null ? l10n.reprintNoBarcodeTitle : l10n.reprintConfirmTitle,
      ),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            target.name ?? target.sku,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(l10n.reprintSku(target.sku)),
          if (barcode != null) Text(l10n.reprintBarcode(barcode)),
          const SizedBox(height: 12),
          Text(
            barcode == null ? l10n.reprintNoBarcode : l10n.reprintConfirmBody,
          ),
        ],
      ),
      actions: barcode == null
          ? [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: Text(l10n.confirmOk),
              ),
            ]
          : [
              TextButton(
                key: const ValueKey('reprint-no'),
                onPressed: () => Navigator.of(context).pop(false),
                child: Text(l10n.reprintNotThis),
              ),
              FilledButton(
                key: const ValueKey('reprint-yes'),
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(l10n.reprintYes),
              ),
            ],
    );
  }
}
