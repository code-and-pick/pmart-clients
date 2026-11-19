// 대시보드 2판(2026-11-18): 한눈에 숫자 카드(어제 대비·추세선)·오늘 주문 상태 도넛·최근 활동 — 서버 값만, 못 읽으면 숨기지 않고 알린다
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE, BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';
import { resetMockOps } from '../mocks/opsHandlers';

afterEach(() => vi.useRealTimers());

const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

describe('대시보드 2판', () => {
  it('관리자: 한눈에 카드 넷(오늘 주문·진행 중 배송·처리 기한 지킴·처리 대기), 오늘 주문은 어제 대비와 7일 추세선', async () => {
    renderAt('/', as.admin);
    const glance = await screen.findByTestId('dash-glance');
    for (const id of ['dash-kpi-orders', 'dash-stat-live', 'dash-stat-sla', 'dash-stat-risk']) expect(within(glance).getByTestId(id)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-orders')).findByText(/어제(보다|와)/)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-orders')).findByTestId('dash-sparkline')).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-stat-risk')).findByText(/결제 결과 불명 1건/)).toBeInTheDocument();
  });

  it('탭(사용자 2026-11-18 "스크롤을 내려야 할 만큼 많다"): 첫 화면 = 숫자 카드 → 내 할 일, 7일 막대는 매출·통계 탭 — 고른 탭은 주소에', async () => {
    const user = userEvent.setup();
    renderAt('/', as.admin);
    const work = await screen.findByTestId('dash-my-work');
    expect(screen.getByTestId('dash-glance').compareDocumentPosition(work) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // 2026-11-19: 숫자 띠(내 할 일)가 맨 위
    expect(screen.queryByTestId('dash-orders-week')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '한눈에' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: '매출·통계' }));
    expect(await screen.findByTestId('dash-orders-week')).toBeInTheDocument();
    expect(screen.getByTestId('dash-my-work')).toBeInTheDocument(); // 2026-11-19: 숫자 띠는 탭과 상관없이 늘 위
    expect(screen.getByTestId('dash-side')).toBeInTheDocument(); // 최근 활동은 오른쪽 패널에 늘
  });

  it('볼 것이 없는 탭은 숨긴다 — 승인자에게 매출·통계 탭 없음, 없는 탭 주소는 한눈에', async () => {
    renderAt('/?tab=sales', as.approver);
    expect(await screen.findByRole('tab', { name: '한눈에' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: '매출·통계' })).not.toBeInTheDocument();
  });

  it('오늘 주문 상태 — 상태별 이름과 개수, 합은 오늘 주문 수', async () => {
    // 목 주문은 "지금부터 N시간 전" — 자정 직후엔 오늘 주문이 없어 깨졌다(2026-11-19 00:02). 서울 정오로 시계를 고정하고 목을 다시 만든다(Date 만, 기다림 타이머는 진짜)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-18T03:00:00Z') });
    resetMockOps();
    renderAt('/?tab=sales', as.admin);
    const legend = await screen.findByTestId('dash-status-legend');
    const counts = within(legend).getAllByRole('listitem').map((li) => Number(li.lastElementChild?.textContent));
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(within(screen.getByTestId('dash-status-donut')).getByText(String(total))).toBeInTheDocument();
  });

  it('최근 활동 — 승인·접수 건·문의를 시각순으로, 누르면 그 상세', async () => {
    renderAt('/', as.admin);
    // 세 원천이 따로 도착한다. 최근 8건만 — 목 데이터에선 접수 건(2시간 전)·문의(3·4일 전)가 승인(5·19일 전)보다 최근이라 승인은 밀린다
    await waitFor(() => {
      const metas = screen.getAllByTestId('dash-activity-item').map((i) => i.textContent ?? '');
      expect(metas).toHaveLength(8);
      expect(metas.some((t) => t.includes('접수 건'))).toBe(true);
      expect(metas.some((t) => t.includes('고객 문의'))).toBe(true);
      expect(metas.findIndex((t) => t.includes('고객 문의'))).toBeGreaterThan(metas.findLastIndex((t) => t.includes('접수 건'))); // 시각순(최근 먼저)
    });
    expect(screen.getAllByTestId('dash-activity-item')[0]!.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^\/cases\//));
  });

  it('최근 활동에서 한 원천을 못 읽으면 남은 것은 보이고 빠졌다고 알린다', async () => {
    server.use(http.get(`${API_BASE}/approvals`, () => forbidden()));
    renderAt('/', as.admin);
    expect(await screen.findByTestId('dash-activity-failed')).toHaveTextContent('승인');
    expect((await screen.findAllByTestId('dash-activity-item')).length).toBeGreaterThan(0);
  });

  it('승인자: 한눈에·도넛 없이(보이는 메뉴만), 최근 활동은 승인만', async () => {
    renderAt('/', as.approver);
    const items = await screen.findAllByTestId('dash-activity-item');
    expect(items.every((i) => (i.textContent ?? '').includes('승인 요청'))).toBe(true);
    expect(screen.queryByTestId('dash-glance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-status-donut')).not.toBeInTheDocument();
  });
});

