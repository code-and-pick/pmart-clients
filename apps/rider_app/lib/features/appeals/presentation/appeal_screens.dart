import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../../shared/ui_state_of.dart';
import '../../my/data/records.dart';
import '../data/appeals.dart';

/// 신청 화면 주소. 계정 제한 소명은 대상이 서버에서 정해지고, 수행료 이의는 배송 ID 를 넘긴다.
String appealNewRoute(AppealTarget target, {String? deliveryId}) => Uri(
  path: '/my/appeals/new',
  queryParameters: {'type': target.name, 'deliveryId': ?deliveryId},
).toString();

/// 소명·이의 신청 쓰기(rider 0.15.0). 같은 대상에는 한 번 — 이미 있으면 "내 신청"으로 안내.
class AppealNewScreen extends ConsumerStatefulWidget {
  const AppealNewScreen({super.key, required this.target, this.deliveryId});

  final AppealTarget target;
  final String? deliveryId;

  @override
  ConsumerState<AppealNewScreen> createState() => _AppealNewScreenState();
}

class _AppealNewScreenState extends ConsumerState<AppealNewScreen> {
  final _body = TextEditingController();

  /// 이 신청(행위)의 키 — 결과 불명으로 다시 보내면 같은 키.
  IdempotencyKey? _key;
  bool _busy = false;
  Appeal? _done;
  String? _error;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final text = _body.text.trim();
    if (text.isEmpty || _busy) return;
    final key = _key ??= IdempotencyKey.generate();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final a = await ref
          .read(appealRepositoryProvider)
          .submit(
            target: widget.target,
            deliveryId: widget.deliveryId,
            body: text,
            key: key,
          );
      ref.invalidate(myAppealsProvider);
      if (mounted) setState(() => _done = a);
    } on AppealExistsFailure {
      _key = null;
      if (mounted) setState(() => _error = l10n.appealExists);
    } on NothingToAppealFailure {
      _key = null;
      if (mounted) setState(() => _error = l10n.appealNothing);
    } on UnknownResultFailure {
      // 접수됐는지 모른다 — 같은 키로 다시 보내면 같은 신청(새로 만들지 않는다).
      if (mounted) setState(() => _error = l10n.appealUnknown);
    } on PmartFailure {
      _key = null;
      if (mounted) setState(() => _error = l10n.appealFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final restriction = widget.target == AppealTarget.restriction;
    final done = _done;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          restriction ? l10n.appealRestrictionTitle : l10n.appealEarningTitle,
        ),
        titleTextStyle: riderTitleStyle(context),
      ),
      body: SafeArea(
        child: done != null
            ? Padding(
                key: const ValueKey('appeal-done'),
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.appealSubmitted,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.appealSubmittedNote,
                      style: const TextStyle(
                        fontSize: 15,
                        color: RiderColors.sub,
                      ),
                    ),
                    const Spacer(),
                    RiderButton(
                      label: l10n.appealMine,
                      onPressed: () => context.go('/my/appeals'),
                    ),
                  ],
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    restriction
                        ? l10n.appealRestrictionIntro
                        : l10n.appealEarningIntro,
                    style: const TextStyle(fontSize: 15, height: 1.5),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    key: const ValueKey('appeal-body'),
                    controller: _body,
                    maxLines: 8,
                    maxLength: appealBodyMax,
                    enabled: !_busy,
                    decoration: InputDecoration(
                      hintText: l10n.appealHint,
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  Text(
                    l10n.appealNoPii,
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.hint,
                    ),
                  ),
                  if (_error case final e?) ...[
                    const SizedBox(height: 12),
                    Text(
                      e,
                      key: const ValueKey('appeal-error'),
                      style: const TextStyle(
                        fontSize: 14,
                        color: RiderColors.danger,
                      ),
                    ),
                    if (e == l10n.appealExists)
                      TextButton(
                        onPressed: () => context.go('/my/appeals'),
                        child: Text(l10n.appealMine),
                      ),
                  ],
                  const SizedBox(height: 20),
                  RiderButton(
                    key: const ValueKey('appeal-submit'),
                    label: _busy ? l10n.appealSending : l10n.appealSubmit,
                    onPressed: _busy || _body.text.trim().isEmpty
                        ? null
                        : _submit,
                  ),
                ],
              ),
      ),
    );
  }
}

/// 내 신청 — 결정 대기·유지·인정과 결정 이유.
class MyAppealsScreen extends ConsumerWidget {
  const MyAppealsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // 인정된 수행료 이의의 보상금(정산내역의 보상 줄 — execution 0.30.0). 못 읽었으면 금액을 붙이지 않는다(0원으로 지어내지 않음).
    final compensations = <String, int>{
      for (final s
          in ref.watch(settlementsProvider).value ?? const <Settlement>[])
        if (s.compensation && s.appealId != null && s.amount != null)
          s.appealId!: s.amount!,
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appealMine),
        titleTextStyle: riderTitleStyle(context),
      ),
      body: UiStateView<List<Appeal>>(
        state: uiStateOf(
          ref.watch(myAppealsProvider),
          isEmpty: (l) => l.isEmpty,
        ),
        onRetry: () => ref.invalidate(myAppealsProvider),
        empty: (_) => Center(
          child: Text(
            l10n.appealNone,
            key: const ValueKey('appeal-none'),
            style: const TextStyle(fontSize: 15, color: RiderColors.sub),
          ),
        ),
        ready: (context, list) => ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: list.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final a = list[i];
            return Padding(
              key: ValueKey('appeal-${a.appealId}'),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          a.target == AppealTarget.restriction
                              ? l10n.appealRestrictionTitle
                              : l10n.appealEarningTitle,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Text(
                        switch (a.state) {
                          AppealState.open => l10n.appealOpen,
                          AppealState.upheld => l10n.appealUpheld,
                          AppealState.accepted => l10n.appealAccepted,
                        },
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: switch (a.state) {
                            AppealState.open => RiderColors.sub,
                            AppealState.upheld => RiderColors.ink,
                            AppealState.accepted => RiderColors.primary,
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    formatSeoulDateTime(a.submittedAt),
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.hint,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(a.body, style: const TextStyle(fontSize: 15)),
                  if (compensations[a.appealId] case final won?) ...[
                    const SizedBox(height: 6),
                    Text(
                      l10n.appealCompensation(formatKrw(won)),
                      key: ValueKey('appeal-compensation-${a.appealId}'),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: RiderColors.primary,
                      ),
                    ),
                  ],
                  if (a.decisionNote case final note?) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      color: RiderColors.field,
                      child: Text(
                        l10n.appealDecisionNote(note),
                        style: const TextStyle(fontSize: 14),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
