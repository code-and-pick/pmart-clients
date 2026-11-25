// 전화번호 인증 안 한 기존 가입자 팝업(사용자 2026-11-25). 계약 요청 중이라 목만 값을 준다.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/shared/providers.dart';

Future<void> _pump(WidgetTester t, bool? verified) async {
  await t.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        initialSessionProvider.overrideWithValue(
          const RiderSession(riderId: 'rider-mock-1'),
        ),
        secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(latency: Duration.zero, seeded: false),
        ),
        profileRepositoryProvider.overrideWithValue(
          MockProfileRepository()..phoneVerified = verified,
        ),
      ],
      child: const RiderApp(),
    ),
  );
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('인증 안 함(false)이면 홈에서 한 번 묻고, 나중에를 누르면 닫힌다', (t) async {
    await _pump(t, false);
    expect(find.byKey(const ValueKey('phone-verify-dialog')), findsOneWidget);
    expect(find.text('전화번호 인증이 필요해요'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('phone-verify-later')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    expect(find.byKey(const ValueKey('phone-verify-dialog')), findsNothing);
  });

  testWidgets('지금 인증하기 → 번호 넣는 화면, 010 11자리 전에는 인증하기가 꺼져 있다(rider 0.28.0)', (
    t,
  ) async {
    await _pump(t, false);
    await t.tap(find.byKey(const ValueKey('phone-verify-go')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    expect(find.byKey(const ValueKey('phone-verify-input')), findsOneWidget);
    FilledButton button() => t.widget<FilledButton>(
      find.descendant(
        of: find.byKey(const ValueKey('phone-verify-start')),
        matching: find.byType(FilledButton),
      ),
    );
    expect(button().onPressed, isNull);
    await t.enterText(
      find.byKey(const ValueKey('phone-verify-input')),
      '01012345678',
    );
    await t.pump();
    expect(button().onPressed, isNotNull);
  });

  testWidgets('인증 여부를 모르면(null — 실서버 지금) 묻지 않는다', (t) async {
    await _pump(t, null);
    expect(find.byKey(const ValueKey('phone-verify-dialog')), findsNothing);
  });

  testWidgets('인증했으면 묻지 않는다', (t) async {
    await _pump(t, true);
    expect(find.byKey(const ValueKey('phone-verify-dialog')), findsNothing);
  });
}
