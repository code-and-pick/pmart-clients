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

  testWidgets('새 안내가 오면 앞 안내를 바꾼다(겹치지 않음)', (t) async {
    final ctx = await open(t);
    showRiderToast(ctx, '첫째');
    await t.pump(const Duration(milliseconds: 100));
    showRiderToast(ctx, '둘째');
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('첫째'), findsNothing);
    expect(find.text('둘째'), findsOneWidget);
  });

  // 2026-11-23 사용자 "버튼 가리게 하지 말라니까" — 위 막대 아래에 뜨고, 버튼 없는 안내는 눌림을 밑으로 통과시킨다.
  testWidgets('위 막대(뒤로·설정) 아래에 뜨고, 버튼 없는 안내 밑의 버튼은 그대로 눌린다', (t) async {
    t.view
      ..physicalSize = const Size(400, 800)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    var pressed = 0;
    late BuildContext ctx;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(title: const Text('제목')),
          body: Builder(
            builder: (c) {
              ctx = c;
              return Align(
                alignment: Alignment.topCenter,
                child: FilledButton(
                  key: const ValueKey('under'),
                  onPressed: () => pressed++,
                  child: const Text('밑의 버튼'),
                ),
              );
            },
          ),
        ),
      ),
    );
    showRiderToast(ctx, '안내');
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 300)); // 내려오는 움직임이 끝난 뒤
    final toast = find.byKey(const ValueKey('rider-toast'));
    expect(
      t.getRect(toast).top,
      greaterThanOrEqualTo(kToolbarHeight),
      reason: '위 막대 아래',
    );
    await t.tapAt(t.getCenter(find.byKey(const ValueKey('under'))));
    await t.pump();
    expect(pressed, 1);
  });
}
