// 도움요청 상세 보탬 — 증빙 사진·처리함·가리기(execution 계약) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { mockDeliveries } from '../../mocks/deliveryHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const sentTo = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

beforeEach(() => {
  // jsdom 에는 object URL 이 없다 — 사진 칸이 그려지는지만 본다
  URL.createObjectURL = vi.fn(() => 'blob:evidence');
  URL.revokeObjectURL = vi.fn();
});

describe('도움요청 상세 — 증빙 사진·처리함·가리기', () => {
  // 상담 완료 시험은 결정 대기가 아닌 배송으로(결정 대기면 상담 완료를 막는다 — 아래 따로 시험)
  beforeEach(() => {
    server.use(http.get(`${API_BASE}/deliveries/DLV-1`, () => HttpResponse.json({ ...mockDeliveries[0]!, state: 'PICKED_UP', failure: null })));
  });
  it('증빙 사진: 받은 사진은 보이고, 못 받은 사진은 빈칸이 아니라 "불러오지 못함"', async () => {
    renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByRole('heading', { name: '증빙 사진 2장' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '증빙 사진 1 크게 보기' })).toBeInTheDocument();
    expect(await screen.findByTestId('photo-error')).toHaveTextContent('사진을 불러오지 못했어요');
  });

  it('상담 완료(접수 건 없음): 확인 창 → 멱등 키로 도움요청을 닫고 "상담을 완료했어요"', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    const dialog = screen.getByRole('dialog', { name: '상담을 완료할까요?' });
    await userEvent.type(within(dialog).getByLabelText(/처리 내용/), '주소 안내함');
    await userEvent.click(within(dialog).getByRole('button', { name: '완료' }));
    expect(await screen.findByTestId('resolve-done')).toHaveTextContent('상담을 완료했어요');
    const posts = sentTo(view.sent, '/resolutions');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(posts[0]!.headers.get('X-Source-System')).toBeTruthy();
  });

  it('확인 창에서 취소하면 보내지 않는다', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sentTo(view.sent, '/resolutions')).toHaveLength(0);
  });

  it('접수 건이 붙은 도움요청도 같은 "상담 완료" 버튼 — 접수 건 화면으로 넘어가지 않고 그 접수 건을 닫는다(사용자 2026-11-19)', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-CASE', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    const dialog = screen.getByRole('dialog', { name: '상담을 완료할까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '완료' }));
    expect(await screen.findByTestId('resolve-done')).toHaveTextContent('상담을 완료했어요');
    const posts = sentTo(view.sent, '/cases/CASE-9/closures');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    // 처리 내용을 비우면 결과 이름으로 남긴다(접수 건 종결은 처리 내용이 꼭 필요)
    expect((await posts[0]!.clone().json()) as unknown).toEqual({ resolution: 'RESOLVED', summary: '상담 완료 — 해결' });
    expect(sentTo(view.sent, '/resolutions')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: '접수 건 보기' })).not.toBeInTheDocument();
  });

  it('가리기는 관리자에게만 — 사유와 함께 보내면 대화가 가려져 다시 보인다', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.admin);
    const chat = await screen.findByTestId('help-messages');
    await userEvent.click(within(chat).getByRole('button', { name: '가리기' }));
    await userEvent.type(screen.getByLabelText('가리는 사유(2~500자)'), '출입 비밀번호');
    await userEvent.click(within(screen.getByRole('form', { name: '가리기' })).getByRole('button', { name: '가리기' }));
    // 가린 메시지는 다시 읽으면 masked — 글 대신 '(가린 메시지)', 그 메시지의 가리기 칸은 사라짐
    expect(await within(screen.getByTestId('help-messages')).findByText('(가린 메시지)')).toBeInTheDocument();
    expect(screen.queryByText('공동현관 비밀번호가 틀려요')).not.toBeInTheDocument();
    expect(sentTo(view.sent, '/maskings')).toHaveLength(1);
  });

  it('라이더 운영(RIDER_OPS)에게는 가리기 버튼이 없다', async () => {
    renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByTestId('help-messages')).toHaveTextContent('공동현관 비밀번호가 틀려요');
    expect(screen.queryByRole('button', { name: '가리기' })).not.toBeInTheDocument();
  });
});

