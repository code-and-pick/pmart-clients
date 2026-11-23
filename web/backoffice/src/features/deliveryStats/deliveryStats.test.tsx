// 배송 운영 통계(execution 0.38.0·dispatch 0.16.0)·라이더 상세 최근 30일 성과 — 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const gets = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith(tail)).map((r) => new URL(r.url).searchParams);
const fail503 = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } });

describe('배송 운영 통계', () => {
  it('상담원도 메뉴에 있고 모든 센터 7일 — 품질·효율·배차·센터별·라이더별·사고, 정시 배송률은 "센터를 고르면"', async () => {
    const view = renderAt('/delivery-stats', as.cs);
    expect(await screen.findByTestId('tile-completion')).toBeInTheDocument();
    const q = gets(view.sent, '/delivery-metrics').at(-1)!;
    expect(q.get('mfcId')).toBeNull();
    expect(gets(view.sent, '/metrics/on-time-deliveries')).toHaveLength(0); // 관리자가 아니면 센터 없이 부르지 않는다
    expect(screen.getByTestId('tile-on-time')).toHaveTextContent('센터를 고르면');
    expect(await screen.findByTestId('stats-source')).toHaveTextContent('직원 수동 배차는 없어요');
    expect(screen.getAllByTestId('stats-day-row')).toHaveLength(7);
    expect(screen.getAllByTestId('stats-mfc-row')).toHaveLength(2);
    expect(screen.getAllByTestId('stats-rider-row').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('stats-incidents')).getByText('고객 연락 안 됨')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '배송 운영 통계' })).toBeInTheDocument();
  });

  it('머리줄 센터를 고르면 그 센터(mfcId)로 묻고 정시 배송률도, 기간 30일', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('pmart.backoffice.centerScope', 'MFC-BSN-01');
    const view = renderAt('/delivery-stats', as.riderOps);
    await waitFor(() => expect(gets(view.sent, '/delivery-metrics').at(-1)?.get('mfcId')).toBe('MFC-BSN-01'));
    await waitFor(() => expect(screen.getByTestId('tile-on-time')).toHaveTextContent('%'));
    expect(screen.getAllByTestId('stats-mfc-row')).toHaveLength(1);
    expect(screen.queryByTestId('center-scope-note')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '최근 30일' }));
    await waitFor(() => expect(screen.getAllByTestId('stats-day-row')).toHaveLength(30));
  });

  it('배송 통계를 못 읽으면 숫자 대신 오류(0 아님), 배차 통계만 못 읽으면 그 칸 "?"·안내', async () => {
    server.use(http.get(`${API_BASE}/metrics/dispatch`, fail503));
    const v1 = renderAt('/delivery-stats', as.admin);
    expect(await screen.findByTestId('stats-dispatch-failed')).toBeInTheDocument();
    expect(screen.getByTestId('tile-assign')).toHaveTextContent('?');
    expect(screen.getAllByTestId('stats-day-row')[0]).toHaveTextContent('?');
    v1.unmount();
    server.use(http.get(`${API_BASE}/delivery-metrics`, fail503));
    renderAt('/delivery-stats', as.admin);
    await waitFor(() => expect(screen.queryByTestId('tile-completion')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /다시/ })).toBeInTheDocument();
  });
});

describe('라이더 상세 — 최근 30일 성과', () => {
  it('riderId 로 30일을 묻고 배송·완료율·지연율·평균 시간·도움요청', async () => {
    const view = renderAt('/riders/RID-MOCK-1', as.cs);
    const perf = await screen.findByTestId('rider-performance');
    expect(await within(perf).findByTestId('rider-perf-completion')).toHaveTextContent('%');
    const q = gets(view.sent, '/delivery-metrics').at(-1)!;
    expect(q.get('riderId')).toBe('RID-MOCK-1');
    const days = (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000 + 1;
    expect(days).toBe(30);
    expect(within(perf).getByTestId('rider-perf-incidents')).toHaveTextContent('건');
  });
});
