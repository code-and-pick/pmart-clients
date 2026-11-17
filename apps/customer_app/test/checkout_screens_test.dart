import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart' show ProblemDetail;
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart';
import 'package:customer_app/features/checkout/domain/checkout.dart';
import 'package:customer_app/features/checkout/presentation/checkout_controller.dart';

import 'support/app_harness.dart';

void main() {
  setUpAll(initPmartFormatting);

  final now = DateTime.utc(2026, 10, 24, 3); // 서울 12:00

  Widget app(MockCheckoutRepository checkout) => testApp(checkout: checkout, [
    clockProvider.overrideWithValue(() => now),
    draftPollPolicyProvider.overrideWithValue((
      interval: Duration.zero,
      attempts: 3,
    )),
  ]);

  Future<void> toDelivery(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpAndSettle();
    await t.tap(find.text('장바구니').last);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('cart-order')));
    await t.pumpAndSettle();
    // 비회원이라 주문 목적 로그인을 거친다.
    expect(find.text('주문하려면 로그인이 필요해요'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('login-kakao')));
    await t.pumpAndSettle();
  }

  testWidgets('최소주문 미달이면(서버 판정) 주문서로 넘어가지 않고 장바구니로 안내한다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    await t.pumpWidget(app(checkout));
    await toDelivery(t);

    expect(find.text('배송 방식 선택'), findsOneWidget);
    final next = find.byKey(const ValueKey('delivery-next'));
    expect(t.widget<FilledButton>(next).onPressed, isNull);

    await t.tap(find.byKey(const ValueKey('mode-single')));
    await t.pump();
    await t.tap(next);
    await t.pumpAndSettle();

    // 목 서버: 상품액 7,940원 → minOrderSatisfied=false. 앱은 금액을 비교하지 않는다.
    expect(find.text('주문서'), findsNothing);
    expect(find.text('배송 방식 선택'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-min-order')), findsOneWidget);
    // 부족액은 서버 값(minOrderShortfall). 목 서버: 15,000 − 7,940.
    expect(find.text('7,060원 더 담으면 주문할 수 있어요'), findsOneWidget);

    await t.tap(find.text('장바구니 보기'));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('cart-order')), findsOneWidget);
  });

  testWidgets('주문서 화면은 그래도 서버의 최소주문 판정으로 결제를 막는다(방어)', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    await t.pumpWidget(app(checkout));
    await toDelivery(t);
    await t.tap(find.byKey(const ValueKey('mode-single')));
    await t.pump();
    // 배송 선택 단계를 건너뛰고 주문서로 바로 들어온 경우(뒤로 가기·딥링크 등)
    final router = GoRouter.of(t.element(find.text('배송 방식 선택')));
    unawaited(router.push('/checkout'));
    await t.pumpAndSettle();

    expect(find.text('주문서'), findsOneWidget);
    expect(find.byKey(const ValueKey('min-order')), findsOneWidget);
    expect(find.text('12,040원'), findsOneWidget); // 7,940 + 4,000 + 100 (목 서버)
    final pay = t.widget<FilledButton>(
      find.descendant(
        of: find.byKey(const ValueKey('pay')),
        matching: find.byType(FilledButton),
      ),
    );
    expect(pay.onPressed, isNull);
    // 결제 버튼에는 서버가 준 첫 막는 사유가 보인다. 부족액은 서버 값.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('pay')),
        matching: find.text('최소 주문금액 미달'),
      ),
      findsOneWidget,
    );
    expect(find.text('7,060원 더 담으면 주문할 수 있어요'), findsOneWidget);
  });

  testWidgets('예약은 고를 수 있는 슬롯만 열리고 마감·미설정은 막힌다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    await t.pumpWidget(app(checkout));
    await toDelivery(t);

    await t.tap(find.byKey(const ValueKey('mode-scheduled')));
    await t.pumpAndSettle();

    ChoiceChip chip(String start) =>
        t.widget<ChoiceChip>(find.byKey(ValueKey('slot-2026-10-24-$start')));
    // 서울 12시: 13시 도착은 마감(12시 컷오프 지남), 21시는 정원 미설정.
    expect(chip('13:00').onSelected, isNull);
    expect(chip('21:00').onSelected, isNull);
    expect(find.textContaining('준비 중'), findsOneWidget);
    expect(chip('15:00').onSelected, isNotNull);

    final next = find.byKey(const ValueKey('delivery-next'));
    expect(t.widget<FilledButton>(next).onPressed, isNull);
    await t.tap(find.byKey(const ValueKey('slot-2026-10-24-15:00')));
    await t.pump();
    expect(t.widget<FilledButton>(next).onPressed, isNotNull);
  });

  testWidgets('BR-13: 지금 안 되는 방식은 서버 사유와 함께 막힌다', (t) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    )..unavailable = {DeliveryMode.single: 'NIGHT_TIME'};
    await t.pumpWidget(app(checkout));
    await toDelivery(t);

    final tile = t.widget<RadioListTile<DeliveryMode>>(
      find.byKey(const ValueKey('mode-single')),
    );
    expect(tile.enabled, isFalse);
    expect(find.text('심야(00~08시)에는 바로 배달이 없어요. 예약으로 받아 주세요'), findsOneWidget);
  });

  testWidgets('초안이 409 MFC_CHANGED 로 거절되면 주문서로 가지 않고 사유와 장바구니로 가는 길을 보인다', (
    t,
  ) async {
    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    )..rejectNextDraft = CheckoutProblemCode.mfcChanged;
    await t.pumpWidget(app(checkout));
    await toDelivery(t);
    await t.tap(find.byKey(const ValueKey('mode-single')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('delivery-next')));
    await t.pumpAndSettle();

    expect(find.text('주문서'), findsNothing);
    expect(find.byKey(const ValueKey('delivery-rejected')), findsOneWidget);
    expect(
      find.text('주소의 담당 센터가 바뀌었어요. 장바구니와 배송 방식을 다시 확인해 주세요'),
      findsOneWidget,
    );
    await t.tap(find.text('장바구니 보기'));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('cart-order')), findsOneWidget);
  });

  testWidgets(
    '초안이 422 INSUFFICIENT_STOCK 이면 주문서로 가지 않고 장바구니로 돌아가 남은 수량을 보이고, 취급 안 함 상품은 숨긴다',
    (t) async {
      final checkout =
          MockCheckoutRepository(latency: Duration.zero, now: () => now)
            ..rejectNextDraft = CheckoutProblemCode.insufficientStock
            ..rejectNextDraftDetails = const [
              ProblemDetail(
                field: 'E-00000001',
                reason: 'requestedQty=2;availableQty=1',
              ),
              ProblemDetail(field: 'E-00000005', reason: 'NOT_HANDLED'),
            ];
      await t.pumpWidget(app(checkout));
      await toDelivery(t);
      await t.tap(find.byKey(const ValueKey('mode-single')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('delivery-next')));
      await t.pumpAndSettle();

      expect(find.text('주문서'), findsNothing);
      expect(find.text('배송 방식 선택'), findsNothing);
      expect(find.byKey(const ValueKey('cart-order')), findsOneWidget);
      expect(
        find.text('재고가 부족한 상품이 있어요. 장바구니에서 수량을 줄이거나 빼 주세요'),
        findsOneWidget,
      );
      Finder inLine(String id, String text) => find.descendant(
        of: find.byKey(ValueKey('cart-line-$id')),
        matching: find.text(text),
      );
      expect(inLine('ci-1', '지금 1개까지 있어요'), findsOneWidget);
      // 지금 주소로 배달하지 않는 상품은 목록에서 숨긴다(서버 장바구니에는 남음).
      expect(find.byKey(const ValueKey('cart-line-ci-2')), findsNothing);

      // 수량을 서버가 본 가용(1개)까지 줄이면 그 줄의 안내는 사라진다. 숨긴 상품은 계속 숨김.
      await t.tap(find.byKey(const ValueKey('cart-dec-ci-1')));
      await t.pumpAndSettle();
      expect(inLine('ci-1', '지금 1개까지 있어요'), findsNothing);
      expect(find.byKey(const ValueKey('cart-line-ci-2')), findsNothing);
    },
  );

  test('stockShortagesOf: details 를 SKU 별로 읽고, 모르는 reason 은 수량 없이 둔다', () {
    final m = stockShortagesOf([
      (field: 'A', reason: 'requestedQty=3;availableQty=0'),
      (field: 'B', reason: 'NOT_HANDLED'),
      (field: 'C', reason: 'SOMETHING_NEW'),
      (field: null, reason: 'NOT_HANDLED'),
    ]);
    expect(m.keys, ['A', 'B', 'C']);
    expect(m['A']!.availableQty, 0);
    expect(m['A']!.requestedQty, 3);
    expect(m['A']!.stillShortAt(1), isTrue);
    expect(m['A']!.stillShortAt(0), isFalse);
    expect(m['B']!.notHandled, isTrue);
    expect(m['B']!.stillShortAt(1), isTrue);
    expect(m['C']!.availableQty, isNull);
    expect(m['C']!.stillShortAt(1), isTrue);
  });
}
