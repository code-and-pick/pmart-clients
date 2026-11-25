import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/appeals/data/appeals.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/deductions.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

/// 소명·이의 신청(rider 0.15.0, 사용자 2026-11-18 "앱에서 신청 → 백오피스 결정").
void main() {
  setUpAll(initPmartFormatting);

  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 30));
    }
  }

  Future<ProviderContainer> pumpApp(
    WidgetTester t, {
    required MockAppealRepository appeals,
    Restriction restriction = Restriction.normal,
    MockRecordsRepository? records,
  }) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    final profile = MockProfileRepository()..restriction = restriction;
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
          profileRepositoryProvider.overrideWithValue(profile),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
          appealRepositoryProvider.overrideWithValue(appeals),
          // 정산내역 위 오배송 차감 띠(2026-11-24)가 기다리는 타이머를 남기지 않게
          deductionsRepositoryProvider.overrideWithValue(
            MockDeductionsRepository(latency: Duration.zero),
          ),
          if (records != null)
            recordsRepositoryProvider.overrideWithValue(records),
        ],
        child: const RiderApp(),
      ),
    );
    await settle(t);
    return ProviderScope.containerOf(t.element(find.byType(Scaffold).first));
  }

  GoRouter router(WidgetTester t) =>
      GoRouter.of(t.element(find.byType(Scaffold).last));

  testWidgets('계정 제한 띠의 "소명하기" → 쓰고 신청 → 지원센터 내 문의에 결정 대기로', (t) async {
    final appeals = MockAppealRepository(latency: Duration.zero);
    await pumpApp(t, appeals: appeals, restriction: Restriction.suspended);
    await t.tap(find.byKey(const ValueKey('appeal-restriction')));
    await settle(t);
    expect(find.text('계정 제한 소명'), findsOneWidget);
    // 내용이 없으면 보낼 수 없다
    final submit = find.byKey(const ValueKey('appeal-submit'));
    expect(
      t
          .widget<FilledButton>(
            find.descendant(of: submit, matching: find.byType(FilledButton)),
          )
          .onPressed,
      isNull,
    );
    await t.enterText(
      find.byKey(const ValueKey('appeal-body')),
      '파손은 포장 불량이었어요',
    );
    await settle(t);
    await t.tap(submit);
    await settle(t);
    expect(find.byKey(const ValueKey('appeal-done')), findsOneWidget);

    await t.tap(find.text('신청 내역'));
    await t.pump(const Duration(seconds: 1));
    await settle(t);
    // 한 목록이라 아래쪽 줄은 내려서 본다.
    await t.scrollUntilVisible(
      find.text('결정 이유: 경로 확인 결과 정상 산정이에요.'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('결정 대기'), findsOneWidget);
    expect(find.text('파손은 포장 불량이었어요'), findsOneWidget);
    // 앞서 결정된 신청은 결정 이유와 함께
    expect(find.text('결정 이유: 경로 확인 결과 정상 산정이에요.'), findsOneWidget);
    // 내 신청은 보상금을 보려고 정산내역도 읽는다(목 지연) — 끝까지 기다린다
    await t.pump(const Duration(seconds: 1));
  });

  testWidgets('같은 대상에 두 번 신청하면 "이미 신청" 안내(409 APPEAL_EXISTS)', (t) async {
    final appeals = MockAppealRepository(latency: Duration.zero);
    await t.runAsync(
      () => appeals.submit(
        target: AppealTarget.earning,
        deliveryId: 'dlv-1',
        body: '먼저 낸 이의',
        key: IdempotencyKey.generate(),
      ),
    );
    await pumpApp(t, appeals: appeals);
    router(t).go('/my/appeals/new?type=earning&deliveryId=dlv-1');
    await settle(t);
    expect(find.text('수행료 이의 신청'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('appeal-body')), '또 냄');
    await settle(t);
    await t.tap(find.byKey(const ValueKey('appeal-submit')));
    await settle(t);
    expect(find.byKey(const ValueKey('appeal-error')), findsOneWidget);
    expect(find.textContaining('이미 신청이 있어요'), findsOneWidget);
  });

  testWidgets('정산내역의 산정 불가 줄에 "이의 신청"', (t) async {
    await pumpApp(t, appeals: MockAppealRepository(latency: Duration.zero));
    router(t).go('/my/settlements');
    // 목 정산내역은 조금 늦게 온다
    await settle(t);
    await t.pump(const Duration(seconds: 1));
    await settle(t);
    expect(find.byKey(const ValueKey('appeal-earning-3')), findsOneWidget);
    expect(find.byKey(const ValueKey('appeal-earning-0')), findsNothing);
    await t.tap(find.byKey(const ValueKey('appeal-earning-3')));
    await settle(t);
    expect(find.text('수행료 이의 신청'), findsOneWidget);
  });

  test('목: 같은 키로 다시 보내면 같은 신청(새로 만들지 않는다)', () async {
    final appeals = MockAppealRepository(latency: Duration.zero);
    final key = IdempotencyKey.generate();
    final a = await appeals.submit(
      target: AppealTarget.restriction,
      body: '사정',
      key: key,
    );
    final b = await appeals.submit(
      target: AppealTarget.restriction,
      body: '사정',
      key: key,
    );
    expect(b.appealId, a.appealId);
    expect(
      (await appeals.mine()).where((x) => x.state == AppealState.open),
      hasLength(1),
    );
  });

  testWidgets('정산내역에 이의 인정 보상 줄, 내 신청의 인정 건에 보상금', (t) async {
    await pumpApp(t, appeals: MockAppealRepository(latency: Duration.zero));
    router(t).go('/my/settlements');
    await settle(t);
    await t.pump(const Duration(seconds: 1));
    await settle(t);
    expect(find.byKey(const ValueKey('compensation-4')), findsOneWidget);
    expect(find.textContaining('이의 인정 보상'), findsOneWidget);
    expect(find.textContaining('지급 예정일 2026-11-20'), findsOneWidget);
    expect(find.text('1,500원'), findsOneWidget);
    expect(find.text('엘리베이터 고장 확인'), findsOneWidget); // 보상 사유
    // 보상금 줄에는 "이의 신청"을 붙이지 않는다
    expect(find.byKey(const ValueKey('appeal-earning-4')), findsNothing);

    router(t).go('/my/appeals');
    await settle(t);
    await t.pump(const Duration(seconds: 1));
    await settle(t);
    expect(
      find.byKey(const ValueKey('appeal-compensation-AP-mock-A')),
      findsOneWidget,
    );
    expect(find.text('보상금 1,500원'), findsOneWidget);
  });

  testWidgets('보상금만 못 읽으면 수행료는 보이고 "일부만" 띠', (t) async {
    final records = MockRecordsRepository(latency: Duration.zero)
      ..failCompensations = true;
    await pumpApp(
      t,
      appeals: MockAppealRepository(latency: Duration.zero),
      records: records,
    );
    router(t).go('/my/settlements');
    await settle(t);
    expect(find.byKey(const ValueKey('ui-partial')), findsOneWidget);
    expect(find.byKey(const ValueKey('settlement-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('compensation-4')), findsNothing);
  });

  testWidgets('지원센터: 탭 없이 "내 문의" 한 목록(문의·소명·이의, 최신이 위 — 사용자 2026-11-25)', (
    t,
  ) async {
    await pumpApp(t, appeals: MockAppealRepository(latency: Duration.zero));
    router(t).go('/my');
    await settle(t);
    await t.tap(find.byKey(const ValueKey('menu-inquiries')));
    await t.pump(const Duration(seconds: 2));
    await settle(t);
    expect(find.byKey(const ValueKey('menu-appeals')), findsNothing);
    expect(find.byKey(const ValueKey('support-list')), findsOneWidget);
    expect(find.byKey(const ValueKey('live-chat')), findsOneWidget);
    expect(find.byKey(const ValueKey('inquiry-new')), findsOneWidget);
    expect(find.byType(TabBar), findsNothing);
    expect(find.text('내 문의'), findsOneWidget);
    await t.scrollUntilVisible(
      find.text('결정 이유: 경로 확인 결과 정상 산정이에요.'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    // 최신이 위: 11-17 인정 줄이 11-16 유지 줄보다 위.
    final rows = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('appeal-AP-'),
    );
    final ys = [
      for (final e in rows.evaluate()) t.getTopLeft(find.byWidget(e.widget)).dy,
    ];
    expect(ys.length, greaterThanOrEqualTo(2));
    expect(ys, orderedEquals([...ys]..sort()));
    await t.pump(const Duration(seconds: 2)); // 목 지연(문의·정산) 끝까지
  });

  testWidgets('문의 남기기에서 "계정 제한 소명"·"수행료 이의"를 고르면 이의 신청으로 간다', (t) async {
    await pumpApp(t, appeals: MockAppealRepository(latency: Duration.zero));
    router(t).go('/my/inquiries/new');
    await settle(t);
    await t.tap(find.byKey(const ValueKey('inq-kind-appeal-restriction')));
    await settle(t);
    expect(find.byKey(const ValueKey('appeal-body')), findsOneWidget);
    expect(find.text('계정 제한 소명'), findsOneWidget);

    router(t).go('/my/inquiries/new');
    await settle(t);
    await t.tap(find.byKey(const ValueKey('inq-kind-appeal-earning')));
    await t.pump(const Duration(seconds: 1));
    await settle(t);
    // 목 정산내역에 배송 ID 줄이 없으면 안내만, 있으면 배송 고르기.
    final pick = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('appeal-pick-'),
    );
    if (pick.evaluate().isEmpty) {
      expect(find.text('이의 신청할 수 있는 배송이 없어요'), findsOneWidget);
    } else {
      await t.tap(pick.first);
      await settle(t);
      expect(find.text('수행료 이의 신청'), findsOneWidget);
      expect(find.byKey(const ValueKey('appeal-body')), findsOneWidget);
    }
    await t.pump(const Duration(seconds: 5));
    await settle(t);
  });
}
