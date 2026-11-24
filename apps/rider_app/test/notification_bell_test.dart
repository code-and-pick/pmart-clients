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

/// 홈 위 단추줄 — 2026-11-25 사용자 레퍼런스: 지도 위에는 신규배차·마이페이지·배달리스트만(종은 뺐다).
/// 안 읽은 알림 수는 마이페이지 단추에, 알림함은 마이페이지 "알림" 메뉴로 들어간다.
/// (2026-11-24 "알림 버튼이 안눌러져" — 펼친 시트가 위 단추를 덮지 않는지도 여기서 본다.)
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
    testWidgets(
      '지도 위에 종은 없고, 마이페이지 → 알림 메뉴로 알림함이 열린다 (맡은 배송 ${seeded ? '있음' : '없음'})',
      (t) async {
        await pumpHome(t, seeded: seeded);
        expect(find.byKey(const ValueKey('notifications')), findsNothing);
        // 배송이 있으면 홈에 배송 시트가 얹혀 있다(그 위에서도 마이페이지 단추가 눌린다)
        expect(
          find.byKey(const ValueKey('sheet-handle')),
          seeded ? findsOneWidget : findsNothing,
        );
        // 안 읽은 알림 수는 마이페이지 단추에
        expect(find.byKey(const ValueKey('noti-badge')), findsOneWidget);
        await t.tap(find.byKey(const ValueKey('my-page')), warnIfMissed: true);
        await settle(t);
        await t.scrollUntilVisible(
          find.byKey(const ValueKey('menu-notifications')),
          100,
          scrollable: find.byType(Scrollable).last,
        );
        await t.tap(find.byKey(const ValueKey('menu-notifications')));
        await settle(t);
        expect(find.byType(NotificationScreen), findsOneWidget);
      },
    );
  }

  testWidgets('배송 시트를 끝까지 올려도 위 단추줄은 가리지 않는다', (t) async {
    await pumpHome(t, seeded: true);
    // 손잡이를 누르면 끝까지 펼친다
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle(t);
    final buttonBottom = t
        .getBottomLeft(find.byKey(const ValueKey('my-page')))
        .dy;
    // 시트(펼친 내용)의 윗변이 단추 아래에 있다
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
    expect(sheetMaterialTop, greaterThanOrEqualTo(buttonBottom));
    await t.tap(find.byKey(const ValueKey('my-page')));
    await settle(t);
    expect(find.byKey(const ValueKey('menu-notifications')), findsOneWidget);
  });

  testWidgets('펼친 시트를 넘겨도 위(상태·장소·도움요청|길찾기)는 고정', (t) async {
    await pumpHome(t, seeded: true);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle(t);
    final helpTop = t.getTopLeft(find.byKey(const ValueKey('help'))).dy;
    final infoTop = t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy;
    // 고정 칸 아래(배달 정보)를 잡고 올린다
    await t.dragFrom(Offset(180, infoTop + 20), const Offset(0, -300));
    await settle(t);
    // 아래 내용은 올라갔지만 도움요청 단추는 그 자리
    expect(t.getTopLeft(find.byKey(const ValueKey('help'))).dy, helpTop);
    expect(
      t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy,
      // 픽업 단계는 배달 정보가 짧아(레퍼런스대로 칸을 뺐다) 넘길 거리가 없을 수 있다 — 위로만 간다.
      lessThanOrEqualTo(infoTop),
    );
  });
}
