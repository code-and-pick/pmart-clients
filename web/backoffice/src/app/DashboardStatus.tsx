// 대시보드 "이상 없음 / 이상 N" 한 줄(2026-11-19 사용자가 보여 준 배송 관제 화면 참고 — "지금 문제가 있나?"에 바로 답한다).
// 판정은 서버 숫자만: 기한 지난 접수 건 > 0, 약속 시각을 넘긴 배송 > 0. 숫자를 못 읽었으면 "이상 없음"이라 하지 않고 "확인 못 함"으로.
// 조회는 메뉴 알림·숫자 띠·지금 배송 카드와 같은 쿼리 키라 새로 부르지 않는다.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { useApi } from './ApiContext';
import { liveQuery } from './DashboardSections';
import { useAlertCount, type AlertKey } from './MenuAlerts';
import { messages } from '../shared/messages';

const m = messages.dashboard.health;

interface Issue {
  readonly text: string;
  readonly to: string;
}

function useOverdueCases(enabled: boolean): { issue: Issue | null; failed: boolean; loading: boolean } {
  const q = useAlertCount('casesOverdue' satisfies AlertKey);
  if (!enabled) return { issue: null, failed: false, loading: false };
  if (q.data) return { issue: q.data.n > 0 ? { text: m.overdueCases(q.data.more ? `${q.data.n}+` : String(q.data.n)), to: '/cases?tab=overdue' } : null, failed: false, loading: false };
  return { issue: null, failed: q.isError, loading: !q.isError };
}

function useLateDeliveries(enabled: boolean): { issue: Issue | null; failed: boolean; loading: boolean } {
  const api = useApi();
  const q = useQuery({ ...liveQuery(api), enabled });
  if (!enabled) return { issue: null, failed: false, loading: false };
  if (!q.data) return { issue: null, failed: q.isError, loading: !q.isError };
  const now = q.data.composedAt ? Date.parse(q.data.composedAt) : Number.NaN;
  const late = (q.data.items ?? []).filter((i) => !!i.promisedAt && Date.parse(i.promisedAt) < now).length;
  return { issue: late > 0 ? { text: m.lateDeliveries(late), to: '/live-delivery?focus=late' } : null, failed: false, loading: false };
}

export function DashboardStatus({ cases, live }: { readonly cases: boolean; readonly live: boolean }) {
  const parts = [useOverdueCases(cases), useLateDeliveries(live)];
  if (!cases && !live) return null;
  const issues = parts.flatMap((p) => (p.issue ? [p.issue] : []));
  const failed = parts.filter((p) => p.failed).length;
  const loading = parts.some((p) => p.loading);

  const tone = issues.length > 0 ? 'error' : failed > 0 ? 'warning' : loading ? 'neutral' : 'success';
  const box = { error: 'border-error/30 bg-error/10', warning: 'border-warning/40 bg-warning/10', neutral: 'border-base-300 bg-base-100', success: 'border-success/30 bg-success/10' }[tone];
  const dot = { error: 'bg-error', warning: 'bg-warning', neutral: 'bg-base-content/30', success: 'bg-success' }[tone];
  const title = issues.length > 0 ? m.issues(issues.length) : failed > 0 ? m.unknown : loading ? m.checking : m.ok;
  // 2026-11-20 사용자 "이상도 너무 작게 뜨고, 눌러도 들어가지지 않아 — 누르는 범위를 넓게": 큰 글씨 + 이상마다 큰 버튼(칸 전체가 링크)
  return (
    <div className={`rounded-box border px-4 py-3 ${box}`} aria-live="polite" data-testid="dash-status" data-tone={tone}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3" aria-hidden="true">
            {tone === 'error' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${dot}`} />
          </span>
          <span className={`text-lg font-extrabold ${tone === 'error' ? 'text-error' : ''}`}>{title}</span>
        </span>
        {issues.map((i) => (
          <Link
            key={i.to}
            to={i.to}
            className="flex min-w-56 flex-1 items-center justify-between gap-3 rounded-lg border border-error/30 bg-base-100 px-4 py-3 text-base font-semibold text-error shadow-sm transition hover:border-error hover:bg-error/5 sm:flex-none"
          >
            <span>{i.text}</span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
        {failed > 0 && <span className="text-sm text-base-content/60">{m.failed(failed)}</span>}
      </div>
    </div>
  );
}
