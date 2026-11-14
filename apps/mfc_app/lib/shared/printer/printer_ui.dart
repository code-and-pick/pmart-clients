import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../l10n/gen/app_localizations.dart';
import '../ui_state_of.dart';
import 'label.dart';
import 'label_printer.dart';

/// 라벨을 출력하고 결과를 알린다. 미리보기 모드면 화면에 라벨을 띄운다.
Future<void> printPackageLabel(
  BuildContext context,
  WidgetRef ref,
  PackageLabel label,
) => printLabel(context, ref, label);

/// 라벨(포장·상품 바코드)을 출력하고 결과를 알린다. [sentText] 는 프린터로 보낸 뒤의 안내(없으면 공통 문구).
Future<void> printLabel(
  BuildContext context,
  WidgetRef ref,
  PrintableLabel label, {
  String? sentText,
}) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final outcome = await ref.read(labelPrintServiceProvider).print(label);
  if (!context.mounted) return;
  switch (outcome) {
    case PrintPreview(:final label):
      await showDialog<void>(
        context: context,
        builder: (_) => switch (label) {
          final ProductBarcodeLabel p => ProductBarcodePreviewDialog(label: p),
          final PackageLabel p => LabelPreviewDialog(label: p),
          _ => const SizedBox.shrink(),
        },
      );
    case PrintSent():
      messenger.showSnackBar(
        SnackBar(content: Text(sentText ?? l10n.printSent)),
      );
    case PrintFailed(:final reason):
      messenger.showSnackBar(
        SnackBar(
          content: Text(switch (reason) {
            PrintFailure.notConfigured => l10n.printNotConfigured,
            PrintFailure.unreachable => l10n.printUnreachable,
          }),
          action: SnackBarAction(
            label: l10n.printerSettingsTitle,
            onPressed: () => context.push('/settings/printer'),
          ),
        ),
      );
  }
}

/// 프린터가 없을 때 쓰는 라벨 미리보기.
class LabelPreviewDialog extends StatelessWidget {
  const LabelPreviewDialog({super.key, required this.label});

  final PackageLabel label;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return AlertDialog(
      key: const ValueKey('label-preview'),
      title: Text(l10n.labelPreviewTitle),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // QR 이미지는 그리지 않는다(QR 렌더링 패키지 미승인). 원문만 보인다.
            SelectableText(
              label.qrCode,
              key: const ValueKey('label-qr-text'),
              style: theme.textTheme.titleMedium?.copyWith(
                fontFamily: 'monospace',
              ),
            ),
            const Divider(),
            Text(label.packageId, style: theme.textTheme.headlineSmall),
            Text('v${label.packageVersion}'),
            if (label.orderId != null) Text(l10n.hoOrder(label.orderId!)),
            if (label.deliveryId != null)
              Text(l10n.labelDelivery(label.deliveryId!)),
            if (label.temperatureZone != null)
              Text(
                label.temperatureZone!,
                style: theme.textTheme.headlineMedium,
              ),
            if (label.bagCount != null) Text(l10n.labelBags(label.bagCount!)),
            const SizedBox(height: 12),
            Text(l10n.labelPreviewNote, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.confirmOk),
        ),
      ],
    );
  }
}

/// 프린터가 없을 때 쓰는 상품 바코드 스티커 미리보기.
class ProductBarcodePreviewDialog extends StatelessWidget {
  const ProductBarcodePreviewDialog({super.key, required this.label});

  final ProductBarcodeLabel label;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return AlertDialog(
      key: const ValueKey('barcode-label-preview'),
      title: Text(l10n.labelPreviewTitle),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // 바코드 그림은 그리지 않는다(렌더링 패키지 미승인). 원문만 보인다.
          SelectableText(
            label.barcode,
            key: const ValueKey('barcode-label-text'),
            style: theme.textTheme.headlineSmall?.copyWith(
              fontFamily: 'monospace',
            ),
          ),
          const Divider(),
          if (label.productName != null)
            Text(label.productName!, style: theme.textTheme.titleMedium),
          Text(l10n.reprintSku(label.sku)),
          const SizedBox(height: 12),
          Text(l10n.labelPreviewNote, style: theme.textTheme.bodySmall),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.confirmOk),
        ),
      ],
    );
  }
}

