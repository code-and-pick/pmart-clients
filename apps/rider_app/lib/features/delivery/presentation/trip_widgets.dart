import 'package:flutter/material.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../domain/trip.dart';
import 'delivery_texts.dart';

/// 화면 묶음 제목 + 아이콘.
class TripSection extends StatelessWidget {
  const TripSection({
    super.key,
    required this.icon,
    required this.title,
    required this.children,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 22, color: RiderColors.sub),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontSize: 14, color: RiderColors.sub),
              ),
              const SizedBox(height: 6),
              ...children,
            ],
          ),
        ),
      ],
    ),
  );
}

/// 이름 · 값 한 줄.
class TripLine extends StatelessWidget {
  const TripLine(this.label, this.value, {super.key, this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              color: bold ? RiderColors.ink : RiderColors.sub,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            color: RiderColors.ink,
            fontWeight: bold ? FontWeight.w800 : FontWeight.w400,
          ),
        ),
      ],
    ),
  );
}

/// 주문정보: 주문번호 8자리 · 주문장소(픽업지) · 메뉴 품목 · 메뉴금액 · 고객요청사항.
/// [trip] 이 없으면(실서버 — 계약에 아직 없음) 주문 ID 와 포장 수만 보인다.
class OrderInfoSection extends StatelessWidget {
  const OrderInfoSection({
    super.key,
    required this.trip,
    required this.orderId,
    required this.mfcId,
    this.packageCount,
  });

  final TripInfo? trip;
  final String? orderId;
  final String? mfcId;
  final int? packageCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final t = trip;
    return TripSection(
      key: const ValueKey('order-info'),
      icon: Icons.receipt_long_outlined,
      title: l10n.orderInfo,
      children: [
        Text(
          l10n.orderNumber,
          style: const TextStyle(fontSize: 13, color: RiderColors.hint),
        ),
        OrderCode(
          key: const ValueKey('order-no'),
          code: t?.orderNo ?? orderId ?? '-',
          size: 26,
        ),
        // 메뉴 금액은 주문번호 바로 밑에 굵게(사용자 2026-11-18). 서버(주문) 값을 그대로 보인다.
        if (t?.menuTotal case final total?)
          Padding(
            key: const ValueKey('menu-total'),
            padding: const EdgeInsets.only(top: 4),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${l10n.menuAmount}  ',
                    style: const TextStyle(
                      fontSize: 15,
                      color: RiderColors.sub,
                    ),
                  ),
                  TextSpan(
                    text: formatKrw(total),
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: RiderColors.ink,
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 10),
        TripLine(
          l10n.orderPlace,
          t == null
              ? storeText(l10n, mfcId)
              : l10n.storeLabel(shortStoreName(t.store.name)),
        ),
        if (packageCount case final n?)
          TripLine(l10n.packagesLabel, packageCountText(l10n, n)),
        if (t == null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.orderDetailPending,
              style: const TextStyle(fontSize: 13, color: RiderColors.hint),
            ),
          )
        else ...[
          const SizedBox(height: 10),
          Text(
            l10n.menuItems,
            style: const TextStyle(fontSize: 13, color: RiderColors.hint),
          ),
          for (final line in t.items)
            TripLine(
              l10n.itemLine(line.name, line.qty),
              formatKrw(line.amount),
            ),
        ],
      ],
    );
  }
}

/// 가게·배달 고객요청사항(주문정보 아래 주황 칸 — 요청사항은 여기 한 곳에만).
class RequestNotes extends StatelessWidget {
  const RequestNotes({
    super.key,
    required this.storeRequest,
    required this.deliveryRequest,
  });

  final String? storeRequest;
  final String? deliveryRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      key: const ValueKey('request-notes'),
      width: double.infinity,
      color: RiderColors.notice,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 2026-11-23 사용자 "주황색 배경으로 해놓은 거 치곤 폰트나 굵기가 좀 약해" — 머리는 아이콘 + 굵게, 내용은 크고 굵게.
          Row(
            children: [
              // 확인해 달라는 알림 — 주황 동그라미 안 흰 확성기(사용자 2026-11-23 "뜬금없이 ! 이거 하나만 있는 건 좀 아니지").
              Container(
                key: const ValueKey('request-notes-badge'),
                width: 26,
                height: 26,
                decoration: const BoxDecoration(
                  color: RiderColors.pickup,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.campaign_rounded,
                  size: 17,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                l10n.checkRequestNote,
                // 2026-11-25 사용자 "주황글자 폰트만 좀 더 다듬어줘" → 안 C: 16·굵게(700)·자간 좁힘,
                // 크림 바탕 위에서 흐리지 않게 주황을 한 톤 진하게.
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  color: Color(0xFFE0701A),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // 라벨을 위, 내용을 아래에 — 긴 요청이면 한 줄 배치에서 라벨이 "가게/요청사/항"으로 쪼개졌다.
          _Note(
            key: const ValueKey('store-request'),
            label: l10n.storeRequestLabel,
            text: storeRequest ?? l10n.noRequest,
          ),
          const SizedBox(height: 10),
          _Note(
            key: const ValueKey('delivery-request'),
            label: l10n.deliveryRequestLabel,
            text: deliveryRequest ?? l10n.noRequest,
          ),
        ],
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({super.key, required this.label, required this.text});

  final String label;
  final String text;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: RiderColors.sub,
        ),
      ),
      const SizedBox(height: 3),
      Text(
        text,
        style: const TextStyle(
          fontSize: 18,
          height: 1.35,
          fontWeight: FontWeight.w800,
          color: RiderColors.ink,
        ),
      ),
    ],
  );
}

