// 처리 기한 지킴(bff 0.13.0 CASE_SLA — 백엔드 PR #164 병합 전, 목으로만). 백엔드 알림 backoffice/2026-11-18-notice-metrics-case-sla
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { problem } from '../../mocks/support';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { slaText } from './CaseSlaPage';

const metrics = `${BFF_BASE}/views/metrics`;
const stamp = { system: 'case-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-18T01:00:00Z', freshness: 'CURRENT' } };

describe('처리 기한 지킴', () => {
  it('metric=CASE_SLA 로 묻고, 기간 합계는 "N건 중 M건" + 비율, 기한 없음은 따로', async () => {
    const view = renderAt('/case-sla?from=2026-11-12&to=2026-11-18', as.admin);
    expect(await screen.findByTestId('case-sla-count')).toHaveTextContent('14건 중 10건'); // 4/5 + 1/2 + 0/0 + 3/3 + 2/4
    expect(screen.getByTestId('case-sla-ratio')).toHaveTextContent('71.4%');
    expect(screen.getByTestId('case-sla-unjudged')).toHaveTextContent('3건');
    const url = new URL(view.sent.find((r) => r.url.includes('/views/metrics'))!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ metric: 'CASE_SLA', from: '2026-11-12', to: '2026-11-18', granularity: 'DAY' });
  });

  it('분모 0 은 "—"(0%·100% 아님) — 묶음 줄·나눠 보기 모두', async () => {
    renderAt('/case-sla?from=2026-11-12&to=2026-11-18', as.admin);
    await screen.findByTestId('case-sla-count');
    const split = screen.getByTestId('case-sla-split');
    const help = within(split).getAllByTestId('case-sla-split-row').find((r) => r.textContent?.includes('라이더 도움요청'))!;
    expect(help).toHaveTextContent('0건 중 0건');
    expect(help).toHaveTextContent('—');
    expect(help).toHaveTextContent('2건');
    expect(help).not.toHaveTextContent('0%');
  });

  it('종류별 → 팀별로 나눠 볼 수 있다', async () => {
    renderAt('/case-sla?from=2026-11-12&to=2026-11-18', as.admin);
    await screen.findByTestId('case-sla-count');
    await userEvent.click(screen.getByRole('radio', { name: '팀별' }));
    const rows = within(screen.getByTestId('case-sla-split')).getAllByTestId('case-sla-split-row');
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual(['지원센터', '고객센터', '관리자 팀']);
    expect(rows[0]).toHaveTextContent('8건 중 7건');
  });

  it('503 은 "원천에 닿지 않았어요"(0건으로 그리지 않는다)', async () => {
    server.use(http.get(metrics, () => problem(503, 'DEPENDENCY_UNAVAILABLE')));
    renderAt('/case-sla', as.admin);
    expect(await screen.findByTestId('case-sla-unreachable')).toHaveTextContent('0건이 아니에요');
    expect(screen.queryByTestId('case-sla-count')).not.toBeInTheDocument();
  });

  it('400 은 서버 detail 그대로', async () => {
    renderAt('/case-sla?from=2026-01-01&to=2026-11-18', as.admin);
    expect(await screen.findByTestId('case-sla-bad-range')).toHaveTextContent('하루 묶음은 93일까지');
  });

  it('지금 기한 지난 건 원천만 실패(currentOverdue null)면 "불러오지 못했어요" — 0건 아님', async () => {
    server.use(
      http.get(metrics, () =>
        HttpResponse.json({ metric: 'CASE_SLA', sources: [stamp], unavailableSources: [], points: [], totals: [], currentOverdue: null }),
      ),
    );
    renderAt('/case-sla', as.admin);
    expect(await screen.findByTestId('case-sla-overdue-unavailable')).toHaveTextContent('0건이 아니에요');
    expect(screen.getByTestId('case-sla-overdue')).toHaveTextContent('—');
    expect(screen.getByTestId('case-sla-ratio')).toHaveTextContent('—');
  });

  it('규칙: 분모 0 이면 비율 "—"', () => {
    expect(slaText({ numerator: 0, denominator: 0 })).toEqual({ count: '0건 중 0건', ratio: '—' });
    expect(slaText({ numerator: 1, denominator: 3 })).toEqual({ count: '3건 중 1건', ratio: '33.3%' });
  });
});
