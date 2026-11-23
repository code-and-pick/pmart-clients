// 라이더 문의·채팅의 쓸 수 없는 말(case 0.37.0 — 사용자 2026-11-23 "입력 자체가 안 되게"):
// 422 BLOCKED_WORDS 는 접수되지 않은 확정 거절 — 입력 칸 아래에 알리고, 쓴 글은 지우지 않는다(결과 불명으로 보지 않는다).
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/inquiries/data/inquiries.dart';
import 'package:rider_app/features/inquiries/data/live_chat.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

const _blockedText = '쓸 수 없는 말이 들어 있어요. 고쳐서 다시 보내 주세요';

Widget _app() {
  final offers = MockOfferRepository(
    latency: Duration.zero,
    startOnDuty: false,
  );
  return ProviderScope(
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
      offerRepositoryProvider.overrideWithValue(offers),
      dutyRepositoryProvider.overrideWithValue(offers),
      inquiryRepositoryProvider.overrideWithValue(
        MockInquiryRepository(latency: Duration.zero),
      ),
    ],
    child: const RiderApp(),
  );
}

Future<void> _settle(WidgetTester t) async {
  for (var i = 0; i < 8; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _openSupport(WidgetTester t) async {
  await t.pumpWidget(_app());
  await _settle(t);
  await t.tap(find.byKey(const ValueKey('my-page')).first);
  await t.pumpAndSettle(const Duration(milliseconds: 50));
  // 마이페이지 아래쪽 줄이라 시험 화면 밖일 수 있다
  await t.scrollUntilVisible(
    find.byKey(const ValueKey('menu-inquiries')),
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await t.pumpAndSettle(const Duration(milliseconds: 50));
  await t.tap(find.byKey(const ValueKey('menu-inquiries')));
  await _settle(t);
}

void main() {
  setUpAll(initPmartFormatting);

  test('실서버 422 BLOCKED_WORDS → 확정 거절(isBlockedWords), 결과 불명 아님', () async {
    final a = FakeAdapter(
      (o, _) async =>
          FakeReply.problem(422, problemBody('BLOCKED_WORDS', status: 422)),
    );
    final dio = Dio(BaseOptions(baseUrl: 'http://fake/api/v1'))
      ..httpClientAdapter = a;
    await expectLater(
      ApiInquiryRepository(dio).create(
        InquiryKind.other,
        title: '제목',
        body: '본문',
        key: IdempotencyKey.generate(),
      ),
      throwsA(isA<ProblemFailure>().having(isBlockedWords, 'blocked', isTrue)),
    );
    await expectLater(
      ApiLiveChatRepository(
        dio,
        title: '실시간 채팅 상담',
      ).send('말', key: IdempotencyKey.generate()),
      throwsA(isA<ProblemFailure>().having(isBlockedWords, 'blocked', isTrue)),
    );
  });

  testWidgets('문의 남기기: 걸리면 입력 칸 아래에 알리고 글은 그대로, 고치면 알림이 사라지고 보내진다', (t) async {
    await _openSupport(t);
    await t.tap(find.byKey(const ValueKey('inquiry-new')));
    await _settle(t);
    await t.tap(find.byKey(const ValueKey('inq-kind-other')));
    await t.enterText(find.byKey(const ValueKey('inq-title')), '정산 문의');
    await t.enterText(find.byKey(const ValueKey('inq-body')), '이건 금지어 들어간 글');
    await t.pump();
    await t.tap(find.byKey(const ValueKey('inq-send')));
    await _settle(t);

    expect(find.text(_blockedText), findsOneWidget);
    expect(find.text('이건 금지어 들어간 글'), findsOneWidget);
    expect(find.text('보내지 못했어요. 같은 내용으로 다시 눌러 주세요'), findsNothing);

    await t.enterText(find.byKey(const ValueKey('inq-body')), '정산이 안 들어왔어요');
    await t.pump();
    expect(find.text(_blockedText), findsNothing);
    await t.tap(find.byKey(const ValueKey('inq-send')));
    await _settle(t);
    expect(find.byKey(const ValueKey('inq-send')), findsNothing); // 보내져 상세로 넘어감
  });

  testWidgets('채팅 상담: 걸리면 입력 칸에 글이 남고 알림, 연결 실패 문구는 아니다', (t) async {
    await _openSupport(t);
    await t.tap(find.byKey(const ValueKey('live-chat')));
    await _settle(t);
    await t.enterText(
      find.byKey(const ValueKey('live-chat-input')),
      '금지어 섞인 말',
    );
    await t.tap(find.byKey(const ValueKey('live-chat-send')));
    await _settle(t);

    expect(find.text(_blockedText), findsOneWidget);
    expect(find.text('금지어 섞인 말'), findsOneWidget);
    expect(find.text('메시지를 주고받지 못했어요. 잠시 뒤 다시 보내 주세요'), findsNothing);

    await t.enterText(
      find.byKey(const ValueKey('live-chat-input')),
      '정산 확인 부탁드려요',
    );
    await t.pump();
    expect(find.text(_blockedText), findsNothing);
  });
}
