import 'package:flutter/material.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../domain/trip.dart';
import 'delivery_texts.dart';

/// 배송 시트 회색 띠·회색 칸 색(레퍼런스에서 잰 값 2026-11-25).
const sheetBandColor = Color(0xFFF4F5F7);

/// 전달 단계 파란 글자(전달지로 이동해주세요·고객 요청사항) — 레퍼런스에서 잰 색.
const sheetBlue = Color(0xFF2167C5);

/// 화면 묶음 제목 + 아이콘(사용자 2026-11-25 레퍼런스: 진한 아이콘 · 보통 굵기 15 제목, 내용은 제목 글자 줄에 맞춤).
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
    padding: const EdgeInsets.fromLTRB(16.2, 18.7, 15.5, 22),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 23, color: RiderColors.ink),
        const SizedBox(width: 5.8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontSize: 16, color: RiderColors.ink),
              ),
              const SizedBox(height: 9.5),
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

/// 주문정보(사용자 2026-11-25 레퍼런스): 큰 주문번호(앞 회색·끝 4자리 검정 굵게) · 메뉴금액(굵게) ·
/// 가게명·포장(회색 이름 + 값) · 회색 칸 안 품목(이름 ··· 수량).
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
      icon: Icons.article_outlined,
      title: l10n.orderInfo,
      children: [
        OrderCode(
          key: const ValueKey('order-no'),
          code: t?.orderNo ?? orderId ?? '-',
          size: 30.5,
        ),
        // 메뉴 금액은 주문번호 바로 밑에 굵게(사용자 2026-11-18). 서버(주문) 값을 그대로 보인다.
        if (t?.menuTotal case final total?)
          Padding(
            key: const ValueKey('menu-total'),
            padding: const EdgeInsets.only(top: 5.4),
            child: Text(
              '${l10n.menuAmount}   ${formatKrw(total)}',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: RiderColors.ink,
              ),
            ),
          ),
        _InfoRow(
          top: 1.9,
          l10n.storeNameLabel,
          t == null
              ? storeText(l10n, mfcId)
              : l10n.storeLabel(shortStoreName(t.store.name)),
        ),
        if (t == null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.orderDetailPending,
              style: const TextStyle(fontSize: 13, color: RiderColors.hint),
            ),
          )
        else if (t.items.isNotEmpty)
          Container(
            key: const ValueKey('menu-items'),
            width: double.infinity,
            margin: const EdgeInsets.only(top: 13.3),
            padding: const EdgeInsets.fromLTRB(13, 10.6, 13, 12),
            decoration: BoxDecoration(
              color: sheetBandColor,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Column(
              children: [
                for (final (i, line) in t.items.indexed)
                  Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 0 : 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            line.name,
                            style: const TextStyle(
                              fontSize: 15,
                              height: 1.35,
                              color: RiderColors.sub,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          l10n.itemQty(line.qty),
                          style: const TextStyle(
                            fontSize: 15,
                            height: 1.35,
                            color: RiderColors.sub,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// 회색 이름 + 값(가게명·포장) — 이름 칸 폭을 맞춰 값이 한 줄로 선다.
class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value, {this.top = 4});

  final String label;
  final String value;
  final double top;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(top: top),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 64,
          child: Text(
            label,
            style: const TextStyle(fontSize: 16, color: RiderColors.sub),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(fontSize: 16, color: RiderColors.ink),
          ),
        ),
      ],
    ),
  );
}

/// 요청사항 칸(사용자 2026-11-25 레퍼런스): 아이콘 + 이름 · 요청(파란 굵은 글씨, 없으면 회색 "없음") ·
/// 회색 칸(공동현관 등 — 이름 굵게, 값 아래).
class RequestBlock extends StatelessWidget {
  const RequestBlock({
    super.key,
    required this.icon,
    required this.label,
    required this.text,
    this.boxLabel,
    this.boxValue,
    this.footer,
  });

  final IconData icon;
  final String label;
  final String? text;
  final String? boxLabel;
  final String? boxValue;

  /// 맨 아래 작은 회색 글(예: 연락 기록 n번).
  final String? footer;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    const boxInk = Color(0xFF444444);
    // 치수는 레퍼런스(사용자 2026-11-25 전달 화면)에서 잰 값.
    return Padding(
      padding: const EdgeInsets.fromLTRB(16.6, 18.1, 15.5, 19.1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 24, color: RiderColors.ink),
          const SizedBox(width: 4.4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 16, color: RiderColors.ink),
                ),
                const SizedBox(height: 9.7),
                Text(
                  text ?? l10n.noRequest,
                  key: const ValueKey('request-text'),
                  style: TextStyle(
                    fontSize: 16.4,
                    height: 1.4,
                    fontWeight: text == null
                        ? FontWeight.w400
                        : FontWeight.w700,
                    color: text == null ? RiderColors.hint : sheetBlue,
                  ),
                ),
                if (boxLabel != null || boxValue != null)
                  Container(
                    key: const ValueKey('entrance-box'),
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 8.7),
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                    decoration: BoxDecoration(
                      color: sheetBandColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (boxLabel case final l?)
                          Text(
                            l,
                            style: const TextStyle(
                              fontSize: 14.2,
                              fontWeight: FontWeight.w700,
                              color: boxInk,
                            ),
                          ),
                        if (boxValue case final v?)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              v,
                              style: const TextStyle(
                                fontSize: 14.2,
                                color: boxInk,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                if (footer case final f?)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      f,
                      key: const ValueKey('contact-count'),
                      style: const TextStyle(
                        fontSize: 13,
                        color: RiderColors.sub,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
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
