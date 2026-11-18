// 왼쪽 메뉴 업무 알림(2026-11-18 사용자 — "메뉴는 전처럼, 거기에 업무 알람") — 알림이 떠 있는 화면
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE, BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const page = (n: number, more = false) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `X-${i}` })), page: { nextCursor: more ? 'NEXT' : null, size: 50 } });
// 다시 시도하지 않는 실패(403)로 — 503 은 공통 규칙대로 몇 번 다시 묻느라 오래 걸린다
const fail = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

/** 알림이 떠 있는 상태: 안 맡음 4·기한 지남 2, 승인 대기 3, 고객 문의 2, 라이더 문의 1, 처리 대기 5 */
function busy() {
  server.use(
    http.get(`${API_BASE}/cases`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      if (q.get('unassigned') === 'true') return HttpResponse.json(page(4));
      if (q.get('overdue') === 'true') return HttpResponse.json(page(2));
      return HttpResponse.json(page(0));
    }),
    http.get(`${API_BASE}/approvals`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('reviewState') === 'REVIEW_PENDING' ? page(3) : page(0))),
    http.get(`${API_BASE}/inquiries`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      if (q.get('status') !== 'RECEIVED') return HttpResponse.json(page(0));
      return HttpResponse.json(q.get('requesterType') === 'RIDER' ? page(1) : page(2));
    }),
    http.get(`${BFF_BASE}/views/pending-work`, () => HttpResponse.json({ sources: [], unavailableSources: [], items: Array.from({ length: 5 }, (_, i) => ({ kind: 'X', refId: `P-${i}` })), truncated: false })),
  );
}

const groupAlert = (id: string) => within(screen.getByTestId(`nav-group-${id}`).querySelector('summary')!).queryByTestId('menu-alert-group');

describe('왼쪽 메뉴 업무 알림', () => {
  it('관리자: 접혀 있는 묶음 이름 옆에 합계(기한 지난 것이 있으면 빨강), 펼치면 메뉴마다 배지', async () => {
    busy();
    const user = userEvent.setup();
    renderAt('/session', as.admin);
    await screen.findByTestId('nav-group-support');
    // 지원센터: 안 맡음 4 + 라이더 문의 1 = 5, 기한 지남이 있어 빨강
    expect(await within(screen.getByTestId('nav-group-support')).findByTestId('menu-alert-group')).toHaveTextContent('5');
    expect(groupAlert('support')).toHaveClass('badge-error');
    expect(await within(screen.getByTestId('nav-group-approval')).findByTestId('menu-alert-group')).toHaveTextContent('3');
    expect(groupAlert('approval')).toHaveClass('badge-info');
    expect(await within(screen.getByTestId('nav-group-cs')).findByTestId('menu-alert-group')).toHaveTextContent('2');
    expect(await within(screen.getByTestId('nav-group-pending')).findByTestId('menu-alert-group')).toHaveTextContent('5');
    expect(groupAlert('catalog')).toBeNull(); // 할 일 성격이 아닌 묶음은 알림 없음
    expect(groupAlert('audit')).toBeNull();

    // 펼치면 합계 대신 메뉴마다
    await user.click(within(screen.getByTestId('nav-group-support')).getByText('지원센터'));
    expect(groupAlert('support')).toBeNull();
    expect(screen.getByTestId('menu-alert-casesUnassigned')).toHaveTextContent('4');
    expect(screen.getByTestId('menu-alert-casesOverdue')).toHaveTextContent('2');
    expect(screen.getByTestId('menu-alert-riderInquiries')).toHaveTextContent('1');
    expect(screen.getByTestId('menu-alert-riderInquiries')).toHaveAttribute('title', '답변 대기 라이더 문의');
    // 메뉴 링크 이름에는 숫자가 섞이지 않는다
    expect(screen.getByRole('link', { name: '접수 건' })).toBeInTheDocument();
  });

  it('지금 화면의 묶음은 펼쳐져 있어 메뉴 배지로 — 승인함 화면에서 "승인함 3"', async () => {
    busy();
    renderAt('/approvals', as.approver);
    expect(await screen.findByTestId('menu-alert-approvals')).toHaveTextContent('3');
  });

  it('상담원: 문의 답변 배지는 있고, 접수 건(보기만)은 묻지도 않는다', async () => {
    busy();
    const view = renderAt('/inquiries', as.cs);
    expect(await screen.findByTestId('menu-alert-inquiries')).toHaveTextContent('2');
    expect(screen.queryByTestId('menu-alert-casesUnassigned')).not.toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('unassigned') === 'true')).toBe(false);
  });

  it('못 읽으면 0 이 아니라 "?", 50건이 넘으면 "50+"', async () => {
    busy();
    server.use(
      http.get(`${API_BASE}/approvals`, () => fail()),
      http.get(`${API_BASE}/inquiries`, () => HttpResponse.json(page(50, true))),
    );
    renderAt('/session', as.admin); // 목록 화면은 열지 않는다(가짜 줄로 화면을 그리지 않게) — 접힌 묶음 합계로 본다
    expect(await within(screen.getByTestId('nav-group-cs')).findByTestId('menu-alert-group')).toHaveTextContent('50+');
    expect(await within(screen.getByTestId('nav-group-approval')).findByTestId('menu-alert-group')).toHaveTextContent('?');
  });
});
