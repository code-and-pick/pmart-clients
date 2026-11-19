import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/handover/data/handover_repository.dart';
import 'package:mfc_app/features/handover/data/mock_handover_repository.dart';
import 'package:mfc_app/features/handover/domain/handover.dart';
import 'package:mfc_app/features/handover/presentation/handover_controller.dart';
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/domain/packing.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/router.dart';
import 'package:mfc_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockHandoverRepository handovers;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    taskRepositoryProvider.overrideWithValue(
      MockTaskRepository(latency: Duration.zero, packDemo: true),
    ),
    packingRepositoryProvider.overrideWithValue(
      MockPackingRepository(latency: Duration.zero),
    ),
    handoverRepositoryProvider.overrideWithValue(handovers),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
  ];

  setUp(() => handovers = MockHandoverRepository(latency: Duration.zero));

  group('점원 확인', () {
    late ProviderContainer c;

    setUp(() {
      c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
      addTearDown(c.dispose);
    });

    CheckController ctl(String id) {
      c.listen(checkFlowProvider(id), (_, _) {});
      return c.read(checkFlowProvider(id).notifier);
    }

    test('확인 필요 목록은 허가 만료가 오래된 순', () async {
      final list = await c.read(handoverChecksProvider.future);
      expect(list.items.map((h) => h.packageId), ['pkg-chk-1', 'pkg-chk-2']);
      expect(list.items.first.checkRequired, isTrue);
      expect(list.items.first.packingLocation, 'PAK-C-03');
    });

    test('포장대에 있음 → 허가 해제, 확인 필요에서 빠짐', () async {
      await ctl('pkg-chk-1').submit(HandoverCheck.atStation);
      final f = c.read(checkFlowProvider('pkg-chk-1'));
      expect(f.phase, CheckPhase.done);
      expect(f.result!.verdict, HandoverVerdict.ready);
      final list = await c.read(handoverChecksProvider.future);
      expect(list.items.map((h) => h.packageId), ['pkg-chk-2']);
    });

    test('포장대에 없음 → 인계 확정, 재고 처리 중이면 확정 대기로 보인다', () async {
      handovers.inventoryProcessingOnTake = true;
      await ctl('pkg-chk-1').submit(HandoverCheck.takenByRider);
      final r = await c.read(handoverProvider('pkg-chk-1').future);
      expect(r.verdict, HandoverVerdict.handedOver);
      expect(r.inventory, InventoryApply.processing);
      expect(r.lastCheck!.result, HandoverCheck.takenByRider);
    });

    test('응답을 잃으면 같은 키로 다시 보내 한 번만 반영된다', () async {
      handovers.loseNextCheckResponse = true;
      await ctl('pkg-chk-1').submit(HandoverCheck.takenByRider);
      // 자동 재전송(같은 키)으로 확정된다.
      expect(c.read(checkFlowProvider('pkg-chk-1')).phase, CheckPhase.done);
      expect(handovers.checkCalls, 2);
    });

    test('재전송으로도 모르면 확인 중, 다시 확인은 처음 값으로만 보낸다', () async {
      c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          checkResendAttemptsProvider.overrideWithValue(0),
        ],
      );
      addTearDown(c.dispose);
      handovers.loseNextCheckResponse = true;
      final k = ctl('pkg-chk-1');
      await k.submit(HandoverCheck.takenByRider);
      expect(c.read(checkFlowProvider('pkg-chk-1')).phase, CheckPhase.unknown);
      // 다른 값을 눌러도 결과 불명인 값(TAKEN_BY_RIDER)으로 같은 키 재전송.
      await k.submit(HandoverCheck.atStation);
      final f = c.read(checkFlowProvider('pkg-chk-1'));
      expect(f.phase, CheckPhase.done);
      expect(f.result!.verdict, HandoverVerdict.handedOver);
    });

    test('허가가 살아 있으면 FENCE_ACTIVE 거절', () async {
      await ctl('pkg-live-1').submit(HandoverCheck.atStation);
      final f = c.read(checkFlowProvider('pkg-live-1'));
      expect(f.phase, CheckPhase.rejected);
      expect(f.rejectCode, HandoverProblemCode.fenceActive);
    });

    test('재고 결과 불명·거절은 확정으로 보이지 않는다', () async {
      final u = await c.read(handoverProvider('pkg-unk-1').future);
      expect(u.inventory, InventoryApply.unknownResult);
      expect(u.verdict, isNot(HandoverVerdict.handedOver));
      final r = await c.read(handoverProvider('pkg-rej-1').future);
      expect(r.inventory, InventoryApply.rejected);
    });
  });

  group('연동', () {
    ApiHandoverRepository repo(FakeAdapter a) => ApiHandoverRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: a,
        delay: (_) async {},
      ),
    );

    test('목록 파라미터·응답 변환', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {
            'items': [
              {
                'packageId': 'pkg-1',
                'packageVersion': 2,
                'packageState': 'SEALED',
                'verdict': 'HANDOVER_IN_PROGRESS',
                'fence': {
                  'state': 'EXPIRED',
                  'fenceVersion': 1,
                  'expiresAt': '2026-11-10T02:48:00Z',
                },
                'inventoryApplyStatus': 'NOT_REQUESTED',
                'checkRequired': true,
                'packingLocation': 'PAK-C-03',
                'riderId': 'r-1',
              },
            ],
            'asOf': {'freshness': 'STALE'},
          },
        ),
      );
      final list = await repo(adapter).toCheck('MFC-1');
      final req = adapter.requests.single;
      expect(req.uri.path, '/api/v1/packages');
      expect(req.uri.queryParameters, {
        'mfcId': 'MFC-1',
        'checkRequired': 'true',
      });
      expect(list.fresh, isFalse);
      final h = list.items.single;
      expect(h.fence, FenceState.expired);
      expect(h.packageVersion, 2);
      expect(h.fenceExpiresAt, DateTime.utc(2026, 11, 10, 2, 48));
    });

    test('확인: 본문·헤더, 409 FENCE_ACTIVE 는 거절, 타임아웃은 불명', () async {
      var i = 0;
      final adapter = FakeAdapter((_, _) async {
        i++;
        return i == 1
            ? FakeReply.problem(409, problemBody('FENCE_ACTIVE'))
            : const FakeReply.transport(DioExceptionType.receiveTimeout);
      });
      final r = repo(adapter);
      Future<CheckOutcome> send() => r.check(
        'pkg-1',
        HandoverCheck.takenByRider,
        key: IdempotencyKey('k-1'),
      );
      expect(
        await send(),
        isA<CheckRejected>().having((x) => x.code, 'code', 'FENCE_ACTIVE'),
      );
      expect(await send(), isA<CheckUnknown>());
      final req = adapter.requests.first;
      expect(req.uri.path, '/api/v1/packages/pkg-1/handover-checks');
      expect(req.headers['Idempotency-Key'], 'k-1');
      expect(req.headers['X-Source-System'], 'mfc-app');
      final body = jsonDecode(req.data as String) as Map<String, dynamic>;
      expect(body['result'], 'TAKEN_BY_RIDER');
    });

    test('라이더 표기: 50개씩 나눠 묻고 합친다(없는 ID 는 빠짐)', () async {
      final adapter = FakeAdapter((o, _) async {
        final ids = (o.uri.queryParameters['riderIds'] ?? '').split(',');
        return FakeReply(
          200,
          body: {
            'items': [
              for (final id in ids)
                if (id != 'r-missing')
                  {'riderId': id, 'riderNumber': '100000', 'nameMasked': '김*수'},
            ],
          },
        );
      });
      final ids = [for (var i = 0; i < 120; i++) 'r-$i', 'r-missing'];
      final labels = await repo(adapter).riderLabels(ids);
      expect(adapter.requests, hasLength(3));
      for (final r in adapter.requests) {
        expect(r.uri.path, '/api/v1/riders/display-names');
        expect(
          r.uri.queryParameters['riderIds']!.split(',').length,
          lessThanOrEqualTo(50),
        );
      }
      expect(labels, hasLength(120));
      expect(labels['r-119']?.text, '김*수 · 100000');
      expect(labels.containsKey('r-missing'), isFalse);
    });

    test('재고 반영 상태가 없거나 모르는 값이면 확인 중으로 본다', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {'packageId': 'pkg-1', 'verdict': 'HANDED_OVER'},
        ),
      );
      final h = await repo(adapter).resolution('pkg-1');
      expect(h.inventory, InventoryApply.unknownResult);
      expect(h.fresh, isFalse);
    });

    test('ETA 는 픽업 구간을 쓴다', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {
            'deliveryId': 'dlv-1',
            'stage': 'TO_STORE',
            'pickupEta': {'status': 'LOCATING'},
            'dropEta': {'status': 'AVAILABLE', 'remainingSeconds': 900},
            'asOf': {'freshness': 'CURRENT'},
          },
        ),
      );
      final e = await repo(adapter).pickupEta('dlv-1');
      expect(adapter.requests.single.uri.path, '/api/v1/deliveries/dlv-1/eta');
      expect(e.status, EtaStatus.locating);
      expect(e.remainingSeconds, isNull);
    });
  });

  testWidgets('인계 확인 목록은 시스템 ID 대신 인계 번호·주문번호·라이더 표기(ADR-0070)', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: overrides(),
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('menu-handover')));
    await t.pumpAndSettle();
    expect(find.text('인계 번호 3817'), findsOneWidget);
    expect(find.text('주문 20000007'), findsOneWidget);
    expect(find.text('허가받은 라이더: 박*민 · 503217'), findsOneWidget);
    // 탈퇴로 이름이 지워진 라이더는 번호만.
    expect(find.text('허가받은 라이더: 611045'), findsOneWidget);
    expect(find.textContaining('pkg-chk-1'), findsNothing);
    expect(find.textContaining('order-seed'), findsNothing);
    expect(find.textContaining('rider-mock'), findsNothing);
  });

  testWidgets('라이더 표기 조회 실패는 "라이더(이름 못 읽음)" — ID 를 대신 보이지 않는다', (t) async {
    handovers.failRiderLabels = true;
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: overrides(),
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('menu-handover')));
    await t.pumpAndSettle();
    expect(find.text('허가받은 라이더: 라이더(이름 못 읽음)'), findsNWidgets(2));
    expect(find.textContaining('rider-mock'), findsNothing);
  });

  testWidgets('인계 확인: 목록 → 포장대에 없음(한 번 더 확인) → 확정 안내', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: overrides(),
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('menu-handover')));
    await t.pumpAndSettle();
    expect(find.text('놓인 위치: PAK-C-03'), findsOneWidget);

    // 취소하면 보내지 않는다.
    await t.tap(find.byKey(const ValueKey('check-taken-pkg-chk-1')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('confirm-cancel')));
    await t.pumpAndSettle();
    expect(handovers.checkCalls, 0);

    await t.tap(find.byKey(const ValueKey('check-taken-pkg-chk-1')));
    await t.pumpAndSettle();
    // 확인 창도 라이더 ID 대신 표기(ADR-0070) — 목록과 같은 조회 한 번을 쓴다.
    final dialog = find.byType(AlertDialog);
    expect(
      find.descendant(
        of: dialog,
        matching: find.textContaining(RegExp(r'허가받은 라이더\(\S+ · \d{6}\)')),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(of: dialog, matching: find.textContaining('rider-mock')),
      findsNothing,
    );
    expect(handovers.riderLabelRequests, hasLength(1));
    await t.tap(find.byKey(const ValueKey('confirm-ok')));
    await t.pumpAndSettle();
    expect(handovers.checkCalls, 1);
    expect(find.text('라이더 인계로 확정됐어요.'), findsOneWidget);
    expect(find.byKey(const ValueKey('check-item-pkg-chk-1')), findsNothing);
    expect(find.byKey(const ValueKey('check-item-pkg-chk-2')), findsOneWidget);
  });

  testWidgets('포장 인계 상태: 재고 결과 불명이면 다시 건네지 말라고 안내, 픽업 ETA', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: overrides(),
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    unawaited(
      ProviderScope.containerOf(t.element(find.byType(Scaffold).first))
          .read(routerProvider)
          .push<void>('/packages/pkg-unk-1/handover'),
    );
    await t.pumpAndSettle();
    expect(find.text('인계 진행 중'), findsOneWidget);
    expect(find.textContaining('포장을 다시 건네지 마세요'), findsOneWidget);
    expect(find.byKey(const ValueKey('check-required')), findsNothing);
    expect(find.textContaining('도착 예정 (약 4분)'), findsOneWidget);
  });
}
