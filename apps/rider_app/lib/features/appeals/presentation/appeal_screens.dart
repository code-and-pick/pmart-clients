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
import '../../../shared/keyboard.dart';

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
                    onTapOutside: dismissKeyboard,
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

/// 소명·이의 상태 글자·색 — 결정 대기(주황) · 유지(회색) · 인정(보라).
(String, Color) appealStateLook(AppLocalizations l10n, AppealState s) =>
    switch (s) {
      AppealState.open => (l10n.appealOpen, RiderColors.pickup),
      AppealState.upheld => (l10n.appealUpheld, RiderColors.sub),
      AppealState.accepted => (l10n.appealAccepted, RiderColors.primary),
    };

/// 지원센터의 "소명·이의" 탭 — 결정 대기·유지·인정과 결정 이유.
class AppealList extends ConsumerWidget {
  const AppealList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // 인정된 수행료 이의의 보상금(정산내역의 보상 줄 — execution 0.30.0). 못 읽었으면 금액을 붙이지 않는다(0원으로 지어내지 않음).
    final compensations = <String, int>{
      for (final s
          in ref.watch(settlementsProvider).value?.items ??
              const <Settlement>[])
        if (s.compensation && s.appealId != null && s.amount != null)
          s.appealId!: s.amount!,
    };
    return RefreshIndicator(
      onRefresh: () => ref.refresh(myAppealsProvider.future),
      child: UiStateView<List<Appeal>>(
        state: uiStateOf(
          ref.watch(myAppealsProvider),
          isEmpty: (l) => l.isEmpty,
        ),
        onRetry: () => ref.invalidate(myAppealsProvider),
        empty: (_) => ListView(
          children: [
            SupportEmpty(
              key: const ValueKey('appeal-none'),
              icon: Icons.gavel_outlined,
              text: l10n.appealNone,
              note: l10n.appealWhere,
            ),
          ],
        ),
        ready: (context, list) => ListView(
          key: const ValueKey('appeal-list'),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            for (final a in list)
              _AppealCard(
                key: ValueKey('appeal-${a.appealId}'),
                appeal: a,
                compensation: compensations[a.appealId],
              ),
          ],
        ),
      ),
    );
  }
}

class _AppealCard extends StatelessWidget {
  const _AppealCard({super.key, required this.appeal, this.compensation});

  final Appeal appeal;
  final int? compensation;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appeal;
    final (stateText, stateColor) = appealStateLook(l10n, a.state);
    return SupportCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              StatusPill(label: stateText, color: stateColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  formatSeoulDateTime(a.submittedAt),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: RiderColors.hint),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            a.target == AppealTarget.restriction
                ? l10n.appealRestrictionTitle
                : l10n.appealEarningTitle,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: RiderColors.ink,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            a.body,
            style: const TextStyle(
              fontSize: 14,
              height: 1.4,
              color: RiderColors.sub,
            ),
          ),
          if (compensation case final won?) ...[
            const SizedBox(height: 8),
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
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              decoration: BoxDecoration(
                color: RiderColors.field,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                l10n.appealDecisionNote(note),
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: RiderColors.ink,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
