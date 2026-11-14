import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../l10n/gen/app_localizations.dart';
import '../printer/reprint.dart';
import '../providers.dart';
import 'scanner.dart';

/// 테스트용 일괄 동작(목 모드 전용) — 예: 남은 박스 전부 스캔. 동작 안에서도 실제 스캔과 같은 처리를 부른다.
@immutable
class TestAction {
  const TestAction(this.key, this.label, this.run);

  final String key;
  final String label;
  final VoidCallback run;
}

/// 테스트용 스캔 값(목 모드 전용). 고르면 실제 스캔과 같은 [ScanInput.onScan] 을 탄다.
@immutable
class TestScan {
  const TestScan(this.label, this.value);

  final String label;
  final String value;
}

/// 스캔 입력. 스캔 받는 자리는 키보드 웨지(하드웨어 스캐너)의 입력을 받고, 카메라 버튼은 카메라 스캐너를 연다.
/// 두 경로 모두 같은 [onScan] 으로 간다. 실제 앱(안드로이드)은 스캔으로만 확인한다 — 화면 키보드가 뜨지 않아
/// 손으로 칠 수 없다. (PC 브라우저처럼 실제 키보드가 달린 곳에서는 키 입력을 스캐너와 구별하지 못한다 — 개발 확인용.)
/// 목 모드(`PMART_ENV=mock` — 웹 미리보기·테스트)에서만 [testValues] 드롭다운이 보인다.
class ScanInput extends ConsumerStatefulWidget {
  const ScanInput({
    super.key,
    required this.id,
    required this.label,
    required this.cameraTitle,
    required this.onScan,
    this.continuous = true,
    this.autofocus = true,
    this.testValues = const [],
    this.testActions = const [],
    this.reprint,
  });

  /// 입력칸 키는 `ValueKey(id)`, 카메라 버튼은 `ValueKey('$id-camera')`.
  final String id;
  final String label;
  final String cameraTitle;
  final ScanHandler onScan;
  final bool continuous;
  final bool autofocus;

  /// 그 단계에 맞는 더미 스캔 값(틀린 값 포함). 목 모드에서만 쓴다.
  final List<TestScan> testValues;

  /// 일괄 처리 같은 테스트 동작. 목 모드에서만 쓴다.
  final List<TestAction> testActions;

  /// 상품 스캔 자리면 그 자리에서 찍을 수 있는 상품들 — "바코드가 안 찍혀요"(재출력) 버튼을 아래에 둔다.
  /// null 이면 버튼이 없다(위치·카트·포장 QR 같은 자리). 빈 목록이면 버튼은 있되 누를 수 없다.
  final List<ReprintTarget>? reprint;

  @override
  ConsumerState<ScanInput> createState() => _ScanInputState();
}

class _ScanInputState extends ConsumerState<ScanInput> {
  final _text = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _submit(String v) {
    final code = v.trim();
    _text.clear();
    // 하드웨어 스캐너(키보드 웨지)가 다음 입력을 계속 받게 한다.
    _focus.requestFocus();
    if (code.isEmpty) return;
    widget.onScan(code);
  }

  Future<void> _camera() async {
    await ref
        .read(cameraScannerProvider)
        .open(
          context,
          onScan: widget.onScan,
          title: widget.cameraTitle,
          continuous: widget.continuous,
        );
    if (mounted && widget.autofocus) _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final row = _row(context);
    final reprint = widget.reprint;
    if (reprint == null) return row;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        row,
        BarcodeReprintButton(id: widget.id, targets: reprint),
      ],
    );
  }

  Widget _row(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          // 타이핑 칸이 아니라 "스캔 받는 자리"다(사용자 2026-11-13: 바코드만 찍는다 — 손 입력 칸은 숨긴다).
          // 하드웨어 스캐너(키보드 웨지)는 글자 + Enter 를 보내므로 받을 자리는 있어야 한다. 그래서 입력칸은 두되
          // 화면 키보드를 띄우지 않고(TextInputType.none), 커서·글자·붙여넣기 메뉴를 보이지 않게 한다.
          // 눌러서 이 자리를 고르면(포커스) 스캐너 입력이 여기로 온다.
          child: TextField(
            key: ValueKey(widget.id),
            controller: _text,
            focusNode: _focus,
            autofocus: widget.autofocus,
            keyboardType: TextInputType.none,
            showCursor: false,
            enableInteractiveSelection: false,
            autocorrect: false,
            enableSuggestions: false,
            style: const TextStyle(color: Colors.transparent),
            decoration: InputDecoration(
              labelText: widget.label,
              hintText: l10n.scanHint,
              floatingLabelBehavior: FloatingLabelBehavior.always,
              prefixIcon: const Icon(Icons.barcode_reader),
              filled: true,
            ),
            onSubmitted: _submit,
          ),
        ),
        const SizedBox(width: 8),
        IconButton.filled(
          key: ValueKey('${widget.id}-camera'),
          tooltip: l10n.scanWithCamera,
          iconSize: 32,
          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
          icon: const Icon(Icons.qr_code_scanner),
          onPressed: _camera,
        ),
        if (ref.watch(envProvider) == PmartEnv.mock &&
            (widget.testValues.isNotEmpty || widget.testActions.isNotEmpty))
          PopupMenuButton<String>(
            key: ValueKey('${widget.id}-test'),
            tooltip: l10n.testScan,
            icon: const Icon(Icons.science_outlined),
            onSelected: (v) {
              final action = widget.testActions
                  .where((a) => 'action:${a.key}' == v)
                  .firstOrNull;
              if (action != null) {
                action.run();
              } else {
                _submit(v);
              }
            },
            itemBuilder: (_) => [
              for (final a in widget.testActions)
                PopupMenuItem(
                  key: ValueKey('${widget.id}-action-${a.key}'),
                  value: 'action:${a.key}',
                  child: Text(
                    a.label,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              if (widget.testActions.isNotEmpty && widget.testValues.isNotEmpty)
                const PopupMenuDivider(),
              for (final t in widget.testValues)
                PopupMenuItem(
                  key: ValueKey('${widget.id}-test-${t.value}'),
                  value: t.value,
                  child: Text('${t.label}  ${t.value}'),
                ),
            ],
          ),
      ],
    );
  }
}
