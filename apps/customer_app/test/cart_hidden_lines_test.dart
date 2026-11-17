import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart' show PmartEnv;

import 'package:customer_app/features/cart/data/mock_cart_repository.dart';
import 'package:customer_app/features/cart/domain/cart.dart';
import 'package:customer_app/features/cart/presentation/cart_controller.dart';
import 'package:customer_app/features/checkout/domain/checkout.dart';
import 'package:customer_app/shared/providers.dart';
import 'package:customer_app/shared/shopping_context.dart';

/// 시험용 담당 센터(주소를 바꾼 것처럼 바꾼다).
final _mfc = NotifierProvider<_Mfc, String>(_Mfc.new);

class _Mfc extends Notifier<String> {
  @override
  String build() => 'MFC-A';

  void move(String mfcId) => state = mfcId;
}

void main() {
  late MockCartRepository repo;
  late ProviderContainer container;

  setUp(() async {
    // 기본 장바구니: E-00000001 ×2, E-00000005 ×1 (둘 다 선택). 센터 A 는 E-00000005 를 취급하지 않는다.
    repo = MockCartRepository(latency: Duration.zero)
      ..notCarriedAt = {
        'MFC-A': {'E-00000005'},
      };
    container = ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        cartRepositoryProvider.overrideWithValue(repo),
        currentMfcIdProvider.overrideWith((ref) => ref.watch(_mfc)),
      ],
    );
    addTearDown(container.dispose);
    container.listen(cartControllerProvider, (_, _) {});
    await container.read(cartControllerProvider.future);
    // 자동 선택 해제가 끝날 때까지.
    for (var i = 0; i < 10; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  });

  CartState state() => container.read(cartControllerProvider).requireValue;
  bool hidden(String sku) => hiddenAtCurrentAddress(
    state().cart.lineForSku(sku)!,
    container.read(stockShortageProvider),
  );

  test('지금 주소로 배달하지 않는 품목은 숨기고 선택에서 빼되, 안내에 세지 않고 지우지도 않는다', () async {
    final line = state().cart.lineForSku('E-00000005')!;
    expect(line.availability, LineAvailability.notCarried);
    expect(hidden('E-00000005'), isTrue);
    expect(hidden('E-00000001'), isFalse);
    // 서버에 선택 해제를 보냈다(합계·주문에서 빠짐). 숨긴 품목이라 "선택에서 뺐어요" 안내는 없다.
    expect(line.selected, isFalse);
    expect(state().notice, isNull);

    // 선택 삭제는 보이는 품목만 지운다.
    await container.read(cartControllerProvider.notifier).removeSelected();
    expect(state().cart.lineForSku('E-00000001'), isNull);
    expect(state().cart.lineForSku('E-00000005'), isNotNull);
  });

  test('취급하는 주소로 돌아오면 다시 보인다(서버 장바구니에 남아 있음)', () async {
    expect(hidden('E-00000005'), isTrue);

    container.read(_mfc.notifier).move('MFC-B');
    await container.read(cartControllerProvider.future);

    final line = state().cart.lineForSku('E-00000005')!;
    expect(line.availability, isNot(LineAvailability.notCarried));
    expect(hidden('E-00000005'), isFalse);
    // 숨길 때 서버 선택을 뺐으므로 선택은 꺼진 채 보인다(고객이 다시 고른다).
    expect(line.selected, isFalse);
  });

  test('초안 422 의 NOT_HANDLED 도 숨기고, 주소(센터)가 바뀌면 그 표시는 지운다', () async {
    container.read(stockShortageProvider.notifier).set({
      'E-00000001': const StockShortage(sku: 'E-00000001', notHandled: true),
    });
    expect(hidden('E-00000001'), isTrue);
    for (var i = 0; i < 10; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(state().cart.lineForSku('E-00000001')!.selected, isFalse);

    container.read(_mfc.notifier).move('MFC-B');
    await container.read(cartControllerProvider.future);
    expect(container.read(stockShortageProvider), isEmpty);
    expect(hidden('E-00000001'), isFalse);
  });
}
