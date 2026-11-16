// 화면 캡처 도구(디자인 전후 비교용). 에뮬레이터 없이 목 모드 앱을 테스트 러너로 그려 PNG 로 남긴다.
//   flutter test tool/screenshots.dart --update-goldens --dart-define=SHOT_DIR=<절대 경로>
// 글꼴: 테스트 러너에는 한글 글꼴이 없어 이 PC 의 Noto Sans KR(없으면 맑은 고딕)을 읽는다(캡처에만 쓰고 앱에 넣지 않는다).
// 상품 사진은 테스트에서 네트워크를 쓰지 않아 자리표시로 나온다.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart' show ProviderScope;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/app.dart';
import 'package:customer_app/features/checkout/data/mock_checkout_repository.dart';
import 'package:customer_app/features/checkout/presentation/checkout_controller.dart';
import 'package:customer_app/features/reviews/data/mock_reviews_repository.dart';
import 'package:customer_app/features/reviews/domain/reviews.dart';
import 'package:customer_app/features/reviews/presentation/reviews_controller.dart';
import 'package:pmart_core/pmart_core.dart' show UnknownResultFailure;

import '../test/support/app_harness.dart';

const _dir = String.fromEnvironment('SHOT_DIR');

Future<void> _font(String family, List<String> paths) async {
  final loader = FontLoader(family);
  var any = false;
  for (final p in paths) {
    final f = File(p);
    if (!f.existsSync()) continue;
    final bytes = await f.readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
    any = true;
  }
  if (any) await loader.load();
}

/// 테스트 본문 안(runAsync)에서 불러야 적용된다.
Future<void> _loadFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await _font('MaterialIcons', ['$material/materialicons-regular.otf']);
  const win = 'C:/Windows/Fonts';
  await _font('Roboto', ['$win/malgun.ttf', '$win/malgunbd.ttf']);
  const f = 'assets/fonts';
  await _font('Pretendard', [
    '$f/Pretendard-Regular.otf',
    '$f/Pretendard-SemiBold.otf',
    '$f/Pretendard-Bold.otf',
    '$f/Pretendard-ExtraBold.otf',
  ]);
}

