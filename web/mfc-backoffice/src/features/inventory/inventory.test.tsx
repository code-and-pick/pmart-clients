// 재고 화면 — mfc-inventory-service 0.16.0 목.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const postsTo = (sent: Request[], suffix: string, method = 'POST') => sent.filter((r) => r.method === method && new URL(r.url).pathname.endsWith(suffix));

async function lookup(sku: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: '상품 코드(SKU)' }), sku);
  await userEvent.click(screen.getByRole('button', { name: '조회' }));
}

describe('상품별 재고·정정', () => {
  it('상품 코드로 LOT 요약과 위치·상태별 재고를 본다(센터 전체 목록은 MB-1 안내)', async () => {
    renderAt('/c/MFC-BSN-01/inventory');
    expect(await screen.findByText(/센터 전체 재고 목록\(상품 코드 없이\)은 서버 API 가 아직 없어요/)).toBeInTheDocument();
    await lookup('sku-milk-1');
    await waitFor(() => expect(screen.getAllByTestId('unit-row')).toHaveLength(3));
    expect(screen.getAllByTestId('lot-row')).toHaveLength(2);
    expect(within(screen.getAllByTestId('unit-row')[2]!).getByText('격리')).toBeInTheDocument();
  });

  it('조회 실패는 "재고 없음"이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/mfcs/:mfcId/stock`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/inventory?sku=SKU-MILK-1');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('이 센터에 이 상품 재고가 없어요.')).not.toBeInTheDocument();
  });

  it('정정: 승인 근거를 직접 넣고 보내면 반영 뒤 재고를 다시 읽는다', async () => {
    const view = renderAt('/c/MFC-BSN-01/inventory?sku=SKU-MILK-1');
    const row = (await screen.findAllByTestId('unit-row'))[0]!;
    await userEvent.click(within(row).getByRole('button', { name: '정정' }));
    const form = screen.getByRole('form', { name: '정정' });
    const qty = within(form).getByRole('spinbutton', { name: '수량' });
    await userEvent.clear(qty);
    await userEvent.type(qty, '5');
    await userEvent.type(within(form).getByRole('textbox', { name: /목적 위치/ }), 'c-s1-03-2-04');
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '진열 위치 잘못 등록');
    const submit = within(form).getByRole('button', { name: '정정 보내기' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByRole('textbox', { name: /승인 근거/ }), 'AP-COR-1');
    await userEvent.click(submit);
    expect(await screen.findByText('정정했어요.')).toBeInTheDocument();
    expect(await sentBody(postsTo(view.sent, '/stock-corrections')[0]!)).toEqual({
      reason: '진열 위치 잘못 등록',
      approvalRef: 'AP-COR-1',
      lines: [{ sku: 'SKU-MILK-1', lotId: 'LOT-MILK-A', fromLocation: 'A-P1-01-1-01', qualityState: 'NORMAL', workState: 'STORED', qty: 5, toLocation: 'C-S1-03-2-04' }],
    });
    await waitFor(() => expect(screen.getAllByTestId('unit-row')).toHaveLength(4));
  });

  it('보이는 수량보다 많으면 단추가 꺼지고, 그 사이 재고가 줄었으면 서버가 INSUFFICIENT_STOCK', async () => {
    renderAt('/c/MFC-BSN-01/inventory?sku=SKU-MILK-1');
    const row = (await screen.findAllByTestId('unit-row'))[1]!;
    await userEvent.click(within(row).getByRole('button', { name: '정정' }));
    const form = screen.getByRole('form', { name: '정정' });
    const qty = within(form).getByRole('spinbutton', { name: '수량' });
    await userEvent.clear(qty);
    await userEvent.type(qty, '9');
    await userEvent.type(within(form).getByRole('textbox', { name: '바로잡은 제조 LOT 표기' }), 'B999');
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '표기 오류');
    await userEvent.type(within(form).getByRole('textbox', { name: /승인 근거/ }), 'AP-COR-2');
    expect(within(form).getByRole('button', { name: '정정 보내기' })).toBeDisabled();
    await userEvent.clear(qty);
    await userEvent.type(qty, '5');
    // 화면을 연 뒤 다른 사람이 그 칸 재고를 줄였다
    db.stockUnits = db.stockUnits.map((u) => (u.locationCode === 'RCV-C-01' ? { ...u, qty: 2 } : u));
    await userEvent.click(within(form).getByRole('button', { name: '정정 보내기' }));
    expect(await screen.findByText('그 위치·LOT 의 재고가 모자라요.')).toBeInTheDocument();
  });
});

