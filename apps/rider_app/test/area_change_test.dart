// 마이페이지 배달 지역 바꾸기(사용자 2026-11-23): 운행을 쉴 때만, 한 곳, 바로 반영(`PATCH /riders/me` deliveryAreas).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

/// 운행 시작 때 보낸 mfcId 를 적어 둔다.
final class _Duty extends MockOfferRepository {
  _Duty({super.startOnDuty}) : super(latency: Duration.zero);

  final sentMfcIds = <String?>[];

  @override
  Future<OperatingState> setState({
    required bool onDuty,
    required bool newDispatch,
    required int expectedVersion,
    String? mfcId,
    required IdempotencyKey key,
  }) {
    sentMfcIds.add(mfcId);
    return super.setState(
      onDuty: onDuty,
      newDispatch: newDispatch,
      expectedVersion: expectedVersion,
      mfcId: mfcId,
      key: key,
    );
  }
}

Widget _app(List<Override> overrides) => ProviderScope(
  retry: (_, _) => null,
  overrides: [
    envProvider.overrideWithValue(PmartEnv.mock),
    initialSessionProvider.overrideWithValue(
      const RiderSession(riderId: 'rider-mock-1'),
    ),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
    deliveryRepositoryProvider.overrideWithValue(
      MockDeliveryRepository(latency: Duration.zero, seeded: false),
    ),
    ...overrides,
  ],
  child: const RiderApp(),
);

