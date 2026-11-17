import 'package:flutter/material.dart';

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
    final scheme = theme.colorScheme;
    final fg = allowed ? scheme.onSurface : scheme.onSurface.withAlpha(97);
    return Material(
      color: scheme.surfaceContainerHigh,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: LayoutBuilder(
          builder: (context, c) {
            final roomy = c.maxHeight >= 72;
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Icon(icon, size: roomy ? 36 : 24, color: fg),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          style:
                              (roomy
                                      ? theme.textTheme.headlineSmall
                                      : theme.textTheme.titleMedium)
                                  ?.copyWith(color: fg),
                        ),
                        if (roomy && hint != null)
                          Text(
                            hint!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: fg,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Icon(
                    allowed ? Icons.chevron_right : Icons.lock_outline,
                    color: fg,
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
