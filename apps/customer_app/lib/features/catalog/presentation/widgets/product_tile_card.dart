import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/providers.dart';
import '../../domain/catalog.dart';
import 'quick_add_button.dart';

/// 상품 이미지. 주소가 없거나 받지 못하면 자리표시를 그린다.
class ProductImage extends ConsumerWidget {
  const ProductImage({
    super.key,
    this.url,
    this.size = 72,
    this.radius = 12,
    this.height,
  });

  final String? url;

  /// 폭(정사각형이면 높이도). 높이를 따로 주려면 [height].
  final double size;
  final double radius;
  final double? height;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final h = height ?? size;
    final placeholder = Container(
      width: size,
      height: h,
      color: scheme.surfaceContainerHigh,
      child: Icon(
        Icons.image_outlined,
        size: ((h < size ? h : size) / 3).clamp(20, 56).toDouble(),
        color: scheme.outline.withValues(alpha: 0.6),
      ),
    );
    // 서버 이미지는 상대 경로라 게이트웨이 주소를 붙여야 받을 수 있다.
    // 서버 축소본: 그릴 크기(긴 변 × 화소 비율)에 맞는 240·480·720(백엔드 요청 R3).
    final px = (size > h ? size : h) * MediaQuery.devicePixelRatioOf(context);
    final u = resolveImageUrl(
      withImageWidth(url, px),
      ref.watch(imageOriginProvider),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: u == null
          ? placeholder
          : Image.network(
              u,
              width: size,
              height: h,
              fit: BoxFit.cover,
              // 원본(예 1080px)을 그대로 풀지 않고 그릴 크기만큼만 디코딩한다(백엔드 요청 2026-11-19 — 메모리·속도).
              // 채우기(cover)라 긴 변 기준으로 잡는다.
              cacheWidth:
                  ((size > h ? size : h) *
                          MediaQuery.devicePixelRatioOf(context))
                      .round(),
              errorBuilder: (_, _, _) => placeholder,
            ),
    );
  }
}

/// 평점·리뷰 수. 집계가 없으면 "평점 정보 없음"(0점·0건으로 바꾸지 않는다).
String ratingText(AppLocalizations l10n, double? rating, int? count) =>
    (rating == null || count == null)
    ? l10n.ratingUnavailable
    : l10n.ratingValue(
        rating.toStringAsFixed(1),
        NumberFormat.decimalPattern('ko').format(count),
      );

/// 평점 한 줄(별 + 글자). 집계가 없으면 글자만.
class RatingLine extends StatelessWidget {
  const RatingLine({super.key, this.rating, this.count});

  final double? rating;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final text = Text(
      ratingText(l10n, rating, count),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: theme.textTheme.bodySmall?.copyWith(fontSize: 11.5),
    );
    if (rating == null || count == null) return text;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.star_rounded,
          size: MediaQuery.textScalerOf(context).scale(13),
          color: const Color(0xFFFFB300),
        ),
        const SizedBox(width: 2),
        Flexible(child: text),
      ],
    );
  }
}

class ProductTileCard extends StatelessWidget {
  const ProductTileCard({
    super.key,
    required this.tile,
    this.onTap,
    this.quickAdd = true,
    this.rail = false,
  });

  final ProductTile tile;
  final VoidCallback? onTap;

  /// 이미지 위 `+` 바로 담기. 담을 수 있어 보이는 카드에만 보인다([QuickAddButton.offeredFor]).
  final bool quickAdd;

  /// 가로 진열용(사진 위, 글자 아래). false 면 세로 목록용(사진 왼쪽).
  final bool rail;

  /// 가로 진열 카드 폭(레퍼런스: 360dp 에 세 장 반, 한 장 약 97dp). 사진은 칸 폭을 채운 정사각형이다.
  static double railWidthOf(BuildContext context) =>
      ((MediaQuery.sizeOf(context).width - 14 - 8 * 3) / 3.3)
          .clamp(94, 132)
          .toDouble();

