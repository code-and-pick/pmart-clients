import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';

/// 포장 인계(QR)에 싣는 라이더 ID 는 로그인 세션의 라이더다(2026-11-18 — 목 라이더로 고정이라 실서버에서
/// MFC 가 403 RIDER_MISMATCH 로 막았다).
void main() {
  test('로그인 세션이 있으면 그 라이더 ID', () {
    final c = ProviderContainer(
      overrides: [
        initialSessionProvider.overrideWithValue(
          const RiderSession(riderId: 'RD-real-1'),
        ),
      ],
    );
    addTearDown(c.dispose);
    expect(c.read(currentRiderIdProvider), 'RD-real-1');
  });

  test('세션이 없으면 목 라이더', () {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    expect(c.read(currentRiderIdProvider), MockDeliveryRepository.riderId);
  });
}
