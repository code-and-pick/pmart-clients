import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart' show ProblemCode;
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers.dart'
    show imageOriginProvider, resolveImageUrl;
import '../../../shared/ui_state_of.dart';
import '../../address/presentation/address_screens.dart' show LoginRequired;
import '../../auth/domain/auth.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../catalog/presentation/catalog_providers.dart'
    show productDetailProvider;
import '../../claims/presentation/claims_controller.dart'
    show CommandDone, CommandOutcome, CommandRejected, CommandUnknown;
import '../domain/reviews.dart';
import 'reviews_controller.dart';

/// 별점 표시(읽기 전용).
class ReviewStars extends StatelessWidget {
  const ReviewStars({super.key, required this.rating, this.size = 16});

  final int rating;
  final double size;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Semantics(
      label: l10n.reviewStar(rating),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 1; i <= reviewRatingMax; i++)
            Icon(
              i <= rating ? Icons.star : Icons.star_border,
              size: size,
              color: Theme.of(context).colorScheme.primary,
            ),
        ],
      ),
    );
  }
}

/// 상품 이름. 주문 당시 사본([title])이 있으면 그것을, 없으면 상품 정보를 조회한다. 실패는 실패 문구로 보인다.
class _ProductName extends ConsumerWidget {
  const _ProductName({this.productId, this.title, this.style});

  final String? productId;
  final String? title;
  final TextStyle? style;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    if (title case final t?) return Text(t, style: style);
    final id = productId;
    if (id == null) return Text(l10n.reviewProductFailed, style: style);
    return Text(switch (ref.watch(productDetailProvider(id))) {
      AsyncData(:final value) => value.name,
      AsyncError() => l10n.reviewProductFailed,
      _ => l10n.reviewProductLoading,
    }, style: style);
  }
}

Future<void> openReviewWrite(BuildContext context, ReviewTarget target) =>
    context.push('/reviews/write', extra: target);

/// 작성·등록 뒤 다시 읽어야 하는 목록들.
void invalidateReviewLists(WidgetRef ref, ReviewTarget target) {
  ref.invalidate(writableReviewsProvider);
  ref.invalidate(myReviewsProvider);
  ref.invalidate(orderReviewEligibilitiesProvider(target.orderId));
  if (target.productId case final p?) {
    ref.invalidate(productReviewsProvider(p));
  }
}

/// SCR-REVIEW-LIST-001. 리뷰 쓰기(작성 가능 품목) / 내가 쓴 리뷰. 정상 0건과 조회 실패를 구분한다.
class ReviewManageScreen extends ConsumerWidget {
  const ReviewManageScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final member = ref.watch(sessionProvider) is MemberSession;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.reviewManageTitle),
          bottom: member
              ? TabBar(
                  tabs: [
                    Tab(
                      key: const ValueKey('review-tab-write'),
                      text: l10n.reviewTabWrite,
                    ),
                    Tab(
                      key: const ValueKey('review-tab-mine'),
                      text: l10n.reviewTabMine,
                    ),
                  ],
                )
              : null,
        ),
        // 비회원은 조회하지 않고 로그인 안내만 보인다.
        body: member
            ? const TabBarView(children: [_WritableTab(), _MineTab()])
            : LoginRequired(message: l10n.reviewLoginNeeded),
      ),
    );
  }
}

class _LoadMoreFooter extends StatelessWidget {
  const _LoadMoreFooter({required this.list, required this.onLoadMore});

  final PagedList<Object?> list;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (!list.hasMore && list.loadMoreFailure == null) {
      return const SizedBox.shrink();
    }
    return Column(
      children: [
        if (list.loadMoreFailure != null)
          Text(
            l10n.reviewLoadMoreFailed,
            key: const ValueKey('review-load-more-failed'),
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        if (list.hasMore)
          TextButton(
            key: const ValueKey('review-load-more'),
            onPressed: list.loadingMore ? null : onLoadMore,
            child: Text(l10n.loadMore),
          ),
      ],
    );
  }
}

class _WritableTab extends ConsumerWidget {
  const _WritableTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(writableReviewsProvider);
    return UiStateView<PagedList<ReviewEligibility>?>(
      state: uiStateOf(value, isEmpty: (p) => p == null || p.items.isEmpty),
      onRetry: () => ref.invalidate(writableReviewsProvider),
      empty: (_) => Center(
        key: const ValueKey('review-writable-empty'),
        child: Text(l10n.reviewWritableEmpty),
      ),
      ready: (context, list) => RefreshIndicator(
        onRefresh: () => ref.refresh(writableReviewsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            for (final e in list!.items) _WritableCard(eligibility: e),
            _LoadMoreFooter(
              list: list,
              onLoadMore: () =>
                  ref.read(writableReviewsProvider.notifier).loadMore(),
            ),
          ],
        ),
      ),
    );
  }
}

/// 작성 가능 품목 카드. 별을 누르면 그 별점으로 작성 화면을 연다(레퍼런스의 흐름).
class _WritableCard extends ConsumerWidget {
  const _WritableCard({required this.eligibility});

  final ReviewEligibility eligibility;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final e = eligibility;
    Future<void> open([int? rating]) async {
      final target = ReviewTarget.of(e, initialRating: rating);
      await openReviewWrite(context, target);
    }

