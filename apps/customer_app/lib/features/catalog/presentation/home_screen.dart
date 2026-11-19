import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers.dart';
import '../../../shared/ui_state_of.dart';
import '../../address/presentation/address_controller.dart';
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../checkout/domain/checkout.dart';
import '../../checkout/presentation/delivery_select_screen.dart'
    show modeLabel, optionSubtitle, windowText;
import '../../orders/domain/orders.dart';
import '../../orders/presentation/orders_providers.dart' show orderStatusText;
import '../../payment/presentation/payment_controller.dart';
import '../domain/catalog.dart';
import 'catalog_providers.dart';
import 'home_providers.dart';
import 'widgets/category_art.dart';
import 'widgets/product_tile_card.dart';

/// SCR-HOME-001. 영역별 부분 실패는 그 영역만 다시 불러온다.
/// 위에서부터 결과 불명 결제·진행 중 주문·배송 방식 요약, 고정 탭(홈·랭킹·신상품), 탭 본문 순서다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  HomeTab _tab = HomeTab.home;

  GoRouter? _router;
  String? _lastPath;

  /// 마지막 홈 조회가 끝난 시각(성공·실패 모두). null 이면 아직 첫 조회 중이다.
  DateTime? _loadedAt;

  @override
  void initState() {
    super.initState();
    ref.listenManual(homeProvider, (_, next) {
      if (next.isLoading) return;
      _loadedAt = ref.read(homeClockProvider)();
    }, fireImmediately: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final router = GoRouter.maybeOf(context);
    if (router == _router) return;
    _router?.routerDelegate.removeListener(_onRouteChanged);
    _router = router;
    _lastPath = _path;
    router?.routerDelegate.addListener(_onRouteChanged);
  }

  @override
  void dispose() {
    _router?.routerDelegate.removeListener(_onRouteChanged);
    super.dispose();
  }

  /// 맨 위 화면의 위치. `push` 로 올린 화면(상품 상세 등)은 `uri` 가 그대로라 맨 위 경로로 본다.
  String? get _path =>
      _router?.routerDelegate.currentConfiguration.lastOrNull?.matchedLocation;

  /// 홈이 다시 보이면(상세에서 뒤로·다른 탭에서 홈으로) 오래된 홈을 다시 읽는다.
  void _onRouteChanged() {
    final path = _path;
    final was = _lastPath;
    _lastPath = path;
    if (path != '/' || was == '/') return;
    // 내비게이션 알림 안에서 provider 를 바꾸지 않게 한 박자 뒤에 한다
    scheduleMicrotask(() {
      if (mounted) _refreshIfStale();
    });
  }

  void _refreshIfStale() {
    final at = _loadedAt;
    if (at == null) return; // 첫 조회 중
    if (ref.read(homeClockProvider)().difference(at) < homeStaleAfter) return;
    _refresh().ignore(); // 실패는 홈 화면이 오류로 보인다
  }

  Future<HomeView> _refresh() {
    ref
      ..invalidate(homeDeliveryOptionsProvider)
      ..invalidate(homeInProgressOrderProvider)
      // 다시 불러온 영역도 새 홈 응답으로 바꾼다(남겨 두면 그 영역만 옛 가격이다)
      ..invalidate(sectionRetryProvider);
    if (_tab != HomeTab.home) ref.invalidate(homeTabProvider(_tab));
    return ref.refresh(homeProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final mock = ref.watch(envProvider) == PmartEnv.mock;
    // 새로 고침(invalidate·refresh) 중에는 Riverpod 가 이전 홈을 AsyncData 로 둔다 — 자리 표시로 깜빡이지 않는다.
    // 쇼핑 주소가 바뀐 재조회는 AsyncLoading 이라 자리 표시를 보인다(다른 센터 상품을 남기지 않는다).
    final state = uiStateOf(
      ref.watch(homeProvider),
      isEmpty: (h) => h.sections.isEmpty && h.banners.isEmpty,
    );
    final gray = Theme.of(context).colorScheme.surfaceContainer;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: gray,
        toolbarHeight: 46,
        title: const _AddressChip(),
        actions: [
          IconButton(
            key: const ValueKey('home-notifications'),
            visualDensity: VisualDensity.compact,
            icon: const PmartLineIcon(PmartLineIcons.bell, size: 23),
            tooltip: l10n.noticeTitle,
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(
            key: const ValueKey('home-top-search'),
            visualDensity: VisualDensity.compact,
            icon: const PmartLineIcon(PmartLineIcons.search, size: 23),
            tooltip: l10n.searchTitle,
            onPressed: () => context.go('/search'),
          ),
          IconButton(
            key: const ValueKey('home-top-cart'),
            visualDensity: VisualDensity.compact,
            icon: const PmartLineIcon(PmartLineIcons.cart, size: 23),
            tooltip: l10n.cartTitle,
            onPressed: () => context.go('/cart'),
          ),
          const SizedBox(width: 4),
          if (mock)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(child: PmartTag(l10n.mockModeBadge)),
            ),
        ],
      ),
      // 첫 로딩은 가운데 원형 표시 대신 자리 표시 블록을 그린다(§17).
      body: state is UiLoading<HomeView>
          ? const HomeSkeleton()
          : UiStateView<HomeView>(
              state: state,
              onRetry: () => ref.invalidate(homeProvider),
              ready: (context, home) {
                final tab = home.tabs.contains(_tab) ? _tab : HomeTab.home;
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              gray,
                              gray,
                              Theme.of(context).colorScheme.surface,
                            ],
                            stops: const [0, 0.7, 1],
                          ),
                        ),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SizedBox(height: 4),
                            _PendingPaymentBanner(),
                            _InProgressOrderCard(),
                            _DeliverySummaryCard(),
                          ],
                        ),
                      ),
                      if (home.tabs.length > 1)
                        _HomeTabs(
                          tabs: home.tabs,
                          selected: tab,
                          onSelected: (t) => setState(() => _tab = t),
                        ),
                      if (tab == HomeTab.home) ...[
                        if (home.banners.isNotEmpty)
                          _BannerPager(banners: home.banners),
                        const _HomeSearchBar(),
                        const _CategoryShortcuts(),
                        const SizedBox(height: 14),
                        const PmartSectionGap(height: 10),
                        for (final s in home.sections)
                          _SectionView(
                            key: ValueKey('section-${s.sectionId}'),
                            section: s,
                            layoutVersion: home.layoutVersion,
                          ),
                      ] else
                        _TabBody(
                          key: ValueKey('home-tab-body-${tab.name}'),
                          tab: tab,
                        ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

String homeTabLabel(AppLocalizations l10n, HomeTab t) => switch (t) {
  HomeTab.home => l10n.tabHome,
  HomeTab.ranking => l10n.tabRanking,
  HomeTab.isNew => l10n.tabNew,
};

/// 서버가 준 고정 탭(`HomeLayout.tabs`). 할인 탭(DEAL)은 1차 제외라 계약에 없다.
class _HomeTabs extends StatelessWidget {
  const _HomeTabs({
    required this.tabs,
    required this.selected,
    required this.onSelected,
  });

  final List<HomeTab> tabs;
  final HomeTab selected;
  final ValueChanged<HomeTab> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Row(
          children: [
            for (final t in tabs)
              InkWell(
                key: ValueKey('home-tab-${t.name}'),
                onTap: () => onSelected(t),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        width: 2.5,
                        color: t == selected
                            ? scheme.onSurface
                            : Colors.transparent,
                      ),
                    ),
                  ),
                  child: Text(
                    homeTabLabel(l10n, t),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontSize: 16,
                      fontWeight: t == selected
                          ? FontWeight.w800
                          : FontWeight.w400,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 랭킹·신상품 탭 본문. 실패는 이 탭만 오류로 보인다(빈 탭으로 바꾸지 않는다).
class _TabBody extends ConsumerWidget {
  const _TabBody({super.key, required this.tab});

  final HomeTab tab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final provider = homeTabProvider(tab);
    return switch (ref.watch(provider)) {
      AsyncData(:final value) when value.sections.isEmpty => Padding(
        key: const ValueKey('home-tab-empty'),
        padding: const EdgeInsets.all(16),
        child: Text(l10n.sectionEmpty),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final s in value.sections)
            _SectionView(
              key: ValueKey('section-${s.sectionId}'),
              section: s,
              layoutVersion: value.layoutVersion,
              vertical: true,
            ),
        ],
      ),
      AsyncError() => _InlineFailure(
        key: const ValueKey('home-tab-failed'),
        text: l10n.sectionUnavailable,
        onRetry: () => ref.invalidate(provider),
      ),
      _ => const _SkeletonRail(),
    };
  }
}