describe('상담함 — 배송 도움요청과 일반 문의를 한 목록에(사용자 2026-11-19)', () => {
  it('두 종류가 함께 보이고 배송 도움요청이 먼저, 누르면 각자 대화로', async () => {
    renderAt('/consults', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    const kinds = rows.map((r) => r.getAttribute('data-kind'));
    expect(kinds).toContain('help');
    expect(kinds).toContain('inquiry');
    expect(kinds.indexOf('inquiry')).toBeGreaterThan(kinds.lastIndexOf('help'));
    expect(rows[0]).toHaveTextContent('배송 도움요청');
    const inquiry = rows.find((r) => r.getAttribute('data-kind') === 'inquiry')!;
    expect(inquiry).toHaveTextContent('일반 문의');
    expect(within(inquiry).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/inquiries\//));
  });
});

describe('상담 화면에서 바로 배송 조치(사용자 2026-11-19 "배송찾기에서 운영조치로 해줘야 하게 불편하게")', () => {
  it('전달 불가 신고가 들어온 배송은 상담 화면에서 반려할 수 있다 — 배송 상세와 같은 요청', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '전달 실패 확정·반려' });
    await userEvent.click(within(form).getByLabelText('반려'));
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    expect(await within(form).findByTestId('action-result')).toHaveTextContent('반영했어요.');
    const post = sentTo(view.sent, '/failure-decisions')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(((await post.clone().json()) as { decision: string }).decision).toBe('REJECT');
  });
});

describe('반려 직후 "직접 실패 처리"가 같은 자리에 떠도 두 번 눌림으로 확정되지 않는다(28767701-1, 사용자 2026-11-19)', () => {
  it('직접 실패 처리는 확인 칸을 체크해야 보낼 수 있다', async () => {
    // 반려되면 서버가 픽업으로 되돌린다 — 그 뒤 상태를 흉내
    server.use(http.get(`${API_BASE}/deliveries/DLV-1`, () => HttpResponse.json({ ...mockDeliveries[0]!, state: 'PICKED_UP', failure: null })));
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    const direct = await screen.findByRole('form', { name: '지원센터 직접 실패 처리' });
    const send = within(direct).getByRole('button', { name: '보내기' });
    expect(send).toBeDisabled();
    await userEvent.click(send); // 두 번째 눌림 자리 — 아무것도 보내지 않는다
    expect(sentTo(view.sent, '/failure-decisions')).toHaveLength(0);
    await userEvent.click(within(direct).getByRole('checkbox'));
    expect(send).toBeEnabled();
  });
});

describe('전달 실패 결정 전에는 상담 완료를 막고, 결정 대기 배송은 상담함에 남는다(사용자 2026-11-19 "지원센터에서 처리해버리면 반려해달라고 해도 연락이 안 가지고")', () => {
  it('결정 대기(FAILURE_REPORTED) 배송의 도움요청은 상담 완료가 막히고 이유가 보인다', async () => {
    renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByTestId('resolve-decide-first')).toHaveTextContent('전달 실패 결정 먼저');
    expect(screen.getByRole('button', { name: '상담 완료' })).toBeDisabled();
  });

  it('상담이 끝났어도 결정 대기·재개 요청 배송은 상담함 맨 위에 "라이더 재개 요청"으로', async () => {
    server.use(
      http.get(`${API_BASE}/delivery-help-requests`, () => HttpResponse.json({ items: [] })),
      http.get(`${API_BASE}/deliveries`, ({ request }) =>
        new URL(request.url).searchParams.get('state') === 'FAILURE_REPORTED'
          ? HttpResponse.json({ items: [{ deliveryId: 'DLV-1', riderId: 'RD-7', state: 'FAILURE_REPORTED', resumeRequestedAt: '2026-11-19T08:45:00.000Z', createdAt: '2026-11-19T08:00:00.000Z' }], page: { nextCursor: null } })
          : HttpResponse.json({ items: [], page: { nextCursor: null } }),
      ),
    );
    renderAt('/consults', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    expect(rows[0]).toHaveAttribute('data-kind', 'failure');
    expect(rows[0]).toHaveTextContent('라이더 재개 요청');
    expect(within(rows[0]!).getByRole('link', { name: '전달 불가 신고 — 확정·반려 기다림' })).toHaveAttribute('href', '/deliveries/DLV-1');
  });
});

