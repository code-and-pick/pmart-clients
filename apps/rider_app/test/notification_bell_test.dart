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
import 'package:rider_app/features/notifications/presentation/notification_screen.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

/// 홈 알림 종(2026-11-24 사용자 "라이더앱에 알림 버튼이 안눌러져. 눌러도 아무 변화가 없어").
void main() {
  setUpAll(initPmartFormatting);

  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 20; i++) {
      await t.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> pumpHome(WidgetTester t, {required bool seeded}) async {
    t.view
      ..physicalSize = const Size(1080, 2340)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);
    // 맡은 배송이 있을 때는 제안이 오지 않게 운행 종료에서 시작 — 홈에 배송 시트가 얹힌다
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: !seeded,
    );
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
            MockDeliveryRepository(latency: Duration.zero, seeded: seeded),
          ),
        ],
        child: const RiderApp(),
      ),
    );
    await settle(t);
  }

  for (final seeded in [false, true]) {
    testWidgets('종을 누르면 알림함이 열린다 (맡은 배송 ${seeded ? '있음' : '없음'})', (t) async {
      await pumpHome(t, seeded: seeded);
      final bell = find.byKey(const ValueKey('notifications'));
      expect(bell, findsOneWidget);
      // 배송이 있으면 홈에 배송 시트가 얹혀 있어야 한다(그 위에서 눌리는지가 문제였다)
      expect(
        find.byKey(const ValueKey('sheet-handle')),
        seeded ? findsOneWidget : findsNothing,
      );
      await t.tap(bell, warnIfMissed: true);
      await settle(t);
      expect(find.byType(NotificationScreen), findsOneWidget);
    });
  }

  testWidgets('배송 시트를 끝까지 올려도 위 단추줄(종)은 가리지 않는다', (t) async {
    await pumpHome(t, seeded: true);
    // 손잡이를 누르면 끝까지 펼친다
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle(t);
    final sheetTop = t
        .getTopLeft(find.byKey(const ValueKey('delivery-sheet')).last)
        .dy;
    final bellBottom = t
        .getBottomLeft(find.byKey(const ValueKey('notifications')))
        .dy;
    // 시트(펼친 내용)의 윗변이 종 아래에 있다
    final sheetMaterialTop = t
        .getTopLeft(
          find
              .descendant(
                of: find.byKey(const ValueKey('delivery-sheet')).last,
                matching: find.byType(Material),
              )
              .first,
        )
        .dy;
    expect(sheetMaterialTop, greaterThanOrEqualTo(bellBottom));
    expect(sheetTop, isNotNull);
    await t.tap(find.byKey(const ValueKey('notifications')));
    await settle(t);
    expect(find.byType(NotificationScreen), findsOneWidget);
  });

  testWidgets('펼친 시트를 넘겨도 위(예정·장소·도움요청|길찾기)는 고정', (t) async {
    await pumpHome(t, seeded: true);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle(t);
    final helpTop = t.getTopLeft(find.byKey(const ValueKey('help'))).dy;
    final infoTop = t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy;
    await t.dragFrom(const Offset(180, 500), const Offset(0, -300));
    await settle(t);
    // 아래 내용은 올라갔지만 도움요청 단추는 그 자리
    expect(t.getTopLeft(find.byKey(const ValueKey('help'))).dy, helpTop);
    expect(
      t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy,
      lessThan(infoTop - 100),
    );
  });
}
