import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/data/offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

Widget _app(List<Override> overrides) => ProviderScope(
  retry: (_, _) => null,
  overrides: [
    envProvider.overrideWithValue(PmartEnv.mock),
    initialSessionProvider.overrideWithValue(
      const RiderSession(riderId: 'rider-mock-1'),
    ),
    ...overrides,
  ],
  child: const RiderApp(),
);

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('목 모드로 기동하면 서버가 준 남은 시간으로 제안이 보인다', (t) async {
    final mock = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(mock),
        dutyRepositoryProvider.overrideWithValue(mock),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(latency: Duration.zero, seeded: false),
        ),
      ]),
    );
    await t.pumpAndSettle();

    expect(find.byKey(const ValueKey('offer-offer-mock-1')), findsOneWidget);
    expect(find.text('42초 남음'), findsOneWidget);
    expect(find.textContaining('3,500원'), findsOneWidget);
    expect(find.text('지금은 새 제안을 받을 수 없는 상태예요'), findsNothing);
  });

  group('GET /offers 연결(가짜 어댑터)', () {
    OfferRepository repoWith(FakeAdapter adapter) => ApiOfferRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: adapter,
        delay: (_) async {},
      ),
    );

    test('pollAfterSec 를 간격으로 읽는다', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(200, body: MockOfferRepository.fixture),
      );
      final list = await repoWith(adapter).activeOffers();

      expect(list.pollAfter, const Duration(seconds: 5));
      expect(list.offers.single.remainingSec, 42);
      expect(adapter.requests.single.uri.path, '/api/v1/offers');
      expect(adapter.requests.single.headers['X-Source-System'], 'rider-app');
    });

    test('pollAfterSec 가 null 이면 폴링 중지 상태다', () async {
      final adapter = FakeAdapter(
        (_, _) async => FakeReply(
          200,
          body: {
            ...MockOfferRepository.fixture,
            'items': <Object?>[],
            'pollAfterSec': null,
          },
        ),
      );
      final list = await repoWith(adapter).activeOffers();

      expect(list.pollAfter, isNull);
      expect(list.offers, isEmpty);
    });

    test('items 가 없으면 빈 목록이 아니라 계약 위반이다', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(200, body: {'pollAfterSec': 5}),
      );
      await expectLater(
        repoWith(adapter).activeOffers(),
        throwsA(isA<ContractViolationFailure>()),
      );
    });

    test('offerId 가 없는 제안은 계약 위반이다', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {
            'items': [
              {'remainingSec': 10},
            ],
          },
        ),
      );
      await expectLater(
        repoWith(adapter).activeOffers(),
        throwsA(isA<ContractViolationFailure>()),
      );
    });

    test('토큰 갱신을 할 수 없으면(BR-02) 401 은 세션 만료다', () async {
      final tokens = TokenStore(MemoryKeyValueStore());
      await tokens.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      final repo = ApiOfferRepository(
        createPmartDio(
          baseUrl: 'http://test.invalid/api/v1',
          sourceSystem: sourceSystem,
          tokens: tokens,
          refresher: (_) async => null,
          adapter: FakeAdapter((_, _) async => const FakeReply(401)),
        ),
      );

      await expectLater(
        repo.activeOffers(),
        throwsA(isA<SessionExpiredFailure>()),
      );
    });
  });

  test('네트워크 실패는 PmartFailure 로 올라온다', () async {
    final repo = ApiOfferRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: FakeAdapter(
          (_, _) async =>
              const FakeReply.transport(DioExceptionType.connectionError),
        ),
      ),
    );
    await expectLater(repo.activeOffers(), throwsA(isA<NetworkFailure>()));
  });
}
