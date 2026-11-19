import 'package:dio/dio.dart';
import 'package:pmart_api_pricing/pmart_api_pricing.dart' as pr;
import 'package:pmart_api_product/pmart_api_product.dart' as pd;
import 'package:pmart_api_product_content/pmart_api_product_content.dart' as pc;
import 'package:pmart_api_search/pmart_api_search.dart' as sr;
import 'package:pmart_api_storefront/pmart_api_storefront.dart' as sf;
import 'package:pmart_core/pmart_core.dart';

import '../domain/catalog.dart';

/// 둘러보기(홈·카테고리·검색·상품 상세). 실패는 [PmartFailure] 로 던진다.
abstract interface class CatalogRepository {
  Future<HomeView> home({String? mfcId, HomeTab? tab});

  /// 영역 하나만 다시 조회한다(UNAVAILABLE 영역 재시도·전체보기). [cursor] 는 다음 묶음.
  /// 홈 구성이 바뀌었으면 `LAYOUT_VERSION_CHANGED` [ProblemFailure].
  Future<HomeSection> section(
    HomeSection section, {
    required int layoutVersion,
    String? mfcId,
    String? cursor,
  });

  Future<List<CategoryNode>> categories();

  Future<ProductPage> search(
    ProductQuery query, {
    String? mfcId,
    String? cursor,
    CancelToken? cancelToken,
  });

  Future<List<FilterAttribute>> filters(ProductQuery query, {String? mfcId});

  /// 자동완성. 실패해도 직접 검색은 된다(호출자가 빈 제안으로 처리).
  Future<List<String>> suggestions(String keyword);

  Future<ProductDetail> product(String productId, {String? mfcId});
}

/// 실서버 구현(storefront·product·search·product-content).
final class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(Dio dio)
    : _storefront = sf.PmartApiStorefront(dio: dio).getStorefrontApi(),
      _categories = pd.PmartApiProduct(dio: dio).getCategoriesApi(),
      _search = sr.PmartApiSearch(dio: dio).getSearchApi(),
      _contents = pc.PmartApiProductContent(dio: dio).getProductContentsApi(),
      _prices = pr.PmartApiPricing(dio: dio).getPricesApi();

  final sf.StorefrontApi _storefront;
  final pd.CategoriesApi _categories;
  final sr.SearchApi _search;
  final pc.ProductContentsApi _contents;
  final pr.PricesApi _prices;

  @override
  Future<HomeView> home({String? mfcId, HomeTab? tab}) async {
    final res = await pmartGuard(
      () => _storefront.getHome(mfcId: mfcId, tab: _tabToContract(tab)),
    );
    return homeFromContract(_body(res.data, 'HomeLayout'));
  }

  @override
  Future<HomeSection> section(
    HomeSection section, {
    required int layoutVersion,
    String? mfcId,
    String? cursor,
  }) async {
    final res = await pmartGuard(
      () => _storefront.listSectionItems(
        sectionId: section.sectionId,
        mfcId: mfcId,
        layoutVersion: layoutVersion,
        cursor: cursor,
      ),
    );
    return sectionItemsFromContract(section, _body(res.data, 'SectionItems'));
  }

  @override
  Future<List<CategoryNode>> categories() async {
    final res = await pmartGuard(() => _categories.getCategoryTree());
    return categoriesFromContract(_body(res.data, 'CategoryTree'));
  }

  @override
  Future<ProductPage> search(
    ProductQuery query, {
    String? mfcId,
    String? cursor,
    CancelToken? cancelToken,
  }) async {
    final res = await pmartGuard(
      () => _search.searchProducts(
        q: query.keyword,
        categoryId: query.categoryId,
        mfcId: mfcId,
        sort: _sortToContract(query.sort),
        filters: query.filters.isEmpty ? null : query.filters.toList(),
        cursor: cursor,
        cancelToken: cancelToken,
      ),
    );
    return searchFromContract(_body(res.data, 'SearchResult'));
  }

  @override
  Future<List<FilterAttribute>> filters(
    ProductQuery query, {
    String? mfcId,
  }) async {
    final res = await pmartGuard(
      () => _search.getSearchFilters(
        q: query.keyword,
        categoryId: query.categoryId,
        mfcId: mfcId,
      ),
    );
    return filtersFromContract(_body(res.data, 'SearchFilters'));
  }

  @override
  Future<List<String>> suggestions(String keyword) async {
    final res = await pmartGuard(
      () => _search.getSearchSuggestions(q: keyword),
    );
    return res.data?.keywords ?? const [];
  }

  @override
  Future<ProductDetail> product(String productId, {String? mfcId}) async {
    final res = await pmartGuard(
      () => _contents.getProductContent(productId: productId, mfcId: mfcId),
    );
    final content = _body(res.data, 'ProductContent');
    return productFromContract(content, prices: await _pricesFor(content));
  }

  /// 상세 응답의 옵션 `price` 가 비어 오면(백엔드 product-content 는 가격을 채우지 않는다, BR-36)
  /// 표시 가격을 `GET /prices?skus=` 로 따로 읽는다. 가격 조회가 실패해도 상세는 보이고,
  /// 그 옵션은 "가격 확인 중"으로 남는다(0원·판매 불가로 확정하지 않는다).
  Future<OptionPrices?> _pricesFor(pc.ProductContent c) async {
    final skus = [
      for (final o in c.options ?? const <pc.SaleOption>[])
        if (o.price?.basePrice == null && o.sku != null) o.sku!,
    ];
    if (skus.isEmpty) return null;
    try {
      // 계약은 style=form, explode=false(`skus=a,b`). dio 기본 배열 인코딩은 `skus=a&skus=b` 라 직접 잇는다.
      final res = await pmartGuard(
        () => _prices.listPrices(skus: [skus.join(',')]),
      );
      final body = res.data;
      if (body == null) return null;
      return OptionPrices(
        prices: {
          for (final p in body.items ?? const <pr.Price>[])
            p.sku: (basePrice: p.basePrice, priceVersion: p.priceVersion),
        },
        notSet: {...?body.notSet},
      );
    } on PmartFailure {
      return null;
    }
  }
}

