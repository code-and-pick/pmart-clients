// 쿠팡 윙 레퍼런스 패턴(2026-11-19 사용자 "레퍼런스만 참고해서 전부 적용")
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/server';
import { as, renderAt } from '../test/render';

describe('실시간 배송 두 줄 카드', () => {
  it('"먼저 확인하고 처리해 주세요"와 "배송 진행 단계" — 단계 카드를 누르면 그 상태로', async () => {
    const user = userEvent.setup();
    renderAt('/live-delivery', as.admin);
    expect(await screen.findByRole('region', { name: '먼저 확인하고 처리해 주세요' })).toBeInTheDocument();
    const flow = await screen.findByTestId('live-flow');
    expect(within(flow).getAllByRole('button')).toHaveLength(5);
    await user.click(screen.getByTestId('live-flow-PICKED_UP'));
    await waitFor(() => expect(screen.getByTestId('live-flow-PICKED_UP')).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('할 일 0건 "수고하셨어요" 띠', () => {
  it('접수 건 할 일 탭이 서버 0건이면 띠, 빈 안내는 겹치지 않는다', async () => {
    server.use(http.get('*/api/v1/backoffice/views/case-inbox', () => HttpResponse.json({ items: [], page: { nextCursor: null }, sources: [], unavailableSources: [] })));
    renderAt('/cases?tab=unassigned', as.riderOps);
    expect(await screen.findByTestId('cases-all-done')).toHaveTextContent('수고하셨어요');
  });

  it('조회 실패면 띠를 그리지 않는다(0건으로 보이지 않게)', async () => {
    server.use(http.get('*/api/v1/backoffice/views/case-inbox', () => HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503 })));
    renderAt('/cases?tab=unassigned', as.riderOps);
    await waitFor(() => expect(screen.queryAllByText(/불러오지 못했어요|다시 시도/).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('cases-all-done')).not.toBeInTheDocument();
  });
});

describe('검색 조건 칩', () => {
  it('조건을 건 채 열면 한 줄 칩으로 접혀 있고, "검색 열기"로 펼친다', async () => {
    const user = userEvent.setup();
    renderAt('/claims?state=STOP_PENDING&type=CANCEL', as.cs);
    const chips = await screen.findAllByTestId('search-chip');
    expect(chips.map((c) => c.textContent)).toEqual([expect.stringContaining('전체'), expect.stringContaining('취소'), expect.stringContaining('출고 중지 대기')]);
    expect(document.querySelector('form[aria-label="검색 조건"]')).not.toBeVisible();
    await user.click(screen.getByTestId('search-toggle'));
    expect(screen.getByRole('form', { name: '검색 조건' })).toBeVisible();
  });

  it('조건이 없으면 처음부터 펼쳐 둔다', async () => {
    renderAt('/claims', as.cs);
    expect(await screen.findByRole('form', { name: '검색 조건' })).toBeVisible();
  });
});

describe('상품 등록 방식 고르기', () => {
  it('다섯 카드(사진·설명 등록 더함, 2026-11-19) — 일괄 등록은 그 화면으로', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    const chooser = await screen.findByTestId('start-chooser');
    expect(within(chooser).getByRole('heading', { name: '어떤 방식으로 등록하시겠어요?' })).toBeInTheDocument();
    expect(within(chooser).getAllByRole('button')).toHaveLength(5);
    await user.click(screen.getByTestId('start-import'));
    expect(await screen.findByTestId('upload-caution')).toBeInTheDocument();
  });
});

describe('접수 건 일괄 맡기', () => {
  it('맡을 수 있는 줄을 골라 "선택한 건 내가 맡기" — 건마다 다시 읽은 version·각자의 Idempotency-Key', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cases?tab=unassigned', as.riderOps);
    const bar = await screen.findByTestId('case-bulk-bar');
    const boxes = await screen.findAllByRole('checkbox', { name: /고르기$/ });
    const rows = boxes.filter((b) => b.getAttribute('aria-label') !== '맡을 수 있는 줄 모두 고르기').slice(0, 2);
    for (const b of rows) await user.click(b);
    expect(bar).toHaveTextContent('2개 선택됨');
    await user.click(screen.getByTestId('case-bulk-pick'));
    expect(await screen.findByTestId('case-bulk-result')).toHaveTextContent(/맡았어요/);
    const posts = view.sent.filter((q) => q.method === 'POST' && new URL(q.url).pathname.endsWith('/assignments'));
    expect(posts).toHaveLength(2);
    const keys = posts.map((p) => p.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(2);
    for (const p of posts) expect(p.headers.get('X-Expected-Version')).toMatch(/^\d+$/);
  });
});
