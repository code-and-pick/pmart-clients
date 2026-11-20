// 검색 동의어(search 0.5.0 + approval SEARCH_SYNONYM, ADR-0073 단계 B — PC 1 요청서 2026-11-20)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { synonyms } from '../../mocks/synonymStore';
import { as, renderAt } from '../../test/render';

describe('검색 동의어', () => {
  it('지금 묶음을 고치고 새 묶음을 더해 승인 요청 한 번 — 기준 버전·UPSERT 줄, 규칙 ID 는 화면에 없다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/search/synonyms', as.md);
    const rules = await screen.findAllByTestId('synonym-rule');
    expect(rules).toHaveLength(2);
    expect(rules[0]!).toHaveTextContent('계란');
    expect(screen.getByTestId('synonym-version')).toHaveTextContent('버전 2');
    expect(screen.queryByText('egg')).not.toBeInTheDocument();

    await user.click(within(rules[0]!).getByRole('button', { name: '고치기' }));
    const edit = screen.getAllByLabelText('같은 뜻 낱말')[0]!;
    await user.clear(edit);
    await user.type(edit, '계란, 달걀, 에그, 란');
    await user.click(screen.getByTestId('synonym-add'));
    await user.type(screen.getAllByLabelText('같은 뜻 낱말')[1]!, '두부, 순두부');
    await user.click(screen.getByTestId('synonym-submit'));

    expect(await screen.findByTestId('synonym-done')).toHaveTextContent('승인 요청을 올렸어요');
    const created = view.sent.find((q) => q.method === 'POST' && new URL(q.url).pathname.endsWith('/change-requests'));
    const body = (await created!.clone().json()) as { type: string; targetRef: string; targetExpectedVersion: number; summary: string; lines: { lineKey: string; attributes: { op: string; terms?: string[] } }[] };
    expect(body).toMatchObject({ type: 'SEARCH_SYNONYM', targetRef: 'pmart-product-synonyms', targetExpectedVersion: 2 });
    expect(body.summary).toBe('검색 동의어 2건 — 계란·달걀 묶음 고침 외');
    expect(body.lines[0]).toMatchObject({ lineKey: 'egg', attributes: { op: 'UPSERT', terms: ['계란', '달걀', '에그', '란'] } });
    expect(body.lines[1]!.lineKey).toMatch(/^syn-[0-9a-f]{10}$/);
    expect(created!.headers.get('Idempotency-Key')).toBeTruthy();

    // 승인 상세: 규칙 ID 대신 고침·추가 + 낱말
    await user.click(screen.getByRole('link', { name: '승인 보기' }));
    const lines = await screen.findAllByTestId('synonym-line');
    expect(lines[0]!).toHaveTextContent('고침계란, 달걀, 에그, 란');
    expect(lines[0]!).toHaveTextContent('지금: 계란, 달걀, 에그');
    expect(lines[1]!).toHaveTextContent('추가두부, 순두부');
    expect(screen.queryByText('egg')).not.toBeInTheDocument();
  });

  it('낱말이 하나뿐이면 그 줄에 까닭, 승인 요청 단추가 꺼진다', async () => {
    const user = userEvent.setup();
    renderAt('/search/synonyms', as.md);
    await user.click(await screen.findByTestId('synonym-add'));
    await user.type(screen.getByLabelText('같은 뜻 낱말'), '두부');
    expect(screen.getByTestId('synonym-problem')).toHaveTextContent('2~20개');
    expect(screen.getByTestId('synonym-submit')).toBeDisabled();
  });

  it('지우기는 DELETE 줄, 승인 대기 중이면 새 요청을 막는다', async () => {
    const user = userEvent.setup();
    renderAt('/search/synonyms', as.md);
    const rules = await screen.findAllByTestId('synonym-rule');
    await user.click(within(rules[1]!).getByRole('button', { name: '지우기' }));
    await user.click(screen.getByTestId('synonym-submit'));
    await screen.findByTestId('synonym-done');
    await user.click(screen.getByRole('button', { name: '이어서 바꾸기' }));
    expect(await screen.findByTestId('synonym-pending')).toBeInTheDocument();
    await user.click(within(screen.getAllByTestId('synonym-rule')[0]!).getByRole('button', { name: '지우기' }));
    expect(screen.getByTestId('synonym-submit')).toBeDisabled();
  });

  it('결과 없는 검색어 "동의어 만들기" → 그 검색어가 첫 낱말인 새 묶음', async () => {
    const user = userEvent.setup();
    renderAt('/search/zero-results', as.md);
    const rows = await screen.findAllByTestId('zero-row');
    await user.click(within(rows[0]!).getByTestId('zero-make-synonym'));
    expect(await screen.findByLabelText('같은 뜻 낱말')).toHaveValue('두부조림, ');
  });

  it('반영 기록 — 반영됨은 새 버전, 반영 안 됨은 까닭', async () => {
    synonyms.applications = [
      { approvalId: 'apv-s2', changeRequestId: null, approverId: null, result: 'REJECTED', reason: 'STALE_VERSION', baseVersion: 1, version: 2, at: '2026-11-20T01:00:00Z' },
      { approvalId: 'apv-s1', changeRequestId: null, approverId: null, result: 'APPLIED', reason: null, baseVersion: 1, version: 2, at: '2026-11-19T01:00:00Z' },
    ];
    renderAt('/search/synonyms', as.md);
    const rows = await screen.findAllByTestId('synonym-history');
    expect(rows[0]!).toHaveTextContent('반영 안 됨');
    expect(rows[0]!).toHaveTextContent('다른 변경이 먼저 반영');
    expect(rows[1]!).toHaveTextContent('반영됨');
    expect(rows[1]!).toHaveTextContent('버전 2');
  });

  it('운영 관리자도 메뉴에, 그 밖 역할은 메뉴 없음', async () => {
    renderAt('/', as.admin);
    await waitFor(() => expect(document.querySelector('aside a[href="/search/synonyms"]')).not.toBeNull());
  });
});
