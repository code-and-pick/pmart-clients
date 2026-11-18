// 권한 요청 입력 규칙(hr-service 0.6.0 · employee-auth 0.11.0 — 백엔드 요청 hr-backoffice/2026-11-17-request-grant-request-validation, HR-2).
// 화면 검사는 입력 도움일 뿐 — 판정은 서버(400 VALIDATION_FAILED·409 GRANT_ALREADY_ACTIVE).
// - 센터: 역할 목록 `centerScoped` 대로(역할 코드를 화면에 고정하지 않는다). true 면 1개 이상 필수, false 면 보내지 않는다.
// - 한 요청에 역할은 한 번(여러 센터는 한 줄의 centers 에).
// - 이미 가진 권한: 같은 역할 + 센터가 겹치고(센터가 필요 없는 역할은 센터 상관없음) + 기간이 지금 이후로 겹치면. validUntil 은 "이 시각부터 무효"라
//   마지막 날 = 서울 날짜로 그 전날.
import { ProblemFailure, type EmployeeGrant, type EmployeeRole } from '@pmart/web-core';

const DAY = 86_400_000;
const KST = 9 * 3_600_000;

export const needsCenter = (roles: readonly EmployeeRole[], code: string): boolean => roles.find((r) => r.code === code)?.centerScoped ?? false;

/** 서울 날짜 YYYY-MM-DD */
const seoulDate = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
/** 서울 날짜 YYYY-MM-DD 의 0시(UTC ms) */
const seoulStart = (date: string) => Date.parse(`${date}T00:00:00+09:00`);

/**
 * validUntil(이 시각부터 무효) → 마지막 날(서울 날짜) = 그 직전 순간의 날짜. 없으면 null(기한 없음).
 * 자정에 끝나면 전날, 회수처럼 낮에 끝나면 그날(하루를 빼면 회수된 줄이 하루 일찍 끝난 것처럼 보인다 — 검토 지적 2026-11-17).
 */
export const lastDayOf = (validUntil: string | null | undefined): string | null => (validUntil ? seoulDate(Date.parse(validUntil) - 1) : null);

/**
 * 연장 시작일(백엔드 요청 hr-backoffice/2026-11-18-request-grant-extension §2): validUntil 은 "이 시각부터 무효"(마지막 날 다음 날 0시 서울)라
 * **validUntil 의 서울 날짜를 그대로** 새 요청의 validFrom 으로 넣는다(그 전날이 아님).
 */
export const extensionStart = (validUntil: string): string => seoulDate(Date.parse(validUntil));

/** 이 권한 뒤에 이어지는 같은 권한(같은 역할·같은 센터, 이 권한이 끝나는 때 또는 그 뒤에 시작, 회수 안 됨) — 회수할 때 함께 안내 */
export function followingGrants(all: readonly EmployeeGrant[], g: EmployeeGrant): EmployeeGrant[] {
  if (!g.validUntil) return [];
  const end = Date.parse(g.validUntil);
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));
  return all.filter((x) => x.grantId !== g.grantId && !x.revokedAt && x.role === g.role && same(x.centers, g.centers) && Date.parse(x.validFrom) >= end);
}

/**
 * 미리 경고(hr-service 0.7.0 CENTER_ROLE_MIX — 서버가 정본): 센터 지정 역할(MFC 역할)을 고를 때, 끝나지 않은 다른 센터 지정 역할이 다른 센터 묶음이면
 * 토큰에서 역할·센터가 따로 합쳐져 다른 센터에서도 그 역할이 된다. 같은 역할끼리는 센터가 달라도 된다.
 */
export function roleMixGrants(existing: readonly EmployeeGrant[], roles: readonly EmployeeRole[], draft: GrantDraftLike, now: number): EmployeeGrant[] {
  if (!draft.role || !needsCenter(roles, draft.role) || draft.centers.length === 0) return [];
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));
  return activeGrants(existing, now).filter((g) => g.role !== draft.role && needsCenter(roles, g.role) && !same(g.centers, draft.centers));
}

/** 끝나지 않은 권한(유효하거나 시작 전) — 회수된 줄은 validUntil = 회수 시각이라 자연히 빠진다 */
export const activeGrants = (grants: readonly EmployeeGrant[], now: number): EmployeeGrant[] =>
  grants.filter((g) => !g.revokedAt && (!g.validUntil || Date.parse(g.validUntil) > now));

