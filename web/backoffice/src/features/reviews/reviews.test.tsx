// 리뷰 신고 확인(review 0.7.0 BR-90)·FAQ 답 의견(customer-assistant 0.4.0 BR-91) — 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { helpfulRate } from './FaqFeedbackPage';

const posts = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

describe('리뷰 신고', () => {
  it('확인 전: 최근 신고 순, 사유별 수·기타 글 — 숨김은 줄 안에서 한 번 더 묻고 멱등키로 보내면 처리 끝으로', async () => {
    const user = userEvent.setup();
    const view = renderAt('/review-reports', as.cs);
    const rows = await screen.findAllByTestId('review-report');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('신고 4건');
    expect(rows[0]).toHaveTextContent('욕설·비방 3');
    expect(rows[0]).toHaveTextContent('직원 욕을 써 놨어요');
    await user.type(within(rows[0]!).getByLabelText(/처리 메모/), '욕설 확인');
    await user.click(within(rows[0]!).getByRole('button', { name: '숨김' }));
    const ask = within(rows[0]!).getByRole('group', { name: '처리 확인' });
    expect(ask).toHaveTextContent('별점에서 빠져요');
    await user.click(within(ask).getByRole('button', { name: '숨김' }));
    await waitFor(() => expect(screen.getAllByTestId('review-report')).toHaveLength(1));
    const post = posts(view.sent, '/review-reports/RV-MOCK-1/resolutions')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ action: 'HIDE', note: '욕설 확인' });
    await user.click(screen.getByRole('tab', { name: '처리 끝' }));
    const done = (await screen.findAllByTestId('review-report')).find((r) => r.textContent?.includes('신고 4건'))!;
    expect(within(done).getByTestId('review-report-result')).toHaveTextContent('숨김');
    expect(done).toHaveTextContent('지금 숨김');
  });

  it('다른 직원이 먼저 처리(409 NO_OPEN_REPORTS)하면 목록을 다시 읽는다', async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API_BASE}/review-reports/:reviewId/resolutions`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'NO_OPEN_REPORTS' }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    const view = renderAt('/review-reports', as.admin);
    const row = (await screen.findAllByTestId('review-report'))[1]!;
    await user.click(within(row).getByRole('button', { name: '문제없음' }));
    await user.click(within(within(row).getByRole('group', { name: '처리 확인' })).getByRole('button', { name: '문제없음' }));
    await waitFor(() => expect(view.sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/review-reports')).length).toBeGreaterThan(1));
  });

  it('줄의 리뷰 글을 누르면 상세(0.8.0) — 글 전체·사진·신고 한 건씩(최근 순), 신고자는 없다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/review-reports', as.cs);
    const rows = await screen.findAllByTestId('review-report');
    await user.click(within(rows[0]!).getByTestId('review-report-text'));
    const detail = await screen.findByTestId('review-report-detail');
    expect(screen.getByRole('heading', { name: '김*수 님 리뷰 — 신고 4건' })).toBeInTheDocument();
    expect(within(detail).getByTestId('review-report-full-text')).toHaveTextContent('이딴 걸 팔다니 ○○ 같은 가게');
    const items = within(detail).getAllByTestId('review-report-item');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('욕설·비방');
    expect(items[1]).toHaveTextContent('기타');
    expect(items[1]).toHaveTextContent('직원 욕을 써 놨어요');
    expect(detail).toHaveTextContent('신고한 고객은 보이지 않아요.');
    expect(within(detail).getByTestId('review-report-open-count')).toHaveTextContent('확인 전 신고 4건');
    // 사진은 토큰을 붙여 받아 blob 으로 그린다(<img src> 에 서버 주소를 바로 넣지 않는다)
    await waitFor(() => expect(within(detail).getAllByRole('img', { name: /리뷰 사진/ })).toHaveLength(2));
    const imgs = within(detail).getAllByRole('img', { name: /리뷰 사진/ });
    expect(imgs[0]!.getAttribute('src')).not.toContain('/review-photos/');
    const photoReq = view.sent.find((r) => new URL(r.url).pathname.endsWith('/review-photos/RPH-MOCK-1'))!;
    expect(photoReq.headers.get('Authorization')).toMatch(/^Bearer /);
  });

  it('상세에서 숨김 — 확인 전 신고가 모두 처리 끝(메모·처리 직원), 처리 단추는 사라진다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/review-reports/RV-MOCK-2', as.admin);
    const detail = await screen.findByTestId('review-report-detail');
    await user.type(within(detail).getByLabelText(/처리 메모/), '광고 링크');
    await user.click(within(detail).getByRole('button', { name: '숨김' }));
    await user.click(within(within(detail).getByRole('group', { name: '처리 확인' })).getByRole('button', { name: '숨김' }));
    expect(await screen.findByTestId('review-report-nothing-open')).toBeInTheDocument();
    expect(posts(view.sent, '/review-reports/RV-MOCK-2/resolutions')[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    const items = screen.getAllByTestId('review-report-item');
    expect(items.every((i) => i.dataset['state'] === 'RESOLVED')).toBe(true);
    expect(items[0]).toHaveTextContent('광고 링크');
    expect(screen.getByTestId('review-report-detail')).toHaveTextContent('지금 숨김');
    expect(screen.queryByRole('button', { name: '숨김' })).not.toBeInTheDocument();
  });

  it('처리 끝 리뷰는 처리 단추 없이 결과·메모만, 없는 리뷰(404)는 다시 시도 대신 "찾을 수 없어요"', async () => {
    const view = renderAt('/review-reports/RV-MOCK-3', as.cs);
    const detail = await screen.findByTestId('review-report-detail');
    expect(within(detail).getByTestId('review-report-nothing-open')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: '문제없음' })).not.toBeInTheDocument();
    expect(within(detail).getByTestId('review-report-item')).toHaveTextContent('상품 이야기라 그대로 둠');
    view.unmount();
    renderAt('/review-reports/RV-NONE', as.cs);
    expect(await screen.findByText(/이 리뷰의 신고를 찾을 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다시/ })).not.toBeInTheDocument();
  });

  it('사진을 못 열면(404) 빈칸이 아니라 "불러오지 못했어요"', async () => {
    server.use(http.get(`${API_BASE}/review-photos/:photoId`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND' }, { status: 404, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/review-reports/RV-MOCK-1', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('review-photo-error')).toHaveLength(2));
    expect(screen.getAllByTestId('review-photo-error')[0]).toHaveTextContent('사진을 불러오지 못했어요.');
  });

  it('메뉴는 상담원·관리자만 — 라이더 운영에게는 없다', async () => {
    const view = renderAt('/session', as.cs);
    expect(await screen.findByRole('link', { name: '리뷰 신고', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FAQ 답 의견', hidden: true })).toBeInTheDocument();
    view.unmount();
    renderAt('/session', as.riderOps);
    await screen.findByTestId('side-menu');
    expect(screen.queryByRole('link', { name: '리뷰 신고', hidden: true })).not.toBeInTheDocument();
  });
});

describe('FAQ 답 의견', () => {
  it('서버 순서 그대로, 도움 비율은 표시만(분모 0 이면 —), 없어진 FAQ 는 "지금 FAQ 에 없음"', async () => {
    renderAt('/faq-feedback', as.cs);
    const rows = await screen.findAllByTestId('faq-feedback-row');
    expect(rows.map((r) => within(r).getByTestId('faq-feedback-rate').textContent)).toEqual(['25%', '0%', '85.7%', '—']);
    expect(rows[0]).toHaveTextContent('환불은 언제 들어오나요?');
    expect(rows[0]).toHaveTextContent('환불');
    expect(rows[2]).toHaveTextContent('주문 취소'); // 분류 이름 = 서버 categoryTitle(0.4.1)
    expect(rows[3]).toHaveTextContent('배송 현황·지연·예약 시간');
    expect(rows[1]).toHaveTextContent('지금 FAQ 에 없음');
    expect(helpfulRate(0, 0)).toBe('—');
  });

  it('못 읽으면 0 건이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/customer-assistant/faq-feedback`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/faq-feedback', as.admin);
    expect(await screen.findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(screen.queryByText('아직 받은 의견이 없어요.')).not.toBeInTheDocument();
  });
});
