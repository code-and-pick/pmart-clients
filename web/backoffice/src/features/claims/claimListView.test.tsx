// 클레임 조회(2026-11-19 쿠팡 윙 반품관리 참고)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const rowOf = (text: string) => screen.getAllByTestId('claim-row').find((r) => r.textContent?.includes(text))!;

describe('클레임 조회', () => {
  it('단계 숫자 카드(서버 상태를 묶어 셈) — 회수 실패는 "고객 연락 필요"로 빨강, 안내 상자는 없다(2026-11-20)', async () => {
    renderAt('/claims', as.cs);
    await screen.findByTestId('claim-stage-all');
    expect(screen.queryByTestId('claim-guide')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('claim-stage-all')).toHaveTextContent('3'));
    expect(screen.getByTestId('claim-stage-contact')).toHaveTextContent('1');
    expect(screen.getByTestId('claim-stage-progress')).toHaveTextContent('1');
    expect(screen.getByTestId('claim-stage-done')).toHaveTextContent('1');
  });

  it('단계 숫자는 서버 집계(claim 0.10.0 CL-6 GET /claims/counts) — 주문 조건을 같이 걸고, 못 읽으면 0 이 아니라 "?"', async () => {
    const view = renderAt('/claims?orderId=ORD-MOCK-1002', as.cs);
    await waitFor(() => expect(screen.getByTestId('claim-stage-all')).toHaveTextContent('2')); // 목 ORD-MOCK-1002 클레임 2건(전체 3건 중)
    const counts = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/claims/counts'));
    expect(counts.length).toBeGreaterThan(0);
    expect(new URL(counts[0]!.url).searchParams.get('orderId')).toBe('ORD-MOCK-1002');
  });

  it('단계 숫자를 못 읽으면 0 이 아니라 "?"', async () => {
    server.use(http.get('*/api/v1/claims/counts', () => HttpResponse.json({ type: 'about:blank', status: 503, code: 'UPSTREAM_UNAVAILABLE', retryable: true }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getByTestId('claim-stage-all')).toHaveTextContent('?'), { timeout: 5000 });
    expect(screen.getByTestId('claim-stage-done')).not.toHaveTextContent('0');
  });

  it('클레임 상세 표기에 서버 순번(claimSeq) — "<주문번호> <종류> <순번>"', async () => {
    renderAt('/claims/CLM-MOCK-1', as.cs);
    await waitFor(() => expect(screen.getByTestId('claim-label')).toHaveTextContent(/ 취소 1$/));
  });

  it('클레임 품목은 상품 이름·SKU(claim 0.14.0), 이름이 없는 옛 클레임은 SKU 만(2026-11-24)', async () => {
    renderAt('/claims/CLM-MOCK-1', as.cs);
    const line = await screen.findByTestId('claim-line');
    expect(within(line).getByTestId('claim-line-name')).toHaveTextContent('사과 1.5kg');
    expect(line).toHaveTextContent('SKU E-00000001');
  });

  it('상품 이름이 없는 클레임 품목은 예전처럼 SKU 만', async () => {
    renderAt('/claims/CLM-MOCK-2', as.cs);
    const line = await screen.findByTestId('claim-line');
    expect(within(line).queryByTestId('claim-line-name')).not.toBeInTheDocument();
    expect(line).toHaveTextContent('E-00000001');
  });

  it('단계 카드를 누르면 그 단계만(주소 stage=)', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(3));
    await user.click(screen.getByTestId('claim-stage-contact'));
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(1));
    expect(screen.getByTestId('claim-row')).toHaveTextContent('회수 실패');
    expect(screen.getByTestId('claim-stage-contact')).toHaveAttribute('aria-current', 'true');
  });

  it('줄에 사유·접수 경로·환불(서버 요약 그대로 — 진행 중은 완료가 아니다)', async () => {
    renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(3));
    const closed = rowOf('종료');
    expect(closed).toHaveTextContent('단순 변심');
    expect(within(closed).getByTestId('claim-refund')).toHaveTextContent('15,100원');
    expect(within(closed).getByTestId('claim-refund')).toHaveTextContent('환불 완료');
    expect(within(rowOf('출고 중지 대기')).getByTestId('claim-refund')).toHaveTextContent('환불 진행 중');
    expect(rowOf('회수 실패')).toHaveTextContent('고객센터');
  });

  it('상태(11가지)는 필터 팝업의 값 목록(2026-11-25 화면 기준)', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.cs);
    await user.click(await screen.findByTestId('filter-toggle'));
    expect(within(screen.getByRole('radiogroup', { name: '상태' })).getAllByRole('radio').length).toBeGreaterThanOrEqual(11);
  });
});
