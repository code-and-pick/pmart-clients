// 품질 화면 — mfc-quality-service 0.2.0 목.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const postsTo = (sent: Request[], suffix: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(suffix));

async function fillLine(form: HTMLElement, sku: string, lot: string, loc: string, qty: string) {
  const line = within(form).getByRole('group', { name: '대상 줄 1' });
  await userEvent.type(within(line).getByRole('textbox', { name: '상품 코드' }), sku);
  await userEvent.type(within(line).getByRole('textbox', { name: 'LOT' }), lot);
  await userEvent.type(within(line).getByRole('textbox', { name: '위치' }), loc);
  await userEvent.type(within(line).getByRole('spinbutton', { name: '수량' }), qty);
}

describe('격리·해제', () => {
  it('격리: 바로 반영 — 보낸 뒤 판정을 열어 "반영됨"', async () => {
    const view = renderAt('/c/MFC-BSN-01/quality');
    const form = await screen.findByRole('form', { name: '판정 보내기' });
    await fillLine(form, 'SKU-MILK-1', 'LOT-MILK-A', 'A-P1-01-1-01', '2');
    await userEvent.click(within(form).getByRole('button', { name: '판정 보내기' }));
    expect(await screen.findByTestId('decision')).toHaveTextContent('반영됨');
    expect(await sentBody(postsTo(view.sent, '/quality-decisions')[0]!)).toEqual({
      mfcId: 'MFC-BSN-01',
      decisionType: 'QUARANTINE',
      reason: 'DAMAGE',
      lines: [{ sku: 'SKU-MILK-1', lotId: 'LOT-MILK-A', locationCode: 'A-P1-01-1-01', qty: 2, workState: 'STORED' }],
    });
  });

  it('해제: 요청만(승인 대기) — 요청한 본인은 승인할 수 없다(SELF_APPROVAL)', async () => {
    renderAt('/c/MFC-BSN-01/quality');
    const form = await screen.findByRole('form', { name: '판정 보내기' });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '판정' }), 'RELEASE');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '사유' }), 'INSPECTION_PASS');
    await fillLine(form, 'SKU-MILK-1', 'LOT-MILK-A', 'QRT-A-01', '1');
    await userEvent.click(within(form).getByRole('button', { name: '판정 보내기' }));
    const d = await screen.findByTestId('decision');
    expect(d).toHaveTextContent('해제 승인 대기');
    await userEvent.click(within(d).getByRole('button', { name: '해제 승인' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('직접 요청·시작·계수·반입한 사람은 승인할 수 없어요.');
  });

  it('다른 사람이 요청한 해제를 승인하면 재고 반영, 반려하면 반려', async () => {
    renderAt('/c/MFC-BSN-01/quality?decisionId=QD-1');
    const d = await screen.findByTestId('decision');
    await userEvent.click(within(d).getByRole('button', { name: '해제 승인' }));
    expect(await screen.findByText('해제를 승인했어요. 재고에 반영됐어요.')).toBeInTheDocument();
    expect(screen.getByTestId('decision')).toHaveTextContent('반영됨');
    expect(screen.queryByRole('button', { name: '해제 승인' })).not.toBeInTheDocument();
  });

  it('해제 반려', async () => {
    renderAt('/c/MFC-BSN-01/quality?decisionId=QD-1');
    const d = await screen.findByTestId('decision');
    await userEvent.click(within(d).getByRole('button', { name: '해제 반려' }));
    expect(await screen.findByText('해제를 반려했어요.')).toBeInTheDocument();
    expect(db.decisions.get('QD-1')!.state).toBe('DECLINED');
  });

  it('판정 조회 실패는 오류', async () => {
    server.use(http.get(`${API_BASE}/quality-decisions/:id`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/quality?decisionId=QD-1');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
  });

  it('품질 사고 탭은 계약만 있다는 안내', async () => {
    renderAt('/c/MFC-BSN-01/quality?tab=incidents');
    expect(await screen.findByRole('note')).toHaveTextContent('501');
  });
});

describe('폐기', () => {
  it('폐기 요청 → 승인 대기로 연다', async () => {
    renderAt('/c/MFC-BSN-01/quality?tab=disposals');
    const form = await screen.findByRole('form', { name: '폐기 요청' });
    await fillLine(form, 'SKU-MILK-1', 'LOT-MILK-A', 'QRT-A-01', '2');
    await userEvent.click(within(form).getByRole('button', { name: '폐기 요청' }));
    expect(await screen.findByText(/폐기를 요청했어요/)).toBeInTheDocument();
    expect(await screen.findByTestId('disposal')).toHaveTextContent('승인 대기');
  });

  it('폐기 승인은 승인 근거를 넣어야 — 지금 버전으로 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/quality?tab=disposals&disposalId=DSP-1');
    const card = await screen.findByTestId('disposal');
    const approve = within(card).getByRole('button', { name: '폐기 승인' });
    expect(approve).toBeDisabled();
    await userEvent.type(within(card).getByRole('textbox', { name: /승인 근거/ }), 'AP-LOSS-9');
    await userEvent.click(approve);
    expect(await screen.findByText('폐기를 승인했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('disposal')).toHaveTextContent('승인됨'));
    const post = postsTo(view.sent, '/disposal-approvals')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    expect(await sentBody(post)).toEqual({ action: 'APPROVE', mfcId: 'MFC-BSN-01', disposalApprovalId: 'DSP-1', approvalRef: 'AP-LOSS-9' });
  });

  it('승인된 폐기를 나눠 실행 — 일부 실행·남은 양', async () => {
    const view = renderAt('/c/MFC-BSN-01/quality?tab=disposals&disposalId=DSP-2');
    const card = await screen.findByTestId('disposal');
    const qty = within(card).getByRole('spinbutton', { name: /실행 수량/ });
    expect(qty).toHaveValue(3);
    await userEvent.clear(qty);
    await userEvent.type(qty, '2');
    await userEvent.click(within(card).getByRole('button', { name: '폐기 실행' }));
    expect(await screen.findByText('폐기를 실행했어요(재고에서 빠졌어요).')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('disposal')).toHaveTextContent('일부 실행'));
    expect(within(screen.getByTestId('disposal-line')).getAllByRole('cell').map((c) => c.textContent).slice(3)).toEqual(['3', '3', '2', '1']);
    expect(await sentBody(postsTo(view.sent, '/executions')[0]!)).toEqual({ lines: [{ sku: 'SKU-MILK-1', lotId: 'LOT-MILK-A', locationCode: 'QRT-A-01', qty: 2 }] });
  });
});

