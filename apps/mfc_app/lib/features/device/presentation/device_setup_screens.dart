import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../router.dart' show afterLoginProvider;
import '../../../shared/field_widgets.dart' show StepCaption;
import '../../../shared/menu_tile.dart';
import '../../../shared/printer/label_printer.dart';
import '../../../shared/providers.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';

/// 기기 설정(시작 메뉴 → 기기 설정, 사용자 2026-11-17). 로그인 없이 연다.
/// 모양은 메인의 업무 고르기 목록과 같다([MenuTile]).
class DeviceSetupScreen extends ConsumerWidget {
  const DeviceSetupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    final printer = ref.watch(printerSettingsProvider).value;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.setupTitle),
        actions: [
          if (mock)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Chip(label: Text(l10n.mockModeBadge)),
            ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final tile in [
                MenuTile(
                  key: const ValueKey('setup-printer'),
                  icon: Icons.print_outlined,
                  title: l10n.setupPrinter,
                  hint: printer == null
                      ? null
                      : printer.mode == PrinterMode.networkZpl
                      ? l10n.setupPrinterNetwork(printer.host, printer.port)
                      : l10n.setupPrinterPreview,
                  onTap: () => context.push('/setup/printer'),
                ),
                MenuTile(
                  key: const ValueKey('setup-scanner'),
                  icon: Icons.qr_code_scanner,
                  title: l10n.setupScanner,
                  hint: l10n.setupScannerHint,
                  onTap: () => context.push('/setup/scanner'),
                ),
                MenuTile(
                  key: const ValueKey('setup-device'),
                  icon: Icons.smartphone_outlined,
                  title: l10n.setupDevice,
                  hint: l10n.setupDeviceHint,
                  onTap: () => context.push('/setup/device'),
                ),
              ])
                // 시작 메뉴와 같은 높이(96) — 늘려 채우지 않는다.
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: SizedBox(height: StartScreen.tileHeight, child: tile),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 앱 시작 메뉴(로그인 전, 사용자 2026-11-17) — 로그인 · 기기 설정 · 재고 확인.
/// 모양은 메인의 업무 고르기 목록과 같다([MenuTile]). 재고 확인은 로그인이 필요해 누르면 로그인 화면 →
/// 로그인되면 바로 재고 확인으로 간다.
class StartScreen extends ConsumerWidget {
  const StartScreen({super.key});

  static const tileHeight = 96.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    final tiles = [
      MenuTile(
        key: const ValueKey('start-login'),
        icon: Icons.login,
        title: l10n.startLogin,
        hint: l10n.startLoginHint,
        onTap: () {
          ref.read(afterLoginProvider.notifier).set(null);
          context.push('/login');
        },
      ),
      MenuTile(
        key: const ValueKey('start-setup'),
        icon: Icons.settings_outlined,
        title: l10n.setupTitle,
        hint: l10n.startSetupHint,
        onTap: () => context.push('/setup'),
      ),
      MenuTile(
        key: const ValueKey('start-stock'),
        icon: Icons.manage_search,
        title: l10n.stockCheckTitle,
        hint: '${l10n.startStockHint} · ${l10n.startNeedsLogin}',
        onTap: () {
          ref.read(afterLoginProvider.notifier).set('/stock-check');
          context.push('/login');
        },
      ),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.homeTitle),
        actions: [
          if (mock)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Chip(label: Text(l10n.mockModeBadge)),
            ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          children: [
            StepCaption(l10n.startChoose),
            const SizedBox(height: 8),
            for (final tile in tiles)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SizedBox(height: tileHeight, child: tile),
              ),
          ],
        ),
      ),
    );
  }
}

/// 스캐너 확인 — 찍은 값을 그대로 보인다(서버로 보내지 않는다).
class ScannerCheckScreen extends StatefulWidget {
  const ScannerCheckScreen({super.key});

  @override
  State<ScannerCheckScreen> createState() => _ScannerCheckScreenState();
}

class _ScannerCheckScreenState extends State<ScannerCheckScreen> {
  String? _last;
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.scannerCheckTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            ScanInput(
              id: 'scanner-check',
              label: l10n.scannerCheckLabel,
              cameraTitle: l10n.scannerCheckLabel,
              testValues: const [TestScan('8801115114154', '8801115114154')],
              onScan: (code) {
                setState(() {
                  _last = code;
                  _count++;
                });
                return const ScanFeedback.ok();
              },
            ),
            const SizedBox(height: 24),
            if (_last == null)
              Text(
                l10n.scannerCheckEmpty,
                key: const ValueKey('scanner-check-empty'),
                style: theme.textTheme.bodyLarge,
              )
            else ...[
              Text(l10n.scannerCheckLast, style: theme.textTheme.labelLarge),
              SelectableText(
                _last!,
                key: const ValueKey('scanner-check-value'),
                style: theme.textTheme.headlineSmall,
              ),
              Text(l10n.scannerCheckCount(_count)),
            ],
          ],
        ),
      ),
    );
  }
}

/// 기기 정보 — 문의할 때 알려 줄 값.
class DeviceInfoScreen extends ConsumerWidget {
  const DeviceInfoScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.deviceInfoTitle)),
      body: SafeArea(
        child: ListView(
          children: [
            ListTile(
              title: Text(l10n.deviceInfoId),
              subtitle: FutureBuilder<String>(
                future: ref.watch(deviceIdProvider).get(),
                builder: (_, s) => SelectableText(
                  s.data ?? '…',
                  key: const ValueKey('device-id'),
                ),
              ),
            ),
            ListTile(
              title: Text(l10n.deviceInfoMode),
              subtitle: Text(
                mock ? l10n.deviceInfoModeMock : l10n.deviceInfoModeLocal,
                key: const ValueKey('device-mode'),
              ),
            ),
            if (!mock)
              ListTile(
                title: Text(l10n.deviceInfoServer),
                subtitle: Text(ref.watch(apiBaseUrlProvider)),
              ),
          ],
        ),
      ),
    );
  }
}