describe('순환 실사', () => {
  it('실사 잠금이 안 된 칸이면 서버가 LOCATION_NOT_LOCKED 로 거절', async () => {
    renderAt('/c/MFC-BSN-01/inventory?tab=counts');
    await userEvent.type(await screen.findByRole('textbox', { name: /실사할 칸/ }), 'C-S1-03-2-04');
    await userEvent.click(screen.getByRole('button', { name: '실사 시작' }));
    expect(await screen.findByText(/실사 잠금이 안 된 칸이 있어요/)).toBeInTheDocument();
  });

  it('잠긴 칸이면 시작 → 그 실사를 연다(계수 중에는 차이를 숨긴다)', async () => {
    db.locations.set('LOC-1', { ...db.locations.get('LOC-1')!, state: 'COUNT_LOCKED' });
    const view = renderAt('/c/MFC-BSN-01/inventory?tab=counts');
    await userEvent.type(await screen.findByRole('textbox', { name: /실사할 칸/ }), 'c-s1-03-2-04, C-S1-03-2-04');
    await userEvent.type(screen.getByRole('textbox', { name: '사유(선택)' }), '월간 실사');
    await userEvent.click(screen.getByRole('button', { name: '실사 시작' }));
    const card = await screen.findByTestId('count-session');
    expect(card).toHaveTextContent('계수 중');
    expect(within(card).getByText('계수가 끝난 뒤에 차이를 보여요.')).toBeInTheDocument();
    expect(await sentBody(postsTo(view.sent, '/count-sessions')[0]!)).toEqual({ locationCodes: ['C-S1-03-2-04'], reason: '월간 실사' });
  });

  it('승인 대기 실사: 차이를 보이고, 승인 근거를 넣어야 승인 — 조정 반영', async () => {
    const view = renderAt('/c/MFC-BSN-01/inventory?tab=counts&sessionId=CNT-1');
    const card = await screen.findByTestId('count-session');
    expect(within(card).getByTestId('diff-row')).toHaveTextContent('-2');
    const approve = within(card).getByRole('button', { name: '승인(조정 반영)' });
    expect(approve).toBeDisabled();
    await userEvent.type(within(card).getByRole('textbox', { name: /승인 근거/ }), 'AP-CNT-1');
    await userEvent.click(approve);
    expect(await screen.findByText('승인했어요. 조정이 반영됐어요.')).toBeInTheDocument();
    expect(screen.getByTestId('count-session')).toHaveTextContent('조정 반영(끝)');
    expect(await sentBody(postsTo(view.sent, '/approvals')[0]!)).toEqual({ action: 'APPROVE', approvalRef: 'AP-CNT-1' });
  });

  it('직접 시작한 실사는 승인할 수 없다(SELF_APPROVAL)', async () => {
    db.countSessions.set('CNT-2', { ...db.countSessions.get('CNT-2')!, state: 'PENDING_APPROVAL', differences: [] });
    renderAt('/c/MFC-BSN-01/inventory?tab=counts&sessionId=CNT-2');
    const card = await screen.findByTestId('count-session');
    await userEvent.type(within(card).getByRole('textbox', { name: /승인 근거/ }), 'AP-CNT-2');
    await userEvent.click(within(card).getByRole('button', { name: '승인(조정 반영)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('직접 요청·시작·계수·반입한 사람은 승인할 수 없어요.');
  });

  it('반려는 승인 근거 없이 — 재고는 그대로', async () => {
    renderAt('/c/MFC-BSN-01/inventory?tab=counts&sessionId=CNT-1');
    const card = await screen.findByTestId('count-session');
    await userEvent.click(within(card).getByRole('button', { name: '반려' }));
    expect(await screen.findByText('반려했어요. 재고는 그대로예요.')).toBeInTheDocument();
    expect(db.countSessions.get('CNT-1')!.state).toBe('REJECTED');
  });
});

describe('출하 부적격·보충 기준·상품 취급', () => {
  it('출하 부적격 LOT → "이동 지시"는 이동 화면을 값으로 채워 연다(이미 기타 칸이면 단추 없음)', async () => {
    renderAt('/c/MFC-BSN-01/inventory?tab=unshippable');
    const rows = await screen.findAllByTestId('unshippable-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByText('이미 기타 칸')).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('link', { name: '이동 지시' })).not.toBeInTheDocument();
    await userEvent.click(within(rows[0]!).getByRole('link', { name: '이동 지시' }));
    expect(await screen.findByRole('textbox', { name: '상품 코드(SKU)' })).toHaveValue('SKU-MILK-1');
    expect(screen.getByRole('textbox', { name: 'LOT' })).toHaveValue('LOT-MILK-OLD');
    expect(screen.getByRole('textbox', { name: '출발 칸' })).toHaveValue('C-S1-03-2-04');
    expect(screen.getByRole('spinbutton', { name: '수량' })).toHaveValue(3);
  });

  it('보충 기준: 고회전 선반이 아니면 거절, 맞으면 저장, 삭제', async () => {
    const view = renderAt('/c/MFC-BSN-01/inventory?tab=policies');
    await waitFor(() => expect(screen.getAllByTestId('policy-row')).toHaveLength(1));
    const form = screen.getByRole('form', { name: '기준 저장' });
    const fill = async (loc: string, sku: string, min: string, target: string, unit: string) => {
      const [locIn, skuIn] = within(form).getAllByRole('textbox');
      const [minIn, targetIn, unitIn] = within(form).getAllByRole('spinbutton');
      for (const [el, v] of [
        [locIn!, loc],
        [skuIn!, sku],
        [minIn!, min],
        [targetIn!, target],
        [unitIn!, unit],
      ] as const) {
        await userEvent.clear(el);
        await userEvent.type(el, v);
      }
    };
    await fill('A-P1-01-1-01', 'SKU-RAMEN-5', '5', '3', '1');
    expect(within(form).getByText('최소는 목표 이하여야 해요.')).toBeInTheDocument();
    await fill('C-S1-03-2-04', 'SKU-RAMEN-5', '2', '6', '1');
    await userEvent.click(within(form).getByRole('button', { name: '기준 저장' }));
    expect(await screen.findByText('보충 기준은 고회전 선반에만 둘 수 있어요.')).toBeInTheDocument();
    await fill('A-P1-01-1-01', 'SKU-RAMEN-5', '2', '6', '1');
    await userEvent.click(within(form).getByRole('button', { name: '기준 저장' }));
    expect(await screen.findByText('보충 기준을 저장했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('policy-row')).toHaveLength(2));
    await userEvent.click(within(screen.getAllByTestId('policy-row')[0]!).getByRole('button', { name: '삭제' }));
    expect(await screen.findByText('보충 기준을 지웠어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('policy-row')).toHaveLength(1));
    const del = view.sent.find((r) => r.method === 'DELETE')!;
    expect(new URL(del.url).searchParams.get('sku')).toBeTruthy();
    expect(del.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('상품 취급: 켜기는 지금 버전으로 보내고, 판매 중지 상품은 SKU_INACTIVE 문구', async () => {
    const view = renderAt('/c/MFC-BSN-01/inventory?tab=handlings');
    await waitFor(() => expect(screen.getAllByTestId('handling-row')).toHaveLength(3));
    const ramen = screen.getAllByTestId('handling-row').find((r) => r.textContent?.includes('SKU-RAMEN-5'))!;
    await userEvent.click(within(ramen).getByRole('button', { name: '켜기' }));
    expect(await screen.findByText('SKU-RAMEN-5 취급을 켰어요.')).toBeInTheDocument();
    const post = postsTo(view.sent, '/sku-handlings')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('0');
    expect(await sentBody(post)).toEqual({ sku: 'SKU-RAMEN-5', enabled: true });
    const old = screen.getAllByTestId('handling-row').find((r) => r.textContent?.includes('SKU-OLD-9'))!;
    await userEvent.click(within(old).getByRole('button', { name: '켜기' }));
    expect(await screen.findByText('판매 중지(비활성) 상품은 취급을 켤 수 없어요.')).toBeInTheDocument();
  });
});
