import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';

/// MFC 반납 인증번호(execution 0.27.0, 백엔드 회신 2026-11-18-reply-return-handover-code).
void main() {
  test('서버 422 MISMATCH 의 details attemptsLeft 를 읽는다', () {
    const mismatch = ProblemFailure(
      Problem(
        status: 422,
        code: ReturnHandoverCode.mismatch,
        details: [ProblemDetail(field: 'attemptsLeft', reason: '3')],
      ),
    );
    expect(returnAttemptsLeftOf(mismatch), 3);
    const locked = ProblemFailure(
      Problem(status: 422, code: ReturnHandoverCode.locked),
    );
    expect(returnAttemptsLeftOf(locked), isNull);
  });

  test('목도 서버와 같게: 틀리면 남은 횟수, 5번이면 잠김(맞는 번호도 거절)', () async {
    final attempts = ReturnAttempts();
    final repo = MockDeliveryRepository(
      latency: Duration.zero,
      demoBundle: true,
      returnAttempts: attempts,
    );
    repo.deliveryJson('dlv-r1')['state'] = 'RETURN_PICKED_UP';
    var n = 0;
    QueueItem item(String code) => QueueItem(
      id: 'q${n++}',
      kind: DeliveryCommandKind.returnToStore,
      targetId: 'dlv-r1',
      payload: {'occurredAt': '2026-11-18T10:00:00Z', 'handoverCode': code},
      state: QueueItemState.queued,
      createdAt: DateTime.utc(2026, 11, 18),
    );

    for (var i = 1; i <= 4; i++) {
      final r = await repo.send(item('0000'));
      expect((r as SendRejected).code, ReturnHandoverCode.mismatch);
      expect(attempts.left('dlv-r1'), ReturnHandoverCode.maxAttempts - i);
    }
    final fifth = await repo.send(item('0000'));
    expect((fifth as SendRejected).code, ReturnHandoverCode.locked);
    final right = await repo.send(item(ReturnHandoverCode.mockCode));
    expect((right as SendRejected).code, ReturnHandoverCode.locked);
    expect(repo.deliveryJson('dlv-r1')['state'], 'RETURN_PICKED_UP');
  });

  test('맞는 번호면 반납 완료', () async {
    final repo = MockDeliveryRepository(
      latency: Duration.zero,
      demoBundle: true,
    );
    repo.deliveryJson('dlv-r1')['state'] = 'RETURN_PICKED_UP';
    final r = await repo.send(
      QueueItem(
        id: 'q1',
        kind: DeliveryCommandKind.returnToStore,
        targetId: 'dlv-r1',
        payload: {
          'occurredAt': '2026-11-18T10:00:00Z',
          'handoverCode': ReturnHandoverCode.mockCode,
        },
        state: QueueItemState.queued,
        createdAt: DateTime.utc(2026, 11, 18),
      ),
    );
    expect(r, isNot(isA<SendRejected>()));
    expect(repo.deliveryJson('dlv-r1')['state'], 'RETURNED_TO_STORE');
  });
}
