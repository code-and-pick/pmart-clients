import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../claims/presentation/claims_controller.dart'
    show CommandDone, CommandOutcome, CommandRejected, CommandUnknown;
import '../data/mock_reviews_repository.dart';
import '../data/reviews_repository.dart';
import '../domain/reviews.dart';

final reviewsRepositoryProvider = Provider<ReviewsRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockReviewsRepository(),
    // review-service 0.2.0 — 2026-11-16 LAN 배포.
    PmartEnv.local => ApiReviewsRepository(ref.watch(dioProvider)),
  },
);

/// 사진 고르는 곳. [ReviewPhotoSource.camera] 는 한 장, 사진첩은 [max] 장까지. 고르지 않으면 빈 목록.
typedef ReviewPhotoPicker = Future<List<ReviewPhotoFile>> Function(
  ReviewPhotoSource source,
  int max,
);

enum ReviewPhotoSource { gallery, camera }

/// 기기 사진첩·카메라(image_picker). 시험은 이 provider 를 바꿔 끼운다.
final reviewPhotoPickerProvider = Provider<ReviewPhotoPicker>(
  (_) => (source, max) async {
    final picker = ImagePicker();
    // 긴 변 2,048px·품질 85 로 줄여 계약 한도(장당 10MB) 안에 들게 한다. 한도 판정은 서버가 다시 한다.
    final files = switch (source) {
      ReviewPhotoSource.camera => [
        ?await picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 2048,
          maxHeight: 2048,
          imageQuality: 85,
        ),
      ],
      ReviewPhotoSource.gallery =>
        max <= 1
            ? [
                ?await picker.pickImage(
                  source: ImageSource.gallery,
                  maxWidth: 2048,
                  maxHeight: 2048,
                  imageQuality: 85,
                ),
              ]
            : await picker.pickMultiImage(
                limit: max,
                maxWidth: 2048,
                maxHeight: 2048,
                imageQuality: 85,
              ),
    };
    return [
      for (final f in files.take(max))
        ReviewPhotoFile(name: f.name, bytes: await f.readAsBytes()),
    ];
  },
);

/// 작성 화면의 사진 한 칸. 고르면 바로 올린다(칸마다 자기 멱등 키).
enum ReviewPhotoStatus {
  /// 올리는 중.
  uploading,

  /// 서버가 photoId 를 줬다.
  uploaded,

  /// 결과를 모른다(시간 초과·연결 끊김 등) — "다시 올리기"는 같은 키로(같은 photoId).
  unknown,

  /// 서버가 거절했다(형식·크기 등) — 빼야 한다.
  rejected,
}

@immutable
class ReviewPhotoSlot {
  const ReviewPhotoSlot({
    required this.file,
    required this.key,
    required this.status,
    this.photoId,
    this.code,
    this.url,
  });

  ReviewPhotoSlot.picked(ReviewPhotoFile file)
    : this(
        file: file,
        key: IdempotencyKey.generate(),
        status: ReviewPhotoStatus.uploading,
      );

  /// 수정 화면: 리뷰에 이미 붙은 사진(서버 주소로 그린다, 다시 올리지 않는다).
  ReviewPhotoSlot.existing(ReviewPhotoRef photo)
    : this(
        file: null,
        key: IdempotencyKey.generate(),
        status: ReviewPhotoStatus.uploaded,
        photoId: photo.photoId,
        url: photo.url,
      );

  /// 기기에서 고른 원본. 이미 붙은 사진이면 null([url] 로 그린다).
  final ReviewPhotoFile? file;
  final IdempotencyKey key;

  /// 이미 붙은 사진의 서버 경로.
  final String? url;
  final ReviewPhotoStatus status;
  final String? photoId;

  /// 거절 코드(Problem code).
  final String? code;

  ReviewPhotoSlot copyWith({
    required ReviewPhotoStatus status,
    String? photoId,
    String? code,
  }) => ReviewPhotoSlot(
    file: file,
    key: key,
    status: status,
    photoId: photoId,
    code: code,
    url: url,
  );
}

