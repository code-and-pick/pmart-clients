import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/codes.dart';
import '../../../shared/field_outcome.dart';
import '../../../shared/field_repositories.dart';
import '../../../shared/field_widgets.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../stock_count/data/mock_stock_count_repository.dart';
import '../../stock_count/domain/stock_count.dart';
import '../../tasks/presentation/task_controllers.dart';

/// 센터 관리자 실사(사용자 2026-11-16): 시작(칸만 — 실사 잠금은 서버 판정, R14 대기), 차이 승인·반려(승인 번호 직접 입력).
/// 실사 목록 API 가 없어(MB-1) 실사 번호로 찾고, 이 기기에서 시작한 실사를 기억해 보인다.

/// 이 기기에서 시작·연 실사 번호(앱을 끄면 사라진다 — 목록 API 가 생기면 바꾼다).
final recentCountsProvider = NotifierProvider<RecentCounts, List<String>>(
  RecentCounts.new,
);

class RecentCounts extends Notifier<List<String>> {
  @override
  List<String> build() => switch (ref.watch(stockCountRepositoryProvider)) {
    final MockStockCountRepository m => m.sessionIds.toList(),
    _ => const [],
  };

  void add(String id) {
    if (!state.contains(id)) state = [id, ...state];
  }
}

final countSessionProvider = FutureProvider.autoDispose
    .family<CountSessionView, String>(
      (ref, id) => ref
          .watch(stockCountRepositoryProvider)
          .session(ref.watch(currentMfcIdProvider), id),
    );

String countStateText(AppLocalizations l10n, CountState s) => switch (s) {
  CountState.counting => l10n.countStateCounting,
  CountState.recountRequired => l10n.countRecountRequired,
  CountState.pendingApproval => l10n.countPendingApproval,
  CountState.matched => l10n.countMatched,
  CountState.adjusted => l10n.countAdjusted,
  CountState.rejected => l10n.countRejected,
  CountState.unknown => l10n.tsUnknown,
};

String countRejectText(AppLocalizations l10n, String code) => switch (code) {
  CountProblemCode.selfApproval => l10n.countSelfApproval,
  CountProblemCode.approvalRequired => l10n.countApprovalRequired,
  CountProblemCode.bookChanged => l10n.countBookChanged,
  CountProblemCode.locationNotLocked => l10n.countNotLocked,
  CountProblemCode.countInProgress => l10n.countInProgressElsewhere,
  _ => fieldRejectedText(l10n, code),
};

// ───────────────────────── 찾기·목록 ─────────────────────────

class CountAdminScreen extends ConsumerWidget {
  const CountAdminScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final recent = ref.watch(recentCountsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.manageCounts)),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('new-count'),
        onPressed: () => context.push('/manage/counts/new'),
        icon: const Icon(Icons.add),
        label: Text(l10n.countStartTitle),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          ScanInput(
            id: 'count-find',
            label: l10n.countFindHint,
            cameraTitle: l10n.manageCounts,
            continuous: false,
            autofocus: false,
            testValues: [for (final id in recent.take(2)) TestScan(id, id)],
            onScan: (code) {
              final id = code.trim();
              if (id.isEmpty) return ScanFeedback.error(l10n.countFindHint);
              ref.read(recentCountsProvider.notifier).add(id);
              context.push('/manage/counts/${Uri.encodeComponent(id)}');
              return const ScanFeedback.ok();
            },
          ),
          const SizedBox(height: 16),
          Text(l10n.countRecent, style: theme.textTheme.titleMedium),
          if (recent.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                l10n.countRecentEmpty,
                key: const ValueKey('count-recent-empty'),
              ),
            ),
          for (final id in recent)
            Card(
              child: ListTile(
                key: ValueKey('count-recent-$id'),
                title: Text(id),
                trailing: const Icon(Icons.chevron_right),
                onTap: () =>
                    context.push('/manage/counts/${Uri.encodeComponent(id)}'),
              ),
            ),
        ],
      ),
    );
  }
}

// ───────────────────────── 시작 ─────────────────────────

class StartCountScreen extends ConsumerStatefulWidget {
  const StartCountScreen({super.key});

