// 2026-11-23 사용자 지적 묶음 — 목 기준 프레임 확인.
// - 같은 가게 알뜰 2건: 가게 도착 한 번 → QR 한 화면 → 함께 픽업 → 1번 고객 → 2번 고객.
// - 가게 도착 버튼: 가볍게 톡 쳐도 눌림 효과가 끝까지 보인다.
// - 도움요청 화면: 투명해지지 않고 아래로 내려가며 닫힌다, 그동안 아래 배송 화면은 계속 그린다.
// - 배달완료 카드: 진행 중 목록을 다시 읽어도 눌러 닫을 때까지 남는다.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/delivery/presentation/pickup_group.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

void main() {
  setUpAll(initPmartFormatting);

  test('전달 순서 — 서버 stopSequence 가 먼저, 없으면 수락 때 받아 둔 값, 그것도 없으면 배정 순서', () {
    DeliveryView v(String id, {int? stop}) => DeliveryView(
      deliveryId: id,
      version: 1,
      state: ExecutionState.pickedUp,
      packageIds: const [],
      handoverIds: const [],
      mfcId: 'MFC-1',
      stopSequence: stop,
    );
    final a = v('a', stop: 2);
    final b = v('b', stop: 1);
    // 서버 값이 수락 때 값보다 먼저.
    expect(
      orderByStop([a, b], [a, b], {'a': 1, 'b': 2}).map((x) => x.deliveryId),
      ['b', 'a'],
    );
    final c = v('c');
    final d = v('d');
    expect(
      orderByStop([c, d], [c, d], {'d': 1, 'c': 2}).map((x) => x.deliveryId),
      ['d', 'c'],
    );
    expect(orderByStop([d, c], [c, d], const {}).map((x) => x.deliveryId), [
      'c',
      'd',
    ]);
    expect(nextCustomerStop([a, b], const {})?.deliveryId, 'b');
    expect(nextCustomerStop([a, b], const {}, exceptId: 'b')?.deliveryId, 'a');
  });

  late MockDeliveryRepository repo;

  Future<ProviderContainer> start(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final store = MemoryKeyValueStore();
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
    );
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          deliveryRepositoryProvider.overrideWithValue(repo),
          handoverRepositoryProvider.overrideWithValue(repo),
          evidenceUploaderProvider.overrideWithValue(repo),
          supportThreadRepositoryProvider.overrideWithValue(repo),
          secureStoreProvider.overrideWithValue(store),
          fieldQueueStoreProvider.overrideWithValue(store),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    await settle(t);
    return ProviderScope.containerOf(t.element(find.byType(RiderApp)));
  }

  String path(WidgetTester t) =>
      GoRouter.of(t.element(find.byType(Scaffold).last))
          .routerDelegate
          .currentConfiguration
          .uri
          .path;

  Future<void> openDelivery(WidgetTester t, String id) async {
    GoRouter.of(t.element(find.byType(Scaffold).first)).go('/deliveries/$id');
    await settle(t);
    // 시트를 펼쳐 진행 버튼을 띄운다.
    await t.tap(find.byKey(const ValueKey('sheet-handle')).last);
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
  }

  testWidgets('같은 가게 알뜰 2건 — 가게 도착 한 번, QR 한 화면, 함께 픽업 → 1번 고객 → 2번 고객', (
    t,
  ) async {
    repo = MockDeliveryRepository(
      latency: Duration.zero,
      seeded: false,
      demoBundle: true,
      visible: (id) => id == 'dlv-b1' || id == 'dlv-b2',
    );
    final c = await start(t);
    // 서버가 준 전달 순서가 없는 경우(옛 서버): 수락 때 받아 둔 순서 b2 → b1 을 쓴다.
    for (final id in ['dlv-b1', 'dlv-b2']) {
      repo.deliveryJson(id)
        ..remove('bundleId')
        ..remove('stopSequence');
    }
    c.read(bundleStopsProvider.notifier)
      ..put('dlv-b2', 1)
      ..put('dlv-b1', 2);
    c.read(assignedDeliveriesProvider.notifier)
      ..add('dlv-b1')
      ..add('dlv-b2');
    await openDelivery(t, 'dlv-b1');

    final arrive = find.byKey(const ValueKey('arrive-store'));
    expect(find.text('가게 도착 (2건 함께)'), findsOneWidget);
    await t.tap(arrive);
    await settle(t);
    expect(repo.deliveryJson('dlv-b1')['state'], 'ARRIVED_AT_STORE');
    expect(repo.deliveryJson('dlv-b2')['state'], 'ARRIVED_AT_STORE');

    expect(find.text('QR코드 픽업 (2건 함께)'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('qr-pickup')));
    await settle(t);
    // 두 주문이 한 화면에(방문 순서대로).
    expect(find.byKey(const ValueKey('group-row-dlv-b2')), findsOneWidget);
    expect(find.byKey(const ValueKey('group-row-dlv-b1')), findsOneWidget);
    expect(find.text('포장 인계 0 / 2'), findsOneWidget);
    final pickup = find.byKey(const ValueKey('pickup'));
    expect(find.text('2건 픽업 완료'), findsOneWidget);

    Future<void> enter(String pkg) async {
      await t.enterText(
        find.byKey(const ValueKey('qr-number')),
        MockDeliveryRepository.labelNumbers[pkg]!,
      );
      await t.tap(find.byKey(const ValueKey('qr-number-submit')));
      await settle(t);
    }

    // 숫자는 아직 다 안 받은 첫 주문(1번 = b2 포장 pkg-4)부터.
    await enter('pkg-4');
    expect(find.text('포장 인계 1 / 2'), findsOneWidget);
    expect(t.widget<RiderButton>(pickup).onPressed, isNull);
    await enter('pkg-3');
    expect(find.text('포장 인계 2 / 2'), findsOneWidget);
    expect(t.widget<RiderButton>(pickup).onPressed, isNotNull);
    await t.tap(pickup);
    await settle(t);
    await settle(t);
    expect(repo.deliveryJson('dlv-b1')['state'], 'PICKED_UP');
    expect(repo.deliveryJson('dlv-b2')['state'], 'PICKED_UP');
    // 픽업 뒤 먼저 갈 고객 = 1번(b2).
    expect(path(t), '/deliveries/dlv-b2');

    // 1번 고객 전달 완료(서버 확정 흉내) → 완료 카드 → 닫으면 2번 고객으로.
    repo.deliveryJson('dlv-b2')['state'] = 'COMPLETED';
    c.invalidate(deliveryProvider('dlv-b2'));
    await settle(t);
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    // 진행 중 목록을 다시 읽어도(완료 건이 빠짐) 카드가 남는다.
    c.invalidate(myActiveDeliveriesProvider);
    await settle(t);
    await t.pump(const Duration(seconds: 3));
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('done-close')));
    await settle(t);
    expect(path(t), '/deliveries/dlv-b2'.replaceFirst('b2', 'b1'));
    await t.pump(const Duration(seconds: 2));
  });

  testWidgets('홈 지도 위 배송 — 완료 뒤 진행 중 목록을 다시 읽어도 배달완료 카드가 눌러 닫을 때까지 남는다', (
    t,
  ) async {
    // 앱을 다시 켠 상황: 이번 실행에 수락한 기록이 없어 홈은 서버 진행 중 목록만으로 배송 화면을 띄운다
    // (사용자 2026-11-23 "배달완료도 너무 빨리 사라지잖아" — 이 경우 목록에서 빠지면 카드째 사라졌다).
    repo = MockDeliveryRepository(latency: Duration.zero);
    final c = await start(t);
    await settle(t);
    expect(path(t), '/');
    expect(find.byKey(const ValueKey('delivery-sheet')), findsOneWidget);
    expect(c.read(assignedDeliveriesProvider), isEmpty);
    repo.deliveryJson('dlv-1')['state'] = 'COMPLETED';
    c.invalidate(deliveryProvider('dlv-1'));
    await settle(t);
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    // 서버 진행 중 목록에서 빠졌다.
    c.invalidate(myActiveDeliveriesProvider);
    await settle(t);
    expect(
      (await c.read(myActiveDeliveriesProvider.future))
          .map((d) => d.deliveryId),
      isNot(contains('dlv-1')),
    );
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(seconds: 1));
    }
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('done-close')));
    await settle(t);
    expect(find.byKey(const ValueKey('delivery-done')), findsNothing);
    expect(find.byKey(const ValueKey('delivery-sheet')), findsNothing);
  });

  testWidgets('가게 도착 버튼 — 가볍게 톡 쳐도 눌림 효과가 끝까지 보이고 돌아온다', (t) async {
    var pressed = 0;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: RiderButton(label: '가게 도착', onPressed: () => pressed++),
          ),
        ),
      ),
    );
    double scale() => t
        .widget<Transform>(
          find
              .descendant(
                of: find.byType(RiderButton),
                matching: find.byType(Transform),
              )
              .first,
        )
        .transform
        .entry(0, 0);
    // 30ms 만에 떼는 가벼운 톡.
    final g = await t.startGesture(t.getCenter(find.byType(RiderButton)));
    await t.pump(const Duration(milliseconds: 30));
    await g.up();
    final seen = <double>[];
    for (var i = 0; i < 20; i++) {
      await t.pump(const Duration(milliseconds: 16));
      seen.add(scale());
    }
    // ignore: avoid_print
    print('tap scale: ${seen.map((v) => v.toStringAsFixed(3)).join(' ')}');
    expect(pressed, 1);
    expect(seen.reduce((a, b) => a < b ? a : b), lessThan(0.97));
    expect(seen.last, closeTo(1, 0.001));
  });

  testWidgets('도움요청 화면 — 투명해지지 않고 내려가며 닫히고, 아래 배송 화면은 계속 그린다', (t) async {
    repo = MockDeliveryRepository(latency: Duration.zero);
    await start(t);
    await openDelivery(t, 'dlv-1');
    final router = GoRouter.of(t.element(find.byType(Scaffold).first));
    unawaited(router.push('/deliveries/dlv-1/support'));
    await settle(t);
    await t.pump(const Duration(milliseconds: 400));
    // 열린 동안에도 아래 배송 화면(지도 쪽)이 그려진다(가려져 멈췄다가 닫을 때 옛 그림이 보이지 않게).
    expect(
      find.byKey(const ValueKey('delivery-sheet'), skipOffstage: true),
      findsOneWidget,
    );
    router.pop();
    final tops = <double>[];
    for (var i = 0; i < 18; i++) {
      await t.pump(const Duration(milliseconds: 16));
      final fades = find
          .byType(FadeTransition)
          .evaluate()
          .map((e) => (e.widget as FadeTransition).opacity.value);
      // 닫는 동안 반투명한 화면이 없다.
      expect(fades.where((o) => o > 0.01 && o < 0.99), isEmpty);
      final support = find.text('지원센터');
      if (support.evaluate().isNotEmpty) {
        tops.add(t.getTopLeft(support.first).dy);
      }
    }
    // ignore: avoid_print
    print(
      'help close top y: ${tops.map((v) => v.toStringAsFixed(0)).join(' ')}',
    );
    for (var i = 1; i < tops.length; i++) {
      expect(tops[i], greaterThanOrEqualTo(tops[i - 1]));
    }
    expect(find.text('지원센터'), findsNothing);
  });
}

Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 8; i++) {
    await t.pump(const Duration(milliseconds: 20));
  }
}

void unawaited(Future<void> f) {}
