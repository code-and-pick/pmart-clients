// 입고 화면 — mfc-inbound-service 0.9.0 목.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('inbound-task-row');
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const postsTo = (sent: Request[], suffix: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(suffix));
const heading = () => screen.findByRole('heading', { level: 1, name: /ITK-/ });

describe('입고 작업 목록', () => {
  it('화면 기본은 대기(state=READY 를 보낸다), "전체"는 state 없이', async () => {
    const view = renderAt('/c/MFC-BSN-01/inbound');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(new URL(view.gets('/inbound-tasks')[0]!.url).searchParams.get('state')).toBe('READY');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'ALL');
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(new URL(view.gets('/inbound-tasks').at(-1)!.url).searchParams.get('state')).toBeNull();
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/inbound-tasks`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/inbound');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 입고 작업이 없어요.')).not.toBeInTheDocument();
  });

  it('입고 예정(TRF) 탭은 계약만 있다는 안내', async () => {
    renderAt('/c/MFC-BSN-01/inbound?tab=promises');
    expect(await screen.findByRole('note')).toHaveTextContent('501');
  });
});

describe('품질검사·적치', () => {
  it('품질검사: 결과를 여러 줄(정상 LOT·격리)로 보내고, 반영되면 만든 적치 작업을 알린다', async () => {
    const view = renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-1');
    await heading();
    const form = screen.getByRole('form', { name: '품질검사 결과' });
    const row1 = within(form).getByRole('group', { name: '1번째 결과' });
    await userEvent.type(within(row1).getByRole('spinbutton'), '3');
    await userEvent.type(within(row1).getByRole('textbox', { name: '제조 LOT 표기' }), 'A123');
    fireEvent.change(within(row1).getByLabelText('소비기한'), { target: { value: '2026-12-31' } });
    await userEvent.click(within(form).getByRole('button', { name: '줄 더하기' }));
    const row2 = within(form).getByRole('group', { name: '2번째 결과' });
    await userEvent.type(within(row2).getByRole('spinbutton'), '1');
    await userEvent.selectOptions(within(row2).getByRole('combobox', { name: '판정' }), 'QUARANTINED');
    await userEvent.click(within(form).getByRole('button', { name: '검사 결과 보내기' }));
    expect(await screen.findByText(/반영됐어요\. 적치 작업이 생겼어요: ITK-/)).toBeInTheDocument();
    expect(await sentBody(postsTo(view.sent, '/inspections')[0]!)).toEqual({
      results: [
        { qty: 3, resultQuality: 'NORMAL', sourceLotRef: 'A123', expiryDate: '2026-12-31' },
        { qty: 1, resultQuality: 'QUARANTINED' },
      ],
    });
    expect(db.inboundTasks.get('ITK-1')!.doneQty).toBe(4);
  });

  it('합계가 남은 수량보다 많으면 보내지 않는다', async () => {
    renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-1');
    await heading();
    const form = screen.getByRole('form', { name: '품질검사 결과' });
    await userEvent.type(within(form).getByRole('spinbutton'), '7');
    expect(within(form).getByText('합계 7 이 남은 수량 6 보다 많아요.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '검사 결과 보내기' })).toBeDisabled();
  });

  it('담당이 따로 있으면 서버가 NOT_ASSIGNEE 로 거절', async () => {
    renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-2');
    await heading();
    expect(screen.getByText(/담당\(OP-wkr-1\)만 실행할 수 있어요/)).toBeInTheDocument();
    const form = screen.getByRole('form', { name: '품질검사 결과' });
    await userEvent.type(within(form).getByRole('spinbutton'), '2');
    await userEvent.click(within(form).getByRole('button', { name: '검사 결과 보내기' }));
    expect(await screen.findByText('이 작업의 담당이 아니에요. 담당만 실행할 수 있어요.')).toBeInTheDocument();
  });

  it('적치: 재고가 거절(REJECTED)하면 사유를 보이고 잔량은 그대로', async () => {
    renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-3');
    await heading();
    const form = screen.getByRole('form', { name: '적치' });
    await userEvent.type(within(form).getByRole('textbox', { name: '적치할 선반 위치' }), 'RCV-C-01');
    await userEvent.click(within(form).getByRole('button', { name: '적치 보내기' }));
    expect(await screen.findByText(/선반·피킹 구역의 칸이 아니에요/)).toBeInTheDocument();
    expect(db.inboundTasks.get('ITK-3')!.doneQty).toBe(1);
  });

  it('적치: 후보에서 고른 선반으로 남은 수량을 다 놓으면 끝남', async () => {
    const view = renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-3');
    await heading();
    const form = screen.getByRole('form', { name: '적치' });
    expect(within(form).getByRole('spinbutton')).toHaveValue(3);
    await userEvent.click(within(form).getByRole('button', { name: '적치 후보 보기' }));
    await userEvent.click(await within(form).findByRole('button', { name: /C-S1-03-2-04/ }));
    await userEvent.click(within(form).getByRole('button', { name: '적치 보내기' }));
    expect(await screen.findByText('반영됐어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('끝남'));
    expect(await sentBody(postsTo(view.sent, '/putaways')[0]!)).toEqual({ toLocationCode: 'C-S1-03-2-04', qty: 3 });
  });

  it('결과 불명(503)이면 실패로 확정하지 않고 같은 키로 다시 보낸다', async () => {
    let first = true;
    server.use(
      http.post(`${API_BASE}/inbound-tasks/:taskId/putaways`, () => {
        if (first) {
          first = false;
          return HttpResponse.json({ type: 'about:blank', status: 503, code: 'UNKNOWN_RESULT' }, { status: 503, headers: { 'content-type': 'application/problem+json' } });
        }
        return undefined;
      }),
    );
    const view = renderAt('/c/MFC-BSN-01/inbound/tasks/ITK-3');
    await heading();
    const form = screen.getByRole('form', { name: '적치' });
    await userEvent.type(within(form).getByRole('textbox', { name: '적치할 선반 위치' }), 'C-S1-03-2-04');
    await userEvent.click(within(form).getByRole('button', { name: '적치 보내기' }));
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByText('반영됐어요.')).toBeInTheDocument();
    const keys = postsTo(view.sent, '/putaways').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('초기 보유·회수품·공급 요청', () => {
  it('초기 보유: 승인 ID 로 찾고, 이 센터 것만 받는다 — 접수 뒤 상태를 다시 읽어 보인다', async () => {
    const view = renderAt('/c/MFC-BSN-01/inbound?tab=initial');
    await userEvent.type(await screen.findByRole('textbox', { name: '승인 ID' }), 'AP-INIT-1');
    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    const cards = await screen.findAllByTestId('initial-load');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByText(/다른 센터의 입고 예정이에요/)).toBeInTheDocument();
    const card = cards[0]!;
    await userEvent.type(within(card).getByRole('spinbutton', { name: '받은 수량 SKU-MILK-1' }), '8');
    await userEvent.type(within(card).getByRole('textbox', { name: /수령 위치/ }), 'rcv-c-01');
    await userEvent.click(within(card).getByRole('button', { name: '수령 보내기' }));
    await waitFor(() => expect(screen.getAllByTestId('initial-load')[0]).toHaveTextContent('전기 끝(품질검사 작업 생김)'));
    expect(await sentBody(postsTo(view.sent, '/receipts')[0]!)).toEqual({
      toLocationCode: 'RCV-C-01',
      lines: [
        { sku: 'SKU-MILK-1', receivedQty: 8 },
        { sku: 'SKU-RAMEN-5', receivedQty: 0 },
      ],
    });
  });

  it('회수품 반입 → 반입 ID 로 상태(반영·검수 대기)를 연다', async () => {
    renderAt('/c/MFC-BSN-01/inbound?tab=returns');
    const form = await screen.findByRole('form', { name: '반입 등록' });
    await userEvent.type(within(form).getByRole('textbox', { name: '클레임 ID' }), 'CLM-1');
    await userEvent.type(within(form).getByRole('textbox', { name: '회수 ID(배송)' }), 'RPU-1');
    await userEvent.type(within(form).getByRole('textbox', { name: '반품 위치' }), 'RTN-A-01');
    await userEvent.type(within(form).getByRole('textbox', { name: '상품 코드' }), 'SKU-MILK-1');
    await userEvent.type(within(form).getByRole('spinbutton'), '1');
    await userEvent.click(within(form).getByRole('button', { name: '반입 등록' }));
    const view = await screen.findByTestId('return-receipt');
    expect(view).toHaveTextContent('반영됨');
    expect(view).toHaveTextContent('검수 대기');
  });

  it('공급 요청 → 요청 화면(제출됨) → 철회', async () => {
    const view = renderAt('/c/MFC-BSN-01/inbound?tab=supply');
    const form = await screen.findByRole('form', { name: '공급 요청' });
    fireEvent.change(within(form).getByLabelText('희망 사용준비 시각(한국)'), { target: { value: '2026-11-18T09:00' } });
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '주말 수요');
    await userEvent.type(within(form).getByRole('textbox', { name: '상품 코드' }), 'SKU-MILK-1');
    await userEvent.type(within(form).getByRole('spinbutton'), '20');
    await userEvent.click(within(form).getByRole('button', { name: '공급 요청' }));
    const card = await screen.findByTestId('supply-request');
    expect(card).toHaveTextContent('제출됨');
    expect(await sentBody(postsTo(view.sent, '/supply-requests')[0]!)).toEqual({
      mfcId: 'MFC-BSN-01',
      requestedReadyAt: '2026-11-18T09:00:00+09:00',
      urgency: 'NORMAL',
      reason: '주말 수요',
      lines: [{ sku: 'SKU-MILK-1', qty: 20 }],
    });
    await userEvent.type(within(card).getByRole('textbox', { name: '철회 사유' }), '수요 취소');
    await userEvent.click(within(card).getByRole('button', { name: '철회' }));
    await waitFor(() => expect(screen.getByTestId('supply-request')).toHaveTextContent('철회됨'));
    const withdraw = postsTo(view.sent, '/withdrawals')[0]!;
    expect(withdraw.headers.get('X-Expected-Version')).toBe('1');
  });
});
