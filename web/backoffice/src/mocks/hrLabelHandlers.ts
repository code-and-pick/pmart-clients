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
};

export const hrLabelHandlers = [
  http.get(`${API_BASE}/hr/employee-labels`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll('operatorIds');
    if (ids.length < 1 || ids.length > 50) return HttpResponse.json({ type: 'about:blank', title: 'bad', status: 400, code: 'VALIDATION_FAILED', traceId: 't' }, { status: 400, headers: { 'content-type': 'application/problem+json' } });
    return HttpResponse.json({ items: ids.flatMap((operatorId) => (MOCK_EMPLOYEE_LABELS[operatorId] ? [{ operatorId, ...MOCK_EMPLOYEE_LABELS[operatorId] }] : [])) });
  }),
];
