// 문의 만족도 모아 보기(case 0.15.0 — 백엔드 요청 all/2026-11-17-request-inquiry-satisfaction, 관리자만).
// `GET /inquiries/satisfaction-summary?answeredFrom=&answeredTo=`(답변 시각 기준, 92일까지).
// 사용자 결정 2026-11-17: 상담 평가일 뿐 — 상담원별 순위·이름은 보여 주지 않는다(서버도 주지 않음).
// 비율은 분자·분모를 같이("답변 N건 중 M건 응답"), 분모 0 은 비율 대신 "—". 평균이 없으면(남긴 건 0) "—" — 숫자를 지어내지 않는다.
// 화면(2026-11-18 사용자 "밋밋하다"): 위 기간 줄 → 숫자 카드 3개(기간·응답·평균 점수) → 점수별 막대(서버 byScore 그대로, 막대 길이는 보기용). 동작은 그대로.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { PageHeader } from '../../shared/admin';
import { Icon, ICON } from './HelpdeskParts';

const m = messages.satisfaction;
const MAX_DAYS = 92;
const DAY = 86_400_000;
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** 서울 날짜 YYYY-MM-DD */
const seoulDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
/** 시작~끝 날짜(둘 다 포함) 일수 */
const daysOf = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

function Stat({ icon, label, children, sub }: { readonly icon: string; readonly label: string; readonly children: ReactNode; readonly sub?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-4 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon d={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-base-content/55">{label}</p>
        {children}
        {sub && <p className="text-xs text-base-content/50">{sub}</p>}
      </div>
    </div>
  );
}

/** 점수 색(보기만) — 높을수록 초록 */
const SCORE_BAR: Readonly<Record<string, string>> = { '5': 'bg-success', '4': 'bg-success/70', '3': 'bg-warning', '2': 'bg-error/70', '1': 'bg-error' };

export function SatisfactionPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  // 기본 기간(최근 7일)은 화면을 연 때 기준 — 다시 그릴 때마다 바뀌지 않게 한 번만 잡는다
  const [now] = useState(() => Date.now());
  const today = seoulDate(now);
  const from = isDate(params.get('from')) ? params.get('from')! : seoulDate(now - 6 * DAY);
  const to = isDate(params.get('to')) ? params.get('to')! : today;
  const [draft, setDraft] = useState({ from, to });
  const days = daysOf(draft.from, draft.to);
  const draftProblem = !isDate(draft.from) || !isDate(draft.to) ? m.pickBoth : days < 1 ? m.fromAfterTo : days > MAX_DAYS ? m.tooLong(MAX_DAYS) : null;

  const query = useQuery({
    queryKey: ['inquiries', 'satisfaction', from, to],
    queryFn: () =>
      request(
        'GET',
        api.cases.GET('/inquiries/satisfaction-summary', {
          params: { query: { answeredFrom: `${from}T00:00:00+09:00`, answeredTo: `${to}T23:59:59+09:00` } },
        }),
      ),
  });

  return (
    <section className="max-w-5xl space-y-4">
      <PageHeader title={m.title} />
      {/* 기간 줄 — 목록 화면 필터 줄과 같은 모양(항목명 위 작게, 버튼 오른쪽) */}
      <form
        className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-3.5 text-sm shadow-sm"
        aria-label={m.period}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draftProblem) setParams({ from: draft.from, to: draft.to });
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-base-content/55">
          {m.from}
          <input type="date" className="input input-sm w-40 text-sm text-base-content" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        </label>
        <span className="pb-1.5 text-base-content/40" aria-hidden="true">
          ~
        </span>
        <label className="flex flex-col gap-1 text-xs font-medium text-base-content/55">
          {m.to}
          <input type="date" className="input input-sm w-40 text-sm text-base-content" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </label>
        <div className="flex min-w-0 flex-col gap-0.5 pb-1">
          {draftProblem && <span className="text-xs text-error">{draftProblem}</span>}
        </div>
        <button type="submit" className="btn btn-sm btn-primary ml-auto min-w-20" disabled={draftProblem !== null}>
          {m.show}
        </button>
      </form>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => {
          const rated = s.ratedCount;
          const answered = s.answeredCount;
          const avg = s.averageScore;
          return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3" data-testid="satisfaction-summary">
                <Stat icon={ICON.clock} label={m.periodLine}>
                  <p className="text-lg font-bold tabular-nums">{`${from} ~ ${to}`}</p>
                </Stat>
                <Stat icon={ICON.chat} label={m.response}>
                  <p className="font-semibold" data-testid="satisfaction-response">
                    {answered === 0 ? m.noAnswered : m.responseLine(answered, rated)}
                  </p>
                </Stat>
                <Stat icon={ICON.star} label={m.average} sub={avg === null || avg === undefined ? undefined : m.outOf}>
                  <p className="text-2xl font-bold tabular-nums" data-testid="satisfaction-average">
                    {avg === null || avg === undefined ? m.none : m.averageLine(avg)}
                  </p>
                </Stat>
              </div>
              <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                  <h2 className="text-sm font-semibold">{m.byScore}</h2>
                </div>
                <ul className="space-y-3 px-4 py-4 text-sm" aria-label={m.byScore}>
                  {(['5', '4', '3', '2', '1'] as const).map((k) => {
                    const n = s.byScore[k] ?? 0;
                    // 막대 길이는 보기용(응답 건 중 몫). 응답 0건이면 빈 막대
                    const pct = rated > 0 ? Math.min(100, (n / rated) * 100) : 0;
                    return (
                      <li key={k} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-3" data-testid="satisfaction-score">
                        <span className="font-medium">{m.scoreLabel(k)}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-base-200" role="img" aria-label={m.scoreLabel(k)}>
                          <span className={`block h-full rounded-full ${SCORE_BAR[k] ?? 'bg-primary'}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-right tabular-nums text-base-content/70">{m.count(n)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
