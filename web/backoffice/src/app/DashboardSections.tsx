// 대시보드 보강(2026-11-18 사용자 "대시보드가 약하다" 피드백 → 지금 있는 조회만으로 되는 것 먼저).
// - 운영 위험: bff pending-work 를 종류별로 센다(처리 대기 화면과 같은 queryKey — 같은 조회를 두 번 부르지 않는다).
//   결제 결과 불명(STUCK_SAGA·reasonCode PAYMENT_UNKNOWN)은 따로 뺀다. truncated 면 "N+", 못 읽으면 "?", 못 읽은 원천은 숨기지 않는다.
// - 지금 배송: bff live-delivery 첫 쪽(50줄)을 센다 — "읽은 N줄 기준"을 함께 적는다(전체 건수가 아니다).
// - 심사 대기 유형별: approval `GET /approvals?type=&reviewState=REVIEW_PENDING` 유형마다(50 넘으면 "50+").
// 매출·상품별 판매·주문 상태 분포·정시 배송률 같은 집계는 서버에 없어 만들지 않는다(백엔드 요청 docs/handoff/backoffice/2026-11-18-backend-dashboard-metrics.md).
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { APPROVAL_TYPES } from '../api/models';
import { PENDING_KINDS, useApprovalTypeCounts } from './listCounts';
import { AllCentersTag, useCenterScope } from '../shared/centerScope';
import { useApi } from './ApiContext';
import { GroupIcon } from './groupIcons';
import { systemName } from '../shared/SourceStamps';
import { messages } from '../shared/messages';
import { Section } from '../shared/admin';

const m = messages.dashboard;
const LIVE_SIZE = 50;

type Tone = 'error' | 'warning' | 'info';
// 2026-11-20 통계 개편: 숫자는 글자색(0 이면 흐리게), 있을 때만 이름 앞 상태 점 — 빨강(급함)·노랑(주의). 파랑 숫자는 없앴다
const toneDot: Record<Tone, string> = { error: 'bg-error', warning: 'bg-warning', info: 'bg-base-content/30' };

/** 숫자 하나 + 이름 + 누르면 그 화면. value 가 null 이면 못 읽음("?") */
function Tile({ label, value, more, to, tone, testId, allCenters }: { readonly label: string; readonly value: number | null | undefined; readonly more?: boolean; readonly to: string; readonly tone: Tone; readonly testId: string; readonly allCenters?: boolean }) {
  const has = typeof value === 'number' && value > 0;
  const text = value === undefined ? '…' : value === null ? '?' : `${value}${more ? '+' : ''}`;
  return (
    <Link
      to={to}
      data-testid={testId}
      className="block bg-base-100 px-4 py-3 transition-colors hover:bg-base-200/60"
      title={value === null ? m.failed : undefined}
    >
      <p className="flex items-center gap-1.5 truncate text-sm text-base-content/70">
        {has && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`} aria-hidden="true" />}
        {label}
      </p>
      <p className={`mt-0.5 flex items-center text-[26px] font-semibold leading-tight tracking-tight ${value === null ? 'text-base-content/40' : has ? (tone === 'error' ? 'text-error' : '') : 'text-base-content/45'}`}>
        {text}
        {allCenters && <AllCentersTag />}
      </p>
    </Link>
  );
}

/** 운영 위험 — 처리 대기를 종류별로(결제 결과 불명은 따로) */
export function RiskPanel() {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const q = useQuery({
    queryKey: ['bff', 'pending-work', center],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.bff.GET('/views/pending-work', center ? { params: { query: { centerId: center } } } : {})),
  });
  const items = q.data?.items ?? [];
  const count = (pred: (i: (typeof items)[number]) => boolean): number | null | undefined => (q.isError ? null : q.data ? items.filter(pred).length : undefined);
  const more = Boolean(q.data?.truncated);
  const missing = q.data?.unavailableSources ?? [];
  // bff 0.24.0 — 센터를 골라도 멈춘 주문 처리(사가)는 센터가 없어 모든 센터 값(결제 결과 불명·멈춘 주문 두 칸)
  const sagaAll = (q.data?.centerUnfilteredSources ?? []).includes('order-orchestration-service');
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
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 xl:grid-cols-5">
        <Tile label={m.risk.paymentUnknown} value={count(PENDING_KINDS[0].match)} more={more} to="/pending" tone="error" testId="dash-risk-payment" allCenters={sagaAll} />
        <Tile label={m.risk.stuck} value={count(PENDING_KINDS[1].match)} more={more} to="/pending" tone="warning" testId="dash-risk-stuck" allCenters={sagaAll} />
        <Tile label={m.risk.issue} value={count(PENDING_KINDS[2].match)} more={more} to="/pending" tone="warning" testId="dash-risk-issue" />
        <Tile label={m.risk.handover} value={count(PENDING_KINDS[3].match)} more={more} to="/pending" tone="warning" testId="dash-risk-handover" />
        <Tile label={m.risk.stop} value={count(PENDING_KINDS[4].match)} more={more} to="/pending" tone="warning" testId="dash-risk-stop" />
      </div>
      {missing.length > 0 && (
        <p className="mt-3 text-xs text-warning" data-testid="dash-risk-missing" title={missing.join(', ')}>
          {m.risk.missing(missing.map(systemName).join(', '))}
        </p>
      )}
    </Section>
  );
}

/** 실시간 배송 첫 쪽(대시보드 숫자 카드·지금 배송이 같은 queryKey) */
export function liveQuery(api: ReturnType<typeof useApi>) {
  return {
    queryKey: ['dashboard', 'live-delivery'],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.bff.GET('/views/live-delivery', { params: { query: { size: LIVE_SIZE } } })),
  };
}

/** 지금 배송 — 실시간 배송 현황 첫 쪽을 센 값(전체 아님) */
export function LiveSummary() {
  const api = useApi();
  const q = useQuery(liveQuery(api));
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
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
        <Tile label={m.live.late} value={q.data && !q.data.composedAt ? null : count((i) => !!i.promisedAt && Date.parse(i.promisedAt) < now)} to="/live-delivery" tone="error" testId="dash-live-late" />
        <Tile label={m.live.noRider} value={count((i) => !i.riderId)} to="/live-delivery" tone="warning" testId="dash-live-norider" />
        <Tile label={m.live.failure} value={count((i) => i.delivery?.state === 'FAILURE_REPORTED')} to="/deliveries?q=1&state=FAILURE_REPORTED&sort=OLDEST" tone="warning" testId="dash-live-failure" />
      </div>
    </Section>
  );
}

/** 심사 대기 유형별 — 유형마다 같은 승인 목록 조회(50 넘으면 "50+") */
export function ApprovalTypes() {
  // 셈은 승인함 숫자 띠와 같은 것(listCounts)
  const qs = useApprovalTypeCounts().map((c) => c.q);
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