  /// 2칸 격자의 한 칸 폭(좌우 여백 16, 칸 사이 12).
  static double gridWidthOf(BuildContext context) =>
      (MediaQuery.sizeOf(context).width - 16 * 2 - 12) / 2;

  /// 칸 폭 [width] 인 카드 한 장의 높이. 사진 + 이름 2줄·가격·평점·상태 문구가 들어가는 높이에
  /// 기기 글자 크기 설정을 반영한다.
  static double heightFor(BuildContext context, double width) =>
      width +
      8 +
      MediaQuery.textScalerOf(context).scale(102).clamp(102, 240).toDouble();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final dimmed = !tile.canOfferAdd;
    final status = switch ((tile.saleState, tile.carried)) {
      (SaleState.temporarilySoldOut, _) => l10n.soldOutTemporarily,
      (_, false) => l10n.notCarried,
      (SaleState.unknown, _) => l10n.saleStateUnknown,
      _ => null,
    };
    final badge = switch (tile.badge) {
      DisplayBadge.isNew => _CornerBadge(l10n.badgeNew),
      DisplayBadge.rank when tile.rank != null => _CornerBadge(
        l10n.badgeRank(tile.rank!),
      ),
      _ => null,
    };
    // 담기 버튼은 카드(상세 이동)와 따로 눌린다 — 상세 이동이 담기로 실행되지 않는다.
    Widget imageOf(double size) => Stack(
      children: [
        DecoratedBox(
          position: DecorationPosition.foreground,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: theme.colorScheme.outlineVariant,
              width: 0.8,
            ),
          ),
          child: ProductImage(url: tile.imageUrl, size: size, radius: 8),
        ),
        // 품절·미취급은 사진을 어둡게 덮고 가운데에 상태를 적는다(레퍼런스 "다 팔렸어요").
        // 칸 카드는 높이가 고정이라 상태 문구를 아래 줄에 더하지 않는다 — 더하면 아래가 넘친다(BOTTOM OVERFLOWED).
        if (rail && status != null)
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.38),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Text(
                    status,
                    key: ValueKey('tile-status-${tile.productId}'),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (badge != null) Positioned(left: 0, top: 0, child: badge),
        if (quickAdd && QuickAddButton.offeredFor(tile))
          Positioned(right: 5, bottom: 5, child: QuickAddButton(tile: tile)),
      ],
    );
    final info = <Widget>[
      Text(
        tile.name,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.bodyMedium?.copyWith(fontSize: 13, height: 1.3),
      ),
      const SizedBox(height: 4),
      Text(
        switch (tile.basePrice) {
          final int p => formatKrw(p),
          null => l10n.priceUnavailable,
        },
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.titleMedium?.copyWith(
          fontSize: 14.5,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 2),
      RatingLine(rating: tile.rating, count: tile.reviewCount),
      // 세로 목록(높이 고정 아님)만 아래 줄에 상태를 적는다. 칸 카드는 사진 위에 적었다.
      if (status != null && !rail) ...[
        const SizedBox(height: 4),
        Text(
          status,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.error,
          ),
        ),
      ],
    ];
    return InkWell(
      key: ValueKey('tile-${tile.productId}'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Opacity(
        opacity: dimmed ? 0.55 : 1,
        child: rail
            ? LayoutBuilder(
                builder: (context, c) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    imageOf(c.maxWidth),
                    const SizedBox(height: 8),
                    ...info,
                  ],
                ),
              )
            : Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    imageOf(96),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: info,
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

/// 사진 왼쪽 위 모서리에 붙는 꼬리표(NEW·순위).
class _CornerBadge extends StatelessWidget {
  const _CornerBadge(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(8),
          bottomRight: Radius.circular(6),
        ),
      ),
      child: Text(
        text,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onPrimary,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          height: 1.1,
        ),
      ),
    );
  }
}
