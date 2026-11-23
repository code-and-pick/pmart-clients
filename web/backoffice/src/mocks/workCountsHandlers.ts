// ⚠ 화면 개발·시험용 목 — bff 0.15.0 `GET /backoffice/views/work-counts`(지금 일 건수, 대시보드 D4, 백엔드 PR #195).
// 다른 목 화면과 숫자가 어긋나지 않게 같은 목 조회(접수 건 지표·처리 대기·승인 목록·실시간 배송)를 안에서 불러 센다.
// 원천이 실패하면 그 묶음 줄을 빼고 unavailableSources 에 원천 이름(0건으로 바꾸지 않는다). OPERATOR_ADMIN 만(그 밖 403).
import { http, HttpResponse } from 'msw';

import { API_BASE, BFF_BASE } from '../api/client';
import type { components } from '../api/generated/backoffice-bff';
import { operator, problem, unauthorized } from './support';

type WorkCount = components['schemas']['WorkCount'];

const APPROVAL_STATES = ['REVIEW_PENDING', 'EVIDENCE_REQUIRED'] as const;

async function getJson(request: Request, url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { headers: { Authorization: request.headers.get('Authorization') ?? '' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export const workCountsHandlers = [
  http.get(`${BFF_BASE}/views/work-counts`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const now = new Date().toISOString();
    const counts: WorkCount[] = [];
    const unavailable: string[] = [];
    const stamp = (system: string) => ({ system, confidence: 'DIRECT' as const, asOf: { asOf: now, freshness: 'CURRENT' as const } });
    const sources: Array<ReturnType<typeof stamp>> = [];

    // CASES·OBLIGATIONS·SHIFT_HANDOVERS·INQUIRIES — case `GET /cases/metrics`(정확, 0건 줄 없음)
    type CaseMetrics = { cases?: Array<{ kind: string; open: number; unassigned: number; overdue: number }>; obligations?: Array<{ owner: string; open: number; overdue: number }>; pendingHandovers?: number; inquiries?: Array<{ requesterType: string; awaiting: number }> | Record<string, number> };
    const cm = (await getJson(request, `${API_BASE}/cases/metrics`)) as CaseMetrics | null;
    if (cm) {
      sources.push(stamp('case-service'));
      for (const c of cm.cases ?? []) {
        if (c.open > 0) counts.push({ group: 'CASES', key: 'OPEN', segment: c.kind, value: c.open, complete: true, source: 'case-service' });
        if (c.unassigned > 0) counts.push({ group: 'CASES', key: 'UNASSIGNED', segment: c.kind, value: c.unassigned, complete: true, source: 'case-service' });
        if (c.overdue > 0) counts.push({ group: 'CASES', key: 'OVERDUE', segment: c.kind, value: c.overdue, complete: true, source: 'case-service' });
      }
      for (const o of cm.obligations ?? []) {
        if (o.open > 0) counts.push({ group: 'OBLIGATIONS', key: 'OPEN', segment: o.owner, value: o.open, complete: true, source: 'case-service' });
        if (o.overdue > 0) counts.push({ group: 'OBLIGATIONS', key: 'OVERDUE', segment: o.owner, value: o.overdue, complete: true, source: 'case-service' });
      }
      if ((cm.pendingHandovers ?? 0) > 0) counts.push({ group: 'SHIFT_HANDOVERS', key: 'PENDING', segment: null, value: cm.pendingHandovers ?? 0, complete: true, source: 'case-service' });
    } else unavailable.push('case-service');

    // 문의 답변 대기 — 고객·라이더(목은 목록 조회로 센다)
    let inquiriesOk = true;
    for (const side of ['CUSTOMER', 'RIDER'] as const) {
      const r = (await getJson(request, `${API_BASE}/inquiries?requesterType=${side}&status=RECEIVED&size=200`)) as { items?: unknown[] } | null;
      if (!r) inquiriesOk = false;
      else if ((r.items ?? []).length > 0) counts.push({ group: 'INQUIRIES', key: 'AWAITING_ANSWER', segment: side, value: (r.items ?? []).length, complete: true, source: 'case-service' });
    }
    if (!inquiriesOk && !unavailable.includes('case-service')) unavailable.push('case-service');

    // PENDING_WORK — 처리 대기와 같은 모음
    // bff 0.24.0 BF-4 centerId — 처리 대기만 같은 규칙으로 거르고(목은 배송 줄은 그대로), 사건 지표·승인은 범위 밖 → centerUnfilteredSources
    const centerId = new URL(request.url).searchParams.get('centerId');
    const pw = (await getJson(request, `${BFF_BASE}/views/pending-work${centerId ? `?centerId=${encodeURIComponent(centerId)}` : ''}`)) as { items?: Array<{ kind: string }>; truncated?: boolean } | null;
    if (pw) {
      const byKind = new Map<string, number>();
      for (const i of pw.items ?? []) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
      for (const [k, v] of byKind) counts.push({ group: 'PENDING_WORK', key: 'COUNT', segment: k, value: v, complete: !pw.truncated, source: 'backoffice-bff' });
    } else unavailable.push('order-orchestration-service');

    // APPROVALS — 심사 대기·증빙 요청, 종류별(보는 사람이 심사할 수 있는 것만이 아님)
    let approvalsOk = true;
    for (const st of APPROVAL_STATES) {
      const r = (await getJson(request, `${API_BASE}/approvals?reviewState=${st}&size=200`)) as { items?: Array<{ type?: string }> } | null;
      if (!r) {
        approvalsOk = false;
        continue;
      }
      const byType = new Map<string, number>();
      for (const a of r.items ?? []) byType.set(a.type ?? 'UNKNOWN', (byType.get(a.type ?? 'UNKNOWN') ?? 0) + 1);
      for (const [t, v] of byType) counts.push({ group: 'APPROVALS', key: st, segment: t, value: v, complete: true, source: 'approval-service' });
    }
    // bff 0.16.0: 보는 사람이 지금 결정할 수 있는 것(AP-3 decidableByMe) — 종류별
    const mine = (await getJson(request, `${API_BASE}/approvals?reviewState=REVIEW_PENDING&decidableByMe=true&size=200`)) as { items?: Array<{ type?: string }> } | null;
    if (!mine) approvalsOk = false;
    else {
      const byType = new Map<string, number>();
      for (const a of mine.items ?? []) byType.set(a.type ?? 'UNKNOWN', (byType.get(a.type ?? 'UNKNOWN') ?? 0) + 1);
      for (const [t, v] of byType) counts.push({ group: 'APPROVALS', key: 'DECIDABLE_BY_ME', segment: t, value: v, complete: true, source: 'approval-service' });
    }
    if (approvalsOk) sources.push(stamp('approval-service'));
    else unavailable.push('approval-service');

    // DELIVERIES — 끝나지 않은 배송 상태별(늦은 배송 수는 없다)
    const lv = (await getJson(request, `${BFF_BASE}/views/live-delivery?size=200`)) as { items?: Array<{ delivery?: { state?: string | null } | null }>; page?: { nextCursor?: string | null } } | null;
    if (lv) {
      sources.push(stamp('delivery-execution-service'));
      const byState = new Map<string, number>();
      for (const i of lv.items ?? []) {
        const s = i.delivery?.state ?? 'UNKNOWN';
        byState.set(s, (byState.get(s) ?? 0) + 1);
      }
      for (const [s, v] of byState) counts.push({ group: 'DELIVERIES', key: 'ACTIVE', segment: s, value: v, complete: !lv.page?.nextCursor, source: 'delivery-execution-service' });
    } else unavailable.push('delivery-execution-service');

    return HttpResponse.json({ composedAt: now, sources, unavailableSources: unavailable, centerUnfilteredSources: centerId ? ['order-orchestration-service', 'case-service', 'approval-service'] : [], counts });
  }),
];
