import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
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
  String? _keyFor;
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
    // 결과 불명 뒤 같은 글이면 같은 키, 글을 고쳤으면 새 키(같은 키·다른 본문은 409).
    if (_keyFor != text) _key = null;
    _keyFor = text;
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

/// 지원센터 "내 문의"의 소명·이의 한 줄 — [상태] 종류 · 날짜 / 굵은 내용 / 보상금 / 결정 이유(회색 칸).
/// 문의 줄과 같은 모양([SupportRowBody]). 결정은 라이더 운영이 백오피스에서(유지·인정).
class AppealRow extends StatelessWidget {
  const AppealRow({super.key, required this.appeal, this.compensation});

  final Appeal appeal;
  final int? compensation;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final a = appeal;
    final (stateText, stateColor) = appealStateLook(l10n, a.state);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 13, 16, 13),
      child: SupportRowBody(
        state: StatusPill(label: stateText, color: stateColor),
        kind: a.target == AppealTarget.restriction
            ? l10n.appealRestrictionTitle
            : l10n.appealKindEarning,
        at: a.submittedAt,
        title: a.body,
        extra: [
          if (compensation case final won?)
            Text(
              l10n.appealCompensation(formatKrw(won)),
              key: ValueKey('appeal-compensation-${a.appealId}'),
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: RiderColors.primary,
              ),
            ),
          if (a.decisionNote case final note?)
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
      ),
    );
  }
}
