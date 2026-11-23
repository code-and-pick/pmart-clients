import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/gen/app_localizations.dart';
import 'rider_style.dart';

/// 화면 아래 큰 버튼(레퍼런스: 폭 가득, 높이 56, 모서리 4).
class RiderButton extends StatefulWidget {
  const RiderButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.height = 56,
    this.color = RiderColors.primary,
    this.foreground = Colors.white,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final double height;

  /// 바탕색 — 기본은 주 색. 같은 모양의 보조 버튼(예: 배달리스트 "취소")은 회색.
  final Color color;

  /// 글자색 — 기본 흰색(카카오 로그인 버튼은 검정).
  final Color foreground;

  @override
  State<RiderButton> createState() => _RiderButtonState();
}

/// 누르는 느낌(사용자 2026-11-23): "길게 누를 때가 아니라 한 번 가볍게 터치할 때 효과가 보이게", 빛 효과(그림자 번짐)는 되돌림.
/// 누르면 손을 얼마나 오래 댔든 같은 짧은 움직임(약 0.24초)이 끝까지 돈다 — 버튼이 살짝 눌렸다(0.96) 돌아오고,
/// 그동안 흰 막이 잠깐 덮였다 걷힌다. 가벼운 진동 한 번. 꺼진 버튼은 반응하지 않는다.
class _RiderButtonState extends State<RiderButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _tap = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 240),
  );

  /// 0 → 1 → 0 (앞 40% 동안 눌리고 나머지 동안 돌아온다).
  late final Animation<double> _press = TweenSequence<double>([
    TweenSequenceItem(
      tween: Tween<double>(
        begin: 0,
        end: 1,
      ).chain(CurveTween(curve: Curves.easeOut)),
      weight: 40,
    ),
    TweenSequenceItem(
      tween: Tween<double>(
        begin: 1,
        end: 0,
      ).chain(CurveTween(curve: Curves.easeInOut)),
      weight: 60,
    ),
  ]).animate(_tap);

  @override
  void dispose() {
    _tap.dispose();
    super.dispose();
  }

  void _pressed() {
    HapticFeedback.lightImpact();
    unawaited(_tap.forward(from: 0));
    widget.onPressed!();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    const radius = BorderRadius.all(Radius.circular(4));
    return AnimatedBuilder(
      animation: _press,
      builder: (context, child) => Transform.scale(
        scale: 1 - 0.04 * _press.value,
        child: Stack(
          children: [
            child!,
            Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: radius,
                    color: Colors.white.withValues(alpha: 0.28 * _press.value),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      child: SizedBox(
        width: double.infinity,
        height: widget.height,
        child: FilledButton(
          key: const ValueKey('rider-button-surface'),
          onPressed: enabled ? _pressed : null,
          style: FilledButton.styleFrom(
            backgroundColor: widget.color,
            foregroundColor: widget.foreground,
            disabledBackgroundColor: RiderColors.disabled,
            disabledForegroundColor: Colors.white,
            shape: const RoundedRectangleBorder(borderRadius: radius),
            elevation: 0,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (widget.icon != null) ...[
                Icon(widget.icon, size: 24),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  widget.label,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
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

/// 테두리 버튼(도움요청·길찾기, '여기에 두었어요' 알리기).
class RiderOutlineButton extends StatelessWidget {
  const RiderOutlineButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.accent = false,
    this.height = 48,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// 주 색 테두리·글자(촬영 버튼).
  final bool accent;
  final double height;

  @override
  Widget build(BuildContext context) {
    final color = accent ? RiderColors.primary : RiderColors.ink;
    return SizedBox(
      height: height,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(
            color: accent ? RiderColors.primary : RiderColors.line,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
          padding: const EdgeInsets.symmetric(horizontal: 12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 20),
              const SizedBox(width: 6),
            ],
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 가입 단계 표시(① ② ③ ④).
class StepDots extends StatelessWidget {
  const StepDots({super.key, required this.current, this.total = 4});

  final int current;
  final int total;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (var i = 1; i <= total; i++)
        Container(
          width: 18,
          height: 18,
          margin: const EdgeInsets.only(right: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: i == current ? RiderColors.primary : Colors.white,
            border: Border.all(
              color: i == current ? RiderColors.primary : RiderColors.disabled,
            ),
          ),
          child: Text(
            '$i',
            style: TextStyle(
              fontSize: 11,
              height: 1,
              color: i == current ? Colors.white : RiderColors.hint,
            ),
          ),
        ),
    ],
  );
}

/// 구획 사이 회색 띠.
class SectionGap extends StatelessWidget {
  const SectionGap({super.key});

  @override
  Widget build(BuildContext context) =>
      Container(height: 8, color: RiderColors.gap);
}

/// 머리띠 제목 글자(테마 글꼴을 물려받는다).
TextStyle riderTitleStyle(
  BuildContext context, {
  Color color = RiderColors.ink,
}) =>
    Theme.of(context).textTheme.titleLarge!
        .copyWith(color: color, fontSize: 18, fontWeight: FontWeight.w700);

/// 어두운 머리띠.
PreferredSizeWidget riderDarkBar(
  BuildContext context, {
  required String title,
  List<Widget> actions = const [],
  bool centerTitle = false,
}) => AppBar(
  // 2026-11-23 사용자 "상단 제목 부분이 검정으로 뜨는 거 좀 답답해 보이는데" — 검정 막대 대신 마이페이지처럼
  // 흰 바탕 · 짙은 굵은 제목 · 아래 얇은 선(내용과 구분). 위 상태바 글자도 짙게. 이름은 예전 호출과 맞추려고 그대로 둔다.
  backgroundColor: Colors.white,
  foregroundColor: RiderColors.ink,
  surfaceTintColor: Colors.transparent,
  elevation: 0,
  scrolledUnderElevation: 0,
  systemOverlayStyle: SystemUiOverlayStyle.dark,
  centerTitle: centerTitle,
  title: Text(title),
  titleTextStyle: riderTitleStyle(context, color: RiderColors.ink),
  actions: actions,
  bottom: const PreferredSize(
    preferredSize: Size.fromHeight(1),
    child: Divider(height: 1, thickness: 1, color: RiderColors.line),
  ),
);

/// 둥근 선택 버튼(선택되면 주 색 테두리 + 체크). 지역 선택·사유 선택에 쓴다.
class PillOption extends StatelessWidget {
  const PillOption({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.showCheck = false,
    this.height = 44,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool showCheck;
  final double height;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: StadiumBorder(
      side: BorderSide(
        color: selected ? RiderColors.primary : RiderColors.line,
        width: selected ? 1.5 : 1,
      ),
    ),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: SizedBox(
        height: height,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Padding(
              padding: EdgeInsets.symmetric(horizontal: showCheck ? 40 : 12),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                  color: selected ? RiderColors.primary : RiderColors.ink,
                ),
              ),
            ),
            if (showCheck && selected)
              const Positioned(
                right: 16,
                child: Icon(Icons.check, color: RiderColors.primary, size: 22),
              ),
          ],
        ),
      ),
    ),
  );
}

/// 지도 위 흰 알약 버튼.
class MapPill extends StatelessWidget {
  const MapPill({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    elevation: 3,
    shadowColor: Colors.black38,
    shape: const StadiumBorder(),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: child,
      ),
    ),
  );
}

/// 지도 위 둥근 버튼.
class MapCircleButton extends StatelessWidget {
  const MapCircleButton({super.key, required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    elevation: 3,
    shadowColor: Colors.black38,
    shape: const CircleBorder(),
    child: InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: SizedBox(
        width: 44,
        height: 44,
        child: Icon(icon, color: RiderColors.ink, size: 24),
      ),
    ),
  );
}

/// 짧은 안내(회색 팝업). 화면 **위쪽**에 띄워 아래 버튼·입력칸을 가리지 않는다(사용자 2026-11-19
/// "버튼을 계속 가리니까 상단에"). [aboveActions] 는 예전 호출과 맞추려고 남겨 둔다(이제 늘 위쪽).
/// 2026-11-23 사용자 "완전 아래 아니면 완전 위로 떠서 버튼 다 가리고" — 위 막대(뒤로·설정) 아래에 띄우고,
/// 버튼이 없는 안내는 손가락을 그대로 통과시켜 밑의 버튼을 누를 수 있게 한다.
void showRiderToast(
  BuildContext context,
  String text, {
  bool aboveActions = false,
}) => showRiderTopToast(Overlay.of(context, rootOverlay: true), text);

/// 위쪽 안내. [actionLabel] 이 있으면 오른쪽에 버튼(예: 알림의 "보기") — 버튼이 있어도 [duration] 뒤 저절로
/// 사라진다(기본 SnackBar 는 버튼이 있으면 누를 때까지 남아 불편했다, 사용자 2026-11-19). 눌러도·위로 밀어도 닫힌다.
void showRiderTopToast(
  OverlayState overlay,
  String text, {
  String? actionLabel,
  VoidCallback? onAction,
  Duration duration = riderToastDuration,
  Key? key,
}) {
  _hideRiderToast();
  late final OverlayEntry entry;
  void close() {
    if (identical(_toastEntry, entry)) _hideRiderToast();
  }

  entry = OverlayEntry(
    builder: (context) => _TopToast(
      key: key,
      text: text,
      duration: duration,
      actionLabel: actionLabel,
      onAction: onAction == null
          ? null
          : () {
              close();
              onAction();
            },
      onDismiss: close,
    ),
  );
  _toastEntry = entry;
  overlay.insert(entry);
}

OverlayEntry? _toastEntry;

void _hideRiderToast() {
  final e = _toastEntry;
  _toastEntry = null;
  // 방금 넣어 아직 그려지기 전(mounted=false)이어도 뺀다 — 같은 프레임에 두 번 띄우면 겹쳐 보였다.
  e?.remove();
}

/// 사라지는 시간은 이 위젯이 잰다 — 화면이 통째로 닫히면 타이머도 같이 끈다.
class _TopToast extends StatefulWidget {
  const _TopToast({
    super.key,
    required this.text,
    required this.duration,
    required this.onDismiss,
    this.actionLabel,
    this.onAction,
  });

  final String text;
  final Duration duration;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback onDismiss;

  @override
  State<_TopToast> createState() => _TopToastState();
}

class _TopToastState extends State<_TopToast> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(widget.duration, widget.onDismiss);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.text;
    final actionLabel = widget.actionLabel;
    final onAction = widget.onAction;
    final onDismiss = widget.onDismiss;
    final top = MediaQuery.paddingOf(context).top;
    return Positioned(
      // 위 막대(뒤로·제목·설정) 아래 — 막대의 버튼을 가리지 않는다.
      top: top + kToolbarHeight + 6,
      left: 16,
      right: 16,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: const Duration(milliseconds: 180),
        builder: (context, v, child) => Opacity(
          opacity: v,
          child: Transform.translate(
            offset: Offset(0, (1 - v) * -12),
            child: child,
          ),
        ),
        // 버튼("보기" 등)이 없는 안내는 눌림을 받지 않는다 — 밑의 버튼이 그대로 눌린다(저절로 사라진다).
        child: IgnorePointer(
          ignoring: actionLabel == null,
          child: Dismissible(
            key: const ValueKey('rider-toast-dismiss'),
            direction: DismissDirection.up,
            onDismissed: (_) => onDismiss(),
            child: Material(
              key: const ValueKey('rider-toast'),
              color: const Color(0xFF323232),
              elevation: 6,
              borderRadius: BorderRadius.circular(8),
              child: InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: onDismiss,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          text,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            height: 1.4,
                          ),
                        ),
                      ),
                      if (actionLabel case final label?)
                        TextButton(
                          onPressed: onAction,
                          child: Text(
                            label,
                            style: const TextStyle(
                              color: Color(0xFFB9A8FF),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        )
                      else
                        const SizedBox(width: 8),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 안내(회색 팝업)가 떠 있는 시간 — 기본 4초는 길어 입력·버튼을 가린다(사용자 2026-11-19 "2초로 하자").
const riderToastDuration = Duration(seconds: 2);

/// 메뉴 한 줄(마이페이지·환경설정).
class MenuRow extends StatelessWidget {
  const MenuRow({
    super.key,
    required this.label,
    this.icon,
    this.value,
    this.trailing,
    this.onTap,
  });

  final String label;
  final IconData? icon;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 22, color: RiderColors.ink),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 17, color: RiderColors.ink),
            ),
          ),
          if (value != null)
            Text(
              value!,
              style: const TextStyle(fontSize: 14, color: RiderColors.sub),
            ),
          trailing ??
              (onTap == null
                  ? const SizedBox.shrink()
                  : const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Icon(
                        Icons.chevron_right,
                        color: RiderColors.sub,
                        size: 22,
                      ),
                    )),
        ],
      ),
    ),
  );
}

