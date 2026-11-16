import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart' show DioExceptionType;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_core/testing.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/claims/presentation/claims_controller.dart'
    show CommandDone, CommandRejected, CommandUnknown;
import 'package:customer_app/features/reviews/data/mock_reviews_repository.dart';
import 'package:customer_app/features/reviews/data/reviews_repository.dart';
import 'package:customer_app/features/reviews/domain/reviews.dart';
import 'package:customer_app/features/reviews/presentation/reviews_controller.dart';
import 'package:customer_app/shared/providers.dart' show sourceSystem;

import 'support/app_harness.dart';

/// 리뷰(고객앱 레퍼런스 반영 E, 2026-11-04). review-service 는 백엔드 미구현이라 목·계약 픽스처로만 시험한다.
void main() {
  setUpAll(initPmartFormatting);

  const unknown = UnknownResultFailure(httpStatus: 503);
  const target = ReviewTarget(
    orderId: 'order-seed-1',
    orderLineId: 'ol-1',
    productId: 'P-0001',
  );

  group('API 저장소(계약 경로·헤더)', () {
    late FakeAdapter adapter;

    ApiReviewsRepository repo(FakeReply Function(int index) reply) {
      adapter = FakeAdapter((_, i) async => reply(i));
      return ApiReviewsRepository(
        createPmartDio(
          baseUrl: 'http://test.invalid/api/v1',
          sourceSystem: sourceSystem,
          tokens: TokenStore(MemoryKeyValueStore()),
          refresher: (_) async => null,
          adapter: adapter,
          delay: (_) async {},
        ),
      );
    }

    test('작성은 POST /reviews 에 멱등 키·출처를 붙이고 사진 ID 는 보내지 않는다', () async {
      final key = IdempotencyKey.generate();
      final r = await repo(
        (_) => const FakeReply(
          201,
          body: {
            'reviewId': 'rv-1',
            'productId': 'P-0001',
            'rating': 4,
            'state': 'SUBMIT_PENDING',
            'createdAt': '2026-11-04T03:00:00Z',
          },
        ),
      ).create(orderLineId: 'ol-1', rating: 4, text: '좋아요', key: key);
      final req = adapter.requests.single;
      expect(req.method, 'POST');
      expect(req.uri.path, '/api/v1/reviews');
      expect(req.headers['Idempotency-Key'], key.value);
      expect(req.headers['X-Source-System'], sourceSystem);
      expect(jsonDecode(req.data as String), {
        'orderLineId': 'ol-1',
        'rating': 4,
        'text': '좋아요',
      });
      expect(r.state, ReviewState.submitPending);
    });

    test('자격·상품 리뷰 조회는 계약 경로와 커서를 쓴다', () async {
      final api = repo(
        (i) => FakeReply(
          200,
          body: i == 0
              ? {
                  'items': [
                    {
                      'orderId': 'o-1',
                      'orderLineId': 'ol-1',
                      'state': 'REV_ELIGIBLE',
                      'eligibleUntil': '2026-11-07T02:30:00Z',
                    },
                    {'orderLineId': 'ol-x'}, // 주문 식별이 없으면 뺀다
                  ],
                  'page': {'nextCursor': null},
                }
              : {
                  'items': <Object?>[],
                  'page': {'nextCursor': null},
                },
        ),
      );
      final page = await api.eligibilities(state: ReviewState.eligible);
      expect(page.items.map((e) => e.orderLineId), ['ol-1']);
      expect(page.items.single.writable, isTrue);
      expect(adapter.requests[0].uri.path, '/api/v1/me/review-eligibilities');
      expect(adapter.requests[0].uri.queryParameters['state'], 'REV_ELIGIBLE');

      final reviews = await api.productReviews('P-0002', cursor: 'c2');
      expect(reviews.items, isEmpty);
      expect(reviews.averageRating, isNull, reason: '요약 없음을 0점으로 바꾸지 않는다');
      expect(adapter.requests[1].uri.path, '/api/v1/products/P-0002/reviews');
      expect(adapter.requests[1].uri.queryParameters['cursor'], 'c2');
    });

    test(
      '사진 올리기는 POST /review-photos multipart(file)·멱등 키, 작성에 photoIds',
      () async {
        final key = IdempotencyKey.generate();
        final api = repo(
          (i) => i == 0
              ? const FakeReply(
                  201,
                  body: {
                    'photoId': 'rph-1',
                    'url': '/api/v1/review-photos/rph-1',
                    'contentType': 'image/jpeg',
                    'sizeBytes': 3,
                    'uploadedAt': '2026-11-16T03:00:00Z',
                  },
                )
              : const FakeReply(
                  201,
                  body: {
                    'reviewId': 'rv-1',
                    'productId': 'P-0001',
                    'rating': 5,
                    'state': 'PUBLISHED',
                    'createdAt': '2026-11-16T03:00:00Z',
                    'photos': [
                      {
                        'photoId': 'rph-1',
                        'url': '/api/v1/review-photos/rph-1',
                      },
                    ],
                  },
                ),
        );
        final photo = await api.uploadPhoto(
          ReviewPhotoFile(name: 'a.jpg', bytes: Uint8List.fromList([1, 2, 3])),
          key: key,
        );
        expect(photo.photoId, 'rph-1');
        final up = adapter.requests[0];
        expect(up.method, 'POST');
        expect(up.uri.path, '/api/v1/review-photos');
        expect(up.headers['Idempotency-Key'], key.value);
        expect(up.headers['X-Source-System'], sourceSystem);
        expect(up.headers['content-type'], contains('multipart/form-data'));

        final r = await api.create(
          orderLineId: 'ol-1',
          rating: 5,
          photoIds: const ['rph-1'],
          key: IdempotencyKey.generate(),
        );
        expect(jsonDecode(adapter.requests[1].data as String), {
          'orderLineId': 'ol-1',
          'rating': 5,
          'photoIds': ['rph-1'],
        });
        expect(r.photoUrls, ['/api/v1/review-photos/rph-1']);
      },
    );

    test('자격의 productName 을 쓴다(빈 값은 없음으로)', () async {
      final api = repo(
        (_) => const FakeReply(
          200,
          body: {
            'items': [
              {
                'orderId': 'o-1',
                'orderLineId': 'ol-1',
                'productName': '서울우유 1L',
                'state': 'REV_ELIGIBLE',
              },
              {
                'orderId': 'o-1',
                'orderLineId': 'ol-2',
                'productName': ' ',
                'state': 'REV_ELIGIBLE',
              },
            ],
            'page': {'nextCursor': null},
          },
        ),
      );
      final items = (await api.eligibilities()).items;
      expect(items[0].productName, '서울우유 1L');
      expect(ReviewTarget.of(items[0]).title, '서울우유 1L');
      expect(items[1].productName, isNull);
    });

    test(
      '수정은 PATCH /reviews/{id} — 멱등 키·출처·X-Expected-Version, 바꾼 것만 보낸다',
      () async {
        final key = IdempotencyKey.generate();
        final r = await repo(
          (_) => const FakeReply(
            200,
            body: {
              'reviewId': 'rv-1',
              'productId': 'P-0001',
              'rating': 2,
              'state': 'PUBLISHED',
              'version': 4,
              'createdAt': '2026-11-14T03:00:00Z',
              'editableUntil': '2026-11-17T03:00:00Z',
              'photos': [
                {'photoId': 'rph-9', 'url': '/api/v1/review-photos/rph-9'},
              ],
            },
          ),
        ).update('rv-1', expectedVersion: 3, rating: 2, key: key);
        final req = adapter.requests.single;
        expect(req.method, 'PATCH');
        expect(req.uri.path, '/api/v1/reviews/rv-1');
        expect(req.headers['Idempotency-Key'], key.value);
        expect(req.headers['X-Source-System'], sourceSystem);
        expect(req.headers['X-Expected-Version'], '3');
        expect(jsonDecode(req.data as String), {
          'rating': 2,
        }, reason: '사진을 그대로 두려면 photoIds 를 빼고 보낸다');
        expect(r.version, 4);
        expect(r.photos.single.photoId, 'rph-9');
        expect(r.editable, isTrue);
      },
    );

    test('삭제는 DELETE /reviews/{id} — 멱등 키·출처, 204', () async {
      final key = IdempotencyKey.generate();
      await repo((_) => const FakeReply(204)).delete('rv-1', key: key);
      final req = adapter.requests.single;
      expect(req.method, 'DELETE');
      expect(req.uri.path, '/api/v1/reviews/rv-1');
      expect(req.headers['Idempotency-Key'], key.value);
      expect(req.headers['X-Source-System'], sourceSystem);
    });

    test('경로가 없으면(게이트웨이 404) 빈 목록이 아니라 실패로 던진다', () async {
      final api = repo((_) => const FakeReply(404, body: {'error': 'x'}));
      await expectLater(
        api.productReviews('P-0001'),
        throwsA(isA<PmartFailure>()),
      );
    });
  });

  group('작성 결과(ReviewSubmitter)', () {
    test('결과 불명 → 자격 조회로 reviewId 를 찾으면 등록으로 확정(POST 1번)', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..createFailures.add(unknown)
        ..createFailureApplies = true;
      final out = await ReviewSubmitter(repo, target).submit(rating: 5);
      expect(out, isA<CommandDone<ReviewView>>());
      expect(repo.createKeys, hasLength(1));
      expect(repo.eligibilityQueries.last.orderId, 'order-seed-1');
    });

    test('확인도 안 되면 확인 중 → 다시 확인은 같은 키·같은 본문으로만 보낸다', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..createFailures.add(unknown)
        ..eligibilityFailures.add(
          const NetworkFailure(DioExceptionType.connectionTimeout),
        );
      final s = ReviewSubmitter(repo, target);
      expect(
        await s.submit(rating: 3, text: '처음'),
        isA<CommandUnknown<ReviewView>>(),
      );
      expect(s.pending, isTrue);
      // 화면은 입력을 잠그지만, 다른 값이 와도 보관한 본문을 그대로 보낸다.
      final again = await s.submit(rating: 1, text: '다른 글');
      expect(again, isA<CommandDone<ReviewView>>());
      expect(repo.createKeys, hasLength(2));
      expect(repo.createKeys[0], repo.createKeys[1]);
      expect(repo.createBodies[1].rating, 3);
      expect(repo.createBodies[1].text, '처음');
      expect(s.pending, isFalse);
    });

    test('거절은 Problem code 로 끝내고, 다음 등록은 새 키', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..createFailures.add(
          const ProblemFailure(
            Problem(status: 422, code: ReviewProblemCode.eligibilityExpired),
          ),
        );
      final s = ReviewSubmitter(repo, target);
      final out = await s.submit(rating: 4);
      expect(
        (out as CommandRejected).code,
        ReviewProblemCode.eligibilityExpired,
      );
      await s.submit(rating: 4);
      expect(repo.createKeys[0], isNot(repo.createKeys[1]));
    });
  });

  group('수정·삭제(바뀐 것 고르기·같은 키)', () {
    final original = ReviewView(
      reviewId: 'rv-1',
      productId: 'P-0001',
      rating: 4,
      text: '좋아요',
      photos: const [
        ReviewPhotoRef(photoId: 'a'),
        ReviewPhotoRef(photoId: 'b'),
      ],
      state: ReviewState.published,
      version: 2,
      createdAt: DateTime.utc(2026, 11, 14),
    );

    test('바뀐 것만 고르고, 아무것도 안 바뀌면 null(보내지 않는다)', () {
      expect(
        reviewChanges(original, rating: 4, text: '좋아요', photoIds: ['a', 'b']),
        isNull,
      );
      final c = reviewChanges(
        original,
        rating: 5,
        text: '좋아요',
        photoIds: ['a', 'b'],
      )!;
      expect((c.rating, c.text, c.photoIds), (5, null, null));
      final p = reviewChanges(
        original,
        rating: 4,
        text: '좋아요',
        photoIds: ['b', 'a'],
      )!;
      expect(p.photoIds, ['b', 'a'], reason: '순서가 바뀌어도 목록을 보낸다');
      expect(p.rating, isNull);
      final cleared = reviewChanges(
        original,
        rating: 4,
        text: '좋아요',
        photoIds: const [],
      )!;
      expect(cleared.photoIds, isEmpty, reason: '사진을 다 빼면 빈 목록으로 바꾼다');
    });

    test('LOCKED·삭제는 고칠 수 없고, 수정 기한은 서버 값', () {
      final locked = ReviewView(
        reviewId: 'rv-1',
        productId: 'P-0001',
        rating: 4,
        state: ReviewState.locked,
        version: 2,
        createdAt: DateTime.utc(2026, 11, 1),
      );
      expect(locked.editable, isFalse);
      expect(locked.deletable, isTrue);
      expect(original.editable, isTrue);
    });

    test('결과 불명 → 다시 확인은 같은 키·처음 본문, 거절 뒤 다음은 새 키', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..updateFailures.add(unknown)
        ..updateFailureApplies = true;
      final cmd = KeptReviewCommand<ReviewView>();
      final first = await cmd.run(
        (key) =>
            repo.update('rv-mine-1', expectedVersion: 1, rating: 2, key: key),
      );
      expect(first, isA<CommandUnknown<ReviewView>>());
      expect(cmd.pending, isTrue);
      final again = await cmd.run(
        (key) =>
            repo.update('rv-mine-1', expectedVersion: 1, rating: 5, key: key),
      );
      expect(again, isA<CommandDone<ReviewView>>());
      expect((again as CommandDone<ReviewView>).value.rating, 2);
      expect(again.value.version, 2, reason: '같은 키 = 같은 결과(두 번 반영하지 않는다)');
      expect(repo.updateKeys.toSet(), hasLength(1));
      expect(repo.updateBodies[1].rating, 2);

      final stale = await cmd.run(
        (key) =>
            repo.update('rv-mine-1', expectedVersion: 1, rating: 3, key: key),
      );
      expect(
        (stale as CommandRejected).code,
        ReviewProblemCode.versionConflict,
      );
      expect(repo.updateKeys.last, isNot(repo.updateKeys.first));
    });

    test('목: LOCKED 는 INVALID_STATE, 삭제는 멱등이고 그 품목은 DELETED', () async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      repo.reviewJson.first['state'] = 'LOCKED';
      await expectLater(
        repo.update(
          'rv-mine-1',
          expectedVersion: 1,
          rating: 1,
          key: IdempotencyKey.generate(),
        ),
        throwsA(
          isA<ProblemFailure>().having(
            (f) => f.problem.code,
            'code',
            ReviewProblemCode.invalidState,
          ),
        ),
      );
      final key = IdempotencyKey.generate();
      await repo.delete('rv-mine-1', key: key);
      await repo.delete('rv-mine-1', key: key);
      final mine = (await repo.eligibilities()).items.firstWhere(
        (e) => e.reviewId == 'rv-mine-1',
      );
      expect(mine.state, ReviewState.deleted);
      expect(mine.written, isFalse);
      expect(mine.writable, isFalse, reason: '삭제 뒤 다시 쓰기 버튼 없음');
    });
  });

  group('사진 한 칸 올리기(uploadReviewPhoto)', () {
    final file = ReviewPhotoFile(
      name: 'a.jpg',
      bytes: Uint8List.fromList([1, 2, 3]),
    );

    test('올라가면 photoId, 결과 불명은 같은 키로 다시 → 같은 photoId', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..uploadFailures.add(unknown);
      final slot = ReviewPhotoSlot.picked(file);
      final first = await uploadReviewPhoto(repo, slot);
      expect(first.status, ReviewPhotoStatus.unknown);
      final again = await uploadReviewPhoto(
        repo,
        first.copyWith(status: ReviewPhotoStatus.uploading),
      );
      expect(again.status, ReviewPhotoStatus.uploaded);
      expect(again.photoId, isNotNull);
      expect(repo.uploadKeys, [slot.key.value, slot.key.value]);
      final third = await uploadReviewPhoto(repo, again);
      expect(third.photoId, again.photoId, reason: '같은 키 = 같은 사진');
    });

    test('서버 거절(PHOTO_INVALID)은 거절 — 다시 올리지 않고 빼야 한다', () async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..uploadFailures.add(
          const ProblemFailure(
            Problem(status: 422, code: ReviewProblemCode.photoInvalid),
          ),
        );
      final r = await uploadReviewPhoto(repo, ReviewPhotoSlot.picked(file));
      expect(r.status, ReviewPhotoStatus.rejected);
      expect(r.code, ReviewProblemCode.photoInvalid);
    });

    test('10MB 넘는 파일은 보내지 않고 거절로 둔다', () async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      final big = ReviewPhotoFile(
        name: 'big.jpg',
        bytes: Uint8List(reviewPhotoMaxBytes + 1),
      );
      final r = await uploadReviewPhoto(repo, ReviewPhotoSlot.picked(big));
      expect(r.status, ReviewPhotoStatus.rejected);
      expect(repo.uploadKeys, isEmpty);
    });
  });

  group('화면', () {
    Future<void> bigScreen(WidgetTester t) async {
      t.view
        ..physicalSize = const Size(800, 2400)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
    }

    Future<void> openManage(
      WidgetTester t,
      MockReviewsRepository repo, {
      bool login = true,
    }) async {
      await bigScreen(t);
      await t.pumpWidget(testApp(const [], reviews: repo));
      await t.pumpAndSettle();
      await t.tap(find.text('마이페이지').last);
      await t.pumpAndSettle();
      if (login) {
        await t.tap(find.byKey(const ValueKey('my-login')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('login-kakao')));
        await t.pumpAndSettle();
      }
      await t.tap(find.byKey(const ValueKey('my-reviews')));
      await t.pumpAndSettle();
    }

    testWidgets('비회원: 로그인 안내만, 리뷰 조회를 부르지 않는다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openManage(t, repo, login: false);
      expect(find.byKey(const ValueKey('go-login')), findsOneWidget);
      expect(find.byKey(const ValueKey('review-tab-write')), findsNothing);
      expect(repo.calls, 0);
    });

    testWidgets('리뷰 쓰기 목록: 서버 기한을 보이고, 조회 실패는 "쓸 리뷰 없음"이 아니다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..eligibilityFailures.add(
          const NetworkFailure(DioExceptionType.connectionError),
        );
      await openManage(t, repo);
      expect(find.byKey(const ValueKey('ui-error')), findsOneWidget);
      expect(find.byKey(const ValueKey('review-writable-empty')), findsNothing);
      expect(repo.eligibilityQueries.single.state, ReviewState.eligible);

      await t.tap(find.text('다시 시도').first);
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('review-writable-ol-1')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('review-writable-ol-3')), findsNothing);
      expect(find.text('서울우유 1L'), findsOneWidget); // 자격의 productName(0.2.0)
      final deadline = t.widget<Text>(
        find.byKey(const ValueKey('review-deadline-ol-1')),
      );
      expect(deadline.data, contains('11월 7일'));
      expect(deadline.data, contains('까지 쓸 수 있어요'));
    });

    testWidgets('별을 눌러 작성 → 등록 확정 뒤에만 완료, 목록이 서버 기준으로 바뀐다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openManage(t, repo);
      await t.tap(find.byKey(const ValueKey('review-quick-star-ol-1-4')));
      await t.pumpAndSettle();
      // 별 4개가 미리 골라져 있다. 사진 칸은 "사진 0/5".
      expect(find.byIcon(Icons.star), findsNWidgets(4));
      expect(find.text('사진 0/5'), findsOneWidget);
      await t.enterText(find.byKey(const ValueKey('review-text')), '신선해요');
      await t.tap(find.byKey(const ValueKey('review-submit')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-result-done')), findsOneWidget);
      final body = repo.createBodies.single;
      expect((body.orderLineId, body.rating, body.text), ('ol-1', 4, '신선해요'));
      expect(body.photoIds, isEmpty);

      await t.tap(find.byKey(const ValueKey('review-result-ok')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('review-writable-empty')),
        findsOneWidget,
      );
      await t.tap(find.byKey(const ValueKey('review-tab-mine')));
      await t.pumpAndSettle();
      expect(find.text('신선해요'), findsOneWidget);
      expect(find.text('꾸덕하고 맛있어요. 다음에도 살게요.'), findsOneWidget);
    });

    testWidgets(
      '사진: 못 올린 사진이 있으면 등록을 막고 다시 올리기·빼기를 묻는다 → 다 올라가면 photoIds 로 등록',
      (t) async {
        final repo = MockReviewsRepository(latency: Duration.zero)
          ..uploadFailures.addAll([
            unknown,
            const ProblemFailure(
              Problem(status: 422, code: ReviewProblemCode.photoInvalid),
            ),
          ]);
        final picks = <(ReviewPhotoSource, int)>[];
        await bigScreen(t);
        await t.pumpWidget(
          testApp([
            reviewPhotoPickerProvider.overrideWithValue((source, max) async {
              picks.add((source, max));
              return [
                for (var i = 0; i < 3; i++)
                  ReviewPhotoFile(
                    name: 'p$i.jpg',
                    bytes: Uint8List.fromList([i, 1, 2]),
                  ),
              ];
            }),
          ], reviews: repo),
        );
        await t.pumpAndSettle();
        await t.tap(find.text('마이페이지').last);
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('my-login')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('login-kakao')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('my-reviews')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('review-quick-star-ol-1-5')));
        await t.pumpAndSettle();

        await t.tap(find.byKey(const ValueKey('review-photo-add')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('review-photo-gallery')));
        await t.pumpAndSettle();
        expect(picks.single, (ReviewPhotoSource.gallery, 5));
        expect(find.text('사진 3/5'), findsOneWidget);
        // 0번 결과 불명(다시 올리기), 1번 거절(빼기만), 2번 올라감.
        expect(
          find.byKey(const ValueKey('review-photo-retry-0')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('review-photo-rejected-1')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('review-photo-needs-action')),
          findsOneWidget,
        );
        FilledButton submit() =>
            t.widget<FilledButton>(find.byKey(const ValueKey('review-submit')));
        expect(submit().onPressed, isNull, reason: '올라간 사진만 몰래 보내지 않는다');

        await t.tap(find.byKey(const ValueKey('review-photo-retry-0')));
        await t.pumpAndSettle();
        expect(repo.uploadKeys[0], repo.uploadKeys[3], reason: '다시 올리기는 같은 키');
        expect(submit().onPressed, isNull);

        await t.tap(find.byKey(const ValueKey('review-photo-remove-1')));
        await t.pumpAndSettle();
        expect(find.text('사진 2/5'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('review-photo-needs-action')),
          findsNothing,
        );
        expect(submit().onPressed, isNotNull);

        await t.tap(find.byKey(const ValueKey('review-submit')));
        await t.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('review-result-done')),
          findsOneWidget,
        );
        expect(repo.createBodies.single.photoIds, hasLength(2));
        expect(repo.createBodies.single.photoIds.toSet(), {
          for (final MapEntry(:key, :value) in repo.uploadedPhotos.entries)
            if (value != null) key,
        });

        // 내가 쓴 리뷰에 사진 칸이 보인다(목은 상대 경로라 자리표시).
        await t.tap(find.byKey(const ValueKey('review-result-ok')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('review-tab-mine')));
        await t.pumpAndSettle();
        expect(find.byKey(const ValueKey('review-photo-rv-new-3-0')), findsOne);
        expect(find.byKey(const ValueKey('review-photo-rv-new-3-1')), findsOne);
      },
    );

    testWidgets('결과 불명: 확인 중 + 입력 잠금, 다시 확인은 같은 키', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..createFailures.add(unknown)
        ..eligibilityFailures.add(
          const NetworkFailure(DioExceptionType.connectionError),
        );
      await openManage(t, repo);
      // 목록 조회가 위 실패를 먼저 쓴다 → 다시 시도 뒤 시험할 실패를 다시 넣는다.
      await t.tap(find.text('다시 시도').first);
      await t.pumpAndSettle();
      repo.eligibilityFailures.add(
        const NetworkFailure(DioExceptionType.connectionError),
      );
      await t.tap(find.byKey(const ValueKey('review-write-ol-1')));
      await t.pumpAndSettle();
      expect(
        t
            .widget<FilledButton>(find.byKey(const ValueKey('review-submit')))
            .onPressed,
        isNull,
        reason: '별점 전에는 등록할 수 없다',
      );
      await t.tap(find.byKey(const ValueKey('review-star-5')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('review-submit')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('review-result-unknown')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('review-result-done')), findsNothing);
      expect(
        t
            .widget<FilledButton>(find.byKey(const ValueKey('review-submit')))
            .onPressed,
        isNull,
      );
      expect(
        t.widget<TextField>(find.byKey(const ValueKey('review-text'))).enabled,
        isFalse,
      );

      await t.tap(find.byKey(const ValueKey('review-recheck')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-result-done')), findsOneWidget);
      expect(repo.createKeys, hasLength(2));
      expect(repo.createKeys.toSet(), hasLength(1));
    });

    testWidgets('거절은 코드별 안내, 완료로 보이지 않는다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..createFailures.add(
          const ProblemFailure(
            Problem(status: 422, code: ReviewProblemCode.alreadyReviewed),
          ),
        );
      await openManage(t, repo);
      await t.tap(find.byKey(const ValueKey('review-quick-star-ol-1-2')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-submit')));
      await t.pumpAndSettle();
      expect(find.text('이미 리뷰를 쓴 상품이에요'), findsOneWidget);
      expect(find.byKey(const ValueKey('review-result-done')), findsNothing);
    });

    testWidgets('내가 쓴 리뷰: 본문 조회 실패는 그 카드에 실패 + 다시 시도', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..getFailures.add(
          const NetworkFailure(DioExceptionType.connectionError),
        );
      await openManage(t, repo);
      await t.tap(find.byKey(const ValueKey('review-tab-mine')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('review-mine-failed-rv-mine-1')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('review-mine-empty')), findsNothing);
      await t.tap(
        find.descendant(
          of: find.byKey(const ValueKey('review-mine-failed-rv-mine-1')),
          matching: find.byType(TextButton),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('꾸덕하고 맛있어요. 다음에도 살게요.'), findsOneWidget);
      expect(find.text('게시됨'), findsOneWidget);
    });

    testWidgets('내가 쓴 리뷰 목록 조회 실패는 "쓴 리뷰 없음"이 아니다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openManage(t, repo);
      repo.eligibilityFailures.add(
        const NetworkFailure(DioExceptionType.connectionError),
      );
      await t.tap(find.byKey(const ValueKey('review-tab-mine')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('ui-error')), findsOneWidget);
      expect(find.byKey(const ValueKey('review-mine-empty')), findsNothing);
    });

    Future<void> openMine(WidgetTester t, MockReviewsRepository repo) async {
      await openManage(t, repo);
      await t.tap(find.byKey(const ValueKey('review-tab-mine')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-mine-open-rv-mine-1')));
      await t.pumpAndSettle();
    }

    testWidgets('내 리뷰 → 수정: 별점만 바꾸면 사진은 빼고 보내고, 고친 뒤 상세가 서버 값으로 바뀐다', (
      t,
    ) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      repo.reviewJson.first['photos'] = [
        {'photoId': 'rph-old', 'url': '/api/v1/review-photos/rph-old'},
      ];
      repo.uploadedPhotos['rph-old'] = 'rv-mine-1';
      await openMine(t, repo);
      expect(find.text('내 리뷰'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('review-editable-until')),
        findsOneWidget,
      );
      await t.tap(find.byKey(const ValueKey('review-edit')));
      await t.pumpAndSettle();
      FilledButton save() =>
          t.widget<FilledButton>(find.byKey(const ValueKey('review-save')));
      expect(save().onPressed, isNull, reason: '바꾼 것이 없으면 보내지 않는다(서버 400)');
      expect(
        find.byKey(const ValueKey('review-edit-no-changes')),
        findsOneWidget,
      );
      expect(find.text('사진 1/5'), findsOneWidget, reason: '붙은 사진이 칸에 있다');

      await t.tap(find.byKey(const ValueKey('review-star-2')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('review-save')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-edit-done')), findsOneWidget);
      final b = repo.updateBodies.single;
      expect(
        (b.reviewId, b.expectedVersion, b.rating, b.text, b.photoIds),
        ('rv-mine-1', 1, 2, null, null),
      );

      await t.tap(find.byKey(const ValueKey('review-edit-ok')));
      await t.pumpAndSettle();
      expect(find.byIcon(Icons.star), findsNWidgets(2));
    });

    testWidgets('수정: 사진을 빼고 새 사진을 올리면 그 목록으로 보낸다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      repo.reviewJson.first['photos'] = [
        {'photoId': 'rph-old', 'url': '/api/v1/review-photos/rph-old'},
      ];
      repo.uploadedPhotos['rph-old'] = 'rv-mine-1';
      await bigScreen(t);
      await t.pumpWidget(
        testApp([
          reviewPhotoPickerProvider.overrideWithValue(
            (_, _) async => [
              ReviewPhotoFile(name: 'n.jpg', bytes: Uint8List.fromList([9])),
            ],
          ),
        ], reviews: repo),
      );
      await t.pumpAndSettle();
      await t.tap(find.text('마이페이지').last);
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('my-login')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('login-kakao')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('my-reviews')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-tab-mine')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-mine-open-rv-mine-1')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-edit')));
      await t.pumpAndSettle();

      await t.tap(find.byKey(const ValueKey('review-photo-remove-0')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-photo-add')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-photo-gallery')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-save')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-edit-done')), findsOneWidget);
      final b = repo.updateBodies.single;
      expect(b.photoIds, hasLength(1));
      expect(b.photoIds!.single, isNot('rph-old'));
      expect(b.rating, isNull);
      expect(repo.uploadedPhotos.containsKey('rph-old'), isFalse);
    });

    testWidgets('LOCKED: 수정 버튼을 막고 "3일이 지나" 안내, 삭제는 된다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      repo.reviewJson.first['state'] = 'LOCKED';
      repo.eligibilityJson[1]['state'] = 'LOCKED';
      await openMine(t, repo);
      expect(
        find.byKey(const ValueKey('review-locked-notice')),
        findsOneWidget,
      );
      expect(find.text('등록 후 3일이 지나 고칠 수 없어요'), findsOneWidget);
      expect(
        t
            .widget<FilledButton>(find.byKey(const ValueKey('review-edit')))
            .onPressed,
        isNull,
      );
      expect(
        t
            .widget<OutlinedButton>(find.byKey(const ValueKey('review-delete')))
            .onPressed,
        isNotNull,
      );
    });

    testWidgets('삭제: 확인 창 → 취소면 안 보낸다, 삭제면 보내고 목록에서 빠진다(다시 쓰기 없음)', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openMine(t, repo);
      await t.tap(find.byKey(const ValueKey('review-delete')));
      await t.pumpAndSettle();
      expect(find.text('삭제하면 이 상품의 리뷰를 다시 쓸 수 없어요.'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('review-delete-cancel')));
      await t.pumpAndSettle();
      expect(repo.deleteKeys, isEmpty);

      await t.tap(find.byKey(const ValueKey('review-delete')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-delete-ok')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-delete-done')), findsOneWidget);
      expect(repo.deleteKeys, hasLength(1));
      await t.tap(find.byKey(const ValueKey('review-delete-done-ok')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-mine-empty')), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('review-tab-write')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-writable-ol-3')), findsNothing);
    });

    testWidgets('삭제 결과 불명: 확인 중 + 삭제 버튼 잠금, 다시 확인은 같은 키', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..deleteFailures.add(unknown);
      await openMine(t, repo);
      await t.tap(find.byKey(const ValueKey('review-delete')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('review-delete-ok')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('review-delete-unknown')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('review-delete-done')), findsNothing);
      expect(
        t
            .widget<OutlinedButton>(find.byKey(const ValueKey('review-delete')))
            .onPressed,
        isNull,
      );
      await t.tap(find.byKey(const ValueKey('review-delete-recheck')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-delete-done')), findsOneWidget);
      expect(repo.deleteKeys, hasLength(2));
      expect(repo.deleteKeys.toSet(), hasLength(1));
    });

    testWidgets('수정 VERSION_CONFLICT: 안내 + 다시 불러오기, 저장은 막는다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openMine(t, repo);
      await t.tap(find.byKey(const ValueKey('review-edit')));
      await t.pumpAndSettle();
      // 다른 곳에서 먼저 고쳤다.
      repo.reviewJson.first['version'] = 2;
      await t.tap(find.byKey(const ValueKey('review-star-1')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('review-save')));
      await t.pumpAndSettle();
      expect(find.text('다른 곳에서 먼저 고친 리뷰예요. 다시 불러와 고쳐 주세요'), findsOneWidget);
      expect(find.byKey(const ValueKey('review-edit-done')), findsNothing);
      expect(
        t
            .widget<FilledButton>(find.byKey(const ValueKey('review-save')))
            .onPressed,
        isNull,
      );
      await t.tap(find.byKey(const ValueKey('review-edit-reload')));
      await t.pumpAndSettle();
      expect(find.text('내 리뷰'), findsOneWidget);
    });

    Future<void> openProduct(
      WidgetTester t,
      MockReviewsRepository repo,
      String id,
    ) async {
      await bigScreen(t);
      await t.pumpWidget(testApp(const [], reviews: repo));
      await t.pumpAndSettle();
      unawaited(
        GoRouter.of(t.element(find.byType(NavigationBar)))
            .push('/products/$id'),
      );
      await t.pumpAndSettle();
    }

    testWidgets('상품 상세: 별점 아래 리뷰 미리보기 → 전체 보기에서 커서로 더 보기', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openProduct(t, repo, 'P-0002');
      expect(find.byKey(const ValueKey('product-reviews')), findsOneWidget);
      expect(find.text('리뷰 7개'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('product-review-rv-mine-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('product-review-rv-p2-3')),
        findsNothing,
      );
      await t.tap(find.byKey(const ValueKey('product-reviews-all')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('product-review-rv-p2-4')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('product-review-rv-p2-5')),
        findsNothing,
      );
      await t.tap(find.byKey(const ValueKey('review-load-more')));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('product-review-rv-p2-6')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('review-load-more')), findsNothing);
      expect(repo.productCursors, [null, '5']);
    });

    testWidgets('상품 상세: 리뷰 조회 실패는 "리뷰를 불러오지 못했어요"(리뷰 없음 아님)', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero)
        ..productFailures.add(
          const NetworkFailure(DioExceptionType.connectionError),
        );
      await openProduct(t, repo, 'P-0002');
      expect(
        find.byKey(const ValueKey('product-reviews-failed')),
        findsOneWidget,
      );
      expect(find.text('리뷰를 불러오지 못했어요'), findsOneWidget);
      expect(find.byKey(const ValueKey('product-reviews-empty')), findsNothing);
      await t.tap(
        find.descendant(
          of: find.byKey(const ValueKey('product-reviews-failed')),
          matching: find.byType(TextButton),
        ),
      );
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('product-review-rv-mine-1')),
        findsOneWidget,
      );
    });

    testWidgets('상품 상세: 정상 0건만 "아직 리뷰가 없어요"', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openProduct(t, repo, 'P-0001');
      expect(
        find.byKey(const ValueKey('product-reviews-empty')),
        findsOneWidget,
      );
    });

    testWidgets('주문 상세: 서버가 작성 가능이라 준 품목만 리뷰 쓰기(주문 당시 이름)', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openManage(t, repo);
      final router = GoRouter.of(t.element(find.byType(TabBar)));
      unawaited(router.push('/orders/order-seed-1'));
      await t.pumpAndSettle();
      await t.scrollUntilVisible(
        find.byKey(const ValueKey('order-review-write-ol-1')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.byKey(const ValueKey('order-review-ol-2')), findsNothing);
      await t.tap(find.byKey(const ValueKey('order-review-write-ol-1')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-text')), findsOneWidget);
      expect(find.text('서울우유 1L'), findsOneWidget);
      expect(repo.eligibilityQueries.last.orderId, 'order-seed-1');
    });

    testWidgets('주문 상세: 자격 조회 실패는 실패 줄로 보인다', (t) async {
      final repo = MockReviewsRepository(latency: Duration.zero);
      await openManage(t, repo);
      repo.eligibilityFailures.add(
        const NetworkFailure(DioExceptionType.connectionError),
      );
      final router = GoRouter.of(t.element(find.byType(TabBar)));
      unawaited(router.push('/orders/order-seed-2'));
      await t.pumpAndSettle();
      await t.scrollUntilVisible(
        find.byKey(const ValueKey('order-reviews-failed')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.byKey(const ValueKey('order-reviews')), findsNothing);
    });
  });
}
