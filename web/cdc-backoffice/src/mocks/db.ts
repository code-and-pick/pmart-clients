// 목 저장소(시험마다 resetDb). 지금은 직원 로그인·세션만 — 메뉴 화면을 만들 때 그 목을 더한다.
export interface MockSession {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly deviceId: string;
  refreshToken: string;
  readonly used: Set<string>;
  revoked: boolean;
  readonly issuedAt: string;
}

export interface MockGrant {
  readonly roles: readonly string[];
  readonly centers: readonly string[];
}

/** 목 로그인 화면의 계정 버튼(LAN 시험 계정 claude-cdc-sup 과 같은 역할·DC) */
export const mockLogins = [
  { operatorId: 'OP-cdc-sup', label: 'DC 관리자 — 칠곡 DC(claude-cdc-sup)' },
  { operatorId: 'OP-admin-cdc', label: '운영 관리자(칠곡 DC 포함)' },
  { operatorId: 'OP-cdc-wkr', label: '현장 작업자(CDC_WORKER)' },
  { operatorId: 'OP-admin-1', label: '운영 관리자(센터 없음)' },
  { operatorId: 'OP-mixed', label: 'DC·MFC 둘 다 맡은 관리자' },
] as const;

const grants = (): Map<string, MockGrant> =>
  new Map([
    ['OP-cdc-sup', { roles: ['CDC_SUPERVISOR'], centers: ['CDC01'] }],
    ['OP-admin-cdc', { roles: ['OPERATOR_ADMIN'], centers: ['CDC01'] }],
    ['OP-cdc-wkr', { roles: ['CDC_WORKER'], centers: ['CDC01'] }],
    ['OP-admin-1', { roles: ['OPERATOR_ADMIN'], centers: [] }],
    ['OP-mixed', { roles: ['CDC_SUPERVISOR', 'MFC_SUPERVISOR'], centers: ['MFC-BJG-01', 'CDC01'] }],
  ]);

function fresh() {
  return {
    grants: grants(),
    suspended: new Set<string>(),
    sessions: new Map<string, MockSession>(),
    idempotent: new Map<string, { status: number; body: unknown }>(),
  };
}

export const db = fresh();

let seq = 0;
export const nextSeq = () => ++seq;
export const timestamp = () => new Date().toISOString();

export function resetDb() {
  Object.assign(db, fresh());
  seq = 0;
}
