import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart';
import 'package:customer_app/features/checkout/presentation/checkout_controller.dart';
import 'package:customer_app/features/orders/data/mock_orders_repository.dart';
import 'package:customer_app/features/payment/data/payment_repository.dart';
import 'package:customer_app/features/payment/domain/payment.dart';
import 'package:customer_app/features/payment/presentation/payment_controller.dart';
import 'package:customer_app/features/redelivery/data/mock_redelivery_payments_repository.dart';

import 'support/app_harness.dart';

void main() {
  setUpAll(initPmartFormatting);
  final now = DateTime.utc(2026, 10, 24, 3); // 서울 12:00

  late MockRedeliveryPaymentsRepository redelivery;
  late MockCheckoutRepository checkout;
  late MockPgLauncher pg;

  setUp(() {
    // 배송 중인 목 주문(order-seed-1)에 결제 대기 1건(기한 12:30).
    redelivery = MockRedeliveryPaymentsRepository(
      latency: Duration.zero,
      now: () => now,
    );
    checkout = MockCheckoutRepository(latency: Duration.zero, now: () => now);
    pg = MockPgLauncher();
  });

  Future<void> openOrder(
    WidgetTester t, {
    String orderId = 'order-seed-1',
  }) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      testApp(
        checkout: checkout,
        orders: MockOrdersRepository(latency: Duration.zero, now: () => now),
        redelivery: redelivery,
        [
          clockProvider.overrideWithValue(() => now),
          pgLauncherProvider.overrideWithValue(pg),
        ],
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.text('마이페이지').last);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-login')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('login-kakao')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-orders')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(ValueKey('order-$orderId')));
    await t.pumpAndSettle();
  }

  Future<void> openPayment(WidgetTester t) async {
    await openOrder(t);
    await t.tap(find.byKey(const ValueKey('rdp-open-rdp-1')));
    await t.pumpAndSettle();
  }

  String phase(WidgetTester t) =>
      t.widget<Text>(find.byKey(const ValueKey('rdp-phase'))).data!;

  testWidgets('주문 상세에 결제 대기 안내 — 서버 금액·기한(남은 분)', (t) async {
    await openOrder(t);
    expect(find.byKey(const ValueKey('rdp-rdp-1')), findsOneWidget);
    expect(find.text('다시 배송비 결제가 필요해요'), findsOneWidget);
    expect(
      find.text('입력한 주소와 다른 곳에 배달돼, 실제 주소로 다시 보내려면 9,000원을 결제해야 해요'),
      findsOneWidget,
    );
    expect(find.text('오후 12:30까지 결제 · 30분 남음'), findsOneWidget);
  });

  testWidgets('결제 건이 없는 주문에는 아무것도 없다', (t) async {
    await openOrder(t, orderId: 'order-seed-4');
    expect(find.text('다시 배송비 결제가 필요해요'), findsNothing);
    expect(find.byKey(const ValueKey('rdp-load-failed')), findsNothing);
  });

  testWidgets('조회 실패는 "결제 건 없음"이 아니라 실패 안내', (t) async {
    redelivery.listFails = true;
    await openOrder(t);
    expect(find.byKey(const ValueKey('rdp-load-failed')), findsOneWidget);
    expect(find.text('다시 배송비 결제 정보를 불러오지 못했어요'), findsOneWidget);
  });

  testWidgets('결제 → 승인 요청 → 서버가 PAID 를 준 뒤에만 "결제했어요"', (t) async {
    await openPayment(t);
    expect(find.text('9,000원 결제하기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('rdp-pay')));
    await t.pumpAndSettle();

    expect(pg.launches, 1);
    // 결제창 orderId = paymentAttemptId, 금액은 서버 값.
    expect(checkout.authKeys, hasLength(1));
    expect(phase(t), '다시 배송비를 결제했어요. 실제 주소로 다시 보내 드려요');
    expect(find.byKey(const ValueKey('rdp-pay')), findsNothing);
    expect(find.byKey(const ValueKey('rdp-decline')), findsNothing);

    // 주문 상세로 돌아가면 결제됨으로 보인다.
    Navigator.of(t.element(find.byKey(const ValueKey('rdp-phase')))).pop();
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('rdp-status-rdp-1')), findsOneWidget);
  });

  testWidgets('결제창을 닫으면 실패 보고 뒤 "다시 결제하기" — 새 결제 시도로 다시 연다', (t) async {
    pg.next = const PgCancelled();
    await openPayment(t);
    await t.tap(find.byKey(const ValueKey('rdp-pay')));
    await t.pumpAndSettle();

    expect(phase(t), '결제를 취소했어요. 기한 안에 다시 결제할 수 있어요');
    expect(checkout.authFailures.single.$2, tossUserCancelCode);
    expect(find.text('다시 결제하기'), findsOneWidget);

    await t.tap(find.byKey(const ValueKey('rdp-pay')));
    await t.pumpAndSettle();
    expect(redelivery.commands.map((c) => c.$1), ['retry']);
    expect(pg.launches, 2);
    expect(phase(t), '다시 배송비를 결제했어요. 실제 주소로 다시 보내 드려요');
  });

  testWidgets('승인 결과가 아직 없으면 "확인 중" — 다시 결제·환불 고르기 없음', (t) async {
    redelivery.approval = MockRedeliveryApproval.pending;
    await openPayment(t);
    await t.tap(find.byKey(const ValueKey('rdp-pay')));
    await t.pumpAndSettle();

    expect(phase(t), isNot(contains('결제했어요')));
    expect(find.byKey(const ValueKey('rdp-check-again')), findsOneWidget);
    expect(find.byKey(const ValueKey('rdp-pay')), findsNothing);
    expect(find.byKey(const ValueKey('rdp-decline')), findsNothing);
    expect(
      find.text('결과가 나올 때까지 다시 결제하지 마세요. 두 번 결제되지 않도록 확인하고 있어요'),
      findsOneWidget,
    );

    // 서버가 결제됨으로 바꾼 뒤 "다시 확인".
    redelivery.setStatus('rdp-1', 'PAID');
    await t.tap(find.byKey(const ValueKey('rdp-check-again')));
    await t.pumpAndSettle();
    expect(phase(t), '다시 배송비를 결제했어요. 실제 주소로 다시 보내 드려요');
  });

  testWidgets('결제하지 않고 환불받기 — 확인 뒤 한 번 보내고 서버 상태(DECLINED)를 보인다', (t) async {
    await openPayment(t);
    await t.tap(find.byKey(const ValueKey('rdp-decline')));
    await t.pumpAndSettle();
    expect(find.text('결제하지 않고 환불받을까요?'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('rdp-decline-confirm')));
    await t.pumpAndSettle();

    expect(redelivery.commands.map((c) => c.$1), ['decline']);
    expect(pg.launches, 0);
    expect(phase(t), '회수 후 환불을 골랐어요. 상품을 회수한 뒤 환불해 드려요');
  });

  testWidgets('이미 결제된 건에 환불 고르기 → 409 ALREADY_PAID 안내 뒤 서버 상태', (t) async {
    await openPayment(t);
    // 화면을 연 뒤 다른 기기에서 결제됨.
    redelivery.setStatus('rdp-1', 'PAID');
    await t.tap(find.byKey(const ValueKey('rdp-decline')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('rdp-decline-confirm')));
    await t.pumpAndSettle();
    expect(phase(t), '다시 배송비를 결제했어요. 실제 주소로 다시 보내 드려요');
  });

  testWidgets('기한이 지난 건은 결제창을 열지 않는다', (t) async {
    redelivery = MockRedeliveryPaymentsRepository(
      latency: Duration.zero,
      now: () => now,
      seeded: false,
    )..seed(orderId: 'order-seed-1', left: const Duration(minutes: -1));
    await openOrder(t);
    expect(find.text('결제 기한이 지났어요. 곧 회수 후 환불로 바뀌어요'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('rdp-open-rdp-1')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('rdp-pay')));
    await t.pumpAndSettle();
    expect(pg.launches, 0);
  });

  test('목: 금액이 다르면 승인하지 않는다', () {
    final r = MockRedeliveryPaymentsRepository(latency: Duration.zero);
    expect(
      r.submitAuth(
        const PgAuthenticated(
          paymentKey: 'k',
          pgOrderId: 'PAY-RDL-rdp-1-1',
          amount: 1000,
        ),
      ),
      AuthSubmitResult.rejected,
    );
  });
}
