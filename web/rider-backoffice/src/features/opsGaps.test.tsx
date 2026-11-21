// 백엔드 조치 API 알림(2026-11-17) 대조 뒤 보탠 것 — 문의 사진·완료 증빙·수행료·반납 방식·추가 배달료 거르기. 목(MSW) 기준, 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE } from '../api/client';
import { server } from '../test/server';

import { as, renderAt } from '../test/render';

const surchargeQuery = (sent: readonly Request[]) =>
  sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/surcharge-requests')).map((r) => new URL(r.url).searchParams);

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});

describe('라이더 문의 사진(case 0.14.0)', () => {
  it('문의에 붙은 사진을 토큰으로 받아 보인다', async () => {
    renderAt('/inquiries/INQ-1', as.riderOps);
    expect(await screen.findByRole('button', { name: '문의 사진 1 크게 보기' })).toBeInTheDocument();
  });
});

describe('배송 상세 — 완료 증빙·수행료·반납 방식', () => {
  it('완료 방법·놓은 곳·사진, 수행료는 서버 금액 그대로', async () => {
    renderAt('/deliveries/DLV-3', as.riderOps);
    const proof = await screen.findByTestId('delivery-proof');
    expect(within(proof).getByText('비대면(사진)')).toBeInTheDocument();
    expect(within(proof).getByText('문 앞')).toBeInTheDocument();
    expect(await within(proof).findByRole('button', { name: '완료 사진 1 크게 보기' })).toBeInTheDocument();
    const earning = screen.getByTestId('delivery-earning');
    expect(earning).toHaveTextContent('4,500');
    expect(earning).toHaveTextContent('확정');
    expect(earning).toHaveTextContent('2026-11-21');
  });

  it('전달 전 배송은 증빙 없음, 수행료 기록 없음 — 0 원으로 보이지 않는다', async () => {
    renderAt('/deliveries/DLV-2', as.riderOps);
    expect(await within(await screen.findByTestId('delivery-proof')).findByText(/증빙이 없어요/)).toBeInTheDocument();
    expect(screen.getByTestId('delivery-earning')).toHaveTextContent('수행료 기록이 없어요.');
  });

  it('다른 라이더 반납(returnPickupRequired true)은 "받음 → 반납"', async () => {
    renderAt('/deliveries/DLV-4', as.riderOps);
    expect(await screen.findByTestId('return-flow')).toHaveTextContent('받음 → 반납');
  });
});

describe('추가 배달료 거르기', () => {
  it('기본은 신청만, 승인 탭은 결정 내용(버튼 없음), 라이더 ID 는 주소에 남아 서버로', async () => {
    const view = renderAt('/surcharges', as.riderOps);
    expect(await screen.findAllByTestId('surcharge-row')).toHaveLength(1);
    expect(surchargeQuery(view.sent).at(-1)!.get('state')).toBe('REQUESTED');

    await userEvent.click(screen.getByTestId('search-toggle')); // 상태는 깔때기 팝업 안(2026-11-21)
    await userEvent.click(screen.getByRole('radio', { name: '승인' }));
    const decided = await screen.findByTestId('surcharge-decided');
    expect(decided).toHaveTextContent('승인');
    expect(decided).toHaveTextContent(/나|직원/); // 직원은 OP-… 대신(ADR-0070)
    expect(decided).not.toHaveTextContent('OP-');
    expect(screen.queryByRole('button', { name: /승인$/ })).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: '전체' }));
    expect(await screen.findAllByTestId('surcharge-row')).toHaveLength(2);
    expect(surchargeQuery(view.sent).at(-1)!.has('state')).toBe(false);

    await userEvent.type(screen.getByLabelText('라이더 번호 6자리(또는 라이더 ID)'), 'RD-8');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findAllByTestId('surcharge-row')).toHaveLength(1);
    expect(surchargeQuery(view.sent).at(-1)!.get('riderId')).toBe('RD-8');
  });
});

describe('완료 방법(execution 0.22.1 계약 enum — 요청서 #7 회신)', () => {
  const completed = (method: string) => ({
    deliveryId: 'DLV-9',
    orderId: 'ORD-9',
    type: 'FORWARD',
    purpose: 'DELIVERY',
    state: 'COMPLETED',
    riderId: 'RD-7',
    mfcId: 'MFC-BSJ-01',
    completedAt: '2026-11-17T06:00:00.000Z',
    evidence: { method, photoRefs: [], takenAt: '2026-11-17T06:00:00.000Z' },
    history: [],
    version: 3,
  });

  it.each([
    ['AUTO_COMPLETED', '자동 완료(픽업 5시간)'],
    ['CUSTOMER_CONFIRMED', '고객이 "받았어요"'],
  ])('%s → %s, 사진 없음', async (method, text) => {
    server.use(http.get(`${API_BASE}/deliveries/DLV-9`, () => HttpResponse.json(completed(method))));
    renderAt('/deliveries/DLV-9', as.riderOps);
    const proof = await screen.findByTestId('delivery-proof');
    expect(await within(proof).findByText(text)).toBeInTheDocument();
    expect(within(proof).queryByRole('button', { name: /완료 사진/ })).toBeNull();
  });
});
