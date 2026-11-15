import 'package:flutter/material.dart';

import '../l10n/gen/app_localizations.dart';

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

/// 온도대 색 — 구역 조각 배경.
Color _tempColor(String t) => switch (t) {
  'C' => const Color(0xFF2F5BD3),
  'F' => const Color(0xFF5B3CC4),
  _ => const Color(0xFFC46A12),
};

/// 갈 위치 안내(현장 PDA 위치 스캔 화면). 위에서부터:
/// "다음 위치로 이동해 주세요" → 위치 바코드(조각마다 색 블록, 멀리서도 읽히게) → 온도대·구역·랙·단·칸 표.
///
/// [codeKey] 는 코드 원문 [Text] 의 키 — 화면·시험이 지금 칸을 읽는 자리다.
class LocationGuide extends StatelessWidget {
  const LocationGuide({
    super.key,
    required this.code,
    this.codeKey,
    this.title,
  });

  final String code;
  final Key? codeKey;

  /// 기본은 "다음 위치로 이동해 주세요".
  final String? title;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final shelf = ShelfCode.parse(code);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.place_outlined),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                title ?? l10n.locGoTo,
                style: theme.textTheme.titleMedium,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Text(
              l10n.locCodeLabel,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                code,
                key: codeKey,
                textAlign: TextAlign.end,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        _Blocks(
          code: code,
          shelf: shelf,
          tempText: shelf == null ? null : _tempText(l10n, shelf.temp),
        ),
        if (shelf != null) ...[
          const SizedBox(height: 4),
          for (final (label, value) in [
            (l10n.locZone, shelf.zone),
            (l10n.locRack, shelf.rack),
            (l10n.locLevel, shelf.level),
            (l10n.locSlot, shelf.slot),
          ])
            _Row(label: label, value: value),
        ],
      ],
    );
  }
}

/// 선반 위치 코드의 색 블록만(위치 줄 아래 — 아직 확인 안 한 칸). 선반 형식이 아니면 아무것도 그리지 않는다.
class LocationBlocks extends StatelessWidget {
  const LocationBlocks({super.key, required this.code, this.height = 48});

  final String code;
  final double height;

  @override
  Widget build(BuildContext context) {
    final shelf = ShelfCode.parse(code);
    if (shelf == null) return const SizedBox.shrink();
    return _Blocks(
      code: code,
      shelf: shelf,
      tempText: _tempText(AppLocalizations.of(context), shelf.temp),
      height: height,
    );
  }
}

class _Blocks extends StatelessWidget {
  const _Blocks({
    required this.code,
    required this.shelf,
    this.tempText,
    this.height = 64,
  });

  final String code;
  final ShelfCode? shelf;
  final double height;

  /// 구역 블록 위에 작게 — 냉장·냉동·상온.
  final String? tempText;

  @override
  Widget build(BuildContext context) {
    final s = shelf;
    final parts = s == null
        ? [(code, const Color(0xFF37474F), 1, null)]
        : [
            (s.zone, _tempColor(s.temp), 3, tempText),
            (s.rack, const Color(0xFF55595F), 2, null),
            (s.level, const Color(0xFF16897F), 2, null),
            (s.slot, const Color(0xFF2E7D32), 2, null),
          ];
    return ExcludeSemantics(
      child: SizedBox(
        height: height,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (text, color, flex, caption) in parts)
              Expanded(
                flex: flex,
                child: ColoredBox(
                  color: color,
                  child: Stack(
                    children: [
                      if (caption != null)
                        Positioned(
                          left: 6,
                          top: 3,
                          child: Text(
                            caption,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      Center(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            child: Text(
                              text,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 38,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
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

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.dividerColor)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
        child: Row(
          children: [
            Text(label, style: theme.textTheme.titleMedium),
            const Spacer(),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