describe('처리함 — 기다린 시간 색은 우리 차례인 건만(사용자 2026-11-21)', () => {
  it('답변한 일반 문의는 기다린 시간이 회색, 답을 기다리는 문의는 색', async () => {
    renderAt('/consults', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    const inquiries = rows.filter((r) => r.getAttribute('data-kind') === 'inquiry');
    const waitTone = (r: HTMLElement) => r.querySelector('td:last-child .pm-status')?.getAttribute('data-tone');
    const answered = inquiries.find((r) => r.textContent?.includes('답변함'))!;
    const received = inquiries.find((r) => r.textContent?.includes('답 기다림'))!;
    expect(waitTone(answered)).toBe('ghost');
    expect(waitTone(received)).not.toBe('ghost');
  });
});

describe('상담함 — 도움요청 여러 쪽', () => {
  it('서버가 오래된 것부터 50건씩 줘도 다음 쪽까지 읽어 최근 끝난 건이 끝남 탭에 보이고, 최근 7일만 묻는다', async () => {
    const asked: URLSearchParams[] = [];
    const item = (i: number) => ({ requestId: `HR-P${i}`, deliveryId: `DLV-P${i}`, riderId: 'RD-7', category: 'ADDRESS_ISSUE', state: 'RESOLVED', createdAt: `2026-11-20T0${i}:00:00.000Z` });
    server.use(
      http.get(`${API_BASE}/delivery-help-requests`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        asked.push(q);
        return q.get('cursor') === 'c2'
          ? HttpResponse.json({ items: [item(2)], page: { nextCursor: null } })
          : HttpResponse.json({ items: [item(1)], page: { nextCursor: 'c2' } });
      }),
    );
    renderAt('/consults?tab=done', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    const help = rows.filter((r) => r.getAttribute('data-kind') === 'help');
    expect(help).toHaveLength(2);
    expect(help.flatMap((r) => [...r.querySelectorAll('a')].map((a) => a.getAttribute('href')))).toContain('/help-requests/DLV-P2/HR-P2');
    // 머리줄 급한 건 수(OPEN)는 따로 묻는다 — 끝남 탭이 물은 것만 본다
    const done = asked.filter((q) => q.get('state') === 'RESOLVED');
    expect(done.map((q) => q.get('cursor'))).toEqual([null, 'c2']);
    expect(done.every((q) => !!q.get('from'))).toBe(true);
  });
});

describe('상담함 — 찾기·주문번호·소명·이의 탭(2026-11-20)', () => {
  it('줄마다 주문번호가 보이고, 주문번호로 찾으면 그 배송 상담만 남는다', async () => {
    // 번호 묶음 조회(GET /deliveries?deliveryIds=) — DLV-1 만 주문번호가 48213075
    server.use(
      http.get(`${API_BASE}/deliveries`, ({ request }) => {
        const ids = (new URL(request.url).searchParams.get('deliveryIds') ?? '').split(',').filter(Boolean);
        return HttpResponse.json({ items: ids.map((id, i) => ({ deliveryId: id, state: 'PICKED_UP', deliveryNumber: id === 'DLV-1' ? '48213075-1' : `5000000${i}-1`, orderNumber: id === 'DLV-1' ? '48213075' : `5000000${i}` })), page: { nextCursor: null } });
      }),
    );
    renderAt('/consults', as.riderOps);
    // 번호는 목록 뒤에 따로 온다
    await waitFor(() => expect(screen.getAllByTestId('consult-order').map((o) => o.textContent)).toContain('48213075'));
    const before = (await screen.findAllByTestId('consult-row')).length;
    await userEvent.type(screen.getByRole('searchbox'), '48213075');
    await userEvent.click(within(screen.getByTestId('consults-search')).getByRole('button', { name: '찾기' }));
    const rows = await screen.findAllByTestId('consult-row');
    expect(rows.length).toBeLessThan(before);
    expect(rows.every((r) => within(r).getByTestId('consult-order').textContent === '48213075')).toBe(true);
  });

  it('맞는 게 없으면 "맞는 상담이 없어요"(수고하셨어요가 아니라)', async () => {
    renderAt('/consults?q=없는번호', as.riderOps);
    expect(await screen.findByTestId('consults-empty')).toHaveTextContent('"없는번호"에 맞는 상담이 없어요.');
    expect(screen.queryByTestId('consults-all-done')).not.toBeInTheDocument();
  });

  it('소명·이의는 상담함 탭 — 옛 주소 /appeals 는 조건을 들고 그 탭으로', async () => {
    renderAt('/appeals?state=UPHELD', as.riderOps);
    expect(await screen.findByRole('heading', { name: '처리함' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '소명·이의' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('상담함 — 읽기 상한(2026-11-20 PC 1 리뷰 후속)', () => {
  it('20쪽을 읽고도 다음 쪽이 남으면 "최근 것 일부를 불러오지 못했어요"와 "N건 이상"', async () => {
    let n = 0;
    server.use(
      http.get(`${API_BASE}/delivery-help-requests`, ({ request }) => {
        if (new URL(request.url).searchParams.get('state') !== 'RESOLVED') return HttpResponse.json({ items: [], page: { nextCursor: null } });
        n += 1;
        return HttpResponse.json({ items: [{ requestId: `HR-T${n}`, deliveryId: `DLV-T${n}`, riderId: 'RD-7', category: 'ADDRESS_ISSUE', state: 'RESOLVED', createdAt: '2026-11-20T01:00:00.000Z' }], page: { nextCursor: `c${n}` } });
      }),
    );
    renderAt('/consults?tab=done', as.riderOps);
    expect(await screen.findByTestId('consults-truncated', {}, { timeout: 5_000 })).toHaveTextContent('최근 것 일부를 불러오지 못했어요');
    expect(screen.getByTestId('result-count')).toHaveTextContent('건 이상');
    expect(n).toBe(20);
  });
});
