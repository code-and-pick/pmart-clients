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
import 'package:mfc_app/features/packing/data/mock_packing_repository.dart';
import 'package:mfc_app/features/packing/data/packing_repository.dart';
import 'package:mfc_app/features/packing/domain/packing.dart';
import 'package:mfc_app/features/packing/presentation/packing_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/domain/task_list.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/shared/product_hints.dart';
import 'package:mfc_app/shared/providers.dart';
import 'package:mfc_app/shared/scanner/scan_input.dart';

import 'support.dart';

Future<void> closeLabel(WidgetTester t) async {
  await t.tap(
    find
        .descendant(
          of: find.byKey(const ValueKey('label-preview')),
          matching: find.byType(TextButton),
        )
        .last,
  );
  await t.pumpAndSettle();
}

void main() {
  setUpAll(initPmartFormatting);

  late MockTaskRepository tasks;
  late MockPackingRepository packing;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    taskRepositoryProvider.overrideWithValue(tasks),
    packingRepositoryProvider.overrideWithValue(packing),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
  ];

  setUp(() {
    tasks = MockTaskRepository(latency: Duration.zero, packDemo: true);
    packing = MockPackingRepository(
      latency: Duration.zero,
      onShipmentReady: tasks.shipmentReady,
    );
  });

  group('패킹 흐름', () {
    late ProviderContainer c;
    late PackingController ctl;
    late TaskDetailView task;

    setUp(() async {
      c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
      addTearDown(c.dispose);
      c
        ..listen(packingProvider('task-mock-2'), (_, _) {})
        ..listen(shipmentProvider('shp-2'), (_, _) {});
      ctl = c.read(packingProvider('task-mock-2').notifier);
      task = await c.read(taskDetailProvider('task-mock-2').future);
    });

    Future<ShipmentView> shipment() => c.read(shipmentProvider('shp-2').future);

    test('출하에 없는 상품·담을 수량 초과는 봉투에 넣지 않는다', () async {
      final s = await shipment();
      expect(
        ctl.scan(task, s, MockTaskRepository.chipsBarcode),
        PackScan.wrongItem,
      );
      expect(
        ctl.scan(task, s, MockTaskRepository.yogurtBarcode),
        PackScan.matched,
      );
      expect(
        ctl.scan(task, s, MockTaskRepository.yogurtBarcode),
        PackScan.overExpected,
      );
      expect(c.read(packingProvider('task-mock-2')).inBag('ol-1'), 1);
    });

    test('봉투 온도대는 담은 상품으로 정해지고, 다른 온도대는 같은 봉투에 담지 않는다', () async {
      final s = await shipment();
      expect(ctl.zonesKnown(task), isTrue);
      expect(ctl.bagZone(task), isNull);
      ctl.scan(task, s, MockTaskRepository.yogurtBarcode);
      expect(ctl.bagZone(task), StorageZone.chilled);
      expect(
        c.read(packingProvider('task-mock-2')).zone,
        TemperatureZone.chilled,
      );
      expect(
        ctl.scan(task, s, MockTaskRepository.dumplingBarcode),
        PackScan.otherZone,
      );
      expect(c.read(packingProvider('task-mock-2')).inBag('ol-4'), 0);

      await ctl.seal(task, s);
      expect(
        ctl.scan(task, await shipment(), MockTaskRepository.dumplingBarcode),
        PackScan.matched,
      );
      expect(
        c.read(packingProvider('task-mock-2')).zone,
        TemperatureZone.frozen,
      );
      await ctl.seal(task, await shipment());
      final zones = [
        for (final p in (await shipment()).packages) p.temperatureZone,
      ];
      expect(zones, ['CHILLED', 'FROZEN']);
    });

    test('밀봉하면 QR 포장이 생기고, 모든 수량이 밀봉돼야 출하 준비가 된다', () async {
      var s = await shipment();
      ctl
        ..scan(task, s, MockTaskRepository.yogurtBarcode)
        ..scan(task, s, MockTaskRepository.milkBarcode);
      await ctl.seal(task, s);

      s = await shipment();
      expect(s.packages.single.qrCode, isNotNull);
      expect(s.state, ShipmentState.preparing);

      ctl.scan(task, s, MockTaskRepository.milkBarcode);
      await ctl.seal(task, s);
      s = await shipment();
      expect(s.state, ShipmentState.preparing, reason: '냉동이 아직');

      ctl.scan(task, s, MockTaskRepository.dumplingBarcode);
      await ctl.seal(task, s);

      s = await shipment();
      expect(s.packages, hasLength(3));
      expect(s.state, ShipmentState.ready);
    });

    test('밀봉 응답을 잃으면 같은 키로 다시 보내 포장을 하나만 만든다', () async {
      packing.loseNextSealResponse = true;
      final s = await shipment();
      ctl.scan(task, s, MockTaskRepository.yogurtBarcode);

      await ctl.seal(task, s);

      expect((await shipment()).packages, hasLength(1));
      expect(c.read(packingProvider('task-mock-2')).sealUnknown, isFalse);
    });

    test('재포장은 새 버전·새 QR, 옛 라벨은 무효. 인계 중에는 재포장할 수 없다', () async {
      var s = await shipment();
      ctl.scan(task, s, MockTaskRepository.yogurtBarcode);
      await ctl.seal(task, s);
      s = await shipment();
      final first = s.packages.single;

      final outcome = await ctl.repack(
        s.shipmentId,
        first,
        RepackReason.damagedBag,
      );

      final second = (outcome as PackDone).package;
      expect(second.packageVersion, 2);
      expect(second.qrCode, isNot(first.qrCode));
      s = await shipment();
      expect(
        s.packages.firstWhere((p) => p.packageId == first.packageId).state,
        PackageState.invalidated,
      );
      expect(s.packedByLine['ol-1'], 1, reason: '무효 포장은 합계에서 빠진다');

      packing.startHandover(second.packageId);
      c.invalidate(shipmentProvider('shp-2'));
      s = await shipment();
      final fenced = s.packages.firstWhere(
        (p) => p.packageId == second.packageId,
      );
      expect(fenced.canRepack, isFalse);
      expect(
        await ctl.repack(s.shipmentId, fenced, RepackReason.labelUnreadable),
        isA<PackRejected>(),
      );
    });

    test('포장 중 배차 요청(예상 분) → 출고에 점원 요청이 남고, 다시 요청해도 하나다', () async {
      final s = await shipment();
      await ctl.requestDispatch(s.shipmentId, 12);
      final after = await shipment();
      expect(after.dispatchRequest?.trigger, DispatchTrigger.manual);
      expect(after.dispatchRequest?.estimatedPackMinutes, 12);
      expect(c.read(packingProvider('task-mock-2')).dispatchUnknown, isFalse);

      await ctl.requestDispatch(s.shipmentId, 30);
      expect((await shipment()).dispatchRequest?.estimatedPackMinutes, 12);
    });

    test('요청 없이 포장이 끝나도 자동 요청은 없다(직원 요청만)', () async {
      var s = await shipment();
      ctl
        ..scan(task, s, MockTaskRepository.yogurtBarcode)
        ..scan(task, s, MockTaskRepository.milkBarcode)
        ..scan(task, s, MockTaskRepository.milkBarcode);
      await ctl.seal(task, s);
      ctl.scan(task, await shipment(), MockTaskRepository.dumplingBarcode);
      await ctl.seal(task, await shipment());
      s = await shipment();
      // 다 밀봉하면 서버가 PACK 을 스스로 끝낸다 — 끝 버튼은 실행을 보내지 않는다.
      expect(tasks.taskJson('task-mock-2')['state'], 'COMPLETED');
      await ctl.finish(task, s);

      expect(c.read(packingProvider('task-mock-2')).packingFinished, isTrue);
      expect(tasks.sentPayloads, isEmpty, reason: 'PACK 실행은 보내지 않는다');
      expect(s.state, ShipmentState.ready);
      expect(s.dispatchRequest, isNull);
    });

    test('서버 출고가 아직 READY 가 아니면 끝으로 보이지 않는다', () async {
      final s = await shipment();
      await ctl.finish(task, s);
      final st = c.read(packingProvider('task-mock-2'));
      expect(st.packingFinished, isFalse);
      expect(st.stepError, PackStepError.notFinished);
      expect(tasks.sentPayloads, isEmpty);
    });

    test('응답을 잃으면 확인 중 — 다시 확인은 같은 키·같은 분', () async {
      packing.loseNextDispatchResponse = true;
      final id = (await shipment()).shipmentId;
      await ctl.requestDispatch(id, 7);
      expect(c.read(packingProvider('task-mock-2')).dispatchUnknown, isTrue);

      await ctl.recheckDispatch(id);
      final st = c.read(packingProvider('task-mock-2'));
      expect(st.dispatchUnknown, isFalse);
      expect(packing.dispatchCalls, 2);
      expect((await shipment()).dispatchRequest?.estimatedPackMinutes, 7);
    });

    test('취소된 출고는 배차 요청이 거절된다(INVALID_STATE)', () async {
      packing.shipmentCancelled = true;
      await ctl.requestDispatch((await shipment()).shipmentId, 5);
      expect(
        c.read(packingProvider('task-mock-2')).dispatchRejectCode,
        PackProblemCode.invalidState,
      );
    });
  });

  group('연동', () {
    ApiPackingRepository repo(FakeAdapter a) => ApiPackingRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: a,
        delay: (_) async {},
      ),
    );

    test('밀봉: 본문 내용물·온도대, 409 CONTENT_MISMATCH 는 거절, 타임아웃은 불명', () async {
      var i = 0;
      final adapter = FakeAdapter((_, _) async {
        i++;
        return i == 1
            ? FakeReply.problem(409, problemBody('CONTENT_MISMATCH'))
            : const FakeReply.transport(DioExceptionType.receiveTimeout);
      });
      final r = repo(adapter);
      Future<PackOutcome> seal() => r.seal(
        'shp-1',
        const [ContentLine(orderLineId: 'ol-1', sku: 'E-00000001', qty: 2)],
        bagCount: 1,
        zone: TemperatureZone.chilled,
        key: IdempotencyKey('k-1'),
      );

      expect(
        await seal(),
        isA<PackRejected>().having((p) => p.code, 'code', 'CONTENT_MISMATCH'),
      );
      expect(await seal(), isA<PackUnknown>());
      final body = jsonDecode(
        adapter.requests.first.data as String,
      ) as Map<String, dynamic>;
      expect(body['temperatureZone'], 'CHILLED');
      expect((body['contents'] as List).single['qty'], 2);
      expect(
        adapter.requests.first.uri.path,
        '/api/v1/shipments/shp-1/packages',
      );
    });

    test('배차 요청: 출고 경로·예상 분 본문·멱등키, 200(이미 요청)도 요청됨, 타임아웃은 불명', () async {
      var i = 0;
      final adapter = FakeAdapter((_, _) async {
        i++;
        return i == 1
            ? const FakeReply(
                200,
                body: {
                  'shipmentId': 'shp-1',
                  'trigger': 'AUTO_ON_READY',
                  'estimatedPackMinutes': null,
                  'estimatedReadyAt': '2026-11-10T03:10:00Z',
                  'requestedAt': '2026-11-10T03:00:00Z',
                },
              )
            : const FakeReply.transport(DioExceptionType.receiveTimeout);
      });
      final r = repo(adapter);
      Future<DispatchOutcome> send() => r.requestDispatch(
        'shp-1',
        estimatedPackMinutes: 9,
        key: IdempotencyKey('k-2'),
      );

      final first = await send();
      expect(
        first,
        isA<DispatchDone>().having(
          (d) => d.request.trigger,
          'trigger',
          DispatchTrigger.autoOnReady,
        ),
      );
      expect(await send(), isA<DispatchUnknown>());
      final req = adapter.requests.first;
      expect(req.uri.path, '/api/v1/shipments/shp-1/dispatch-requests');
      expect(req.headers['Idempotency-Key'], 'k-2');
      expect(jsonDecode(req.data as String) as Map<String, dynamic>, {
        'estimatedPackMinutes': 9,
      });
    });

    test('배차 요청 409 INVALID_STATE 는 거절', () async {
      final r = repo(
        FakeAdapter(
          (_, _) async => FakeReply.problem(409, problemBody('INVALID_STATE')),
        ),
      );
      expect(
        await r.requestDispatch(
          'shp-1',
          estimatedPackMinutes: 3,
          key: IdempotencyKey('k-3'),
        ),
        isA<DispatchRejected>().having((d) => d.code, 'code', 'INVALID_STATE'),
      );
    });
  });

  Future<void> openPacking(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(412, 915)
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
    // 진행 중인 내 패킹 — 작업 상세 없이 바로 패킹 화면.
    await openRoute(t, '/tasks/task-mock-2');
    expect(find.text('패킹'), findsOneWidget);
  }

  Future<void> scanTo(WidgetTester t, String id, String code) async {
    await t.enterText(find.byKey(ValueKey(id)), code);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
  }

  bool enabled(WidgetTester t, String key) =>
      t
          .widget<FilledButton>(
            find.descendant(
              of: find.byKey(ValueKey(key)),
              matching: find.byType(FilledButton),
            ),
          )
          .onPressed !=
      null;

  testWidgets('패킹 화면: 패킹대 → 장바구니 → 배차 요청 → 온도대별 봉투(라벨 자동) → 출하대기 랙 → 끝', (
    t,
  ) async {
    await openPacking(t);
    expect(find.byKey(const ValueKey('pack-order')), findsOneWidget);

    // 1. 패킹대.
    await scanTo(t, 'station-scan', 'C-S1-01-1-01');
    expect(find.text('패킹대(PAK) 바코드가 아니에요'), findsWidgets);
    await scanTo(t, 'station-scan', 'PAK-C-02');

    // 2. 장바구니(이 기기가 피킹 장바구니를 모르면 장바구니 형식만 본다).
    await scanTo(t, 'pack-cart-scan', 'PAK-C-02');
    expect(find.byKey(const ValueKey('pack-step-error')), findsOneWidget);
    await scanTo(t, 'pack-cart-scan', 'CRT-C-01');

    // 3. 배차 — 고르기 전에는 요청할 수 없다. 키보드 입력칸 없음.
    expect(find.byKey(const ValueKey('pack-scan')), findsNothing);
    expect(find.byKey(const ValueKey('pack-minutes')), findsNothing);
    expect(enabled(t, 'request-dispatch'), isFalse);
    await t.tap(find.byKey(const ValueKey('pack-min-10')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('request-dispatch')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('dispatch-requested')), findsOneWidget);

    // 4. 담기 — 온도대는 상품 정보로, 다른 온도대는 같은 봉투에 안 담는다.
    expect(find.byKey(const ValueKey('zone-select')), findsNothing);
    expect(find.text('봉투 온도대는 처음 담는 상품으로 정해져요'), findsOneWidget);
    // 피킹처럼 한 번에 하나 — 카메라는 맞게 한 번 찍으면 닫힌다(사용자 2026-11-19)
    expect(
      t
          .widget<ScanInput>(
            find.byWidgetPredicate(
              (w) => w is ScanInput && w.id == 'pack-scan',
            ),
          )
          .continuous,
      isFalse,
    );
    await scanTo(t, 'pack-scan', MockTaskRepository.yogurtBarcode);
    expect(find.text('지금 봉투: 냉장'), findsOneWidget);
    await scanTo(t, 'pack-scan', MockTaskRepository.dumplingBarcode);
    expect(find.byKey(const ValueKey('pack-scan-error')), findsOneWidget);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    // 밀봉하면 라벨이 바로 나온다(프린터 없음 = 미리보기).
    expect(find.byKey(const ValueKey('label-preview')), findsOneWidget);
    await closeLabel(t);
    expect(packing.sealedAt['pkg-1'], 'PAK-C-02', reason: '밀봉 본문 포장 위치 = 패킹대');

    await scanTo(t, 'pack-scan', MockTaskRepository.dumplingBarcode);
    expect(find.text('지금 봉투: 냉동'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    // 5. 출하대기 랙.
    expect(find.text('모든 상품을 담았어요(출하 준비)'), findsOneWidget);
    expect(
      t
          .widget<FilledButton>(find.byKey(const ValueKey('finish-packing')))
          .onPressed,
      isNull,
    );
    await scanTo(t, 'rack-scan', 'PAK-C-02');
    expect(find.text('출하대기 랙(DSP) 바코드가 아니에요'), findsWidgets);
    await scanTo(t, 'rack-scan', 'DSP-A-01');
    await t.tap(find.byKey(const ValueKey('finish-packing')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('packing-finished')), findsOneWidget);
    expect(find.text('패킹을 끝냈어요 — 출하대기 DSP-A-01'), findsOneWidget);
    expect(tasks.taskJson('task-mock-2')['state'], 'COMPLETED');
  });

  testWidgets('패킹 화면: 배차를 요청해야 담기로 간다(직원 요청만, 자동 요청 없음)', (t) async {
    await openPacking(t);
    await scanTo(t, 'station-scan', 'PAK-C-01');
    await scanTo(t, 'pack-cart-scan', 'CRT-C-01');
    expect(find.text('포장을 시작해요. 예상 포장 시간을 고르고 배차를 요청해요'), findsOneWidget);
    expect(find.byKey(const ValueKey('pack-scan')), findsNothing);
    await t.tap(find.byKey(const ValueKey('pack-min-5')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('request-dispatch')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('pack-scan')), findsOneWidget);
    final s = await t.runAsync(() => packing.shipment('shp-2'));
    expect(s!.dispatchRequest?.trigger, DispatchTrigger.manual);
    expect(s.dispatchRequest?.estimatedPackMinutes, 5);
  });

  Future<void> toBagStep(WidgetTester t) async {
    await openPacking(t);
    await scanTo(t, 'station-scan', 'PAK-C-02');
    await scanTo(t, 'pack-cart-scan', 'CRT-C-01');
    await t.tap(find.byKey(const ValueKey('pack-min-10')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('request-dispatch')));
    await t.pumpAndSettle();
  }

  String text(WidgetTester t, String key) =>
      t.widget<Text>(find.byKey(ValueKey(key))).data!;

  testWidgets('분할 포장: 같은 온도대도 담은 만큼만 밀봉 → 남은 상품은 새 봉투(봉투 번호·남은 수량·버튼 문구)', (
    t,
  ) async {
    await toBagStep(t);
    expect(text(t, 'bag-no'), '봉투 1번째');
    expect(find.byKey(const ValueKey('pack-split-hint')), findsOneWidget);
    expect(text(t, 'pack-split-progress'), '아직 밀봉 안 한 상품 4개 · 이 봉투에 0개');

    // 냉장 요거트 1개만 담고 밀봉 — 남은 게 있으니 "이 봉투만 밀봉".
    await scanTo(t, 'pack-scan', MockTaskRepository.yogurtBarcode);
    expect(text(t, 'pack-split-progress'), '아직 밀봉 안 한 상품 4개 · 이 봉투에 1개');
    expect(find.text('이 봉투 밀봉 · 남은 건 새 봉투'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    expect(text(t, 'bag-no'), '봉투 2번째');
    expect(text(t, 'pack-next-bag'), '봉투 1개 밀봉 — 남은 3개를 새 봉투에 담아요');
    // 같은 냉장 우유 2개는 두 번째 봉투에.
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    // 마지막 봉투(냉동 만두) — 다 담으면 원래 문구.
    expect(text(t, 'bag-no'), '봉투 3번째');
    await scanTo(t, 'pack-scan', MockTaskRepository.dumplingBarcode);
    expect(find.text('밀봉하고 라벨 만들기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    expect(find.text('모든 상품을 담았어요(출하 준비)'), findsOneWidget);
    final s = await t.runAsync(() => packing.shipment('shp-2'));
    final sealed = s!.packages
        .where((p) => p.state == PackageState.sealed)
        .toList();
    expect(sealed, hasLength(3));
    expect(
      [
        for (final p in sealed)
          p.contents.map((c) => '${c.orderLineId}x${c.qty}').join(),
      ],
      ['ol-1x1', 'ol-2x2', 'ol-4x1'],
    );
    expect(t.takeException(), isNull);
  });

  testWidgets('봉투 나누기: 밀봉한 봉투를 둘로(합계 그대로) → 새 라벨 2장, 옛 포장 무효', (t) async {
    await toBagStep(t);
    await scanTo(t, 'pack-scan', MockTaskRepository.yogurtBarcode);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    await t.ensureVisible(find.byKey(const ValueKey('split-pkg-1')));
    await t.tap(find.byKey(const ValueKey('split-pkg-1')));
    await t.pumpAndSettle();
    // 아무것도 안 옮기면 못 나눈다.
    expect(find.byKey(const ValueKey('split-invalid')), findsOneWidget);
    expect(
      t
          .widget<FilledButton>(find.byKey(const ValueKey('split-confirm')))
          .onPressed,
      isNull,
    );
    // 전부 옮겨도 못 나눈다(한 봉투가 빈다).
    await t.tap(find.byKey(const ValueKey('split-more-ol-1')));
    await t.tap(find.byKey(const ValueKey('split-more-ol-2')));
    await t.tap(find.byKey(const ValueKey('split-more-ol-2')));
    await t.pump();
    expect(find.byKey(const ValueKey('split-invalid')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('split-less-ol-1')));
    await t.tap(find.byKey(const ValueKey('split-less-ol-2')));
    await t.pump();
    expect(text(t, 'split-qty-ol-2'), '1 / 2');
    await t.tap(find.byKey(const ValueKey('split-confirm')));
    await t.pumpAndSettle();
    // 새 봉투마다 라벨.
    await closeLabel(t);
    await closeLabel(t);
    expect(find.byKey(const ValueKey('label-preview')), findsNothing);
    expect(find.text('봉투 2개로 나눴어요 — 새 라벨을 붙여요'), findsOneWidget);

    expect(packing.regroupCalls, 1);
    final s = await t.runAsync(() => packing.shipment('shp-2'));
    final byId = {for (final p in s!.packages) p.packageId: p};
    expect(byId['pkg-1']!.state, PackageState.invalidated);
    expect(
      byId['pkg-2']!.contents.map((c) => '${c.orderLineId}x${c.qty}').join(','),
      'ol-1x1,ol-2x1',
    );
    expect(
      byId['pkg-3']!.contents.map((c) => '${c.orderLineId}x${c.qty}').join(','),
      'ol-2x1',
    );
    // 합계는 그대로 — 남은 건 만두 1개.
    expect(text(t, 'pack-split-progress'), '아직 밀봉 안 한 상품 1개 · 이 봉투에 0개');
    expect(t.takeException(), isNull);
  });

  testWidgets('봉투 나누기 결과 불명 → 같은 나눔은 같은 키로(새 포장이 두 번 생기지 않음)', (t) async {
    await toBagStep(t);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await scanTo(t, 'pack-scan', MockTaskRepository.milkBarcode);
    await t.tap(find.byKey(const ValueKey('seal')));
    await t.pumpAndSettle();
    await closeLabel(t);

    packing.loseNextRegroupResponse = true;
    Future<void> splitOne(String pkg) async {
      await t.ensureVisible(find.byKey(ValueKey('split-$pkg')));
      await t.tap(find.byKey(ValueKey('split-$pkg')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('split-more-ol-2')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('split-confirm')));
      await t.pumpAndSettle();
    }

    await splitOne('pkg-1');
    expect(
      find.text('나눴는지 확인하지 못했어요 — 같은 수량으로 다시 나누면 같은 요청으로 확인해요'),
      findsOneWidget,
    );
    final c = ProviderScope.containerOf(t.element(find.byType(MfcApp)));
    final ctl = c.read(packingProvider('task-mock-2').notifier);
    final s0 = await t.runAsync(() => packing.shipment('shp-2'));
    final old = s0!.packages.firstWhere((p) => p.packageId == 'pkg-1');
    final again = await t.runAsync(() => ctl.split('shp-2', old, {'ol-2': 1}));
    expect(again, isA<RegroupDone>());
    expect(packing.regroupCalls, 2);
    final s = await t.runAsync(() => packing.shipment('shp-2'));
    expect(
      s!.packages.where((p) => p.state == PackageState.sealed),
      hasLength(2),
    );
    expect(s.packages, hasLength(3));
  });

  test('splitContents: 한 주문 줄이 LOT 여러 줄이면 앞 줄부터 옮기고 LOT 는 그대로', () {
    const p = PackageView(
      packageId: 'pkg-x',
      packageVersion: 1,
      version: 1,
      state: PackageState.sealed,
      fence: FenceState.none,
      contents: [
        ContentLine(orderLineId: 'ol-2', sku: 'MILK', qty: 1, lotId: 'LOT-A'),
        ContentLine(orderLineId: 'ol-2', sku: 'MILK', qty: 2, lotId: 'LOT-B'),
        ContentLine(orderLineId: 'ol-1', sku: 'YOG', qty: 1),
      ],
    );
    final r = splitContents(p, {'ol-2': 2})!;
    String show(List<ContentLine> xs) =>
        xs.map((c) => '${c.orderLineId}:${c.lotId}x${c.qty}').join(',');
    expect(show(r.move), 'ol-2:LOT-Ax1,ol-2:LOT-Bx1');
    expect(show(r.keep), 'ol-2:LOT-Bx1,ol-1:nullx1');
    expect(splitContents(p, {}), isNull);
    expect(splitContents(p, {'ol-2': 3, 'ol-1': 1}), isNull);
  });
}
