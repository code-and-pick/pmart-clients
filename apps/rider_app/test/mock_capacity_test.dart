import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';

/// 목 제안도 서버 규칙을 따른다: 동시에 맡는 배송 최대 3건(계약 acceptances "최대 3건 — 넘으면 LATE·INELIGIBLE").
/// 사용자 2026-11-18 "알뜰 6건이 받아졌어. 최대 3건까지 받아져야 하는데".
void main() {
  test('3건을 맡으면 더 제안하지 않고, 끝나면 다시 제안한다', () async {
    final repo = MockOfferRepository(
      latency: Duration.zero,
      demoBundle: true,
      demoManyBundles: true,
    );
    final done = <String>{};
    repo.finished = done.contains;

    // 예약 1건 + 알뜰 2건 = 3건
    await repo.respond(
      'offer-mock-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    final bundle = await repo.respond(
      'offer-bundle-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    expect(bundle, isA<OfferAssigned>());
    expect(repo.activeCount, 3);
    expect((await repo.activeOffers()).offers, isEmpty, reason: '꽉 차면 제안 없음');

    // 넘게 수락하면 늦은 수락(INELIGIBLE)
    final over = await repo.respond(
      'offer-bundle-6',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    expect(over, isA<OfferLate>());
    expect((over as OfferLate).reason, LateReason.ineligible);
    expect(repo.activeCount, 3);

    // 하나 끝내면 1건짜리 제안(반품 회수)만 다시 보인다 — 2·3건 묶음은 아직 안 들어간다
    done.add('dlv-1');
    final offers = (await repo.activeOffers()).offers;
    expect(offers.map((o) => o.offerId), ['offer-return-1']);
  });
  test('하나씩 배달하기: 1건 맡으면 제안 없음·폴링 멈춤, 끝나면 다시', () async {
    final repo = MockOfferRepository(latency: Duration.zero, demoSingles: true);
    final done = <String>{};
    repo.finished = done.contains;
    final settings = await repo.settings();
    await repo.setSettings(
      mode: settings.mode,
      oneAtATime: true,
      expectedVersion: settings.version,
      key: IdempotencyKey.generate(),
    );

    final first = await repo.activeOffers();
    expect(
      first.offers.map((o) => o.offerId),
      containsAll(['offer-single-1', 'offer-single-2', 'offer-single-3']),
    );
    await repo.respond(
      'offer-single-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    final busy = await repo.activeOffers();
    expect(busy.offers, isEmpty);
    expect(busy.pollAfter, isNull, reason: '하나씩 배달 진행 중 — 폴링 멈춤');
    final over = await repo.respond(
      'offer-single-2',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    expect((over as OfferLate).reason, LateReason.ineligible);

    done.add('dlv-s1');
    final again = await repo.activeOffers();
    expect(again.offers.map((o) => o.offerId), contains('offer-single-3'));
    expect(again.pollAfter, isNotNull);
  });
  test('한집은 혼자만(하나씩 배달하기 꺼도): 한집 1건 맡으면 끝날 때까지 새 배차 없음', () async {
    final repo = MockOfferRepository(
      latency: Duration.zero,
      demoBundle: true,
      demoSingles: true,
    );
    final done = <String>{};
    repo.finished = done.contains;

    await repo.respond(
      'offer-single-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    final busy = await repo.activeOffers();
    expect(busy.offers, isEmpty, reason: '한집 진행 중 — 한집·알뜰 모두 없음');
    expect(busy.pollAfter, isNull);
    final second = await repo.respond(
      'offer-single-2',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    expect((second as OfferLate).reason, LateReason.ineligible);
    expect(repo.activeCount, 1);

    done.add('dlv-s1');
    final again = await repo.activeOffers();
    expect(again.offers, isNotEmpty);
    expect(again.pollAfter, isNotNull);
  });

  test('다른 배송을 맡고 있으면 한집 제안은 오지 않는다(알뜰은 3건까지)', () async {
    final repo = MockOfferRepository(
      latency: Duration.zero,
      demoBundle: true,
      demoSingles: true,
    );
    repo.finished = (_) => false;
    // 예약 1건을 맡는다
    await repo.respond(
      'offer-mock-1',
      accept: true,
      key: IdempotencyKey.generate(),
    );
    final ids = (await repo.activeOffers()).offers.map((o) => o.offerId);
    expect(ids.where((id) => id.startsWith('offer-single')), isEmpty);
    expect(ids, contains('offer-bundle-1'));
  });
}