/// 넘겨 보는 배너. 오른쪽 아래에 `1 / N`.
class _BannerPager extends StatefulWidget {
  const _BannerPager({required this.banners});

  final List<HomeBanner> banners;

  @override
  State<_BannerPager> createState() => _BannerPagerState();
}

class _BannerPagerState extends State<_BannerPager> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final banners = widget.banners;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 2),
      child: SizedBox(
        height: 112,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Stack(
            children: [
              PageView.builder(
                itemCount: banners.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, i) => _BannerCard(banners[i]),
              ),
              if (banners.length > 1)
                Positioned(
                  right: 12,
                  bottom: 10,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '${_page + 1} / ${banners.length}',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BannerCard extends ConsumerWidget {
  const _BannerCard(this.banner);

  final HomeBanner banner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // 서버가 배너 그림을 주면 그 그림을 쓴다. 없거나 받지 못하면 색 바탕 + 대체 문구.
    final image = resolveImageUrl(
      banner.imageUrl,
      ref.watch(imageOriginProvider),
    );
    final fallback = _fallback(theme, scheme);
    if (image == null) return fallback;
    return Image.network(
      image,
      fit: BoxFit.cover,
      width: double.infinity,
      height: double.infinity,
      semanticLabel: banner.altText,
      errorBuilder: (_, _, _) => fallback,
    );
  }

  Widget _fallback(ThemeData theme, ColorScheme scheme) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            scheme.primaryContainer,
            Color.lerp(scheme.primaryContainer, scheme.primary, 0.32)!,
          ],
        ),
      ),
      child: Stack(
        children: [
          // 장식(그림 자산 없이): 오른쪽에 옅은 원 두 개
          Positioned(
            right: -24,
            bottom: -40,
            child: _Bubble(size: 150, color: scheme.surface, alpha: 0.35),
          ),
          Positioned(
            right: 76,
            top: -30,
            child: _Bubble(size: 80, color: scheme.surface, alpha: 0.25),
          ),
          const Positioned(
            right: 10,
            top: 6,
            bottom: 2,
            width: 130,
            child: BannerArt(),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 22, right: 136),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                banner.altText ?? '',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                  color: scheme.onSurface,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 홈의 검색창(누르면 검색 탭으로).
class _HomeSearchBar extends StatelessWidget {
  const _HomeSearchBar();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 2),
      child: InkWell(
        key: const ValueKey('home-search'),
        borderRadius: BorderRadius.circular(22),
        onTap: () => context.go('/search'),
        child: Container(
          height: 44,
          padding: const EdgeInsets.only(left: 18, right: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: scheme.onSurface, width: 1.1),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.searchHint,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 13,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              const PmartLineIcon(PmartLineIcons.search, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

/// 상위 카테고리 바로가기(동그란 칸 + 이름, 가로로 넘긴다). 카테고리 그림이 계약에 없어 첫 글자를 넣는다.
/// 조회 중·실패면 그리지 않는다(카테고리 탭이 상태를 직접 보인다).
class _CategoryShortcuts extends ConsumerWidget {
  const _CategoryShortcuts();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final roots = (ref.watch(categoriesProvider).value ?? const [])
        .where((n) => n.depth == 1)
        .toList();
    if (roots.isEmpty) return const SizedBox.shrink();
    final labelHeight = MediaQuery.textScalerOf(context).scale(16);
    final cell = 48 + 5 + labelHeight + 10; // 원 + 간격 + 이름 + 줄 사이
    final twoRows = roots.length > 5;
    return SizedBox(
      height: (twoRows ? cell * 2 : cell) + 14,
      child: GridView.builder(
        key: const ValueKey('home-categories'),
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 14, 12, 0),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: twoRows ? 2 : 1,
          mainAxisExtent: 66,
          mainAxisSpacing: 0,
        ),
        itemCount: roots.length,
        itemBuilder: (context, i) {
          final c = roots[i];
          return InkWell(
            key: ValueKey('home-category-${c.categoryId}'),
            borderRadius: BorderRadius.circular(12),
            onTap: () => context.push(
              Uri(
                path: '/products',
                queryParameters: {'categoryId': c.categoryId, 'title': c.name},
              ).toString(),
            ),
            child: Column(
              children: [
                CategoryArt(name: c.name, size: 48, radius: 16),
                const SizedBox(height: 5),
                Text(
                  c.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w400,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.size, required this.color, required this.alpha});

  final double size;
  final Color color;
  final double alpha;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: color.withValues(alpha: alpha),
    ),
  );
}

/// 진열 영역 하나. 홈 탭은 가로 진열, 랭킹·신상품 탭은 세로 목록([vertical]).
/// 배치 지정 필드가 계약에 없어 배치는 앱이 정한다(순위·NEW 배지는 서버 값).
class _SectionView extends ConsumerWidget {
  const _SectionView({
    super.key,
    required this.section,
    required this.layoutVersion,
    this.vertical = false,
  });

  final HomeSection section;
  final int layoutVersion;
  final bool vertical;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final retry = ref.watch(sectionRetryProvider(section.sectionId));
    final shown = switch (retry) {
      AsyncData(:final value) => value,
      _ => section,
    };
    final Widget body;
    if (shown.available) {
      body = shown.items.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(16),
              child: Text(l10n.sectionEmpty),
            )
          : vertical
          ? Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Wrap(
                spacing: 12,
                runSpacing: 16,
                children: [
                  for (final tile in shown.items)
                    SizedBox(
                      width: ProductTileCard.gridWidthOf(context),
                      height: ProductTileCard.heightFor(
                        context,
                        ProductTileCard.gridWidthOf(context),
                      ),
                      child: ProductTileCard(
                        rail: true,
                        tile: tile,
                        onTap: () => context.push(
                          '/products/${tile.productId}',
                          extra: tile,
                        ),
                      ),
                    ),
                ],
              ),
            )
          : SizedBox(
              height: ProductTileCard.heightFor(
                context,
                ProductTileCard.railWidthOf(context),
              ),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                itemCount: shown.items.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, i) => SizedBox(
                  width: ProductTileCard.railWidthOf(context),
                  child: ProductTileCard(
                    rail: true,
                    tile: shown.items[i],
                    onTap: () => context.push(
                      '/products/${shown.items[i].productId}',
                      extra: shown.items[i],
                    ),
                  ),
                ),
              ),
            );
    } else {
      final loading = retry?.isLoading ?? false;
      body = Padding(
        key: ValueKey('section-unavailable-${section.sectionId}'),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            const Icon(Icons.error_outline),
            const SizedBox(width: 8),
            Expanded(child: Text(l10n.sectionUnavailable)),
            TextButton(
              onPressed: loading
                  ? null
                  : () => ref
                        .read(sectionRetryProvider(section.sectionId).notifier)
                        .retry(section, layoutVersion),
              child: loading
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.sectionRetry),
            ),
          ],
        ),
      );
    }
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PmartSectionHeader(
            title: section.title,
            subtitle: section.subtitle,
            trailing: shown.hasViewAll
                ? TextButton(
                    key: ValueKey('section-view-all-${section.sectionId}'),
                    style: TextButton.styleFrom(
                      foregroundColor: scheme.onSurface,
                      textStyle: Theme.of(context).textTheme.bodyMedium,
                    ),
                    onPressed: () => context.push(
                      '/sections/${shown.sectionId}',
                      extra: SectionRef(shown, layoutVersion),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(l10n.sectionViewAll),
                        const PmartLineIcon(
                          PmartLineIcons.chevronRight,
                          size: 15,
                        ),
                      ],
                    ),
                  )
                : null,
          ),
          body,
        ],
      ),
    );
  }
}