Future<void> _settle(WidgetTester t) async {
  for (var i = 0; i < 8; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _openMyPage(WidgetTester t) async {
  await t.tap(find.byKey(const ValueKey('my-page')).first);
  await t.pumpAndSettle(const Duration(milliseconds: 50));
}

void main() {
  setUpAll(initPmartFormatting);

  testWidgets('쉬는 중이면 권역 → 지점을 골라 바로 바꾸고, 마이페이지에 새 지점이 보인다', (t) async {
    final duty = _Duty(startOnDuty: false);
    final profile = MockProfileRepository();
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(duty),
        dutyRepositoryProvider.overrideWithValue(duty),
        profileRepositoryProvider.overrideWithValue(profile),
      ]),
    );
    await _settle(t);
    await _openMyPage(t);
    final row = find.byKey(const ValueKey('menu-area'));
    expect(
      find.descendant(of: row, matching: find.text('바로픽 부산진구')),
      findsOneWidget,
    );

    await t.tap(row);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('area-jeolla')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('area-confirm')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('area-목포지점')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('area-confirm')));
    await t.pumpAndSettle();
    expect(find.textContaining('바로픽 목포(으)로 바꿀까요?'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('area-change-confirm')));
    await _settle(t);

    expect(profile.areaMfcId, 'MFC-MPO-01');
    expect(find.text('배달 지역을 바꿨어요'), findsOneWidget);
    expect(
      find.descendant(of: row, matching: find.text('바로픽 목포')),
      findsOneWidget,
    );
  });

  Future<void> pickMokpo(WidgetTester t) async {
    await t.tap(find.byKey(const ValueKey('menu-area')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('area-jeolla')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('area-confirm')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('area-목포지점')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('area-confirm')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('area-change-confirm')));
    await _settle(t);
  }

  Future<MockProfileRepository> pumpResting(WidgetTester t) async {
    final duty = _Duty(startOnDuty: false);
    final profile = MockProfileRepository();
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(duty),
        dutyRepositoryProvider.overrideWithValue(duty),
        profileRepositoryProvider.overrideWithValue(profile),
      ]),
    );
    await _settle(t);
    await _openMyPage(t);
    return profile;
  }

  testWidgets('응답을 잃어도(결과 불명) 내 정보를 다시 읽어 바뀐 것을 확인한다', (t) async {
    final profile = await pumpResting(t);
    profile.loseNextReply = true;
    await pickMokpo(t);
    expect(profile.areaMfcId, 'MFC-MPO-01');
    expect(find.text('배달 지역을 바꿨어요'), findsOneWidget);
  });

  testWidgets('서버가 거절하면(반영 안 됨) 바꾸지 못했다고 하고 지점은 그대로', (t) async {
    final profile = await pumpResting(t);
    profile.failNextChange = const ProblemFailure(
      Problem(status: 409, code: ProblemCode.versionConflict),
    );
    await pickMokpo(t);
    expect(profile.areaMfcId, 'MFC-BSJ-01');
    expect(find.text('배달 지역을 바꾸지 못했어요. 잠시 뒤 다시 해 주세요'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('menu-area')),
        matching: find.text('바로픽 부산진구'),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    '고를 수 없는 지점(422 MFC_NOT_AVAILABLE)·운행 중(409 INVALID_STATE)은 그에 맞게 안내',
    (t) async {
      final profile = await pumpResting(t);
      profile.failNextChange = const ProblemFailure(
        Problem(status: 422, code: 'MFC_NOT_AVAILABLE'),
      );
      await pickMokpo(t);
      expect(find.text('이 지점은 지금 고를 수 없어요. 다른 지점을 골라 주세요'), findsOneWidget);
      await t.pump(const Duration(seconds: 5));
      await _settle(t);
      profile.failNextChange = const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
      await pickMokpo(t);
      expect(find.text('운행을 종료한 뒤 배달 지역을 바꿀 수 있어요'), findsOneWidget);
      expect(profile.areaMfcId, 'MFC-BSJ-01');
    },
  );

  testWidgets('운행 중이면 고르는 창을 열지 않고 안내한다', (t) async {
    final duty = _Duty(startOnDuty: true);
    final profile = MockProfileRepository();
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(duty),
        dutyRepositoryProvider.overrideWithValue(duty),
        profileRepositoryProvider.overrideWithValue(profile),
      ]),
    );
    await _settle(t);
    await _openMyPage(t);
    await t.tap(find.byKey(const ValueKey('menu-area')));
    await _settle(t);

    expect(find.text('운행을 종료한 뒤 배달 지역을 바꿀 수 있어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('area-confirm')), findsNothing);
    expect(profile.areaMfcId, 'MFC-BSJ-01');
  });

  test('목 저장소: 바뀐 값·버전을 돌려주고, 옛 버전으로 보내면 409', () async {
    final profile = MockProfileRepository();
    final changed = await profile.changeDeliveryArea(
      mfcId: 'MFC-MPO-01',
      expectedVersion: 1,
      key: IdempotencyKey.generate(),
    );
    expect(changed.deliveryAreaMfcId, 'MFC-MPO-01');
    expect(changed.version, 2);
    // 옛 버전으로 다시 보내면 409 VERSION_CONFLICT.
    await expectLater(
      profile.changeDeliveryArea(
        mfcId: 'MFC-BSJ-01',
        expectedVersion: 1,
        key: IdempotencyKey.generate(),
      ),
      throwsA(
        isA<ProblemFailure>().having(
          (f) => f.problem.code,
          'code',
          ProblemCode.versionConflict,
        ),
      ),
    );
  });

  test('운행을 새로 시작할 때는 mfcId 를 비워 보낸다(서버가 배달 지역으로 정함)', () async {
    final duty = _Duty(startOnDuty: false);
    final c = ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        dutyRepositoryProvider.overrideWithValue(duty),
        offerRepositoryProvider.overrideWithValue(duty),
        secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
      ],
    );
    addTearDown(c.dispose);
    await c.read(dutyProvider.future);
    await c.read(dutyProvider.notifier).change(onDuty: true, newDispatch: true);
    // 운행 중 신규배차만 바꿀 때는 지금 운행 지점을 그대로.
    await c
        .read(dutyProvider.notifier)
        .change(onDuty: true, newDispatch: false);
    expect(duty.sentMfcIds, [null, 'MFC-BSJ-01']);
  });
}