/// `GET /prices?skus=` 결과. [notSet] 은 유효 가격이 없는 SKU(PRICE_NOT_SET, 판매 불가).
final class OptionPrices {
  const OptionPrices({required this.prices, required this.notSet});

  final Map<String, ({int basePrice, int priceVersion})> prices;
  final Set<String> notSet;
}

T _body<T>(T? data, String name) =>
    data ?? (throw ContractViolationFailure('$name 본문 없음'));

/// 핵심 식별 필드가 없으면 계약 위반이다(빈 값으로 메우지 않는다).
T _required<T>(T? value, String field) =>
    value ?? (throw ContractViolationFailure('$field 없음'));

sf.TabKey? _tabToContract(HomeTab? tab) => switch (tab) {
  null => null,
  HomeTab.home => sf.TabKey.HOME,
  HomeTab.ranking => sf.TabKey.RANKING,
  HomeTab.isNew => sf.TabKey.NEW,
};

HomeTab _tabFromContract(sf.TabKey t) => switch (t) {
  sf.TabKey.HOME => HomeTab.home,
  sf.TabKey.RANKING => HomeTab.ranking,
  sf.TabKey.NEW => HomeTab.isNew,
};

sr.SortKey _sortToContract(SortKey s) => switch (s) {
  SortKey.relevance => sr.SortKey.RELEVANCE,
  SortKey.popular => sr.SortKey.POPULAR,
  SortKey.newest => sr.SortKey.NEWEST,
  SortKey.priceAsc => sr.SortKey.PRICE_ASC,
  SortKey.priceDesc => sr.SortKey.PRICE_DESC,
  SortKey.rating => sr.SortKey.RATING,
};

SaleState _saleState(String? wire) => switch (wire) {
  'ON_SALE' => SaleState.onSale,
  'TEMPORARILY_SOLD_OUT' => SaleState.temporarilySoldOut,
  'SALE_STOPPED' => SaleState.saleStopped,
  _ => SaleState.unknown,
};

