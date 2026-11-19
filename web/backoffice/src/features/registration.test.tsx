import { pick } from '../test/pick';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { db } from '../mocks/db';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

describe('상품 등록 → 승인 요청 → 승인 → 반영', () => {
  it('초안 저장·제출 준비·승인 요청이 각각 멱등 키를 갖고, 승인 뒤 SKU 가 발급된다', async () => {
    const user = userEvent.setup();
    const md = renderAt('/products/drafts/new');

    await user.type((await screen.findByLabelText('관리용 명칭')), '테스트 사과');
    await pick(user, '대표 카테고리', '과일·채소 > 과일 > 사과·배', '사과'); // 쳐서 찾는 고르기(2026-11-19)
    await user.type(screen.getByLabelText('중량(g)'), '1000');
    await user.selectOptions(screen.getByLabelText('보관 방식'), 'CHILLED');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    expect(await screen.findByTitle('VALID')).toHaveTextContent('검증 통과');
    await user.click(screen.getByRole('button', { name: '제출 준비(잠그기)' }));
    await user.click(await screen.findByRole('button', { name: '승인 요청' }));
    expect(await screen.findByText(/승인 요청을 올렸어요/)).toBeInTheDocument();

    const keys = [...md.mutations('/product-drafts'), ...md.mutations('/change-requests')].map((r) =>
      r.headers.get('Idempotency-Key'),
    );
    expect(keys).toHaveLength(4);
    expect(keys.every((k) => k && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(4);
    expect(md.sent.every((r) => r.method === 'GET' || r.headers.get('X-Source-System') === 'backoffice-web')).toBe(true);
    md.stop();
    md.unmount();

    // 승인자
    const approvalId = [...db.approvals.keys()].find((id) => id.startsWith('apv-1'));
    expect(approvalId).toBeDefined();
    renderAt(`/approvals/${approvalId}`, as.approver);
    await user.click(await screen.findByRole('button', { name: '승인' }));
    expect(await screen.findByText(/결정을 기록했어요/)).toBeInTheDocument();
    // 심사와 실행은 다른 축이다: 심사 완료 뒤 실행 완료는 따로 확인된다.
    await waitFor(() => expect(screen.getByTestId('review-state')).toHaveTextContent('심사 완료(승인)'));
    await waitFor(() => expect(screen.getByTestId('execution-state')).toHaveTextContent('반영 완료'));

    const draft = [...db.productDrafts.values()][0];
    expect(draft?.state).toBe('APPLIED');
    expect(draft?.resultSkus?.[0]).toMatch(/^E-\d{8}$/);
  });

  it('자기 요청 — 서버가 결정 못 함(SELF_APPROVAL)이라 하면 버튼을 끄고 안내(AP-3, 2026-11-18)', async () => {
    const seeded = db.approvals.get('apv-seed-price-1');
    db.approvals.set('apv-seed-price-1', { ...seeded, requesterId: 'op-approver-1' });
    renderAt('/approvals/apv-seed-price-1', as.approver);

    expect(await screen.findByText('자기 요청은 승인할 수 없어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '반려' })).toBeDisabled();
  });

  it('옛 서버(판정 값 없음)면 자기 요청도 누를 수 있고, 서버 FORBIDDEN 을 그대로 보여 준다', async () => {
    const user = userEvent.setup();
    const seeded = db.approvals.get('apv-seed-price-1');
    db.approvals.set('apv-seed-price-1', { ...seeded, requesterId: 'op-approver-1' });
    server.use(http.get(`${API_BASE}/approvals/:id`, () => HttpResponse.json(db.approvals.get('apv-seed-price-1')))); // viewerCanDecide 없음
    renderAt('/approvals/apv-seed-price-1', as.approver);

    expect(await screen.findByText('자기 요청은 승인할 수 없어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '승인' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'FORBIDDEN');
    expect(screen.getByTestId('review-state')).toHaveTextContent('심사 대기');
  });

  it('검증 실패 초안은 사유를 보여 주고 제출 준비를 막는다', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new');
    await user.type(screen.getByLabelText('관리용 명칭'), '중량 없는 상품');
    await pick(user, '대표 카테고리', /^과일·채소$/); // 쳐서 찾는 고르기(2026-11-19)
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    expect(await screen.findByTitle('INVALID')).toHaveTextContent('검증 오류');
    const problems = screen.getByRole('list', { name: '검증 문제' });
    expect(within(problems).getByText('SKU 1 · 중량이 필요해요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제출 준비(잠그기)' })).toBeDisabled();
  });
});

describe('결과 불명', () => {
  it('초안 저장이 5xx 면 실패로 확정하지 않고, 다시 확인은 같은 키·같은 본문으로 보낸다', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/product-drafts`, () => {
        calls++;
        return calls === 1 ? new HttpResponse('<html>', { status: 502, headers: { 'content-type': 'text/html' } }) : undefined;
      }),
    );
    const view = renderAt('/products/drafts/new');
    await user.type(screen.getByLabelText('관리용 명칭'), '불명 테스트');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.queryByText('요청이 거절됐어요')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초안 저장' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByText('상품 초안')).toBeInTheDocument();

    const posts = view.mutations('/product-drafts');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers.get('Idempotency-Key')).toBe(posts[1]?.headers.get('Idempotency-Key'));
    expect(await posts[0]?.text()).toBe(await posts[1]?.text());
    view.stop();
  });
});

describe('카테고리 트리', () => {
  it('발효된 트리가 없으면 오류가 아니라 등록 안내를 보여 준다', async () => {
    db.tree = null;
    renderAt('/categories');
    expect(await screen.findByText(/발효된 카테고리 트리가 없어요/)).toBeInTheDocument();
    expect(screen.queryByText('정보를 불러오지 못했어요')).not.toBeInTheDocument();
  });

  it('노드를 고르면 필터 패널을 보여 준다', async () => {
    const user = userEvent.setup();
    renderAt('/categories');
    await user.click(await screen.findByRole('button', { name: '과일 (p01-c01)' }));
    const group = await screen.findByTestId('filter-group');
    expect(group).toHaveTextContent('원산지');
    expect(group).toHaveTextContent('여러 개 선택'); // selectionMode MULTIPLE
  });
});
