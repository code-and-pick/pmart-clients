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
import '../../../shared/providers.dart';
import '../../../shared/scanner/scan_input.dart';
import '../../../shared/scanner/scanner.dart';
import '../../../shared/ui_state_of.dart';
import '../../stock_move/data/mock_stock_move_repository.dart';
import '../../stock_move/domain/stock_move.dart';
import '../../tasks/presentation/task_controllers.dart';
import '../data/move_admin_repository.dart';

final moveAdminRepositoryProvider = Provider<MoveAdminRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockMoveAdminRepository(
      moves: switch (ref.watch(stockMoveRepositoryProvider)) {
        final MockStockMoveRepository m => m,
        _ => MockStockMoveRepository(),
      },
    ),
    PmartEnv.local => ApiMoveAdminRepository(ref.watch(dioProvider)),
  },
);

final activeMovesProvider = FutureProvider.autoDispose<List<MoveOrderView>>(
  (ref) => ref
      .watch(moveAdminRepositoryProvider)
      .activeMoves(ref.watch(currentMfcIdProvider)),
);

// ───────────────────────── 목록·취소 ─────────────────────────

/// 진행 중 이동·보충 지시(센터 관리자). 새 지시, 취소(사유 필수).
class MoveOrdersScreen extends ConsumerStatefulWidget {
  const MoveOrdersScreen({super.key});

  @override
  ConsumerState<MoveOrdersScreen> createState() => _MoveOrdersScreenState();
}

class _MoveOrdersScreenState extends ConsumerState<MoveOrdersScreen> {
  /// 결과를 모르는 취소는 같은 키로 다시 보낸다(지시마다).
  final _cancelKeys = <String, IdempotencyKey>{};
  final _cancelReasons = <String, String>{};
  String? _busy;

  Future<void> _cancel(MoveOrderView m) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final reason =
        _cancelReasons[m.moveId] ??
        await showDialog<String>(
          context: context,
          builder: (_) => const _ReasonDialog(),
        );
    if (reason == null || reason.trim().isEmpty || !mounted) return;
    setState(() => _busy = m.moveId);
    final key = _cancelKeys[m.moveId] ??= IdempotencyKey.generate();
    _cancelReasons[m.moveId] = reason.trim();
    final outcome = await ref
        .read(moveAdminRepositoryProvider)
        .cancel(m.moveId, reason: reason.trim(), key: key);
    if (!mounted) return;
    setState(() => _busy = null);
    final String text;
    switch (outcome) {
      case FieldDone(:final value):
        _cancelKeys.remove(m.moveId);
        _cancelReasons.remove(m.moveId);
        text = value.state == MoveState.cancelPending
            ? l10n.moveCancelPendingDone
            : l10n.moveCancelled;
        ref.invalidate(activeMovesProvider);
      case FieldRejected(:final code):
        _cancelKeys.remove(m.moveId);
        _cancelReasons.remove(m.moveId);
        text = fieldRejectedText(l10n, code);
      case FieldUnknown():
        text = l10n.moveCancelUnknown;
    }
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.manageMoves),
        actions: [
          IconButton(
            key: const ValueKey('manage-moves-refresh'),
            tooltip: l10n.sync,
            onPressed: () => ref.invalidate(activeMovesProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('new-move'),
        // 지시가 되면 새 지시 화면이 목록을 새로 부른다.
        onPressed: () => context.push('/manage/moves/new'),
        icon: const Icon(Icons.add),
        label: Text(l10n.moveNew),
      ),
      body: UiStateView<List<MoveOrderView>>(
        state: uiStateOf(
          ref.watch(activeMovesProvider),
          isEmpty: (l) => l.isEmpty,
        ),
        onRetry: () => ref.invalidate(activeMovesProvider),
        empty: (_) => Center(
          child: Text(
            l10n.moveNoActive,
            key: const ValueKey('manage-moves-empty'),
          ),
        ),
        ready: (context, moves) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            for (final m in moves)
              _MoveCard(
                move: m,
                busy: _busy == m.moveId,
                unknown: _cancelKeys.containsKey(m.moveId),
                onCancel: m.state == MoveState.active ? () => _cancel(m) : null,
              ),
          ],
        ),
      ),
    );
  }
}

class _MoveCard extends StatelessWidget {
  const _MoveCard({
    required this.move,
    required this.busy,
    required this.unknown,
    required this.onCancel,
  });

