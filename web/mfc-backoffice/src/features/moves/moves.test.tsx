// 이동·보충 화면 — mfc-inbound-service 0.9.0 move-orders 목(+ 고르기 도움: inventory stock, location putaway-candidates).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('move-row');
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const problem = (status: number, code: string) =>
  HttpResponse.json({ type: 'about:blank', status, code }, { status, headers: { 'content-type': 'application/problem+json' } });

describe('이동 목록', () => {
  it('기본은 진행 중(서버 기본 — state 를 보내지 않는다), 최근 순, 이 센터만', async () => {
    const view = renderAt('/c/MFC-BSN-01/moves');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['자동 보충', '재배치긴급', '재배치']);
    expect(within(rows()[2]!).getByText('카트 정리 대기')).toBeInTheDocument();
    const q = new URL(view.gets('/move-orders')[0]!.url).searchParams;
    expect([q.get('mfcId'), q.get('state')]).toEqual(['MFC-BSN-01', null]);
  });

  it('상태 거르기(끝남)는 URL 쿼리 → 서버로', async () => {
    const view = renderAt('/c/MFC-BSN-01/moves');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'COMPLETED');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(new URL(view.gets('/move-orders').at(-1)!.url).searchParams.get('state')).toBe('COMPLETED');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/move-orders`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/moves');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('조건에 맞는 이동 지시가 없어요.')).not.toBeInTheDocument();
  });
});

describe('이동 상세·취소', () => {
  it('취소: 사유가 있어야 보내고, 서버가 돌려준 상태(취소됨)를 보인다', async () => {
    const view = renderAt('/c/MFC-BSN-01/moves/MOVE-1');
    expect(await screen.findByRole('heading', { name: /MOVE-1/ })).toHaveTextContent('긴급');
    const button = screen.getByRole('button', { name: '이동 취소' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: '취소 사유' }), '진열 계획 바뀜');
    await userEvent.click(button);
    expect(await screen.findByText('취소했어요.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MOVE-1/ })).toHaveTextContent('취소됨');
    expect(screen.queryByRole('button', { name: '이동 취소' })).not.toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(new URL(post.url).pathname).toMatch(/\/move-orders\/MOVE-1\/cancellations$/);
    expect(await sentBody(post)).toEqual({ reason: '진열 계획 바뀜' });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('mfc-backoffice-web');
  });

  it('카트에 실린 몫이 있으면 취소 뒤 "카트 정리 대기" — 끝났다고 하지 않는다', async () => {
    db.moves.set('MOVE-1', { ...db.moves.get('MOVE-1')!, pickedQty: 2, onCartQty: 2, cartLocation: 'CRT-C-02' });
    renderAt('/c/MFC-BSN-01/moves/MOVE-1');
    await screen.findByRole('heading', { name: /MOVE-1/ });
    await userEvent.type(screen.getByRole('textbox', { name: '취소 사유' }), '중단');
    await userEvent.click(screen.getByRole('button', { name: '이동 취소' }));
    expect(await screen.findByText('취소했어요. 카트에 남은 물건을 작업자가 되돌려 놓으면 끝나요.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MOVE-1/ })).toHaveTextContent('카트 정리 대기');
    expect(screen.queryByText('취소했어요.')).not.toBeInTheDocument();
  });

  it('카트 정리 대기·자동 보충: 안내만, 취소 버튼 없음, 지시한 사람은 "시스템"', async () => {
    renderAt('/c/MFC-BSN-01/moves/MOVE-3');
    expect(await screen.findByText('취소했지만 카트에 남은 물건이 있어요. 작업자가 출발 칸에 내려놓아야 끝나요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이동 취소' })).not.toBeInTheDocument();
    renderAt('/c/MFC-BSN-01/moves/MOVE-2');
    expect(await screen.findByText('시스템')).toBeInTheDocument();
  });

  it('센터 관리자가 아니면 서버 403 — 권한 문구', async () => {
    renderAt('/c/MFC-BSN-01/moves/MOVE-1', as.adminWithCenter);
    await screen.findByRole('heading', { name: /MOVE-1/ });
    await userEvent.type(screen.getByRole('textbox', { name: '취소 사유' }), '중단');
    await userEvent.click(screen.getByRole('button', { name: '이동 취소' }));
    expect(await screen.findByText('이 센터 권한이 없습니다.')).toBeInTheDocument();
    expect(db.moves.get('MOVE-1')!.state).toBe('ACTIVE');
  });
});

describe('이동 지시', () => {
  it('재고에서 출발(위치·LOT)을, 후보에서 도착을 고르고 → 지시 → 만든 이동 상세', async () => {
    const view = renderAt('/c/MFC-BSN-01/moves/new');
    await userEvent.type(await screen.findByRole('textbox', { name: '상품 코드(SKU)' }), 'sku-milk-1');
    await userEvent.click(screen.getByRole('button', { name: '재고 보기' }));
    const stock = await screen.findAllByTestId('stock-row');
    expect(stock).toHaveLength(3);
    expect(within(stock[2]!).getByText('격리')).toBeInTheDocument();
    await userEvent.click(within(stock[0]!).getByRole('button', { name: '출발로' }));
    expect(screen.getByRole('textbox', { name: 'LOT' })).toHaveValue('LOT-MILK-A');
    expect(screen.getByRole('textbox', { name: '출발 칸' })).toHaveValue('A-P1-01-1-01');
    await userEvent.click(screen.getByRole('button', { name: '후보 보기' }));
    await userEvent.click(await screen.findByRole('button', { name: /C-S1-03-2-04/ }));
    expect(screen.getByRole('textbox', { name: '도착 칸' })).toHaveValue('C-S1-03-2-04');
    await userEvent.type(screen.getByRole('spinbutton', { name: '수량' }), '4');
    await userEvent.click(screen.getByRole('checkbox', { name: /긴급/ }));
    await userEvent.click(screen.getByRole('button', { name: '이동 지시' }));
    expect(await screen.findByText('이동을 지시했어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/move-orders'))!;
    expect(await sentBody(post)).toEqual({
      mfcId: 'MFC-BSN-01',
      sku: 'SKU-MILK-1',
      lotId: 'LOT-MILK-A',
      fromLocation: 'A-P1-01-1-01',
      toLocation: 'C-S1-03-2-04',
      qty: 4,
      urgent: true,
    });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /재배치/ })).toHaveTextContent('진행 중');
  });

  it('서버 거절(카테고리 칸) — 코드 문구, 지시가 생기지 않는다', async () => {
    renderAt('/c/MFC-BSN-01/moves/new');
    await userEvent.type(await screen.findByRole('textbox', { name: '상품 코드(SKU)' }), 'SKU-RAMEN-5');
    await userEvent.type(screen.getByRole('textbox', { name: 'LOT' }), 'LOT-RAMEN-1');
    await userEvent.type(screen.getByRole('textbox', { name: '출발 칸' }), 'F-S2-02-1-03');
    await userEvent.type(screen.getByRole('textbox', { name: '도착 칸' }), 'C-S1-03-2-04');
    await userEvent.type(screen.getByRole('spinbutton', { name: '수량' }), '2');
    await userEvent.click(screen.getByRole('button', { name: '이동 지시' }));
    expect(await screen.findByText('도착 칸의 진열 카테고리와 상품 카테고리가 달라요.')).toBeInTheDocument();
    expect(db.moves.size).toBe(5);
  });

  it('결과 불명(503)이면 실패로 확정하지 않고, "다시 확인"은 같은 키 — 서버는 같은 이동을 돌려준다', async () => {
    let first = true;
    server.use(
      http.post(`${API_BASE}/move-orders`, () => {
        if (first) {
          first = false;
          return problem(503, 'DEPENDENCY_UNAVAILABLE');
        }
        return undefined;
      }),
    );
    const view = renderAt('/c/MFC-BSN-01/moves/new');
    await userEvent.type(await screen.findByRole('textbox', { name: '상품 코드(SKU)' }), 'SKU-MILK-1');
    await userEvent.type(screen.getByRole('textbox', { name: 'LOT' }), 'LOT-MILK-B');
    await userEvent.type(screen.getByRole('textbox', { name: '출발 칸' }), 'RCV-C-01');
    await userEvent.type(screen.getByRole('textbox', { name: '도착 칸' }), 'A-P1-01-1-01');
    await userEvent.type(screen.getByRole('spinbutton', { name: '수량' }), '5');
    await userEvent.click(screen.getByRole('button', { name: '이동 지시' }));
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이동 지시' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByText('이동을 지시했어요.')).toBeInTheDocument();
    const keys = view.sent.filter((r) => r.method === 'POST').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('재고 조회 실패는 "재고 없음"이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/mfcs/:mfcId/stock`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/moves/new');
    await userEvent.type(await screen.findByRole('textbox', { name: '상품 코드(SKU)' }), 'SKU-MILK-1');
    await userEvent.click(screen.getByRole('button', { name: '재고 보기' }));
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('이 센터에 이 상품 재고가 없어요.')).not.toBeInTheDocument();
  });
});