ProductTile _tileFromDisplay(sf.DisplayItem i) => ProductTile(
  productId: _required(i.productId, 'DisplayItem.productId'),
  name: _required(i.name, 'DisplayItem.name'),
  imageUrl: i.imageUrl,
  representativeSku: i.representativeSku,
  basePrice: i.basePrice,
  saleState: _saleState(i.saleState?.value),
  carried: i.carried,
  rating: i.rating?.toDouble(),
  reviewCount: i.reviewCount,
  badge: switch (i.badge) {
    sf.DisplayItemBadgeEnum.NEW => DisplayBadge.isNew,
    sf.DisplayItemBadgeEnum.RANK => DisplayBadge.rank,
    _ => DisplayBadge.none,
  },
  rank: i.rank,
);

SectionKind _kind(sf.SectionKindEnum? k) => switch (k) {
  sf.SectionKindEnum.THEME => SectionKind.theme,
  sf.SectionKindEnum.SEASON => SectionKind.season,
  sf.SectionKindEnum.WEEKLY_PICK => SectionKind.weeklyPick,
  sf.SectionKindEnum.NEW => SectionKind.isNew,
  sf.SectionKindEnum.RANKING => SectionKind.ranking,
  sf.SectionKindEnum.HIGH_RATING => SectionKind.highRating,
  sf.SectionKindEnum.IN_PROGRESS_ORDER => SectionKind.inProgressOrder,
  null => SectionKind.unknown,
};

HomeView homeFromContract(sf.HomeLayout h) => HomeView(
  layoutVersion: h.layoutVersion,
  tabs: [for (final t in h.tabs ?? const <sf.TabKey>[]) _tabFromContract(t)],
  banners: [
    for (final b in h.banners ?? const <sf.Banner>[])
      HomeBanner(
        bannerId: _required(b.bannerId, 'Banner.bannerId'),
        imageUrl: b.imageUrl,
        altText: b.altText,
      ),
  ],
  sections: [
    for (final s in h.sections)
      HomeSection(
        sectionId: _required(s.sectionId, 'Section.sectionId'),
        kind: _kind(s.kind),
        title: s.title ?? '',
        subtitle: s.subtitle,
        // state 가 없으면 성공으로 보지 않는다. 영역 하나만 실패로 표시한다.
        available: s.state == sf.SectionStateEnum.OK,
        items: arrangeForDisplay(
          (s.items ?? const <sf.DisplayItem>[]).map(_tileFromDisplay),
        ),
        nextCursor: s.nextCursor,
        viewAllRef: s.viewAllRef,
      ),
  ],
);

HomeSection sectionItemsFromContract(
  HomeSection base,
  sf.ListSectionItems200Response r,
) => HomeSection(
  sectionId: base.sectionId,
  kind: base.kind,
  title: base.title,
  subtitle: base.subtitle,
  available: true,
  items: arrangeForDisplay(
    (r.items ?? const <sf.DisplayItem>[]).map(_tileFromDisplay),
  ),
  nextCursor: r.page?.nextCursor,
  viewAllRef: base.viewAllRef,
);

List<CategoryNode> categoriesFromContract(pd.GetCategoryTree200Response r) {
  final nodes = [
    for (final n in r.nodes ?? const <pd.CategoryNode>[])
      if (n.exposed != false) n,
  ]..sort((a, b) => (a.sortOrder ?? 0).compareTo(b.sortOrder ?? 0));
  return [
    for (final n in nodes)
      CategoryNode(
        categoryId: _required(n.categoryId, 'CategoryNode.categoryId'),
        parentId: n.parentId,
        // 계약 CategoryLevel(상위>하위>칩1>칩2, ADR-0015) → 깊이 1~4
        depth: switch (n.level) {
          pd.CategoryLevel.TOP => 1,
          pd.CategoryLevel.SUB => 2,
          pd.CategoryLevel.CHIP1 => 3,
          pd.CategoryLevel.CHIP2 => 4,
        },
        name: n.name,
      ),
  ];
}