  final MoveOrderView move;
  final bool busy;
  final bool unknown;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final m = move;
    return Card(
      key: ValueKey('move-order-${m.moveId}'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  m.kind == MoveKind.replenish
                      ? l10n.moveKindReplenish
                      : l10n.moveKindMove,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (m.urgent) ...[
                  const SizedBox(width: 8),
                  Text(
                    l10n.urgent,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ],
                const Spacer(),
                if (m.state == MoveState.cancelPending)
                  Text(
                    l10n.moveStateCancelPending,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
              ],
            ),
            Text(m.productName ?? m.sku, style: theme.textTheme.bodyLarge),
            Text(l10n.moveRoute(m.fromLocation, m.toLocation)),
            Text(
              l10n.moveProgress(m.qty, m.pickedQty, m.droppedQty),
              style: theme.textTheme.bodySmall,
            ),
            if (onCancel != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  key: ValueKey('cancel-move-${m.moveId}'),
                  onPressed: busy ? null : onCancel,
                  child: Text(unknown ? l10n.checkAgain : l10n.moveCancel),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog();

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      key: const ValueKey('cancel-move-dialog'),
      title: Text(l10n.moveCancelTitle),
      content: TextField(
        key: const ValueKey('cancel-move-reason'),
        controller: _text,
        maxLength: 200,
        autofocus: true,
        decoration: InputDecoration(labelText: l10n.moveCancelReason),
        onChanged: (_) => setState(() {}),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const ValueKey('cancel-move-ok'),
          onPressed: _text.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop(_text.text.trim()),
          child: Text(l10n.moveCancel),
        ),
      ],
    );
  }
}

// ───────────────────────── 새 지시 ─────────────────────────

enum NewMovePhase { product, source, target, done }

@immutable
class NewMoveState {
  const NewMoveState({
    this.phase = NewMovePhase.product,
    this.loading = false,
    this.sku,
    this.units = const [],
    this.source,
    this.to,
    this.qty = 1,
    this.reason = '',
    this.urgent = false,
    this.busy = false,
    this.unknown = false,
    this.error,
    this.code,
    this.created,
  });

  final NewMovePhase phase;
  final bool loading;
  final String? sku;
  final List<StockUnit> units;
  final StockUnit? source;
  final String? to;
  final int qty;
  final String reason;
  final bool urgent;
  final bool busy;
  final bool unknown;

  /// 화면 안내(상품을 모름·재고 없음·도착 칸 잘못 등).
  final NewMoveError? error;

  /// 서버 거절 코드.
  final String? code;
  final MoveOrderView? created;

  NewMoveState copyWith({
    NewMovePhase? phase,
    bool? loading,
    String? Function()? sku,
    List<StockUnit>? units,
    StockUnit? Function()? source,
    String? Function()? to,
    int? qty,
    String? reason,
    bool? urgent,
    bool? busy,
    bool? unknown,
    NewMoveError? Function()? error,
    String? Function()? code,
    MoveOrderView? Function()? created,
  }) => NewMoveState(
    phase: phase ?? this.phase,
    loading: loading ?? this.loading,
    sku: sku != null ? sku() : this.sku,
    units: units ?? this.units,
    source: source != null ? source() : this.source,
    to: to != null ? to() : this.to,
    qty: qty ?? this.qty,
    reason: reason ?? this.reason,
    urgent: urgent ?? this.urgent,
    busy: busy ?? this.busy,
    unknown: unknown ?? this.unknown,
    error: error != null ? error() : this.error,
    code: code != null ? code() : this.code,
    created: created != null ? created() : this.created,
  );
}

enum NewMoveError {
  unknownProduct,
  noStock,
  loadFailed,
  notLocation,
  sameAsFrom,
}

final newMoveProvider =
    NotifierProvider.autoDispose<NewMoveController, NewMoveState>(
      NewMoveController.new,
    );

/// 새 이동 지시: 상품(바코드·SKU) → 출발(그 상품의 정상·보관 재고 칸·LOT 고르기) → 도착 칸 스캔 → 수량·사유 → 지시.
class NewMoveController extends Notifier<NewMoveState> {
  IdempotencyKey? _key;

  @override
  NewMoveState build() => const NewMoveState();

  MoveAdminRepository get _repo => ref.read(moveAdminRepositoryProvider);

  bool get _locked => state.busy || state.unknown;

