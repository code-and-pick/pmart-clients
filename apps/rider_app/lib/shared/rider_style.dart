import 'package:flutter/material.dart';
import 'package:pmart_ui/pmart_ui.dart';

/// 라이더 앱 색. 화면 배치는 레퍼런스(`docs/reference/pmart-delivery`)를 따르고,
/// 브랜드 색은 PMart 연보라를 쓴다(레퍼런스 앱의 브랜드 색·캐릭터는 쓰지 않는다 — `pmart_ui` 테마 주석).
abstract final class RiderColors {
  static const primary = PmartBrand.violet;
  static const primarySoft = PmartBrand.lavender;
  static const primaryMist = PmartBrand.lavenderMist;

  static const ink = Color(0xFF111111);
  static const sub = Color(0xFF6B6B6B);
  static const hint = Color(0xFFA8A8A8);
  static const line = Color(0xFFE3E3E3);
  static const field = Color(0xFFF4F4F4);
  static const gap = Color(0xFFF2F2F2);
  static const disabled = Color(0xFFC9C9C9);

  /// 어두운 머리띠(배달리스트·신규배달·촬영)
  static const header = Color(0xFF1B1C20);

  /// 픽업 단계(주황)·전달 단계(파랑)
  static const pickup = Color(0xFFF0872A);
  static const drop = Color(0xFF3B6FE0);
  static const danger = Color(0xFFE0524D);
  static const gold = Color(0xFFF2B63C);
  static const notice = Color(0xFFFFF7EC);
}

abstract final class RiderTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(seedColor: RiderColors.primary)
        .copyWith(
          primary: RiderColors.primary,
          onPrimary: Colors.white,
          surface: Colors.white,
          onSurface: RiderColors.ink,
        );
    final base = ThemeData(colorScheme: scheme, useMaterial3: true);
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: Colors.white,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: RiderColors.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleSpacing: 0,
        centerTitle: false,
        titleTextStyle: base.textTheme.titleLarge!.copyWith(
          color: RiderColors.ink,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xE6333333),
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      dividerTheme: const DividerThemeData(
        color: RiderColors.line,
        thickness: 1,
        space: 1,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: const WidgetStatePropertyAll(Colors.white),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? RiderColors.primary
              : RiderColors.disabled,
        ),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        isDense: true,
        contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        hintStyle: TextStyle(color: RiderColors.hint, fontSize: 15),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(2)),
          borderSide: BorderSide(color: RiderColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(2)),
          borderSide: BorderSide(color: RiderColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(2)),
          borderSide: BorderSide(color: RiderColors.primary, width: 1.5),
        ),
      ),
    );
  }
}
