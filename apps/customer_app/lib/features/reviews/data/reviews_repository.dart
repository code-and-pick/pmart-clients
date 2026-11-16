import 'package:dio/dio.dart';
import 'package:pmart_api_review/pmart_api_review.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/reviews.dart';

/// 리뷰 자격·작성·조회(`review-service` 계약). 실패는 [PmartFailure] 로 던진다(빈 목록으로 바꾸지 않는다).
///
/// review-service 0.2.0(2026-11-16 LAN 배포). 자격은 배송 완료(라이더 전달 완료 사진) 뒤에 생긴다.
abstract interface class ReviewsRepository {
  /// `GET /me/review-eligibilities`. [orderId]·[state] 로 좁힌다.
  Future<EligibilityPage> eligibilities({
    String? orderId,
    ReviewState? state,
    String? cursor,
  });

  /// `POST /reviews`. 같은 키·같은 본문 재전송은 같은 리뷰를 돌려줘야 한다(멱등).
  /// [photoIds] 는 [uploadPhoto] 가 돌려준 사진(리뷰당 5장).
  Future<ReviewView> create({
    required String orderLineId,
    required int rating,
    String? text,
    List<String> photoIds = const [],
    required IdempotencyKey key,
  });

  /// `POST /review-photos`(multipart `file`). 한 장씩. 같은 키 재전송은 같은 photoId.
  Future<UploadedReviewPhoto> uploadPhoto(
    ReviewPhotoFile photo, {
    required IdempotencyKey key,
  });

  /// `GET /reviews/{reviewId}`.
  Future<ReviewView> get(String reviewId);

  /// `PATCH /reviews/{reviewId}`(`X-Expected-Version`). 바꿀 것만 보낸다 — null 은 빼고 보낸다.
  /// [photoIds] 를 보내면 그 목록으로 바뀐다(사진을 그대로 두려면 null).
  Future<ReviewView> update(
    String reviewId, {
    required int expectedVersion,
    int? rating,
    String? text,
    List<String>? photoIds,
    required IdempotencyKey key,
  });

  /// `DELETE /reviews/{reviewId}`. 204(이미 삭제여도 204 — 멱등). 삭제 뒤 같은 품목은 다시 쓸 수 없다.
  Future<void> delete(String reviewId, {required IdempotencyKey key});

  /// `GET /products/{productId}/reviews`(최신 순).
  Future<ProductReviewPage> productReviews(String productId, {String? cursor});
}

final class ApiReviewsRepository implements ReviewsRepository {
  ApiReviewsRepository(Dio dio)
    : _eligibilities = api.PmartApiReview(dio: dio).getEligibilitiesApi(),
      _reviews = api.PmartApiReview(dio: dio).getReviewsApi(),
      _photos = api.PmartApiReview(dio: dio).getPhotosApi();

  final api.EligibilitiesApi _eligibilities;
  final api.ReviewsApi _reviews;
  final api.PhotosApi _photos;

  @override
  Future<EligibilityPage> eligibilities({
    String? orderId,
    ReviewState? state,
    String? cursor,
  }) async {
    final res = await pmartGuard(
      () => _eligibilities.listMyReviewEligibilities(
        orderId: orderId,
        state: switch (state) {
          null => null,
          ReviewState.eligible => api.ReviewState.REV_ELIGIBLE,
          ReviewState.submitPending => api.ReviewState.SUBMIT_PENDING,
          ReviewState.published => api.ReviewState.PUBLISHED,
          ReviewState.locked => api.ReviewState.LOCKED,
          ReviewState.deleted => api.ReviewState.DELETED,
          ReviewState.expired => api.ReviewState.EXPIRED,
          ReviewState.unknown => null,
        },
        cursor: cursor,
      ),
    );
    final body =
        res.data ??
        (throw const ContractViolationFailure('Eligibility 목록 본문 없음'));
    return eligibilityPageFromContract(body);
  }

  @override
  Future<ReviewView> create({
    required String orderLineId,
    required int rating,
    String? text,
    List<String> photoIds = const [],
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _reviews.createReview(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        createReviewRequest: api.CreateReviewRequest(
          orderLineId: orderLineId,
          rating: rating,
          text: text,
          photoIds: photoIds.isEmpty ? null : photoIds,
        ),
        extra: commandOptions(key).extra,
      ),
    );
    return reviewFromContract(
      res.data ?? (throw UnknownResultFailure(requestId: key.value)),
    );
  }

