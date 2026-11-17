import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'phone_caller.dart';
import 'photo_box.dart';

String failureReasonText(AppLocalizations l10n, FailureReason r) => switch (r) {
  FailureReason.customerAbsent => l10n.frAbsent,
  FailureReason.addressError => l10n.frAddress,
  FailureReason.unreachable => l10n.frUnreachable,
  FailureReason.refused => l10n.frRefused,
  FailureReason.damaged => l10n.frDamaged,
  FailureReason.riderIncident => l10n.frIncident,
  FailureReason.other => l10n.frOther,
};

/// 전달할 수 없어요(도움요청 메뉴에서): 사유 · 고객 연락(고객 사유면 2번 이상) · 증빙 사진 → 알리기.
/// 운영자가 확정하기 전까지 배송은 진행 중(FAILURE_REPORTED)이다. 서버가 최종 판정한다.
class FailureScreen extends ConsumerStatefulWidget {
  const FailureScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<FailureScreen> createState() => _FailureScreenState();
}

class _FailureScreenState extends ConsumerState<FailureScreen> {
  FailureReason? _reason;
  bool _sending = false;

  String get _id => widget.deliveryId;

  Future<void> _submit(FailureReason reason) async {
    setState(() => _sending = true);
    await ref.read(deliveryFlowProvider(_id).notifier).reportFailure(reason);
    if (!mounted) return;
    setState(() => _sending = false);
    final d = await ref.read(deliveryProvider(_id).future);
    if (mounted && d.state == ExecutionState.failureReported) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flow = ref.watch(deliveryFlowProvider(_id));
    final phone = ref.watch(dropInfoProvider(_id)).value?.receiverPhone;
    final reason = _reason;
    final needContacts = reason != null && needsContactAttempts(reason);
    final contactsOk = !needContacts || flow.contacts.length >= 2;
    final ready =
        reason != null && flow.photoRef != null && contactsOk && !_sending;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.reportFailure),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
        children: [
          Text(
            l10n.failureTitle,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          for (final r in FailureReason.values) ...[
            PillOption(
              key: ValueKey('failure-${r.name}'),
              label: failureReasonText(l10n, r),
              height: 46,
              showCheck: true,
              selected: _reason == r,
              onTap: () => setState(() => _reason = r),
            ),
            const SizedBox(height: 6),
          ],
          if (needContacts) ...[
            const SizedBox(height: 14),
            Text(
              l10n.failureNeedsContacts(flow.contacts.length),
              key: const ValueKey('contacts-needed'),
              style: TextStyle(
                fontSize: 14,
                color: contactsOk ? RiderColors.sub : RiderColors.danger,
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: const ValueKey('failure-call-customer'),
              onPressed: phone == null
                  ? null
                  : () => callCustomerAndRecord(context, ref, _id, phone),
              icon: const Icon(Icons.call_outlined),
              label: Text(l10n.callCustomer),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
            ),
          ],
          const SizedBox(height: 22),
          Text(
            l10n.failurePhoto,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          EvidencePhotoBox(deliveryId: _id),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('failure-submit'),
            label: l10n.failureSubmit,
            onPressed: ready ? () => _submit(reason) : null,
          ),
        ),
      ),
    );
  }
}