/// 상태 표시 작은 꼬리표(문의 접수됨·답변 완료, 소명 결정 대기·유지·인정). 옅은 바탕 + 같은 색 글자.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: color,
        height: 1.2,
      ),
    ),
  );
}

/// 목록 한 칸(회색 바탕 위 흰 카드) — 지원센터 문의·소명·이의.
class SupportCard extends StatelessWidget {
  const SupportCard({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.all(16), child: child),
      ),
    ),
  );
}

/// 목록이 비었을 때 — 흐린 그림 + 한 줄(+ 안내).
class SupportEmpty extends StatelessWidget {
  const SupportEmpty({
    super.key,
    required this.icon,
    required this.text,
    this.note,
  });

  final IconData icon;
  final String text;
  final String? note;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 48, 16, 24),
    child: Column(
      children: [
        Icon(icon, size: 44, color: RiderColors.disabled),
        const SizedBox(height: 12),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: RiderColors.sub,
          ),
        ),
        if (note != null) ...[
          const SizedBox(height: 6),
          Text(
            note!,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13,
              height: 1.45,
              color: RiderColors.hint,
            ),
          ),
        ],
      ],
    ),
  );
}

/// 앱 공통 팝업(사용자 2026-11-23 "팝업창이랑 운행종료는 이런 식의 UI로" — 레퍼런스: 가운데 굵은 제목, 회색 설명,
/// 가로 선 아래 꽉 찬 버튼 줄, 버튼이 둘이면 세로 선으로 나눔). [AlertDialog] 와 같은 이름의 인자라 바꿔 끼우기만 하면 된다.
/// 버튼은 [actions] 의 위젯(보통 TextButton — 키·눌림은 그대로)을 칸마다 넣는다. 마지막 버튼이 주 동작(굵게),
/// 버튼이 하나면 주 색 글자.
class RiderAlertDialog extends StatelessWidget {
  const RiderAlertDialog({
    super.key,
    this.title,
    this.content,
    this.actions,
    this.contentPadding,
  });

