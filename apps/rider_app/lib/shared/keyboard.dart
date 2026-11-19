import 'package:flutter/widgets.dart';

/// 입력칸 밖을 누르면(버튼·선택칸 포함) 키보드를 내린다 — `TextField(onTapOutside: dismissKeyboard)`.
/// Android 기본은 밖을 눌러도 키보드가 남는다(사용자 2026-11-19 "다른 곳 터치하면 바로 내려가게").
/// 대화(채팅) 입력칸에는 쓰지 않는다 — 보내기 버튼을 누를 때마다 키보드가 내려가면 이어 쓰기 불편하다.
void dismissKeyboard(PointerDownEvent _) =>
    FocusManager.instance.primaryFocus?.unfocus();
