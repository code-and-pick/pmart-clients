// FAQ 답 의견 집계(2026-11-23 — customer-assistant 0.4.0 BR-91, 백엔드 알림 backoffice/2026-11-23-notice-faq-feedback-stats, 사용자 "화면 만들 거 있으면 진행해").
// - `GET /customer-assistant/faq-feedback` — FAQ 마다 "도움이 됐어요/안 됐어요" 수와 마지막 의견 시각. 서버가 고칠 필요가 큰 순으로 준다(그 순서 그대로).
//   고객마다 마지막 값만 센다. 의견 글은 없다. 질문이 바뀌어 지금 색인에 없는 FAQ 는 category·question 이 null("지금 FAQ 에 없음").
// - 도움 비율 = helpful / (helpful + notHelpful) — 표시만, 분모 0 이면 "—"(BO-28). 역할: CS_AGENT·OPERATOR_ADMIN(메뉴도 그 둘에게만).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { DataTable, ListHeader, Notice, refreshOf } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { label, when } from '../../shared/ops';

const m = messages.faqFeedback;

export const helpfulRate = (helpful: number, notHelpful: number) => {
  const den = helpful + notHelpful;
  return den > 0 ? `${Math.round((helpful / den) * 1000) / 10}%` : '—';
};

export function FaqFeedbackPage() {
  const api = useApi();
  const query = useQuery({
    queryKey: ['customer-assistant', 'faq-feedback'],
    queryFn: () => request('GET', api.customerAssistant.GET('/customer-assistant/faq-feedback', {})),
  });
  return (
    <section className="space-y-4" data-testid="faq-feedback">
      <ListHeader title={m.title} count={query.data ? String(query.data.items.length) : undefined} refresh={refreshOf(query)} />
      <Notice>{m.intro}</Notice>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(d) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.col.question}</th>
                <th>{m.col.category}</th>
                <th className="text-right">{m.col.helpful}</th>
                <th className="text-right">{m.col.notHelpful}</th>
                <th className="text-right">{m.col.rate}</th>
                <th>{m.col.lastAt}</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((x) => (
                <tr key={x.faqId} data-testid="faq-feedback-row">
                  <td className="max-w-[28rem]">
                    {x.question ? <span className="line-clamp-2">{x.question}</span> : <span className="text-base-content/50" title={x.faqId}>{m.gone}</span>}
                  </td>
                  <td>{x.category ? label(m.categoryName, x.category) : messages.none}</td>
                  <td className="text-right tabular-nums">{x.helpfulCount}</td>
                  <td className={`text-right tabular-nums ${x.notHelpfulCount > x.helpfulCount ? 'font-semibold text-error' : ''}`}>{x.notHelpfulCount}</td>
                  <td className="text-right tabular-nums" data-testid="faq-feedback-rate">
                    {helpfulRate(x.helpfulCount, x.notHelpfulCount)}
                  </td>
                  <td className="whitespace-nowrap">{when(x.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </QueryState>
    </section>
  );
}