describe('대시보드 지표(백엔드 회신 2026-11-18)', () => {
  it('결품률·정시 배송률은 서버가 501 이면 "준비 중", 품절은 자리만(매출·상품별 판매는 D2·D3 배포로 진짜 칸)', async () => {
    // 정시 배송률은 bff 0.21.0 부터 목이 숫자를 준다 — 배포 전 LAN 처럼 501 로 바꿔 본다
    server.use(http.get(`${BFF_BASE}/views/metrics`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 501, code: 'NOT_IMPLEMENTED' }, { status: 501, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/?tab=sales', as.admin);
    for (const id of ['SHORTAGE_RATE', 'ON_TIME_DELIVERY']) expect(await within(await screen.findByTestId(`dash-metric-${id}`)).findByText('준비 중')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-metric-soldOut')).getByText('준비 중')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-metric-sales')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-metric-top')).not.toBeInTheDocument();
  });

  it('정시 배송률(bff 0.21.0): 분자·분모 합으로 비율, 약속 전·판단 밖은 분모 밖이라 옆에 따로', async () => {
    renderAt('/?tab=sales', as.admin);
    const cell = await screen.findByTestId('dash-metric-ON_TIME_DELIVERY');
    // 목: 18/20 + 22/24 + 19/19 = 59/63, 약속 전 3, 판단 밖 3
    await waitFor(() => expect(cell).toHaveTextContent('63건 중 59건'));
    expect(within(cell).getByTestId('dash-ontime-outside')).toHaveTextContent('약속 전 3 · 판단 밖 3 (분모 밖)');
  });

  it('지표가 구현되면(200) 숫자와 "N건 중 M건"', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/metrics`, ({ request }) =>
        new URL(request.url).searchParams.get('metric') === 'SHORTAGE_RATE'
          ? HttpResponse.json({ metric: 'SHORTAGE_RATE', timeZone: 'Asia/Seoul', sources: [], unavailableSources: [], points: [], totals: [{ bucket: '2026-11-18', numerator: 3, denominator: 4, ratio: 0.75, unjudged: 0 }], currentOverdue: null })
          : HttpResponse.json({ type: 'about:blank', title: 'x', status: 501, code: 'NOT_IMPLEMENTED' }, { status: 501, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/?tab=sales', as.admin);
    const cell = await screen.findByTestId('dash-metric-SHORTAGE_RATE');
    expect(await within(cell).findByText('75%')).toBeInTheDocument();
  });

  it('처리 기한 지킴 — 종류별로 나눠 보이고, 503 이면 "원천에 닿지 않았어요"', async () => {
    renderAt('/?tab=ops', as.admin);
    expect(await screen.findByTestId('dash-sla-kinds')).toBeInTheDocument();
  });

  it('처리 기한 지킴 503 은 0건이 아니라 원천에 닿지 않음', async () => {
    server.use(http.get(`${BFF_BASE}/views/metrics`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/?tab=ops', as.admin);
    expect(await screen.findByTestId('dash-sla-failed', {}, { timeout: 8000 })).toHaveTextContent('접수 건 정보를 가져오지 못했어요');
  }, 15000);
});

describe('처리 기한 지킴 — 지난 7일 대비(2026-11-18 "숫자만 보고 좋은지 나쁜지")', () => {
  const sla = (n: number, d: number) => HttpResponse.json({ metric: 'CASE_SLA', totals: [{ numerator: n, denominator: d }], series: [] });
  it('이번 7일 80% · 앞 7일 50% → "지난 7일보다 30%p ▲"', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    server.use(http.get(`${BFF_BASE}/views/metrics`, ({ request }) => (new URL(request.url).searchParams.get('to') === today ? sla(8, 10) : sla(5, 10))));
    renderAt('/', as.admin);
    expect(await within(await screen.findByTestId('dash-stat-sla')).findByTestId('dash-sla-vs-prev')).toHaveTextContent('지난 7일보다 30%p ▲');
  });

  it('앞 7일을 못 읽으면 비교를 보이지 않는다(0 과 비교하지 않는다)', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    server.use(http.get(`${BFF_BASE}/views/metrics`, ({ request }) => (new URL(request.url).searchParams.get('to') === today ? sla(8, 10) : forbidden())));
    renderAt('/', as.admin);
    const card = await screen.findByTestId('dash-stat-sla');
    await within(card).findByText('80%');
    expect(within(card).queryByTestId('dash-sla-vs-prev')).not.toBeInTheDocument();
  });
});
