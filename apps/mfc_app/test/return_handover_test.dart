import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/handover/data/mock_handover_repository.dart';
import 'package:mfc_app/features/handover/presentation/handover_controller.dart';
import 'package:mfc_app/features/return_handover/data/mock_return_handover_repository.dart';
import 'package:mfc_app/features/return_handover/data/return_handover_repository.dart';
import 'package:mfc_app/features/return_handover/domain/return_handover.dart';
import 'package:mfc_app/features/return_handover/presentation/return_handover_controller.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockReturnHandoverRepository returns;
  late MockHandoverRepository handovers;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    taskRepositoryProvider.overrideWithValue(
      MockTaskRepository(latency: Duration.zero),
    ),
    returnHandoverRepositoryProvider.overrideWithValue(returns),
    handoverRepositoryProvider.overrideWithValue(handovers),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
  ];

  setUp(() {
    returns = MockReturnHandoverRepository(latency: Duration.zero);
    handovers = MockHandoverRepository(latency: Duration.zero);
  });

  group('새 번호', () {
    late ProviderContainer c;

    setUp(() {
      c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
      addTearDown(c.dispose);
    });

    ReissueController ctl(String id) {
      c.listen(reissueFlowProvider(id), (_, _) {});
      return c.read(reissueFlowProvider(id).notifier);
    }

    test('새 번호를 내면 잠김이 풀리고 목록이 새 번호를 보인다', () async {
      final before = await c.read(returnHandoversProvider.future);
      final locked = before.firstWhere((h) => h.deliveryId == 'dlv-ret-2');
      expect(locked.locked, isTrue);
      await ctl('dlv-ret-2').submit();
      expect(c.read(reissueFlowProvider('dlv-ret-2')).phase, ReissuePhase.done);
      final after = await c.read(returnHandoversProvider.future);
      final fresh = after.firstWhere((h) => h.deliveryId == 'dlv-ret-2');
      expect(fresh.locked, isFalse);
      expect(fresh.failedAttempts, 0);
      expect(fresh.code, isNot(locked.code));
    });

    test('응답을 잃으면 같은 키로 다시 보내 한 번만 바뀐다', () async {
      returns.loseNextReissueResponse = true;
      await ctl('dlv-ret-1').submit();
      expect(c.read(reissueFlowProvider('dlv-ret-1')).phase, ReissuePhase.done);
      expect(returns.reissueCalls, 2);
      final after = await c.read(returnHandoversProvider.future);
      // 목은 같은 키를 한 번만 반영한다 — 두 번째 새 번호(키가 달랐다면)의 값이 아니다.
      expect(
        after.firstWhere((h) => h.deliveryId == 'dlv-ret-1').issuedAt,
        DateTime.utc(2026, 11, 18, 6, 1),
      );
    });

    test('계속 결과를 모르면 불명으로 두고, 다시 확인도 같은 키', () async {
      c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          reissueResendAttemptsProvider.overrideWithValue(0),
        ],
      );
      addTearDown(c.dispose);
      returns.loseNextReissueResponse = true;
      await ctl('dlv-ret-1').submit();
      expect(
        c.read(reissueFlowProvider('dlv-ret-1')).phase,
        ReissuePhase.unknown,
      );
      await ctl('dlv-ret-1').submit();
      expect(c.read(reissueFlowProvider('dlv-ret-1')).phase, ReissuePhase.done);
      final after = await c.read(returnHandoversProvider.future);
      expect(
        after.firstWhere((h) => h.deliveryId == 'dlv-ret-1').issuedAt,
        DateTime.utc(2026, 11, 18, 6, 1),
      );
    });

    test('이미 반납이 끝난 배송은 거절로 두고 목록을 다시 본다', () async {
      await c.read(returnHandoversProvider.future);
      returns.returned('dlv-ret-1');
      await ctl('dlv-ret-1').submit();
      final f = c.read(reissueFlowProvider('dlv-ret-1'));
      expect(f.phase, ReissuePhase.rejected);
      expect(f.rejectCode, 'INVALID_STATE');
      final after = await c.read(returnHandoversProvider.future);
      expect(after.map((h) => h.deliveryId), ['dlv-ret-2']);
    });
  });

  testWidgets('반납 번호: 메뉴 → 번호 크게, 잠긴 건 새 번호(한 번 더 확인)', (t) async {
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
    await t.tap(find.byKey(const ValueKey('menu-return-handover')));
    await t.pumpAndSettle();

    expect(find.text('반납 인증번호'), findsOneWidget);
    expect(find.byKey(const ValueKey('rh-code-dlv-ret-1')), findsOneWidget);
    expect(find.text('4821'), findsOneWidget);
    expect(find.text('배송 번호: D-1118-0042'), findsOneWidget);
    // 라이더 ID(r-7) 대신 가린 이름·라이더 번호(ADR-0070).
    expect(find.text('라이더: 김*수 · 482913'), findsOneWidget);
    expect(find.textContaining('r-7'), findsNothing);
    // 화면의 라이더(r-7·r-9)를 모아 한 번에 묻는다 — 줄마다 묻지 않는다.
    expect(find.text('라이더: 이*진 · 377102'), findsOneWidget);
    expect(handovers.riderLabelRequests, [
      ['r-7', 'r-9'],
    ]);
    expect(find.text('라이더가 1번 틀렸어요'), findsOneWidget);
    // 잠긴 배송은 번호 대신 잠김 안내.
    expect(find.byKey(const ValueKey('rh-locked-dlv-ret-2')), findsOneWidget);
    expect(find.text('0397'), findsNothing);

    // 취소하면 보내지 않는다.
    await t.tap(find.byKey(const ValueKey('rh-reissue-dlv-ret-2')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('confirm-cancel')));
    await t.pumpAndSettle();
    expect(returns.reissueCalls, 0);

    await t.tap(find.byKey(const ValueKey('rh-reissue-dlv-ret-2')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('confirm-ok')));
    await t.pumpAndSettle();
    expect(returns.reissueCalls, 1);
    expect(find.byKey(const ValueKey('rh-locked-dlv-ret-2')), findsNothing);
    expect(find.byKey(const ValueKey('rh-code-dlv-ret-2')), findsOneWidget);
    expect(find.text('새 번호를 냈어요. 라이더에게 다시 알려 주세요'), findsOneWidget);
  });

  group('연동(delivery-execution 0.28.0)', () {
    ReturnHandoverRepository repo(FakeAdapter a) => ApiReturnHandoverRepository(
      createPmartDio(
        baseUrl: 'http://test.invalid/api/v1',
        sourceSystem: sourceSystem,
        tokens: TokenStore(MemoryKeyValueStore()),
        refresher: (_) async => null,
        adapter: a,
        delay: (_) async {},
      ),
    );

    test('목록: 경로·mfcId, 필드 변환', () async {
      final adapter = FakeAdapter(
        (_, _) async => const FakeReply(
          200,
          body: {
            'items': [
              {
                'deliveryId': 'dlv-1',
                'deliveryNumber': 'D-1',
                'purpose': 'MISDELIVERY_RECOVERY',
                'state': 'RETURN_PICKED_UP',
                'riderId': 'r-1',
                'code': '1234',
                'failedAttempts': 5,
                'locked': true,
                'issuedAt': '2026-11-18T05:00:00Z',
              },
              {
                'deliveryId': 'dlv-2',
                'deliveryNumber': null,
                'purpose': 'SOMETHING_NEW',
                'state': 'ASSIGNED',
                'riderId': null,
                'code': '0001',
                'failedAttempts': 0,
                'locked': false,
                'issuedAt': '2026-11-18T05:10:00Z',
              },
            ],
          },
        ),
      );
      final list = await repo(adapter).waiting('MFC-1');
      final req = adapter.requests.single;
      expect(req.uri.path, '/api/v1/return-handovers');
      expect(req.uri.queryParameters, {'mfcId': 'MFC-1'});
      expect(list.first.purpose, ReturnPurpose.misdeliveryRecovery);
      expect(list.first.locked, isTrue);
      expect(list.first.issuedAt, DateTime.utc(2026, 11, 18, 5));
      expect(list.last.purpose, ReturnPurpose.other);
      expect(list.last.deliveryNumber, isNull);
      // 번호가 toString 으로 새지 않는다.
      expect(list.first.toString(), isNot(contains('1234')));
    });

    test('새 번호: 경로·헤더, 200 새 번호, 409 거절, 타임아웃은 불명', () async {
      var i = 0;
      final adapter = FakeAdapter((_, _) async {
        i++;
        return switch (i) {
          1 => const FakeReply(
            200,
            body: {
              'deliveryId': 'dlv-1',
              'state': 'RETURN_PICKED_UP',
              'code': '5678',
              'failedAttempts': 0,
              'locked': false,
              'issuedAt': '2026-11-18T06:00:00Z',
            },
          ),
          2 => FakeReply.problem(409, problemBody('INVALID_STATE')),
          _ => const FakeReply.transport(DioExceptionType.receiveTimeout),
        };
      });
      final r = repo(adapter);
      Future<ReissueOutcome> send() =>
          r.reissue('dlv-1', key: IdempotencyKey('k-1'));
      expect(
        await send(),
        isA<Reissued>().having((x) => x.handover.code, 'code', '5678'),
      );
      expect(
        await send(),
        isA<ReissueRejected>().having((x) => x.code, 'code', 'INVALID_STATE'),
      );
      expect(await send(), isA<ReissueUnknown>());
      final req = adapter.requests.first;
      expect(req.method, 'POST');
      expect(req.uri.path, '/api/v1/return-handovers/dlv-1/code-reissues');
      expect(req.headers['Idempotency-Key'], 'k-1');
      expect(req.headers['X-Source-System'], 'mfc-app');
    });
  });
}
