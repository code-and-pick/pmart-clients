import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart' show formatKrw, formatSeoulDateTime;

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../appeals/data/appeals.dart'
    show Appeal, AppealTarget, myAppealsProvider;
import '../../appeals/presentation/appeal_screens.dart'
    show AppealRow, appealNewRoute;
import '../../my/data/records.dart' show Settlement, settlementsProvider;
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

/// 지원센터(사용자 2026-11-20 "소명·이의도 결국 지원센터에 남기는 것") — 마이페이지 한 곳.
/// 2026-11-25 사용자 "소명이의도 그냥 문의 남기기에서 하면 되는 거 아니야? 왜 탭이 따로 있어?" → 탭 없이 "내 문의" 한 목록
/// (문의·소명·이의, 최신이 위, 회색 바탕 위 흰 카드).
/// 이어서 "다 하양이라 눈에 안 들어와 · UI 자체가 구리다" → 실제 화면 시안 셋 중 사용자가 고른 "보라 머리"
/// (보라 제목 막대·머리 + "무엇을 도와드릴까요?" + 머리에 걸친 흰 카드 두 장).
/// 서버 기록은 따로다: 문의 = case-service, 소명·이의 = rider-service 0.15.0(라이더 운영이 유지·인정 → 제한·보상금에 반영).
/// 그래서 "문의 남기기"에서 수행료 이의·계정 제한 소명을 고르면 이의 신청으로 보낸다(문의로 보내면 보상 처리가 안 된다).
/// 배송 중인 건은 배송 화면의 도움요청.
class SupportCenterScreen extends ConsumerWidget {
  const SupportCenterScreen({super.key});

  static const _bg = Color(0xFFF4F5F7);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final inquiries = ref.watch(inquiriesProvider);
    final appeals = ref.watch(myAppealsProvider);
    // 인정된 수행료 이의의 보상금(정산내역의 보상 줄 — execution 0.30.0). 못 읽었으면 금액을 붙이지 않는다(0원으로 지어내지 않음).
    final compensations = <String, int>{
      for (final s
          in ref.watch(settlementsProvider).value?.items ??
              const <Settlement>[])
        if (s.compensation && s.appealId != null && s.amount != null)
          s.appealId!: s.amount!,
    };
    final rows = <(DateTime, Widget)>[
      for (final i in inquiries.value ?? const <RiderInquiry>[])
        (i.createdAt, _InquiryRow(inquiry: i)),
      for (final a in appeals.value ?? const <Appeal>[])
        (
          a.submittedAt,
          AppealRow(
            key: ValueKey('appeal-${a.appealId}'),
            appeal: a,
            compensation: compensations[a.appealId],
          ),
        ),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
    final loading =
        (inquiries.isLoading && !inquiries.hasValue) ||
        (appeals.isLoading && !appeals.hasValue);

    Future<void> openNew() async {
      await context.push('/my/inquiries/new');
      ref
        ..invalidate(inquiriesProvider)
        ..invalidate(myAppealsProvider);
    }

    void openChat() => context.push('/my/inquiries/chat');

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: RiderColors.primary,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: Text(l10n.menuSupport),
        titleTextStyle: riderTitleStyle(context, color: Colors.white),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(inquiriesProvider)
            ..invalidate(myAppealsProvider);
          await Future.wait([
            ref.read(inquiriesProvider.future).catchError((Object _) {
              return const <RiderInquiry>[];
            }),
            ref.read(myAppealsProvider.future).catchError((Object _) {
              return const <Appeal>[];
            }),
          ]);
        },
        child: ListView(
          key: const ValueKey('support-list'),
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            _VioletHeader(onChat: openChat, onNew: openNew),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Row(
                children: [
                  Text(
                    l10n.supportMine,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: RiderColors.ink,
                    ),
                  ),
                  if (rows.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Text(
                      '${rows.length}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: RiderColors.primary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            // 조회 실패를 "문의 없음"으로 보이지 않는다 — 못 읽은 쪽만 알리고, 읽은 쪽은 보인다.
            if (inquiries.hasError && !inquiries.hasValue)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: RiderLoadError(
                  key: const ValueKey('inquiry-error'),
                  compact: true,
                  title: l10n.inqLoadFailed,
                  onRetry: () => ref.invalidate(inquiriesProvider),
                ),
              ),
            if (appeals.hasError && !appeals.hasValue)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: RiderLoadError(
                  key: const ValueKey('appeal-error-load'),
                  compact: true,
                  title: l10n.appealLoadFailed,
                  onRetry: () => ref.invalidate(myAppealsProvider),
                ),
              ),
            if (loading && rows.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (rows.isEmpty && inquiries.hasValue && appeals.hasValue)
              SupportEmpty(
                key: const ValueKey('inquiry-empty'),
                icon: Icons.forum_outlined,
                text: l10n.inqEmpty,
              )
            else
              for (final (_, row) in rows) _RowCard(child: row),
          ],
        ),
      ),
    );
  }
}

