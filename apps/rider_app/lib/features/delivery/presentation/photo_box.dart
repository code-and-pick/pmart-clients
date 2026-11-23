import 'dart:async';
import 'dart:io' show Platform;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../shared/rider_widgets.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../data/delivery_repository.dart';
import 'delivery_controller.dart';

/// 시험용 1×1 PNG.
final testPhotoBytes = Uint8List.fromList(const [
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, //
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0,
  0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);

bool get _testing => Platform.environment.containsKey('FLUTTER_TEST');

/// 카메라로 한 장 찍는다. 취소하면 null. 시험 실행에서는 가짜 사진을 돌려준다.
final photoCaptureProvider = Provider<Future<LocalPhoto?> Function()>(
  (_) => () async {
    if (_testing) return (bytes: testPhotoBytes, filename: 'test.png');
    final shot = await ImagePicker().pickImage(
      source: ImageSource.camera,
      // 10MB 제한 안으로 줄인다.
      maxWidth: 1600,
      imageQuality: 80,
      requestFullMetadata: false,
    );
    if (shot == null) return null;
    return (bytes: await shot.readAsBytes(), filename: shot.name);
  },
);

/// 카메라를 여는 동안 Android 가 앱을 내렸다가 다시 켰으면, 찍은 사진을 되찾는다.
Future<LocalPhoto?> recoverLostPhoto() async {
  if (_testing || !Platform.isAndroid) return null;
  try {
    final lost = await ImagePicker().retrieveLostData();
    final file = lost.file;
    if (lost.isEmpty || file == null) return null;
    return (bytes: await file.readAsBytes(), filename: file.name);
  } on Exception {
    return null;
  }
}

/// 증빙 사진 칸: 찍기 → 올리기 → "사진 올리기 완료" + 미리보기.
/// "다시 찍기"를 누르면 먼저 이전 사진을 크게 보여 주고, 새로 찍을지 고르게 한다.
/// 사진은 메모리에만 두고 기기 앨범에 저장하지 않는다.
class EvidencePhotoBox extends ConsumerStatefulWidget {
  const EvidencePhotoBox({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<EvidencePhotoBox> createState() => _EvidencePhotoBoxState();
}

class _EvidencePhotoBoxState extends ConsumerState<EvidencePhotoBox> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final lost = await recoverLostPhoto();
      if (lost != null && mounted) await _upload(lost);
    });
  }

  DeliveryFlowController get _ctl =>
      ref.read(deliveryFlowProvider(widget.deliveryId).notifier);

  Future<void> _upload(LocalPhoto photo) => _ctl.uploadPhoto(photo);

  Future<void> _shoot() async {
    final photo = await ref.read(photoCaptureProvider)();
    if (photo == null || !mounted) return;
    await _upload(photo);
  }

  Future<void> _retake(LocalPhoto previous) async {
    final l10n = AppLocalizations.of(context);
    final again = await showDialog<bool>(
      context: context,
      builder: (context) => RiderAlertDialog(
        key: const ValueKey('previous-photo'),
        title: Text(l10n.previousPhoto),
        contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        content: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: _PhotoImage(bytes: previous.bytes, height: 320),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepPhoto),
          ),
          TextButton(
            key: const ValueKey('retake-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.takeNewPhoto),
          ),
        ],
      ),
    );
    if (again == true) await _shoot();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flow = ref.watch(deliveryFlowProvider(widget.deliveryId));
    final photo = flow.photo;
    if (photo == null) {
      return OutlinedButton.icon(
        key: const ValueKey('take-photo'),
        onPressed: flow.uploading ? null : _shoot,
        icon: const Icon(Icons.photo_camera_outlined),
        label: Text(l10n.takePhotoShort),
        style: OutlinedButton.styleFrom(
          foregroundColor: RiderColors.primary,
          minimumSize: const Size.fromHeight(56),
          side: const BorderSide(color: RiderColors.primary),
          textStyle: const TextStyle(
            fontFamily: riderFontFamily,
            fontSize: 17,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }
    final status = flow.uploading
        ? l10n.photoUploading
        : flow.photoRef != null
        ? l10n.photoDone
        : l10n.uploadFailed;
    return Row(
      key: const ValueKey('photo-box'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => _retake(photo),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              width: 96,
              height: 96,
              child: _PhotoImage(bytes: photo.bytes, height: 96),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (flow.photoRef != null && !flow.uploading)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(
                        Icons.check_circle,
                        size: 20,
                        color: RiderColors.primary,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      status,
                      key: const ValueKey('photo-status'),
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: flow.uploadFailed && !flow.uploading
                            ? RiderColors.danger
                            : RiderColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    key: const ValueKey('retake-photo'),
                    onPressed: flow.uploading ? null : () => _retake(photo),
                    child: Text(l10n.retakePhoto),
                  ),
                  if (flow.uploadFailed && !flow.uploading)
                    OutlinedButton(
                      key: const ValueKey('retry-upload'),
                      // 같은 사진을 같은 키로 다시 올린다.
                      onPressed: () => _ctl.uploadPhoto(),
                      child: Text(l10n.retryUpload),
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PhotoImage extends StatelessWidget {
  const _PhotoImage({required this.bytes, required this.height});

  final Uint8List bytes;
  final double height;

  @override
  Widget build(BuildContext context) => Image.memory(
    bytes,
    height: height,
    fit: BoxFit.cover,
    gaplessPlayback: true,
    errorBuilder: (_, _, _) => SizedBox(
      height: height,
      child: const ColoredBox(
        color: RiderColors.field,
        child: Center(
          child: Icon(Icons.image_outlined, color: RiderColors.sub),
        ),
      ),
    ),
  );
}
