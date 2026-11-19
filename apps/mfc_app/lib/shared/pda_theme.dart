import 'package:flutter/material.dart';

/// PDA 전용 테마 — 흰 바탕 + 중립 회색, 보라는 포인트(주 버튼·지금 단계·수량·위치 값)에만
/// (사용자 2026-11-19 "흰색 기본에 포인트 컬러만 연보라 내지는 보라"). 배치는 시안 `pda-preview.html`.
/// 공통 `PmartTheme` 은 다른 앱도 쓰므로 건드리지 않고 이 앱에서만 쓴다.
///
/// 글자 #1F1D24 · 보조 글자 #6B6873 · 선 #E9E8EE · 바탕 흰색 · 회색 칸 #F4F4F7 ·
/// 기본 보라 #6B45B0 · 옅은 보라 #F6F1FD / #ECE2FA(포인트 바탕).
abstract final class PdaColors {
  static const ink = Color(0xFF1F1D24);
  static const muted = Color(0xFF6B6873);
  static const line = Color(0xFFE9E8EE);
  static const paper = Colors.white;
  static const dark = Color(0xFF3F2A66);
  static const primary = Color(0xFF6B45B0);

  /// 중립 회색 칸(아직 안 한 단계·보조 바탕).
  static const soft = Color(0xFFF4F4F7);

  /// 옅은 보라(포인트 바탕).
  static const softer = Color(0xFFF6F1FD);
  static const lilac = Color(0xFFECE2FA);
  static const notice = Color(0xFFF6F1FD);
  static const onNotice = Color(0xFF4E3285);

  /// 주의 띠(노랑) — 멈춰 확인해야 하는 안내에만.
  static const warning = Color(0xFFFFF2DA);
  static const onWarning = Color(0xFF724815);
  static const danger = Color(0xFF9B392B);
}

abstract final class PdaTheme {
  static ThemeData light() {
    final scheme =
        ColorScheme.fromSeed(
          seedColor: PdaColors.primary,
          brightness: Brightness.light,
        ).copyWith(
          primary: PdaColors.primary,
          onPrimary: Colors.white,
          primaryContainer: PdaColors.softer,
          onPrimaryContainer: PdaColors.dark,
          secondaryContainer: PdaColors.lilac,
          onSecondaryContainer: PdaColors.dark,
          surface: PdaColors.paper,
          onSurface: PdaColors.ink,
          onSurfaceVariant: PdaColors.muted,
          surfaceContainerLowest: Colors.white,
          surfaceContainerLow: Colors.white,
          surfaceContainer: PdaColors.soft,
          surfaceContainerHigh: PdaColors.soft,
          surfaceContainerHighest: PdaColors.soft,
          outline: const Color(0xFFC9C7D1),
          outlineVariant: PdaColors.line,
          inverseSurface: PdaColors.dark,
        );
    final shape10 = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(10),
    );
    // 글자 모양은 기본 글꼴 묶음에서 이어 받는다(글꼴 이름을 비워 두면 화면마다 글꼴이 달라진다).
    final base = ThemeData(colorScheme: scheme, useMaterial3: true).textTheme;
    final bold = base.labelLarge!.copyWith(fontWeight: FontWeight.w800);
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: PdaColors.paper,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: PdaColors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: base.titleMedium!.copyWith(
          color: PdaColors.ink,
          fontSize: 17,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.3,
        ),
        shape: const Border(bottom: BorderSide(color: PdaColors.line)),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: const EdgeInsets.only(top: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(13),
          side: const BorderSide(color: PdaColors.line),
        ),
      ),
      dividerTheme: const DividerThemeData(color: PdaColors.line, space: 1),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 56),
          shape: shape10,
          textStyle: bold.copyWith(fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 50),
          shape: shape10,
          backgroundColor: Colors.white,
          foregroundColor: PdaColors.ink,
          side: const BorderSide(color: PdaColors.line),
          textStyle: bold.copyWith(fontSize: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: PdaColors.primary,
          textStyle: bold.copyWith(fontSize: 14),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        side: const BorderSide(color: PdaColors.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
        labelStyle: bold.copyWith(fontSize: 14, color: PdaColors.ink),
        selectedColor: PdaColors.dark,
        secondaryLabelStyle: bold.copyWith(fontSize: 14, color: Colors.white),
        checkmarkColor: Colors.white,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: PdaColors.primary,
        linearTrackColor: PdaColors.lilac,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: PdaColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: PdaColors.line),
        ),
      ),
      listTileTheme: const ListTileThemeData(iconColor: PdaColors.primary),
    );
  }
}
