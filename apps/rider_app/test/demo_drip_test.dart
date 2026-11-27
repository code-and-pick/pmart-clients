import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/shared/demo.dart';

/// 시연 빌드(사용자 2026-11-27 녹화): 알뜰 시나리오에서 묶음 수락 → 1번 전달 → 새 묶음 거절 → 2번 전달 → 신규배차 끄고 켜기 뒤에도
/// 다음 묶음(3건)이 들어와야 한다(2편 녹화에서 안 들어옴).
Future<List<OfferItem>> _waitOffers(MockOfferRepository repo) async {
  for (var i = 0; i < 20; i++) {
    final offers = (await repo.activeOffers()).offers;
    if (offers.isNotEmpty) return offers;
    await Future<void>.delayed(const Duration(seconds: 1));
  }
  return const [];
}

void main() {
  test('알뜰: 거절·신규배차 끄고 켠 뒤에도 다음 묶음이 들어온다', () async {
    final repo = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
      demoBundle: true,
      demoManyBundles: true,
      demoSingles: true,
      demo: DemoScenario.bundle,
    );
    final done = <String>{};
    repo.finished = done.contains;
    var duty = await repo.state();
    duty = await repo.setState(
      onDuty: true,
      newDispatch: true,
      expectedVersion: duty.version,
      key: IdempotencyKey.generate(),
    );

    var offers = await _waitOffers(repo);
    expect(offers.map((o) => o.offerId), ['offer-bundle-1', 'offer-bundle-2']);
    await repo.respond(
      'offer-bundle-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );

    done.add('dlv-b1');
    offers = await _waitOffers(repo);
    expect(offers.map((o) => o.offerId), ['offer-bundle-6', 'offer-bundle-7']);
    await repo.respond(
      'offer-bundle-6',
      accept: false,
      key: IdempotencyKey.generate(),
    );

    done.add('dlv-b2');
    duty = await repo.setState(
      onDuty: true,
      newDispatch: false,
      expectedVersion: duty.version,
      key: IdempotencyKey.generate(),
    );
    await repo.activeOffers();
    duty = await repo.setState(
      onDuty: true,
      newDispatch: true,
      expectedVersion: duty.version,
      key: IdempotencyKey.generate(),
    );

    offers = await _waitOffers(repo);
    expect(offers.map((o) => o.offerId), [
      'offer-bundle-3',
      'offer-bundle-4',
      'offer-bundle-5',
    ]);

    // 거절한 묶음은 새 제안 ID 로 뒤에 다시 온다 — 주문이 바닥나지 않는다
    await repo.respond(
      'offer-bundle-3',
      accept: false,
      key: IdempotencyKey.generate(),
    );
    offers = await _waitOffers(repo);
    expect(offers.map((o) => o.offerId), [
      'offer-bundle-6~1',
      'offer-bundle-7~1',
    ]);
    expect(offers.map((o) => o.deliveryId), ['dlv-b6', 'dlv-b7']);
  }, timeout: const Timeout(Duration(minutes: 2)));
}
