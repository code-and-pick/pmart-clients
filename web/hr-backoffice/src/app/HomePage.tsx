// 첫 화면(2026-11-19 사용자 "인사팀 쪽이 백오피스보다 심심하다").
// 2026-11-19 hr 0.9.0(회신 pmart-backend docs/handoff/clients/hr-backoffice/2026-11-19-reply-hr-dashboard.md):
// - 숫자 띠 `GET /hr/employees/counts`(H-D2) — 재직·정지·퇴사·계정 발급 실패·권한 승인 대기·계약 종료 임박(7일). 누르면 그 직원만 거른 목록(H-D1).
//   서버 DB 집계(complete). 못 읽으면 칸마다 "?" — 0 으로 보이지 않는다. complete=false 면 "N+".
// - 최근 등록 5명 — 직원 목록 기본 정렬(CREATED_DESC, 사번 내림차순) size 5.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { provisioningTone, statusTone } from '../features/employees/labels';
import { PageHeader, StatCard, StatStrip, StatusBadge } from '../shared/admin';
import { formatSeoul } from '@pmart/web-ui';
import { messages } from '../shared/messages';
import { TitleIcon, type TitleIconName } from '../shared/TitleIcon';

const m = messages;
const h = messages.home;

const SHORTCUTS: ReadonlyArray<{ readonly to: string; readonly icon: TitleIconName; readonly title: string; readonly body: string; readonly primary?: boolean }> = [
  { to: '/employees/new', icon: 'user', title: m.nav.register, body: h.registerBody, primary: true },
  { to: '/employees', icon: 'list', title: m.nav.employees, body: h.employeesBody },
  { to: '/permissions', icon: 'shield', title: m.nav.permissions, body: h.permissionsBody },
  { to: '/departments', icon: 'briefcase', title: m.nav.departments, body: h.departmentsBody },
];

/** 숫자 띠 — 서버 값만, 못 읽으면 "?" */
function Counts() {
  const api = useApi();
  const q = useQuery({ queryKey: ['hr', 'employee-counts'], queryFn: () => request('GET', api.hr.GET('/hr/employees/counts', { params: { query: { endingWithinDays: 7 } } })) });
  const d = q.data;
  const v = (c: { readonly value: number; readonly complete: boolean } | undefined) => (c ? `${c.value}${c.complete ? '' : '+'}` : q.isError ? '?' : '…');
  const has = (c: { readonly value: number } | undefined) => (c?.value ?? 0) > 0;
  const ending = d ? `/employees?status=ACTIVE&endDateFrom=${d.endingFrom}&endDateTo=${d.endingTo}&sort=END_DATE_ASC` : '/employees?status=ACTIVE&sort=END_DATE_ASC';
  return (
    <section aria-label={h.counts.label} className="space-y-2" data-testid="home-status">
      <StatStrip label={h.counts.label} testId="home-counts">
        <StatCard label={m.employmentStatus.ACTIVE} value={v(d?.active)} to="/employees?status=ACTIVE" testId="count-active" />
        <StatCard label={m.employmentStatus.SUSPENDED} value={v(d?.suspended)} tone={has(d?.suspended) ? 'warning' : undefined} to="/employees?status=SUSPENDED" testId="count-suspended" />
        <StatCard label={m.employmentStatus.LEFT} value={v(d?.left)} to="/employees?status=LEFT" testId="count-left" />
        <StatCard label={h.counts.provisioningFailed} value={v(d?.provisioningFailed)} tone={has(d?.provisioningFailed) ? 'error' : undefined} to="/employees?provisioningStep=FAILED,COMPENSATED" hint={h.counts.provisioningFailedHint} testId="count-provisioning-failed" />
        <StatCard label={h.counts.grantPending} value={v(d?.grantPendingApproval)} tone={has(d?.grantPendingApproval) ? 'info' : undefined} to="/employees?status=ACTIVE&grantSubmission=SUBMITTED" hint={h.counts.grantPendingHint} testId="count-grant-pending" />
        <StatCard label={h.counts.endingSoon(d?.endingWithinDays ?? 7)} value={v(d?.endingSoon)} tone={has(d?.endingSoon) ? 'warning' : undefined} to={ending} hint={d ? `${d.endingFrom} ~ ${d.endingTo}` : undefined} testId="count-ending-soon" />
      </StatStrip>
      {q.isError && <p className="text-xs text-warning">{h.counts.failed}</p>}
    </section>
  );
}

/** 최근 등록 5명 — 직원 목록 기본 정렬(최근 등록 순) */
function Recent() {
  const api = useApi();
  const q = useQuery({ queryKey: ['hr', 'employees', 'recent'], queryFn: () => request('GET', api.hr.GET('/hr/employees', { params: { query: { size: 5 } } })) });
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100" data-testid="home-recent">
      <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold">
          <TitleIcon name="user" />
          {h.recent.title}
        </h2>
        <Link className="link text-xs" to="/employees">
          {h.recent.all}
        </Link>
      </div>
      {q.isPending ? (
        <p className="px-4 py-3 text-sm text-base-content/50">…</p>
      ) : q.isError ? (
        <p className="px-4 py-3 text-sm text-warning">{h.recent.failed}</p>
      ) : q.data.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-base-content/55">{h.recent.none}</p>
      ) : (
        <ul className="divide-y divide-base-300/70">
          {q.data.items.map((e) => (
            <li key={e.operatorId}>
              <Link className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-primary/5" to={`/employees/${encodeURIComponent(e.operatorId)}`} data-testid="recent-employee">
                <span className="font-semibold">{e.name}</span>
                <span className="font-mono text-xs text-base-content/50">{e.employeeNo}</span>
                <StatusBadge tone={statusTone(e.status)}>{m.employmentStatus[e.status]}</StatusBadge>
                <StatusBadge tone={provisioningTone(e.provisioning.step)}>{m.provisioningStep[e.provisioning.step]}</StatusBadge>
                <span className="ml-auto text-xs text-base-content/50">{formatSeoul(e.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader title={h.title} description={h.description} />
      {/* 숫자 띠(2026-11-19 hr 0.9.0) — 맨 위 */}
      <Counts />
      <section aria-label={h.shortcuts} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="home-shortcuts">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className={`group flex flex-col gap-2 rounded-box border bg-base-100 p-4 transition hover:-translate-y-0.5 hover:shadow-md ${s.primary ? 'border-primary/40' : 'border-base-300'}`}
          >
            <span className="flex items-center gap-2 font-bold">
              <TitleIcon name={s.icon} />
              {s.title}
              <span className="ml-auto text-base-content/30 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">
                →
              </span>
            </span>
            <span className="text-sm text-base-content/60">{s.body}</span>
          </Link>
        ))}
      </section>
      <Recent />
      <section className="rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/60" data-testid="home-flow">
        <p className="mb-2 font-semibold text-base-content/80">{h.flowTitle}</p>
        <ol className="list-decimal space-y-1 pl-5">
          {h.flow.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
