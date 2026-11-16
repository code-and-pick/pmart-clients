// 목 서버 상태(메모리). 테스트마다 resetDb() 로 되돌린다.
import type { components as CapacitySchemas } from '../api/generated/mfc-capacity';
import type { components as FulfillmentSchemas } from '../api/generated/mfc-fulfillment';
import type { components as InboundSchemas } from '../api/generated/mfc-inbound';
import type { components as InventorySchemas } from '../api/generated/mfc-inventory';
import type { components as LocationSchemas } from '../api/generated/mfc-location';

type Location = LocationSchemas['schemas']['Location'];

type Cap = CapacitySchemas['schemas'];
export type TaskType = Cap['TaskType'];

/** 작업자 — 계정(workerId)·업무 이력·자격·상태 이력(목은 정본 값만 들고, 유효 업무·업무 묶음은 핸들러가 계산) */
export interface MockWorker {
  readonly mfcId: string;
  readonly workerId: string;
  readonly displayName: string;
  readonly employmentType: Cap['EmploymentType'];
  readonly state: Cap['WorkerState'];
  /** 새 버전부터 */
  readonly duties: ReadonlyArray<Required<Pick<Cap['WorkerDuty'], 'dutyVersion' | 'taskTypes' | 'changedBy' | 'changedAt'>> & { readonly reason: string | null }>;
  readonly qualification: { readonly qualificationVersion: number; readonly taskTypes: readonly TaskType[]; readonly expiresAt: string | null; readonly changedBy: string; readonly changedAt: string };
  readonly stateHistory: ReadonlyArray<{ fromState: string | null; toState: string; reason: string | null; changedBy: string; changedAt: string }>;
  readonly speedFactor: number;
  readonly onBreak: boolean;
  /** 일일크루 오늘 출근 등록(목은 날짜 하나만 본다) */
  readonly enrolledToday: boolean;
  readonly registeredBy: string;
  readonly registeredAt: string;
}

export type MockShift = Required<Cap['WorkerShift']>;
export type MockAssignment = Pick<Required<Cap['Assignment']>, 'assignmentId' | 'mfcId' | 'taskId' | 'taskType' | 'workerId' | 'assignmentVersion' | 'state' | 'assignedAt'> &
  Partial<Pick<Cap['Assignment'], 'planId' | 'assignedBy' | 'source' | 'warnings'>>;
export type MockPlan = Cap['AssignmentPlan'] & { readonly planId: string; readonly mfcId: string; readonly state: NonNullable<Cap['AssignmentPlan']['state']> };

function worker(workerId: string, displayName: string, extra: Partial<MockWorker> & { taskTypes?: readonly TaskType[] } = {}): [string, MockWorker] {
  const taskTypes = extra.taskTypes ?? ['PICK', 'PACK'];
  const at = '2026-11-10T00:00:00.000Z';
  return [
    `${extra.mfcId ?? 'MFC-BSN-01'}/${workerId}`,
    {
      mfcId: 'MFC-BSN-01',
      workerId,
      displayName,
      employmentType: 'REGULAR',
      state: 'ACTIVE',
      duties: [{ dutyVersion: 1, taskTypes: [...taskTypes], changedBy: 'OP-sup-1', changedAt: at, reason: null }],
      qualification: { qualificationVersion: 1, taskTypes, expiresAt: null, changedBy: 'OP-sup-1', changedAt: at },
      stateHistory: [{ fromState: null, toState: 'ACTIVE', reason: null, changedBy: 'OP-sup-1', changedAt: at }],
      speedFactor: 1,
      onBreak: false,
      enrolledToday: false,
      registeredBy: 'OP-sup-1',
      registeredAt: at,
      ...extra,
    },
  ];
}

