import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../data/profile_photo.dart';

/// 마이페이지 오른쪽 위(톱니 밑) 동그라미 = 로그인한 구글·네이버 계정의 프로필 사진(보기만).
/// 사진이 없거나 못 불러오면 회색 원 안 사람 그림.
class ProfileAvatar extends ConsumerWidget {
  const ProfileAvatar({super.key, this.size = 60});

  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 서버 사본이 먼저(rider 0.31.0), 없으면 로그인 때 받은 사진 주소, 그것도 없으면 기본 그림.
    final bytes = ref.watch(serverProfileImageProvider).value;
    final url = ref.watch(profilePhotoProvider);
    final placeholder = ColoredBox(
      key: const ValueKey('profile-photo-empty'),
      color: const Color(0xFFEDEDF0),
      child: Icon(Icons.person, size: size * 0.62, color: RiderColors.hint),
    );
    return Semantics(
      image: true,
      label: AppLocalizations.of(context).profilePhoto,
      child: Container(
        key: const ValueKey('profile-photo'),
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: RiderColors.line),
        ),
        child: ClipOval(
          child: bytes != null
              ? Image.memory(
                  bytes,
                  key: const ValueKey('profile-photo-server'),
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder: (_, _, _) => placeholder,
                )
              : url == null
              ? placeholder
              : Image.network(
                  url,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => placeholder,
                ),
        ),
      ),
    );
  }
}