/// 영역 하나의 조회 실패 한 줄 + 다시 확인. 실패를 "없음"으로 보이지 않는다.
class _InlineFailure extends StatelessWidget {
  const _InlineFailure({super.key, required this.text, required this.onRetry});

  final String text;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
          TextButton(onPressed: onRetry, child: Text(l10n.checkoutCheckAgain)),
        ],
      ),
    );
  }
}

/// 진행 중 주문(회원만). 상태·도착 예상은 서버 값만 보인다.
/// 조회 실패는 "주문 없음"이 아니라 실패 한 줄로 보인다. 비회원·진행 중 주문 없음은 그리지 않는다.
class _InProgressOrderCard extends ConsumerWidget {
  const _InProgressOrderCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return switch (ref.watch(homeInProgressOrderProvider)) {
      AsyncData(value: final order?) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Card(
          key: const ValueKey('home-order-card'),
          child: ListTile(
            leading: const Icon(Icons.delivery_dining_outlined),
            title: Text(orderStatusText(l10n, order.status)),
            subtitle: homeOrderHasEta(order.status)
                ? _OrderEtaLine(orderId: order.orderId)
                : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/orders/${order.orderId}'),
          ),
        ),
      ),
      AsyncError() => _InlineFailure(
        key: const ValueKey('home-order-failed'),
        text: l10n.homeOrderFailed,
        onRetry: () => ref.invalidate(homeInProgressOrderProvider),
      ),
      _ => const SizedBox.shrink(),
    };
  }
}

