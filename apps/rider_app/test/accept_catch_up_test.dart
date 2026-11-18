// 배차 수락 직후 배송 조회 — 배송 서버(execution)가 배정을 반영하기 전(0.2~0.7초)에는 404 라 실패로 보였다
// (2026-11-18 사용자: "배차 수락하면 배송 정보를 불러오지 못했어요 — 다시 시도를 눌러야 픽업지가 뜬다").
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';

/// 처음 [notYet] 번은 404(아직 배정 반영 전), 그 뒤엔 배송.
final class _LaggingRepo implements DeliveryRepository {
  _LaggingRepo(this.notYet);

  int notYet;
  int calls = 0;

  @override
  Future<DeliveryView> get(String deliveryId) async {
    calls++;
    if (notYet-- > 0) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    return deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': deliveryId,
        'state': 'ASSIGNED',
        'riderId': 'rider-1',
        'mfcId': 'MFC-SEED-01',
        'version': 1,
      }),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

ProviderContainer _container(_LaggingRepo repo) => ProviderContainer(
  // Riverpod 자동 재시도는 끈다 — 이 시험은 화면이 정한 "다시 묻기"만 본다(앱의 ProviderScope 시험과 같게)
  retry: (_, _) => null,
  overrides: [
    deliveryRepositoryProvider.overrideWithValue(repo),
    acceptCatchUpDelaysProvider.overrideWithValue(const [
      Duration.zero,
      Duration.zero,
      Duration.zero,
    ]),
  ],
);

void main() {
  test('방금 수락한 배송은 404 가 와도 잠깐씩 다시 물어 배정이 반영되면 보인다(실패로 보이지 않음)', () async {
    final repo = _LaggingRepo(2);
    final c = _container(repo);
    addTearDown(c.dispose);
    c.read(assignedDeliveriesProvider.notifier).add('d1');
    final sub = c.listen(deliveryProvider('d1'), (_, _) {});
    addTearDown(sub.close);

    final d = await c.read(deliveryProvider('d1').future);
    expect(d.state, ExecutionState.assigned);
    expect(repo.calls, 3, reason: '404 두 번 뒤 세 번째에 보임');
  });

  test('끝까지 404 면 실패 그대로(지어내지 않는다)', () async {
    final repo = _LaggingRepo(99);
    final c = _container(repo);
    addTearDown(c.dispose);
    c.read(assignedDeliveriesProvider.notifier).add('d2');
    final sub = c.listen(deliveryProvider('d2'), (_, _) {});
    addTearDown(sub.close);

    await expectLater(
      c.read(deliveryProvider('d2').future),
      throwsA(isA<ProblemFailure>()),
    );
    expect(repo.calls, 4, reason: '처음 + 다시 묻기 3번');
  });

  test('이번에 수락하지 않은 배송은 404 를 바로 실패로', () async {
    final repo = _LaggingRepo(1);
    final c = _container(repo);
    addTearDown(c.dispose);
    final sub = c.listen(deliveryProvider('d3'), (_, _) {});
    addTearDown(sub.close);

    await expectLater(
      c.read(deliveryProvider('d3').future),
      throwsA(isA<ProblemFailure>()),
    );
    expect(repo.calls, 1);
  });
}
