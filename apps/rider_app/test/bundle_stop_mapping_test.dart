// execution 0.40.0 — 라이더 배송 조회의 알뜰 묶음·전달 순서를 앱 모델로.
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:rider_app/features/delivery/data/delivery_repository.dart';

void main() {
  test('bundleId·stopSequence 를 그대로, 묶음 아니면 null', () {
    final bundled = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-1',
        'state': 'PICKED_UP',
        'bundleId': 'bundle-9',
        'stopSequence': 2,
      }),
    );
    expect(bundled.bundleId, 'bundle-9');
    expect(bundled.stopSequence, 2);
    final single = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-2',
        'state': 'PICKED_UP',
        'bundleId': null,
        'stopSequence': null,
      }),
    );
    expect(single.bundleId, isNull);
    expect(single.stopSequence, isNull);
  });
}
