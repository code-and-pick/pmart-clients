import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mfc_app/l10n/gen/app_localizations.dart';
import 'package:mfc_app/shared/field_widgets.dart';

void main() {
  Future<int Function()> pumpDone(
    WidgetTester t, {
    required bool autoNext,
  }) async {
    var calls = 0;
    await t.pumpWidget(
      MaterialApp(
        locale: const Locale('ko'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: TaskDoneView(
            title: '이동 완료',
            message: '다 옮겼어요',
            rows: const [],
            autoNext: autoNext,
            onNext: () async => calls++,
          ),
        ),
      ),
    );
    return () => calls;
  }

  testWidgets('휴게 중이면 10초가 지나도 자동으로 다음 작업을 받지 않는다', (t) async {
    final calls = await pumpDone(t, autoNext: false);
    expect(find.text('휴게 중이라 자동으로 다음 작업을 받지 않아요'), findsOneWidget);
    expect(find.byKey(const ValueKey('done-auto-next')), findsNothing);
    await t.pump(const Duration(seconds: 15));
    expect(calls(), 0);
    // 버튼은 그대로 누를 수 있다.
    await t.tap(find.byKey(const ValueKey('result-action')));
    await t.pump();
    expect(calls(), 1);
  });

  testWidgets('휴게 중이 아니면 10초 뒤 한 번만 자동으로 넘어간다', (t) async {
    final calls = await pumpDone(t, autoNext: true);
    expect(find.text('10초 뒤 자동으로 다음 작업을 받아요'), findsOneWidget);
    await t.pump(const Duration(seconds: 9));
    expect(calls(), 0);
    await t.pump(const Duration(seconds: 1));
    await t.pump(const Duration(seconds: 5));
    expect(calls(), 1);
  });
}
