import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart' show formatSeoulDateTime;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../appeals/data/appeals.dart' show myAppealsProvider;
import '../../appeals/presentation/appeal_screens.dart' show AppealList;
import '../data/inquiries.dart';
import '../../../shared/keyboard.dart';

String inquiryKindText(AppLocalizations l10n, InquiryKind k) => switch (k) {
  InquiryKind.settlement => l10n.inqSettlement,
  InquiryKind.account => l10n.inqAccount,
  InquiryKind.appError => l10n.inqAppError,
  InquiryKind.other => l10n.inqOther,
};

(String, Color) inquiryStateLook(AppLocalizations l10n, InquiryState s) =>
    switch (s) {
      InquiryState.received => (l10n.inqReceived, RiderColors.pickup),
      InquiryState.answered => (l10n.inqAnswered, RiderColors.primary),
      InquiryState.unknown => (l10n.inqUnknown, RiderColors.sub),
    };

/// 지원센터(사용자 2026-11-20 "소명·이의도 결국 지원센터에 남기는 것") — 마이페이지 한 곳에서
/// 채팅 상담·문의 남기기와, 남긴 것을 탭 둘로 본다: 문의(case-service) | 소명·이의(rider-service 0.15.0).
/// 서버 기록은 따로다(소명·이의는 라이더 운영이 유지·인정으로 결정 — 제한·수행료에 반영).
/// 배송 중인 건은 배송 화면의 도움요청.
class SupportCenterScreen extends ConsumerWidget {
  const SupportCenterScreen({super.key, this.initialTab = 0});

  /// 0 = 문의, 1 = 소명·이의
  final int initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final inquiries = ref.watch(inquiriesProvider).value?.length;
    final appeals = ref.watch(myAppealsProvider).value?.length;
    String tab(String label, int? n) =>
        n == null || n == 0 ? label : '$label $n';
    return DefaultTabController(
      length: 2,
      initialIndex: initialTab,
      child: Scaffold(
        backgroundColor: RiderColors.gap,
        appBar: riderDarkBar(context, title: l10n.menuSupport),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 흰 카드 두 칸을 나란히(사용자 2026-11-23 "보라 버튼 별로" — 전에는 가로로 긴 보라 버튼 두 줄).
                  // 보라는 아이콘에만 쓰고, 아래 탭(고른 쪽 보라)과 겹쳐 화면이 무거워 보이지 않게 한다.
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: _ActionTile(
                            key: const ValueKey('live-chat'),
                            icon: Icons.forum_outlined,
                            title: l10n.supportChat,
                            sub: l10n.supportChatSub,
                            onTap: () => context.push('/my/inquiries/chat'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _ActionTile(
                            key: const ValueKey('inquiry-new'),
                            icon: Icons.edit_note_rounded,
                            title: l10n.supportNew,
                            sub: l10n.supportNewSub,
                            onTap: () async {
                              await context.push('/my/inquiries/new');
                              ref.invalidate(inquiriesProvider);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 11,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.info_outline_rounded,
                          size: 18,
                          color: RiderColors.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            l10n.supportCenterNote,
                            style: const TextStyle(
                              fontSize: 13,
                              height: 1.4,
                              color: RiderColors.sub,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  // 알약 모양 탭 — 고른 쪽이 보라, 숫자는 옆에
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: TabBar(
                      labelColor: Colors.white,
                      unselectedLabelColor: RiderColors.sub,
                      labelStyle: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                      unselectedLabelStyle: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                      indicator: BoxDecoration(
                        color: RiderColors.primary,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      indicatorSize: TabBarIndicatorSize.tab,
                      dividerColor: Colors.transparent,
                      splashBorderRadius: BorderRadius.circular(10),
                      tabs: [
                        Tab(
                          key: const ValueKey('tab-inquiries'),
                          height: 42,
                          text: tab(l10n.supportTabInquiries, inquiries),
                        ),
                        Tab(
                          key: const ValueKey('tab-appeals'),
                          height: 42,
                          text: tab(l10n.supportTabAppeals, appeals),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Expanded(
              child: TabBarView(children: [_InquiryList(), AppealList()]),
            ),
          ],
        ),
      ),
    );
  }
}

/// 위쪽 버튼(채팅 상담·문의 남기기) — 흰 카드, 연보라 원 안 보라 아이콘, 제목·설명, 오른쪽 위 화살표.
class _ActionTile extends StatelessWidget {
  const _ActionTile({
    super.key,
    required this.icon,
    required this.title,
    required this.sub,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: const BorderSide(color: RiderColors.line),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: const BoxDecoration(
                    color: RiderColors.primaryMist,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 22, color: RiderColors.primary),
                ),
                const Spacer(),
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 22,
                  color: RiderColors.hint,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: RiderColors.ink,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              sub,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: RiderColors.sub,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// 남긴 문의(최근 것이 위).
class _InquiryList extends ConsumerWidget {
  const _InquiryList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final list = ref.watch(inquiriesProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(inquiriesProvider.future),
      child: ListView(
        key: const ValueKey('inquiry-list'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          switch (list) {
            AsyncData(:final value) when value.isEmpty => SupportEmpty(
              key: const ValueKey('inquiry-empty'),
              icon: Icons.forum_outlined,
              text: l10n.inqEmpty,
            ),
            AsyncData(:final value) => Column(
              children: [for (final i in value) _InquiryCard(inquiry: i)],
            ),
            // 조회 실패를 "문의 없음"으로 보이지 않는다.
            AsyncError() => Row(
              key: const ValueKey('inquiry-error'),
              children: [
                Expanded(child: Text(l10n.inqLoadFailed)),
                TextButton(
                  onPressed: () => ref.invalidate(inquiriesProvider),
                  child: Text(l10n.retry),
                ),
              ],
            ),
            _ => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          },
        ],
      ),
    );
  }
}

class _InquiryCard extends StatelessWidget {
  const _InquiryCard({required this.inquiry});

  final RiderInquiry inquiry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = inquiryStateLook(l10n, inquiry.state);
    final body = inquiry.body.trim();
    return SupportCard(
      key: ValueKey('inquiry-${inquiry.id}'),
      onTap: () => context.push('/my/inquiries/${inquiry.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 제목이 먼저, 상태는 오른쪽 위
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  inquiry.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              StatusPill(label: text, color: color),
            ],
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              body,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 14,
                height: 1.45,
                color: RiderColors.sub,
              ),
            ),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1, color: RiderColors.gap),
          const SizedBox(height: 10),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: RiderColors.field,
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Text(
                  inquiryKindText(l10n, inquiry.kind),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: RiderColors.sub,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  formatSeoulDateTime(inquiry.createdAt),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: RiderColors.hint),
                ),
              ),
              const Icon(
                Icons.chevron_right,
                size: 20,
                color: RiderColors.hint,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 새 문의: 유형 · 제목(100자) · 내용(2000자) → 보내기. 같은 내용을 다시 누르면 같은 키(문의가 두 번 생기지 않게).
class InquiryNewScreen extends ConsumerStatefulWidget {
  const InquiryNewScreen({super.key});

  @override
  ConsumerState<InquiryNewScreen> createState() => _InquiryNewScreenState();
}

class _InquiryNewScreenState extends ConsumerState<InquiryNewScreen> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  InquiryKind? _kind;
  bool _sending = false;
  IdempotencyKey? _key;
  String? _keyFor;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  bool get _ready =>
      _kind != null &&
      _title.text.trim().isNotEmpty &&
      _body.text.trim().isNotEmpty &&
      !_sending;

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context);
    final kind = _kind!;
    final title = _title.text.trim();
    final body = _body.text.trim();
    final sig = '${kind.name}|$title|$body';
    // 결과를 모르는 같은 내용은 같은 키로 다시 보낸다.
    final key = _keyFor == sig && _key != null
        ? _key!
        : IdempotencyKey.generate();
    _key = key;
    _keyFor = sig;
    setState(() => _sending = true);
    try {
      final created = await ref
          .read(inquiryRepositoryProvider)
          .create(kind, title: title, body: body, key: key);
      if (!mounted) return;
      showRiderToast(context, l10n.inqSent);
      context.pushReplacement('/my/inquiries/${created.id}');
    } on PmartFailure {
      if (!mounted) return;
      setState(() => _sending = false);
      showRiderToast(context, l10n.inqSendFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.inqNew),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Text(l10n.inqKind, style: _label),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final k in InquiryKind.values)
                ChoiceChip(
                  key: ValueKey('inq-kind-${k.name}'),
                  label: Text(inquiryKindText(l10n, k)),
                  selected: _kind == k,
                  selectedColor: RiderColors.primarySoft,
                  onSelected: (_) => setState(() => _kind = k),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Text(l10n.inqTitle, style: _label),
          const SizedBox(height: 8),
          TextField(
            onTapOutside: dismissKeyboard,
            key: const ValueKey('inq-title'),
            controller: _title,
            maxLength: 100,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          Text(l10n.inqBody, style: _label),
          const SizedBox(height: 8),
          TextField(
            onTapOutside: dismissKeyboard,
            key: const ValueKey('inq-body'),
            controller: _body,
            maxLength: 2000,
            minLines: 5,
            maxLines: 10,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: l10n.inqBodyHint,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('inq-send'),
            label: l10n.inqSend,
            onPressed: _ready ? _send : null,
          ),
        ),
      ),
    );
  }
}

const _label = TextStyle(fontSize: 15, fontWeight: FontWeight.w700);

/// 문의 상세: 내가 쓴 글 + 지원센터 답변. 답변 알림(푸시)이 없어 들어올 때·당겨서 새로 읽는다.
class InquiryDetailScreen extends ConsumerStatefulWidget {
  const InquiryDetailScreen({super.key, required this.inquiryId});

