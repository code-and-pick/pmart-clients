import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/deductions.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

/// 오배송 정산 차감(execution 0.41.0)·지급 실패로 넘어온 수행료(0.42.0) — 2026-11-24. 목 기준.
void main() {
  setUpAll(initPmartFormatting);

  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 30));
    }
  }

  Future<void> pumpApp(
    WidgetTester t, {
    required MockDeductionsRepository deductions,
  }) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          profileRepositoryProvider.overrideWithValue(MockProfileRepository()),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
          recordsRepositoryProvider.overrideWithValue(
            MockRecordsRepository(latency: Duration.zero),
          ),
          deductionsRepositoryProvider.overrideWithValue(deductions),
        ],
        child: const RiderApp(),
      ),
    );
    await settle(t);
  }

  GoRouter router(WidgetTester t) =>
      GoRouter.of(t.element(find.byType(Scaffold).last));

  testWidgets('정산내역 위 차감 띠(서버 합계) → 차감 목록 → 이의 보내기', (t) async {
    final deductions = MockDeductionsRepository(latency: Duration.zero);
    await pumpApp(t, deductions: deductions);
    router(t).go('/my/settlements');
    await settle(t);
    expect(
      find.byKey(const ValueKey('deduction-banner-totals')),
      findsOneWidget,
    );
    expect(find.text('앞으로 뺄 금액 12,000원 · 확정 전 9,800원'), findsOneWidget);
    // 지급 실패로 넘어온 수행료 줄
    expect(find.text('11/21 지급 실패 — 11/24에 다시 지급'), findsOneWidget);

    await t.tap(find.byKey(const ValueKey('deduction-banner')));
    await settle(t);
    expect(find.text('−9,800원'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('deduction-left-DED-mock-2')),
      findsOneWidget,
    );
    expect(find.text('남은 금액 12,000원'), findsOneWidget);
    expect(find.text('11/19 지급에서 −3,500원'), findsOneWidget);
    expect(find.text('이의 인정 — 차감 취소'), findsOneWidget);
    // 직원이 직접 만든 차감(0.43.0)은 꼬리표와 사유
    expect(
      find.byKey(const ValueKey('deduction-manual-DED-mock-2')),
      findsOneWidget,
    );
    expect(find.text('회수품이 상해 폐기 — 결제 금액만큼 차감'), findsOneWidget);
    // 이의는 이의 기간인 건에만
    expect(
      find.byKey(const ValueKey('deduction-object-DED-mock-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('deduction-object-DED-mock-2')),
      findsNothing,
    );

    await t.tap(find.byKey(const ValueKey('deduction-object-DED-mock-1')));
    await settle(t);
    // 2자 미만이면 보낼 수 없다
    final send = find.byKey(const ValueKey('deduction-object-send'));
    await t.enterText(
      find.byKey(const ValueKey('deduction-object-note')),
      '고객이 주소를 잘못 알려줬어요',
    );
    await settle(t);
    await t.tap(send);
    await settle(t);
    expect(find.byKey(const ValueKey('deduction-object-done')), findsOneWidget);

    final list = (await t.runAsync(deductions.mine))!;
    final d = list.items.firstWhere((x) => x.id == 'DED-mock-1');
    expect(d.state, DeductionState.objected);
    expect(d.objectionNote, '고객이 주소를 잘못 알려줬어요');
  });

  testWidgets('이의가 마감됐으면 그렇게 알린다(409 OBJECTION_CLOSED)', (t) async {
    final deductions = MockDeductionsRepository(latency: Duration.zero)
      ..closeObjection = true;
    await pumpApp(t, deductions: deductions);
    router(t).go('/my/deductions/DED-mock-1/objection');
    await settle(t);
    await t.enterText(
      find.byKey(const ValueKey('deduction-object-note')),
      '사정 있어요',
    );
    await settle(t);
    await t.tap(find.byKey(const ValueKey('deduction-object-send')));
    await settle(t);
    expect(find.text('이의 기한이 지났거나 이미 이의했어요.'), findsOneWidget);
  });

  testWidgets('차감을 못 읽으면 없는 것처럼 숨기지 않는다', (t) async {
    final deductions = MockDeductionsRepository(latency: Duration.zero)
      ..failList = true;
    await pumpApp(t, deductions: deductions);
    router(t).go('/my/settlements');
    await settle(t);
    expect(
      find.byKey(const ValueKey('deduction-banner-failed')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('deduction-banner')), findsNothing);
  });
}