  Future<void> scanProduct(String code) async {
    if (_locked) return;
    state = state.copyWith(loading: true, error: () => null, code: () => null);
    try {
      final sku = await _repo.resolveSku(code);
      if (!ref.mounted) return;
      if (sku == null) {
        state = state.copyWith(
          loading: false,
          error: () => NewMoveError.unknownProduct,
        );
        return;
      }
      final units = await _repo.movableStock(
        ref.read(currentMfcIdProvider),
        sku,
      );
      if (!ref.mounted) return;
      state = units.isEmpty
          ? state.copyWith(
              loading: false,
              sku: () => sku,
              units: const [],
              error: () => NewMoveError.noStock,
            )
          : state.copyWith(
              loading: false,
              phase: NewMovePhase.source,
              sku: () => sku,
              units: units,
              source: () => null,
              to: () => null,
            );
    } on PmartFailure {
      if (ref.mounted) {
        state = state.copyWith(
          loading: false,
          error: () => NewMoveError.loadFailed,
        );
      }
    }
  }

  void chooseSource(StockUnit u) {
    if (_locked) return;
    state = state.copyWith(
      phase: NewMovePhase.target,
      source: () => u,
      qty: u.qty,
      to: () => null,
      error: () => null,
    );
  }

  /// 도착 칸. 칸 형식만 본다 — 등록·용량·칸당 한 상품은 서버(mfc-inventory)가 판정한다.
  bool scanTarget(String code) {
    if (_locked) return false;
    final c = code.trim();
    final NewMoveError? err = !isMfcLocation(c) || isCartLocation(c)
        ? NewMoveError.notLocation
        : c == state.source?.locationCode
        ? NewMoveError.sameAsFrom
        : null;
    state = err == null
        ? state.copyWith(to: () => c, error: () => null)
        : state.copyWith(error: () => err);
    return err == null;
  }

  void setQty(int q) {
    if (!_locked) state = state.copyWith(qty: q);
  }

  void setReason(String r) {
    if (!_locked) state = state.copyWith(reason: r);
  }

  void setUrgent(bool u) {
    if (!_locked) state = state.copyWith(urgent: u);
  }

  /// 처음부터(다른 상품).
  void restart() {
    if (_locked) return;
    _key = null;
    state = const NewMoveState();
  }

  bool get canSubmit {
    final s = state;
    return s.unknown ||
        (s.sku != null &&
            s.source != null &&
            s.to != null &&
            s.qty >= 1 &&
            s.qty <= s.source!.qty);
  }

  Future<void> submit() async {
    final s = state;
    if (s.busy || !canSubmit) return;
    state = s.copyWith(busy: true, code: () => null);
    final key = _key ??= IdempotencyKey.generate();
    final outcome = await _repo.create(
      mfcId: ref.read(currentMfcIdProvider),
      sku: s.sku!,
      lotId: s.source!.lotId,
      fromLocation: s.source!.locationCode,
      toLocation: s.to!,
      qty: s.qty,
      reason: s.reason.trim().isEmpty ? null : s.reason.trim(),
      urgent: s.urgent,
      key: key,
    );
    if (!ref.mounted) return;
    switch (outcome) {
      case FieldDone(:final value):
        _key = null;
        state = state.copyWith(
          busy: false,
          unknown: false,
          phase: NewMovePhase.done,
          created: () => value,
        );
        ref.invalidate(activeMovesProvider);
      case FieldRejected(:final code):
        _key = null;
        state = state.copyWith(busy: false, unknown: false, code: () => code);
      case FieldUnknown():
        state = state.copyWith(busy: false, unknown: true);
    }
  }
}

String newMoveErrorText(AppLocalizations l10n, NewMoveError e) => switch (e) {
  NewMoveError.unknownProduct => l10n.newMoveUnknownProduct,
  NewMoveError.noStock => l10n.newMoveNoStock,
  NewMoveError.loadFailed => l10n.newMoveLoadFailed,
  NewMoveError.notLocation => l10n.moveNotLocation,
  NewMoveError.sameAsFrom => l10n.newMoveSameAsFrom,
};