void main() {
  setUpAll(initPmartFormatting);

  final now = DateTime.utc(2026, 10, 24, 3); // 서울 12:00

  testWidgets('screens', (t) async {
    if (_dir.isEmpty) fail('--dart-define=SHOT_DIR=<절대 경로> 가 필요하다');
    Directory(_dir).createSync(recursive: true);
    await t.runAsync(_loadFonts);
    // 테스트 러너는 그림자를 검은 테두리로 그린다 — 실제처럼 그리게 한다.
    debugDisableShadows = false;
    t.view
      ..physicalSize =
          const Size(1080, 2180) // 360 x 727 @3x (레퍼런스와 같은 폭)
      ..devicePixelRatio = 3;
    addTearDown(t.view.reset);

    final checkout = MockCheckoutRepository(
      latency: Duration.zero,
      now: () => now,
    );
    final reviews = MockReviewsRepository(latency: Duration.zero);
    // 고른 사진 대신 색 칸 PNG(캡처 전용).
    final samplePhotos = <ReviewPhotoFile>[];
    await t.runAsync(() async {
      for (final (i, c) in const [
        Color(0xFFB9A7E8),
        Color(0xFFF2C77B),
        Color(0xFF9BD3B5),
      ].indexed) {
        final rec = ui.PictureRecorder();
        Canvas(rec)
          ..drawRect(const Rect.fromLTWH(0, 0, 240, 240), Paint()..color = c)
          ..drawCircle(
            const Offset(120, 130),
            60,
            Paint()..color = Colors.white.withValues(alpha: 0.7),
          );
        final img = await rec.endRecording().toImage(240, 240);
        final png = await img.toByteData(format: ui.ImageByteFormat.png);
        samplePhotos.add(
          ReviewPhotoFile(name: 'p$i.png', bytes: png!.buffer.asUint8List()),
        );
      }
    });
    await t.pumpWidget(
      testApp(checkout: checkout, reviews: reviews, [
        reviewPhotoPickerProvider.overrideWithValue(
          (_, max) async => samplePhotos.take(max).toList(),
        ),
        clockProvider.overrideWithValue(() => now),
        draftPollPolicyProvider.overrideWithValue((
          interval: Duration.zero,
          attempts: 3,
        )),
      ]),
    );
    await t.pumpAndSettle();

    var n = 0;
    Future<void> shot(String name) async {
      await t.pumpAndSettle();
      n += 1;
      final file = File('$_dir/${n.toString().padLeft(2, '0')}-$name.png');
      await expectLater(find.byType(CustomerApp), matchesGoldenFile(file.uri));
    }

    GoRouter router() => GoRouter.of(t.element(find.byType(Scaffold).first));
    Future<void> go(String path) async {
      router().go(path);
      await t.pumpAndSettle();
    }

    Future<void> scrollDown(double dy) async {
      await t.drag(find.byType(Scrollable).first, Offset(0, -dy));
      await t.pumpAndSettle();
    }

    await shot('home');
    await scrollDown(700);
    await shot('home-2');
    await scrollDown(900);
    await shot('home-3');

    await go('/categories');
    await shot('categories');
    await go('/search');
    await shot('search');
    await t.enterText(find.byKey(const ValueKey('search-field')), '우유');
    await t.tap(find.byKey(const ValueKey('search-submit')));
    await t.pumpAndSettle();
    await shot('search-results');
    await go('/products?categoryId=C-10&title=유제품');
    await shot('product-list');

    await go('/');
    await tapTile(t, 'P-0001');
    await shot('product-detail');
    await scrollDown(600);
    await shot('product-detail-2');

    await go('/cart');
    await shot('cart');
    await t.tap(find.byKey(const ValueKey('cart-order')));
    await t.pumpAndSettle();
    await shot('login');
    await t.tap(find.byKey(const ValueKey('login-kakao')));
    await t.pumpAndSettle();
    await shot('delivery-select');
    await t.tap(find.byKey(const ValueKey('mode-single')));
    await t.pump();
    await shot('delivery-select-picked');
    unawaited(router().push('/checkout'));
    await t.pumpAndSettle();
    await shot('order-sheet');
    await scrollDown(700);
    await shot('order-sheet-2');

    await go('/my');
    await shot('my');
    await go('/orders');
    await shot('orders');
    await t.tap(
      find
          .byWidgetPredicate(
            (w) =>
                w is Material &&
                w.key is ValueKey<String> &&
                (w.key! as ValueKey<String>).value.startsWith('order-'),
          )
          .first,
    );
    await t.pumpAndSettle();
    await shot('order-detail');
    await scrollDown(650);
    await shot('order-detail-2');
    await go('/reviews');
    await shot('reviews');
    // 리뷰 쓰기 + 사진(review 0.2.0). 첫 사진은 결과 불명 → 다시 올리기.
    reviews.uploadFailures.add(const UnknownResultFailure(httpStatus: 503));
    await t.tap(find.byKey(const ValueKey('review-quick-star-ol-1-5')));
    await t.pumpAndSettle();
    await shot('review-write');
    await t.tap(find.byKey(const ValueKey('review-photo-add')));
    await t.pumpAndSettle();
    await shot('review-photo-sheet');
    await t.tap(find.byKey(const ValueKey('review-photo-gallery')));
    await t.pumpAndSettle();
    await t.runAsync(() => Future<void>.delayed(Duration.zero));
    await t.pumpAndSettle();
    await t.ensureVisible(find.byKey(const ValueKey('review-photo-add')));
    // 사진 미리보기(Image.memory) 디코딩은 실제 시간이 걸린다.
    await t.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await t.pumpAndSettle();
    await shot('review-write-photos');
    await t.tap(find.byKey(const ValueKey('review-photo-retry-0')));
    await t.pumpAndSettle();
    await t.runAsync(() => Future<void>.delayed(Duration.zero));
    await t.pumpAndSettle();
    await shot('review-write-photos-ok');
    await t.tap(find.byKey(const ValueKey('review-close')));
    await t.pumpAndSettle();
    // 내가 쓴 리뷰 → 리뷰 하나(수정·삭제, 백엔드 요청 2026-11-16 review-edit-delete).
    await t.tap(find.byKey(const ValueKey('review-tab-mine')));
    await t.pumpAndSettle();
    await shot('review-mine');
    await t.tap(find.byKey(const ValueKey('review-mine-open-rv-mine-1')));
    await t.pumpAndSettle();
    await shot('review-mine-detail');
    await t.tap(find.byKey(const ValueKey('review-edit')));
    await t.pumpAndSettle();
    await shot('review-edit');
    await t.tap(find.byKey(const ValueKey('review-star-3')));
    await t.pumpAndSettle();
    await shot('review-edit-changed');
    await t.tap(find.byKey(const ValueKey('review-edit-close')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('review-delete')));
    await t.pumpAndSettle();
    await shot('review-delete-confirm');
    await t.tap(find.byKey(const ValueKey('review-delete-cancel')));
    await t.pumpAndSettle();
    // 등록 후 3일이 지난 리뷰(서버 LOCKED).
    reviews.reviewJson.firstWhere((r) => r['reviewId'] == 'rv-mine-1')['state'] =
        'LOCKED';
    ProviderScope.containerOf(
      t.element(find.byType(Scaffold).first),
    ).invalidate(reviewProvider('rv-mine-1'));
    await go('/reviews');
    await t.tap(find.byKey(const ValueKey('review-tab-mine')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('review-mine-open-rv-mine-1')));
    await t.pumpAndSettle();
    await shot('review-mine-locked');
    reviews.reviewJson.firstWhere((r) => r['reviewId'] == 'rv-mine-1')['state'] =
        'PUBLISHED';
    await go('/addresses/new');
    await shot('address-new');
    await go('/notifications/settings');
    await shot('notice-settings');
    await go('/notifications');
    await shot('notifications');
    await go('/addresses');
    await shot('addresses');
    // 고객센터(레퍼런스 9-2 "3-1. 문의하기" 모양) · 문의 남기기 · 내 문의 · AI 상담
    await go('/support');
    await shot('support');
    await go('/support/inquiries/new');
    await shot('inquiry-new');
    await go('/support/inquiries');
    await shot('inquiries');
    await go('/support/inquiries/inq-seed-1');
    await shot('inquiry-detail');
    // 상담 종류 고르기(레퍼런스 고객센터 2-1) → 주문 건 문의의 최근 주문(2-4)
    await go('/support/chat');
    await shot('chat');
    Future<void> ask(String q) async {
      await t.enterText(find.byKey(const ValueKey('chat-input')), q);
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('chat-send')));
      await t.pumpAndSettle();
    }

    await t.tap(find.byKey(const ValueKey('chat-topic-order')));
    await t.pumpAndSettle();
    await shot('chat-pick-order');
    await t.tap(find.byKey(const ValueKey('chat-recent-order-seed-4')));
    await t.pumpAndSettle();
    await shot('chat-order-picked');
    await ask('언제 도착해요?');
    await shot('chat-order-topic');
    await t.tap(find.byKey(const ValueKey('chat-topic-change')));
    await t.pumpAndSettle();
    // 종류 바꾸기 → 앞 대화는 그대로, 새 선택지는 맨 아래(한 줄 시간순)
    await shot('chat-topic-change');
    await t.tap(find.byKey(const ValueKey('chat-topic-general')));
    await t.pumpAndSettle();

    await ask('상품 준비 중인 주문도 취소할 수 있나요?');
    await shot('chat-answer');
    // 취소 같은 실행 요청 → 최근 주문 카드(주문을 고르기 전, 일반 문의에서).
    await ask('주문 취소해 주세요 #취소');
    await t.drag(find.byType(Scrollable).first, const Offset(0, -900));
    await t.pumpAndSettle();
    await shot('chat-cancel-orders');
    await ask('내 주문 어디쯤이에요? #주문');
    await shot('chat-orders');
    await t.tap(find.byKey(const ValueKey('chat-order-order-seed-4')).last);
    await shot('chat-order-status');
    await ask('포인트는 언제 생기나요? #근거없음');
    await shot('chat-handoff');
    debugDisableShadows = true;
  });
}