  final String inquiryId;

  @override
  ConsumerState<InquiryDetailScreen> createState() =>
      _InquiryDetailScreenState();
}

class _InquiryDetailScreenState extends ConsumerState<InquiryDetailScreen> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // 답변을 기다리는 동안 가끔 다시 읽는다.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) ref.invalidate(inquiryProvider(widget.inquiryId));
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = inquiryProvider(widget.inquiryId);
    final state = ref.watch(p);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuInquiries),
      body: switch (state) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(p.future),
          child: ListView(
            key: const ValueKey('inquiry-detail'),
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      inquiryKindText(l10n, value.kind),
                      style: const TextStyle(color: RiderColors.sub),
                    ),
                  ),
                  Text(
                    inquiryStateLook(l10n, value.state).$1,
                    key: const ValueKey('inquiry-state'),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: inquiryStateLook(l10n, value.state).$2,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                value.title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                value.body,
                style: const TextStyle(fontSize: 15, height: 1.5),
              ),
              const Divider(height: 32),
              Text(l10n.inqReplies, style: _label),
              const SizedBox(height: 8),
              if (value.replies.isEmpty)
                Text(
                  l10n.inqWaiting,
                  key: const ValueKey('inquiry-waiting'),
                  style: const TextStyle(color: RiderColors.sub),
                )
              else
                for (final r in value.replies)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: RiderColors.field,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.supportCenter,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          r.body,
                          key: const ValueKey('inquiry-reply'),
                          style: const TextStyle(fontSize: 15, height: 1.5),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        ),
        AsyncError() => Center(
          child: TextButton(
            onPressed: () => ref.invalidate(p),
            child: Text(l10n.inqLoadFailed),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}
