import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../l10n/gen/app_localizations.dart';
import 'location_guide.dart';

/// 단계 표시(1 → 2 → 3 …). [current] 까지 채운다.
class StepHeader extends StatelessWidget {
  const StepHeader({super.key, required this.names, required this.current});

  final List<String> names;
  final int current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      key: ValueKey('step-$current'),
      children: [
        for (final (i, n) in names.indexed)
          Expanded(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: i <= current
                      ? scheme.primary
                      : scheme.surfaceContainerHighest,
                  foregroundColor: i <= current
                      ? scheme.onPrimary
                      : scheme.onSurfaceVariant,
                  child: Text('${i + 1}'),
                ),
                const SizedBox(height: 4),
                Text(
                  n,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontWeight: i == current ? FontWeight.bold : null,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// "이동하세요" 안내 — 물건을 실은 뒤 도착 칸으로 가는 동안 보인다.
class GoBanner extends StatelessWidget {
  const GoBanner({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: scheme.primaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(Icons.directions_walk, color: scheme.onPrimaryContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  text,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: scheme.onPrimaryContainer,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 작업 하나가 끝났을 때의 완료 화면: 제목 + 한 줄 요약 + 요약 줄(무엇을·어디서·어디로) + "다음 작업".
///
/// "다음 작업"을 [autoNextAfter] 안에 누르지 않으면 누른 것과 똑같이 자동으로 다음 작업을 받는다
/// (사용자 2026-11-13: 10초). 남은 초를 버튼 위에 보인다. 서버가 끝났다고 답한 뒤에만 띄운다.
/// [autoNext] 가 false(휴게 중)면 자동으로 넘어가지 않고 버튼만 둔다(사용자 2026-11-14).
class TaskDoneView extends StatefulWidget {
  const TaskDoneView({
    super.key,
    required this.title,
    required this.message,
    required this.rows,
    required this.onNext,
    this.autoNext = true,
  });

  static const autoNextAfter = Duration(seconds: 10);

  final String title;
  final String message;

  /// (이름, 값) 줄.
  final List<(String, String)> rows;
  final Future<void> Function() onNext;
  final bool autoNext;

  @override
  State<TaskDoneView> createState() => _TaskDoneViewState();
}

class _TaskDoneViewState extends State<TaskDoneView> {
  Timer? _tick;
  int _left = TaskDoneView.autoNextAfter.inSeconds;
  bool _going = false;

  @override
  void initState() {
    super.initState();
    if (widget.autoNext) _startTimer();
  }

  @override
  void didUpdateWidget(TaskDoneView old) {
    super.didUpdateWidget(old);
    if (_going || old.autoNext == widget.autoNext) return;
    // 휴게가 바뀌면(또는 본인 정보가 늦게 오면) 타이머를 처음부터 다시 켜거나 끈다.
    _tick?.cancel();
    _tick = null;
    _left = TaskDoneView.autoNextAfter.inSeconds;
    if (widget.autoNext) _startTimer();
  }

  void _startTimer() {
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_left > 1) {
        setState(() => _left -= 1);
      } else {
        _next();
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  /// 버튼을 눌렀든 시간이 됐든 한 번만 넘어간다.
  Future<void> _next() async {
    if (_going) return;
    _tick?.cancel();
    setState(() {
      _going = true;
      _left = 0;
    });
    await widget.onNext();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Spacer(),
        Icon(Icons.check_circle, size: 72, color: scheme.primary),
        const SizedBox(height: 12),
        Text(
          widget.title,
          key: const ValueKey('done-title'),
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          widget.message,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
        if (widget.rows.isNotEmpty) ...[
          const SizedBox(height: 20),
          Card(
            key: const ValueKey('done-summary'),
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  for (final (label, value) in widget.rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 72,
                            child: Text(
                              label,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              value,
                              style: theme.textTheme.titleMedium,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
        const Spacer(flex: 2),
        if (!_going)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              widget.autoNext
                  ? l10n.moveDoneAutoNext(_left)
                  : l10n.doneAutoNextOnBreak,
              key: ValueKey(
                widget.autoNext ? 'done-auto-next' : 'done-auto-next-off',
              ),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
        CommandButton(
          key: const ValueKey('result-action'),
          label: l10n.nextTask,
          busy: _going,
          onPressed: _next,
        ),
      ],
    );
  }
}

/// 끝·대기·오류 안내 + 버튼 하나.
class ResultView extends StatelessWidget {
  const ResultView({
    super.key,
    required this.icon,
    required this.text,
    required this.action,
    required this.onAction,
    this.busy = false,
  });

  final IconData icon;
  final String text;
  final String action;
  final Future<void> Function() onAction;
  final bool busy;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisAlignment: MainAxisAlignment.center,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (busy)
        const Center(child: CircularProgressIndicator())
      else
        Icon(icon, size: 64),
      const SizedBox(height: 16),
      Text(
        text,
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 24),
      CommandButton(
        key: const ValueKey('result-action'),
        label: action,
        busy: busy,
        onPressed: onAction,
      ),
    ],
  );
}

/// 이 칸에 왔는지 확인하는 줄: 지시 위치 + 스캔했으면 ✓.
class TargetLine extends StatelessWidget {
  const TargetLine({
    super.key,
    required this.label,
    required this.code,
    required this.confirmed,
  });

  final String label;
  final String code;
  final bool confirmed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final row = Row(
      children: [
        Icon(
          confirmed ? Icons.check_circle : Icons.place_outlined,
          color: confirmed ? theme.colorScheme.primary : null,
        ),
        const SizedBox(width: 8),
        Text(label, style: theme.textTheme.titleMedium),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            code,
            style: theme.textTheme.headlineSmall,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
    // 아직 가야 할 선반 칸이면 조각 색 블록을 아래에 크게(위치 스캔 화면 구성 — 사용자 2026-11-16).
    if (confirmed || ShelfCode.parse(code) == null) return row;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        row,
        const SizedBox(height: 4),
        LocationBlocks(code: code),
        const SizedBox(height: 4),
      ],
    );
  }
}

/// 수량 −/＋, 숫자를 누르면 직접 입력.
class QtyStepper extends StatelessWidget {
  const QtyStepper({
    super.key,
    required this.id,
    required this.label,
    required this.value,
    required this.onChanged,
    this.max,
    this.enabled = true,
    this.plusEnabled = true,
    this.typeEnabled = true,
  });

  final String id;
  final String label;
  final int value;
  final int? max;
  final bool enabled;

  /// ＋ 버튼. 스캔으로 세는 칸에서는 끈다(스캔이 +1).
  final bool plusEnabled;

  /// 숫자를 눌러 직접 넣기.
  final bool typeEnabled;
  final ValueChanged<int> onChanged;

  void _set(int v) {
    final m = max;
    onChanged(v < 0 ? 0 : (m != null && v > m ? m : v));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.titleMedium)),
        IconButton.outlined(
          key: ValueKey('$id-minus'),
          onPressed: enabled && value > 0 ? () => _set(value - 1) : null,
          icon: const Icon(Icons.remove),
        ),
        InkWell(
          key: ValueKey('$id-value'),
          onTap: enabled && typeEnabled
              ? () async {
                  final v = await showDialog<int>(
                    context: context,
                    builder: (_) => QtyDialog(title: label, initial: value),
                  );
                  if (v != null) _set(v);
                }
              : null,
          child: SizedBox(
            width: 64,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall,
            ),
          ),
        ),
        IconButton.filledTonal(
          key: ValueKey('$id-plus'),
          onPressed: enabled && plusEnabled && (max == null || value < max!)
              ? () => _set(value + 1)
              : null,
          icon: const Icon(Icons.add),
        ),
      ],
    );
  }
}

/// 수량 직접 입력. 컨트롤러는 다이얼로그가 닫힌 뒤 해제한다.
class QtyDialog extends StatefulWidget {
  const QtyDialog({super.key, required this.title, required this.initial});

  final String title;
  final int initial;

  @override
  State<QtyDialog> createState() => _QtyDialogState();
}

class _QtyDialogState extends State<QtyDialog> {
  late final _c = TextEditingController(text: '${widget.initial}');

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: const ValueKey('qty-input'),
        controller: _c,
        autofocus: true,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: const ValueKey('qty-ok'),
          onPressed: () =>
              Navigator.of(context).pop(int.tryParse(_c.text.trim())),
          child: Text(l10n.confirmOk),
        ),
      ],
    );
  }
}

/// 현장 명령 거절 문구. 담당 아님(409 `NOT_ASSIGNEE` — 이동 지시, 입고 작업 mfc-inbound 0.9.0)은 따로 알린다.
String fieldRejectedText(AppLocalizations l10n, String code) =>
    code == 'NOT_ASSIGNEE' ? l10n.startNotAssignee : l10n.inspectRejected(code);
