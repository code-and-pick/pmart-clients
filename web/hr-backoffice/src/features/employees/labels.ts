import type { Affiliation, EmploymentStatus, ProvisioningStep } from '../../api/models';
import type { Tone } from '../../shared/admin';
import { messages as m } from '../../shared/messages';

/** "센터 MFC-BSN-01" / "본사 부서 HR" — 코드는 서버 값 그대로 */
export const affiliationText = (a: Affiliation) => `${m.affiliationType[a.type]} ${a.code}`;

/**
 * 요청 권한의 기간. 계약(hr-service RequestedGrantState): 서버가 비워 받은 값을 채워 준다 — validFrom = 근무 시작일,
 * validTo = 계약 종료일. validTo 가 없으면 종료일이 없는 것(정규직)이라 "기한 없음"(백엔드 회신 2026-11-13 hr-backoffice-deployed).
 * 시작일은 늘 오지만, 없으면 지어내지 않고 "-".
 */
export const periodText = (from: string | undefined, to: string | undefined) => `${from ?? m.none} ~ ${to ?? m.grantNoEnd}`;

/** 상태 꼬리표 색(2026-11-18) — 서버 값 그대로 이름만 색으로 나눈다 */
export const statusTone = (s: EmploymentStatus): Tone => (s === 'ACTIVE' ? 'success' : s === 'SUSPENDED' ? 'warning' : 'ghost');
export const provisioningTone = (s: ProvisioningStep): Tone => (s === 'DONE' ? 'success' : s === 'FAILED' || s === 'COMPENSATED' ? 'error' : 'info');