/// 도착 예상 한 줄. 산출됐을 때만 그린다(위치 확인 중·조회 실패는 시간을 만들지 않는다).
class _OrderEtaLine extends ConsumerWidget {
  const _OrderEtaLine({required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final eta = ref.watch(homeOrderEtaProvider(orderId)).value;
    final text = switch (eta) {
      DeliveryEtaView(
        status: EtaStatus.available,
        :final int remainingSeconds,
      ) =>
        l10n.etaRemaining((remainingSeconds / 60).ceil()),
      DeliveryEtaView(status: EtaStatus.available, :final DateTime etaAt) =>
        l10n.etaAt(formatSeoulTime(etaAt)),
      _ => null,
    };
    if (text == null) return const SizedBox.shrink();
    return Text(text, key: const ValueKey('home-order-eta'));
  }
}

/// 배송 방식 요약 + 심야 예약 안내(`GET /delivery-options`). 값은 서버 판정 그대로다.
/// 센터가 없으면 그리지 않고, 조회 실패는 실패 한 줄로 보인다("무료"·0원으로 채우지 않는다).
class _DeliverySummaryCard extends ConsumerWidget {
  const _DeliverySummaryCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return switch (ref.watch(homeDeliveryOptionsProvider)) {
      AsyncData(value: final options?) when options.isNotEmpty =>
        _DeliverySummary(options: options),
      AsyncError() => _InlineFailure(
        key: const ValueKey('home-delivery-failed'),
        text: l10n.homeDeliveryFailed,
        onRetry: () => ref.invalidate(homeDeliveryOptionsProvider),
      ),
      _ => const SizedBox.shrink(),
    };
  }
}

