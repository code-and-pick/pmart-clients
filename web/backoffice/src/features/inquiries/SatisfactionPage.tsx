// 문의 만족도 모아 보기(case 0.15.0 — 백엔드 요청 all/2026-11-17-request-inquiry-satisfaction, 관리자만).
// `GET /inquiries/satisfaction-summary?answeredFrom=&answeredTo=`(답변 시각 기준, 92일까지).
// 사용자 결정 2026-11-17: 상담 평가일 뿐 — 상담원별 순위·이름은 보여 주지 않는다(서버도 주지 않음).
// 비율은 분자·분모를 같이("답변 N건 중 M건 응답"), 분모 0 은 비율 대신 "—". 평균이 없으면(남긴 건 0) "—" — 숫자를 지어내지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { PageHeader } from '../../shared/admin';

const m = messages.satisfaction;
const MAX_DAYS = 92;
const DAY = 86_400_000;
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** 서울 날짜 YYYY-MM-DD */
const seoulDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
/** 시작~끝 날짜(둘 다 포함) 일수 */
const daysOf = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

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
    <section className="max-w-3xl space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <form
        className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm"
        aria-label={m.period}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draftProblem) setParams({ from: draft.from, to: draft.to });
        }}
      >
        <label className="flex flex-col gap-1">
          {m.from}
          <input type="date" className="input input-sm w-40" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1">
          {m.to}
          <input type="date" className="input input-sm w-40" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={draftProblem !== null}>
          {m.show}
        </button>
        <span className="text-xs text-base-content/60">{m.periodHint}</span>
        {draftProblem && <span className="text-xs text-error">{draftProblem}</span>}
      </form>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => {
          const rated = s.ratedCount;
          const answered = s.answeredCount;
          return (
            <div className="space-y-3">
              <dl className="grid grid-cols-[10rem_1fr] gap-1 rounded-box border border-base-300 bg-base-100 p-4 text-sm" data-testid="satisfaction-summary">
                <dt>{m.periodLine}</dt>
                <dd>{`${from} ~ ${to}`}</dd>
                <dt>{m.response}</dt>
                <dd data-testid="satisfaction-response">{answered === 0 ? m.noAnswered : m.responseLine(answered, rated)}</dd>
                <dt>{m.average}</dt>
                <dd data-testid="satisfaction-average">{s.averageScore === null || s.averageScore === undefined ? m.none : m.averageLine(s.averageScore)}</dd>
              </dl>
              <ul className="space-y-1 rounded-box border border-base-300 bg-base-100 p-4 text-sm" aria-label={m.byScore}>
                {(['5', '4', '3', '2', '1'] as const).map((k) => {
                  const n = s.byScore[k] ?? 0;
                  return (
                    <li key={k} className="flex items-center gap-2" data-testid="satisfaction-score">
                      <span className="w-10">{m.scoreLabel(k)}</span>
                      <progress className="progress w-56" value={n} max={rated || 1} aria-label={m.scoreLabel(k)} />
                      <span>{m.count(n)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-base-content/60">{m.notForAgents}</p>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
