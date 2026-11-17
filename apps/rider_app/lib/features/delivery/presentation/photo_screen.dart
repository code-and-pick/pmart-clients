import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/delivery_repository.dart' show LocalPhoto;
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'photo_box.dart';

/// 전달위치 촬영("'여기에 두었어요' 알리기") → 증빙 사진 올리기(`POST /deliveries/{id}/evidence-photos`).
/// 올리기에 성공하면 이 창이 닫히고, 배송 화면의 전달완료를 누를 수 있다.
///
/// - 이미 찍은 사진이 있으면 크게 보여 준다 — 다시 찍기 전에 이전 사진을 확인한다(사용자 요청 2026-11-16).
/// - 고객 도착은 따로 누르지 않는다. 서버는 도착 뒤에만 완료를 받으므로, 이 창을 열 때 아직 픽업
///   상태면 고객 도착을 대신 보낸다.
/// - 사진은 메모리에만 두고 기기 앨범에 저장하지 않는다.
class PhotoScreen extends ConsumerStatefulWidget {
  const PhotoScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<PhotoScreen> createState() => _PhotoScreenState();
}

class _PhotoScreenState extends ConsumerState<PhotoScreen> {
  String get _id => widget.deliveryId;

  DeliveryFlowController get _ctl =>
      ref.read(deliveryFlowProvider(_id).notifier);

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      try {
        final d = await ref.read(deliveryProvider(_id).future);
        if (d.state == ExecutionState.pickedUp && mounted) {
          await _ctl.arriveAtCustomer();
        }
      } on PmartFailure {
        // 전달완료 때 다시 확인한다.
      }
      // 카메라를 여는 동안 앱이 내려졌다 다시 켜졌으면 찍은 사진을 되찾아 올린다.
      final lost = await recoverLostPhoto();
      if (lost != null && mounted) await _upload(lost);
    });
  }

  Future<void> _upload(LocalPhoto photo) async {
    await _ctl.uploadPhoto(photo);
    if (!mounted) return;
    // 올리기에 성공하면 창을 닫고 배송 화면으로 돌아간다.
    if (ref.read(deliveryFlowProvider(_id)).photoRef != null) context.pop();
  }

  Future<void> _shoot() async {
    final photo = await ref.read(photoCaptureProvider)();
    if (photo == null || !mounted) return;
    await _upload(photo);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flow = ref.watch(deliveryFlowProvider(_id));
    final photo = flow.photo;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.photoTitle),
      body: Column(
        children: [
          Expanded(
            child: Container(
              width: double.infinity,
              color: const Color(0xFF4A4D52),
              alignment: Alignment.center,
              child: photo == null
                  ? Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.photo_camera_outlined,
                            color: Colors.white54,
                            size: 56,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            l10n.photoAsk,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              height: 1.5,
                            ),
                          ),
                        ],
                      ),
                    )
                  : _Preview(
                      bytes: photo.bytes,
                      caption: flow.uploading
                          ? l10n.photoUploading
                          : flow.photoRef != null
                          ? l10n.previousPhoto
                          : l10n.uploadFailed,
                    ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.photoHeading,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  l10n.photoGuide,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.5,
                    color: RiderColors.sub,
                  ),
                ),
                if (flow.uploadFailed && !flow.uploading)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.uploadFailed,
                            key: const ValueKey('upload-failed'),
                            style: const TextStyle(
                              fontSize: 13,
                              color: RiderColors.danger,
                            ),
                          ),
                        ),
                        TextButton(
                          key: const ValueKey('retry-upload'),
                          // 같은 사진을 같은 키로 다시 올린다.
                          onPressed: () async {
                            await _ctl.uploadPhoto();
                            if (context.mounted &&
                                ref.read(deliveryFlowProvider(_id)).photoRef !=
                                    null) {
                              context.pop();
                            }
                          },
                          child: Text(l10n.retryUpload),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: SizedBox(
              width: double.infinity,
              height: 60,
              child: FilledButton(
                key: const ValueKey('upload-photo'),
                style: FilledButton.styleFrom(
                  backgroundColor: RiderColors.primary,
                  disabledBackgroundColor: RiderColors.disabled,
                  shape: const RoundedRectangleBorder(),
                ),
                onPressed: flow.uploading ? null : _shoot,
                child: Text(
                  photo == null ? l10n.photoShoot : l10n.retakePhoto,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 찍은 사진 미리보기(이전 사진 확인용).
class _Preview extends StatelessWidget {
  const _Preview({required this.bytes, required this.caption});

  final Uint8List bytes;
  final String caption;

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      Image.memory(
        bytes,
        key: const ValueKey('photo-preview'),
        fit: BoxFit.contain,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) =>
            const Icon(Icons.image_outlined, color: Colors.white54, size: 56),
      ),
      Positioned(
        left: 0,
        right: 0,
        bottom: 0,
        child: Container(
          color: Colors.black54,
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            caption,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
        ),
      ),
    ],
  );
}