/// 사진 한 칸을 올린다. 결과는 칸 상태로만 돌려준다(던지지 않는다).
/// 장당 한도를 넘는 파일은 보내지 않고 거절로 둔다(서버도 같은 한도로 다시 검사한다).
Future<ReviewPhotoSlot> uploadReviewPhoto(
  ReviewsRepository repo,
  ReviewPhotoSlot slot,
) async {
  final file = slot.file;
  if (file == null) return slot; // 이미 붙은 사진 — 올릴 것이 없다.
  if (file.bytes.length > reviewPhotoMaxBytes) {
    return slot.copyWith(
      status: ReviewPhotoStatus.rejected,
      code: ReviewProblemCode.photoInvalid,
    );
  }
  try {
    final p = await repo.uploadPhoto(file, key: slot.key);
    return slot.copyWith(
      status: ReviewPhotoStatus.uploaded,
      photoId: p.photoId,
    );
  } on ProblemFailure catch (f) {
    // 5xx Problem 은 결과 불명(같은 키로 다시), 4xx 는 거절.
    if (f.problem.status >= 500 || f.problem.retryable) {
      return slot.copyWith(status: ReviewPhotoStatus.unknown);
    }
    return slot.copyWith(
      status: ReviewPhotoStatus.rejected,
      code: f.problem.code,
    );
  } on PmartFailure {
    return slot.copyWith(status: ReviewPhotoStatus.unknown);
  }
}

/// 누적 페이지. 다음 묶음 실패는 받은 목록을 지우지 않고 [loadMoreFailure] 로만 보인다.
@immutable
class PagedList<T> {
  const PagedList({
    required this.items,
    this.nextCursor,
    this.loadingMore = false,
    this.loadMoreFailure,
    this.averageRating,
    this.reviewCount,
  });

  final List<T> items;
  final String? nextCursor;
  final bool loadingMore;
  final PmartFailure? loadMoreFailure;

  /// 상품 리뷰 목록의 서버 요약(`summary`). 그 밖에는 null.
  final double? averageRating;
  final int? reviewCount;

  bool get hasMore => nextCursor != null;

  PagedList<T> copyWith({
    List<T>? items,
    String? nextCursor,
    bool loadingMore = false,
    PmartFailure? loadMoreFailure,
  }) => PagedList(
    items: items ?? this.items,
    nextCursor: nextCursor,
    loadingMore: loadingMore,
    loadMoreFailure: loadMoreFailure,
    averageRating: averageRating,
    reviewCount: reviewCount,
  );
}

/// 리뷰 자격 목록 하나(작성 가능 / 내가 쓴 리뷰). 비회원이면 null — 호출하지 않는다(빈 목록과 구분).
abstract class _EligibilityList
    extends AsyncNotifier<PagedList<ReviewEligibility>?> {
  ReviewState? get serverState;
  bool keep(ReviewEligibility e);

  @override
  Future<PagedList<ReviewEligibility>?> build() async {
    if (ref.watch(sessionProvider) is! MemberSession) return null;
    final page = await ref
        .watch(reviewsRepositoryProvider)
        .eligibilities(state: serverState);
    return PagedList(
      items: page.items.where(keep).toList(),
      nextCursor: page.nextCursor,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) return;
    state = AsyncData(
      current.copyWith(nextCursor: current.nextCursor, loadingMore: true),
    );
    try {
      final page = await ref
          .read(reviewsRepositoryProvider)
          .eligibilities(state: serverState, cursor: current.nextCursor);
      if (!ref.mounted) return;
      final seen = {for (final e in current.items) e.orderLineId};
      state = AsyncData(
        current.copyWith(
          items: [
            ...current.items,
            ...page.items.where(
              (e) => keep(e) && !seen.contains(e.orderLineId),
            ),
          ],
          nextCursor: page.nextCursor,
        ),
      );
    } on PmartFailure catch (e) {
      if (!ref.mounted) return;
      state = AsyncData(
        current.copyWith(nextCursor: current.nextCursor, loadMoreFailure: e),
      );
    }
  }
}