  final Widget? title;
  final Widget? content;
  final List<Widget>? actions;

  /// 예전 AlertDialog 호출과 맞추려고 받는다(본문 여백).
  final EdgeInsetsGeometry? contentPadding;

  @override
  Widget build(BuildContext context) {
    final acts = actions ?? const <Widget>[];
    ButtonStyle style({required bool main}) => TextButton.styleFrom(
      minimumSize: const Size.fromHeight(54),
      shape: const RoundedRectangleBorder(),
      foregroundColor: acts.length == 1
          ? RiderColors.primary
          : (main ? RiderColors.ink : RiderColors.sub),
      textStyle: TextStyle(
        fontFamily: 'Pretendard',
        fontSize: 16,
        fontWeight: main ? FontWeight.w800 : FontWeight.w500,
      ),
    );
    return Dialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 36, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Flexible(
            child: SingleChildScrollView(
              padding:
                  contentPadding?.add(const EdgeInsets.only(top: 22)) ??
                  const EdgeInsets.fromLTRB(22, 26, 22, 22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (title case final t?)
                    DefaultTextStyle.merge(
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: RiderColors.ink,
                      ),
                      child: Center(child: t),
                    ),
                  if (title != null && content != null)
                    const SizedBox(height: 10),
                  if (content case final c?)
                    DefaultTextStyle.merge(
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 15,
                        height: 1.45,
                        color: RiderColors.sub,
                      ),
                      child: c,
                    ),
                ],
              ),
            ),
          ),
          if (acts.isNotEmpty) ...[
            const Divider(height: 1, thickness: 1, color: RiderColors.line),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < acts.length; i++) ...[
                    if (i > 0)
                      const VerticalDivider(
                        width: 1,
                        thickness: 1,
                        color: RiderColors.line,
                      ),
                    Expanded(
                      child: TextButtonTheme(
                        data: TextButtonThemeData(
                          style: style(main: i == acts.length - 1),
                        ),
                        child: acts[i],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 조회 실패 표시(사용자 2026-11-24 "불러오지 못했어요 다시 시도 글자랑 UI 너무 없어보여" →
/// 큰 연보라 동그라미·큰 제목은 "ppt로 만든 것 같애" → 앱의 다른 화면처럼 조용하게).
/// - 전체 화면(기본): 작은 회색 선 아이콘 · 제목 · 안내 한 줄 · 작은 보라 "다시 시도". 화면 바탕색을 그대로 쓴다.
/// - [compact]: 한 줄 — 회색 아이콘 · 제목 · 오른쪽 작은 보라 "다시 시도"(홈 아래 칸·목록 위 같은 좁은 자리).
/// 조회 실패를 빈 목록·0 으로 보이지 않는 규칙은 그대로다(이 표시가 그 자리를 대신한다).
class RiderLoadError extends StatelessWidget {
  const RiderLoadError({
    super.key,
    required this.title,
    required this.onRetry,
    this.compact = false,
  });

  final String title;
  final VoidCallback onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final retry = _RetryButton(label: l10n.retry, onPressed: onRetry);
    if (compact) {
      return Row(
        children: [
          const Icon(Icons.wifi_off_rounded, size: 20, color: RiderColors.hint),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: RiderColors.ink,
              ),
            ),
          ),
          const SizedBox(width: 8),
          retry,
        ],
      );
    }
    return Align(
      // 가운데보다 조금 위(눈이 먼저 가는 자리).
      alignment: const Alignment(0, -0.15),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.wifi_off_rounded,
              size: 36,
              color: RiderColors.hint,
            ),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: RiderColors.ink,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              l10n.loadFailedHint,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13.5, color: RiderColors.sub),
            ),
            const SizedBox(height: 16),
            retry,
          ],
        ),
      ),
    );
  }
}

/// 앱의 주 버튼처럼 보라 바탕·흰 글씨(사용자 2026-11-24 "다시시도 버튼이 왜 하양색이니?"), 작게.
class _RetryButton extends StatelessWidget {
  const _RetryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => FilledButton(
    key: const ValueKey('load-retry'),
    onPressed: onPressed,
    style: FilledButton.styleFrom(
      foregroundColor: Colors.white,
      backgroundColor: RiderColors.primary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      elevation: 0,
      minimumSize: const Size(0, 36),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      tapTargetSize: MaterialTapTargetSize.padded,
      // 글꼴을 빼면 앱 글꼴(Pretendard)이 아닌 기본 글꼴로 바뀐다 — 함께 적는다.
      textStyle: const TextStyle(
        fontFamily: riderFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w700,
      ),
    ),
    child: Text(label),
  );
}