    return Card(
      key: ValueKey('review-writable-${e.orderLineId}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 4, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _ProductName(
                        productId: e.productId,
                        title: e.productName,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        [
                          if (e.deliveredAt case final t?)
                            l10n.reviewDeliveredAt(formatSeoulDateTime(t)),
                          // 기한은 서버 eligibleUntil 을 그대로 보인다(남은 일수를 앱이 세지 않는다).
                          if (e.eligibleUntil case final t?)
                            l10n.reviewDeadline(formatSeoulDateTime(t)),
                        ].join(' · '),
                        key: ValueKey('review-deadline-${e.orderLineId}'),
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                TextButton(
                  key: ValueKey('review-write-${e.orderLineId}'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                  onPressed: () => open(),
                  child: Text(l10n.reviewWrite),
                ),
              ],
            ),
          ),
          const Divider(),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 1; i <= reviewRatingMax; i++)
                  IconButton(
                    key: ValueKey('review-quick-star-${e.orderLineId}-$i'),
                    tooltip: l10n.reviewStar(i),
                    iconSize: 32,
                    color: theme.colorScheme.surfaceContainerHighest,
                    icon: const Icon(Icons.star_rounded),
                    onPressed: () => open(i),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MineTab extends ConsumerWidget {
  const _MineTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(myReviewsProvider);
    return UiStateView<PagedList<ReviewEligibility>?>(
      state: uiStateOf(value, isEmpty: (p) => p == null || p.items.isEmpty),
      onRetry: () => ref.invalidate(myReviewsProvider),
      empty: (_) => Center(
        key: const ValueKey('review-mine-empty'),
        child: Text(l10n.reviewMineEmpty),
      ),
      ready: (context, list) => RefreshIndicator(
        onRefresh: () => ref.refresh(myReviewsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            for (final e in list!.items) _MyReviewCard(eligibility: e),
            _LoadMoreFooter(
              list: list,
              onLoadMore: () => ref.read(myReviewsProvider.notifier).loadMore(),
            ),
          ],
        ),
      ),
    );
  }
}

String reviewStateText(AppLocalizations l10n, ReviewState s) => switch (s) {
  ReviewState.published => l10n.reviewStatePublished,
  ReviewState.submitPending => l10n.reviewStatePending,
  ReviewState.locked => l10n.reviewStateLocked,
  _ => l10n.reviewStateOther,
};

class _MyReviewCard extends ConsumerWidget {
  const _MyReviewCard({required this.eligibility});

  final ReviewEligibility eligibility;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final id = eligibility.reviewId!;
    final provider = reviewProvider(id);
    final value = ref.watch(provider);
    return Card(
      key: ValueKey('review-mine-$id'),
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: ValueKey('review-mine-open-$id'),
        // 리뷰 하나 화면(수정·삭제). 작성자 ID 가 응답에 없어 "내가 쓴 리뷰"에서만 연다.
        onTap: () => context.push('/reviews/mine/$id', extra: eligibility),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ProductName(
                productId: eligibility.productId,
                title: eligibility.productName,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              switch (value) {
                AsyncData(value: final r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ReviewStars(rating: r.rating),
                        const SizedBox(width: 8),
                        Text(
                          reviewStateText(l10n, r.state),
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                    Text(
                      l10n.reviewWrittenAt(formatSeoulDateTime(r.createdAt)),
                      style: theme.textTheme.bodySmall,
                    ),
                    if (r.text case final t? when t.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(t),
                      ),
                    _ReviewPhotos(review: r),
                  ],
                ),
                AsyncError() => Row(
                  key: ValueKey('review-mine-failed-$id'),
                  children: [
                    Expanded(
                      child: Text(
                        l10n.reviewLoadFailed,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ),
                    TextButton(
                      onPressed: () => ref.invalidate(provider),
                      child: Text(l10n.reviewRetry),
                    ),
                  ],
                ),
                _ => const LinearProgressIndicator(),
              },
            ],
          ),
        ),
      ),
    );
  }
}

/// 수정 화면에 넘기는 것: 지금 리뷰(서버 값·version)와 상품 표시.
@immutable
class ReviewEditTarget {
  const ReviewEditTarget({
    required this.review,
    this.productId,
    this.title,
    this.orderId,
  });

  final ReviewView review;
  final String? productId;
  final String? title;
  final String? orderId;
}

/// 수정·삭제 뒤 다시 읽어야 하는 것들.
void _invalidateAfterChange(
  WidgetRef ref,
  String reviewId, {
  String? productId,
  String? orderId,
}) {
  ref.invalidate(reviewProvider(reviewId));
  ref.invalidate(myReviewsProvider);
  ref.invalidate(writableReviewsProvider);
  if (orderId != null) {
    ref.invalidate(orderReviewEligibilitiesProvider(orderId));
  }
  if (productId != null) ref.invalidate(productReviewsProvider(productId));
}

/// 내가 쓴 리뷰 하나(`GET /reviews/{id}`) + 수정·삭제(백엔드 요청 2026-11-16 review-edit-delete §1).
/// - 수정: 서버 상태 PUBLISHED 일 때만. LOCKED 면 막고 안내, 기한은 서버 `editableUntil` 그대로.
/// - 삭제: 확인 창("다시 쓸 수 없어요") 뒤 보낸다. 결과 불명이면 같은 키로만 "다시 확인".
class MyReviewScreen extends ConsumerStatefulWidget {
  const MyReviewScreen({super.key, required this.reviewId, this.eligibility});

  final String reviewId;
  final ReviewEligibility? eligibility;

  @override
  ConsumerState<MyReviewScreen> createState() => _MyReviewScreenState();
}

class _MyReviewScreenState extends ConsumerState<MyReviewScreen> {
  final _delete = KeptReviewCommand<void>();
  bool _busy = false;
  CommandOutcome<void>? _deleteOutcome;

