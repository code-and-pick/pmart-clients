// 대시보드 보강(2026-11-18 사용자 "대시보드가 약하다" 피드백 → 지금 있는 조회만으로 되는 것 먼저).
// - 운영 위험: bff pending-work 를 종류별로 센다(처리 대기 화면과 같은 queryKey — 같은 조회를 두 번 부르지 않는다).
//   결제 결과 불명(STUCK_SAGA·reasonCode PAYMENT_UNKNOWN)은 따로 뺀다. truncated 면 "N+", 못 읽으면 "?", 못 읽은 원천은 숨기지 않는다.
// - 지금 배송: bff live-delivery 첫 쪽(50줄)을 센다 — "읽은 N줄 기준"을 함께 적는다(전체 건수가 아니다).
// - 심사 대기 유형별: approval `GET /approvals?type=&reviewState=REVIEW_PENDING` 유형마다(50 넘으면 "50+").
// 매출·상품별 판매·주문 상태 분포·정시 배송률 같은 집계는 서버에 없어 만들지 않는다(백엔드 요청 docs/handoff/backoffice/2026-11-18-backend-dashboard-metrics.md).
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { APPROVAL_TYPES } from '../api/models';
import { useApi } from './ApiContext';
import { GroupIcon } from './groupIcons';
import { systemName } from '../shared/SourceStamps';
import { messages } from '../shared/messages';
import { Section } from '../shared/admin';

const m = messages.dashboard;
const LIVE_SIZE = 50;
const APPROVAL_SIZE = 50;

type Tone = 'error' | 'warning' | 'info';
const toneText: Record<Tone, string> = { error: 'text-error', warning: 'text-warning', info: 'text-info' };
const toneBar: Record<Tone, string> = { error: 'border-l-error', warning: 'border-l-warning', info: 'border-l-info' };