  @override
  Future<UploadedReviewPhoto> uploadPhoto(
    ReviewPhotoFile photo, {
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _photos.uploadReviewPhoto(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        file: MultipartFile.fromBytes(photo.bytes, filename: photo.name),
        extra: commandOptions(key).extra,
      ),
    );
    final body = res.data ?? (throw UnknownResultFailure(requestId: key.value));
    return UploadedReviewPhoto(photoId: body.photoId, url: body.url);
  }

  @override
  Future<ReviewView> get(String reviewId) async {
    final res = await pmartGuard(() => _reviews.getReview(reviewId: reviewId));
    return reviewFromContract(
      res.data ?? (throw const ContractViolationFailure('Review 본문 없음')),
    );
  }

  @override
  Future<ReviewView> update(
    String reviewId, {
    required int expectedVersion,
    int? rating,
    String? text,
    List<String>? photoIds,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _reviews.updateReview(
        reviewId: reviewId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        updateReviewRequest: api.UpdateReviewRequest(
          rating: rating,
          text: text,
          photoIds: photoIds,
        ),
        extra: commandOptions(key, expectedVersion: expectedVersion).extra,
      ),
    );
    return reviewFromContract(
      res.data ?? (throw UnknownResultFailure(requestId: key.value)),
    );
  }

  @override
  Future<void> delete(String reviewId, {required IdempotencyKey key}) async {
    await pmartGuard(
      () => _reviews.deleteReview(
        reviewId: reviewId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
  }

  @override
  Future<ProductReviewPage> productReviews(
    String productId, {
    String? cursor,
  }) async {
    final res = await pmartGuard(
      () => _reviews.listProductReviews(productId: productId, cursor: cursor),
    );
    final body =
        res.data ?? (throw const ContractViolationFailure('리뷰 목록 본문 없음'));
    return productReviewPageFromContract(body);
  }
}

EligibilityPage eligibilityPageFromContract(
  api.ListMyReviewEligibilities200Response body,
) => EligibilityPage(
  items: [
    for (final e in body.items ?? const <api.Eligibility>[])
      // 주문·품목 식별이 없으면 작성 대상으로 쓸 수 없다. 추측해 채우지 않고 뺀다.
      if ((e.orderId, e.orderLineId) case (final String o, final String l))
        ReviewEligibility(
          orderId: o,
          orderLineId: l,
          sku: e.sku,
          productId: e.productId,
          productName: switch (e.productName) {
            final n? when n.trim().isNotEmpty => n,
            _ => null,
          },
          deliveredAt: e.deliveredAt,
          eligibleUntil: e.eligibleUntil,
          state: reviewStateFromWire(e.state?.value),
          reviewId: e.reviewId,
        ),
  ],
  nextCursor: body.page?.nextCursor,
);

ProductReviewPage productReviewPageFromContract(
  api.ListProductReviews200Response body,
) => ProductReviewPage(
  items: [
    for (final r in body.items ?? const <api.Review>[]) reviewFromContract(r),
  ],
  nextCursor: body.page?.nextCursor,
  averageRating: body.summary?.averageRating?.toDouble(),
  reviewCount: body.summary?.reviewCount,
);

ReviewView reviewFromContract(api.Review r) => ReviewView(
  reviewId: r.reviewId,
  productId: r.productId,
  sku: r.sku,
  authorMasked: r.authorMasked,
  rating: r.rating,
  text: r.text,
  photos: [
    for (final p in r.photos ?? const <api.ReviewPhotosInner>[])
      // photoId 가 없으면 수정 때 쓸 수 없다. 추측해 채우지 않고 뺀다.
      if (p.photoId case final id?) ReviewPhotoRef(photoId: id, url: p.url),
  ],
  state: reviewStateFromWire(r.state.value),
  version: r.version,
  createdAt: r.createdAt,
  editableUntil: r.editableUntil,
  updatedAt: r.updatedAt,
);