  Future<void> _sendDelete() async {
    if (_busy) return;
    setState(() => _busy = true);
    final repo = ref.read(reviewsRepositoryProvider);
    final outcome = await _delete.run(
      (key) => repo.delete(widget.reviewId, key: key),
    );
    if (!mounted) return;
    if (outcome is CommandDone<void>) {
      _invalidateAfterChange(
        ref,
        widget.reviewId,
        productId: widget.eligibility?.productId,
        orderId: widget.eligibility?.orderId,
      );
    }
    setState(() {
      _busy = false;
      _deleteOutcome = outcome;
    });
  }

  Future<void> _confirmDelete() async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('review-delete-confirm'),
        title: Text(l10n.reviewDeleteConfirmTitle),
        content: Text(l10n.reviewDeleteConfirmBody),
        actions: [
          TextButton(
            key: const ValueKey('review-delete-cancel'),
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.reviewCancel),
          ),
          TextButton(
            key: const ValueKey('review-delete-ok'),
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.reviewDelete),
          ),
        ],
      ),
    );
    if (ok == true && mounted) await _sendDelete();
  }

  Future<void> _openEdit(ReviewView r) async {
    final e = widget.eligibility;
    await context.push(
      '/reviews/mine/${widget.reviewId}/edit',
      extra: ReviewEditTarget(
        review: r,
        productId: e?.productId ?? r.productId,
        title: e?.productName,
        orderId: e?.orderId,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final provider = reviewProvider(widget.reviewId);
    final outcome = _deleteOutcome;
    if (outcome is CommandDone<void>) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.reviewMineTitle)),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                l10n.reviewDeletedDone,
                key: const ValueKey('review-delete-done'),
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('review-delete-done-ok'),
                onPressed: () => context.pop(),
                child: Text(l10n.reviewDone),
              ),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(l10n.reviewMineTitle)),
      body: UiStateView<ReviewView>(
        state: uiStateOf(ref.watch(provider)),
        onRetry: () => ref.invalidate(provider),
        ready: (context, r) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _ProductName(
              productId: widget.eligibility?.productId ?? r.productId,
              title: widget.eligibility?.productName,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                ReviewStars(rating: r.rating, size: 20),
                const SizedBox(width: 8),
                Text(
                  reviewStateText(l10n, r.state),
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
            Text(
              l10n.reviewWrittenAt(formatSeoulDateTime(r.createdAt)),
              style: theme.textTheme.bodySmall,
            ),
            if (r.text case final t? when t.isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(t)),
            _ReviewPhotos(review: r),
            const SizedBox(height: 16),
            // 수정 기한·잠김은 서버 값(state·editableUntil)으로만. 앱이 날짜를 세지 않는다.
            if (r.state == ReviewState.deleted)
              Text(
                l10n.reviewDeletedNotice,
                key: const ValueKey('review-deleted-notice'),
                style: theme.textTheme.bodySmall,
              )
            else if (r.editable && r.editableUntil != null)
              Text(
                l10n.reviewEditableUntil(formatSeoulDateTime(r.editableUntil!)),
                key: const ValueKey('review-editable-until'),
                style: theme.textTheme.bodySmall,
              )
            else if (r.state == ReviewState.locked)
              Text(
                l10n.reviewLockedNotice,
                key: const ValueKey('review-locked-notice'),
                style: theme.textTheme.bodySmall,
              ),
            const SizedBox(height: 12),
            switch (outcome) {
              CommandRejected(:final code) => Text(
                code == ProblemCode.notFound
                    ? l10n.reviewRejectedNotFound
                    : l10n.reviewDeleteRejected,
                key: const ValueKey('review-delete-rejected'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              CommandUnknown() => Row(
                key: const ValueKey('review-delete-unknown'),
                children: [
                  Expanded(child: Text(l10n.reviewDeleteUnknown)),
                  TextButton(
                    key: const ValueKey('review-delete-recheck'),
                    onPressed: _busy ? null : _sendDelete,
                    child: Text(l10n.reviewRecheck),
                  ),
                ],
              ),
              _ => const SizedBox.shrink(),
            },
            if (_busy)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(l10n.reviewDeleting),
              ),
            if (r.deletable)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const ValueKey('review-delete'),
                        // 결과를 모르는 삭제가 있으면 새로 누르지 않고 "다시 확인"만(같은 키).
                        onPressed: _busy || _delete.pending
                            ? null
                            : _confirmDelete,
                        child: Text(l10n.reviewDelete),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        key: const ValueKey('review-edit'),
                        onPressed: !r.editable || _busy || _delete.pending
                            ? null
                            : () => _openEdit(r),
                        child: Text(l10n.reviewEdit),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 리뷰 수정(`PATCH /reviews/{id}`, `X-Expected-Version` = 지금 version). 바뀐 것만 보낸다.
/// - 사진: 붙은 사진은 그대로 칸에 두고, 새 사진은 작성 때처럼 먼저 올린다. 사진이 그대로면 photoIds 를 빼고 보낸다.
/// - 결과: 고침(응답으로 화면을 바꾼다) / 거절(3일 지남·먼저 고침·사진 확인 불가) / 확인 중(같은 키·같은 본문으로만 다시).
class ReviewEditScreen extends ConsumerStatefulWidget {
  const ReviewEditScreen({super.key, required this.target});

  final ReviewEditTarget target;

  @override
  ConsumerState<ReviewEditScreen> createState() => _ReviewEditScreenState();
}

class _ReviewEditScreenState extends ConsumerState<ReviewEditScreen>
    with _ReviewPhotoSlots<ReviewEditScreen> {
  final _command = KeptReviewCommand<ReviewView>();
  late final ReviewView _original = widget.target.review;
  late final _text = TextEditingController(text: _original.text ?? '');
  late int _rating = _original.rating;
  bool _busy = false;
  CommandOutcome<ReviewView>? _outcome;

  @override
  void initState() {
    super.initState();
    _photos = [for (final p in _original.photos) ReviewPhotoSlot.existing(p)];
    _text.addListener(_onText);
  }

  void _onText() => setState(() {});

  @override
  void dispose() {
    _text
      ..removeListener(_onText)
      ..dispose();
    super.dispose();
  }

  ReviewChanges? get _changes => reviewChanges(
    _original,
    rating: _rating,
    text: _text.text.trim(),
    photoIds: [for (final p in _photos) ?p.photoId],
  );

  Future<void> _save() async {
    final changes = _changes;
    final version = _original.version;
    if (_busy || version == null) return;
    // "다시 확인"(보관 중)은 처음 본문 그대로 보낸다 — 아래 changes 는 쓰지 않는다.
    if (!_command.pending && (changes == null || !_photosReady)) return;
    setState(() => _busy = true);
    final repo = ref.read(reviewsRepositoryProvider);
    final outcome = await _command.run(
      (key) => repo.update(
        _original.reviewId,
        expectedVersion: version,
        rating: changes?.rating,
        text: changes?.text,
        photoIds: changes?.photoIds,
        key: key,
      ),
    );
    if (!mounted) return;
    final t = widget.target;
    if (outcome is CommandDone<ReviewView> || _needsReload(outcome)) {
      // 고쳤거나 서버 상태가 바뀌었다 — 상세를 다시 읽게 한다.
      _invalidateAfterChange(
        ref,
        _original.reviewId,
        productId: t.productId,
        orderId: t.orderId,
      );
    }
    setState(() {
      _busy = false;
      _outcome = outcome;
    });
  }

  /// 서버 상태가 바뀌어(3일 지남·삭제·먼저 고침) 이 입력으로는 더 보낼 수 없다 — 다시 읽어야 한다.
  static bool _needsReload(CommandOutcome<ReviewView>? o) => switch (o) {
    CommandRejected(
      code: ReviewProblemCode.invalidState || ReviewProblemCode.versionConflict,
    ) =>
      true,
    _ => false,
  };

  String _rejectText(AppLocalizations l10n, String code) => switch (code) {
    ReviewProblemCode.invalidState => l10n.reviewRejectedLocked,
    ReviewProblemCode.versionConflict => l10n.reviewRejectedVersion,
    ReviewProblemCode.photoNotFound => l10n.reviewRejectedPhotoNotFound,
    ProblemCode.notFound => l10n.reviewRejectedNotFound,
    _ => l10n.reviewEditRejected,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final t = widget.target;
    final outcome = _outcome;
    if (outcome case CommandDone(value: final r)) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.reviewEditTitle)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  l10n.reviewSaved,
                  key: const ValueKey('review-edit-done'),
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                ReviewStars(rating: r.rating, size: 24),
                const SizedBox(height: 16),
                FilledButton(
                  key: const ValueKey('review-edit-ok'),
                  onPressed: () => context.pop(),
                  child: Text(l10n.reviewDone),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final locked = _busy || _command.pending;
    final changes = _changes;
    final reload = _needsReload(outcome);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.reviewEditTitle),
        leading: IconButton(
          key: const ValueKey('review-edit-close'),
          icon: const Icon(Icons.close),
          tooltip: l10n.reviewCancel,
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ProductName(
            productId: t.productId,
            title: t.title,
            style: theme.textTheme.titleMedium,
          ),
          if (_original.editableUntil case final u?)
            Text(
              l10n.reviewEditableUntil(formatSeoulDateTime(u)),
              style: theme.textTheme.bodySmall,
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              for (var i = 1; i <= reviewRatingMax; i++)
                IconButton(
                  key: ValueKey('review-star-$i'),
                  tooltip: l10n.reviewStar(i),
                  iconSize: 36,
                  color: theme.colorScheme.primary,
                  icon: Icon(i <= _rating ? Icons.star : Icons.star_border),
                  onPressed: locked ? null : () => setState(() => _rating = i),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('review-text'),
            controller: _text,
            enabled: !locked,
            minLines: 5,
            maxLines: 10,
            maxLength: reviewTextMaxLength,
            decoration: InputDecoration(
              hintText: l10n.reviewTextHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 4),
          _photoSection(context, locked: locked),
          const SizedBox(height: 16),
          switch (outcome) {
            CommandRejected(:final code) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _rejectText(l10n, code),
                  key: const ValueKey('review-edit-rejected'),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
                if (reload)
                  TextButton(
                    key: const ValueKey('review-edit-reload'),
                    // 상세로 돌아가 서버 값(상태·version)을 다시 읽는다.
                    onPressed: () => context.pop(),
                    child: Text(l10n.reviewReload),
                  ),
              ],
            ),
            CommandUnknown() => Row(
              key: const ValueKey('review-edit-unknown'),
              children: [
                Expanded(child: Text(l10n.reviewEditUnknown)),
                TextButton(
                  key: const ValueKey('review-edit-recheck'),
                  onPressed: _busy ? null : _save,
                  child: Text(l10n.reviewRecheck),
                ),
              ],
            ),
            _ => const SizedBox.shrink(),
          },
          if (_busy)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(l10n.reviewSaving),
            )
          else if (changes == null && outcome == null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l10n.reviewNoChanges,
                key: const ValueKey('review-edit-no-changes'),
                style: theme.textTheme.bodySmall,
              ),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => context.pop(),
                  child: Text(l10n.reviewCancel),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  key: const ValueKey('review-save'),
                  // 바뀐 것이 없으면 보내지 않는다(서버 400). 사진이 다 올라가기 전·확인 중·먼저 고침/잠김 뒤에도 막는다.
                  onPressed:
                      locked || changes == null || !_photosReady || reload
                      ? null
                      : _save,
                  child: Text(l10n.reviewSave),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// SCR-REVIEW-EDIT-001(작성). 별점 → 본문(계약 최대 1,000자) → 사진(리뷰당 5장, review 0.2.0).
/// 사진은 고르면 바로 한 장씩 올린다(칸마다 자기 키). 못 올린 사진이 있으면 등록을 막고 다시 올리기·빼기를 묻는다
/// — 올라간 사진만 몰래 보내지 않는다(백엔드 알림 2026-11-16 review-service §3). 사진 실패와 리뷰 등록 실패는 따로 보인다.
/// 등록 결과는 서버 응답으로만 보인다: 등록됨 / 거절(코드별 안내) / 확인 중(같은 키로만 다시 확인).
class ReviewWriteScreen extends ConsumerStatefulWidget {
  const ReviewWriteScreen({super.key, required this.target});

  final ReviewTarget target;

  @override
  ConsumerState<ReviewWriteScreen> createState() => _ReviewWriteScreenState();
}

/// 작성·수정 화면이 같이 쓰는 사진 칸 다루기: 고르면 바로 한 장씩 올리고(칸마다 자기 키), 결과 불명은 같은 키로 다시, 거절은 빼기.
mixin _ReviewPhotoSlots<W extends ConsumerStatefulWidget> on ConsumerState<W> {
  List<ReviewPhotoSlot> _photos = const [];
  bool _pickFailed = false;

  bool get _photosReady =>
      _photos.every((p) => p.status == ReviewPhotoStatus.uploaded);

  Future<void> _addPhotos() async {
    final l10n = AppLocalizations.of(context);
    final source = await showModalBottomSheet<ReviewPhotoSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const ValueKey('review-photo-gallery'),
              title: Text(l10n.reviewPhotoFromGallery),
              onTap: () => Navigator.pop(context, ReviewPhotoSource.gallery),
            ),
            ListTile(
              key: const ValueKey('review-photo-camera'),
              title: Text(l10n.reviewPhotoFromCamera),
              onTap: () => Navigator.pop(context, ReviewPhotoSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final room = reviewPhotoMax - _photos.length;
    if (room <= 0) return;
    final List<ReviewPhotoFile> files;
    try {
      files = await ref.read(reviewPhotoPickerProvider)(source, room);
    } on Object {
      // 권한 거절 등. 파일 내용·경로는 남기지 않는다.
      if (mounted) setState(() => _pickFailed = true);
      return;
    }
    if (!mounted || files.isEmpty) return;
    final added = [for (final f in files.take(room)) ReviewPhotoSlot.picked(f)];
    setState(() {
      _pickFailed = false;
      _photos = [..._photos, ...added];
    });
    for (final slot in added) {
      unawaited(_upload(slot));
    }
  }

  Future<void> _upload(ReviewPhotoSlot slot) async {
    final result = await uploadReviewPhoto(
      ref.read(reviewsRepositoryProvider),
      slot,
    );
    if (!mounted) return;
    setState(() {
      _photos = [for (final p in _photos) identical(p, slot) ? result : p];
    });
  }

  /// 결과를 모르는 사진은 같은 키로 다시 올린다(서버가 같은 photoId 를 준다).
  void _retryPhoto(ReviewPhotoSlot slot) {
    final again = slot.copyWith(status: ReviewPhotoStatus.uploading);
    setState(() {
      _photos = [for (final p in _photos) identical(p, slot) ? again : p];
    });
    unawaited(_upload(again));
  }

  void _removePhoto(ReviewPhotoSlot slot) => setState(() {
    _photos = [
      for (final p in _photos)
        if (!identical(p, slot)) p,
    ];
  });

  /// 사진 칸 + 고르기 실패·처리 필요·올리는 중 안내.
  Widget _photoSection(BuildContext context, {required bool locked}) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _PhotoRow(
          photos: _photos,
          locked: locked,
          onAdd: _addPhotos,
          onRetry: _retryPhoto,
          onRemove: _removePhoto,
        ),
        if (_pickFailed)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.reviewPhotoPickFailed,
              key: const ValueKey('review-photo-pick-failed'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        if (_photos.any(
          (p) =>
              p.status == ReviewPhotoStatus.unknown ||
              p.status == ReviewPhotoStatus.rejected,
        ))
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.reviewPhotoNeedsAction,
              key: const ValueKey('review-photo-needs-action'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          )
        else if (_photos.any((p) => p.status == ReviewPhotoStatus.uploading))
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.reviewPhotoUploading,
              key: const ValueKey('review-photo-uploading'),
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

class _ReviewWriteScreenState extends ConsumerState<ReviewWriteScreen>
    with _ReviewPhotoSlots<ReviewWriteScreen> {
  late final ReviewSubmitter _submitter = ReviewSubmitter(
    ref.read(reviewsRepositoryProvider),
    widget.target,
  );
  final _text = TextEditingController();
  late int? _rating = widget.target.initialRating;
  bool _busy = false;
  CommandOutcome<ReviewView>? _outcome;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final rating = _rating;
    if (rating == null || _busy || !_photosReady) return;
    setState(() => _busy = true);
    final text = _text.text.trim();
    final outcome = await _submitter.submit(
      rating: rating,
      text: text.isEmpty ? null : text,
      photoIds: [for (final p in _photos) ?p.photoId],
    );
    if (!mounted) return;
    if (outcome is CommandDone<ReviewView>) {
      invalidateReviewLists(ref, widget.target);
    }
    setState(() {
      _busy = false;
      _outcome = outcome;
    });
  }

  String _rejectText(AppLocalizations l10n, String code) => switch (code) {
    ReviewProblemCode.notEligible => l10n.reviewRejectedNotEligible,
    ReviewProblemCode.eligibilityExpired => l10n.reviewRejectedExpired,
    ReviewProblemCode.alreadyReviewed => l10n.reviewRejectedAlready,
    ReviewProblemCode.rewriteAfterDeleteForbidden => l10n.reviewRejectedDeleted,
    ReviewProblemCode.photoNotFound => l10n.reviewRejectedPhotoNotFound,
    _ => l10n.reviewRejected,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final member = ref.watch(sessionProvider) is MemberSession;
    final t = widget.target;
    final outcome = _outcome;
    if (!member) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.reviewWrite)),
        body: LoginRequired(message: l10n.reviewLoginNeeded),
      );
    }
    if (outcome case CommandDone(value: final r)) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.reviewWrite)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  r.state == ReviewState.submitPending
                      ? l10n.reviewSubmitPending
                      : l10n.reviewPublished,
                  key: const ValueKey('review-result-done'),
                  style: theme.textTheme.titleMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                ReviewStars(rating: r.rating, size: 24),
                const SizedBox(height: 16),
                FilledButton(
                  key: const ValueKey('review-result-ok'),
                  onPressed: () => context.pop(),
                  child: Text(l10n.reviewDone),
                ),
              ],
            ),
          ),
        ),
      );
    }
    // 결과를 모르는 요청을 보관 중이면 입력을 잠근다(다시 확인은 같은 키·같은 본문이어야 한다).
    final locked = _busy || _submitter.pending;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.reviewWrite),
        leading: IconButton(
          key: const ValueKey('review-close'),
          icon: const Icon(Icons.close),
          tooltip: l10n.reviewCancel,
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ProductName(
            productId: t.productId,
            title: t.title,
            style: theme.textTheme.titleMedium,
          ),
          if (t.eligibleUntil case final u?)
            Text(
              l10n.reviewDeadline(formatSeoulDateTime(u)),
              style: theme.textTheme.bodySmall,
            ),
          const SizedBox(height: 12),
          Text(l10n.reviewRatingHint),
          Row(
            children: [
              for (var i = 1; i <= reviewRatingMax; i++)
                IconButton(
                  key: ValueKey('review-star-$i'),
                  tooltip: l10n.reviewStar(i),
                  iconSize: 36,
                  color: theme.colorScheme.primary,
                  icon: Icon(
                    i <= (_rating ?? 0) ? Icons.star : Icons.star_border,
                  ),
                  onPressed: locked ? null : () => setState(() => _rating = i),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('review-text'),
            controller: _text,
            enabled: !locked,
            minLines: 5,
            maxLines: 10,
            maxLength: reviewTextMaxLength,
            decoration: InputDecoration(
              hintText: l10n.reviewTextHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 4),
          _photoSection(context, locked: locked),
          const SizedBox(height: 16),
          // 정책 문구: Commerce 업무 문서 15장 [확정 정책](품목당 1건, 배송완료 후 14일, 최초 등록 후 3일 수정, 삭제 후 재작성 불가).
          ExpansionTile(
            key: const ValueKey('review-policy'),
            tilePadding: EdgeInsets.zero,
            title: Text(l10n.reviewPolicyTitle),
            children: [
              for (final line in [
                l10n.reviewPolicyOnePerItem,
                l10n.reviewPolicyDeadline,
                l10n.reviewPolicyEdit,
                l10n.reviewPolicyDelete,
              ])
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('· $line', style: theme.textTheme.bodySmall),
                ),
            ],
          ),
          const SizedBox(height: 16),
          switch (outcome) {
            CommandRejected(:final code) => Text(
              _rejectText(l10n, code),
              key: const ValueKey('review-result-rejected'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
            CommandUnknown() => Row(
              key: const ValueKey('review-result-unknown'),
              children: [
                Expanded(child: Text(l10n.reviewUnknown)),
                TextButton(
                  key: const ValueKey('review-recheck'),
                  onPressed: _busy ? null : _submit,
                  child: Text(l10n.reviewRecheck),
                ),
              ],
            ),
            _ => const SizedBox.shrink(),
          },
          if (_busy)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(l10n.reviewSubmitting),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => context.pop(),
                  child: Text(l10n.reviewCancel),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  key: const ValueKey('review-submit'),
                  // 확인 중에는 새 등록을 막는다("다시 확인"만 같은 키로 보낸다).
                  // 사진이 다 올라가기 전에는 등록하지 않는다.
                  onPressed: locked || _rating == null || !_photosReady
                      ? null
                      : _submit,
                  child: Text(l10n.reviewSubmit),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 사진 칸 줄: [사진 n/5] 칸(레퍼런스 "리뷰 쓰기" 의 사진 칸 — 225px ÷ 3 ≈ 75dp, 모서리 16) + 고른 사진들.
class _PhotoRow extends StatelessWidget {
  const _PhotoRow({
    required this.photos,
    required this.locked,
    required this.onAdd,
    required this.onRetry,
    required this.onRemove,
  });

  static const double tile = 75;

  final List<ReviewPhotoSlot> photos;
  final bool locked;
  final VoidCallback onAdd;
  final void Function(ReviewPhotoSlot) onRetry;
  final void Function(ReviewPhotoSlot) onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final radius = BorderRadius.circular(16);
    final full = photos.length >= reviewPhotoMax;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        Semantics(
          button: true,
          label: l10n.reviewPhotoAdd(photos.length, reviewPhotoMax),
          child: InkWell(
            key: const ValueKey('review-photo-add'),
            borderRadius: radius,
            onTap: locked || full ? null : onAdd,
            child: Container(
              width: tile,
              height: tile,
              decoration: BoxDecoration(
                borderRadius: radius,
                border: Border.all(color: theme.colorScheme.outlineVariant),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  PmartLineIcon(
                    PmartLineIcons.camera,
                    size: 24,
                    color: locked || full
                        ? theme.colorScheme.outline
                        : theme.colorScheme.onSurface,
                  ),
                  const SizedBox(height: 4),
                  ExcludeSemantics(
                    child: Text(
                      l10n.reviewPhotoAdd(photos.length, reviewPhotoMax),
                      style: theme.textTheme.bodySmall?.copyWith(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        for (final (i, p) in photos.indexed)
          _PhotoTile(
            key: ValueKey('review-photo-$i'),
            slot: p,
            index: i,
            locked: locked,
            onRetry: () => onRetry(p),
            onRemove: () => onRemove(p),
          ),
      ],
    );
  }
}

class _PhotoTile extends ConsumerWidget {
  const _PhotoTile({
    super.key,
    required this.slot,
    required this.index,
    required this.locked,
    required this.onRetry,
    required this.onRemove,
  });

  final ReviewPhotoSlot slot;
  final int index;
  final bool locked;
  final VoidCallback onRetry;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final radius = BorderRadius.circular(16);
    final bad =
        slot.status == ReviewPhotoStatus.unknown ||
        slot.status == ReviewPhotoStatus.rejected;
    Widget blank() =>
        ColoredBox(color: theme.colorScheme.surfaceContainerHighest);
    final file = slot.file;
    final remote = file == null
        ? resolveImageUrl(slot.url, ref.watch(imageOriginProvider))
        : null;
    return SizedBox.square(
      dimension: _PhotoRow.tile,
      child: Stack(
        children: [
          Positioned.fill(
            child: ClipRRect(
              borderRadius: radius,
              // 새로 고른 사진은 기기 원본으로(올린 사진은 공개 리뷰에 붙기 전에는 서버에서 열리지 않는다).
              // 이미 붙은 사진은 서버 주소로.
              child: file != null
                  ? Image.memory(
                      file.bytes,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                      errorBuilder: (_, _, _) => blank(),
                    )
                  : remote == null
                  ? blank()
                  : Image.network(
                      remote,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => blank(),
                    ),
            ),
          ),
          if (slot.status != ReviewPhotoStatus.uploaded)
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: radius,
                  color: Colors.black.withValues(alpha: 0.45),
                  border: bad
                      ? Border.all(color: theme.colorScheme.error, width: 2)
                      : null,
                ),
                child: Center(
                  child: switch (slot.status) {
                    ReviewPhotoStatus.uploading => SizedBox.square(
                      key: ValueKey('review-photo-uploading-$index'),
                      dimension: 22,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    ),
                    ReviewPhotoStatus.unknown => TextButton(
                      key: ValueKey('review-photo-retry-$index'),
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        // 테마 글꼴(Pretendard)을 유지한 채 크기만 줄인다.
                        textStyle: theme.textTheme.labelSmall?.copyWith(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      onPressed: locked ? null : onRetry,
                      child: Text(l10n.reviewPhotoRetry),
                    ),
                    ReviewPhotoStatus.rejected => Padding(
                      padding: const EdgeInsets.all(4),
                      child: Text(
                        slot.code == ReviewProblemCode.photoInvalid
                            ? l10n.reviewPhotoRejectedInvalid
                            : l10n.reviewPhotoRejected,
                        key: ValueKey('review-photo-rejected-$index'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10.5,
                        ),
                      ),
                    ),
                    ReviewPhotoStatus.uploaded => const SizedBox.shrink(),
                  },
                ),
              ),
            ),
          if (slot.status != ReviewPhotoStatus.uploading)
            Positioned(
              top: 2,
              right: 2,
              child: Semantics(
                button: true,
                label: l10n.reviewPhotoRemove,
                child: InkWell(
                  key: ValueKey('review-photo-remove-$index'),
                  customBorder: const CircleBorder(),
                  onTap: locked ? null : onRemove,
                  child: Container(
                    width: 22,
                    height: 22,
                    decoration: const BoxDecoration(
                      color: Colors.black54,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.close,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 공개 리뷰에 붙은 사진(서버 `photos[].url` — 게이트웨이 상대 경로 `/api/v1/review-photos/{id}`, 토큰 없이 연다).
/// 주소를 그릴 수 없으면(목 모드 상대 경로 등) 자리표시만 보인다.
class _ReviewPhotos extends ConsumerWidget {
  const _ReviewPhotos({required this.review});

  final ReviewView review;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (review.photoUrls.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final origin = ref.watch(imageOriginProvider);
    Widget placeholder() => ColoredBox(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Center(
        child: PmartLineIcon(
          PmartLineIcons.camera,
          size: 20,
          color: theme.colorScheme.outline,
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: SizedBox(
        height: 72,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: review.photoUrls.length,
          separatorBuilder: (_, _) => const SizedBox(width: 6),
          itemBuilder: (context, i) {
            final url = resolveImageUrl(review.photoUrls[i], origin);
            return Semantics(
              image: true,
              label: l10n.reviewPhotoLabel(i + 1),
              child: ClipRRect(
                key: ValueKey('review-photo-${review.reviewId}-$i'),
                borderRadius: BorderRadius.circular(8),
                child: SizedBox.square(
                  dimension: 72,
                  child: url == null
                      ? placeholder()
                      : Image.network(
                          url,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => placeholder(),
                        ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

Widget _reviewItem(BuildContext context, AppLocalizations l10n, ReviewView r) {
  final theme = Theme.of(context);
  return Padding(
    key: ValueKey('product-review-${r.reviewId}'),
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            ReviewStars(rating: r.rating),
            const SizedBox(width: 8),
            Text(
              [
                r.authorMasked ?? l10n.reviewAuthorUnknown,
                formatSeoulDateTime(r.createdAt),
              ].join(' · '),
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
        if (r.text case final t? when t.isNotEmpty) Text(t),
        _ReviewPhotos(review: r),
      ],
    ),
  );
}

/// 상품 상세의 리뷰 미리보기(첫 묶음 앞 몇 건). 조회 실패는 "리뷰 없음"이 아니라 실패 + 다시 시도.
class ProductReviewsPreview extends ConsumerWidget {
  const ProductReviewsPreview({super.key, required this.productId});

  final String productId;

  static const previewCount = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final provider = productReviewsProvider(productId);
    final value = ref.watch(provider);
    final list = value.value;
    return Column(
      key: const ValueKey('product-reviews'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(switch (list?.reviewCount) {
          final int n => l10n.reviewSectionCount(n),
          null => l10n.reviewSectionTitle,
        }, style: theme.textTheme.titleMedium),
        switch (value) {
          AsyncError() when list == null => Row(
            key: const ValueKey('product-reviews-failed'),
            children: [
              Expanded(
                child: Text(
                  l10n.reviewLoadFailed,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
              TextButton(
                onPressed: () => ref.invalidate(provider),
                child: Text(l10n.reviewRetry),
              ),
            ],
          ),
          _ when list == null => const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: LinearProgressIndicator(),
          ),
          _ when list.items.isEmpty => Text(
            l10n.reviewSectionEmpty,
            key: const ValueKey('product-reviews-empty'),
          ),
          _ => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final r in list.items.take(previewCount))
                _reviewItem(context, l10n, r),
              if (list.items.length > previewCount || list.hasMore)
                TextButton(
                  key: const ValueKey('product-reviews-all'),
                  onPressed: () => context.push('/products/$productId/reviews'),
                  child: Text(l10n.reviewSeeAll),
                ),
            ],
          ),
        },
      ],
    );
  }
}

/// 상품 리뷰 전체(`GET /products/{id}/reviews`, 커서로 더 보기).
class ProductReviewsScreen extends ConsumerWidget {
  const ProductReviewsScreen({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final provider = productReviewsProvider(productId);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.reviewsTitle)),
      body: UiStateView<PagedList<ReviewView>>(
        state: uiStateOf(ref.watch(provider), isEmpty: (p) => p.items.isEmpty),
        onRetry: () => ref.invalidate(provider),
        empty: (_) => Center(child: Text(l10n.reviewSectionEmpty)),
        ready: (context, list) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (list.reviewCount case final n?)
              Text(
                l10n.reviewSectionCount(n),
                style: Theme.of(context).textTheme.titleMedium,
              ),
            for (final r in list.items) _reviewItem(context, l10n, r),
            _LoadMoreFooter(
              list: list,
              onLoadMore: () => ref.read(provider.notifier).loadMore(),
            ),
          ],
        ),
      ),
    );
  }
}

/// 주문 상세의 리뷰 영역: 이 주문에서 서버가 작성 가능이라고 준 품목만 "리뷰 쓰기"를 보인다.
/// 비회원·자격 없음이면 영역을 두지 않는다. 조회 실패는 "쓸 리뷰 없음"이 아니라 실패 + 다시 시도.
class OrderReviewsSection extends ConsumerWidget {
  const OrderReviewsSection({
    super.key,
    required this.orderId,
    required this.lineTitles,
  });

  final String orderId;

  /// orderLineId → 주문 당시 상품명 사본.
  final Map<String, String> lineTitles;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final provider = orderReviewEligibilitiesProvider(orderId);
    final value = ref.watch(provider);
    if (value.hasError && !value.hasValue) {
      return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Row(
          key: const ValueKey('order-reviews-failed'),
          children: [
            Expanded(
              child: Text(
                l10n.orderReviewFailed,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
            TextButton(
              onPressed: () => ref.invalidate(provider),
              child: Text(l10n.reviewRetry),
            ),
          ],
        ),
      );
    }
    final items = [
      for (final e in value.value ?? const <ReviewEligibility>[])
        if (e.writable || e.written) e,
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const ValueKey('order-reviews'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Text(l10n.orderReviewTitle, style: theme.textTheme.titleMedium),
        for (final e in items)
          ListTile(
            key: ValueKey('order-review-${e.orderLineId}'),
            contentPadding: EdgeInsets.zero,
            title: _ProductName(
              productId: e.productId,
              title: lineTitles[e.orderLineId] ?? e.productName,
            ),
            subtitle: e.writable && e.eligibleUntil != null
                ? Text(
                    l10n.reviewDeadline(formatSeoulDateTime(e.eligibleUntil!)),
                  )
                : null,
            trailing: e.writable
                ? TextButton(
                    key: ValueKey('order-review-write-${e.orderLineId}'),
                    onPressed: () => openReviewWrite(
                      context,
                      ReviewTarget.of(e, title: lineTitles[e.orderLineId]),
                    ),
                    child: Text(l10n.reviewWrite),
                  )
                : Text(l10n.orderReviewWritten),
          ),
      ],
    );
  }
}