/** 숫자 하나 + 이름 + 누르면 그 화면. value 가 null 이면 못 읽음("?") */
function Tile({ label, value, more, to, tone, testId }: { readonly label: string; readonly value: number | null | undefined; readonly more?: boolean; readonly to: string; readonly tone: Tone; readonly testId: string }) {
  const has = typeof value === 'number' && value > 0;
  const text = value === undefined ? '…' : value === null ? '?' : `${value}${more ? '+' : ''}`;
  return (
    <Link
      to={to}
      data-testid={testId}
      className={`block rounded-lg border border-l-4 border-base-300 px-4 py-3 transition hover:bg-base-200/60 ${has ? toneBar[tone] : 'border-l-base-300'}`}
      title={value === null ? m.failed : undefined}
    >
      <p className="text-xs text-base-content/60">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${value === null ? 'text-base-content/40' : has ? toneText[tone] : 'text-base-content/70'}`}>{text}</p>
    </Link>
  );
}

/** 운영 위험 — 처리 대기를 종류별로(결제 결과 불명은 따로) */
export function RiskPanel() {
  const api = useApi();
  const q = useQuery({
    queryKey: ['bff', 'pending-work'],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.bff.GET('/views/pending-work', {})),
  });
  const items = q.data?.items ?? [];
  const count = (pred: (i: (typeof items)[number]) => boolean): number | null | undefined => (q.isError ? null : q.data ? items.filter(pred).length : undefined);
  const more = Boolean(q.data?.truncated);
  const missing = q.data?.unavailableSources ?? [];
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <GroupIcon id="pending" className="h-4 w-4 text-base-content/50" />
          {m.risk.title}
        </span>
      }
      aside={<Link className="link text-xs" to="/pending">{m.more}</Link>}
      testId="dash-risk"
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Tile label={m.risk.paymentUnknown} value={count((i) => i.kind === 'STUCK_SAGA' && i.reasonCode === 'PAYMENT_UNKNOWN')} more={more} to="/pending" tone="error" testId="dash-risk-payment" />
        <Tile label={m.risk.stuck} value={count((i) => i.kind === 'STUCK_SAGA' && i.reasonCode !== 'PAYMENT_UNKNOWN')} more={more} to="/pending" tone="warning" testId="dash-risk-stuck" />
        <Tile label={m.risk.issue} value={count((i) => i.kind === 'FULFILLMENT_ISSUE')} more={more} to="/pending" tone="warning" testId="dash-risk-issue" />
        <Tile label={m.risk.handover} value={count((i) => i.kind === 'MFC_HANDOVER_REJECTED')} more={more} to="/pending" tone="warning" testId="dash-risk-handover" />
        <Tile label={m.risk.stop} value={count((i) => i.kind === 'MFC_STOP_FAILED')} more={more} to="/pending" tone="warning" testId="dash-risk-stop" />
      </div>
      {missing.length > 0 && (
        <p className="mt-3 text-xs text-warning" data-testid="dash-risk-missing" title={missing.join(', ')}>
          {m.risk.missing(missing.map(systemName).join(', '))}
        </p>
      )}
    </Section>
  );
}

/** 지금 배송 — 실시간 배송 현황 첫 쪽을 센 값(전체 아님) */
export function LiveSummary() {
  const api = useApi();
  const q = useQuery({
    queryKey: ['dashboard', 'live-delivery'],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.bff.GET('/views/live-delivery', { params: { query: { size: LIVE_SIZE } } })),
  });
  const items = q.data?.items ?? [];
  const now = q.data?.composedAt ? Date.parse(q.data.composedAt) : Number.NaN;
  const count = (pred: (i: (typeof items)[number]) => boolean): number | null | undefined => (q.isError ? null : q.data ? items.filter(pred).length : undefined);
  const more = Boolean(q.data?.page?.nextCursor);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <GroupIcon id="lookup" className="h-4 w-4 text-base-content/50" />
          {m.live.title}
        </span>
      }
      aside={<span className="text-xs text-base-content/50">{q.data ? m.live.basis(items.length, more) : ''}</span>}
      testId="dash-live"
    >
      <div className="grid grid-cols-3 gap-3">
        <Tile label={m.live.late} value={q.data && !q.data.composedAt ? null : count((i) => !!i.promisedAt && Date.parse(i.promisedAt) < now)} to="/live-delivery" tone="error" testId="dash-live-late" />
        <Tile label={m.live.noRider} value={count((i) => !i.riderId)} to="/live-delivery" tone="warning" testId="dash-live-norider" />
        <Tile label={m.live.failure} value={count((i) => i.delivery?.state === 'FAILURE_REPORTED')} to="/deliveries?q=1&state=FAILURE_REPORTED&sort=OLDEST" tone="warning" testId="dash-live-failure" />
      </div>
    </Section>
  );
}

/** 심사 대기 유형별 — 유형마다 같은 승인 목록 조회(50 넘으면 "50+") */
export function ApprovalTypes() {
  const api = useApi();
  const qs = useQueries({
    queries: APPROVAL_TYPES.map((type) => ({
      queryKey: ['dashboard', 'approvals-by-type', type],
      refetchInterval: 60_000,
      queryFn: async () => {
        const r = await request('GET', api.approval.GET('/approvals', { params: { query: { type, reviewState: 'REVIEW_PENDING', size: APPROVAL_SIZE } } }));
        const n = (r.items ?? []).length;
        return { n, more: Boolean(r.page?.nextCursor) };
      },
    })),
  });
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <GroupIcon id="approval" className="h-4 w-4 text-base-content/50" />
          {m.approvalTypes}
        </span>
      }
      aside={<Link className="link text-xs" to="/approvals?reviewState=REVIEW_PENDING">{m.more}</Link>}
      testId="dash-approval-types"
    >
      <ul className="divide-y divide-base-300">
        {APPROVAL_TYPES.map((type, i) => {
          const q = qs[i]!;
          const v: ReactNode = q.data ? `${q.data.n}${q.data.more ? '+' : ''}` : q.isError ? '?' : '…';
          const has = (q.data?.n ?? 0) > 0;
          return (
            <li key={type}>
              <Link to={`/approvals?reviewState=REVIEW_PENDING&type=${type}`} className="flex items-center justify-between py-2 text-sm hover:text-primary" data-testid={`dash-approval-${type}`}>
                <span className={has ? 'font-medium' : 'text-base-content/55'}>{messages.approvals.typeName[type] ?? type}</span>
                <span className={`tabular-nums ${has ? 'font-bold' : 'text-base-content/45'}`} title={q.isError ? m.failed : undefined}>
                  {v}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * 처리 기한 지킴 날짜별 — CASE_SLA totals(날짜 묶음)의 서버 비율을 막대로. 닫힌 건이 없는 날(묶음 없음)·비율 null 은 "—"(0% 아님).
 */
export function SlaTrend({ days, totals }: { readonly days: readonly string[]; readonly totals: ReadonlyArray<{ readonly bucket: string; readonly ratio?: number | null; readonly numerator: number; readonly denominator: number }> }) {
  const byDay = new Map(totals.map((t) => [t.bucket.slice(0, 10), t]));
  return (
    <div className="flex h-20 items-end gap-1.5" data-testid="dash-sla-trend">
      {days.map((d) => {
        const t = byDay.get(d);
        const ratio = t && t.ratio !== null && t.ratio !== undefined ? t.ratio : null;
        return (
          <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={t ? `${d} · ${t.numerator}/${t.denominator}` : `${d} · ${m.slaNoClosed}`} data-testid="dash-sla-day">
            {ratio === null ? (
              <div className="h-1 w-full max-w-6 rounded bg-base-300" aria-hidden="true" />
            ) : (
              <div className={`w-full max-w-6 rounded-t ${ratio >= 0.9 ? 'bg-success/70' : ratio >= 0.7 ? 'bg-warning/70' : 'bg-error/70'}`} style={{ height: `${Math.max(6, Math.round(ratio * 100))}%` }} aria-hidden="true" />
            )}
            <span className="text-[10px] text-base-content/45">{ratio === null ? '—' : `${Math.round(ratio * 100)}`}</span>
          </div>
        );
      })}
    </div>
  );
}
