import 'package:dio/dio.dart';
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart'
    as api;
import 'package:pmart_core/pmart_core.dart';

import '../domain/task_list.dart';
import 'task_repository.dart';

/// 목 구현. 계약(`mfc-fulfillment-service.yaml`) 모양 JSON 을 생성 모델로 읽는다.
///
/// - task-mock-1: 배정된 피킹(4행, 출하 shp-1). 피킹이 끝나면 같은 주문의 패킹 shp-1-PACK 이
///   같은 작업자에게 배정된다(피킹·패킹 동일 인원 — 업무 문서 §7-6, 서버 보장은 BR-52 R20).
/// - task-mock-2: 진행 중 패킹(출하 shp-2) — [packDemo] 일 때만(패킹 화면 단독 시험).
/// - task-mock-3: 막힌 피킹(결품 보고).
/// - task-mock-4: 다른 작업자가 이미 시작한 피킹(ALREADY_STARTED 시연).
base class MockTaskRepository implements TaskRepository {
  MockTaskRepository({
    this.latency = const Duration(milliseconds: 300),
    bool packDemo = false,
  }) {
    _tasks
      ..['task-mock-1'] = _pickTask()
      ..['shp-1-PACK'] = _packOf(_pickTask(), 'shp-1-PACK')
      ..['shp-9-RETURN'] = returnTask();
    if (packDemo) {
      _tasks['task-mock-2'] = {
        'taskId': 'task-mock-2',
        'taskType': 'PACK',
        'state': 'IN_PROGRESS',
        'version': 3,
        'mfcId': 'MFC-MOCK-01',
        'shipmentId': 'shp-2',
        'assignment': {'workerId': workerId, 'assignmentVersion': 1},
        'activeStart': {
          'requestId': 'start-mock-2',
          'workerId': workerId,
          'startedAt': '2026-10-24T06:20:00Z',
        },
        'lineCount': 3,
        'plannedQty': 4,
        'headline': {'productName': '그릭요거트 플레인 400g', 'otherLineCount': 2},
        'remainingQty': 4,
        'lines': [
          {
            'taskLineId': 'task-mock-2-l1',
            'orderLineId': 'ol-1',
            'sku': 'E-00000002',
            'productName': '그릭요거트 플레인 400g',
            'barcode': yogurtBarcode,
            'plannedQty': 1,
            'completedQty': 0,
            'cancelledQty': 0,
            'remainingQty': 1,
            'pendingQty': 0,
          },
          {
            'taskLineId': 'task-mock-2-l2',
            'orderLineId': 'ol-2',
            'sku': 'E-00000001',
            'productName': '서울우유 1L',
            'barcode': milkBarcode,
            'plannedQty': 2,
            'completedQty': 0,
            'cancelledQty': 0,
            'remainingQty': 2,
            'pendingQty': 0,
          },
          // 냉동 — 냉장과 같은 봉투에 담을 수 없다(온도별 포장).
          {
            'taskLineId': 'task-mock-2-l3',
            'orderLineId': 'ol-4',
            'sku': 'E-00000031',
            'productName': '냉동 왕만두 1kg',
            'barcode': dumplingBarcode,
            'plannedQty': 1,
            'completedQty': 0,
            'cancelledQty': 0,
            'remainingQty': 1,
            'pendingQty': 0,
          },
        ],
      };
    }
    _tasks
      ..['task-mock-3'] = {
        ..._pickTask(id: 'task-mock-3'),
        'state': 'BLOCKED',
        'blockReason': '결품 보고(고객 확인 대기)',
      }
      ..['task-mock-4'] = {
        ..._pickTask(id: 'task-mock-4'),
        'assignment': {'workerId': workerId, 'assignmentVersion': 1},
      };
  }

  final Duration latency;
  static const workerId = 'OP-mock-1';

  /// 취소품 복귀 작업(집품 뒤 취소된 주문의 요거트 2개 — 포장 위치 PAK-C-03 → 선반).
  static Map<String, Object?> returnTask() => {
    'taskId': 'shp-9-RETURN',
    'taskType': 'RETURN',
    'state': 'ASSIGNED',
    'version': 1,
    'mfcId': 'MFC-MOCK-01',
    'shipmentId': 'shp-9',
    'assignment': {'workerId': workerId, 'assignmentVersion': 1},
    'lineCount': 1,
    'plannedQty': 2,
    'remainingQty': 2,
    'lines': [
      {
        'taskLineId': 'shp-9-RETURN:ol-91',
        'orderLineId': 'ol-91',
        'sku': 'E-00000002',
        'productName': '그릭요거트 플레인 400g',
        'barcode': yogurtBarcode,
        'lotId': 'LOT-Y-1024',
        'plannedQty': 2,
        'completedQty': 0,
        'cancelledQty': 0,
        'remainingQty': 2,
        'pendingQty': 0,
        'picks': [
          {
            'lotId': 'LOT-Y-1024',
            'remainingQty': 2,
            'locations': [
              {'locationCode': 'PAK-C-03', 'qty': 2},
            ],
            'suggestedToLocations': ['C-S1-01-1-01'],
          },
        ],
      },
    ],
  };
  static const milkBarcode = '8801115114154';
  static const yogurtBarcode = '8801115220015';
  static const chipsBarcode = '8801019606557';
  static const dumplingBarcode = '8801007310014';

  final _tasks = <String, Map<String, Object?>>{};
  final _startsByKey = <String, Map<String, Object?>>{};
  final _executions =
      <
        String,
        ({String taskId, Map<String, Object?> payload, int polls, String state})
      >{};
  final _executionByKey = <String, String>{};
  int _exeSeq = 0;

  /// 다음 시작 n회를 503 DEPENDENCY_UNAVAILABLE(시작 안 됨)로 만든다.
  int startUnavailable = 0;

  /// 다음 시작을 "점유는 됐지만 응답 잃음"으로 만든다.
  bool loseNextStartResponse = false;

  /// 연결이 끊긴 상태(실행 전송이 서버에 닿지 않는다).
  bool offline = false;

  /// 다음 실행 응답을 1회 잃는다(서버는 접수함).
  bool loseNextExecutionResponse = false;

  /// 실행이 재고 반영까지 몇 번 조회해야 하는지.
  int confirmPolls = 1;

  final sentExecutionKeys = <String>[];

  /// 처음 보낸 실행 본문(같은 키 재전송은 한 번만).
  final sentPayloads = <Map<String, Object?>>[];

  Future<void> _wait() => Future<void>.delayed(latency);

  /// 피킹 작업의 같은 주문 패킹 — 피킹이 끝나기 전에는 대기(WAITING).
  static Map<String, Object?> _packOf(Map<String, Object?> pick, String id) => {
    'taskId': id,
    'taskType': 'PACK',
    'state': 'WAITING',
    'version': 1,
    'mfcId': pick['mfcId'],
    'shipmentId': pick['shipmentId'],
    'assignment': {'workerId': workerId, 'assignmentVersion': 1},
    'lineCount': (pick['lines']! as List).length,
    'plannedQty': pick['plannedQty'],
    'remainingQty': pick['plannedQty'],
    'lines': [
      for (final l in (pick['lines']! as List).cast<Map<String, Object?>>())
        {
          'taskLineId': '$id:${l['orderLineId']}',
          'orderLineId': l['orderLineId'],
          'sku': l['sku'],
          'productName': l['productName'],
          'barcode': l['barcode'],
          'plannedQty': l['plannedQty'],
          'completedQty': 0,
          'cancelledQty': 0,
          'remainingQty': l['plannedQty'],
          'pendingQty': 0,
        },
    ],
  };

  static Map<String, Object?> _pickTask({String id = 'task-mock-1'}) => {
    'taskId': id,
    'taskType': 'PICK',
    'state': 'ASSIGNED',
    'version': 1,
    'mfcId': 'MFC-MOCK-01',
    'fulfillmentId': 'ful-1',
    'shipmentId': 'shp-1',
    'assignment': {'workerId': workerId, 'assignmentVersion': 2},
    'lineCount': 4,
    'plannedQty': 5,
    'headline': {'productName': '그릭요거트 플레인 400g', 'otherLineCount': 3},
    'completedQty': 0,
    'remainingQty': 5,
    'promisedReadyAt': '2026-10-24T06:20:00Z',
    'createdAt': '2026-10-24T06:00:00Z',
    'lines': [
      {
        'taskLineId': '$id-l1',
        'orderLineId': 'ol-1',
        'sku': 'E-00000002',
        'productName': '그릭요거트 플레인 400g',
        'barcode': yogurtBarcode,
        'locationId': 'C-S1-01-1-01',
        'lotId': 'LOT-Y-1024',
        'expiresOn': '2026-11-05',
        'picks': [
          {
            'lotId': 'LOT-Y-1024',
            'expiresOn': '2026-11-05',
            'remainingQty': 1,
            'visitSeq': 1,
            'pickStatus': 'OK',
            'locations': [
              {'locationCode': 'C-S1-01-1-01', 'qty': 6, 'allocatedQty': 1},
            ],
          },
        ],
        'plannedQty': 1,
        'completedQty': 0,
        'cancelledQty': 0,
        'remainingQty': 1,
        'pendingQty': 0,
      },
      {
        'taskLineId': '$id-l2',
        'orderLineId': 'ol-2',
        'sku': 'E-00000001',
        'productName': '서울우유 1L',
        'barcode': milkBarcode,
        'locationId': 'C-S1-02-2-05',
        'lotId': 'LOT-M-1022',
        'expiresOn': '2026-10-30',
        'picks': [
          {
            'lotId': 'LOT-M-1022',
            'expiresOn': '2026-10-30',
            'remainingQty': 2,
            'visitSeq': 2,
            'pickStatus': 'PARTIAL',
            'unallocatedQty': 1,
            'notice': '1개는 칸을 못 정했어요 — 다른 칸 확인',
            'locations': [
              {'locationCode': 'C-S1-02-2-05', 'qty': 1, 'allocatedQty': 1},
              {'locationCode': 'C-S2-04-1-10', 'qty': 3, 'allocatedQty': 0},
            ],
          },
        ],
        'plannedQty': 2,
        'completedQty': 0,
        'cancelledQty': 0,
        'remainingQty': 2,
        'pendingQty': 0,
      },
      // 방문 순서: 냉장 → 냉동 → 상온(서버 계산).
      {
        'taskLineId': '$id-l4',
        'orderLineId': 'ol-4',
        'sku': 'E-00000031',
        'productName': '냉동 왕만두 1kg',
        'barcode': dumplingBarcode,
        'locationId': 'F-S1-01-1-03',
        'lotId': 'LOT-D-1101',
        'expiresOn': '2027-05-01',
        'picks': [
          {
            'lotId': 'LOT-D-1101',
            'expiresOn': '2027-05-01',
            'remainingQty': 1,
            'visitSeq': 3,
            'pickStatus': 'OK',
            'locations': [
              {'locationCode': 'F-S1-01-1-03', 'qty': 5, 'allocatedQty': 1},
            ],
          },
        ],
        'plannedQty': 1,
        'completedQty': 0,
        'cancelledQty': 0,
        'remainingQty': 1,
        'pendingQty': 0,
      },
      {
        'taskLineId': '$id-l3',
        'orderLineId': 'ol-3',
        'sku': 'E-00000005',
        'productName': '감자칩 오리지널 110g',
        'barcode': chipsBarcode,
        'locationId': 'A-S3-01-1-10',
        'picks': [
          {
            'lotId': 'LOT-C-0901',
            'remainingQty': 1,
            'visitSeq': 4,
            'pickStatus': 'OK',
            'locations': [
              {'locationCode': 'A-S3-01-1-10', 'qty': 12, 'allocatedQty': 1},
            ],
          },
        ],
        'plannedQty': 1,
        'completedQty': 0,
        'cancelledQty': 0,
        'remainingQty': 1,
        'pendingQty': 0,
      },
    ],
  };

  /// 목 업무 내역 — 오늘 끝낸 피킹·패킹 2건과 어제 1건(오늘만 보이는지 확인용). 시각은 지금 기준.
  static List<Map<String, Object?>> _historySeed(DateTime now) => [
    {
      'taskId': 'task-done-1',
      'taskType': 'PICK',
      'state': 'COMPLETED',
      'mfcId': 'MFC-MOCK-01',
      'assignment': {'workerId': workerId, 'assignmentVersion': 1},
      'lineCount': 3,
      'plannedQty': 4,
      'completedQty': 4,
      'remainingQty': 0,
      'headline': {'productName': '서울우유 1L', 'otherLineCount': 2},
      'createdAt': now.toUtc().toIso8601String(),
      'lastActivityAt': now.toUtc().toIso8601String(),
    },
    {
      'taskId': 'task-done-2',
      'taskType': 'PACK',
      'state': 'CLOSED_PARTIAL',
      'mfcId': 'MFC-MOCK-01',
      'assignment': {'workerId': workerId, 'assignmentVersion': 1},
      'lineCount': 2,
      'plannedQty': 3,
      'completedQty': 2,
      'remainingQty': 0,
      'headline': {'productName': '감자칩 오리지널 110g', 'otherLineCount': 1},
      'createdAt': now.toUtc().toIso8601String(),
      'lastActivityAt': now.toUtc().toIso8601String(),
    },
    {
      'taskId': 'task-done-yesterday',
      'taskType': 'PICK',
      'state': 'COMPLETED',
      'mfcId': 'MFC-MOCK-01',
      'assignment': {'workerId': workerId, 'assignmentVersion': 1},
      'lineCount': 1,
      'plannedQty': 1,
      'completedQty': 1,
      'remainingQty': 0,
      'headline': {'productName': '그릭요거트 플레인 400g', 'otherLineCount': 0},
      'createdAt': now
          .subtract(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'lastActivityAt': now
          .subtract(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
    },
  ];

  @override
  Future<TaskList> myHistory(String mfcId) async {
    await _wait();
    final now = DateTime.now();
    const shown = {'COMPLETED', 'CLOSED_PARTIAL', 'IN_PROGRESS'};
    final items = [
      ..._historySeed(now),
      for (final t in _tasks.values)
        if (shown.contains(t['state']))
          {
            for (final e in t.entries)
              if (e.key != 'lines') e.key: e.value,
            // 목 작업은 실적 시각을 따로 두지 않는다 — 지금으로.
            'lastActivityAt':
                t['lastActivityAt'] ?? now.toUtc().toIso8601String(),
          },
    ];
    return taskListFromContract(
      api.ListTasks200Response.fromJson({
        'items': items,
        'page': {'nextCursor': null, 'size': 50},
        'asOf': {'asOf': now.toUtc().toIso8601String(), 'freshness': 'CURRENT'},
      }),
    );
  }

  @override
  Future<TaskList> myTasks(String mfcId, {bool blocked = false}) async {
    await _wait();
    final items = [
      for (final t in _tasks.values)
        if ((t['state'] == 'BLOCKED') == blocked &&
            (blocked ||
                t['state'] == 'ASSIGNED' ||
                t['state'] == 'IN_PROGRESS'))
          {
            for (final e in t.entries)
              if (e.key != 'lines') e.key: e.value,
          },
    ];
    return taskListFromContract(
      api.ListTasks200Response.fromJson({
        'items': items,
        'page': {'nextCursor': null, 'size': 50},
        'asOf': {'asOf': '2026-10-24T06:05:00Z', 'freshness': 'CURRENT'},
      }),
    );
  }

  @override
  Future<TaskList> centerTasks(
    String mfcId, {
    required List<TaskState> states,
  }) async {
    await _wait();
    final items = [
      for (final t in _tasks.values)
        if (states.contains(TaskState.fromWire(t['state'] as String?)))
          {
            for (final e in t.entries)
              if (e.key != 'lines') e.key: e.value,
          },
    ];
    return taskListFromContract(
      api.ListTasks200Response.fromJson({
        'items': items,
        'page': {'nextCursor': null, 'size': 50},
        'asOf': {'asOf': '2026-10-24T06:05:00Z', 'freshness': 'CURRENT'},
      }),
    );
  }

  /// 목 작업 JSON(테스트에서 상태를 바꿀 때 쓴다).
  Map<String, Object?> taskJson(String taskId) => _tasks[taskId]!;

  /// 목 작업 ID(다음 작업 받기 목이 고른다).
  Iterable<String> get taskIds => _tasks.keys;

  @override
  Future<TaskDetailView> task(String taskId) async {
    await _wait();
    final t = _tasks[taskId];
    if (t == null) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    return taskDetailFromContract(api.TaskDetail.fromJson(t));
  }

  @override
  Future<StartOutcome> start(
    String taskId, {
    required String workerId,
    required int assignmentVersion,
    String? deviceId,
    required IdempotencyKey key,
  }) async {
    await _wait();
    final recorded = _startsByKey[key.value];
    if (recorded != null) return _startOutcome(recorded);
    if (startUnavailable > 0) {
      startUnavailable--;
      // 판정 기록 없음 → 같은 키로 다시 보내면 처음부터 판정한다.
      return startFailureToOutcome(
        const UnknownResultFailure(
          httpStatus: 503,
          problem: Problem(
            status: 503,
            code: TaskProblemCode.dependencyUnavailable,
          ),
        ),
      );
    }
    final t = _tasks[taskId]!;
    final assignment = t['assignment']! as Map<String, Object?>;
    final String? reject;
    if (taskId == 'task-mock-4') {
      reject = TaskProblemCode.alreadyStarted;
    } else if (t['state'] != 'ASSIGNED') {
      reject = TaskProblemCode.invalidState;
    } else if (assignment['workerId'] != workerId) {
      reject = TaskProblemCode.notAssignee;
    } else if (assignment['assignmentVersion'] != assignmentVersion) {
      reject = TaskProblemCode.versionConflict;
    } else {
      reject = null;
    }
    final decision = {
      'outcome': reject == null ? 'STARTED' : 'REJECTED',
      'rejectCode': reject,
    };
    _startsByKey[key.value] = decision;
    if (reject == null) {
      t
        ..['state'] = 'IN_PROGRESS'
        ..['version'] = (t['version']! as int) + 1
        ..['activeStart'] = {
          'requestId': key.value,
          'workerId': workerId,
          'deviceId': deviceId,
          'startedAt': '2026-10-24T06:06:00Z',
        };
    }
    if (loseNextStartResponse) {
      loseNextStartResponse = false;
      return startFailureToOutcome(
        UnknownResultFailure(
          requestId: key.value,
          transport: DioExceptionType.receiveTimeout,
        ),
      );
    }
    return _startOutcome(decision);
  }

  StartOutcome _startOutcome(Map<String, Object?> d) =>
      d['outcome'] == 'STARTED'
      ? const StartApplied()
      : StartRejected(d['rejectCode']! as String);

  @override
  Future<SendResult> sendExecution(QueueItem item) async {
    await _wait();
    if (!sentExecutionKeys.contains(item.id)) sentPayloads.add(item.payload);
    sentExecutionKeys.add(item.id);
    if (offline) {
      return executionFailureToSend(
        const UnknownResultFailure(transport: DioExceptionType.connectionError),
      );
    }
    final existing = _executionByKey[item.id];
    if (existing != null) return SendAccepted(resultId: existing);
    final t = _tasks[item.targetId]!;
    final assignment = t['assignment']! as Map<String, Object?>;
    if (t['state'] != 'IN_PROGRESS') {
      return executionFailureToSend(
        const ProblemFailure(
          Problem(status: 409, code: TaskProblemCode.invalidState),
        ),
      );
    }
    // 재배정 뒤 전임의 늦은 실적은 버전 충돌로 거절된다.
    if (item.payload['assignmentVersion'] != assignment['assignmentVersion']) {
      return executionFailureToSend(
        const ProblemFailure(
          Problem(status: 409, code: TaskProblemCode.versionConflict),
        ),
      );
    }
    final id = 'exe-${++_exeSeq}';
    _executionByKey[item.id] = id;
    _executions[id] = (
      taskId: item.targetId,
      payload: item.payload,
      polls: 0,
      state: 'INVENTORY_PENDING',
    );
    _applyPending(t, item.payload, pending: true);
    if (loseNextExecutionResponse) {
      loseNextExecutionResponse = false;
      return executionFailureToSend(
        UnknownResultFailure(
          requestId: item.id,
          transport: DioExceptionType.receiveTimeout,
        ),
      );
    }
    return SendAccepted(resultId: id);
  }

  /// 접수분은 pendingQty, 반영분은 completedQty·remainingQty 로 옮긴다.
  void _applyPending(
    Map<String, Object?> t,
    Map<String, Object?> payload, {
    required bool pending,
  }) {
    final lines = (t['lines']! as List).cast<Map<String, Object?>>();
    for (final l in (payload['lines']! as List).cast<Map<String, Object?>>()) {
      final line = lines.firstWhere(
        (x) => x['orderLineId'] == l['orderLineId'],
      );
      final qty = l['pickedQty']! as int;
      final shortage = (l['shortage'] as Map?)?['qty'] as int? ?? 0;
      if (pending) {
        line['pendingQty'] = (line['pendingQty'] as int? ?? 0) + qty;
      } else {
        line
          ..['pendingQty'] = (line['pendingQty'] as int? ?? 0) - qty
          ..['completedQty'] = (line['completedQty']! as int) + qty
          ..['remainingQty'] = (line['remainingQty']! as int) - qty - shortage;
        if (shortage > 0) t['state'] = 'BLOCKED';
        _consumePick(line, l, payload['fromLocation'] as String?, qty);
      }
    }
    final allDone = lines.every(
      (l) => l['remainingQty'] == 0 && (l['pendingQty'] as int? ?? 0) == 0,
    );
    if (!pending && allDone && t['state'] == 'IN_PROGRESS') {
      t['state'] = 'COMPLETED';
      // 피킹이 끝나면 같은 주문의 패킹이 같은 작업자에게 열린다.
      if (t['taskType'] == 'PICK') {
        for (final x in _tasks.values) {
          if (x['taskType'] == 'PACK' &&
              x['shipmentId'] == t['shipmentId'] &&
              x['state'] == 'WAITING') {
            x['state'] = 'ASSIGNED';
          }
        }
      }
    }
    t['version'] = (t['version']! as int) + 1;
  }

  /// 반영된 집품만큼 LOT 조각·칸 잔량을 줄인다(다음 칸 지시가 바뀐다).
  void _consumePick(
    Map<String, Object?> line,
    Map<String, Object?> exe,
    String? from,
    int qty,
  ) {
    if (qty <= 0) return;
    final picks = (line['picks'] as List?)?.cast<Map<String, Object?>>();
    final p = picks?.where((p) => p['lotId'] == exe['lotId']).firstOrNull;
    if (p == null) return;
    final left = (p['remainingQty'] as int? ?? 0) - qty;
    p['remainingQty'] = left < 0 ? 0 : left;
    if (left <= 0) p['pickStatus'] = 'DONE';
    final locs = (p['locations'] as List?)?.cast<Map<String, Object?>>();
    final c = locs?.where((c) => c['locationCode'] == from).firstOrNull;
    if (c == null) return;
    c['qty'] = (c['qty'] as int? ?? 0) - qty;
    final a = (c['allocatedQty'] as int? ?? 0) - qty;
    c['allocatedQty'] = a < 0 ? 0 : a;
  }

  @override
  Future<ConfirmResult> execution(String taskId, String executionId) async {
    await _wait();
    final e = _executions[executionId];
    if (e == null) return ConfirmResult.unknown;
    if (e.state == 'APPLIED') return ConfirmResult.applied;
    final polls = e.polls + 1;
    if (polls < confirmPolls) {
      _executions[executionId] = (
        taskId: e.taskId,
        payload: e.payload,
        polls: polls,
        state: e.state,
      );
      return ConfirmResult.pending;
    }
    _executions[executionId] = (
      taskId: e.taskId,
      payload: e.payload,
      polls: polls,
      state: 'APPLIED',
    );
    _applyPending(_tasks[e.taskId]!, e.payload, pending: false);
    return executionStateToConfirm(
      api.TaskExecution.fromJson({
        'executionId': executionId,
        'state': 'APPLIED',
      }).state?.value,
    );
  }
}