/** 목 작업자: MFC-BSN-01 에 정규직(자격이 업무보다 넓음)·알바(휴게 중)·일일크루(출근 전)·정지·퇴사, MFC-SEL-01 에 1명 */
function seedWorkers(): Array<[string, MockWorker]> {
  return [
    worker('OP-wkr-1', '김현장', {
      qualification: { qualificationVersion: 2, taskTypes: ['PICK', 'PACK', 'MOVE', 'PUTAWAY'], expiresAt: null, changedBy: 'OP-sup-1', changedAt: '2026-11-12T00:00:00.000Z' },
    }),
    worker('OP-wkr-2', '이알바', { employmentType: 'PART_TIME', taskTypes: ['PICK'], onBreak: true, speedFactor: 0.8 }),
    worker('OP-day-1', '박일일', { employmentType: 'DAILY' }),
    worker('OP-wkr-3', '최정지', {
      state: 'SUSPENDED',
      stateHistory: [
        { fromState: 'ACTIVE', toState: 'SUSPENDED', reason: '교육 기간', changedBy: 'OP-sup-1', changedAt: '2026-11-14T00:00:00.000Z' },
        { fromState: null, toState: 'ACTIVE', reason: null, changedBy: 'OP-sup-1', changedAt: '2026-11-10T00:00:00.000Z' },
      ],
    }),
    worker('OP-wkr-9', '정퇴사', { state: 'LEFT' }),
    worker('OP-wkr-5', '송파작업자', { mfcId: 'MFC-SEL-01' }),
  ];
}

function seedShifts(): Array<[string, MockShift]> {
  return [
    ['SHIFT-1', { shiftId: 'SHIFT-1', mfcId: 'MFC-BSN-01', workerId: 'OP-wkr-1', startAt: '2026-11-17T00:00:00.000Z', endAt: '2026-11-17T09:00:00.000Z', state: 'PLANNED', note: '오전 근무', createdBy: 'OP-sup-1', cancelReason: null }],
  ];
}

