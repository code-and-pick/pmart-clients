// 승인함 일괄 심사(2026-11-26 사용자 "하나하나 보고 승인하기 귀찮으니까") — 고른 건마다 결정 명령을 차례로, 결과는 건별로
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const summary = (n: number, extra: Record<string, unknown> = {}) => ({
  approvalId: `APV-${n}`,
  type: 'PRICE',
  summary: `가격 요청 ${n}`,
  requesterId: 'op-md-1',
  reviewState: 'REVIEW_PENDING',
  executionState: 'NOT_REQUESTED',
  submittedAt: '2026-11-26T00:00:00Z',
  viewerCanDecide: true,
  ...extra,
});

const problem = (status: number, code: string) => HttpResponse.json({ type: 'about:blank', title: code, status, code }, { status, headers: { 'content-type': 'application/problem+json' } });

describe('승인함 일괄 심사', () => {
  it('고른 것 승인: 건마다 다시 읽어 version 으로 보내고, 이미 끝난 건은 건너뛰고, 거절은 사유 — 안 된 것 다시는 같은 키', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    // 상세: APV-1 심사 중(v2), APV-2 그사이 다른 사람이 승인, APV-3 심사 중(v5)
    const state: Record<string, { reviewState: string; version: number; decisions: unknown[] }> = {
      'APV-1': { reviewState: 'REVIEW_PENDING', version: 2, decisions: [] },
      'APV-2': { reviewState: 'APPROVED', version: 4, decisions: [{ decision: 'APPROVE', approverId: 'someone-else' }] },
      'APV-3': { reviewState: 'REVIEW_PENDING', version: 5, decisions: [] },
    };
    let failThree = true;
    server.use(
      http.get(`${API_BASE}/approvals`, () => HttpResponse.json({ items: [summary(1), summary(2), summary(3), summary(4, { viewerCanDecide: false, viewerDecideBlockedReason: 'SELF_APPROVAL' })], page: { nextCursor: null, size: 50 } })),
      http.get(`${API_BASE}/approvals/:id`, ({ params }) => {
        const id = String(params['id']);
        const s = state[id]!;
        return HttpResponse.json({ ...summary(Number(id.slice(4))), ...s, viewerCanDecide: s.reviewState === 'REVIEW_PENDING' });
      }),
      http.post(`${API_BASE}/approvals/:id/decisions`, ({ params, request }) => {
        const id = String(params['id']);
        if (id === 'APV-3' && failThree) return problem(409, 'VERSION_CONFLICT');
        state[id] = { reviewState: 'APPROVED', version: state[id]!.version + 1, decisions: [{ decision: 'APPROVE', approverId: 'op-admin-1' }] };
        return HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key'), resultId: `dec-${id}` }, { status: 202 });
      }),
    );
    const view = renderAt('/approvals', as.admin);
    await screen.findAllByTestId('approval-row');
    // 내가 결정할 수 없는 줄(내 요청)에는 고르기 칸이 없다
    expect(screen.getAllByTestId('approval-pick')).toHaveLength(3);
    await user.click(screen.getByRole('checkbox', { name: '심사할 수 있는 것 모두 고르기' }));
    expect(screen.getByTestId('batch-bar')).toHaveTextContent('3건 골랐어요');
    await user.click(screen.getByRole('button', { name: '고른 것 승인' }));
    // 확인: 무엇을 승인하는지 목록
    const confirm = screen.getByTestId('batch-confirm');
    expect(confirm).toHaveTextContent('3건을 승인할까요?');
    expect(confirm).toHaveTextContent('가격 요청 1');
    expect(confirm).toHaveTextContent('가격 요청 3');
    expect(view.mutations('/decisions')).toHaveLength(0); // 확인 전에는 안 보냄
    await user.type(within(confirm).getByLabelText(/의견/), '이번 주 가격 일괄');
    await user.click(within(confirm).getByRole('button', { name: '3건 승인하기' }));

    const results = await screen.findByTestId('batch-results');
    await waitFor(() => expect(results).toHaveTextContent('3건 중 1건 처리했어요'));
    const items = within(results).getAllByTestId('batch-result');
    expect(items[0]).toHaveTextContent('승인함'); // ACCEPTED 뒤 다시 읽어 나의 결정 확인
    expect(items[1]).toHaveTextContent('이미 심사가 끝남 — 건너뜀');
    expect(items[2]).toHaveTextContent('못 했어요');
    // 보낸 것: APV-1·APV-3 만, 상세에서 읽은 version 으로, 의견은 모두에
    const sent = view.mutations('/decisions');
    expect(sent.map((r) => /approvals\/([^/]+)\/decisions/.exec(new URL(r.url).pathname)?.[1])).toEqual(['APV-1', 'APV-3']);
    expect(sent[0]!.headers.get('X-Expected-Version')).toBe('2');
    expect(sent[1]!.headers.get('X-Expected-Version')).toBe('5');
    expect(await sent[0]!.clone().json()).toEqual({ decision: 'APPROVE', comment: '이번 주 가격 일괄' });
    const firstKey = sent[1]!.headers.get('Idempotency-Key');

    // 안 된 것만 다시 — 같은 키
    failThree = false;
    await user.click(within(results).getByRole('button', { name: '안 된 1건 다시' }));
    await waitFor(() => expect(results).toHaveTextContent('3건 중 2건 처리했어요'));
    const again = view.mutations('/decisions');
    expect(again).toHaveLength(3); // APV-1 은 다시 보내지 않음
    expect(again[2]!.headers.get('Idempotency-Key')).toBe(firstKey);
  });

  it('고른 것 반려 — 취소하면 아무것도 안 보내고, 고르기 풀기로 띠가 사라진다', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_BASE}/approvals`, () => HttpResponse.json({ items: [summary(1), summary(2)], page: { nextCursor: null, size: 50 } })));
    const view = renderAt('/approvals', as.admin);
    await user.click(await screen.findByRole('checkbox', { name: '가격 요청 2 고르기' }));
    await user.click(screen.getByRole('button', { name: '고른 것 반려' }));
    expect(screen.getByTestId('batch-confirm')).toHaveTextContent('1건을 반려할까요?');
    expect(screen.getByRole('button', { name: '1건 반려하기' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(view.mutations('/decisions')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '고르기 풀기' }));
    expect(screen.queryByTestId('batch-bar')).not.toBeInTheDocument();
  });

  it('목 서버 그대로: 관리자가 심사할 것 모두 승인 → 목록에서 빠진다', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    renderAt('/approvals', as.admin);
    await screen.findAllByTestId('approval-row');
    const n = screen.getAllByTestId('approval-pick').length;
    expect(n).toBeGreaterThan(0);
    await user.click(screen.getByRole('checkbox', { name: '심사할 수 있는 것 모두 고르기' }));
    await user.click(screen.getByRole('button', { name: '고른 것 승인' }));
    await user.click(screen.getByRole('button', { name: `${n}건 승인하기` }));
    const results = await screen.findByTestId('batch-results');
    await waitFor(() => expect(results).toHaveTextContent(`${n}건 중 ${n}건 처리했어요`), { timeout: 10000 });
    // 다 처리해 목록이 비어도(수고하셨어요) 결과와 이름은 남는다
    await waitFor(() => expect(screen.queryAllByTestId('approval-pick')).toHaveLength(0));
    expect(screen.getByTestId('batch-results')).toBeInTheDocument();
    for (const item of screen.getAllByTestId('batch-result')) expect(item.querySelector('a')!.textContent).not.toBe('승인 건');
    await user.click(within(screen.getByTestId('batch-results')).getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('batch-results')).not.toBeInTheDocument();
  });
});