  @override
  ConsumerState<StartCountScreen> createState() => _StartCountScreenState();
}

class _StartCountScreenState extends ConsumerState<StartCountScreen> {
  final _locations = <String>[];
  final _reason = TextEditingController();
  IdempotencyKey? _key;
  bool _busy = false;
  bool _unknown = false;
  String? _code;

  static const _max = 50;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  ScanFeedback _scan(String code) {
    final l10n = AppLocalizations.of(context);
    final c = code.trim();
    if (_unknown) return ScanFeedback.error(l10n.countStartUnknown);
    if (!isMfcLocation(c) || isCartLocation(c)) {
      return ScanFeedback.error(l10n.moveNotLocation);
    }
    if (_locations.contains(c)) return const ScanFeedback.ok();
    if (_locations.length >= _max) {
      return ScanFeedback.error(l10n.countTooMany(_max));
    }
    setState(() {
      _locations.add(c);
      _code = null;
    });
    return const ScanFeedback.ok();
  }

  Future<void> _start() async {
    if (_busy || _locations.isEmpty) return;
    setState(() {
      _busy = true;
      _code = null;
    });
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await ref
        .read(stockCountRepositoryProvider)
        .start(
          ref.read(currentMfcIdProvider),
          locationCodes: List.of(_locations),
          reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
          key: key,
        );
    if (!mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        ref.read(recentCountsProvider.notifier).add(value.sessionId);
        context.pushReplacement(
          '/manage/counts/${Uri.encodeComponent(value.sessionId)}',
        );
      case FieldRejected(:final code):
        _key = null;
        setState(() {
          _busy = false;
          _unknown = false;
          _code = code;
        });
      case FieldUnknown():
        setState(() {
          _busy = false;
          _unknown = true;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.countStartTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l10n.countStartHelp),
          const SizedBox(height: 8),
          ScanInput(
            id: 'count-start-loc',
            label: l10n.countStartScan,
            cameraTitle: l10n.countStartTitle,
            testValues: [
              TestScan(l10n.tsLocation, 'A-S3-01-1-11'),
              TestScan(l10n.tsLocation, 'C-S1-02-2-06'),
              TestScan(l10n.tsWrong, 'hello'),
            ],
            onScan: _scan,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final loc in _locations)
                InputChip(
                  key: ValueKey('count-start-$loc'),
                  label: Text(loc),
                  onDeleted: _busy || _unknown
                      ? null
                      : () => setState(() => _locations.remove(loc)),
                ),
            ],
          ),
          TextField(
            key: const ValueKey('count-start-reason'),
            controller: _reason,
            enabled: !_busy && !_unknown,
            maxLength: 200,
            decoration: InputDecoration(labelText: l10n.countStartReason),
          ),
          if (_code case final c?)
            Text(
              countRejectText(l10n, c),
              key: const ValueKey('count-start-rejected'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          if (_unknown)
            Text(
              l10n.countStartUnknown,
              key: const ValueKey('count-start-unknown'),
            ),
          const SizedBox(height: 12),
          CommandButton(
            key: const ValueKey('count-start-submit'),
            busy: _busy,
            label: _unknown
                ? l10n.checkAgain
                : l10n.countStartSubmit(_locations.length),
            onPressed: _locations.isEmpty ? null : _start,
          ),
        ],
      ),
    );
  }
}

// ───────────────────────── 상세·승인 ─────────────────────────

class CountSessionAdminScreen extends ConsumerStatefulWidget {
  const CountSessionAdminScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<CountSessionAdminScreen> createState() =>
      _CountSessionAdminScreenState();
}