function seedAssignments(): MockAssignment[] {
  return [
    { assignmentId: 'ASG-1', mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-1', taskType: 'PICK', workerId: 'OP-wkr-1', assignmentVersion: 1, state: 'ACTIVE', assignedAt: '2026-11-16T00:30:00.000Z', source: 'MANUAL', assignedBy: 'OP-sup-1', warnings: [] },
    { assignmentId: 'ASG-2', mfcId: 'MFC-BSN-01', taskId: 'TASK-PACK-1', taskType: 'PACK', workerId: 'OP-wkr-2', assignmentVersion: 1, state: 'ACTIVE', assignedAt: '2026-11-16T00:42:00.000Z', source: 'SYSTEM', assignedBy: null, warnings: ['OFF_SHIFT'] },
    { assignmentId: 'ASG-3', mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-3', taskType: 'PICK', workerId: 'OP-wkr-3', assignmentVersion: 2, state: 'ACTIVE', assignedAt: '2026-11-16T00:31:00.000Z', source: 'MANUAL', assignedBy: 'OP-sup-1', warnings: [] },
    { assignmentId: 'ASG-0', mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-3', taskType: 'PICK', workerId: 'OP-wkr-1', assignmentVersion: 1, state: 'SUPERSEDED', assignedAt: '2026-11-16T00:30:30.000Z', source: 'MANUAL', assignedBy: 'OP-sup-1', warnings: [] },
  ];
}

type Ful = FulfillmentSchemas['schemas'];
/** 센터 작업 — 계약 TaskDetail(목은 상세 값을 모두 들고 목록은 요약만 돌려준다) */
export type MockTask = Ful['TaskDetail'] & Required<Pick<Ful['TaskSummary'], 'taskId' | 'taskType' | 'state' | 'mfcId' | 'createdAt' | 'version'>>;
export type MockShipment = Ful['Shipment'] & { readonly shipmentId: string; readonly mfcId: string };

function task(taskId: string, extra: Partial<MockTask>): [string, MockTask] {
  const line = (n: number, productName: string, sku: string, planned: number, completed: number): Ful['TaskLine'] => ({
    taskLineId: `${taskId}-L${n}`,
    orderLineId: `OL-${taskId}-${n}`,
    sku,
    productName,
    barcode: null,
    locationId: 'A-P1-01-1-01',
    lotId: 'LOT-MILK-A',
    expiresOn: '2026-11-25',
    picks: [],
    plannedQty: planned,
    completedQty: completed,
    cancelledQty: 0,
    remainingQty: planned - completed,
    pendingQty: 0,
  });
  const lines = extra.lines ?? [line(1, '서울우유 1L', 'SKU-MILK-1', 2, 1), line(2, '신라면 5입', 'SKU-RAMEN-5', 1, 0)];
  const planned = lines.reduce((n, l) => n + l.plannedQty, 0);
  const completed = lines.reduce((n, l) => n + l.completedQty, 0);
  return [
    taskId,
    {
      taskId,
      taskType: 'PICK',
      state: 'ASSIGNED',
      version: 1,
      mfcId: 'MFC-BSN-01',
      fulfillmentId: `FUL-${taskId}`,
      shipmentId: 'SHP-1',
      assignment: { workerId: 'OP-wkr-1', assignmentVersion: 1, asOf: { asOf: '2026-11-16T01:00:00.000Z', freshness: 'CURRENT' } },
      lineCount: lines.length,
      plannedQty: planned,
      completedQty: completed,
      remainingQty: planned - completed,
      promisedReadyAt: '2026-11-16T02:00:00.000Z',
      createdAt: '2026-11-16T00:40:00.000Z',
      late: false,
      idle: false,
      lastActivityAt: null,
      headline: { productName: lines[0]?.productName ?? null, otherLineCount: lines.length - 1 },
      lines,
      pendingExecutions: [],
      blockReason: null,
      packingLocations: [],
      routeMethod: null,
      ...extra,
    },
  ];
}

/** 목 작업: 진행 중(늦음·멈춤)·담당 대기·미배정·막힘·끝남·복귀(실적 확정 대기), 다른 센터 1 */
function seedTasks(): Array<[string, MockTask]> {
  return [
    task('TASK-PICK-1', { state: 'IN_PROGRESS', idle: true, lastActivityAt: '2026-11-16T00:45:00.000Z', routeMethod: 'ROUTING' }),
    task('TASK-PACK-1', { taskType: 'PACK', assignment: { workerId: 'OP-wkr-2', assignmentVersion: 1 }, createdAt: '2026-11-16T00:41:00.000Z', packingLocations: ['PAK-C-01'] }),
    task('TASK-PICK-2', { state: 'READY', assignment: { workerId: null, assignmentVersion: 0 }, createdAt: '2026-11-16T00:50:00.000Z', shipmentId: 'SHP-2' }),
    task('TASK-PICK-3', { state: 'BLOCKED', blockReason: '결품 보고 — 신라면 5입', createdAt: '2026-11-16T00:30:00.000Z', shipmentId: 'SHP-3' }),
    task('TASK-PICK-4', { state: 'COMPLETED', createdAt: '2026-11-15T23:00:00.000Z', shipmentId: 'SHP-4' }),
    task('TASK-RET-1', {
      taskType: 'RETURN',
      state: 'IN_PROGRESS',
      late: true,
      createdAt: '2026-11-16T00:35:00.000Z',
      shipmentId: null,
      pendingExecutions: [{ executionId: 'EXE-1', state: 'INVENTORY_PENDING', recordedAt: '2026-11-16T00:55:00.000Z' }],
    }),
    task('TASK-SEL-1', { mfcId: 'MFC-SEL-01', state: 'IN_PROGRESS' }),
  ];
}

function seedShipments(): Array<[string, MockShipment]> {
  return [
    [
      'SHP-1',
      {
        shipmentId: 'SHP-1',
        mfcId: 'MFC-BSN-01',
        fulfillmentId: 'FUL-1',
        orderId: 'ORD-1',
        deliveryId: 'DLV-1',
        version: 3,
        state: 'PREPARING',
        holdReason: null,
        bagCount: 2,
        containsAlcohol: false,
        weightG: 2400,
        readyAt: null,
        dispatchRequest: null,
        packages: [
          {
            packageId: 'PKG-1',
            packageVersion: 1,
            shipmentId: 'SHP-1',
            orderId: 'ORD-1',
            version: 2,
            state: 'SEALED',
            qrCode: 'PKG:PKG-1:1',
            contents: [{ orderLineId: 'OL-1', sku: 'SKU-MILK-1', qty: 2, lotId: 'LOT-MILK-A' }],
            bagCount: 1,
            containsAlcohol: false,
            temperatureZone: 'CHILLED',
            weightG: 2100,
            fence: { state: 'EXPIRED', handoverAuthorizationId: 'HA-1', fenceVersion: 1, riderId: 'RDR-1', expiresAt: '2026-11-16T01:10:00.000Z' },
            sealedAt: '2026-11-16T01:00:00.000Z',
            handedOverAt: null,
            invalidatedReason: null,
          },
        ],
      },
    ],
  ];
}

type Inb = InboundSchemas['schemas'];
export type MockInboundTask = Inb['InboundTask'];
export type MockInitialLoad = Inb['InitialStockLoad'];
export type MockSupplyRequest = Inb['SupplyRequest'] & { readonly supplyRequestId: string; readonly version: number; readonly state: Inb['SupplyRequestState'] };
export interface MockReturnReceipt {
  readonly returnReceiptId: string;
  readonly claimId: string;
  readonly returnPickupId: string;
  readonly mfcId: string;
  readonly inventoryApplyStatus: 'SUBMITTED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';
  readonly inventoryCommitId: string | null;
  readonly inspectionState: 'PENDING' | 'INSPECTED';
  readonly receivedAt: string;
  readonly orderId: string | null;
  readonly toLocationCode: string;
  readonly receivedBy: string;
  readonly rejectReason: string | null;
  readonly lines: ReadonlyArray<{ orderLineId: string | null; sku: string; qty: number; lotId: string | null; conditionNote: string | null }>;
  readonly putawayTaskIds: readonly string[];
}

function inboundTask(taskId: string, extra: Partial<MockInboundTask>): [string, MockInboundTask] {
  return [
    taskId,
    {
      taskId,
      taskType: 'INSPECT',
      mfcId: 'MFC-BSN-01',
      receiptId: 'RCPT-1',
      parentTaskId: null,
      sku: 'SKU-MILK-1',
      productName: '서울우유 1L',
      barcodes: ['8801115114154'],
      lotId: 'LOT-RCV-1',
      locationCode: 'RCV-C-01',
      plannedQty: 6,
      doneQty: 0,
      state: 'READY',
      version: 1,
      assigneeId: null,
      createdAt: '2026-11-16T00:20:00.000Z',
      ...extra,
    },
  ];
}

/** 목 입고 작업: 품질검사 대기 2(하나는 담당 있음), 적치 대기 1, 끝난 검사 1 */
function seedInboundTasks(): Array<[string, MockInboundTask]> {
  return [
    inboundTask('ITK-1', {}),
    inboundTask('ITK-2', { sku: 'SKU-RAMEN-5', productName: '신라면 5입', plannedQty: 10, assigneeId: 'OP-wkr-1', createdAt: '2026-11-16T00:21:00.000Z' }),
    inboundTask('ITK-3', { taskType: 'PUTAWAY', parentTaskId: 'ITK-0', lotId: 'LOT-MILK-A', plannedQty: 4, doneQty: 1, version: 2, createdAt: '2026-11-16T00:25:00.000Z' }),
    inboundTask('ITK-0', { state: 'COMPLETED', plannedQty: 4, doneQty: 4, version: 3, createdAt: '2026-11-15T23:00:00.000Z' }),
  ];
}

function seedInitialLoads(): MockInitialLoad[] {
  return [
    {
      receiptId: 'RCPT-9',
      approvalId: 'AP-INIT-1',
      mfcId: 'MFC-BSN-01',
      state: 'EXPECTED',
      receivingLocation: null,
      receivedAt: null,
      rejectReason: null,
      inventoryCommitId: null,
      attempts: 0,
      lastError: null,
      lines: [
        { sku: 'SKU-MILK-1', productName: '서울우유 1L', barcodes: [], qty: 10, receivedQty: null },
        { sku: 'SKU-RAMEN-5', productName: '신라면 5입', barcodes: [], qty: 5, receivedQty: null },
      ],
      createdAt: '2026-11-16T00:00:00.000Z',
      appliedAt: null,
    },
    {
      receiptId: 'RCPT-8',
      approvalId: 'AP-INIT-1',
      mfcId: 'MFC-SEL-01',
      state: 'EXPECTED',
      receivingLocation: null,
      receivedAt: null,
      rejectReason: null,
      inventoryCommitId: null,
      attempts: 0,
      lastError: null,
      lines: [{ sku: 'SKU-MILK-1', productName: '서울우유 1L', barcodes: [], qty: 3, receivedQty: null }],
      createdAt: '2026-11-16T00:00:00.000Z',
      appliedAt: null,
    },
  ];
}

/** 재고 이동 지시 — 계약 MoveOrder(목은 모든 칸을 채운다) */
export type MockMove = Required<InboundSchemas['schemas']['MoveOrder']>;

/** 위치·LOT 별 재고 단위 행(mfc-inventory CenterStock.units + 센터·상품) */
export type MockStockUnit = Required<InventorySchemas['schemas']['CenterStock']['units'][number]> & { readonly mfcId: string; readonly sku: string };

function move(moveId: string, extra: Partial<MockMove>): [string, MockMove] {
  return [
    moveId,
    {
      moveId,
      kind: 'MOVE',
      mfcId: 'MFC-BSN-01',
      sku: 'SKU-MILK-1',
      productName: '서울우유 1L',
      barcodes: ['8801115114154'],
      lotId: 'LOT-MILK-A',
      fromLocation: 'A-P1-01-1-01',
      toLocation: 'C-S1-03-2-04',
      cartLocation: null,
      qty: 6,
      pickedQty: 0,
      droppedQty: 0,
      onCartQty: 0,
      state: 'ACTIVE',
      reason: null,
      createdBy: 'OP-sup-1',
      createdAt: '2026-11-16T00:10:00.000Z',
      updatedAt: '2026-11-16T00:10:00.000Z',
      urgent: false,
      assigneeId: null,
      pickedBy: null,
      ...extra,
    },
  ];
}

/** 목 이동: 진행 중 2(관리자 긴급·시스템 보충), 카트 정리 대기 1, 끝남 1, 다른 센터 1 */
function seedMoves(): Array<[string, MockMove]> {
  return [
    move('MOVE-1', { urgent: true, reason: '진열 위치 변경', assigneeId: 'OP-wkr-1' }),
    move('MOVE-2', { kind: 'REPLENISH', sku: 'SKU-RAMEN-5', productName: '신라면 5입', lotId: 'LOT-RAMEN-1', fromLocation: 'F-S2-02-1-03', toLocation: 'A-P1-01-1-01', qty: 10, createdBy: 'SYSTEM', createdAt: '2026-11-16T00:20:00.000Z' }),
    move('MOVE-3', { state: 'CANCEL_PENDING', qty: 4, pickedQty: 2, onCartQty: 2, cartLocation: 'CRT-C-01', pickedBy: 'OP-wkr-1', reason: '잘못 지시', createdAt: '2026-11-16T00:05:00.000Z' }),
    move('MOVE-4', { state: 'COMPLETED', qty: 3, pickedQty: 3, droppedQty: 3, createdAt: '2026-11-15T23:00:00.000Z' }),
    move('MOVE-5', { mfcId: 'MFC-SEL-01', fromLocation: 'A-S1-01-1-01' }),
  ];
}

type Inv = InventorySchemas['schemas'];
export type MockCountSession = Inv['CountSession'] & { readonly sessionId: string; readonly mfcId: string; readonly state: NonNullable<Inv['CountSession']['state']> };
export type MockPolicy = Required<Inv['ReplenishmentPolicy']>;
export interface MockHandling {
  readonly sku: string;
  readonly handlingEnabled: boolean;
  readonly version: number;
  readonly skuState: 'ACTIVE' | 'INACTIVE';
}
export interface MockUnshippable {
  readonly mfcId: string;
  readonly sku: string;
  readonly lotId: string;
  readonly expiryDate: string | null;
  readonly manufactureDate: string | null;
  readonly locationCode: string;
  readonly locationCategoryId: string | null;
  readonly onMiscShelf: boolean;
  readonly qty: number;
}

function seedCountSessions(): Array<[string, MockCountSession]> {
  const base = { mfcId: 'MFC-BSN-01', reason: '순환 실사', baselineAt: '2026-11-16T00:00:00.000Z', approverId: null, approvalRef: null, commitId: null, updatedAt: '2026-11-16T00:30:00.000Z' };
  const sheet = [{ locationCode: 'A-P1-01-1-01', sku: 'SKU-MILK-1', productName: '서울우유 1L', barcodes: [], lotId: 'LOT-MILK-A', expiryDate: '2026-11-25' }];
  return [
    [
      'CNT-1',
      {
        ...base,
        sessionId: 'CNT-1',
        state: 'PENDING_APPROVAL',
        locationCodes: ['A-P1-01-1-01'],
        createdBy: 'OP-wkr-1',
        firstCounter: 'OP-wkr-1',
        recounter: 'OP-wkr-2',
        sheet,
        differences: [{ locationCode: 'A-P1-01-1-01', sku: 'SKU-MILK-1', lotId: 'LOT-MILK-A', bookQty: 12, heldQty: 0, countedQty: 10, deltaQty: -2 }],
        version: 3,
      },
    ],
    ['CNT-2', { ...base, sessionId: 'CNT-2', state: 'COUNTING', locationCodes: ['C-S1-03-2-04'], createdBy: 'OP-sup-1', firstCounter: null, recounter: null, sheet, differences: null, version: 1 }],
  ];
}

function seedPolicies(): MockPolicy[] {
  return [{ mfcId: 'MFC-BSN-01', locationCode: 'A-P1-01-1-01', sku: 'SKU-MILK-1', minQty: 3, targetQty: 10, unitQty: 2, updatedBy: 'OP-sup-1', updatedAt: '2026-11-15T00:00:00.000Z' }];
}

function seedHandlings(): MockHandling[] {
  return [
    { sku: 'SKU-MILK-1', handlingEnabled: true, version: 2, skuState: 'ACTIVE' },
    { sku: 'SKU-OLD-9', handlingEnabled: false, version: 0, skuState: 'INACTIVE' },
    { sku: 'SKU-RAMEN-5', handlingEnabled: false, version: 0, skuState: 'ACTIVE' },
  ];
}

function seedUnshippable(): MockUnshippable[] {
  return [
    { mfcId: 'MFC-BSN-01', sku: 'SKU-MILK-1', lotId: 'LOT-MILK-OLD', expiryDate: '2026-11-17', manufactureDate: null, locationCode: 'C-S1-03-2-04', locationCategoryId: 'CAT-DAIRY', onMiscShelf: false, qty: 3 },
    { mfcId: 'MFC-BSN-01', sku: 'SKU-RAMEN-5', lotId: 'LOT-RAMEN-OLD', expiryDate: '2026-11-20', manufactureDate: null, locationCode: 'A-P1-01-1-01', locationCategoryId: null, onMiscShelf: true, qty: 1 },
  ];
}

function seedStock(): MockStockUnit[] {
  const unit = (locationCode: string, lotId: string, qty: number, qualityState: MockStockUnit['qualityState'] = 'NORMAL'): MockStockUnit => ({
    mfcId: 'MFC-BSN-01',
    sku: 'SKU-MILK-1',
    locationCode,
    lotId,
    qualityState,
    workState: 'STORED',
    qty,
  });
  return [unit('A-P1-01-1-01', 'LOT-MILK-A', 12), unit('RCV-C-01', 'LOT-MILK-B', 5), unit('QRT-A-01', 'LOT-MILK-A', 2, 'QUARANTINED')];
}

/** 위치(칸) — 계약 Location + 목 전용 재고 단위(폐지 판정용, 실서버는 mfc-inventory 스냅샷) */
export type MockLocation = Location & Required<Pick<Location, 'locationId' | 'version' | 'state' | 'updatedAt'>> & { readonly stockUnits: number };

export interface MockLocationStateChange {
  readonly requestId: string;
  readonly status: 'APPLIED';
  readonly fromState: MockLocation['state'];
  readonly toState: MockLocation['state'];
  readonly newVersion: number;
}

const seededAt = '2026-11-15T09:00:00.000Z';

function location(
  locationId: string,
  mfcId: string,
  locationCode: string,
  zone: MockLocation['zone'],
  temperatureZone: MockLocation['temperatureZone'],
  extra: Partial<MockLocation> = {},
): [string, MockLocation] {
  const area = /^[ACF]-([A-Z][0-9])-/.exec(locationCode)?.[1];
  return [
    locationId,
    {
      locationId,
      mfcId,
      locationCode,
      zone,
      temperatureZone,
      ...(area ? { areaCode: area } : {}),
      dimensions: { widthMm: 900, depthMm: 600, heightMm: 400, slotCount: 4, maxWeightG: 30000 },
      categoryId: null,
      position: null,
      highTurnover: false,
      version: 1,
      state: 'ACTIVE',
      stateReason: null,
      updatedAt: seededAt,
      stockUnits: 0,
      ...extra,
    },
  ];
}

/** 목 위치: MFC-BSN-01 에 상태별로 하나씩(닫힘 + 재고 있음 = 폐지 거절), MFC-SEL-01 에 하나 */
function seedLocations(): Array<[string, MockLocation]> {
  return [
    location('LOC-1', 'MFC-BSN-01', 'C-S1-03-2-04', 'STORAGE', 'CHILLED', { pickSequence: 12, position: { xM: 4.5, zM: 12 }, categoryId: 'CAT-DAIRY', stockUnits: 8 }),
    location('LOC-2', 'MFC-BSN-01', 'A-P1-01-1-01', 'PICKING', 'AMBIENT', { pickSequence: 1, highTurnover: true, stockUnits: 30 }),
    location('LOC-3', 'MFC-BSN-01', 'RCV-C-01', 'RECEIVING', 'CHILLED'),
    location('LOC-4', 'MFC-BSN-01', 'F-S2-02-1-03', 'STORAGE', 'FROZEN', { state: 'CLOSED', stateReason: '냉동고 점검' }),
    location('LOC-5', 'MFC-BSN-01', 'QRT-A-01', 'QUARANTINE', 'AMBIENT', { state: 'CLOSED', stateReason: '구역 정리', stockUnits: 2 }),
    location('LOC-6', 'MFC-BSN-01', 'OLD-SHELF-7', 'STORAGE', 'AMBIENT', { state: 'RETIRED', stateReason: '폐지' }),
    location('LOC-7', 'MFC-SEL-01', 'A-S1-01-1-01', 'STORAGE', 'AMBIENT'),
  ];
}

export interface MockSession {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly deviceId: string;
  refreshToken: string;
  readonly used: Set<string>;
  revoked: boolean;
  readonly issuedAt: string;
}

/** 직원 권한의 효력은 employee-auth-service 가 정본이다 — 목 로그인이 토큰에 싣는 값 */
export interface MockGrant {
  readonly roles: readonly string[];
  readonly centers: readonly string[];
}

/** 목 로그인 계정(로그인 화면의 버튼) */
export const mockLogins = [
  { operatorId: 'OP-sup-1', label: '센터 관리자(MFC 1곳)' },
  { operatorId: 'OP-sup-2', label: '센터 관리자(MFC 2곳)' },
  { operatorId: 'OP-wkr-1', label: '현장 작업자(MFC_WORKER)' },
  { operatorId: 'OP-admin-1', label: '운영 관리자(센터 없음)' },
] as const;

function seedGrants(): Array<[string, MockGrant]> {
  return [
    ['OP-sup-1', { roles: ['MFC_SUPERVISOR'], centers: ['MFC-BSN-01'] }],
    ['OP-sup-2', { roles: ['MFC_SUPERVISOR'], centers: ['MFC-BSN-01', 'MFC-SEL-01'] }],
    ['OP-wkr-1', { roles: ['MFC_WORKER'], centers: ['MFC-BSN-01'] }],
    ['OP-admin-1', { roles: ['OPERATOR_ADMIN'], centers: [] }],
  ];
}

export const db = {
  countSessions: new Map<string, MockCountSession>(),
  policies: [] as MockPolicy[],
  handlings: [] as MockHandling[],
  unshippable: [] as MockUnshippable[],
  inboundTasks: new Map<string, MockInboundTask>(),
  initialLoads: [] as MockInitialLoad[],
  returnReceipts: new Map<string, MockReturnReceipt>(),
  supplyRequests: new Map<string, MockSupplyRequest>(),
  tasks: new Map<string, MockTask>(),
  shipments: new Map<string, MockShipment>(),
  /** 키 = `${mfcId}/${workerId}` */
  workers: new Map<string, MockWorker>(),
  shifts: new Map<string, MockShift>(),
  assignments: [] as MockAssignment[],
  plans: new Map<string, MockPlan>(),
  moves: new Map<string, MockMove>(),
  stockUnits: [] as MockStockUnit[],
  locations: new Map<string, MockLocation>(),
  locationStateChanges: new Map<string, MockLocationStateChange>(),
  grants: new Map<string, MockGrant>(),
  /** 정지·퇴사(로그인 불가) 운영자 */
  suspended: new Set<string>(),
  sessions: new Map<string, MockSession>(),
  idempotent: new Map<string, { status: number; body: unknown }>(),
  seq: 100,
};

export function resetDb(): void {
  db.grants = new Map(seedGrants());
  db.suspended = new Set();
  db.sessions = new Map();
  db.idempotent = new Map();
  db.seq = 100;
  db.locations = new Map(seedLocations());
  db.locationStateChanges = new Map();
  db.moves = new Map(seedMoves());
  db.stockUnits = seedStock();
  db.workers = new Map(seedWorkers());
  db.shifts = new Map(seedShifts());
  db.assignments = seedAssignments();
  db.plans = new Map();
  db.tasks = new Map(seedTasks());
  db.shipments = new Map(seedShipments());
  db.inboundTasks = new Map(seedInboundTasks());
  db.initialLoads = seedInitialLoads();
  db.returnReceipts = new Map();
  db.supplyRequests = new Map();
  db.countSessions = new Map(seedCountSessions());
  db.policies = seedPolicies();
  db.handlings = seedHandlings();
  db.unshippable = seedUnshippable();
}

resetDb();

export const nextSeq = () => (db.seq += 1);
export const timestamp = () => new Date().toISOString();
