// 목 서버 상태(메모리). 계약 hr-service.yaml 0.1.0 의 모양만 쓴다. 테스트마다 resetDb() 로 되돌린다.
import type { EmployeeGrant } from '@pmart/web-core';
import type { Employee, ProvisioningStep } from '../api/models';

export interface MockSession {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly deviceId: string;
  refreshToken: string;
  readonly used: Set<string>;
  revoked: boolean;
  readonly issuedAt: string;
}

/** 직원 권한의 효력은 employee-auth-service 가 정본이다(hr-service 응답에 없다) — 목 로그인이 토큰에 싣는 값 */
export interface MockGrant {
  readonly roles: readonly string[];
  readonly centers: readonly string[];
}

export interface MockEmployee {
  employee: Employee;
  /** 목 전용: 계정 발급이 이 단계에서 실패한다(메일 ID 가 fail 로 시작하면) */
  failAt?: ProvisioningStep;
}

/** 목 로그인 계정(로그인 화면의 버튼). 직원 기록과 운영자 ID 로 이어진다 */
export const mockLogins = [
  { operatorId: 'OP-hr-1', label: '인사 담당(HR_ADMIN)' },
  { operatorId: 'OP-md-1', label: '상품 담당(인사 권한 없음)' },
] as const;

const at = (iso: string) => iso;

function seedEmployees(): MockEmployee[] {
  const base = { version: 3, createdAt: at('2026-03-02T00:10:00Z'), updatedAt: at('2026-11-10T02:00:00Z') };
  return [
    {
      employee: {
        operatorId: 'OP-hr-1',
        employeeNo: 'P2026-00001',
        name: '한인사',
        mailAddress: 'hr.han@pmart.com',
        employmentType: 'REGULAR',
        affiliation: { type: 'HQ_DEPARTMENT', code: 'HR' },
        startDate: '2026-03-02',
        status: 'ACTIVE',
        provisioning: { step: 'DONE', attempts: 1, updatedAt: at('2026-03-02T00:12:00Z') },
        requestedGrants: [{ role: 'HR_ADMIN', centers: [], validFrom: '2026-03-02', submission: 'APPROVED' }],
        ...base,
      },
    },
    {
      employee: {
        operatorId: 'OP-md-1',
        employeeNo: 'P2026-00002',
        name: '김상품',
        mailAddress: 'md.kim@pmart.com',
        employmentType: 'REGULAR',
        affiliation: { type: 'HQ_DEPARTMENT', code: 'MD' },
        startDate: '2026-03-09',
        status: 'ACTIVE',
        provisioning: { step: 'DONE', attempts: 1, updatedAt: at('2026-03-09T00:12:00Z') },
        requestedGrants: [{ role: 'MD', centers: [], validFrom: '2026-03-09', submission: 'APPROVED' }],
        ...base,
      },
    },
    {
      employee: {
        operatorId: 'OP-picker-1',
        employeeNo: 'P2026-00003',
        name: '이피킹',
        mailAddress: 'pick.lee@pmart.com',
        employmentType: 'PART_TIME',
        affiliation: { type: 'CENTER', code: 'MFC-BSN-01' },
        startDate: '2026-09-01',
        endDate: '2027-02-28',
        status: 'ACTIVE',
        provisioning: { step: 'DONE', attempts: 1, updatedAt: at('2026-09-01T00:12:00Z') },
        requestedGrants: [
          { role: 'MFC_WORKER', centers: ['MFC-BSN-01'], validFrom: '2026-09-01', validTo: '2027-02-28', reason: '부산진구 피킹', approvalRef: 'AP-seed-3', submission: 'APPROVED' },
        ],
        ...base,
      },
    },
    {
      employee: {
        operatorId: 'OP-sus-1',
        employeeNo: 'P2026-00004',
        name: '박정지',
        mailAddress: 'stop.park@pmart.com',
        employmentType: 'DAILY',
        affiliation: { type: 'CENTER', code: 'MFC-BSN-01' },
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        status: 'SUSPENDED',
        provisioning: { step: 'DONE', attempts: 1, updatedAt: at('2026-10-01T00:12:00Z') },
        requestedGrants: [],
        ...base,
      },
    },
    {
      employee: {
        operatorId: 'OP-left-1',
        employeeNo: 'P2026-00005',
        name: '최퇴사',
        mailAddress: 'left.choi@pmart.com',
        employmentType: 'REGULAR',
        affiliation: { type: 'HQ_DEPARTMENT', code: 'CS' },
        startDate: '2026-04-01',
        status: 'LEFT',
        provisioning: { step: 'DONE', attempts: 1, updatedAt: at('2026-04-01T00:12:00Z') },
        requestedGrants: [],
        ...base,
      },
    },
    {
      employee: {
        operatorId: 'OP-fail-1',
        employeeNo: 'P2026-00006',
        name: '정실패',
        mailAddress: 'fail.jung@pmart.com',
        employmentType: 'REGULAR',
        affiliation: { type: 'HQ_DEPARTMENT', code: 'CS' },
        startDate: '2026-11-10',
        status: 'ACTIVE',
        provisioning: {
          step: 'FAILED',
          attempts: 8,
          lastErrorCode: 'IAM_USERNAME_TAKEN',
          updatedAt: at('2026-11-10T02:00:00Z'),
        },
        requestedGrants: [{ role: 'CS_AGENT', centers: [], validFrom: '2026-11-10', submission: 'PENDING' }],
        ...base,
      },
    },
  ];
}

