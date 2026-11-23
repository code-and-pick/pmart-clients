import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../shared/rider_widgets.dart';
import '../../../l10n/gen/app_localizations.dart';
import 'delivery_controller.dart';

/// 전화 걸기(`tel:`). 번호는 로그에 남기지 않는다. 시험 실행에서는 아무것도 하지 않는다.
final phoneCallerProvider = Provider<Future<void> Function(String phone)>(
  (_) => (phone) async {
    if (Platform.environment.containsKey('FLUTTER_TEST')) return;
    await launchUrl(Uri(scheme: 'tel', path: phone));
  },
);

/// 고객에게 전화를 걸고 통화 결과를 기록한다(전달 실패 등록에 쓰는 연락 기록).
Future<void> callCustomerAndRecord(
  BuildContext context,
  WidgetRef ref,
  String deliveryId,
  String phone,
) async {
  final l10n = AppLocalizations.of(context);
  await ref.read(phoneCallerProvider)(phone);
  if (!context.mounted) return;
  final answered = await showDialog<bool>(
    context: context,
    builder: (context) => RiderAlertDialog(
      content: Text(l10n.callResultAsk),
      actions: [
        TextButton(
          key: const ValueKey('call-no-answer'),
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.callNoAnswer),
        ),
        TextButton(
          key: const ValueKey('call-answered'),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(l10n.callAnswered),
        ),
      ],
    ),
  );
  if (answered == null) return;
  ref
      .read(deliveryFlowProvider(deliveryId).notifier)
      .recordContact(answered: answered);
}