class _DeliverySummary extends StatefulWidget {
  const _DeliverySummary({required this.options});

  final List<DeliveryOption> options;

  @override
  State<_DeliverySummary> createState() => _DeliverySummaryState();
}

class _DeliverySummaryState extends State<_DeliverySummary> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final options = widget.options;
    final night = options.any(
      (o) => !o.available && o.reason == UnavailableReason.nightTime,
    );
    final earliest = options
        .where((o) => o.mode == DeliveryMode.scheduled)
        .firstOrNull
        ?.earliestSlot;
    // 심야로 막힌 방식은 머리 띠 안내가 대신한다.
    final rows = [
      for (final o in options)
        if (!(night && o.reason == UnavailableReason.nightTime)) o,
    ];
    // 접힌 상태에서는 첫 줄(가능한 방식 우선)만 보인다.
    final first =
        rows.where((o) => o.available).firstOrNull ?? rows.firstOrNull;
    final shown = _open ? rows : [?first];
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 14),
      child: Container(
        key: const ValueKey('home-delivery-card'),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 머리 띠(주 색)
            Container(
              key: night ? const ValueKey('home-night-notice') : null,
              color: PmartBrand.violet,
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(
                      night ? Icons.nightlight_round : Icons.bolt_rounded,
                      size: 13,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          night
                              ? l10n.homeNightNotice
                              : l10n.homeDeliveryHeadline,
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (night && earliest != null)
                          Text(
                            l10n.optionEarliestSlot(windowText(earliest)),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: Colors.white.withValues(alpha: 0.88),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            InkWell(
              key: const ValueKey('home-delivery-toggle'),
              onTap: rows.length > 1
                  ? () => setState(() => _open = !_open)
                  : null,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 20, 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          for (final (i, o) in shown.indexed)
                            Padding(
                              key: ValueKey('home-delivery-${o.mode.name}'),
                              padding: EdgeInsets.only(top: i == 0 ? 0 : 12),
                              child: _DeliveryRow(option: o),
                            ),
                        ],
                      ),
                    ),
                    if (rows.length > 1)
                      PmartLineIcon(
                        _open
                            ? PmartLineIcons.chevronUp
                            : PmartLineIcons.chevronDown,
                        size: 20,
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 방식 한 줄: 이름 | 예상시간(굵게) / 기본 배달팁(주 색). 불가면 사유. 값은 서버 값만.
/// 상품액 없이 물었으므로 팁은 기본값만 있다 — 무료 여부는 장바구니·주문서에서 서버가 판정한다.
class _DeliveryRow extends StatelessWidget {
  const _DeliveryRow({required this.option});

  final DeliveryOption option;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final o = option;
    final eta = o.eta;
    final etaText = (eta != null && !eta.notSet)
        ? switch ((eta.minMinutes, eta.maxMinutes)) {
            (final int a, final int b) => l10n.optionEta(a, b),
            _ => null,
          }
        : null;
    final slotText = switch (o.earliestSlot) {
      final w? => l10n.optionEarliestSlot(windowText(w)),
      null => null,
    };
    final tipText = switch (o.tip?.base) {
      final int base => l10n.homeTipBase(formatKrw(base)),
      null => null,
    };
    final strong = theme.textTheme.titleSmall?.copyWith(fontSize: 13.5);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 70,
          child: Text(
            modeLabel(l10n, o.mode),
            style: theme.textTheme.bodyMedium?.copyWith(fontSize: 13.5),
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: o.available
                ? [
                    if ((etaText ?? slotText) case final String t)
                      Text(t, style: strong),
                    if (etaText != null && slotText != null)
                      Text(slotText, style: theme.textTheme.bodySmall),
                    if (tipText != null)
                      Text(
                        tipText,
                        style: strong?.copyWith(color: scheme.primary),
                      ),
                  ]
                : [
                    Text(
                      optionSubtitle(l10n, o),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
          ),
        ),
      ],
    );
  }
}

/// 홈 첫 로딩 자리 표시. 회색 블록만 그린다(새 패키지 없이).
class HomeSkeleton extends StatelessWidget {
  const HomeSkeleton({super.key});

  @override
  Widget build(BuildContext context) => ListView(
    key: const ValueKey('home-skeleton'),
    physics: const NeverScrollableScrollPhysics(),
    padding: const EdgeInsets.symmetric(vertical: 12),
    children: const [
      _Block(height: 72),
      _Block(height: 32, width: 200),
      _Block(height: 96),
      _SkeletonRail(),
      _SkeletonRail(),
    ],
  );
}

class _SkeletonRail extends StatelessWidget {
  const _SkeletonRail();

  @override
  Widget build(BuildContext context) => const Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(height: 12),
      _Block(height: 20, width: 160),
      Row(
        children: [
          Expanded(child: _Block(height: 120)),
          Expanded(child: _Block(height: 120)),
        ],
      ),
    ],
  );
}

