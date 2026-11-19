import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../l10n/gen/app_localizations.dart';
import 'location_guide.dart';
import 'pda_theme.dart';

/// 단계 표시 — 시안의 알약 칸(지금 단계 진한 보라·흰 글씨, 끝난 단계 "✓ 이름").
class StepHeader extends StatelessWidget {
  const StepHeader({super.key, required this.names, required this.current});

  final List<String> names;
  final int current;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        key: ValueKey('step-$current'),
        children: [
          for (final (i, n) in names.indexed) ...[
            if (i > 0) const SizedBox(width: 5),
            Expanded(
              child: Container(
                height: 32,
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 2),
                decoration: BoxDecoration(
                  color: i == current ? PdaColors.primary : PdaColors.soft,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (i < current)
                      const Padding(
                        padding: EdgeInsets.only(right: 2),
                        child: Icon(
                          Icons.check,
                          size: 14,
                          color: PdaColors.muted,
                        ),
                      ),
                    Flexible(
                      child: Text(
                        n,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: i == current ? Colors.white : PdaColors.muted,
                          fontWeight: i == current ? FontWeight.w800 : null,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 지금 할 일 — 시안의 큰 제목(예 "장바구니를 스캔하세요") + 회색 한 줄 설명.
class ScanPrompt extends StatelessWidget {
  const ScanPrompt({super.key, required this.text, this.detail});

  final String text;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -1.2,
              height: 1.25,
            ),
          ),
          if (detail case final d?)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                d,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: PdaColors.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 진행 줄 — "확정 n / 지시 m" + 막대(시안 progress).
class ProgressLine extends StatelessWidget {
  const ProgressLine({
    super.key,
    required this.text,
    required this.done,
    required this.total,
    this.textKey,
  });

  final String text;
  final int done;
  final int total;
  final Key? textKey;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Row(
      children: [
        Text(
          text,
          key: textKey,
          style: Theme.of(context).textTheme.labelMedium
              ?.copyWith(color: PdaColors.muted, fontWeight: FontWeight.w800),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : done / total,
            minHeight: 9,
            borderRadius: BorderRadius.circular(5),
          ),
        ),
      ],
    ),
  );
}

/// 화면 아래 고정 버튼 칸(시안 actions) — 흰 바탕, 위 선, 버튼 사이 7.
/// 스캔 칸·주 버튼·보조 버튼을 넣는다. 비면 아무것도 그리지 않는다.
class ActionBar extends StatelessWidget {
  const ActionBar({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: PdaColors.line)),
        boxShadow: [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 20,
            offset: Offset(0, -5),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(15, 11, 15, 13),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, c) in children.indexed) ...[
                if (i > 0) const SizedBox(height: 7),
                c,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// 단계 화면 몸통 — 위 내용(좌우 16) + 아래 고정 버튼 칸([ActionBar]).
/// [child] 는 남은 높이를 다 받는다(안에서 `Expanded` 목록을 써도 된다).
class StepBody extends StatelessWidget {
  const StepBody({super.key, required this.child, this.actions = const []});

  final Widget child;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Expanded(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: child,
        ),
      ),
      ActionBar(children: actions),
    ],
  );
}

/// 작은 회색 머리줄(예 "상품 2 / 7", "칸 1 / 3").
class StepCaption extends StatelessWidget {
  const StepCaption(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelLarge
          ?.copyWith(color: PdaColors.muted, fontWeight: FontWeight.w800),
    ),
  );
}

/// 끝 표시(시안 complete) — 옅은 보라 원 안의 ✓ + 큰 제목 + 설명.
class DoneMark extends StatelessWidget {
  const DoneMark({
    super.key,
    required this.title,
    this.message,
    this.messageKey,
  });

