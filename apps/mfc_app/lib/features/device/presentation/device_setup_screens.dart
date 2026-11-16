import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../router.dart' show afterLoginProvider;
import '../../../shared/menu_tile.dart';
import '../../../shared/printer/label_printer.dart';
import '../../../shared/providers.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../data/server_address.dart';

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
                  key: const ValueKey('setup-network'),
                  icon: Icons.wifi,
                  title: l10n.setupNetwork,
                  hint: mock
                      ? l10n.setupNetworkMock
                      : ref.watch(apiBaseUrlProvider),
                  onTap: () => context.push('/setup/network'),
                ),
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
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: tile,
                  ),
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

  static const _tileHeight = 96.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
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
            Text(l10n.startChoose, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final tile in tiles)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SizedBox(height: _tileHeight, child: tile),
              ),
          ],
        ),
      ),
    );
  }
}

/// 서버 주소 바꾸기·연결 확인.
class NetworkSettingsScreen extends ConsumerStatefulWidget {
  const NetworkSettingsScreen({super.key});

  @override
  ConsumerState<NetworkSettingsScreen> createState() =>
      _NetworkSettingsScreenState();
}

class _NetworkSettingsScreenState extends ConsumerState<NetworkSettingsScreen> {
  late final _address = TextEditingController(
    text: ref.read(serverAddressProvider) ?? '',
  );
  bool _invalid = false;
  bool _checking = false;
  ProbeResult? _probe;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  /// 저장하지 않았을 때 쓰는 빌드 기본 주소. 목 모드는 서버를 안 쓰니 실서버 빌드의 기본값을 보인다.
  String get _buildDefault => defaultApiBaseUrl(PmartEnv.local);

  String get _current => ref.read(serverAddressProvider) ?? _buildDefault;

  Future<void> _save() async {
    final v = normalizeServerAddress(_address.text);
    if (v == null) {
      setState(() => _invalid = true);
      return;
    }
    await ref.read(serverAddressProvider.notifier).save(v);
    if (!mounted) return;
    _address.text = v;
    setState(() {
      _invalid = false;
      _probe = null;
    });
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).networkSaved)),
      );
  }

  Future<void> _reset() async {
    await ref.read(serverAddressProvider.notifier).save(null);
    if (!mounted) return;
    _address.clear();
    setState(() {
      _invalid = false;
      _probe = null;
    });
  }

  Future<void> _check() async {
    setState(() {
      _checking = true;
      _probe = null;
    });
    final r = await ref.read(serverProbeProvider)(Uri.parse(_current));
    if (mounted) {
      setState(() {
        _checking = false;
        _probe = r;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    final saved = ref.watch(serverAddressProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.networkTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (mock) ...[
              Text(
                l10n.networkMockNote,
                key: const ValueKey('network-mock-note'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
            ],
            Text(l10n.networkCurrent, style: theme.textTheme.labelLarge),
            Text(
              saved ??
                  '$_buildDefault '
                      '${l10n.networkDefault}',
              key: const ValueKey('network-current'),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 24),
            TextField(
              key: const ValueKey('network-address'),
              controller: _address,
              keyboardType: TextInputType.url,
              autocorrect: false,
              enableSuggestions: false,
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                labelText: l10n.networkAddressLabel,
                hintText: l10n.networkAddressHint,
                prefixIcon: const Icon(Icons.dns_outlined),
                border: const OutlineInputBorder(),
                errorText: _invalid ? l10n.networkAddressInvalid : null,
              ),
              onChanged: (_) {
                if (_invalid) setState(() => _invalid = false);
              },
              onSubmitted: (_) => _save(),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const ValueKey('network-reset'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(56),
                    ),
                    onPressed: saved == null ? null : _reset,
                    child: Text(l10n.networkReset),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    key: const ValueKey('network-save'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(56),
                    ),
                    onPressed: _save,
                    child: Text(l10n.networkSave),
                  ),
                ),
              ],
            ),
            const Divider(height: 40),
            FilledButton.tonalIcon(
              key: const ValueKey('network-check'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(56),
              ),
              onPressed: _checking ? null : _check,
              icon: _checking
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.network_check),
              label: Text(_checking ? l10n.networkChecking : l10n.networkCheck),
            ),
            if (_probe case final p?) ...[
              const SizedBox(height: 12),
              Row(
                key: ValueKey('network-probe-${p.name}'),
                children: [
                  Icon(
                    p == ProbeResult.reachable
                        ? Icons.check_circle
                        : Icons.error_outline,
                    color: p == ProbeResult.reachable
                        ? scheme.primary
                        : scheme.error,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(switch (p) {
                      ProbeResult.reachable => l10n.networkReachable,
                      ProbeResult.unreachable => l10n.networkUnreachable,
                      ProbeResult.unsupported => l10n.networkUnsupported,
                    }),
                  ),
                ],
              ),
            ],
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