export interface GrantDraftLike {
  readonly role: string;
  readonly centers: readonly string[];
  readonly validFrom: string;
  readonly validTo: string;
}

/**
 * 이 요청과 겹치는 이미 가진 권한(미리 경고용 — 서버가 정본). 요청 기간을 비우면 서버는 근무 기간으로 보므로(정규직은 끝 없음) 끝을 열어 둔다.
 * 요청 시작을 비우면 오늘부터로 본다.
 */
export function overlappingGrants(existing: readonly EmployeeGrant[], draft: GrantDraftLike, centerScoped: boolean, now: number): EmployeeGrant[] {
  if (!draft.role) return [];
  const start = draft.validFrom ? seoulStart(draft.validFrom) : now;
  const end = draft.validTo ? seoulStart(draft.validTo) + DAY : Number.POSITIVE_INFINITY;
  return activeGrants(existing, now).filter((g) => {
    if (g.role !== draft.role) return false;
    if (centerScoped && !g.centers.some((c) => draft.centers.includes(c))) return false;
    const gStart = Date.parse(g.validFrom);
    const gEnd = g.validUntil ? Date.parse(g.validUntil) : Number.POSITIVE_INFINITY;
    return start < gEnd && gStart < end;
  });
}

/** 400·409 의 줄별 문제 — `details[].field` 가 `<list>[i]…` 인 것. index -1 = 목록 전체(예: 같은 역할 두 줄) */
export interface LineProblem {
  readonly index: number;
  readonly part: 'role' | 'centers' | 'line' | 'list';
  readonly reason: string;
}

export function lineProblems(failure: unknown, list: 'grants' | 'requestedGrants'): LineProblem[] {
  if (!(failure instanceof ProblemFailure)) return [];
  return failure.problem.details.flatMap((d): LineProblem[] => {
    const field = d.field ?? '';
    if (field === list) return [{ index: -1, part: 'list', reason: d.reason ?? '' }];
    const hit = new RegExp(`^${list}\\[(\\d+)\\](?:\\.(role|centers))?$`).exec(field);
    if (!hit) return [];
    const part = hit[2] === 'role' ? 'role' : hit[2] === 'centers' ? 'centers' : 'line';
    return [{ index: Number(hit[1]), part, reason: d.reason ?? '' }];
  });
}

/** 409 GRANT_ALREADY_ACTIVE reason `existingGrantId=…;role=…;centers=A,B;validFrom=…;validUntil=…|none;extension=true|false` */
export function parseConflict(reason: string): { existingGrantId?: string; extension: boolean } {
  const kv = new Map(
    reason
      .split(';')
      .map((p) => p.split('='))
      .filter((p): p is [string, string] => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()] as const),
  );
  const id = kv.get('existingGrantId');
  return { ...(id ? { existingGrantId: id } : {}), extension: kv.get('extension') === 'true' };
}

/**
 * 직원 이름에 쓸 수 없는 문자(hr-service 0.5.1 — Keycloak 사용자 프로필 person-name-prohibited-characters).
 * 백엔드 회신 hr-backoffice/2026-11-17-reply-keycloak-400-provisioning: 이 문자가 있으면 계정 발급이 400 으로 실패했다 → 이제 등록에서 400 field name.
 * 화면은 입력 도움으로 미리 알린다(판정은 서버).
 */
export const NAME_PROHIBITED = ['<', '>', '&', '"', '$', '%', '!', '#', '?', '§', ';', '*', '~', '/', '\\', '|', '^', '=', '[', ']', '{', '}', '(', ')'] as const;
/** 이름에 든 쓸 수 없는 문자(겹치지 않게, 나온 순서) */
export const prohibitedInName = (name: string): string[] => [...new Set([...name].filter((c) => (NAME_PROHIBITED as readonly string[]).includes(c)))];

/** 400 의 칸 문제 — details[].field 가 그 칸이면 true */
export const fieldRejected = (failure: unknown, field: string): boolean => failure instanceof ProblemFailure && failure.problem.details.some((d) => d.field === field);

/** Problem code(오류 분기는 code 로만) */
export const failureCodeOf = (failure: unknown): string | undefined => (failure instanceof ProblemFailure ? failure.problem.code : undefined);

/** 서버가 준 사람이 읽는 문장(있으면 그대로 보인다 — 요청서 §5) */
export const problemDetail = (failure: unknown): string | null =>
  failure instanceof ProblemFailure && failure.problem.detail ? failure.problem.detail : null;
