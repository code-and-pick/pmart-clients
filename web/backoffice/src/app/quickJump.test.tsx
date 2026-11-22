// 머리줄 번호로 바로 찾기(2026-11-18)
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { server } from '../test/server';
import { isRiderNumber, parseDeliveryNumber } from '../shared/numberLookups';
import { as, renderAt } from '../test/render';

async function jump(text: string) {
  const user = userEvent.setup();
  const box = await screen.findByRole('textbox', { name: '번호로 바로 찾기' });
  await user.clear(box);
  await user.type(box, `${text}{Enter}`);
  return box;
}

describe('번호로 바로 찾기', () => {
  it('배송 번호(D+8자리, ADR-0085) → 배송 상세', async () => {
    renderAt('/', as.csRider);
    await jump('D74939001');
    expect(await screen.findByTestId('execution-panel')).toBeInTheDocument();
    expect(screen.getByTestId('page-title')).toHaveTextContent('배송·배차 확인');
  });

  it('주문번호(8자리) → 주문 상세', async () => {
    renderAt('/', as.cs);
    await jump('74939003');
    // 대시보드의 위치 줄은 비어 있다 — 화면이 바뀔 때까지 기다린다
    await waitFor(() => expect(screen.getByTestId('page-title')).toHaveTextContent('주문 조회'));
    expect((await screen.findAllByText(/ORD-MOCK-1003|74939003/)).length).toBeGreaterThan(0);
  });

  it('라이더 번호(R+4자리, ADR-0085) → 라이더 상세', async () => {
    renderAt('/', as.csRider);
    await jump('R4785');
    expect(await screen.findByTestId('rider-ops-moved')).toBeInTheDocument();
  });

  it('없는 번호는 "찾지 못했어요" — 화면은 그대로', async () => {
    renderAt('/', as.cs);
    await jump('11112222');
    expect(await screen.findByRole('status')).toHaveTextContent('주문 번호로 찾은 결과가 없어요');
  });

  it('조회가 실패하면 "없음"이 아니라 "확인하지 못했어요"', { timeout: 20000 }, async () => {
    server.use(http.get(`${API_BASE}/orders/lookups`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'SERVICE_UNAVAILABLE', retryable: true }, { status: 503 })));
    renderAt('/', as.cs);
    await jump('74939003');
    // 다시 시도할 수 있는 실패는 자동 재시도가 끝난 뒤에 알린다
    expect(await screen.findByRole('status', {}, { timeout: 15000 })).toHaveTextContent('확인하지 못했어요');
  });

  it('번호 모양이 아니면 통합 조회로 넘긴다', async () => {
    renderAt('/', as.cs);
    await jump('CUS-1001');
    await waitFor(() => expect(screen.getByTestId('page-title')).toHaveTextContent('통합 조회'));
  });

  it('Ctrl+K 로 어디서나 이 칸으로', async () => {
    renderAt('/', as.cs);
    const box = await screen.findByRole('textbox', { name: '번호로 바로 찾기' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(box).toHaveFocus();
  });
});

describe('짧은 화면 번호 모양(ADR-0085 2026-11-22)', () => {
  it('라이더: R4785·r4785·4785·R48251 은 번호, 6자리 옛 번호·R123 은 아님', () => {
    for (const v of ['R4785', 'r4785', '4785', 'R48251', ' R4785 ']) expect(isRiderNumber(v)).toBe(true);
    for (const v of ['482913', 'R123', 'RID-MOCK-1', 'D74939255']) expect(isRiderNumber(v)).toBe(false);
  });

  it('배송: D 와 -순번을 떼어 주문번호 8자리·순번(없으면 1) — 예전 74939255-1 도 같은 배송, 숫자 8자리만은 주문으로', () => {
    expect(parseDeliveryNumber('D74939255')).toEqual({ orderNumber: '74939255', seq: 1, marked: true });
    expect(parseDeliveryNumber('d74939255-2')).toEqual({ orderNumber: '74939255', seq: 2, marked: true });
    expect(parseDeliveryNumber('74939255-1')).toEqual({ orderNumber: '74939255', seq: 1, marked: true });
    expect(parseDeliveryNumber('74939255')).toEqual({ orderNumber: '74939255', seq: 1, marked: false });
    expect(parseDeliveryNumber('DLV-MOCK-1')).toBeNull();
  });

  it('바로 찾기: R 없이 숫자만 넣은 라이더 번호도 연다', async () => {
    renderAt('/', as.csRider);
    await jump('4785');
    expect(await screen.findByTestId('rider-ops-moved')).toBeInTheDocument();
  });
});
