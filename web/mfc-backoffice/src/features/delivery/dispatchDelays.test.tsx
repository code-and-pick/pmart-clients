// 배차 지연(우리 센터) — delivery-dispatch 0.12.0 `GET /dispatch-delays` + 배송 번호 묶음(delivery-execution 0.31.0). 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('dispatch-delay-row');
const posts = (sent: Request[]) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/claims'));

describe('배차 지연', () => {
  it('우리 센터 것만, 약속 이른 순 — 배송 번호(묶음 조회), 라이더 없음, 약속 대비 지난 분', async () => {
    const view = renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => expect(within(rows()[0]!).getAllByTestId('display-number')[0]).toHaveTextContent('D35726513'));
    expect(rows()[0]).toHaveTextContent('라이더 찾는 중');
    expect(rows()[0]).toHaveTextContent('라이더 없음');
    expect(within(rows()[0]!).getByTestId('delay-minutes')).toHaveTextContent(/7[45]분 지남/);
    // 번호가 없는 배송은 "번호 없음"만(시스템 ID 는 시스템 번호 칸)
    expect(within(rows()[1]!).getAllByTestId('display-number')[0]).toHaveTextContent(/^번호 없음$/);
    expect(within(rows()[1]!).getByTestId('delay-minutes')).toHaveTextContent(/분 남음/);
    const q = new URL(view.gets('/dispatch-delays')[0]!.url).searchParams;
    expect(q.get('mfcId')).toBe('MFC-BJG-01');
    const n = new URL(view.gets('/deliveries')[0]!.url).searchParams;
    expect([n.get('mfcId'), n.get('deliveryIds')]).toEqual(['MFC-BJG-01', 'DLV-DD-1,DLV-DD-2']);
  });

  it('배차 불가로 취소 — 확인 상자에서 "취소하기"를 눌러야 보낸다: lines 없이 {orderId, CANCEL, DISPATCH_UNAVAILABLE, OPERATOR}', async () => {
    const view = renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: '배차 불가로 취소' }));
    const dialog = screen.getByTestId('dispatch-cancel-confirm');
    expect(dialog).toHaveTextContent('2,000원 쿠폰');
    expect(dialog).not.toHaveTextContent('즉시');
    await userEvent.click(within(dialog).getByRole('button', { name: '그만두기' }));
    expect(screen.queryByTestId('dispatch-cancel-confirm')).not.toBeInTheDocument();
    expect(posts(view.sent)).toHaveLength(0);

    await userEvent.click(within(rows()[0]!).getByRole('button', { name: '배차 불가로 취소' }));
    await userEvent.type(within(screen.getByTestId('dispatch-cancel-confirm')).getByLabelText('메모(선택)'), '근처 라이더 없음');
    await userEvent.click(within(screen.getByTestId('dispatch-cancel-confirm')).getByRole('button', { name: '취소하기' }));
    expect(await within(rows()[0]!).findByTestId('dispatch-cancel-done')).toHaveTextContent('취소를 접수했어요(출고 멈추는 중)');
    const post = posts(view.sent)[0]!;
    expect(await post.clone().json()).toEqual({ orderId: 'ORD-DD-1', type: 'CANCEL', reason: 'DISPATCH_UNAVAILABLE', channel: 'OPERATOR', reasonDetail: '근처 라이더 없음' });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('mfc-backoffice-web');
  });

  it('지연 종류를 나눈다 — 라이더 없음 = 배차 탐색 지연(자동 취소 안내·배차 실패 접수로), 배정됨 = 픽업 지연(취소 전 라이더·포장 영향 경고)', async () => {
    server.use(
      http.get(`${API_BASE}/cases`, () =>
        HttpResponse.json({ items: [{ caseId: 'CASE-DF-1', caseNumber: 'C-1126-0007', kind: 'DISPATCH_FAILED', state: 'OPEN', subjectType: 'DELIVERY', subjectRef: 'DLV-DD-1', overdue: false, refs: [] }], page: { nextCursor: null } }),
      ),
    );
    renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getByTestId('delay-kind')).toHaveTextContent('배차 탐색 지연');
    expect(within(rows()[0]!).getByTestId('delay-next')).toHaveTextContent('자동 취소 대상');
    expect(await within(rows()[0]!).findByTestId('delay-failure-link')).toHaveTextContent('C-1126-0007');
    expect(within(rows()[1]!).getByTestId('delay-kind')).toHaveTextContent('픽업 지연');
    expect(within(rows()[1]!).getByTestId('delay-next')).toHaveTextContent('라이더가 배정돼 오는 중');
    expect(within(rows()[1]!).queryByTestId('delay-failure-link')).not.toBeInTheDocument();
    await userEvent.click(within(rows()[1]!).getByRole('button', { name: '배차 불가로 취소' }));
    expect(screen.getByTestId('dispatch-cancel-assigned')).toHaveTextContent('라이더의 배송이 거둬지고');
    expect(screen.getByTestId('dispatch-cancel-confirm')).toHaveTextContent('복귀 작업');
  });

  it('이미 라이더에게 넘겼으면(422 ORDER_NOT_CANCELLABLE) 반품 안내', async () => {
    server.use(http.post(`${API_BASE}/claims`, () => HttpResponse.json({ status: 422, code: 'ORDER_NOT_CANCELLABLE', type: 'about:blank' }, { status: 422, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: '배차 불가로 취소' }));
    await userEvent.click(within(screen.getByTestId('dispatch-cancel-confirm')).getByRole('button', { name: '취소하기' }));
    expect(await within(rows()[0]!).findByText(/반품으로 안내/)).toBeInTheDocument();
    expect(within(rows()[0]!).queryByTestId('dispatch-cancel-done')).not.toBeInTheDocument();
  });

  it('번호 조회가 실패하면 "번호 확인 불가"(번호 없음과 구분), 목록 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/deliveries`, () => HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', type: 'about:blank' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(within(rows()[0]!).getAllByTestId('display-number')[0]).toHaveTextContent('번호 확인 불가'));
    server.use(http.get(`${API_BASE}/dispatch-delays`, () => HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', type: 'about:blank' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BJG-01/dispatch-delays');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /다시/ }).length).toBeGreaterThan(0));
  });

  it('없으면 "수고하셨어요"', async () => {
    server.use(http.get(`${API_BASE}/dispatch-delays`, () => HttpResponse.json({ items: [] })));
    renderAt('/c/MFC-BJG-01/dispatch-delays');
    expect(await screen.findByTestId('all-done')).toHaveTextContent('배차가 늦어지는 배송이 없어요');
  });
});

describe('홈 배차 지연 칸', () => {
  it('서버 배차 지연 수, 누르면 배차 지연 메뉴', async () => {
    renderAt('/c/MFC-BJG-01/ops');
    expect(await screen.findByTestId('tile-dispatch-delay-value')).toHaveTextContent(/^2건$/);
    expect(screen.getByTestId('tile-dispatch-delay')).toHaveAttribute('href', '/c/MFC-BJG-01/dispatch-delays');
  });
});
