// 실시간 배송 현황 — bff 0.3.0 views/live-delivery 목(백엔드 PR #25).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const liveCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/views/live-delivery')).map((r) => new URL(r.url).searchParams);

describe('실시간 배송 현황', () => {
  it('고객센터·라이더 운영 묶음 모두에 메뉴가 있다', async () => {
    renderAt('/live-delivery', as.riderOps);
    expect(await screen.findByRole('link', { name: '실시간 배송 현황' })).toHaveAttribute('href', '/live-delivery');
  });

  it('진행 중 배송을 원천별 열로 — 배송·주문·사건 상세로 가고, 약속 지남·기한 넘김을 표시', async () => {
    const view = renderAt('/live-delivery', as.cs);
    const rows = await screen.findAllByTestId('live-row');
    // 끝난 배송(DLV-LIVE-4)은 없다 — 진행 중 8건(모든 센터)
    expect(rows).toHaveLength(8);
    expect(screen.queryByText('DLV-LIVE-4')).not.toBeInTheDocument();
    const first = rows[0]!;
    expect(within(first).getByRole('link', { name: 'DLV-LIVE-1' })).toHaveAttribute('href', '/deliveries/DLV-LIVE-1');
    expect(within(first).getByRole('link', { name: 'ORD-LIVE-1' })).toHaveAttribute('href', '/orders/ORD-LIVE-1');
    expect(within(first).getByText('약속 지남')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: '라이더 도움요청 P1' })).toHaveAttribute('href', '/cases/CASE-MOCK-1');
    expect(within(first).getByText('기한 넘김')).toBeInTheDocument();
    // 상태 없이 부르면 cursor 를 보내지 않는다
    const sent = liveCalls(view.sent)[0]!;
    expect([sent.get('state'), sent.get('cursor'), sent.get('size')]).toEqual([null, null, '50']);
  });

  it('센터를 고르면 그 센터만 — 주소에 남는다', async () => {
    const view = renderAt('/live-delivery', as.admin);
    await screen.findAllByTestId('live-row');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '센터' }), 'MFC-SEL-01');
    await waitFor(() => expect(screen.getAllByTestId('live-row')).toHaveLength(1));
    expect(liveCalls(view.sent).at(-1)!.get('mfcId')).toBe('MFC-SEL-01');
  });

  it('상태를 고르면 쪽 넘김 — 다음 쪽은 서버 nextCursor 로', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        const second = q.get('cursor') === 'C1';
        return HttpResponse.json({
          sources: [],
          unavailableSources: [],
          composedAt: '2026-11-16T01:00:00.000Z',
          truncated: false,
          page: { nextCursor: second ? null : 'C1' },
          items: [{ deliveryId: second ? 'DLV-P2' : 'DLV-P1', orderId: 'ORD-P', delivery: { state: 'UNASSIGNED' }, dispatch: { state: 'DISPATCHING' }, openCases: [] }],
        });
      }),
    );
    const view = renderAt('/live-delivery?state=UNASSIGNED', as.riderOps);
    expect(await screen.findByText('DLV-P1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
    expect(await screen.findByText('DLV-P2')).toBeInTheDocument();
    const last = liveCalls(view.sent).at(-1)!;
    expect([last.get('state'), last.get('cursor')]).toEqual(['UNASSIGNED', 'C1']);
    expect(screen.queryByRole('button', { name: '다음 쪽' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '처음 쪽' })).toBeInTheDocument();
  });

  it('상태 없이 50건을 넘으면 "좁혀 주세요"', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, () =>
        HttpResponse.json({ sources: [], unavailableSources: [], composedAt: '2026-11-16T01:00:00.000Z', truncated: true, page: { nextCursor: null }, items: [{ deliveryId: 'DLV-T', delivery: { state: 'ASSIGNED' }, dispatch: { state: 'ASSIGNED' }, openCases: [] }] }),
      ),
    );
    renderAt('/live-delivery', as.cs);
    expect(await screen.findByText('더 있어요 — 센터나 상태로 좁혀 주세요.')).toBeInTheDocument();
  });

  it('배차·사건 원천 실패는 "모름"·"조회 실패" — 0건이나 정상으로 보이지 않는다', async () => {
    renderAt('/live-delivery?mfcId=MFC-MOCK-DOWN', as.admin);
    const rows = await screen.findAllByTestId('live-row');
    expect(within(rows[0]!).getByTestId('dispatch-state')).toHaveTextContent('모름(조회 실패)');
    expect(within(rows[0]!).getByTestId('open-cases')).toHaveTextContent('조회 실패');
    expect(within(screen.getByRole('region', { name: '원천' })).getByText(/조회하지 못한 원천: .*delivery-dispatch-service/)).toBeInTheDocument();
  });

  it('열린 접수 건을 1,000건까지만 읽었으면(casesTruncated, bff 0.9.2) null 칸은 "조회 실패"가 아니라 "확인 불가" + 안내', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, () =>
        HttpResponse.json({
          sources: [{ system: 'delivery-execution-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-17T00:00:00Z', freshness: 'CURRENT' } }],
          unavailableSources: [],
          composedAt: '2026-11-17T00:00:00Z',
          casesTruncated: true,
          page: { nextCursor: null },
          items: [{ deliveryId: 'DLV-T-1', orderId: 'ORD-T-1', mfcId: 'MFC-BSN-01', type: 'FORWARD', riderId: 'RD-1', delivery: { state: 'ASSIGNED' }, dispatch: { state: 'ASSIGNED' }, promisedAt: null, openCases: null }],
        }),
      ),
    );
    renderAt('/live-delivery', as.cs);
    const row = (await screen.findAllByTestId('live-row'))[0]!;
    expect(within(row).getByTestId('open-cases')).toHaveTextContent('확인 불가');
    expect(document.querySelector('[data-state="cases-truncated"]')).not.toBeNull();
  });

  it('조회 실패(5xx)는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${BFF_BASE}/views/live-delivery`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/live-delivery', as.cs);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('진행 중인 배송이 없어요.')).not.toBeInTheDocument();
  });

  it('역할이 없으면 서버 403 — 권한 없음 화면', async () => {
    renderAt('/live-delivery', as.md);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });

  it('도착 예정(bff 0.7.0): 값이면 "도착 예정 시각"·"N분 늦음", 위치 확인·계산 전은 "확인 중", tracking 에 없으면 "—"', async () => {
    renderAt('/live-delivery', as.cs);
    const rows = await screen.findAllByTestId('live-row');
    const eta = (id: string) => within(rows.find((r) => r.textContent?.includes(id))!).getByTestId('live-eta');
    expect(eta('DLV-LIVE-1')).toHaveTextContent(/도착 예정 .*10:12/);
    expect(eta('DLV-LIVE-1')).toHaveTextContent('12분 늦음');
    expect(eta('DLV-LIVE-2')).toHaveTextContent('도착 예정 확인 중');
    expect(eta('DLV-LIVE-3')).toHaveTextContent('도착 예정 확인 중');
    // tracking 에 없는 배송(목 DLV-LIVE-5~9 미배정)은 '—'
    expect(rows.filter((r) => within(r).getByTestId('live-eta').textContent === '도착 예정 —').length).toBeGreaterThan(0);
  });

  it('tracking 장애면 도착 예정 "확인 불가" — 숫자를 만들지 않는다', async () => {
    renderAt('/live-delivery?mfcId=MFC-MOCK-DOWN', as.admin);
    const rows = await screen.findAllByTestId('live-row');
    expect(within(rows[0]!).getByTestId('live-eta')).toHaveTextContent('도착 예정 확인 불가');
    expect(within(rows[0]!).getByTestId('live-eta')).not.toHaveTextContent('늦음');
  });
});