/// "리뷰 쓰기": 서버가 작성 가능(`REV_ELIGIBLE`)이라고 준 품목. 기한은 서버 `eligibleUntil` 을 보이기만 한다.
final writableReviewsProvider =
    AsyncNotifierProvider.autoDispose<
      WritableReviews,
      PagedList<ReviewEligibility>?
    >(WritableReviews.new);

class WritableReviews extends _EligibilityList {
  @override
  ReviewState? get serverState => ReviewState.eligible;

  @override
  bool keep(ReviewEligibility e) => e.writable;
}

/// "내가 쓴 리뷰": 내 리뷰 목록 경로가 계약에 없어 자격 목록의 `reviewId` 로 조합한다(본문은 [reviewProvider]).
final myReviewsProvider =
    AsyncNotifierProvider.autoDispose<MyReviews, PagedList<ReviewEligibility>?>(
      MyReviews.new,
    );

class MyReviews extends _EligibilityList {
  @override
  ReviewState? get serverState => null;

  @override
  bool keep(ReviewEligibility e) => e.written;
}

final reviewProvider = FutureProvider.autoDispose.family<ReviewView, String>(
  (ref, reviewId) => ref.watch(reviewsRepositoryProvider).get(reviewId),
);

/// 주문 하나의 리뷰 자격(주문 상세). 비회원이면 null.
final orderReviewEligibilitiesProvider = FutureProvider.autoDispose
    .family<List<ReviewEligibility>?, String>((ref, orderId) async {
      if (ref.watch(sessionProvider) is! MemberSession) return null;
      final repo = ref.watch(reviewsRepositoryProvider);
      final out = <ReviewEligibility>[];
      String? cursor;
      // 주문 하나의 품목 수만큼이라 몇 묶음 안에 끝난다. 끝없이 돌지 않게 상한을 둔다.
      for (var i = 0; i < 10; i++) {
        final page = await repo.eligibilities(orderId: orderId, cursor: cursor);
        out.addAll(page.items.where((e) => e.orderId == orderId));
        cursor = page.nextCursor;
        if (cursor == null) break;
      }
      return out;
    });

/// 상품 리뷰 목록(공개). 비회원도 본다.
final productReviewsProvider = AsyncNotifierProvider.autoDispose
    .family<ProductReviews, PagedList<ReviewView>, String>(ProductReviews.new);

class ProductReviews extends AsyncNotifier<PagedList<ReviewView>> {
  ProductReviews(this.productId);

  final String productId;

  @override
  Future<PagedList<ReviewView>> build() async {
    final page = await ref
        .watch(reviewsRepositoryProvider)
        .productReviews(productId);
    return PagedList(
      items: page.items,
      nextCursor: page.nextCursor,
      averageRating: page.averageRating,
      reviewCount: page.reviewCount,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) return;
    state = AsyncData(
      current.copyWith(nextCursor: current.nextCursor, loadingMore: true),
    );
    try {
      final page = await ref
          .read(reviewsRepositoryProvider)
          .productReviews(productId, cursor: current.nextCursor);
      if (!ref.mounted) return;
      final seen = {for (final r in current.items) r.reviewId};
      state = AsyncData(
        current.copyWith(
          items: [
            ...current.items,
            ...page.items.where((r) => !seen.contains(r.reviewId)),
          ],
          nextCursor: page.nextCursor,
        ),
      );
    } on PmartFailure catch (e) {
      if (!ref.mounted) return;
      state = AsyncData(
        current.copyWith(nextCursor: current.nextCursor, loadMoreFailure: e),
      );
    }
  }
}

/// 리뷰 작성. 한 번 누르면 한 번만 보낸다.
/// - 결과를 모르면(5xx·타임아웃) 다시 보내지 않고 이 주문의 자격을 조회해 `reviewId` 가 생겼는지 확인한다.
/// - 그래도 모르면 키와 본문을 보관한다. "다시 확인"을 누를 때만 **같은 키·같은 본문**으로 다시 보낸다(새 리뷰가 아니다).
/// - Problem 응답은 거절로 끝내고 키를 버린다(다음 등록은 새 사용자 행위 = 새 키).
class ReviewSubmitter {
  ReviewSubmitter(this._repo, this.target);

  final ReviewsRepository _repo;
  final ReviewTarget target;

