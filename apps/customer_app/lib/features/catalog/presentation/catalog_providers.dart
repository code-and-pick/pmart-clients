import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../../shared/shopping_context.dart';
import '../data/catalog_repository.dart';
import '../data/mock_catalog_repository.dart';
import '../domain/catalog.dart';

final catalogRepositoryProvider = Provider<CatalogRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockCatalogRepository(),
    PmartEnv.local => ApiCatalogRepository(ref.watch(dioProvider)),
  },
);

/// 홈이 다시 보일 때(상세에서 뒤로·다른 탭에서 홈으로) 마지막 조회가 이보다 오래됐으면 다시 읽는다.
/// 홈은 화면을 떠나도 남아 있어, 다시 읽지 않으면 승인·발효된 새 가격이 상세와 다르게 보인다.
const homeStaleAfter = Duration(minutes: 1);

/// 지금 시각. 테스트가 시간을 넘길 수 있게 둔다.
final homeClockProvider = Provider<DateTime Function()>((_) => DateTime.now);

/// 홈 구성. 쇼핑 주소(센터)가 바뀌면 다시 조회한다.
final homeProvider = FutureProvider<HomeView>(
  (ref) => ref
      .watch(catalogRepositoryProvider)
      .home(mfcId: ref.watch(currentMfcIdProvider)),
);

/// UNAVAILABLE 영역 하나의 재조회 상태. null 이면 아직 재시도하지 않았다.
final sectionRetryProvider = NotifierProvider.autoDispose
    .family<SectionRetry, AsyncValue<HomeSection>?, String>(SectionRetry.new);

class SectionRetry extends Notifier<AsyncValue<HomeSection>?> {
  SectionRetry(this.sectionId);

  final String sectionId;

  @override
  AsyncValue<HomeSection>? build() => null;

  Future<void> retry(HomeSection section, int layoutVersion) async {
    if (state?.isLoading ?? false) return;
    state = const AsyncLoading();
    try {
      final fresh = await ref
          .read(catalogRepositoryProvider)
          .section(
            section,
            layoutVersion: layoutVersion,
            mfcId: ref.read(currentMfcIdProvider),
          );
      if (!ref.mounted) return;
      state = AsyncData(fresh);
    } on ProblemFailure catch (e, st) {
      if (!ref.mounted) return;
      // 홈 구성이 바뀌었으면 영역만 고칠 수 없다. 홈 전체를 다시 받는다.
      if (e.problem.code == 'LAYOUT_VERSION_CHANGED') {
        ref.invalidate(homeProvider);
        state = null;
        return;
      }
      state = AsyncError(e, st);
    } on PmartFailure catch (e, st) {
      if (!ref.mounted) return;
      state = AsyncError(e, st);
    }
  }
}

final categoriesProvider = FutureProvider<List<CategoryNode>>(
  (ref) => ref.watch(catalogRepositoryProvider).categories(),
);

/// 상품 목록(검색·카테고리) 한 조건의 누적 페이지.
class ProductListState {
  const ProductListState({
    required this.items,
    required this.nextCursor,
    this.total,
    this.loadingMore = false,
    this.loadMoreFailure,
  });

  final List<ProductTile> items;
  final String? nextCursor;
  final int? total;
  final bool loadingMore;

  /// 다음 묶음 실패. 이미 받은 목록은 그대로 두고 "더 불러오기 실패"만 보인다.
  final PmartFailure? loadMoreFailure;

  bool get hasMore => nextCursor != null;
}

/// 조건(query)마다 따로 둔다. 화면은 현재 조건의 provider 만 보므로
/// 이전 조건의 늦은 응답이 현재 결과를 덮지 않는다(연속 검색은 마지막 요청만 반영).
final productListProvider = AsyncNotifierProvider.autoDispose
    .family<ProductListController, ProductListState, ProductQuery>(
      ProductListController.new,
    );

class ProductListController extends AsyncNotifier<ProductListState> {
  ProductListController(this.query);

  final ProductQuery query;

  @override
  Future<ProductListState> build() async {
    final cancel = CancelToken();
    ref.onDispose(cancel.cancel);
    final page = await ref
        .watch(catalogRepositoryProvider)
        .search(
          query,
          mfcId: ref.watch(currentMfcIdProvider),
          cancelToken: cancel,
        );
    return ProductListState(
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) return;
    state = AsyncData(
      ProductListState(
        items: current.items,
        nextCursor: current.nextCursor,
        total: current.total,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(catalogRepositoryProvider)
          .search(
            query,
            mfcId: ref.read(currentMfcIdProvider),
            cursor: current.nextCursor,
          );
      if (!ref.mounted) return;
      final seen = {for (final t in current.items) t.productId};
      state = AsyncData(
        ProductListState(
          // 같은 묶음을 다시 받아도 중복으로 붙이지 않는다.
          items: [
            ...current.items,
            ...page.items.where((t) => !seen.contains(t.productId)),
          ],
          nextCursor: page.nextCursor,
          total: page.total ?? current.total,
        ),
      );
    } on PmartFailure catch (e) {
      if (!ref.mounted) return;
      state = AsyncData(
        ProductListState(
          items: current.items,
          nextCursor: current.nextCursor,
          total: current.total,
          loadMoreFailure: e,
        ),
      );
    }
  }
}

final filtersProvider = FutureProvider.autoDispose
    .family<List<FilterAttribute>, ProductQuery>(
      (ref, query) => ref
          .watch(catalogRepositoryProvider)
          .filters(query, mfcId: ref.watch(currentMfcIdProvider)),
    );

/// 상품 평점 집계(서버 — rating-summary). 상세의 별점·리뷰 수는 이것을 먼저 쓴다(상세 응답 `rating` 이 비어 올 수 있다).
final productRatingProvider = FutureProvider.autoDispose
    .family<RatingSummary?, String>(
      (ref, productId) =>
          ref.watch(catalogRepositoryProvider).ratingSummary(productId),
    );

/// 상품 상세. 화면을 나가도 [productDetailKeep] 동안 붙잡아 다시 들어오면 바로 보인다(화면이 뒤에서 다시 읽는다 —
/// 백엔드 요청 2026-11-19 상세 속도 R2). 지금 MFC 를 watch 해 센터가 바뀌면 새로 읽는다.
const productDetailKeep = Duration(minutes: 5);

final productDetailProvider = FutureProvider.autoDispose
    .family<ProductDetail, String>((ref, productId) {
      final link = ref.keepAlive();
      final timer = Timer(productDetailKeep, link.close);
      ref.onDispose(timer.cancel);
      return ref
          .watch(catalogRepositoryProvider)
          .product(productId, mfcId: ref.watch(currentMfcIdProvider));
    });
