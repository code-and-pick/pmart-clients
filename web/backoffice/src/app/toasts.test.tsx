// 처리 결과 알림(토스트, 2026-11-18) — 서버가 확정한 것만 "됐어요"
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { CommandFeedback } from '../shared/Feedback';
import { server } from '../test/server';
import { as, renderAt } from '../test/render';
import { Toasts } from './Toasts';

const fake = (phase: unknown) => ({ phase, resend: () => Promise.resolve(), run: () => Promise.resolve(), reset: () => undefined, busy: false }) as never;

describe('처리 결과 알림', () => {
  it('저장이 서버에 반영되면 오른쪽 아래 "반영됐어요"', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    const toast = await within(screen.getByTestId('toasts')).findByTestId('toast');
    expect(toast).toHaveAttribute('data-tone', 'success');
    expect(toast).toHaveTextContent('반영됐어요');
  });

  it('서버가 거절하면 "반영되지 않았어요" + 사유', async () => {
    server.use(http.post(`${API_BASE}/product-drafts`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'VERSION_CONFLICT', retryable: false }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    const toast = await within(screen.getByTestId('toasts')).findByTestId('toast');
    expect(toast).toHaveAttribute('data-tone', 'error');
    expect(toast).toHaveTextContent('반영되지 않았어요');
  });

  it('접수(ACCEPTED)·결과 불명은 "됐어요"라고 하지 않는다', async () => {
    const first = render(
      <>
        <CommandFeedback command={fake({ kind: 'idle' })} />
        <Toasts />
      </>,
    );
    first.rerender(
      <>
        <CommandFeedback command={fake({ kind: 'done', result: { status: 'ACCEPTED' } })} />
        <Toasts />
      </>,
    );
    const accepted = await screen.findByTestId('toast');
    expect(accepted).toHaveAttribute('data-tone', 'info');
    expect(accepted).toHaveTextContent('접수됐어요 — 결과를 확인하고 있어요');
    expect(accepted).not.toHaveTextContent('반영됐어요');

    first.rerender(
      <>
        <CommandFeedback command={fake({ kind: 'unknown', failure: { kind: 'unknown' } })} />
        <Toasts />
      </>,
    );
    const toasts = await screen.findAllByTestId('toast');
    expect(toasts.at(-1)).toHaveAttribute('data-tone', 'warning');
    expect(toasts.at(-1)).toHaveTextContent('결과를 아직 몰라요');
  });
});
