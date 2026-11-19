import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rider_app/shared/rider_widgets.dart';

/// 안내(회색 팝업) — 짧게, 키보드가 떠 있으면 입력칸을 가리지 않게 위쪽에(사용자 2026-11-19).
void main() {
  Future<BuildContext> open(WidgetTester t) async {
    late BuildContext ctx;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (c) {
              ctx = c;
              return const TextField(key: ValueKey('input'));
            },
          ),
        ),
      ),
    );
    return ctx;
  }

  testWidgets('기본 4초보다 짧게 떠 있다', (t) async {
    final ctx = await open(t);
    showRiderToast(ctx, '안내');
    await t.pump();
    expect(
      t.widget<SnackBar>(find.byType(SnackBar)).duration,
      riderToastDuration,
    );
    expect(riderToastDuration, lessThan(const Duration(seconds: 4)));
  });

  testWidgets('키보드가 떠 있으면 화면 위쪽(입력칸 위)에 띄운다', (t) async {
    t.view
      ..physicalSize = const Size(400, 800)
      ..devicePixelRatio = 1
      ..viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(t.view.reset);
    final ctx = await open(t);
    showRiderToast(ctx, '안내');
    await t.pumpAndSettle();
    final bar = t.widget<SnackBar>(find.byType(SnackBar));
    expect(bar.behavior, SnackBarBehavior.floating);
    // 안내의 아래 끝이 입력칸(맨 위)보다 아래로 내려오지 않을 만큼 위쪽
    expect(
      t.getTopLeft(find.byType(SnackBar)).dy,
      lessThan(riderToastHeight + 1),
    );
  });
}