class _CountSessionAdminScreenState
    extends ConsumerState<CountSessionAdminScreen> {
  final _ref = TextEditingController();
  final _note = TextEditingController();
  IdempotencyKey? _key;

  /// 결과를 모르는 결정 — 같은 키·같은 결정으로 다시 보낸다.
  bool? _pendingApprove;
  bool _busy = false;
  String? _code;
  CountSessionView? _decided;

  @override
  void dispose() {
    _ref.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _decide(bool approve) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _code = null;
    });
    final key = _key ??= IdempotencyKey.generate();
    _pendingApprove = approve;
    final outcome = await ref
        .read(stockCountRepositoryProvider)
        .decide(
          ref.read(currentMfcIdProvider),
          widget.sessionId,
          approve: approve,
          approvalRef: approve ? _ref.text.trim() : null,
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          key: key,
        );
    if (!mounted) return;
    setState(() {
      _busy = false;
      switch (outcome) {
        case FieldDone(:final value):
          _key = null;
          _pendingApprove = null;
          _decided = value;
        case FieldRejected(:final code):
          _key = null;
          _pendingApprove = null;
          _code = code;
        case FieldUnknown():
          break;
      }
    });
    if (outcome is FieldDone) {
      ref.invalidate(countSessionProvider(widget.sessionId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.sessionId),
        actions: [
          IconButton(
            key: const ValueKey('count-admin-refresh'),
            tooltip: l10n.sync,
            onPressed: () =>
                ref.invalidate(countSessionProvider(widget.sessionId)),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: UiStateView<CountSessionView>(
        state: uiStateOf(ref.watch(countSessionProvider(widget.sessionId))),
        onRetry: () => ref.invalidate(countSessionProvider(widget.sessionId)),
        ready: (context, loaded) => _body(context, _decided ?? loaded),
      ),
    );
  }

  Widget _body(BuildContext context, CountSessionView s) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final unknown = _pendingApprove != null && _key != null && !_busy;
    final pending = s.state == CountState.pendingApproval;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          countStateText(l10n, s.state),
          key: const ValueKey('count-admin-state'),
          style: theme.textTheme.headlineSmall,
        ),
        Text(l10n.countLocations(s.locationCodes.join(', '))),
        if (s.firstCounter case final c?) Text(l10n.countFirstCounter(c)),
        if (s.recounter case final c?) Text(l10n.countRecounter(c)),
        const SizedBox(height: 12),
        if (s.differences case final diffs?) ...[
          Text(l10n.countDifferences, style: theme.textTheme.titleMedium),
          for (final d in diffs)
            ListTile(
              key: ValueKey('count-diff-${d.line.key}'),
              contentPadding: EdgeInsets.zero,
              title: Text(
                '${d.line.productName ?? d.line.sku} · ${d.line.locationCode}',
              ),
              subtitle: Text(l10n.lot(d.line.lotId)),
              trailing: Text(
                l10n.countDiffLine(d.bookQty, d.countedQty, d.deltaQty),
                style: TextStyle(
                  color: d.deltaQty == 0 ? null : theme.colorScheme.error,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ] else
          // 계수 중에는 장부·차이를 보이지 않는다(서버도 주지 않는다).
          Text(l10n.countNoDiffYet, key: const ValueKey('count-no-diff')),
        if (pending) ...[
          const Divider(height: 32),
          TextField(
            key: const ValueKey('count-approval-ref'),
            controller: _ref,
            enabled: !_busy && !unknown,
            maxLength: 128,
            decoration: InputDecoration(
              labelText: l10n.countApprovalRef,
              helperText: l10n.countApprovalRefHelp,
            ),
            onChanged: (_) => setState(() {}),
          ),
          TextField(
            key: const ValueKey('count-approval-note'),
            controller: _note,
            enabled: !_busy && !unknown,
            maxLength: 500,
            decoration: InputDecoration(labelText: l10n.countApprovalNote),
          ),
          if (_code case final c?)
            Text(
              countRejectText(l10n, c),
              key: const ValueKey('count-decide-rejected'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          if (unknown)
            Text(
              l10n.countDecideUnknown,
              key: const ValueKey('count-decide-unknown'),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const ValueKey('count-reject'),
                  onPressed: _busy || (unknown && _pendingApprove!)
                      ? null
                      : () => _decide(false),
                  child: Text(
                    unknown && !_pendingApprove!
                        ? l10n.checkAgain
                        : l10n.countReject,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: const ValueKey('count-approve'),
                  onPressed:
                      _busy ||
                          (unknown && !_pendingApprove!) ||
                          _ref.text.trim().isEmpty
                      ? null
                      : () => _decide(true),
                  child: Text(
                    unknown && _pendingApprove!
                        ? l10n.checkAgain
                        : l10n.countApprove,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