  IdempotencyKey? _key;
  ({int rating, String? text, List<String> photoIds})? _body;

  /// 결과를 모르는 채 보관 중인 요청이 있다(입력을 바꾸면 안 된다).
  bool get pending => _key != null;

  Future<CommandOutcome<ReviewView>> submit({
    required int rating,
    String? text,
    List<String> photoIds = const [],
  }) async {
    final body = _body ??= (rating: rating, text: text, photoIds: photoIds);
    final key = _key ??= IdempotencyKey.generate();
    try {
      final review = await _repo.create(
        orderLineId: target.orderLineId,
        rating: body.rating,
        text: body.text,
        photoIds: body.photoIds,
        key: key,
      );
      _clear();
      return CommandDone(review);
    } on UnknownResultFailure {
      // 반영 여부를 모른다. 아래에서 조회로 확인한다.
    } on ProblemFailure catch (f) {
      _clear();
      return CommandRejected(f.problem.code);
    } on PmartFailure {
      // Problem 이 아닌 4xx(경로 없음 등)·세션 만료: 반영되지 않았다.
      _clear();
      return const CommandRejected(ProblemCode.unknown);
    }
    try {
      final page = await _repo.eligibilities(orderId: target.orderId);
      final e = page.items
          .where((e) => e.orderLineId == target.orderLineId)
          .firstOrNull;
      if (e?.reviewId case final id?) {
        final review = await _repo.get(id);
        _clear();
        return CommandDone(review);
      }
    } on PmartFailure {
      // 조회도 실패했다. 모르는 채로 둔다.
    }
    return const CommandUnknown();
  }

  void _clear() {
    _key = null;
    _body = null;
  }
}

/// 리뷰 수정에서 보낼 것(바뀐 것만). 모두 null 이면 보낼 것이 없다(서버 400).
typedef ReviewChanges = ({int? rating, String? text, List<String>? photoIds});

/// [original] 과 지금 입력을 견줘 바뀐 것만 고른다. 바뀐 것이 없으면 null.
/// 사진은 순서까지 같으면 그대로 둔다(빼고 보낸다 — 보내면 그 목록으로 통째로 바뀐다).
ReviewChanges? reviewChanges(
  ReviewView original, {
  required int rating,
  required String text,
  required List<String> photoIds,
}) {
  final before = [for (final p in original.photos) p.photoId];
  final samePhotos =
      before.length == photoIds.length &&
      [for (var i = 0; i < before.length; i++) before[i] == photoIds[i]]
          .every((x) => x);
  final changes = (
    rating: rating == original.rating ? null : rating,
    text: text == (original.text ?? '') ? null : text,
    photoIds: samePhotos ? null : photoIds,
  );
  return changes.rating == null &&
          changes.text == null &&
          changes.photoIds == null
      ? null
      : changes;
}

/// 수정·삭제처럼 "결과를 모르면 같은 키·같은 본문으로만 다시" 보내는 명령(백엔드 요청 2026-11-16 review-edit-delete §2·§3).
/// - 처음 [run] 에 준 보내기 함수와 키를 결과가 나올 때까지 보관한다. "다시 확인"은 그 둘로만 다시 보낸다.
/// - Problem(4xx) 은 거절로 끝내고 키를 버린다(다음 누름 = 새 키).
class KeptReviewCommand<T> {
  IdempotencyKey? _key;
  Future<T> Function(IdempotencyKey key)? _send;

  /// 결과를 모르는 채 보관 중(입력을 바꾸면 안 된다).
  bool get pending => _key != null;

  Future<CommandOutcome<T>> run(
    Future<T> Function(IdempotencyKey key) send,
  ) async {
    final s = _send ??= send;
    final key = _key ??= IdempotencyKey.generate();
    try {
      final v = await s(key);
      _clear();
      return CommandDone(v);
    } on UnknownResultFailure {
      return const CommandUnknown();
    } on ProblemFailure catch (f) {
      _clear();
      return CommandRejected(f.problem.code);
    } on PmartFailure {
      _clear();
      return const CommandRejected(ProblemCode.unknown);
    }
  }

  void _clear() {
    _key = null;
    _send = null;
  }
}
