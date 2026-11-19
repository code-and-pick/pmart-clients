import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rider_app/shared/rider_widgets.dart';

/// 안내(회색 팝업) — 화면 위쪽, 2초 뒤 저절로, "보기" 버튼이 있어도 저절로 사라진다(사용자 2026-11-19).
void main() {
  Future<BuildContext> open(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(400, 800)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    late BuildContext ctx;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (c) {
              ctx = c;
              return const Align(
                alignment: Alignment.bottomCenter,
                child: TextField(key: ValueKey('input')),
              );
            },
          ),
        ),
      ),
    );
    return ctx;
  }

  testWidgets('화면 위쪽에 뜨고 2초 뒤 사라진다 — 아래 입력칸·버튼을 가리지 않는다', (t) async {
    final ctx = await open(t);
    showRiderToast(ctx, '안내');
    await t.pump(const Duration(milliseconds: 300));
    final toast = find.byKey(const ValueKey('rider-toast'));
    expect(toast, findsOneWidget);
    expect(t.getRect(toast).bottom, lessThan(200), reason: '위쪽');
    expect(
      t.getRect(toast).overlaps(t.getRect(find.byKey(const ValueKey('input')))),
      isFalse,
    );
    await t.pump(riderToastDuration);
    expect(toast, findsNothing);
  });

  testWidgets('"보기" 버튼이 있어도 저절로 사라지고, 누르면 그 일을 하고 닫힌다', (t) async {
    final ctx = await open(t);
    final overlay = Overlay.of(ctx, rootOverlay: true);
    var opened = 0;
    showRiderTopToast(
      overlay,
      '새 알림',
      actionLabel: '보기',
      onAction: () => opened++,
      duration: const Duration(seconds: 4),
    );
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('보기'), findsOneWidget);
    await t.pump(const Duration(seconds: 4));
    expect(find.text('새 알림'), findsNothing, reason: '버튼이 있어도 저절로');

    showRiderTopToast(
      overlay,
      '새 알림',
      actionLabel: '보기',
      onAction: () => opened++,
    );
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('보기'));
    await t.pump();
    expect(opened, 1);
    expect(find.text('새 알림'), findsNothing);
  });

  testWidgets('새 안내가 오면 앞 안내를 바꾼다(겹치지 않음), 눌러서 닫을 수 있다', (t) async {
    final ctx = await open(t);
    showRiderToast(ctx, '첫째');
    await t.pump(const Duration(milliseconds: 100));
    showRiderToast(ctx, '둘째');
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('첫째'), findsNothing);
    expect(find.text('둘째'), findsOneWidget);
    await t.tap(find.text('둘째'));
    await t.pump();
    expect(find.text('둘째'), findsNothing);
  });
}
