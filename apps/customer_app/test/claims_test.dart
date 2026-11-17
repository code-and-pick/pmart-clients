import 'package:dio/dio.dart' show DioExceptionType;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';
import 'package:pmart_api_claim/pmart_api_claim.dart' as api;

import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart';
import 'package:customer_app/features/checkout/domain/checkout.dart';
import 'package:customer_app/features/checkout/presentation/checkout_controller.dart';
import 'package:customer_app/features/claims/data/claims_repository.dart'
    show claimFromContract;
import 'package:customer_app/features/claims/data/mock_claims_repository.dart';
import 'package:customer_app/features/claims/domain/claims.dart';
import 'package:customer_app/features/claims/presentation/claims_controller.dart';
import 'package:customer_app/features/orders/data/mock_orders_repository.dart';

import 'support/app_harness.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockOrdersRepository orders;
  late MockClaimsRepository claims;
  setUp(() {
    orders = MockOrdersRepository(latency: Duration.zero);
    claims = MockClaimsRepository(orders: orders, latency: Duration.zero);
  });

  // order-seed-4: ol-5 미이행 3개. 고객 취소는 주문 전체만.
  const seed4All = [CancelLine(orderLineId: 'ol-5', qty: 3)];

  Future<ClaimView> cancelSeed4() async {
    final outcome = await CancelRequester(claims)
        .submit('order-seed-4', seed4All, CancelReason.changeOfMind);
    return (outcome as CommandDone<ClaimView>).value;
  }

  group('주문 전체 취소 본문', () {
    test('모든 행 × 서버 미이행 수량, 미이행 0 인 행은 뺀다', () {
      final lines = wholeOrderCancelLines([
        (orderLineId: 'a', unfulfilledQty: 2),
        (orderLineId: 'b', unfulfilledQty: 0),
        (orderLineId: 'c', unfulfilledQty: 1),
      ])!;
      expect(
        [for (final l in lines) (l.orderLineId, l.qty)],
        [('a', 2), ('c', 1)],
      );
    });

    test('미이행 수량을 모르는 행이 있으면 본문을 만들지 않는다', () {
      expect(
        wholeOrderCancelLines([
          (orderLineId: 'a', unfulfilledQty: 2),
          (orderLineId: 'b', unfulfilledQty: null),
        ]),
        isNull,
      );
    });
  });

  test('사유 FULFILLMENT_REJECTED 는 깨지지 않고 자동 취소로 읽는다', () {
    final view = claimFromContract(
      api.Claim.fromJson({
        'claimId': 'c-1',
        'version': 1,
        'orderId': 'o-1',
        'type': 'CANCEL',
        'state': 'STOP_PENDING',
        'reason': 'FULFILLMENT_REJECTED',
      }),
    );
    expect(view.autoCancelled, isTrue);
    expect(
      claimFromContract(
        api.Claim.fromJson({'claimId': 'c-2', 'reason': 'CHANGE_OF_MIND'}),
      ).autoCancelled,
      isFalse,
    );
  });

  group('취소 요청', () {
    test('일부만 보내면 서버가 PARTIAL_CANCEL_NOT_ALLOWED 로 거절한다', () async {
      final outcome = await CancelRequester(claims).submit('order-seed-4', [
        const CancelLine(orderLineId: 'ol-5', qty: 1),
      ], CancelReason.changeOfMind);
      expect(
        (outcome as CommandRejected<ClaimView>).code,
        ClaimProblemCode.partialCancelNotAllowed,
      );
      expect(claims.claims, isEmpty);
    });

    test('501 은 한 번만 보내고 "준비 중" 거절로 끝낸다', () async {
      final repo = _ScriptedClaims(orders: orders)
        ..failures.add(
          const UnknownResultFailure(
            problem: Problem(status: 501, code: 'NOT_IMPLEMENTED'),
          ),
        );
      final outcome = await CancelRequester(repo)
          .submit('order-seed-4', seed4All, CancelReason.changeOfMind);
      expect(
        (outcome as CommandRejected<ClaimView>).code,
        ClaimProblemCode.notImplemented,
      );
      expect(repo.sent, 1);
    });

    test('4xx 는 다시 보내지 않는다', () async {
      final repo = _ScriptedClaims(orders: orders)
        ..failures.add(
          const ProblemFailure(
            Problem(status: 422, code: ClaimProblemCode.duplicateClaim),
          ),
        );
      final requester = CancelRequester(repo);
      final outcome = await requester.submit(
        'order-seed-4',
        seed4All,
        CancelReason.changeOfMind,
      );
      expect(outcome, isA<CommandRejected<ClaimView>>());
      expect(repo.sent, 1);
    });

    test('결과를 모르면 다시 보내지 않고, 사용자가 다시 누를 때 같은 키로 보낸다', () async {
      final repo = _ScriptedClaims(orders: orders)
        ..failures.add(const UnknownResultFailure(httpStatus: 504));
      final requester = CancelRequester(repo);

      final first = await requester.submit(
        'order-seed-4',
        seed4All,
        CancelReason.changeOfMind,
      );
      expect(first, isA<CommandUnknown<ClaimView>>());
      expect(repo.sent, 1, reason: '자동 재전송 없음');

      final second = await requester.submit(
        'order-seed-4',
        seed4All,
        CancelReason.changeOfMind,
      );
      expect(second, isA<CommandDone<ClaimView>>());
      expect(repo.sent, 2);
      expect(repo.keys.toSet(), hasLength(1), reason: '같은 키');
    });

    test('접수는 완료가 아니고, 조회하며 출고 중지 → 환불 진행 → 종결로 간다', () async {
      final claim = await cancelSeed4();
      expect(claim.state, ClaimState.opened);
      expect(claim.refunds, isEmpty);

      expect((await claims.get(claim.claimId)).state, ClaimState.opened);
      expect((await claims.get(claim.claimId)).state, ClaimState.stopPending);
      final inProgress = await claims.get(claim.claimId);
      expect(inProgress.state, ClaimState.inProgress);
      expect(inProgress.refunds.single.done, isFalse, reason: 'PG 성공 전');
      final closed = await claims.get(claim.claimId);
      expect(closed.state, ClaimState.closed);
      expect(closed.refunds.single.done, isTrue);
      expect(orders.orderJson('order-seed-4')!['status'], 'CANCELLED');
    });

    test('접수 응답을 잃으면 다시 보내지 않고 내 클레임 조회로 접수를 확인한다', () async {
      claims.loseNextCreateResponse = true;

      final claim = await cancelSeed4();

      expect(claims.claims, hasLength(1));
      expect(claim.claimId, claims.claims.keys.single);
    });

    test('배송이 시작된 주문은 서버가 취소를 받지 않는다', () async {
      final outcome = await CancelRequester(claims).submit(
        'order-seed-1',
        const [CancelLine(orderLineId: 'ol-2', qty: 1)],
        CancelReason.changeOfMind,
      );
      expect(
        (outcome as CommandRejected<ClaimView>).code,
        ClaimProblemCode.orderNotCancellable,
      );
    });

    test('철회는 확인 중을 거쳐 서버가 확정한다', () async {
      claims.holdAtOpened = true;
      final claim = await cancelSeed4();
      final key = IdempotencyKey.generate();

      await claims.withdraw(
        claim.claimId,
        expectedVersion: claim.version,
        key: key,
      );

      expect(await claims.withdrawal(claim.claimId, key), RequestState.pending);
      expect(
        await claims.withdrawal(claim.claimId, key),
        RequestState.confirmed,
      );
      expect((await claims.get(claim.claimId)).state, ClaimState.withdrawn);
    });
  });

  group('예약시간 변경', () {
    const window = ArrivalWindow(
      date: '2026-10-24',
      start: '20:00',
      end: '21:00',
    );

    test('상품 준비 전에는 확인 중을 거쳐 바뀐 시간이 주문에 반영된다', () async {
      final order = await orders.get('order-seed-4');
      final key = IdempotencyKey.generate();

      await orders.requestTimeChange(
        order.orderId,
        window,
        expectedVersion: order.version,
        key: key,
      );

      expect(await orders.timeChange(order.orderId, key), RequestState.pending);
      // 확인 중에는 주문의 시간이 아직 그대로다.
      expect((await orders.get(order.orderId)).window!.start, '18:00');
      expect(
        await orders.timeChange(order.orderId, key),
        RequestState.confirmed,
      );
      expect((await orders.get(order.orderId)).window, window);
    });

    test('상품 준비에 들어간 주문은 INVALID_STATE 로 거절된다', () async {
      final order = await orders.get('order-seed-1');
      await expectLater(
        orders.requestTimeChange(
          order.orderId,
          window,
          expectedVersion: order.version,
          key: IdempotencyKey.generate(),
        ),
        throwsA(
          isA<ProblemFailure>().having(
            (f) => f.problem.code,
            'code',
            'INVALID_STATE',
          ),
        ),
      );
    });
  });

  group('화면', () {
    final now = DateTime.utc(2026, 10, 24, 3);

    Future<void> openOrder(WidgetTester t, String orderId) async {
      t.view
        ..physicalSize = const Size(800, 2200)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        testApp(
          orders: orders,
          claims: claims,
          checkout: MockCheckoutRepository(
            latency: Duration.zero,
            now: () => now,
          ),
          [
            clockProvider.overrideWithValue(() => now),
            requestPollPolicyProvider.overrideWithValue((
              interval: Duration.zero,
              attempts: 3,
            )),
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

    testWidgets('배송이 시작된 주문에는 취소 버튼이 없다', (t) async {
      await openOrder(t, 'order-seed-1');
      expect(find.byKey(const ValueKey('cancel-order')), findsNothing);
    });

    testWidgets('주문 상세는 화면용 주문번호 8자리를 보이고, 없으면(변경 전 주문) orderId 를 보인다', (
      t,
    ) async {
      await openOrder(t, 'order-seed-1');
      expect(
        t.widget<Text>(find.byKey(const ValueKey('order-number'))).data,
        '주문번호 48213907',
      );
    });

    testWidgets('주문번호가 없는 주문은 orderId 를 보인다', (t) async {
      await openOrder(t, 'order-seed-3');
      expect(
        t.widget<Text>(find.byKey(const ValueKey('order-number'))).data,
        '주문번호 order-seed-3',
      );
    });

    testWidgets('취소 요청 → 처리 내역은 "접수"로 시작하고 완료로 보이지 않는다', (t) async {
      await openOrder(t, 'order-seed-4');
      await t.tap(find.byKey(const ValueKey('cancel-order')));
      await t.pumpAndSettle();

      // 수량 선택 없이 주문 전체(서버 미이행 수량)를 보인다.
      expect(find.text('주문 전체가 취소돼요. 일부 상품만 취소할 수는 없어요'), findsOneWidget);
      expect(find.byKey(const ValueKey('cancel-inc-ol-5')), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('cancel-line-ol-5')),
          matching: find.text('3개'),
        ),
        findsOneWidget,
      );
      await t.tap(find.byKey(const ValueKey('cancel-submit')));
      await t.pumpAndSettle();

      expect(find.text('요청을 접수했어요'), findsOneWidget);
      expect(find.textContaining('접수는 취소 완료가 아니에요'), findsOneWidget);
      expect(find.text('환불 완료'), findsNothing);
      expect(claims.claims.values.single['lines'], [
        containsPair('requestedQty', 3),
      ]);
    });

    testWidgets('처리 내역은 스스로 다시 조회하고, PG 환불 성공 뒤에만 "환불 완료"', (t) async {
      await openOrder(t, 'order-seed-4');
      await t.tap(find.byKey(const ValueKey('cancel-order')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('cancel-submit')));
      await t.pumpAndSettle();
      expect(find.text('요청을 접수했어요'), findsOneWidget);

      Future<void> next() async {
        await t.pump(const Duration(seconds: 3));
        await t.pumpAndSettle();
      }

      await next();
      expect(find.text('확인하고 있어요'), findsOneWidget);
      await next();
      expect(find.text('취소·환불을 진행하고 있어요'), findsOneWidget);
      expect(find.text('환불 진행 중'), findsOneWidget);
      expect(find.text('환불 완료'), findsNothing);
      await next();
      expect(find.text('처리가 끝났어요'), findsOneWidget);
      expect(find.text('환불 완료'), findsOneWidget);

      // 끝 상태가 되면 더 조회하지 않는다.
      final calls = claims.getCalls;
      await next();
      expect(claims.getCalls, calls);
    });

    testWidgets('취소가 끝난 뒤 주문 상세·목록으로 돌아가면 새로고침 없이 "주문 취소"로 보인다', (t) async {
      await openOrder(t, 'order-seed-4');
      expect(find.byKey(const ValueKey('cancel-order')), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('cancel-order')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('cancel-submit')));
      await t.pumpAndSettle();
      for (var i = 0; i < 3; i++) {
        await t.pump(const Duration(seconds: 3));
        await t.pumpAndSettle();
      }
      expect(find.text('처리가 끝났어요'), findsOneWidget);

      // 처리 내역 → 주문 상세
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(
        t.widget<Text>(find.byKey(const ValueKey('order-status'))).data,
        '주문 취소',
      );
      expect(find.byKey(const ValueKey('cancel-order')), findsNothing);

      // 주문 상세 → 주문 내역
      await t.tap(find.byType(BackButton));
      await t.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('order-order-seed-4')),
          matching: find.text('주문 취소'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('도착 시간 변경은 확인 중 → 확정 뒤에만 바뀐 시간으로 보인다', (t) async {
      await openOrder(t, 'order-seed-4');
      await t.tap(find.byKey(const ValueKey('reschedule')));
      await t.pumpAndSettle();

      expect(
        t.widget<Text>(find.byKey(const ValueKey('reschedule-current'))).data,
        contains('오후 6:00'),
      );
      await t.tap(find.byKey(const ValueKey('rs-slot-20:00')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('reschedule-submit')));
      await t.pumpAndSettle();

      expect(find.byKey(const ValueKey('reschedule-done')), findsOneWidget);
      expect(
        t.widget<Text>(find.byKey(const ValueKey('reschedule-current'))).data,
        contains('오후 8:00'),
      );
    });

    testWidgets(
      '주문 상세의 처리 내역은 주문 응답의 claims 가 비어도 GET /claims?orderId= 로 받아 보인다',
      (t) async {
        await openOrder(t, 'order-seed-4');
        expect(find.byKey(const ValueKey('order-claim-claim-1')), findsNothing);
        await t.tap(find.byKey(const ValueKey('cancel-order')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('cancel-submit')));
        await t.pumpAndSettle();
        expect(find.text('요청을 접수했어요'), findsOneWidget);

        // 처리 내역 → 주문 상세. 주문 응답의 claims 는 서버처럼 비어 있다.
        await t.tap(find.byType(BackButton));
        await t.pumpAndSettle();
        expect(orders.orderJson('order-seed-4')!['claims'], isEmpty);
        final tile = find.byKey(const ValueKey('order-claim-claim-1'));
        expect(tile, findsOneWidget);
        expect(
          find.descendant(of: tile, matching: find.text('취소 요청')),
          findsOneWidget,
        );
        expect(
          find.descendant(of: tile, matching: find.textContaining('접수')),
          findsOneWidget,
        );

        // 줄을 누르면 처리 내역 화면으로 간다.
        await t.tap(tile);
        await t.pumpAndSettle();
        expect(find.byKey(const ValueKey('claim-state')), findsOneWidget);
      },
    );

    group('자동 전체 취소(MFC 작업 거절, 백엔드 공지 2026-11-07)', () {
      testWidgets('처리 내역은 자동 취소 안내를 보이고 "접수" 안내·"요청하신" 문구가 없다', (t) async {
        final id = claims.seedSystemCancel('order-seed-4');
        await openOrder(t, 'order-seed-4');
        await t.tap(find.byKey(ValueKey('order-claim-$id')));
        await t.pumpAndSettle();
        expect(
          find.text('상품 준비가 어려워 주문을 자동으로 취소하고 있어요. 결제하신 금액은 전액 환불됩니다.'),
          findsOneWidget,
        );
        expect(find.textContaining('접수는 취소 완료가 아니에요'), findsNothing);
        expect(find.textContaining('요청하신'), findsNothing);
        expect(find.text('환불 완료'), findsNothing);
      });

      testWidgets('취소된 주문 상세는 최근 취소 클레임 사유로 자동 취소를 안내한다', (t) async {
        claims.seedSystemCancel('order-seed-3');
        await openOrder(t, 'order-seed-3');
        await t.pump(const Duration(seconds: 1));
        await t.pumpAndSettle();
        expect(
          (t.widget(
            find.byKey(const ValueKey('order-auto-cancelled')),
          ) as Text).data,
          '상품 준비가 어려워 주문이 자동 취소되었어요. 결제하신 금액은 전액 환불됩니다.',
        );
      });

      testWidgets('고객이 직접 취소한 주문에는 자동 취소 안내가 없다', (t) async {
        await openOrder(t, 'order-seed-4');
        await t.tap(find.byKey(const ValueKey('cancel-order')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('cancel-submit')));
        await t.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('claim-auto-cancelled')),
          findsNothing,
        );
        expect(find.textContaining('접수는 취소 완료가 아니에요'), findsOneWidget);
      });

      testWidgets('자동 취소 중에 취소를 누르면 "이미 취소가 진행 중"을 알리고 그 처리 내역으로 간다', (
        t,
      ) async {
        final id = claims.seedSystemCancel('order-seed-4');
        await openOrder(t, 'order-seed-4');
        await t.tap(find.byKey(const ValueKey('cancel-order')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('cancel-submit')));
        await t.pumpAndSettle();
        expect(find.text('이미 취소가 진행 중이에요'), findsOneWidget); // 스낵바
        expect(
          find.byKey(const ValueKey('claim-auto-cancelled')),
          findsOneWidget,
        );
        // 새 클레임을 만들지 않았다
        expect(claims.claims.keys, [id]);
      });
    });

    testWidgets('취소하지 않은 주문에는 처리 내역 영역이 없다 — 조회가 실패해도 보이지 않는다', (t) async {
      final failing = _ListDownClaims(orders: orders);
      claims = failing;
      await openOrder(t, 'order-seed-4'); // CONFIRMED, 내역 없음
      expect(find.text('처리 내역'), findsNothing);
      expect(find.byKey(const ValueKey('order-claims-failed')), findsNothing);
    });

    testWidgets('취소한 주문의 처리 내역 조회 실패는 "내역 없음"이 아니라 실패로 보이고 다시 확인할 수 있다', (
      t,
    ) async {
      final failing = _ListDownClaims(orders: orders);
      claims = failing;
      await openOrder(t, 'order-seed-3'); // CANCELLED
      expect(find.byKey(const ValueKey('order-claims-failed')), findsOneWidget);
      expect(find.text('처리 내역을 불러오지 못했어요'), findsOneWidget);

      failing.down = false;
      await t.tap(
        find.descendant(
          of: find.byKey(const ValueKey('order-claims-failed')),
          matching: find.text('다시 확인'),
        ),
      );
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('order-claims-failed')), findsNothing);
    });
  });
}

/// 처리 내역 목록 조회만 실패하는 목.
final class _ListDownClaims extends MockClaimsRepository {
  _ListDownClaims({super.orders}) : super(latency: Duration.zero);

  bool down = true;

  @override
  Future<List<ClaimSummaryView>> listForOrder(String orderId) async {
    if (down) throw const NetworkFailure(DioExceptionType.connectionError);
    return super.listForOrder(orderId);
  }
}

/// 접수 응답을 차례로 실패시키는 목. 보낸 횟수·키를 센다.
final class _ScriptedClaims extends MockClaimsRepository {
  _ScriptedClaims({super.orders}) : super(latency: Duration.zero);

  final failures = <PmartFailure>[];
  final keys = <String>[];
  int get sent => keys.length;

  @override
  Future<ClaimView> requestCancel(
    String orderId,
    List<CancelLine> lines,
    CancelReason reason, {
    String? detail,
    required IdempotencyKey key,
  }) async {
    keys.add(key.value);
    if (failures.isNotEmpty) throw failures.removeAt(0);
    return super.requestCancel(orderId, lines, reason, key: key);
  }
}
