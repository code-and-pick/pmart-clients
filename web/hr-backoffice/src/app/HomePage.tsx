// 첫 화면(2026-11-19 사용자 "인사팀 쪽이 백오피스보다 심심하다").
// 숫자(상태별 인원·발급 실패 수)는 계약에 세는 조회가 없어 넣지 않는다 — 요청 문서 docs/handoff/hr-backoffice/2026-11-19-backend-hr-dashboard.md(H-D2).
// "최근 등록" 도 직원 목록 정렬이 계약에 없어 만들지 않는다. 바로 가기와 상태 필터 목록 연결만.
import { Link } from 'react-router';
import { EMPLOYMENT_STATUSES } from '../api/models';
import { statusTone } from '../features/employees/labels';
import { PageHeader, StatusBadge } from '../shared/admin';
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

export function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader title={h.title} description={h.description} />
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
      <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" data-testid="home-status">
        <h2 className="flex items-center gap-2 font-bold">
          <TitleIcon name="list" />
          {h.byStatus}
        </h2>
        <p className="text-sm text-base-content/60">{h.byStatusBody}</p>
        <ul className="flex flex-wrap gap-2">
          {EMPLOYMENT_STATUSES.map((st) => (
            <li key={st}>
              <Link to={`/employees?status=${st}`} className="btn btn-sm gap-2">
                <StatusBadge tone={statusTone(st)}>{m.employmentStatus[st]}</StatusBadge>
                {h.seeList}
              </Link>
            </li>
          ))}
        </ul>
      </section>
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
