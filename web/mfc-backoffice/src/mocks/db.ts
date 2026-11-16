// 목 서버 상태(메모리). 테스트마다 resetDb() 로 되돌린다.
import type { components as LocationSchemas } from '../api/generated/mfc-location';

type Location = LocationSchemas['schemas']['Location'];

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
}

resetDb();

export const nextSeq = () => (db.seq += 1);
export const timestamp = () => new Date().toISOString();
