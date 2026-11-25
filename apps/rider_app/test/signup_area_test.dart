// 가입 배달 지역(사용자 2026-11-25): 지점은 다 고를 수 있지만 "선택완료"에서 거주지 주소의 권역이 아니면 팝업으로 막는다.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rider_app/features/auth/data/signup.dart' show AreaOption;
import 'package:rider_app/features/auth/presentation/signup_screens.dart'
    show AreaSheet;
import 'package:rider_app/l10n/gen/app_localizations.dart';
import 'package:rider_app/shared/mfc_directory.dart';

const _busan = AreaOption(
  region: MfcRegion.gyeongsang,
  mfcId: 'MFC-BSJ-01',
  name: '부산진구지점',
);
const _mokpo = AreaOption(
  region: MfcRegion.jeolla,
  mfcId: 'MFC-MPO-01',
  name: '목포지점',
);
const _areas = {
  MfcRegion.gyeongsang: [_busan],
  MfcRegion.jeolla: [_mokpo],
};

Future<AreaOption?> _pick(
  WidgetTester t, {
  required String residence,
  required String region,
  required String branch,
}) async {
  AreaOption? result;
  await t.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              result = await showModalBottomSheet<AreaOption>(
                context: context,
                isScrollControlled: true,
                builder: (_) =>
                    const AreaSheet(areas: _areas).copyWithResidence(residence),
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await t.tap(find.text('open'));
  await t.pumpAndSettle();
  await t.tap(find.byKey(ValueKey('area-$region')));
  await t.pump();
  await t.tap(find.byKey(const ValueKey('area-confirm')));
  await t.pumpAndSettle();
  await t.tap(find.byKey(ValueKey('area-$branch')));
  await t.pump();
  await t.tap(find.byKey(const ValueKey('area-confirm')));
  await t.pumpAndSettle();
  return result;
}

extension on AreaSheet {
  AreaSheet copyWithResidence(String residence) =>
      AreaSheet(initial: initial, areas: areas, residence: residence);
}

void main() {
  test('주소의 시·도로 권역을 정한다', () {
    expect(regionOfAddress('부산 부산진구 동천로 109'), MfcRegion.gyeongsang);
    expect(regionOfAddress('경상남도 김해시 …'), MfcRegion.gyeongsang);
    expect(regionOfAddress('전남 목포시 …'), MfcRegion.jeolla);
    expect(regionOfAddress('세종특별자치시 …'), MfcRegion.chungcheong);
    expect(regionOfAddress('강원특별자치도 춘천시 …'), MfcRegion.gangwon);
    expect(regionOfAddress('서울 강남구 …'), isNull);
    expect(regionOfAddress(''), isNull);
  });

  testWidgets('거주지와 같은 권역 지점은 바로 고른다', (t) async {
    final r = await _pick(
      t,
      residence: '부산 부산진구 동천로 109',
      region: 'gyeongsang',
      branch: '부산진구지점',
    );
    expect(r?.mfcId, 'MFC-BSJ-01');
    expect(find.byKey(const ValueKey('area-residence-dialog')), findsNothing);
  });

  testWidgets('다른 권역 지점은 고를 수는 있지만 선택완료에서 팝업, 닫히지 않는다', (t) async {
    final r = await _pick(
      t,
      residence: '부산 부산진구 동천로 109',
      region: 'jeolla',
      branch: '목포지점',
    );
    expect(r, isNull);
    expect(find.byKey(const ValueKey('area-residence-dialog')), findsOneWidget);
    expect(find.text('거주지 주소가 있는 경상권 안의 지점만 고를 수 있어요.'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('area-residence-ok')));
    await t.pumpAndSettle();
    // 시트는 그대로 — 다른 지점을 고를 수 있다
    expect(find.byKey(const ValueKey('area-confirm')), findsOneWidget);
  });

  testWidgets('거주지를 아직 안 넣었으면 먼저 넣으라고 팝업', (t) async {
    final r = await _pick(
      t,
      residence: '',
      region: 'gyeongsang',
      branch: '부산진구지점',
    );
    expect(r, isNull);
    expect(
      find.text('거주지 주소를 먼저 넣어 주세요. 거주지 권역 안의 지점만 고를 수 있어요.'),
      findsOneWidget,
    );
  });
}
