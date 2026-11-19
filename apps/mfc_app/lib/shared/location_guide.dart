import 'package:flutter/material.dart';

import '../l10n/gen/app_localizations.dart';
import 'pda_theme.dart';

/// 위치 코드를 조각으로 나눈 것(채번 지침 — `docs/architecture/identifiers.md`).
/// 선반 `{온도 A/C/F}-{구역}-{랙 2}-{단 1~9}-{칸 2}`(예 `C-S1-03-2-04`)만 조각을 나눈다.
/// 그 밖의 구역(`RCV-C-01` 등)은 코드 그대로 보인다. 조각은 표시용이고 판정은 서버가 한다.
@immutable
class ShelfCode {
  const ShelfCode({
    required this.temp,
    required this.zone,
    required this.rack,
    required this.level,
    required this.slot,
  });

  /// A 상온 · C 냉장 · F 냉동.
  final String temp;
  final String zone;
  final String rack;
  final String level;
  final String slot;

  static final _re = RegExp(
    r'^([ACF])-([A-Z][0-9])-([0-9]{2})-([1-9])-([0-9]{2})$',
  );

  static ShelfCode? parse(String code) {
    final m = _re.firstMatch(code.trim());
    if (m == null) return null;
    return ShelfCode(
      temp: m[1]!,
      zone: m[2]!,
      rack: m[3]!,
      level: m[4]!,
      slot: m[5]!,
    );
  }
}

String? _tempText(AppLocalizations l10n, String t) => switch (t) {
  'A' => l10n.zoneAmbient,
  'C' => l10n.zoneChilled,
  'F' => l10n.zoneFrozen,
  _ => null,
};

/// 갈 위치 안내(현장 PDA 위치 스캔 화면) — 시안 `pda-preview.html`:
/// 큰 제목("다음 위치로 이동해 주세요") → 진한 보라 카드(온도대 칩 + 코드 원문, 아래 구역·랙·단·칸 네 칸).
/// 사용자 2026-11-16 참고 화면의 "조각마다 크게 + 구역·랙·단·칸 이름"을 한 카드에 담았다.
///
/// [codeKey] 는 코드 원문 [Text] 의 키 — 화면·시험이 지금 칸을 읽는 자리다.
class LocationGuide extends StatelessWidget {
  const LocationGuide({
    super.key,
    required this.code,
    this.codeKey,
    this.title,
    this.detail,
  });

  final String code;
  final Key? codeKey;

  /// 기본은 "다음 위치로 이동해 주세요".
  final String? title;

  /// 제목 아래 회색 한 줄(예 카트 번호).
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title ?? l10n.locGoTo,
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: -1.2,
          ),
        ),
        if (detail case final d?)
          Text(
            d,
            style: theme.textTheme.bodyMedium?.copyWith(color: PdaColors.muted),
          ),
        const SizedBox(height: 12),
        LocationCard(code: code, codeKey: codeKey),
      ],
    );
  }
}

/// 위치 카드(흰 바탕·옅은 보라 칸·보라 값) — 위에 온도대 칩·코드, 아래 구역·랙·단·칸(선반 형식이 아니면 코드 한 칸).
class LocationCard extends StatelessWidget {
  const LocationCard({super.key, required this.code, this.codeKey});

  final String code;
  final Key? codeKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final shelf = ShelfCode.parse(code);
    final temp = shelf == null ? null : _tempText(l10n, shelf.temp);
    final tiles = shelf == null
        ? [(code, null)]
        : [
            (shelf.zone, l10n.locZone),
            (shelf.rack, l10n.locRack),
            (shelf.level, l10n.locLevel),
            (shelf.slot, l10n.locSlot),
          ];
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: PdaColors.lilac, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (temp != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: _tempChip(shelf!.temp),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    temp,
                    style: const TextStyle(
                      color: PdaColors.dark,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              const Spacer(),
              Text(
                code,
                key: codeKey,
                style: const TextStyle(
                  color: PdaColors.muted,
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          ExcludeSemantics(
            child: Row(
              children: [
                for (final (i, (value, label)) in tiles.indexed) ...[
                  if (i > 0) const SizedBox(width: 6),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      decoration: BoxDecoration(
                        color: PdaColors.softer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        children: [
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 4,
                              ),
                              child: Text(
                                value,
                                style: const TextStyle(
                                  color: PdaColors.primary,
                                  fontSize: 30,
                                  height: 1.2,
                                  fontWeight: FontWeight.w800,
                                  fontFeatures: [FontFeature.tabularFigures()],
                                ),
                              ),
                            ),
                          ),
                          if (label != null)
                            Text(
                              label,
                              style: const TextStyle(
                                color: PdaColors.muted,
                                fontSize: 12,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 온도대 칩 바탕 — 냉장 하늘, 냉동 보라, 상온 살구.
Color _tempChip(String t) => switch (t) {
  'C' => const Color(0xFFD8EDF9),
  'F' => const Color(0xFFEADCFC),
  _ => const Color(0xFFFDE7CF),
};

/// 선반 위치 조각 한 줄(위치 줄 아래 — 아직 확인 안 한 칸). 흰 띠에 구역·랙·단·칸(값은 보라).
/// 칸 안내 줄([TargetLine])이 코드 원문을 이미 보이므로 머리글 없이 작게. 선반 형식이 아니면 아무것도 그리지 않는다.
class LocationBlocks extends StatelessWidget {
  const LocationBlocks({super.key, required this.code, this.height = 48});

  final String code;

  /// 한 줄 높이.
  final double height;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final shelf = ShelfCode.parse(code);
    if (shelf == null) return const SizedBox.shrink();
    final temp = _tempText(l10n, shelf.temp);
    final parts = [
      (shelf.zone, temp ?? l10n.locZone),
      (shelf.rack, l10n.locRack),
      (shelf.level, l10n.locLevel),
      (shelf.slot, l10n.locSlot),
    ];
    return ExcludeSemantics(
      child: Container(
        height: height,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: PdaColors.lilac, width: 1.5),
        ),
        child: Row(
          children: [
            for (final (i, (value, label)) in parts.indexed) ...[
              if (i > 0) const SizedBox(width: 4),
              Expanded(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: PdaColors.softer,
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          color: PdaColors.muted,
                          fontSize: 10,
                        ),
                      ),
                      const SizedBox(width: 3),
                      Text(
                        value,
                        style: const TextStyle(
                          color: PdaColors.primary,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
