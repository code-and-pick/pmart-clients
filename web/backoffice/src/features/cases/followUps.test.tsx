// 후속 처리(case 0.8.0 의무) — 접수 건 상세 칸·고객센터 후속 처리 메뉴. 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const item = async (kind: string) => (await screen.findAllByTestId('follow-up')).find((r) => r.textContent?.includes(kind))!;

describe('후속 처리', () => {
  it('접수 건 상세에 남은 건수·종류·담당 팀·수량, 남아 있으면 완료 처리 막힘', async () => {
    renderAt('/cases/CASE-MOCK-1', as.admin);
    expect(await screen.findByRole('heading', { name: '후속 처리 (2건 남음)' })).toBeInTheDocument();
    const contact = await item('고객 연락');
    expect(contact).toHaveTextContent('고객센터');
    expect(contact).toHaveTextContent('처리 중');
    expect(await item('회수')).toHaveTextContent('수량 0/1');
    expect(screen.getByTestId('close-blocked')).toHaveTextContent('후속 처리 2건이 남아 완료 처리할 수 없어요');
    expect(within(screen.getByRole('form', { name: '완료 처리' })).getByRole('button', { name: '완료 처리' })).toBeDisabled();
  });

  it('지원센터: 회수 완료(수량·근거) → 처리 끝남, 남은 건수 줄어듦 — 고객센터 몫에는 버튼 없음', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    const pickup = await item('회수');
    expect(within(await item('고객 연락')).queryByRole('button', { name: '결과 남기기' })).not.toBeInTheDocument();
    await userEvent.click(within(pickup).getByRole('button', { name: '결과 남기기' }));
    // 지원센터에는 면제·실패가 없다
    expect(within(pickup).queryByRole('option', { name: '면제(관리자)' })).not.toBeInTheDocument();
    // 지울 수 없다는 안내 — 할 필요가 없어진 것은 관리자 면제로(2026-11-19 사용자 "후속 처리 삭제가 안 된다")
    expect(within(pickup).getByTestId('followup-no-delete')).toHaveTextContent('지울 수 없어요');
    await userEvent.type(within(pickup).getByLabelText('이번에 한 수량'), '1');
    await userEvent.selectOptions(within(pickup).getByLabelText('근거가 있는 곳'), 'delivery-execution-service');
    await userEvent.type(within(pickup).getByLabelText('근거 번호(클레임·통화 기록 등)'), 'HO-123');
    await userEvent.click(within(pickup).getByRole('button', { name: '남기기' }));
    await waitFor(async () => expect(await item('회수')).toHaveTextContent('처리 끝남'));
    expect(await screen.findByRole('heading', { name: '후속 처리 (1건 남음)' })).toBeInTheDocument();
    const sent = view.mutations('/obligations/OBL-MOCK-2/resolutions')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ outcome: 'FULFILLED', evidence: { system: 'delivery-execution-service', ref: 'HO-123' }, resolvedQty: 1 });
  });

  it('고객센터 후속 처리: 상담원이 시도 기록(메모 필수) → 상태 그대로, 결과 이력에 남음', async () => {
    const view = renderAt('/follow-ups/cs', as.cs);
    const contact = await item('고객 연락');
    expect(await screen.findByRole('link', { name: '접수 건 C-1119-0001' })).toHaveAttribute('href', '/cases/CASE-MOCK-1'); // 접수 건 번호(ADR-0070 덧붙임)
    await userEvent.click(within(contact).getByRole('button', { name: '결과 남기기' }));
    await userEvent.selectOptions(within(contact).getByLabelText('결과'), 'ATTEMPTED');
    await userEvent.type(within(contact).getByLabelText('근거 번호(클레임·통화 기록 등)'), 'CALL-1');
    expect(within(contact).getByRole('button', { name: '남기기' })).toBeDisabled(); // 메모 필수
    await userEvent.type(within(contact).getByLabelText('메모·사유(필수)'), '부재중 1회');
    await userEvent.click(within(contact).getByRole('button', { name: '남기기' }));
    await waitFor(async () => expect(within(await item('고객 연락')).getByTestId('follow-up-results')).toHaveTextContent('시도 기록'));
    expect(await item('고객 연락')).toHaveTextContent('처리 중');
    expect(await view.mutations('/obligations/OBL-MOCK-1/resolutions')[0]!.json()).toEqual({ outcome: 'ATTEMPTED', evidence: { system: 'phone', ref: 'CALL-1' }, note: '부재중 1회' });
  });

  it('관리자: 결과에 면제·실패가 있고, 지울 수 없다는 안내는 없다(면제로 끝낼 수 있음)', async () => {
    renderAt('/cases/CASE-MOCK-1', as.admin);
    const pickup = await item('회수');
    await userEvent.click(within(pickup).getByRole('button', { name: '결과 남기기' }));
    expect(within(pickup).getByRole('option', { name: '면제(관리자)' })).toBeInTheDocument();
    expect(within(pickup).queryByTestId('followup-no-delete')).not.toBeInTheDocument();
  });

  it('후속 처리 추가: 종류·담당 팀·기록 금액(환불 아님 안내) → 목록에 생김', async () => {
    const view = renderAt('/cases/CASE-MOCK-2', as.admin);
    const form = await screen.findByTestId('follow-up-add');
    expect(form).toHaveTextContent('실제 환불·보상은 클레임·결제 메뉴에서');
    await userEvent.selectOptions(within(form).getByLabelText('종류'), 'REFUND');
    await userEvent.selectOptions(within(form).getByLabelText('담당 팀'), 'ORDER_OPS');
    await userEvent.type(within(form).getByLabelText('기록 금액(원, 선택)'), '5000');
    await userEvent.click(within(form).getByRole('button', { name: '후속 처리 추가' }));
    expect(await item('환불')).toHaveTextContent('기록 금액 0원/5,000원');
    expect(await view.mutations('/cases/CASE-MOCK-2/obligations')[0]!.json()).toEqual({ kind: 'REFUND', owner: 'ORDER_OPS', amount: 5000 });
  });

  it('결과를 모를 때(503) 금액을 고쳐도 "같은 요청으로 결과 확인"은 같은 키·처음 값 그대로(#410 후속)', async () => {
    let first = true;
    server.use(
      http.post(`${API_BASE}/cases/CASE-MOCK-2/obligations`, () => {
        if (!first) return undefined;
        first = false;
        return HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } });
      }),
    );
    const view = renderAt('/cases/CASE-MOCK-2', as.admin);
    const form = await screen.findByTestId('follow-up-add');
    await userEvent.selectOptions(within(form).getByLabelText('종류'), 'REFUND');
    await userEvent.type(within(form).getByLabelText('기록 금액(원, 선택)'), '5000');
    await userEvent.click(within(form).getByRole('button', { name: '후속 처리 추가' }));
    const again = await within(form).findByRole('button', { name: '같은 요청으로 결과 확인' });
    await userEvent.type(within(form).getByLabelText('기록 금액(원, 선택)'), '0');
    await userEvent.click(again);
    await waitFor(() => expect(view.mutations('/cases/CASE-MOCK-2/obligations')).toHaveLength(2));
    const [a, b] = view.mutations('/cases/CASE-MOCK-2/obligations');
    expect(b!.headers.get('Idempotency-Key')).toBe(a!.headers.get('Idempotency-Key'));
    expect(await b!.json()).toEqual({ kind: 'REFUND', amount: 5000 });
  });

  it('상담원은 접수 건 상세에서 후속 처리를 추가할 수 없다', async () => {
    renderAt('/cases/CASE-MOCK-1', as.cs);
    await screen.findAllByTestId('follow-up');
    expect(screen.queryByTestId('follow-up-add')).not.toBeInTheDocument();
  });
});