function seedGrants(): Array<[string, MockGrant]> {
  return [
    ['OP-hr-1', { roles: ['HR_ADMIN'], centers: [] }],
    ['OP-md-1', { roles: ['MD'], centers: [] }],
  ];
}

export const db = {
  employees: new Map<string, MockEmployee>(),
  grants: new Map<string, MockGrant>(),
  sessions: new Map<string, MockSession>(),
  idempotent: new Map<string, { status: number; body: unknown }>(),
  /** 본사 부서 표시 이름(hr 0.3.0 PUT /hr/departments/{code}). 목록은 이것 ∪ 직원 소속(HQ_DEPARTMENT) 코드 */
  departments: new Map<string, { name?: string }>(),
  /** employee-auth 의 승인된 권한(0.7.0 grants, 0.8.0 회수) — 목: 발급이 끝난 직원의 APPROVED 요청에서 만든다 */
  accountGrants: new Map<string, EmployeeGrant[]>(),
  seq: 100,
};

export function resetDb(): void {
  db.employees = new Map(seedEmployees().map((e) => [e.employee.operatorId, e]));
  db.grants = new Map(seedGrants());
  db.sessions = new Map();
  db.idempotent = new Map();
  db.departments = new Map([['HR', { name: '인사팀' }], ['MD', {}], ['CS', { name: '고객센터' }]]);
  db.accountGrants = new Map(seedAccountGrants(db.employees));
  db.seq = 100;
}

/** employee-auth 0.10.0 approverName·revokedByName 흉내 — hr 인사 기록 이름. 목 관리자 OP-admin-1 은 인사 기록이 없는 예전 계정(null → 화면은 ID). */
export function mockStaffName(operatorId: string | null | undefined, employees: Map<string, MockEmployee> = db.employees): string | null {
  if (!operatorId) return null;
  return [...employees.values()].find((x) => x.employee.operatorId === operatorId)?.employee.name ?? null;
}

const approverOf = (m: MockEmployee) => (m.employee.operatorId === 'OP-hr-1' ? 'OP-admin-1' : 'OP-hr-1');

function seedAccountGrants(employees: Map<string, MockEmployee>): Array<[string, EmployeeGrant[]]> {
  return [...employees.values()]
    .filter((m) => m.employee.provisioning.step === 'DONE')
    .map((m, i) => [
      m.employee.operatorId,
      // 인사 담당 자신의 권한은 인사 기록 없는 관리자(OP-admin-1)가 승인 → 이름 null, 그 밖은 인사 담당(OP-hr-1, 한인사)
      (m.employee.requestedGrants ?? [])
        .filter((g) => g.submission === 'APPROVED')
        .map((g, j) => ({
          grantId: `${g.approvalRef ?? `AP-seed-${i}`}:L${j + 1}`,
          approvalId: g.approvalRef ?? `AP-seed-${i}`,
          approverId: g.role === 'MFC_WORKER' ? 'RULE:center-worker@v1' : approverOf(m),
          approverName: g.role === 'MFC_WORKER' ? null : mockStaffName(approverOf(m), employees),
          role: g.role,
          centers: [...g.centers],
          validFrom: `${g.validFrom ?? m.employee.startDate}T00:00:00+09:00`,
          validUntil: g.validTo ? `${g.validTo}T00:00:00+09:00` : null,
          appliedAt: m.employee.createdAt,
        })),
    ]);
}

resetDb();

export const nextSeq = () => (db.seq += 1);
export const timestamp = () => new Date().toISOString();
