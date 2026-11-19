import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../domain/catalog.dart';
import 'catalog_providers.dart';
import 'widgets/product_tile_card.dart';

String sortLabel(AppLocalizations l10n, SortKey s) => switch (s) {
  SortKey.relevance => l10n.sortRelevance,
  SortKey.popular => l10n.sortPopular,
  SortKey.newest => l10n.sortNewest,
  SortKey.priceAsc => l10n.sortPriceAsc,
  SortKey.priceDesc => l10n.sortPriceDesc,
  SortKey.rating => l10n.sortRating,
};

/// SCR-LIST-001 본문. 정렬·필터는 이 위젯이 들고, 결과는 조건별 provider 에서 읽는다.
///
/// 상세로 갔다 돌아오면(push) 이 위젯이 살아 있으므로 조건·스크롤이 그대로다.
class ProductListView extends ConsumerStatefulWidget {
  const ProductListView({super.key, required this.baseQuery});

  /// 검색어·카테고리. 정렬·필터는 여기서 바꾼다.
  final ProductQuery baseQuery;

  @override
  ConsumerState<ProductListView> createState() => _ProductListViewState();
}

class _ProductListViewState extends ConsumerState<ProductListView> {
  SortKey _sort = SortKey.relevance;
  Set<String> _filters = const {};

  ProductQuery get _query =>
      widget.baseQuery.copyWith(sort: _sort, filters: _filters);

  @override
  void didUpdateWidget(ProductListView old) {
    super.didUpdateWidget(old);
    // 검색어·카테고리가 바뀌면 이전 조건의 필터는 의미가 없다. 정렬은 유지한다.
    if (old.baseQuery != widget.baseQuery) _filters = const {};
  }

  Future<void> _openFilters() async {
    final picked = await showModalBottomSheet<Set<String>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => FilterSheet(query: widget.baseQuery, initial: _filters),
    );
    // 닫기(null)는 기존 조건 유지.
    if (picked != null && mounted) setState(() => _filters = picked);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final query = _query;
    final provider = productListProvider(query);
    final value = ref.watch(provider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 0),
          child: Row(
            children: [
              Expanded(
                child: Text(switch (value.value?.total) {
                  final int total => l10n.searchResultCount(total),
                  null => '',
                }),
              ),
              DropdownButton<SortKey>(
                key: const ValueKey('sort'),
                underline: const SizedBox.shrink(),
                style: Theme.of(context).textTheme.labelLarge,
                value: _sort,
                onChanged: (s) => setState(() => _sort = s ?? _sort),
                items: [
                  for (final s in SortKey.values)
                    DropdownMenuItem(value: s, child: Text(sortLabel(l10n, s))),
                ],
              ),
              const SizedBox(width: 8),
              TextButton.icon(
                key: const ValueKey('open-filters'),
                onPressed: _openFilters,
                icon: const Icon(Icons.tune),
                label: Text(
                  _filters.isEmpty
                      ? l10n.filterTitle
                      : l10n.filterSelectedCount(_filters.length),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: UiStateView<ProductListState>(
            state: uiStateOf(value, isEmpty: (s) => s.items.isEmpty),
            onRetry: () => ref.invalidate(provider),
            empty: (_) => Center(child: Text(l10n.searchNoResult)),
            ready: (context, list) => ProductGrid(
              key: const PageStorageKey('product-list'),
              list: list,
              onLoadMore: () => ref.read(provider.notifier).loadMore(),
            ),
          ),
        ),
      ],
    );
  }
}

/// 상품 2칸 격자 + 목록 끝의 "더 보기". 검색·카테고리·전체보기가 같이 쓴다.
class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.list, required this.onLoadMore});

  final ProductListState list;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final width = ProductTileCard.gridWidthOf(context);
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          sliver: SliverGrid.builder(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 12,
              mainAxisSpacing: 16,
              mainAxisExtent: ProductTileCard.heightFor(context, width),
            ),
            itemCount: list.items.length,
            itemBuilder: (context, i) {
              final tile = list.items[i];
              return ProductTileCard(
                rail: true,
                tile: tile,
                onTap: () =>
                    context.push('/products/${tile.productId}', extra: tile),
              );
            },
          ),
        ),
        if (list.hasMore)
          SliverToBoxAdapter(
            child: LoadMoreFooter(list: list, onLoadMore: onLoadMore),
          ),
        const SliverToBoxAdapter(child: SizedBox(height: 16)),
      ],
    );
  }
}

/// 목록 끝의 "더 보기"·다음 묶음 실패 안내(받은 목록은 그대로 둔다).
class LoadMoreFooter extends StatelessWidget {
  const LoadMoreFooter({
    super.key,
    required this.list,
    required this.onLoadMore,
  });

  final ProductListState list;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (list.loadingMore) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        children: [
          if (list.loadMoreFailure != null) Text(l10n.loadMoreFailed),
          OutlinedButton(
            key: const ValueKey('load-more'),
            onPressed: onLoadMore,
            child: Text(l10n.loadMore),
          ),
        ],
      ),
    );
  }
}

/// SCR-FILTER-001. 고른 값은 임시 선택이다. 적용해야 반영되고, 닫기는 기존 조건을 유지한다.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key, required this.query, required this.initial});

  final ProductQuery query;
  final Set<String> initial;

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  late Set<String> _picked = {...widget.initial};

  void _toggle(FilterAttribute a, FilterValue v) {
    final token = a.token(v);
    setState(() {
      if (_picked.contains(token)) {
        _picked = {..._picked}..remove(token);
      } else {
        _picked = {
          // 단일 선택 속성은 같은 속성의 다른 값을 지운다.
          if (a.multiSelect)
            ..._picked
          else
            ..._picked.where((t) => !t.startsWith('${a.key}.')),
          token,
        };
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = filtersProvider(
      ProductQuery(
        keyword: widget.query.keyword,
        categoryId: widget.query.categoryId,
      ),
    );
    final state = uiStateOf(ref.watch(provider), isEmpty: (a) => a.isEmpty);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.filterTitle,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 220,
              child: UiStateView<List<FilterAttribute>>(
                state: state,
                onRetry: () => ref.invalidate(provider),
                ready: (context, attributes) => ListView(
                  children: [
                    for (final a in attributes) ...[
                      Text(a.label),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final v in a.values)
                            FilterChip(
                              key: ValueKey('filter-${a.token(v)}'),
                              selected: _picked.contains(a.token(v)),
                              label: Text(switch (v.count) {
                                final int c => l10n.filterValueCount(
                                  v.label,
                                  c,
                                ),
                                null => v.label,
                              }),
                              // 현재 조건에서 결과가 0개인 값은 고를 수 없다(이미 고른 값은 해제 가능).
                              onSelected:
                                  (v.count == 0 &&
                                      !_picked.contains(a.token(v)))
                                  ? null
                                  : (_) => _toggle(a, v),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                TextButton(
                  key: const ValueKey('filter-close'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(l10n.filterClose),
                ),
                const Spacer(),
                TextButton(
                  key: const ValueKey('filter-reset'),
                  onPressed: () => setState(() => _picked = {}),
                  child: Text(l10n.filterReset),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const ValueKey('filter-apply'),
                  onPressed: () => Navigator.of(context).pop(_picked),
                  child: Text(l10n.filterApply),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
