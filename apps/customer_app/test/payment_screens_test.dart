import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart';
import 'package:customer_app/features/checkout/presentation/checkout_controller.dart';
import 'package:customer_app/features/orders/data/mock_orders_repository.dart';

import 'support/app_harness.dart';

void main() {
  setUpAll(initPmartFormatting);
  final now = DateTime.utc(2026, 10, 24, 3);

  Future<void> toPayment(
    WidgetTester t,
    MockCheckoutRepository checkout, {
    MockOrdersRepository? orders,
  }) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      testApp(checkout: checkout, orders: orders, [
        clockProvider.overrideWithValue(() => now),
        draftPollPolicyProvider.overrideWithValue((
          interval: Duration.zero,
          attempts: 3,
        )),
      ]),
    );
    await t.pumpAndSettle();
    await t.tap(find.text('장바구니').last);
    await t.pumpAndSettle();
    // 최소주문을 채운다(서울우유 2 → 5).
    for (var i = 0; i < 3; i++) {
      await t.tap(find.byKey(const ValueKey('cart-inc-ci-1')));
      await t.pumpAndSettle();
    }
    await t.tap(find.byKey(const ValueKey('cart-order')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('login-kakao')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('mode-single')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('delivery-next')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('pay')));
    await t.pump();
    await t.pump();
  }

  // 로그인하면 회원 장바구니(목은 같은 장바구니)로 다시 열린다.
  testWidgets('주문서 결제 → 결제 화면 → 서버 확정 뒤에만 주문 완료와 주문번호', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    // 확정된 주문을 주문 조회가 돌려주도록 목 주문을 결제 목과 잇는다.
    await toPayment(
      t,
      checkout,
      orders: MockOrdersRepository(
        checkout: checkout,
        latency: Duration.zero,
        now: () => now,
      ),
    );
    await t.pumpAndSettle();

    expect(find.text('주문이 완료됐어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-id')), findsOneWidget);
    // 시스템 키(orderId)가 아니라 주문 조회의 화면용 주문번호 8자리(order 0.11.0).
    expect(
      t.widget<Text>(find.byKey(const ValueKey('order-id'))).data,
      matches(RegExp(r'^주문번호 [1-9][0-9]{7}$')),
    );
    expect(find.byKey(const ValueKey('pay-retry')), findsNothing);
  });

  testWidgets('결제 결과를 모르면 다시 결제 버튼 없이 확인만 할 수 있다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    )..approval = MockApproval.unknown;
    await toPayment(t, checkout);
    await t.pumpAndSettle();

    expect(find.text('결제 결과 확인 중'), findsOneWidget);
    expect(find.byKey(const ValueKey('pay-retry')), findsNothing);
    expect(find.byKey(const ValueKey('pay-check-again')), findsOneWidget);
    expect(find.text('주문이 완료됐어요'), findsNothing);

    checkout.resolveUnknownAsApproved();
    await t.tap(find.byKey(const ValueKey('pay-check-again')));
    await t.pumpAndSettle();
    expect(find.text('주문이 완료됐어요'), findsOneWidget);
  });

  testWidgets('결과를 모르는 결제는 홈에서 다시 확인하라고 알린다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    )..approval = MockApproval.unknown;
    await toPayment(t, checkout);
    await t.pumpAndSettle();

    // 결제 화면을 나와 홈으로 간다.
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.text('홈').last);
    await t.pumpAndSettle();

    expect(find.byKey(const ValueKey('pending-payment')), findsOneWidget);
  });

  testWidgets('주문 완료에서 주문 상세로 가면 서버 주문이 보인다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    await toPayment(
      t,
      checkout,
      orders: MockOrdersRepository(checkout: checkout, latency: Duration.zero),
    );
    await t.pumpAndSettle();

    await t.tap(find.byKey(const ValueKey('go-order')));
    await t.pumpAndSettle();

    expect(find.text('주문 상세'), findsOneWidget);
    expect(find.text('주문 확인'), findsOneWidget);
    expect(find.textContaining('서울우유 1L'), findsWidgets);

    // 상세 → 주문 내역 → (뒤에 화면이 없으니) 마이로 돌아갈 수 있다.
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    expect(find.text('주문 내역'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('orders-back')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('my-orders')), findsOneWidget);
  });
}
