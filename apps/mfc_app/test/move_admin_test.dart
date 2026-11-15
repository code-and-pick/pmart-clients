import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_mfc_inventory/pmart_api_mfc_inventory.dart' as inv;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:mfc_app/app.dart';
import 'package:mfc_app/features/auth/data/auth_repository.dart';
import 'package:mfc_app/features/auth/domain/employee_auth.dart';
import 'package:mfc_app/features/auth/presentation/auth_controller.dart';
import 'package:mfc_app/features/manage/data/move_admin_repository.dart';
import 'package:mfc_app/features/stock_move/data/mock_stock_move_repository.dart';
import 'package:mfc_app/features/stock_move/domain/stock_move.dart';
import 'package:mfc_app/features/tasks/data/mock_task_repository.dart';
import 'package:mfc_app/features/tasks/presentation/task_controllers.dart';
import 'package:mfc_app/features/work/data/mock_work_repository.dart';
import 'package:mfc_app/features/work/presentation/work_controller.dart';
import 'package:mfc_app/shared/field_repositories.dart';
import 'package:mfc_app/shared/providers.dart';

/// 센터 관리자 이동 지시 만들기·취소(사용자 2026-11-16, mfc-inbound move-orders).
void main() {
  setUpAll(initPmartFormatting);

  late MockStockMoveRepository moves;

  Future<void> pump(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final tasks = MockTaskRepository(latency: Duration.zero);
    moves = MockStockMoveRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(
            MockAuthRepository(
              session: const EmployeeSession(
                operatorId: 'OP-mock-sup',
                roles: [EmployeeSession.mfcSupervisorRole],
                centers: ['MFC-MOCK-01'],
              ),
            ),
          ),
          taskRepositoryProvider.overrideWithValue(tasks),
          workRepositoryProvider.overrideWithValue(
            MockWorkRepository(tasks: tasks, latency: Duration.zero),
          ),
          stockMoveRepositoryProvider.overrideWithValue(moves),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
        child: const MfcApp(),
      ),
    );
    await t.pumpAndSettle();
    await tap(t, 'manage-moves');
  }

  Future<void> scan(WidgetTester t, String id, String code) async {
    await t.enterText(find.byKey(ValueKey(id)), code);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await t.pumpAndSettle();
  }

  testWidgets('새 지시: 상품 → 출발(정상·보관 재고) → 도착 칸 → 수량 → 지시, 목록에 보인다', (t) async {
    await pump(t);
    expect(find.byKey(const ValueKey('move-order-MV-mock-1')), findsOneWidget);
    await tap(t, 'new-move');

    // 모르는 바코드 → 안내, 다음으로 넘어가지 않는다.
    await scan(t, 'new-move-product', '0000000000000');
    expect(find.byKey(const ValueKey('new-move-error')), findsOneWidget);

    await scan(t, 'new-move-product', '8801115114154'); // 우유
    expect(find.text('E-00000001'), findsOneWidget);
    await tap(t, 'new-move-from-C-R1-01-1-01-LOT-M-1022');

    // 출발 칸과 같은 칸·칸 아닌 값은 받지 않는다.
    await scan(t, 'new-move-to', 'C-R1-01-1-01');
    expect(find.text('출발 칸과 같은 칸이에요'), findsWidgets);
    await scan(t, 'new-move-to', 'C-S1-03-1-01');
    expect(find.byKey(const ValueKey('new-move-error')), findsNothing);

    await t.ensureVisible(find.byKey(const ValueKey('new-move-submit')));
    await tap(t, 'new-move-submit');
    expect(find.byKey(const ValueKey('new-move-done')), findsOneWidget);
    final created = moves.allMoves.firstWhere((m) => m.kind == MoveKind.move);
    expect(created.qty, 20); // 기본은 그 묶음 전부
    expect(created.fromLocation, 'C-R1-01-1-01');
    expect(created.toLocation, 'C-S1-03-1-01');

    await t.tap(find.text('목록으로'));
    await t.pumpAndSettle();
    // 목록 화면은 가려진 동안 멈췄다가 다시 보이면 새로 부른다 — 목 지연 동안은 이전 목록 그대로.
    await t.pump(const Duration(seconds: 1));
    await t.pumpAndSettle();
    expect(
      find.byKey(ValueKey('move-order-${created.moveId}')),
      findsOneWidget,
    );
  });

  testWidgets('취소: 사유를 넣어야 하고, 취소되면 목록에서 빠진다', (t) async {
    await pump(t);
    await tap(t, 'cancel-move-MV-mock-1');
    expect(find.byKey(const ValueKey('cancel-move-dialog')), findsOneWidget);
    final ok = find.byKey(const ValueKey('cancel-move-ok'));
    expect(t.widget<FilledButton>(ok).onPressed, isNull);
    await t.enterText(
      find.byKey(const ValueKey('cancel-move-reason')),
      '진열 변경',
    );
    await t.pump();
    await tap(t, 'cancel-move-ok');
    expect(find.text('취소됐어요'), findsOneWidget);
    expect(moves.moveById('MV-mock-1')!.state, MoveState.cancelled);
    expect(find.byKey(const ValueKey('manage-moves-empty')), findsOneWidget);
  });

  test('옮길 수 있는 재고는 정상·보관·수량 있는 묶음만, 소비기한은 LOT 에서', () {
    final units = movableUnitsFromContract(
      inv.CenterStock.fromJson({
        'mfcId': 'MFC-1',
        'sku': 'E-1',
        'lots': [
          {'lotId': 'L-1', 'expiryDate': '2026-12-01'},
        ],
        'units': [
          {
            'locationCode': 'C-S1-01-1-01',
            'lotId': 'L-1',
            'qualityState': 'NORMAL',
            'workState': 'STORED',
            'qty': 3,
          },
          {
            'locationCode': 'C-S1-01-1-02',
            'lotId': 'L-1',
            'qualityState': 'QUARANTINED',
            'workState': 'STORED',
            'qty': 2,
          },
          {
            'locationCode': 'C-S1-01-1-03',
            'lotId': 'L-1',
            'qualityState': 'NORMAL',
            'workState': 'PICKED',
            'qty': 1,
          },
          {
            'locationCode': 'C-S1-01-1-04',
            'lotId': 'L-1',
            'qualityState': 'NORMAL',
            'workState': 'STORED',
            'qty': 0,
          },
        ],
      }),
    );
    expect(units.single.locationCode, 'C-S1-01-1-01');
    expect(units.single.expiryDate, '2026-12-01');
  });
}

Future<void> tap(WidgetTester t, String key) async {
  await t.tap(find.byKey(ValueKey(key)));
  await t.pumpAndSettle();
}