class _Block extends StatelessWidget {
  const _Block({required this.height, this.width});

  final double height;
  final double? width;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    child: Container(
      height: height,
      width: width,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
      ),
    ),
  );
}

/// 현재 쇼핑 주소. 누르면 주소 관리로 간다.
class _AddressChip extends ConsumerWidget {
  const _AddressChip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final member = ref.watch(sessionProvider) is MemberSession;
    final book = ref.watch(addressBookProvider).value;
    // 비회원도 비회원 배송지를 고르면 그 주소를 보인다.
    final text = switch (book?.shoppingAddress) {
      final a? => a.label ?? a.roadAddress,
      null => member ? l10n.homeAddressNone : l10n.homeAddressGuest,
    };
    return InkWell(
      key: const ValueKey('home-address'),
      onTap: () => context.push('/addresses'),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.place_rounded,
            size: 17,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: 3),
          Flexible(
            child: Text(
              text,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          const SizedBox(width: 2),
          const PmartLineIcon(PmartLineIcons.chevronDown, size: 17),
        ],
      ),
    );
  }
}

/// 앱을 다시 켰을 때 결과를 모르는 결제가 있으면 알린다. 결론은 결제 화면이 서버에서 확인한다.
class _PendingPaymentBanner extends ConsumerWidget {
  const _PendingPaymentBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final pending = ref.watch(pendingCheckoutsProvider).value ?? const [];
    if (pending.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Card(
        key: const ValueKey('pending-payment'),
        child: ListTile(
          leading: const Icon(Icons.payment),
          title: Text(l10n.pendingPaymentBanner),
          trailing: TextButton(
            onPressed: () => context.push('/payments/${pending.first}'),
            child: Text(l10n.pendingPaymentOpen),
          ),
        ),
      ),
    );
  }
}
