import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/ui_state_of.dart';
import '../domain/catalog.dart';
import 'catalog_providers.dart';
import '../../reviews/presentation/reviews_screens.dart'
    show ProductReviewsPreview;
import '../../cart/presentation/cart_screen.dart' show AddToCartBar;
import 'widgets/content_image.dart';
import 'widgets/product_tile_card.dart';

/// SCR-PRODUCT-001·OPTION-001. 가격·가용은 사본이다. 구매 가능 확정은 장바구니·주문서 서버 판정.
class ProductDetailScreen extends ConsumerStatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  ConsumerState<ProductDetailScreen> createState() =>
      _ProductDetailScreenState();
}

class _ProductDetailScreenState extends ConsumerState<ProductDetailScreen> {
  String? _selectedSku;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final provider = productDetailProvider(widget.productId);
    final value = ref.watch(provider);
    final notFound = switch (value) {
      AsyncError(error: ProblemFailure(:final problem)) =>
        problem.code == ProblemCode.notFound ||
            problem.code == 'CONTENT_NOT_PUBLISHED',
      _ => false,
    };
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            key: const ValueKey('detail-home'),
            visualDensity: VisualDensity.compact,
            tooltip: l10n.navHome,
            icon: const PmartLineIcon(PmartLineIcons.home, size: 23),
            onPressed: () => context.go('/'),
          ),
          IconButton(
            key: const ValueKey('detail-search'),
            visualDensity: VisualDensity.compact,
            tooltip: l10n.searchTitle,
            icon: const PmartLineIcon(PmartLineIcons.search, size: 23),
            onPressed: () => context.go('/search'),
          ),
          IconButton(
            key: const ValueKey('detail-cart'),
            visualDensity: VisualDensity.compact,
            tooltip: l10n.cartTitle,
            icon: const PmartLineIcon(PmartLineIcons.cart, size: 23),
            onPressed: () => context.go('/cart'),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: notFound
          ? Center(child: Text(l10n.productNotFound))
          : UiStateView<ProductDetail>(
              state: uiStateOf(value),
              onRetry: () => ref.invalidate(provider),
              ready: (context, p) => _body(context, l10n, p),
            ),
      bottomNavigationBar: switch (value) {
        AsyncData(value: final p) => Builder(
          builder: (context) {
            final selected = _selected(p);
            return AddToCartBar(
              sku: selected?.sku,
              enabled: selected?.canOfferAdd ?? false,
            );
          },
        ),
        _ => null,
      },
    );
  }

  SaleOption? _selected(ProductDetail p) =>
      p.options.where((o) => o.sku == _selectedSku).firstOrNull ??
      p.options.where((o) => o.canOfferAdd).firstOrNull;

  Widget _body(BuildContext context, AppLocalizations l10n, ProductDetail p) {
    final theme = Theme.of(context);
    final selected = _selected(p);
    final bodyTone = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final scheme = theme.colorScheme;
    final hasRating = p.rating?.average != null && p.rating?.count != null;
    // 사진 아래 내용(좌우 여백 16). 구획 띠([PmartSectionGap])만 화면 폭을 채운다.
    final rest = <Widget>[
      const SizedBox(height: 14),
      Text(
        p.name,
        style: theme.textTheme.titleLarge?.copyWith(
          fontSize: 17,
          height: 1.35,
          fontWeight: FontWeight.w400,
        ),
      ),
      const SizedBox(height: 10),
      // 평점 알약
      Align(
        alignment: Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: scheme.outlineVariant, width: 1.2),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasRating) ...[
                const Icon(
                  Icons.star_rounded,
                  size: 14,
                  color: Color(0xFFFFB300),
                ),
                const SizedBox(width: 3),
              ],
              Flexible(
                child: Text(
                  ratingText(l10n, p.rating?.average, p.rating?.count),
                  key: const ValueKey('product-rating'),
                  style: theme.textTheme.labelMedium?.copyWith(fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 16),
      // 옵션이 하나뿐이면 고를 것이 없으니 가격·재고만 보이고, 둘 이상일 때만 옵션 선택을 연다.
      if (p.options case [final only])
        _SingleOptionSummary(option: only)
      else ...[
        Text(l10n.productOptions, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        RadioGroup<String>(
          groupValue: selected?.sku,
          onChanged: (sku) => setState(() => _selectedSku = sku),
          child: Column(
            children: [
              for (final o in p.options)
                _OptionTile(option: o, selected: o.sku == selected?.sku),
            ],
          ),
        ),
      ],
      const SizedBox(height: 6),
      Text(l10n.priceNote, style: theme.textTheme.bodySmall),
      const SizedBox(height: 20),
      const PmartSectionGap(),
      const SizedBox(height: 20),
      // 리뷰 미리보기(GET /products/{id}/reviews). 실패는 "리뷰 없음"이 아니라 실패로 보인다.
      ProductReviewsPreview(productId: p.productId),
      if (p.description != null || p.descriptionImageUrls.isNotEmpty) ...[
        const _DetailDivider(),
        Text(l10n.productDescription, style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        if (p.description case final String d) Text(d, style: bodyTone),
        if (p.descriptionImageUrls.isNotEmpty) ...[
          const SizedBox(height: 8),
          // 롱이미지 조각은 sortOrder 순서로 간격 없이 이어 붙인다.
          for (final (i, url) in p.descriptionImageUrls.indexed)
            ContentImage(key: ValueKey('description-image-$i'), url: url),
        ],
      ],
      if (p.storageGuide case final String g) ...[
        const _DetailDivider(),
        Text(l10n.productStorageGuide, style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(g, style: bodyTone),
      ],
      if (p.returnGuide case final String g) ...[
        const _DetailDivider(),
        Text(l10n.productReturnGuide, style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(g, style: bodyTone),
      ],
      if (p.notices.isNotEmpty) ...[
        const _DetailDivider(),
        Text(l10n.productNotices, style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        for (final n in p.notices) Text('· $n', style: bodyTone),
      ],
      if (p.detailImageUrls.isNotEmpty) ...[
        const _DetailDivider(),
        Text(l10n.productDetailInfo, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final (i, url) in p.detailImageUrls.indexed)
          ContentImage(key: ValueKey('detail-image-$i'), url: url),
      ],
    ];
    // 위 사진 + 나머지 줄. 화면에 들어올 때 만든다(설명 이미지 여러 장을 처음에 다 만들지 않게 — 백엔드 요청 2026-11-19).
    Widget item(int i) {
      if (i == 0) {
        return LayoutBuilder(
          builder: (context, c) {
            final byHeight = MediaQuery.sizeOf(context).height * 0.5;
            return ProductImage(
              url: p.mainImageUrl,
              size: c.maxWidth,
              height: c.maxWidth < byHeight ? c.maxWidth : byHeight,

              radius: 0,
            );
          },
        );
      }
      final w = rest[i - 1];
      return w is PmartSectionGap
          ? w
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: w,
            );
    }

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: rest.length + 1,
      itemBuilder: (context, i) => item(i),
    );
  }
}

/// 묶음·용량·재고 상태 보조 문구. [withCapacity] 가 false 면 용량은 제목에서 이미 보인 것이다.
Iterable<String> _optionNotes(
  AppLocalizations l10n,
  SaleOption o, {
  bool withCapacity = true,
}) => [
  if (o.unitType == UnitType.bundle && o.unitsPerSku != null)
    l10n.unitBundle(o.unitsPerSku!),
  if (withCapacity) ?o.capacityLabel,
  switch (o.availability) {
    _ when o.carried == false => l10n.notCarried,
    Availability.soldOut => l10n.soldOutTemporarily,
    Availability.low => l10n.availabilityLow,
    Availability.unknown => l10n.saleStateUnknown,
    Availability.available => null,
  },
].nonNulls;

String _priceText(AppLocalizations l10n, SaleOption o) => switch (o) {
  SaleOption(priceNotSet: true) => l10n.priceNotSet,
  SaleOption(basePrice: final int price) => formatKrw(price),
  _ => l10n.priceUnavailable,
};

/// 옵션이 하나뿐인 상품: 선택 UI 없이 가격과 재고 상태만 보인다.
class _SingleOptionSummary extends StatelessWidget {
  const _SingleOptionSummary({required this.option});

  final SaleOption option;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final notes = _optionNotes(l10n, option).join(' · ');
    return Column(
      key: ValueKey('option-${option.sku}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _priceText(l10n, option),
          key: const ValueKey('product-price'),
          style: theme.textTheme.headlineMedium,
        ),
        if (notes.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              notes,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

/// 상세 구획 사이 선(위아래 여백 포함).
class _DetailDivider extends StatelessWidget {
  const _DetailDivider();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 20),
    child: Divider(),
  );
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({required this.option, required this.selected});

  final SaleOption option;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final o = option;
    // 라벨이 없으면 용량, 그것도 없으면 "기본". SKU 코드는 보이지 않는다.
    final title = o.label ?? o.capacityLabel ?? l10n.optionDefault;
    final notes = _optionNotes(
      l10n,
      o,
      withCapacity: o.label != null,
    ).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        clipBehavior: Clip.antiAlias,
        color: selected ? scheme.surfaceContainer : scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: RadioListTile<String>(
          key: ValueKey('option-${o.sku}'),
          value: o.sku,
          enabled: o.canOfferAdd,
          contentPadding: const EdgeInsets.only(left: 4, right: 16),
          title: Text(title),
          subtitle: notes.isEmpty ? null : Text(notes),
          secondary: Text(
            _priceText(l10n, o),
            style: theme.textTheme.titleMedium,
          ),
        ),
      ),
    );
  }
}
