// 마이페이지 프로필 사진·내 정보(사용자 2026-11-25): 로그인 ID 토큰의 picture·email(이 기기에만),
// "라이더님 ›" → 이름·전화번호·로그인 계정·운행수단(바꾸기, `PATCH /riders/me` vehicleType).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/rider_auth.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/auth/data/signup.dart' show Vehicle;
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/features/my/data/profile_photo.dart';
import 'package:rider_app/shared/providers.dart';

String _jwt(Map<String, Object?> claims) {
  String part(Object o) =>
      base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${part({'alg': 'RS256'})}.${part(claims)}.sig';
}

void main() {
  setUpAll(initPmartFormatting);

  group('accountFromIdToken', () {
    test('OIDC picture·email(구글)을 읽는다', () {
      final a = accountFromIdToken(
        _jwt({
          'sub': '1',
          'picture': 'https://lh3.example.com/a.jpg',
          'email': 'rider@example.com',
        }),
      );
      expect(a.pictureUrl, 'https://lh3.example.com/a.jpg');
      expect(a.email, 'rider@example.com');
    });
    test('네이버식 profile_image 도 읽는다', () {
      expect(
        accountFromIdToken(
          _jwt({'profile_image': 'https://phinf.example.net/p.png'}),
        ).pictureUrl,
        'https://phinf.example.net/p.png',
      );
    });
    test('없거나 https 가 아니거나 깨진 토큰이면 빈 값', () {
      expect(accountFromIdToken(_jwt({'sub': '1'})).isEmpty, isTrue);
      expect(
        accountFromIdToken(
          _jwt({'picture': 'http://x.example.com/a.jpg', 'email': 'nope'}),
        ).isEmpty,
        isTrue,
      );
      expect(accountFromIdToken('not-a-token').isEmpty, isTrue);
      expect(accountFromIdToken('a.!!!.c').isEmpty, isTrue);
    });
  });

  test('저장소: 라이더마다 따로, 로그인할 때마다 그 계정 값으로 바꾼다', () async {
    final store = LoginAccountStore(MemoryKeyValueStore());
    await store.save(
      'r1',
      const LoginAccountInfo(
        pictureUrl: 'https://a.example.com/p.jpg',
        email: 'a@example.com',
      ),
    );
    expect((await store.load('r1')).email, 'a@example.com');
    expect((await store.load('r2')).isEmpty, isTrue);
    await store.save('r1', const LoginAccountInfo(email: 'b@example.com'));
    final r1 = await store.load('r1');
    expect(r1.pictureUrl, isNull);
    expect(r1.email, 'b@example.com');
    await store.delete('r1');
    expect((await store.load('r1')).isEmpty, isTrue);
  });

  Future<void> openMyPage(
    WidgetTester t,
    MemoryKeyValueStore secure, {
    MockProfileRepository? profile,
  }) async {
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          initialSessionProvider.overrideWithValue(
            const RiderSession(
              riderId: 'rider-mock-1',
              provider: RiderSocialProvider.google,
            ),
          ),
          secureStoreProvider.overrideWithValue(secure),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
          if (profile != null)
            profileRepositoryProvider.overrideWithValue(profile),
        ],
        child: const RiderApp(),
      ),
    );
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 50));
    }
    await t.tap(find.byKey(const ValueKey('my-page')).first);
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    // 오늘 기록(목) 지연이 끝나게.
    await t.pump(const Duration(milliseconds: 300));
  }

  testWidgets('마이페이지 동그라미: 로그인 사진이 없으면 사람 그림(누를 것 없음)', (t) async {
    await openMyPage(t, MemoryKeyValueStore());
    final avatar = find.byKey(const ValueKey('profile-photo'));
    expect(avatar, findsOneWidget);
    expect(
      find.descendant(
        of: avatar,
        matching: find.byKey(const ValueKey('profile-photo-empty')),
      ),
      findsOneWidget,
    );
    expect(
      find.ancestor(of: avatar, matching: find.byType(InkWell)),
      findsNothing,
    );
  });

  testWidgets('마이페이지 동그라미: 로그인 때 받은 사진 주소로 그린다', (t) async {
    final secure = MemoryKeyValueStore();
    await LoginAccountStore(secure).save(
      'rider-mock-1',
      const LoginAccountInfo(pictureUrl: 'https://lh3.example.com/a.jpg'),
    );
    await openMyPage(t, secure);
    final img = t.widget<Image>(
      find.descendant(
        of: find.byKey(const ValueKey('profile-photo')),
        matching: find.byType(Image),
      ),
    );
    expect((img.image as NetworkImage).url, 'https://lh3.example.com/a.jpg');
  });

  testWidgets('마이페이지 동그라미: 서버 사본(rider 0.31.0 profile-image)이 있으면 그것을 먼저', (
    t,
  ) async {
    final secure = MemoryKeyValueStore();
    await LoginAccountStore(secure).save(
      'rider-mock-1',
      const LoginAccountInfo(pictureUrl: 'https://lh3.example.com/a.jpg'),
    );
    // 1×1 투명 PNG
    final png = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    );
    final profile = MockProfileRepository()..mockImage = png;
    await openMyPage(t, secure, profile: profile);
    expect(find.byKey(const ValueKey('profile-photo-server')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('profile-photo')),
        matching: find.byWidgetPredicate(
          (w) => w is Image && w.image is NetworkImage,
        ),
      ),
      findsNothing,
    );
  });

  String rowText(WidgetTester t, String key) => t
      .widgetList<Text>(
        find.descendant(
          of: find.byKey(ValueKey(key)),
          matching: find.byType(Text),
        ),
      )
      .map((w) => w.data)
      .join(' / ');

  Future<void> openInfo(WidgetTester t) async {
    await t.tap(find.byKey(const ValueKey('my-name')));
    await t.pumpAndSettle();
  }

  Future<void> pickVehicle(WidgetTester t, String name) async {
    await t.tap(find.byKey(const ValueKey('info-vehicle')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(ValueKey('vehicle-$name')));
    await t.pumpAndSettle();
  }

  Future<void> clearToast(WidgetTester t) async {
    await t.pump(const Duration(seconds: 5));
    await t.pumpAndSettle();
  }

  testWidgets('라이더님 › → 내 정보: 이름·전화번호·로그인 계정(제공자 · 이메일)·운행수단', (t) async {
    final secure = MemoryKeyValueStore();
    await LoginAccountStore(
      secure,
    ).save('rider-mock-1', const LoginAccountInfo(email: 'rider@example.com'));
    await openMyPage(t, secure);
    await openInfo(t);
    expect(find.text('내 정보'), findsOneWidget);
    expect(rowText(t, 'info-name'), '이름 / 홍길동');
    expect(rowText(t, 'info-phone'), '전화번호 / 010****5678');
    expect(rowText(t, 'info-account'), '로그인 계정 / Google · rider@example.com');
    expect(rowText(t, 'info-vehicle'), '운행수단 / 자전거');
  });

  testWidgets('운행수단: 도보로 바로 바꾸고, 오토바이는 면허 번호를 받아 함께 보낸다', (t) async {
    final repo = MockProfileRepository();
    await openMyPage(t, MemoryKeyValueStore(), profile: repo);
    await openInfo(t);

    await pickVehicle(t, 'walk');
    expect(repo.vehicle, Vehicle.walk);
    expect(find.text('운행수단을 바꿨어요'), findsOneWidget);
    expect(rowText(t, 'info-vehicle'), '운행수단 / 도보');
    await clearToast(t);

    // 면허 없음 → 오토바이: 번호 칸. 형식이 틀리면 막고, 다른 라이더 면허면 서버 거절을 그대로 안내.
    await pickVehicle(t, 'motorcycle');
    // 팝업이 아니라 새 화면(사용자 2026-11-25). 12자리를 다 넣기 전에는 버튼이 꺼져 있다.
    expect(find.text('운전면허 등록'), findsOneWidget);
    expect(find.byType(AlertDialog), findsNothing);
    await t.enterText(find.byKey(const ValueKey('license-input')), '1234');
    await t.pump();
    expect(
      t
          .widget<FilledButton>(
            find.descendant(
              of: find.byKey(const ValueKey('license-ok')),
              matching: find.byType(FilledButton),
            ),
          )
          .onPressed,
      isNull,
    );
    await t.enterText(
      find.byKey(const ValueKey('license-input')),
      '11-22-333333-44',
    );
    await t.pump();
    await t.tap(find.byKey(const ValueKey('license-ok')));
    await t.pumpAndSettle();
    expect(repo.vehicle, Vehicle.walk);
    expect(find.text('이미 다른 라이더가 등록한 면허예요'), findsOneWidget);
    await clearToast(t);

    await pickVehicle(t, 'motorcycle');
    await t.enterText(
      find.byKey(const ValueKey('license-input')),
      '12-34-567890-12',
    );
    await t.pump();
    await t.tap(find.byKey(const ValueKey('license-ok')));
    await t.pumpAndSettle();
    expect(repo.vehicle, Vehicle.motorcycle);
    expect(rowText(t, 'info-vehicle'), '운행수단 / 오토바이');
    await clearToast(t);
  });

  testWidgets('운행수단: 배송 중(409 INVALID_STATE)이면 바꾸지 못했다고 안내', (t) async {
    final repo = MockProfileRepository()
      ..failNextVehicle = const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
    await openMyPage(t, MemoryKeyValueStore(), profile: repo);
    await openInfo(t);
    await pickVehicle(t, 'walk');
    expect(repo.vehicle, Vehicle.bicycle);
    expect(find.text('배송 중에는 운행수단을 바꿀 수 없어요'), findsOneWidget);
    await clearToast(t);
  });
}
