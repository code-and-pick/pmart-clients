// 끝난 배송 보기(읽기 전용, 2026-11-23 사용자 "배송 끝난 건 … 나중에 문제 생겼을 때 확인할 수 있게") — 목 기준.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/presentation/delivery_record_screen.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

Future<void> _settle(WidgetTester t) async {
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUpAll(initPmartFormatting);

  test('끝난 배송 판정 — 완료·반납 완료·취소·실패 확정만', () {
    expect(isEndedDelivery(ExecutionState.completed), isTrue);
    expect(isEndedDelivery(ExecutionState.returnedToStore), isTrue);
    expect(isEndedDelivery(ExecutionState.cancelled), isTrue);
    expect(isEndedDelivery(ExecutionState.failed), isTrue);
    expect(isEndedDelivery(ExecutionState.pickedUp), isFalse);
    expect(isEndedDelivery(ExecutionState.failureReported), isFalse);
  });

  testWidgets('배달기록 줄을 누르면 그 배송을 읽기 전용으로 — 상태·주문·도움요청', (t) async {
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
    );
    final repo = MockDeliveryRepository(latency: Duration.zero);
    repo.deliveryJson('dlv-1')['state'] = 'COMPLETED';
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(repo),
          supportThreadRepositoryProvider.overrideWithValue(repo),
        ],
        child: const RiderApp(),
      ),
    );
    await _settle(t);
    await t.tap(find.byKey(const ValueKey('my-page')).first);
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    await t.tap(find.byKey(const ValueKey('menu-history')));
    await _settle(t);
    await t.tap(find.byKey(const ValueKey('record-ORD-5111EHNE')));
    await _settle(t);
    expect(find.byKey(const ValueKey('delivery-record')), findsOneWidget);
    expect(find.text('끝난 배송이에요. 내용을 확인만 할 수 있어요.'), findsOneWidget);
    expect(find.text('이 배송의 도움요청'), findsOneWidget);
    // 할 일 버튼(가게 도착·전달완료 등)은 없다
    expect(find.byKey(const ValueKey('arrive-store')), findsNothing);
    await t.pump(const Duration(seconds: 2));
  });
}