/// 픽업지·전달지 칸(레퍼런스 image 12): 라벨 · 이름 · 주소 · 그 밑에 전화연결 글자 버튼,
/// 오른쪽에 동그란 길안내 버튼. [linkLocked] 면 전화연결을 잠그고 [lockedNote] 를 보인다.
class PlaceSection extends StatelessWidget {
  const PlaceSection({
    super.key,
    required this.label,
    required this.title,
    this.lines = const [],
    this.linkKey,
    this.linkText,
    this.onLink,
    this.linkLocked = false,
    this.lockedNote,
    this.routeKey,
    this.onRoute,
  });

  final String label;
  final String title;

  /// 이름 아래 줄들(첫 줄은 진하게, 나머지는 흐리게).
  final List<String> lines;
  final Key? linkKey;
  final String? linkText;
  final VoidCallback? onLink;
  final bool linkLocked;
  final String? lockedNote;
  final Key? routeKey;
  final VoidCallback? onRoute;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 20, 16, 18),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(Icons.place_outlined, size: 22, color: RiderColors.sub),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(fontSize: 14, color: RiderColors.sub),
              ),
              const SizedBox(height: 6),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
              for (final (i, line) in lines.indexed)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    line,
                    style: TextStyle(
                      fontSize: i == 0 ? 15 : 13,
                      color: i == 0 ? RiderColors.ink : RiderColors.hint,
                    ),
                  ),
                ),
              if (linkText case final text?) ...[
                const SizedBox(height: 10),
                InkWell(
                  key: linkKey,
                  onTap: linkLocked ? null : onLink,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (linkLocked)
                          const Padding(
                            padding: EdgeInsets.only(right: 4),
                            child: Icon(
                              Icons.lock_outline,
                              size: 16,
                              color: RiderColors.hint,
                            ),
                          ),
                        Text(
                          text,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: linkLocked
                                ? RiderColors.hint
                                : RiderColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (linkLocked && lockedNote != null)
                  Text(
                    lockedNote!,
                    key: const ValueKey('customer-phone-locked'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: RiderColors.hint,
                    ),
                  ),
              ],
            ],
          ),
        ),
        if (onRoute != null)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Material(
              shape: const CircleBorder(
                side: BorderSide(color: RiderColors.line),
              ),
              color: Colors.white,
              child: InkWell(
                key: routeKey,
                customBorder: const CircleBorder(),
                onTap: onRoute,
                child: const SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    Icons.turn_right,
                    color: RiderColors.primary,
                    size: 26,
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

/// 예정 시각 한 줄(예: "픽업 예정 14:32 · 약 6분").
/// 레퍼런스 image 14·17: "9분 후 픽업예정" / "전달예정 3분 지남" / "곧 픽업예정".
String relativeDueText(AppLocalizations l10n, String what, DateTime at) {
  final minutes = at.difference(DateTime.now()).inMinutes;
  if (minutes > 0) return l10n.dueIn(minutes, what);
  if (minutes < 0) return l10n.dueLate(-minutes, what);
  return l10n.dueNow(what);
}

String dueText(
  AppLocalizations l10n,
  String Function(String) label,
  DateTime at,
) {
  final minutes = at.difference(DateTime.now()).inMinutes;
  return [
    label(clockText(at)),
    if (minutes > 0) l10n.etaMinutes(minutes),
  ].join(' · ');
}

/// 포장 수 — 0 이면 아직 포장 전(서버가 포장을 붙이기 전)이라 "0개" 대신 준비 중으로(2026-11-20 S23 알뜰).
String packageCountText(AppLocalizations l10n, int n) =>
    n == 0 ? l10n.packagesPreparing : l10n.packageCount(n);