class NewMoveScreen extends ConsumerWidget {
  const NewMoveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = ref.watch(newMoveProvider);
    final ctl = ref.read(newMoveProvider.notifier);
    final error = s.error;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.moveNew)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (s.phase == NewMovePhase.done) ...[
            const Icon(Icons.check_circle_outline, size: 64),
            Text(
              l10n.newMoveDone(s.created?.moveId ?? '-'),
              key: const ValueKey('new-move-done'),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge,
            ),
            if (s.created case final m?)
              Text(
                l10n.moveRoute(m.fromLocation, m.toLocation),
                textAlign: TextAlign.center,
              ),
            const SizedBox(height: 24),
            FilledButton(
              key: const ValueKey('new-move-again'),
              onPressed: ctl.restart,
              child: Text(l10n.newMoveAgain),
            ),
            TextButton(
              onPressed: () => context.pop(),
              child: Text(l10n.newMoveBack),
            ),
          ] else ...[
            StepHeader(
              names: [
                l10n.newMoveStepProduct,
                l10n.newMoveStepFrom,
                l10n.newMoveStepTo,
              ],
              current: switch (s.phase) {
                NewMovePhase.product => 0,
                NewMovePhase.source => 1,
                _ => 2,
              },
            ),
            const SizedBox(height: 12),
            if (s.phase == NewMovePhase.product)
              ScanInput(
                id: 'new-move-product',
                label: l10n.newMoveScanProduct,
                cameraTitle: l10n.moveNew,
                continuous: false,
                testValues: [
                  TestScan(l10n.tsProduct, '8801115114154'),
                  TestScan('SKU', 'E-00000002'),
                  TestScan(l10n.tsWrongProduct, '0000000000000'),
                ],
                onScan: (code) {
                  ctl.scanProduct(code);
                  return const ScanFeedback.ok();
                },
              )
            else
              Row(
                children: [
                  Expanded(
                    child: Text(
                      s.sku ?? '',
                      key: const ValueKey('new-move-sku'),
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  TextButton(
                    key: const ValueKey('new-move-restart'),
                    onPressed: s.busy || s.unknown ? null : ctl.restart,
                    child: Text(l10n.newMoveOtherProduct),
                  ),
                ],
              ),
            if (s.loading) const LinearProgressIndicator(),
            if (s.phase != NewMovePhase.product) ...[
              const SizedBox(height: 8),
              Text(l10n.newMoveChooseFrom, style: theme.textTheme.titleMedium),
              for (final u in s.units)
                RadioListTile<StockUnit>(
                  key: ValueKey('new-move-from-${u.locationCode}-${u.lotId}'),
                  value: u,
                  // ignore: deprecated_member_use
                  groupValue: s.source,
                  // ignore: deprecated_member_use
                  onChanged: s.busy || s.unknown
                      ? null
                      : (v) => ctl.chooseSource(v!),
                  title: Text(u.locationCode),
                  subtitle: Text(
                    [
                      l10n.lot(u.lotId),
                      if (u.expiryDate case final e?) l10n.expiresOn(e),
                      l10n.newMoveUnitQty(u.qty),
                    ].join(' · '),
                  ),
                ),
            ],
            if (s.source != null) ...[
              const SizedBox(height: 8),
              TargetLine(
                key: const ValueKey('new-move-to-line'),
                label: l10n.moveTo,
                code: s.to ?? l10n.newMoveScanTo,
                confirmed: s.to != null,
              ),
              ScanInput(
                id: 'new-move-to',
                label: l10n.newMoveScanTo,
                cameraTitle: l10n.moveNew,
                continuous: false,
                autofocus: false,
                testValues: [
                  TestScan(l10n.tsTo, 'C-S1-03-1-01'),
                  TestScan(l10n.tsWrong, 'hello'),
                ],
                onScan: (code) => ctl.scanTarget(code)
                    ? const ScanFeedback.ok()
                    : ScanFeedback.error(
                        newMoveErrorText(
                          l10n,
                          ref.read(newMoveProvider).error!,
                        ),
                      ),
              ),
              QtyStepper(
                id: 'new-move-qty',
                label: l10n.newMoveQty,
                value: s.qty,
                max: s.source!.qty,
                enabled: !s.busy && !s.unknown,
                onChanged: ctl.setQty,
              ),
              TextField(
                key: const ValueKey('new-move-reason'),
                enabled: !s.busy && !s.unknown,
                maxLength: 200,
                decoration: InputDecoration(labelText: l10n.newMoveReason),
                onChanged: ctl.setReason,
              ),
              SwitchListTile(
                key: const ValueKey('new-move-urgent'),
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.newMoveUrgent),
                subtitle: Text(l10n.newMoveUrgentHelp),
                value: s.urgent,
                onChanged: s.busy || s.unknown ? null : ctl.setUrgent,
              ),
            ],
            if (error != null)
              Text(
                newMoveErrorText(l10n, error),
                key: const ValueKey('new-move-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (s.code case final c?)
              Text(
                fieldRejectedText(l10n, c),
                key: const ValueKey('new-move-rejected'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            if (s.unknown)
              Text(
                l10n.newMoveUnknown,
                key: const ValueKey('new-move-unknown'),
              ),
            if (s.source != null) ...[
              const SizedBox(height: 12),
              CommandButton(
                key: const ValueKey('new-move-submit'),
                busy: s.busy,
                label: s.unknown ? l10n.checkAgain : l10n.newMoveSubmit,
                onPressed: ctl.canSubmit ? ctl.submit : null,
              ),
            ],
          ],
        ],
      ),
    );
  }
}
