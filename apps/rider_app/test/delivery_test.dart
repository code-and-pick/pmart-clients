import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:go_router/go_router.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/delivery/presentation/delivery_screen.dart';
import 'package:rider_app/features/delivery/presentation/delivery_texts.dart';
import 'package:rider_app/l10n/gen/app_localizations.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockDeliveryRepository repo;
  late MemoryKeyValueStore store;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    deliveryRepositoryProvider.overrideWithValue(repo),
    handoverRepositoryProvider.overrideWithValue(repo),
    evidenceUploaderProvider.overrideWithValue(repo),
    secureStoreProvider.overrideWithValue(store),
    fieldQueueStoreProvider.overrideWithValue(store),
  ];

  setUp(() {
    repo = MockDeliveryRepository(latency: Duration.zero);
    store = MemoryKeyValueStore();
  });

  test('QR 형식(BR-23 목)에서 포장 ID 를 꺼낸다', () {
    expect(packageIdFromQr(MockDeliveryRepository.qrFor('pkg-1')), 'pkg-1');
    expect(packageIdFromQr('garbage'), isNull);
  });

  group('배송 수행', () {
    late ProviderContainer c;
    late DeliveryFlowController flow;

    setUp(() {
      c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
      addTearDown(c.dispose);
      c.listen(deliveryFlowProvider('dlv-1'), (_, _) {});
      flow = c.read(deliveryFlowProvider('dlv-1').notifier);
    });

    Future<DeliveryView> delivery() => repo.get('dlv-1');
    DeliveryFlowState state() => c.read(deliveryFlowProvider('dlv-1'));
    String qr(String p) => MockDeliveryRepository.qrFor(p);

    test('가게 도착 → 포장별 인계 → 전부 인계 뒤 픽업 → 고객 도착 → 사진 업로드 뒤 전달 완료', () async {
      await flow.arriveAtStore();
      var d = await delivery();
      expect(d.state, ExecutionState.arrivedAtStore);

      await flow.scan(d, qr('pkg-1'));
      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
      expect(state().handoverIds, ['hof-pkg-1']);

      await flow.scan(d, qr('pkg-2'));
      await flow.pickup();
      d = await delivery();
      expect(d.state, ExecutionState.pickedUp);
      expect(d.handoverIds.toSet(), {'hof-pkg-1', 'hof-pkg-2'});

      await flow.arriveAtCustomer();
      await flow.complete(CompletionMethod.contactless, Placement.frontDoor);
      expect(
        (await delivery()).state,
        ExecutionState.arrivedAtCustomer,
        reason: '사진 없으면 보내지 않는다',
      );

      await flow.uploadPhoto();
      await flow.complete(CompletionMethod.contactless, Placement.frontDoor);
      expect((await delivery()).state, ExecutionState.completed);
    });

    test('부분 인계로 픽업을 보내면 서버가 HANDOVER_NOT_CONFIRMED 로 거절한다', () async {
      await flow.arriveAtStore();
      await flow.scan(await delivery(), qr('pkg-1'));

      await flow.pickup();

      final items = await c.read(riderQueueProvider).items();
      final pickup = items.firstWhere(
        (i) => i.kind == DeliveryCommandKind.pickup,
      );
      expect(pickup.state, QueueItemState.rejected);
      expect(pickup.rejectCode, HandoverProblemCode.handoverNotConfirmed);
      expect((await delivery()).state, ExecutionState.arrivedAtStore);
    });

    test('다른 배송·중복·읽기 실패 QR 은 서버에 보내기 전에 막는다', () async {
      await flow.arriveAtStore();
      final d = await delivery();

      expect(await flow.scan(d, qr('pkg-x')), ScanVerdict.otherDelivery);
      expect(await flow.scan(d, 'abc'), ScanVerdict.unreadable);
      await flow.scan(d, qr('pkg-1'));
      expect(await flow.scan(d, qr('pkg-1')), ScanVerdict.duplicate);
    });

    test('재포장으로 무효가 된 구 라벨은 서버가 거절한다', () async {
      await flow.arriveAtStore();
      repo.invalidatedQrs.add(qr('pkg-1'));

      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.rejected);
      expect(
        state().phaseOf('pkg-1').rejectCode,
        HandoverProblemCode.packageInvalidated,
      );
    });

    test('커밋 응답이 불명이면 판정 조회로 인계 완료를 확인한다(다시 스캔 안 함)', () async {
      await flow.arriveAtStore();
      repo.commitMode = MockCommit.unknownButApplied;

      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
      expect(state().phaseOf('pkg-1').handoverId, 'hof-pkg-1');
    });

    test('fence 불명이 계속되면 확인 중이고, 서버 확정 뒤 다시 확인으로 인계 완료가 된다', () async {
      await flow.arriveAtStore();
      repo.commitMode = MockCommit.unknownStillInProgress;
      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.checking);
      expect(state().handoverIds, isEmpty, reason: '불명은 인계 완료가 아니다');
      final keys = repo.commitKeys.toSet();
      expect(keys, hasLength(1), reason: '불명 재전송은 같은 키');

      repo.settleInProgress();
      await flow.checkAgain('pkg-1');

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
    });

    test('다른 기기·점원이 이미 인계한 포장을 찍으면 거절이 아니라 인계 완료로 맞춘다', () async {
      await flow.arriveAtStore();
      await flow.scan(await delivery(), qr('pkg-1'));
      // 앱을 다시 켠 것처럼 새 컨트롤러(인계 기록 없음)로 같은 포장을 다시 찍는다.
      final c2 = ProviderContainer(
        retry: (_, _) => null,
        overrides: overrides(),
      );
      addTearDown(c2.dispose);
      c2.listen(deliveryFlowProvider('dlv-1'), (_, _) {});
      final flow2 = c2.read(deliveryFlowProvider('dlv-1').notifier);

      await flow2.scan(await delivery(), qr('pkg-1'));

      final h = c2.read(deliveryFlowProvider('dlv-1')).phaseOf('pkg-1');
      expect(h.phase, HandoverPhase.handedOver);
      expect(h.handoverId, 'hof-pkg-1');
    });

    test('인계를 끝낸 라벨 숫자를 다시 넣으면 서버에 보내지 않고 "이미 인계된 포장"', () async {
      await flow.arriveAtStore();
      final d = await delivery();
      final code = MockDeliveryRepository.labelNumbers['pkg-1']!;
      await flow.enterCode(d, code);
      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);

      final again = await flow.enterCode(d, code);

      expect(again, isA<HandoverRejected>());
      expect(
        (again! as HandoverRejected).code,
        HandoverProblemCode.alreadyHandedOver,
      );
    });

    test('같은 수행 명령을 연달아 누르면 새로 넣지 않고 같은 명령을 다시 보낸다', () async {
      repo.offline = true;
      await flow.arriveAtStore();
      await flow.arriveAtStore();
      final items = (await c.read(riderQueueProvider).items())
          .where((i) => i.kind == DeliveryCommandKind.storeArrival)
          .toList();
      expect(items, hasLength(1));
      repo.offline = false;
      await flow.sync();
      expect((await delivery()).state, ExecutionState.arrivedAtStore);
    });

    test('출고가 중지된 포장은 중지로 보인다', () async {
      await flow.arriveAtStore();
      repo.stoppedPackages.add('pkg-2');

      await flow.scan(await delivery(), qr('pkg-2'));
      await flow.resolve('pkg-2');

      expect(state().phaseOf('pkg-2').phase, HandoverPhase.stopped);
    });

    test('오프라인 수행 명령은 저장됐다가 같은 키로 다시 보낸다', () async {
      repo.offline = true;
      await flow.arriveAtStore();
      final saved = await FieldQueue(store, name: 'rider').items();
      expect(saved.single.state, QueueItemState.queued);
      expect((await delivery()).state, ExecutionState.assigned);

      repo.offline = false;
      await flow.sync();

      expect(repo.sentKeys, [saved.single.id, saved.single.id]);
      expect((await delivery()).state, ExecutionState.arrivedAtStore);
      expect(
        (await c.read(riderQueueProvider).items()).single.state,
        QueueItemState.applied,
      );
    });

    test('사진 업로드 실패는 실패로 보이고 전달 완료를 보내지 않는다', () async {
      repo.uploadFails = true;
      await flow.uploadPhoto();
      expect(state().uploadFailed, isTrue);
      expect(state().photoRef, isNull);
    });
  });

  testWidgets('홈에서 배송 → 가게 도착 → QR 2개 인계 → 픽업 → 전달 완료', (t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
    }

    await settle();
    // 다른 제안이 와 있으면 제안 카드 위 '진행 중 배송' 한 줄을 눌러 들어간다.
    await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
    await settle();
    // 포장이 끝난 배송은 상태 자리에 "포장완료" 꼬리표(사용자 2026-11-25 레퍼런스 "조리완료" 자리).
    expect(find.byKey(const ValueKey('packed-tag')), findsOneWidget);
    expect(find.text('포장완료'), findsOneWidget);
    expect(find.byKey(const ValueKey('call-store')), findsOneWidget);

    // 기본 화면(레퍼런스 image 14): 예정·장소·도움요청|길찾기만. 배달 정보·진행 버튼은 펼쳐야 보인다.
    final screenBottom = t.view.physicalSize.height / t.view.devicePixelRatio;
    expect(find.byKey(const ValueKey('help')).hitTestable(), findsOneWidget);
    expect(
      find.byKey(const ValueKey('navigate')).hitTestable(),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('arrive-store')).hitTestable(),
      findsNothing,
    );
    expect(
      t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy,
      greaterThanOrEqualTo(screenBottom - 1),
    );

    // 아래 시트: 회색바를 누르면 펼쳐지고(배달 정보), 다시 누르면 접힌다.
    final peek = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400)); // 펼치는 애니메이션
    final opened = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    expect(opened, lessThan(peek - 100));
    // 펼치면 배달 정보와 진행 버튼(가게 도착)이 보인다.
    expect(
      t.getTopLeft(find.byKey(const ValueKey('order-info'))).dy,
      lessThan(screenBottom - 100),
    );
    expect(find.byKey(const ValueKey('arrive-store')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400)); // 접히는 애니메이션
    expect(
      t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy,
      closeTo(peek, 1),
    );
    // 위로 끌어 올리면 올린 만큼 펼쳐지고 그대로 머문다(되돌아가지 않는다).
    await t.drag(
      find.byKey(const ValueKey('sheet-handle')),
      const Offset(0, -300),
    );
    await settle();
    final dragged = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    expect(dragged, lessThan(peek - 200));
    // 끌어 내리다 놓으면 손을 뗀 속도로 조금 더 가다 부드럽게 느려지며 멈춘다(사용자 2026-11-23 "자연스럽게 속도에 따라 멈추게").
    // 프레임마다 위치를 재서: 놓은 뒤에도 바로 이어 움직이고, 아래로만, 한 프레임 이동이 점점 준다.
    final handle = find.byKey(const ValueKey('sheet-handle'));
    final gesture = await t.startGesture(t.getCenter(handle));
    for (var i = 0; i < 10; i++) {
      await gesture.moveBy(
        const Offset(0, 12),
        timeStamp: Duration(milliseconds: 16 * (i + 1)),
      );
      await t.pump(const Duration(milliseconds: 16));
    }
    final released = t.getTopLeft(handle).dy;
    await gesture.up(timeStamp: const Duration(milliseconds: 176));
    final ys = <double>[released];
    for (var i = 0; i < 50; i++) {
      await t.pump(const Duration(milliseconds: 16));
      ys.add(t.getTopLeft(handle).dy);
    }
    final steps = [for (var i = 1; i < ys.length; i++) ys[i] - ys[i - 1]];
    // ignore: avoid_print
    print(
      'sheet glide px/frame: ${steps.take(30).map((v) => v.toStringAsFixed(1)).join(' ')}',
    );
    expect(steps.first, greaterThan(2));
    for (var i = 1; i < steps.length; i++) {
      expect(steps[i], greaterThanOrEqualTo(-0.01));
      expect(steps[i], lessThanOrEqualTo(steps[i - 1] + 0.5));
    }
    expect(steps.last.abs(), lessThan(0.5));
    final flung = ys.last;
    expect(flung, greaterThan(released + 20));
    expect(flung, lessThan(peek - 30));
    // 끝까지 올린 뒤 회색바를 누르면 접힌다(천천히 끌면 놓은 자리에 멈추므로 끝까지 끈다).
    await t.drag(
      find.byKey(const ValueKey('sheet-handle')),
      const Offset(0, -1600),
    );
    await settle();
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    expect(
      t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy,
      closeTo(peek, 1),
    );
    expect(
      find.byKey(const ValueKey('arrive-store')).hitTestable(),
      findsNothing,
    );

    // 펼쳐서 진행한다(이 화면에 있는 동안 펼친 채로 둔다).
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    // 진행 버튼은 시트가 올라간 다음 프레임부터 미끄러져 올라온다.
    await t.pump(const Duration(milliseconds: 400));
    await t.tap(find.byKey(const ValueKey('arrive-store')));
    await settle();
    // 가게 도착 뒤 배송 화면에는 포장 인계 상자(0 / 2·포장별 QR)를 두지 않는다 — QR 픽업 화면에서 본다.
    expect(find.byKey(const ValueKey('handover-progress')), findsNothing);
    expect(find.byKey(const ValueKey('pkg-pkg-1')), findsNothing);

    // 주문정보: 8자리 주문번호 · 한글 지점명 · 품목 · 요청사항. 거절 코드·전송확인 버튼은 없다.
    expect(find.byKey(const ValueKey('order-info')), findsOneWidget);
    expect(find.text('바로픽 부산진구'), findsWidgets);
    // 고객앱 목의 진행 중 주문과 같은 품목.
    expect(find.textContaining('그릭요거트 플레인 400g'), findsOneWidget);
    expect(find.textContaining('INVALID_STATE'), findsNothing);
    expect(find.byKey(const ValueKey('sync')), findsNothing);

    // QR코드 픽업 화면(시험에는 카메라가 없어 숫자 입력 칸이 바로 보인다)
    await t.tap(find.byKey(const ValueKey('qr-pickup')));
    await settle();

    Future<void> enterNumber(String digits) async {
      await t.enterText(find.byKey(const ValueKey('qr-number')), digits);
      await t.tap(find.byKey(const ValueKey('qr-number-submit')));
      await settle();
    }

    final pickup = find.byKey(const ValueKey('pickup'));
    // 4·6자리가 아니면 보내지 않는다, 틀리면 남은 횟수(5번이면 잠김 — mfc-fulfillment 0.23.0)
    await enterNumber('12');
    expect(find.text('라벨 숫자 4자리를 입력해 주세요'), findsOneWidget);
    await enterNumber('9999');
    expect(find.text('이 배달의 포장 숫자가 아니에요. 4번 더 틀리면 숫자 입력이 막혀요'), findsOneWidget);
    await enterNumber(MockDeliveryRepository.labelNumbers['pkg-1']!);
    expect(find.text('포장 인계 1 / 2'), findsOneWidget);
    expect(find.byKey(const ValueKey('partial-handover')), findsOneWidget);
    expect(t.widget<RiderButton>(pickup).onPressed, isNull);

    await enterNumber(MockDeliveryRepository.labelNumbers['pkg-2']!);
    expect(t.widget<RiderButton>(pickup).onPressed, isNotNull);
    await t.tap(pickup);
    await settle();
    expect(find.text('전달지로 이동해주세요'), findsOneWidget);
    // 전달지 주소(도로명 + 상세)는 시트 위 큰 글씨, 고객 요청사항 + 공동현관 칸, 위 오른쪽 "고객 전화".
    expect(find.textContaining('부산 부산진구 전포대로 210'), findsWidgets);
    expect(find.byKey(const ValueKey('customer-request')), findsOneWidget);
    expect(find.byKey(const ValueKey('entrance-box')), findsOneWidget);
    expect(find.byKey(const ValueKey('call-customer')), findsOneWidget);
    // 고객도착 단계 버튼 없이 바로 전달완료.
    expect(
      find.byKey(const ValueKey('arrive-customer')).hitTestable(),
      findsNothing,
    );

    // 사진을 올리기 전에는 전달완료를 누를 수 없다.
    final complete = find.byKey(const ValueKey('complete'));
    expect(t.widget<RiderButton>(complete).onPressed, isNull);

    // "전달 사진 촬영하기" → 촬영하기 창(열 때 고객 도착을 앱이 대신 보낸다) → 올리면 닫힌다.
    expect(find.text('전달 사진 촬영하기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('photo')));
    await settle();
    expect(repo.deliveryJson('dlv-1')['state'], 'ARRIVED_AT_CUSTOMER');
    await t.tap(find.byKey(const ValueKey('upload-photo')));
    await settle();
    await settle();
    expect(find.byKey(const ValueKey('upload-photo')), findsNothing);
    expect(find.text('사진 올리기 완료 (다시 찍기)'), findsOneWidget);

    // 다시 찍으러 들어가면 이전 사진이 크게 보인다.
    await t.tap(find.byKey(const ValueKey('photo')));
    await settle();
    expect(find.byKey(const ValueKey('photo-preview')), findsOneWidget);
    expect(find.text('다시 찍기'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await settle();

    // 전달완료 → "고객님께 어떻게 전달하셨나요?" → 다음.
    expect(t.widget<RiderButton>(complete).onPressed, isNotNull);
    await t.tap(complete);
    await settle();
    expect(find.text('고객님께 어떻게\n전달하셨나요?'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('complete-confirm')));
    await settle();
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    // 완료 뒤에는 전달지를 부르지 않으니 주소 자리를 "확인 중"(읽는 중)으로 두지 않는다(2026-11-21 S23).
    expect(find.text('확인 중'), findsNothing);
    // 완료 카드가 배달료(정산 내역)를 읽는 시간을 기다린다
    await t.pump(const Duration(seconds: 2));
  });

  group('라벨 숫자 안내', () {
    final l10n = lookupAppLocalizations(const Locale('ko'));
    const wrong = HandoverRejected(
      HandoverProblemCode.handoverCodeMismatch,
      attemptsLeft: 3,
    );
    test('같이 픽업하는 다른 주문이 없으면 기본 안내', () {
      expect(
        labelNumberResultText(l10n, wrong),
        '이 배달의 포장 숫자가 아니에요. 3번 더 틀리면 숫자 입력이 막혀요',
      );
    });
    test('같은 MFC 에서 픽업 전인 다른 주문이 있으면 그 주문 화면에서 넣으라고 알린다', () {
      expect(
        labelNumberResultText(l10n, wrong, pickingUpOthers: true),
        contains('그 주문 화면에서 넣어 주세요. 3번 더 틀리면'),
      );
      expect(
        labelNumberResultText(
          l10n,
          const HandoverRejected(HandoverProblemCode.handoverCodeMismatch),
          pickingUpOthers: true,
        ),
        contains('그 주문 화면에서 넣어 주세요'),
      );
    });
  });

  group('배차취소', () {
    test('픽업 전에는 접수되고 진행 목록에서 빠진다', () async {
      expect(
        await repo.cancel('dlv-1', key: IdempotencyKey.generate()),
        CancelOutcome.accepted,
      );
      expect(await repo.myActive(), isEmpty);
    });

    test('픽업 뒤에는 배차취소가 아니라 지원센터 안내다', () async {
      repo.deliveryJson('dlv-1')['state'] = 'PICKED_UP';
      expect(
        await repo.cancel('dlv-1', key: IdempotencyKey.generate()),
        CancelOutcome.pickedUpCaseRequired,
      );
      expect((await repo.get('dlv-1')).state, ExecutionState.pickedUp);
    });
  });

  testWidgets('수행 화면에서 배차취소를 접수하면 홈으로 돌아간다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          assignmentCancelRepositoryProvider.overrideWithValue(repo),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
    }

    await settle();
    // 다른 제안이 와 있으면 제안 카드 위 '진행 중 배송' 한 줄을 눌러 들어간다.
    await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
    await settle();
    // 배차취소는 도움요청 메뉴 안에 있다.
    await t.tap(find.byKey(const ValueKey('help')));
    await settle();
    await t.tap(find.byKey(const ValueKey('cancel-assignment')));
    await settle();
    // 반복 배차취소 안내는 취소를 고르는 창에 보인다.
    expect(find.byKey(const ValueKey('cancel-penalty-notice')), findsOneWidget);
    expect(find.textContaining('제안 순서가 뒤로 밀리고'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('cancel-assignment-confirm')));
    await settle();

    expect(repo.cancelKeys, hasLength(1));
    expect(find.text('배차취소를 접수했어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-dlv-1')), findsNothing);
  });

  testWidgets(
    '배차취소 뒤 서버 진행 중 목록이 늦게 따라와도(아직 그 배송을 줌) 진행 중에 남지 않는다(사용자 2026-11-19)',
    (t) async {
      t.view
        ..physicalSize = const Size(800, 2000)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      // 수행 서비스가 배정 해제를 아직 반영하기 전 — 다시 읽어도 같은 목록(dlv-1 포함)을 준다.
      final stale = (await t.runAsync(repo.myActive))!
          .where((d) => d.deliveryId == 'dlv-1')
          .toList();
      expect(stale, hasLength(1));
      final offers = MockOfferRepository(latency: Duration.zero);
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [
            ...overrides(),
            assignmentCancelRepositoryProvider.overrideWithValue(repo),
            myActiveDeliveriesProvider.overrideWith((ref) async => stale),
            initialSessionProvider.overrideWithValue(
              const RiderSession(riderId: 'rider-mock-1'),
            ),
            offerRepositoryProvider.overrideWithValue(offers),
            dutyRepositoryProvider.overrideWithValue(offers),
          ],
          child: const RiderApp(),
        ),
      );
      Future<void> settle() async {
        for (var i = 0; i < 6; i++) {
          await t.pump(const Duration(milliseconds: 20));
        }
      }

      await settle();
      await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
      await settle();
      await t.tap(find.byKey(const ValueKey('help')));
      await settle();
      await t.tap(find.byKey(const ValueKey('cancel-assignment')));
      await settle();
      await t.tap(find.byKey(const ValueKey('cancel-assignment-confirm')));
      await settle();

      expect(find.text('배차취소를 접수했어요'), findsOneWidget);
      expect(find.byKey(const ValueKey('delivery-dlv-1')), findsNothing);
      // 화면 전환이 끝난 뒤 — 홈에도, 배달리스트 진행 탭에도 남지 않는다(목록이 그 배송을 계속 줘도)
      await t.pump(const Duration(seconds: 1));
      await settle();
      expect(find.byKey(const ValueKey('delivery-sheet')), findsNothing);
      expect(find.byKey(const ValueKey('active-count')), findsNothing);
      unawaited(
        GoRouter.of(t.element(find.byType(Scaffold).first)).push('/deliveries'),
      );
      await t.pump(const Duration(seconds: 1));
      await settle();
      // 일반 배차모드면 진행 탭으로(AI 추천 모드는 탭 없이 진행 목록)
      final progressTab = find.byKey(const ValueKey('list-tab-0'));
      if (progressTab.evaluate().isNotEmpty) {
        await t.tap(progressTab);
        await settle();
      }
      expect(find.byKey(const ValueKey('delivery-dlv-1')), findsNothing);
    },
  );

  testWidgets(
    '배송을 잠깐 못 읽어도(막 생긴 반납 배송 등) 오류 화면 대신 불러오는 중으로 두고 저절로 다시 읽는다(사용자 2026-11-19)',
    (t) async {
      t.view
        ..physicalSize = const Size(800, 2000)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      repo.notFoundNextGets = 3;
      final router = GoRouter(
        initialLocation: '/d',
        routes: [
          GoRoute(
            path: '/d',
            builder: (_, _) => const DeliveryScreen(deliveryId: 'dlv-1'),
          ),
        ],
      );
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: overrides(),
          child: MaterialApp.router(
            routerConfig: router,
            localizationsDelegates: const [
              ...AppLocalizations.localizationsDelegates,
              PmartUiLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      for (var i = 0; i < 4; i++) {
        await t.pump(const Duration(seconds: 3));
        // 오류 화면("다시 시도")이 뜨지 않는다
        expect(find.text('다시 시도'), findsNothing);
      }
      await t.pump(const Duration(milliseconds: 100));
      expect(repo.notFoundNextGets, 0);
      expect(find.byKey(const ValueKey('delivery-sheet')), findsWidgets);
    },
  );
}