/// 내 문의 한 장 — 회색 바탕 위 흰 카드(둥글기 12, 아주 옅은 그림자).
class _RowCard extends StatelessWidget {
  const _RowCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0A000000),
          blurRadius: 6,
          offset: Offset(0, 1),
        ),
      ],
    ),
    clipBehavior: Clip.antiAlias,
    child: Material(color: Colors.transparent, child: child),
  );
}

/// 보라 머리 + 흰 칸 한 장(반으로 나눠 채팅 상담 | 문의 남기기)이 머리 아래에 걸쳐 뜬다.
/// 2026-11-25 사용자 "폰트랑 간격 때문에 ppt로 만든 느낌" → 시안 둘 중 고른 "한 장 반반"(머리 18 · 칸 높이 72 · 아이콘+이름 한 줄).
class _VioletHeader extends StatelessWidget {
  const _VioletHeader({required this.onChat, required this.onNew});

  final VoidCallback onChat;
  final VoidCallback onNew;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    const headerH = 92.0;
    const tileH = 72.0;
    const overlap = 30.0;
    final chat = (
      key: const ValueKey('live-chat'),
      icon: Icons.forum_outlined,
      title: l10n.supportChat,
      onTap: onChat,
    );
    final ask = (
      key: const ValueKey('inquiry-new'),
      icon: Icons.edit_note_rounded,
      title: l10n.supportNew,
      onTap: onNew,
    );
    return SizedBox(
      height: headerH + tileH - overlap,
      child: Stack(
        children: [
          Container(
            height: headerH,
            width: double.infinity,
            color: RiderColors.primary,
            padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.supportHello,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  l10n.supportCenterNote,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: Color(0xCCFFFFFF),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            top: headerH - overlap,
            height: tileH,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x14000000),
                    blurRadius: 10,
                    offset: Offset(0, 3),
                  ),
                ],
              ),
              child: Row(
                children: [
                  for (final (i, t) in [chat, ask].indexed) ...[
                    if (i > 0)
                      const VerticalDivider(
                        width: 1,
                        indent: 18,
                        endIndent: 18,
                        color: RiderColors.line,
                      ),
                    Expanded(
                      child: _FlatHalf(
                        key: t.key,
                        icon: t.icon,
                        title: t.title,
                        onTap: t.onTap,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 반 칸 — 보라 아이콘(22) + 제목 15 굵게, 가운데 정렬.
class _FlatHalf extends StatelessWidget {
  const _FlatHalf({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(12),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 22, color: RiderColors.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: RiderColors.ink,
          ),
        ),
      ],
    ),
  );
}

/// 내 문의 한 줄 — [상태] 종류 · 날짜 / 굵은 제목 / 회색 내용 한 줄 / ›.
class _InquiryRow extends StatelessWidget {
  const _InquiryRow({required this.inquiry});

  final RiderInquiry inquiry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = inquiryStateLook(l10n, inquiry.state);
    final body = inquiry.body.trim();
    return InkWell(
      key: ValueKey('inquiry-${inquiry.id}'),
      onTap: () => context.push('/my/inquiries/${inquiry.id}'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 13, 10, 13),
        child: Row(
          children: [
            Expanded(
              child: SupportRowBody(
                state: StatusPill(label: text, color: color),
                kind: inquiryKindText(l10n, inquiry.kind),
                at: inquiry.createdAt,
                title: inquiry.title,
                body: body.isEmpty ? null : body,
              ),
            ),
            const Icon(Icons.chevron_right, size: 24, color: RiderColors.sub),
          ],
        ),
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

  /// 서버가 쓸 수 없는 말이 있다고 받지 않았다 — 고칠 때까지 입력 칸 아래에 알린다.
  bool _blocked = false;

  /// 수행료 이의: 정산내역의 배송 수행료 줄(최신 20개)에서 배송을 골라 이의 신청 화면으로.
  /// 목록을 못 읽으면 빈 목록이라 하지 않고 못 불러왔다고 알린다.
  /// 배송 목록을 읽는 동안 또 눌러도 다시 시작하지 않는다(연타 — 2026-11-25)
  bool _picking = false;

  Future<void> _toEarningAppeal() async {
    if (_picking) return;
    _picking = true;
    try {
      await _pickEarningAppeal();
    } finally {
      if (mounted) _picking = false;
    }
  }

  Future<void> _pickEarningAppeal() async {
    final l10n = AppLocalizations.of(context);
    final List<Settlement> items;
    try {
      items = [
        for (final s in (await ref.read(settlementsProvider.future)).items)
          if (!s.compensation && s.deliveryId != null) s,
      ]..sort((a, b) => b.from.compareTo(a.from));
    } on Object {
      if (mounted) showRiderToast(context, l10n.appealPickFailed);
      return;
    }
    if (!mounted) return;
    if (items.isEmpty) return showRiderToast(context, l10n.appealPickNone);
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(ctx).height * 0.7,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                child: Text(
                  l10n.appealPickDelivery,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final s in items.take(20))
                      ListTile(
                        key: ValueKey('appeal-pick-${s.deliveryId}'),
                        title: Text(
                          s.deliveryId!,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: Text(formatSeoulDateTime(s.from)),
                        trailing: Text(switch (s.amount) {
                          final int a => formatKrw(a),
                          null => l10n.feeUncalculated,
                        }, style: const TextStyle(fontSize: 15)),
                        onTap: () => Navigator.of(ctx).pop(s.deliveryId),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (picked == null || !mounted) return;
    context.pushReplacement(
      appealNewRoute(AppealTarget.earning, deliveryId: picked),
    );
  }

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
    } on PmartFailure catch (f) {
      if (!mounted) return;
      if (isBlockedWords(f)) {
        // 접수되지 않음(확정) — 쓴 글은 그대로, 고쳐서 다시 보내게.
        setState(() {
          _sending = false;
          _blocked = true;
        });
        return;
      }
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
              // 사용자 2026-11-25 "소명이의도 그냥 문의 남기기에서" — 고르면 이의 신청(rider-service)으로 간다.
              // 문의로 보내면 라이더 운영의 유지·인정 결정·보상금 처리가 안 되기 때문.
              ChoiceChip(
                key: const ValueKey('inq-kind-appeal-earning'),
                label: Text(l10n.appealKindEarning),
                selected: false,
                onSelected: (_) => _toEarningAppeal(),
              ),
              ChoiceChip(
                key: const ValueKey('inq-kind-appeal-restriction'),
                label: Text(l10n.appealRestrictionTitle),
                selected: false,
                onSelected: (_) => context.pushReplacement(
                  appealNewRoute(AppealTarget.restriction),
                ),
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
            onChanged: (_) => setState(() => _blocked = false),
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
            onChanged: (_) => setState(() => _blocked = false),
            decoration: InputDecoration(
              hintText: l10n.inqBodyHint,
              border: const OutlineInputBorder(),
              errorText: _blocked ? l10n.blockedWords : null,
              errorMaxLines: 2,
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
        AsyncError() => RiderLoadError(
          title: l10n.inqLoadFailed,
          onRetry: () => ref.invalidate(p),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}
