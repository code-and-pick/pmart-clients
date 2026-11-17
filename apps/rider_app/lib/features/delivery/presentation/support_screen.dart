import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'support_thread_screen.dart' show helpStateLook;

/// 지원센터 화면에서 배송 화면으로 돌려보낼 처리(배송 화면이 실제로 한다).
enum SupportAction { cancelAssignment, reportFailure }

/// 지원센터(도움요청). 보낸 요청은 지원센터 사건함(백오피스)에 "라이더 도움요청"으로 열리고,
/// 상담원이 처리하면 여기 상태가 바뀐다(접수됨 → 처리 중 → 처리 완료, 접수번호).
///
/// 계약상 라이더는 상담원 답변·메모를 받지 못하고(직원에게만), 채팅·내 요청 목록 API 도 없다 —
/// 백엔드 요청 중(`docs/handoff/rider-app/2026-11-16-backend-trip-info-and-signup.md` §11).
class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ConsumerState<SupportScreen> {
  final _detail = TextEditingController();
  HelpCategory? _category;

  String get _id => widget.deliveryId;

  @override
  void initState() {
    super.initState();
    // 들어오면 처리 상태를 새로 확인한다.
    Future.microtask(() => ref.read(helpFlowProvider(_id).notifier).refresh());
  }

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final category = _category;
    if (category == null) return;
    final l10n = AppLocalizations.of(context);
    await ref
        .read(helpFlowProvider(_id).notifier)
        .send(category, detail: _detail.text);
    if (!mounted) return;
    final last = ref.read(helpFlowProvider(_id)).last;
    if (last != null && last.state != HelpState.unknown) {
      _detail.clear();
      setState(() => _category = null);
      // 보낸 요청의 진행상황·상담원 대화로 바로 간다(그 화면에 "접수됨"이 보인다 — 안내 띠는 띄우지
      // 않는다. 띄우면 대화 입력칸을 가린다).
      unawaited(context.push('/deliveries/$_id/support/${last.key.value}'));
    } else {
      // 접수됐는지 모른다 — 같은 내용으로 다시 누르면 같은 요청으로 확인한다.
      showRiderToast(context, l10n.helpUnknown);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(_id)).value;
    final flow = ref.watch(deliveryFlowProvider(_id));
    final help = ref.watch(helpFlowProvider(_id));
    final pickupStage = d != null && isPickupStage(d.state);
    final canFail =
        d?.state == ExecutionState.pickedUp ||
        d?.state == ExecutionState.arrivedAtCustomer;
    final suggested = flow.uploadFailed ? HelpCategory.photoUploadFailed : null;
    final categories = [
      ?suggested,
      ...HelpCategory.values.where((v) => v != suggested),
    ];
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.supportTitle),
      body: ListView(
        key: const ValueKey('support-center'),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: RiderColors.primaryMist,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.support_agent, color: RiderColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.supportIntro,
                    style: const TextStyle(fontSize: 14, height: 1.5),
                  ),
                ),
              ],
            ),
          ),
          if (pickupStage || canFail) ...[
            const SizedBox(height: 18),
            Text(l10n.supportDeliveryActions, style: _sectionTitle),
            const SizedBox(height: 6),
            if (canFail)
              _ActionRow(
                key: const ValueKey('help-report-failure'),
                icon: Icons.report_gmailerrorred,
                label: l10n.reportFailure,
                onTap: () => context.pop(SupportAction.reportFailure),
              ),
            if (pickupStage)
              _ActionRow(
                key: const ValueKey('cancel-assignment'),
                icon: Icons.cancel_outlined,
                label: l10n.cancelAssignment,
                onTap: () => context.pop(SupportAction.cancelAssignment),
              ),
          ],
          const SizedBox(height: 22),
          Text(l10n.helpTitle, style: _sectionTitle),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in categories)
                ChoiceChip(
                  key: ValueKey('help-${c.name}'),
                  label: Text(helpCategoryText(l10n, c)),
                  selected: _category == c,
                  selectedColor: RiderColors.primarySoft,
                  onSelected: (_) => setState(() => _category = c),
                ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            key: const ValueKey('support-detail'),
            controller: _detail,
            maxLength: 500,
            maxLines: 4,
            minLines: 2,
            decoration: InputDecoration(
              hintText: l10n.supportDetailHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 6),
          RiderButton(
            key: const ValueKey('support-send'),
            label: l10n.supportSend,
            onPressed: _category == null || help.sending ? null : _send,
          ),
          const SizedBox(height: 26),
          Row(
            children: [
              Expanded(child: Text(l10n.supportHistory, style: _sectionTitle)),
              if (help.tickets.isNotEmpty)
                TextButton(
                  key: const ValueKey('support-refresh'),
                  onPressed: help.sending
                      ? null
                      : ref.read(helpFlowProvider(_id).notifier).refresh,
                  child: Text(l10n.checkAgain),
                ),
            ],
          ),
          if (help.tickets.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                l10n.supportEmpty,
                style: const TextStyle(color: RiderColors.sub),
              ),
            )
          else
            for (final t in help.tickets.reversed)
              _TicketCard(
                ticket: t,
                onOpen: () =>
                    context.push('/deliveries/$_id/support/${t.key.value}'),
              ),
          const SizedBox(height: 8),
          Text(
            l10n.supportReplyPending,
            style: const TextStyle(fontSize: 12, color: RiderColors.hint),
          ),
        ],
      ),
    );
  }
}

const _sectionTitle = TextStyle(fontSize: 16, fontWeight: FontWeight.w800);

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    leading: Icon(icon, color: RiderColors.danger),
    title: Text(
      label,
      style: const TextStyle(
        color: RiderColors.danger,
        fontWeight: FontWeight.w700,
      ),
    ),
    trailing: const Icon(Icons.chevron_right, color: RiderColors.sub),
    onTap: onTap,
  );
}

/// 보낸 도움요청 한 건: 유형 · 보낸 시각 · 내용 · 처리 상태 · 접수번호. 누르면 진행상황·대화.
class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket, required this.onOpen});

  final HelpTicket ticket;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = helpStateLook(l10n, ticket.state);
    return InkWell(
      key: ValueKey('ticket-${ticket.key.value}'),
      onTap: onOpen,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: RiderColors.line),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    helpCategoryText(l10n, ticket.category),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  clockText(ticket.sentAt),
                  style: const TextStyle(fontSize: 13, color: RiderColors.sub),
                ),
              ],
            ),
            if (ticket.detail case final detail?)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  detail,
                  style: const TextStyle(fontSize: 14, color: RiderColors.sub),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    text,
                    key: ValueKey('ticket-state-${ticket.key.value}'),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (ticket.caseId case final no?)
                  Text(
                    l10n.supportCaseNo(no),
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.sub,
                    ),
                  ),
                const Spacer(),
                Text(
                  l10n.supportOpenThread,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.primary,
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: RiderColors.primary,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
