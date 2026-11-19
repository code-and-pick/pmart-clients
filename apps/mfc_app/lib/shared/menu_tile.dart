import 'package:flutter/material.dart';

import 'pda_theme.dart';

/// 메인(업무 고르기)·기기 설정이 함께 쓰는 큰 메뉴 칸(사용자 2026-11-17 "작업 선택 목록과 같은 디자인").
/// 장갑을 끼고도 누를 수 있게 크다. 칸이 낮으면(작은 화면) 설명 줄을 숨긴다.
class MenuTile extends StatelessWidget {
  const MenuTile({
    super.key,
    required this.icon,
    required this.title,
    this.hint,
    this.allowed = true,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String? hint;

  /// false 면 흐리게, 오른쪽에 자물쇠(누르면 [onTap] 이 이유를 알린다).
  final bool allowed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = allowed ? PdaColors.ink : PdaColors.ink.withAlpha(97);
    // 첫 화면 업무 칸과 같은 모양 — 흰 칸·옅은 선, 옅은 보라 원 안 보라 그림.
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: PdaColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: LayoutBuilder(
          builder: (context, c) {
            final roomy = c.maxHeight >= 72;
            final circle = roomy ? 52.0 : 40.0;
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                children: [
                  Container(
                    width: circle,
                    height: circle,
                    decoration: const BoxDecoration(
                      color: PdaColors.softer,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      icon,
                      size: roomy ? 28 : 22,
                      color: allowed ? PdaColors.primary : PdaColors.muted,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: fg,
                            fontSize: roomy ? 18 : 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (roomy && hint != null)
                          Text(
                            hint!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: PdaColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Icon(
                    allowed ? Icons.chevron_right : Icons.lock_outline,
                    color: PdaColors.muted,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