  final String title;
  final String? message;
  final Key? messageKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: PdaColors.lilac,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check, size: 36, color: PdaColors.dark),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -1.2,
            ),
          ),
          if (message case final m?)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                m,
                key: messageKey,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: PdaColors.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 안내 띠 — 보통은 옅은 보라, [warning] 이면 노랑(같은 LOT 다른 칸·입수와 다름처럼
/// 작업자가 멈춰 확인해야 하는 주의. 사용자 2026-11-19 "주의 안내만 노랑으로").
class NoticeBox extends StatelessWidget {
  const NoticeBox({
    super.key,
    required this.text,
    this.textKey,
    this.warning = false,
  });

  final String text;

  /// 안의 [Text] 키(시험·화면이 문구를 읽는 자리).
  final Key? textKey;
  final bool warning;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(top: 10),
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: warning ? PdaColors.warning : PdaColors.notice,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (warning)
          const Padding(
            padding: EdgeInsets.only(right: 6),
            child: Icon(
              Icons.warning_amber_rounded,
              size: 18,
              color: PdaColors.onWarning,
            ),
          ),
        Expanded(
          child: Text(
            text,
            key: textKey,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: warning ? PdaColors.onWarning : PdaColors.onNotice,
              fontWeight: warning ? FontWeight.w700 : null,
            ),
          ),
        ),
      ],
    ),
  );
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
        const MarkCircle(icon: Icons.check),
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
        MarkCircle(icon: icon == Icons.check_circle ? Icons.check : icon),
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

/// 스캔해 센 수량 — 첫 개를 스캔한 뒤 보인다(사용자 2026-11-17, 피킹·이동·적치·복귀 같게).
/// 스캔마다 +1(화면 밖), + 버튼, 숫자 수기(완료 키·바깥 누르면 반영). 범위 판단은 [onSet] 쪽.
class CountQtyField extends StatefulWidget {
  const CountQtyField({
    super.key,
    required this.id,
    required this.label,
    required this.help,
    required this.addLabel,
    required this.value,
    required this.max,
    required this.onAdd,
    required this.onSet,
  });

  /// 입력칸 키 `id`, + 버튼 키 `id-add`.
  final String id;
  final String label;
  final String help;
  final String addLabel;
  final int value;
  final int max;
  final VoidCallback onAdd;
  final ValueChanged<int> onSet;

  @override
  State<CountQtyField> createState() => _CountQtyFieldState();
}

class _CountQtyFieldState extends State<CountQtyField> {
  late final _text = TextEditingController(text: '${widget.value}');

  @override
  void didUpdateWidget(CountQtyField old) {
    super.didUpdateWidget(old);
    if (old.value != widget.value) _text.text = '${widget.value}';
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _apply() {
    final n = int.tryParse(_text.text.trim());
    if (n == null) {
      _text.text = '${widget.value}';
      return;
    }
    widget.onSet(n);
    // 범위 밖이라 값이 그대로면 칸을 원래 값으로 돌린다.
    if (mounted) _text.text = '${widget.value}';
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextField(
            key: ValueKey(widget.id),
            controller: _text,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            style: Theme.of(context).textTheme.headlineSmall,
            decoration: InputDecoration(
              labelText: widget.label,
              helperText: widget.help,
              helperMaxLines: 2,
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _apply(),
            onTapOutside: (_) {
              FocusManager.instance.primaryFocus?.unfocus();
              _apply();
            },
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          height: 64,
          child: FilledButton.tonalIcon(
            key: ValueKey('${widget.id}-add'),
            onPressed: widget.value < widget.max ? widget.onAdd : null,
            icon: const Icon(Icons.add),
            label: Text(widget.addLabel),
          ),
        ),
      ],
    ),
  );
}

/// 옅은 보라 원 안의 그림(시안 complete 의 ✓).
class MarkCircle extends StatelessWidget {
  const MarkCircle({super.key, required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      width: 64,
      height: 64,
      decoration: const BoxDecoration(
        color: PdaColors.lilac,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 36, color: PdaColors.dark),
    ),
  );
}
