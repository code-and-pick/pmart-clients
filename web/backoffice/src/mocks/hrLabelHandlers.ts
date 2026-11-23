// hr 0.8.0 `GET /hr/employee-labels` 목(ADR-0070 덧붙임 2026-11-19 — 직원 표시 "이름 · 사번"). 아는 ID 만 돌려준다(모르는 ID 는 빠짐).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';

export const MOCK_EMPLOYEE_LABELS: Readonly<Record<string, { name: string; employeeNo: string }>> = {
  'op-admin-1': { name: '[목] 관리자', employeeNo: 'P2026-00001' },
  'op-md-1': { name: '[목] 김엠디', employeeNo: 'P2026-00002' },
  'op-approver-1': { name: '[목] 이승인', employeeNo: 'P2026-00003' },
  'op-center-1': { name: '[목] 박센터', employeeNo: 'P2026-00004' },
  'op-cs-1': { name: '[목] 최상담', employeeNo: 'P2026-00005' },
  'op-rider-ops-1': { name: '[목] 정운영', employeeNo: 'P2026-00006' },
  'op-cs-rider-1': { name: '[목] 한상담', employeeNo: 'P2026-00007' },
  'op-marketing-1': { name: '[목] 윤마케', employeeNo: 'P2026-00008' },
  'op-marketing-2': { name: '[목] 서마케', employeeNo: 'P2026-00009' },
  'OP-seed-hr-1': { name: '[목] 홍인사', employeeNo: 'P2026-00014' },
  // 퇴사자(hr 0.11.0 activeOnly=true 면 빠짐)
  'op-left-1': { name: '[목] 오퇴사', employeeNo: 'P2025-00099' },
};

/** 퇴사자(LEFT) — activeOnly=true 면 빠진다 */
const MOCK_LEFT: ReadonlySet<string> = new Set(['op-left-1']);

export const hrLabelHandlers = [
  http.get(`${API_BASE}/hr/employee-labels`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const bad = () => HttpResponse.json({ type: 'about:blank', title: 'bad', status: 400, code: 'VALIDATION_FAILED', traceId: 't' }, { status: 400, headers: { 'content-type': 'application/problem+json' } });
    const ids = q.getAll('operatorIds');
    // hr 0.10.0 HR-5 — employeeNos(반복 또는 쉼표), operatorIds 와 둘 중 하나만, 사번 모양 P<연도 4>-<5자리> 아니면 400. 퇴사자 포함(목은 재직 구분 없음)
    const nos = q.getAll('employeeNos').flatMap((v) => v.split(','));
    if ((ids.length > 0) === (nos.length > 0)) return bad();
    if (nos.length > 0) {
      if (nos.length > 50 || nos.some((n) => !/^P\d{4}-\d{5}$/.test(n))) return bad();
      const activeOnly = q.get('activeOnly') === 'true';
      return HttpResponse.json({ items: Object.entries(MOCK_EMPLOYEE_LABELS).filter(([id, v]) => nos.includes(v.employeeNo) && !(activeOnly && MOCK_LEFT.has(id))).map(([operatorId, v]) => ({ operatorId, ...v })) });
    }
    if (ids.length > 50) return bad();
    return HttpResponse.json({ items: ids.flatMap((operatorId) => (MOCK_EMPLOYEE_LABELS[operatorId] ? [{ operatorId, ...MOCK_EMPLOYEE_LABELS[operatorId] }] : [])) });
  }),
];
