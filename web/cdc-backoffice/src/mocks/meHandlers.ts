// 내 인사 정보 목: hr-service `GET /hr/employees/me` — 토큰의 운영자 ID 로 찾고, 없으면 404(인사 기록 없음).
// 운영자 표시 `GET /hr/employee-labels?operatorIds=`(0.8.0) — 아는 ID 만(퇴사자 포함), 모르는 ID 는 빠진다. 1~50개가 아니면 400.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/hr';
import { operator, problem, unauthorized } from './support';

type EmployeeSelf = components['schemas']['EmployeeSelf'];
type EmployeeLabel = components['schemas']['EmployeeLabel'];

const employees: Readonly<Record<string, EmployeeSelf>> = {
  'OP-cdc-sup': {
    operatorId: 'OP-cdc-sup',
    employeeNo: 'E-2026-0401',
    name: '칠관리',
    mailAddress: 'cdc-sup@pmart.test',
    employmentType: 'REGULAR',
    affiliation: { type: 'CENTER', code: 'CDC01' },
    status: 'ACTIVE',
  },
  'OP-admin-cdc': {
    operatorId: 'OP-admin-cdc',
    employeeNo: 'E-2026-0002',
    name: '오운영',
    mailAddress: 'admin-cdc@pmart.test',
    employmentType: 'REGULAR',
    affiliation: { type: 'HQ_DEPARTMENT', code: '1004' },
    status: 'ACTIVE',
  },
};

const labels: Readonly<Record<string, Omit<EmployeeLabel, 'operatorId'>>> = {
  'OP-cdc-sup': { name: '칠관리', employeeNo: 'E-2026-0401' },
  'OP-admin-cdc': { name: '오운영', employeeNo: 'E-2026-0002' },
  'OP-other-sup': { name: '박관리', employeeNo: 'E-2026-0402' },
  'cdcw-fc-01': { name: '김피킹', employeeNo: 'E-2026-0501' },
  'cdcw-dl-02': { name: '이분배', employeeNo: 'E-2026-0502' },
  'cdcw-fc-03': { name: '한피킹', employeeNo: 'E-2026-0503' },
  'cdcw-qc-01': { name: '최검품', employeeNo: 'E-2026-0504' },
  'cdcw-qc-02': { name: '정검품', employeeNo: 'E-2026-0505' },
};

export const meHandlers = [
  http.get(`${API_BASE}/hr/employee-labels`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const ids = [...new Set(new URL(request.url).searchParams.getAll('operatorIds'))];
    if (ids.length < 1 || ids.length > 50) return problem(400, 'VALIDATION_FAILED');
    return HttpResponse.json({ items: ids.flatMap((id) => (labels[id] ? [{ operatorId: id, ...labels[id] }] : [])) });
  }),
  http.get(`${API_BASE}/hr/employees/me`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const me = employees[who.subject];
    return me ? HttpResponse.json(me) : problem(404, 'NOT_FOUND');
  }),
];