describe('회수품 검수', () => {
  it('반입을 불러와 줄마다 판정 — 냉장 재판매는 막고, 폐기로 바꾸면 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/quality?tab=inspections&returnReceiptId=RR-1');
    const form = await screen.findByRole('form', { name: '검수 결과 보내기' });
    const ramen = within(form).getByRole('group', { name: 'SKU-RAMEN-5 × 2' });
    const milk = within(form).getByRole('group', { name: 'SKU-MILK-1 × 1' });
    await userEvent.selectOptions(within(ramen).getByRole('combobox', { name: '판정' }), 'RESALE');
    await userEvent.selectOptions(within(milk).getByRole('combobox', { name: '판정' }), 'RESALE');
    await userEvent.selectOptions(within(milk).getByRole('combobox', { name: '보관 온도대' }), 'CHILLED');
    expect(within(milk).getByText(/재판매할 수 없어요/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '검수 결과 보내기' })).toBeDisabled();
    await userEvent.selectOptions(within(milk).getByRole('combobox', { name: '판정' }), 'DISPOSE');
    await userEvent.selectOptions(within(milk).getByRole('combobox', { name: '폐기 사유' }), 'TEMPERATURE_ZONE');
    await userEvent.click(within(form).getByRole('button', { name: '검수 결과 보내기' }));
    const insp = await screen.findByTestId('inspection');
    expect(insp).toHaveTextContent('재판매 2 · 폐기 1');
    expect(insp).toHaveTextContent('폐기 승인 요청');
    const body = await sentBody(postsTo(view.sent, '/return-inspections')[0]!);
    expect(body).toMatchObject({ mfcId: 'MFC-BSN-01', claimId: 'CLM-1', returnReceiptId: 'RR-1', inspectedBy: 'OP-sup-1' });
    expect(body.lines).toEqual([
      { orderLineId: 'OL-1', sku: 'SKU-RAMEN-5', lotId: 'RET-CLM-1', qty: 2, verdict: 'RESALE', temperatureZone: 'AMBIENT', opened: false, fresh: false },
      { orderLineId: 'OL-2', sku: 'SKU-MILK-1', lotId: 'RET-CLM-1', qty: 1, verdict: 'DISPOSE', temperatureZone: 'CHILLED', opened: false, fresh: false, disposeReason: 'TEMPERATURE_ZONE' },
    ]);
  });

  it('반입한 사람이 검수하면 서버가 거절(SELF_APPROVAL)', async () => {
    db.returnReceipts.set('RR-1', { ...db.returnReceipts.get('RR-1')!, receivedBy: 'OP-sup-1' });
    renderAt('/c/MFC-BSN-01/quality?tab=inspections&returnReceiptId=RR-1');
    const form = await screen.findByRole('form', { name: '검수 결과 보내기' });
    await userEvent.click(within(form).getByRole('button', { name: '검수 결과 보내기' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('직접 요청·시작·계수·반입한 사람은 승인할 수 없어요.');
  });
});