ProductPage searchFromContract(sr.SearchResult r) => ProductPage(
  items: arrangeForDisplay(
    r.items.map(
      (h) => ProductTile(
        productId: _required(h.productId, 'SearchHit.productId'),
        name: _required(h.name, 'SearchHit.name'),
        imageUrl: h.imageUrl,
        representativeSku: h.representativeSku,
        basePrice: h.basePrice,
        saleState: _saleState(h.saleState?.value),
        carried: h.carried,
        rating: h.rating?.toDouble(),
        reviewCount: h.reviewCount,
      ),
    ),
  ),
  nextCursor: r.page.nextCursor,
  total: r.total,
);

List<FilterAttribute> filtersFromContract(sr.GetSearchFilters200Response r) => [
  for (final a in r.attributes ?? const <sr.FilterAttribute>[])
    FilterAttribute(
      key: _required(a.key, 'FilterAttribute.key'),
      label: a.label ?? a.key!,
      multiSelect: a.multiSelect ?? false,
      values: [
        for (final v in a.values ?? const <sr.FilterAttributeValuesInner>[])
          FilterValue(
            value: _required(v.value, 'FilterAttribute.values.value'),
            label: v.label ?? v.value!,
            count: v.count,
          ),
      ],
    ),
];

List<String> _imageUrlsOf(List<pc.Image> sorted, pc.ImageRoleEnum role) => [
  for (final i in sorted)
    if (i.role == role && i.url != null && i.url!.isNotEmpty) i.url!,
];

ProductDetail productFromContract(pc.ProductContent c, {OptionPrices? prices}) {
  final images = [...?c.images]
    ..sort((a, b) => (a.sortOrder ?? 0).compareTo(b.sortOrder ?? 0));
  final rating = c.rating;
  return ProductDetail(
    productId: _required(c.productId, 'ProductContent.productId'),
    name: _required(c.name, 'ProductContent.name'),
    mainImageUrl:
        c.mainImage?.url ??
        images.where((i) => i.role == pc.ImageRoleEnum.MAIN).firstOrNull?.url,
    // 역할(role)별로 나눈다. 역할이 없는 이미지는 어디에 둘지 모르므로 쓰지 않는다.
    descriptionImageUrls: _imageUrlsOf(images, pc.ImageRoleEnum.DESCRIPTION),
    detailImageUrls: _imageUrlsOf(images, pc.ImageRoleEnum.DETAIL),
    description: c.description,
    storageGuide: c.storageGuide,
    returnGuide: c.returnGuide,
    notices: c.notices ?? const [],
    categoryPath: c.categoryPath ?? const [],
    rating: switch (rating) {
      final r? when r.averageRating != null => RatingSummary(
        average: r.averageRating!.toDouble(),
        count: r.reviewCount,
      ),
      _ => null,
    },
    options: [
      for (final o in c.options ?? const <pc.SaleOption>[])
        if (_saleState(o.saleState) != SaleState.saleStopped)
          SaleOption(
            sku: _required(o.sku, 'SaleOption.sku'),
            label: o.label,
            unitType: switch (o.unitType) {
              pc.SaleOptionUnitTypeEnum.E => UnitType.each,
              pc.SaleOptionUnitTypeEnum.B => UnitType.bundle,
              null => null,
            },
            unitsPerSku: o.unitsPerSku,
            capacityLabel: o.capacityLabel,
            basePrice: o.price?.basePrice ?? prices?.prices[o.sku]?.basePrice,
            priceVersion:
                o.price?.priceVersion ?? prices?.prices[o.sku]?.priceVersion,
            priceNotSet: prices?.notSet.contains(o.sku) ?? false,
            carried: o.availability?.carried,
            availability:
                _saleState(o.saleState) == SaleState.temporarilySoldOut
                ? Availability.soldOut
                : switch (o.availability?.state) {
                    pc.SaleOptionAvailabilityStateEnum.AVAILABLE =>
                      Availability.available,
                    pc.SaleOptionAvailabilityStateEnum.LOW => Availability.low,
                    pc.SaleOptionAvailabilityStateEnum.SOLD_OUT =>
                      Availability.soldOut,
                    _ => Availability.unknown,
                  },
          ),
    ],
  );
}