/// 프린터 설정(포장대 고정형 네트워크 라벨 프린터).
class PrinterSettingsScreen extends ConsumerWidget {
  const PrinterSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.printerSettingsTitle)),
      body: UiStateView<PrinterSettings>(
        state: uiStateOf(ref.watch(printerSettingsProvider)),
        onRetry: () => ref.invalidate(printerSettingsProvider),
        ready: (context, s) => _PrinterSettingsForm(initial: s),
      ),
    );
  }
}

class _PrinterSettingsForm extends ConsumerStatefulWidget {
  const _PrinterSettingsForm({required this.initial});

  final PrinterSettings initial;

  @override
  ConsumerState<_PrinterSettingsForm> createState() =>
      _PrinterSettingsFormState();
}

class _PrinterSettingsFormState extends ConsumerState<_PrinterSettingsForm> {
  late PrinterMode _mode = widget.initial.mode;
  late final _host = TextEditingController(text: widget.initial.host);
  late final _port = TextEditingController(text: '${widget.initial.port}');

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    super.dispose();
  }

  /// 네트워크 모드면 주소·포트가 맞아야 한다. 미리보기 모드는 입력값을 그대로 남긴다.
  PrinterSettings? _value() {
    final port = int.tryParse(_port.text.trim());
    final s = PrinterSettings(
      mode: _mode,
      host: _host.text.trim(),
      port: port ?? PrinterSettings.defaultPort,
    );
    if (_mode == PrinterMode.networkZpl && (port == null || !s.networkReady)) {
      return null;
    }
    return s;
  }

  Future<bool> _save() async {
    final l10n = AppLocalizations.of(context);
    // 앞 안내가 줄 서 있지 않게 바로 바꾼다.
    final messenger = ScaffoldMessenger.of(context)..hideCurrentSnackBar();
    final v = _value();
    if (v == null) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.printerInvalid)));
      return false;
    }
    await ref.read(printerSettingsProvider.notifier).save(v);
    messenger.showSnackBar(SnackBar(content: Text(l10n.printerSaved)));
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final network = _mode == PrinterMode.networkZpl;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<PrinterMode>(
          segments: [
            ButtonSegment(
              value: PrinterMode.preview,
              label: Text(l10n.printerModePreview),
            ),
            ButtonSegment(
              value: PrinterMode.networkZpl,
              label: Text(l10n.printerModeNetwork),
            ),
          ],
          selected: {_mode},
          onSelectionChanged: (v) => setState(() => _mode = v.first),
        ),
        const SizedBox(height: 8),
        Text(network ? l10n.printerNetworkHelp : l10n.printerPreviewHelp),
        if (network) ...[
          TextField(
            key: const ValueKey('printer-host'),
            controller: _host,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(labelText: l10n.printerHost),
          ),
          TextField(
            key: const ValueKey('printer-port'),
            controller: _port,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l10n.printerPort),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          key: const ValueKey('printer-save'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
          onPressed: _save,
          child: Text(l10n.printerSave),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const ValueKey('printer-test'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(56),
          ),
          onPressed: () async {
            if (!await _save() || !context.mounted) return;
            // 시험 라벨. 실제 포장 ID 가 아니다.
            await printPackageLabel(
              context,
              ref,
              const PackageLabel(
                packageId: 'TEST-LABEL',
                packageVersion: 1,
                qrCode: 'PKG:TEST-LABEL:1',
                orderId: 'TEST',
                temperatureZone: 'CHILLED',
                bagCount: 1,
              ),
            );
          },
          child: Text(l10n.printerTestPrint),
        ),
      ],
    );
  }
}
