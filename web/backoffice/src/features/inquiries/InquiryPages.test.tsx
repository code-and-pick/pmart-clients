// 고객센터 문의(상담원) — 목 서버(MSW, case-service 0.2.0 모양) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetMockInquiries } from '../../mocks/inquiryHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

beforeEach(resetMockInquiries);

describe('고객센터 문의 목록', () => {
  it('상담원: 최근 순 목록, 상태 필터는 서버에 status 로 묻는다', async () => {
    const view = renderAt('/inquiries', as.cs);
    expect(await screen.findAllByTestId('inquiry-row')).toHaveLength(3);
    expect(screen.getByText('Q-1119-0003')).toBeInTheDocument(); // ADR-0070 덧붙임(2026-11-19): 시스템 ID·끝 8자리를 보이지 않는다
    expect(screen.getByText('AI 상담에서 넘어옴')).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('radiogroup', { name: '상태' })).getByRole('radio', { name: '접수' }));
    await waitFor(() => expect(screen.getAllByTestId('inquiry-row')).toHaveLength(2));
    const last = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/inquiries')).at(-1)!;
    expect(new URL(last.url).searchParams.get('status')).toBe('RECEIVED');
    expect(last.headers.get('X-Source-System')).toBe('backoffice-web');
  });

  it('상담원이 아니면 서버 403 — 빈 목록이 아니라 권한 안내', async () => {
    renderAt('/inquiries', as.md);
    expect(await screen.findByText(/권한이 없/)).toBeInTheDocument();
    expect(screen.queryByText('이 조건의 문의가 없어요.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inquiry-row')).not.toBeInTheDocument();
  });

  it('본사 관리자(OPERATOR_ADMIN)는 목록을 본다(case 0.4.2 — 보기만)', async () => {
    renderAt('/inquiries', as.admin);
    expect(await screen.findAllByTestId('inquiry-row')).toHaveLength(3);
  });

  it('메뉴는 역할로 숨기지만(편의) 화면은 열 수 있고 권한은 서버가 판정한다(403 은 오류로)', async () => {
    renderAt('/inquiries', as.md);
    expect(screen.queryByRole('link', { name: '문의 답변' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '이용할 수 없는 화면이에요' })).toBeInTheDocument();
  });
});

describe('문의 담당 상담원(case 0.36.0 lastAnsweredBy)', () => {
  it('목록 줄에 마지막으로 답한 직원 "이름 · 사번", 답 없으면 "-"', async () => {
    renderAt('/inquiries', as.cs);
    const rows = await screen.findAllByTestId('inquiry-row');
    const answered = rows.find((r) => r.textContent?.includes('소비기한'))!;
    await waitFor(() => expect(within(answered).getByTestId('inquiry-answered-by')).toHaveTextContent('P2026-00005'));
    const waiting = rows.find((r) => within(r).queryByText('소비기한') === null)!;
    expect(within(waiting).getByTestId('inquiry-answered-by')).toHaveTextContent('-');
  });
});

describe('고객센터 문의 상세·답변', () => {
  const replies = (view: ReturnType<typeof renderAt>) => view.mutations('/replies');

  it('본사 관리자: 상세·답변은 보지만 답변 칸은 없다(답변은 상담원만 — 2026-11-16 사용자 (가))', async () => {
    const view = renderAt('/inquiries/INQ-MOCK-3', as.admin);
    expect(await screen.findByTestId('inquiry-body')).toHaveTextContent('배송 완료라고 뜨는데');
    expect(screen.getByTestId('inquiry-read-only')).toHaveTextContent('보기만 할 수 있어요');
    expect(screen.queryByRole('textbox', { name: '답변 쓰기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '답변 보내기' })).not.toBeInTheDocument();
    expect(replies(view)).toHaveLength(0);
  });

  it('답변: X-Expected-Version = 문의 version, Idempotency-Key — 반영되면 답변 완료·답변이 보인다', async () => {
    const view = renderAt('/inquiries/INQ-MOCK-3', as.cs);
    expect(await screen.findByTestId('inquiry-body')).toHaveTextContent('배송 완료라고 뜨는데');
    expect(screen.getByTestId('inquiry-status')).toHaveTextContent('접수');
    expect(screen.getByRole('button', { name: '답변 보내기' })).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: '답변 쓰기' }), '배송 기사에게 확인하고 있습니다.');
    await userEvent.click(screen.getByRole('button', { name: '답변 보내기' }));

    expect(await screen.findByText('답변을 보냈어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('inquiry-status')).toHaveTextContent('답변 완료'));
    expect(within(screen.getByTestId('inquiry-reply')).getByText('배송 기사에게 확인하고 있습니다.')).toBeInTheDocument();
    const sent = replies(view);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('X-Expected-Version')).toBe('1');
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent[0]!.json()).toEqual({ body: '배송 기사에게 확인하고 있습니다.' });
  });

  it('응답을 잃으면 결과 불명 — "같은 요청으로 결과 확인"은 같은 키라 답변이 하나만 붙는다', async () => {
    let lose = true;
    server.use(
      http.post('*/api/v1/inquiries/:inquiryId/replies', () => {
        if (!lose) return undefined; // 목 서버로 넘긴다
        lose = false;
        return HttpResponse.error();
      }),
    );
    const view = renderAt('/inquiries/INQ-MOCK-2', as.cs);
    await userEvent.type(await screen.findByRole('textbox', { name: '답변 쓰기' }), '영업일 3일 안에 환불됩니다.');
    await userEvent.click(screen.getByRole('button', { name: '답변 보내기' }));
    expect(await screen.findByText(/답변이 반영됐는지 확인하지 못했어요/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '답변 쓰기' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByText('답변을 보냈어요.')).toBeInTheDocument();
    const sent = replies(view);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers.get('Idempotency-Key')).toBe(sent[0]!.headers.get('Idempotency-Key'));
    await waitFor(() => expect(screen.getAllByTestId('inquiry-reply')).toHaveLength(1));
  });

  it('낡은 버전이면 409 VERSION_CONFLICT 안내, 답변은 붙지 않는다', async () => {
    server.use(
      http.post('*/api/v1/inquiries/:inquiryId/replies', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'conflict', status: 409, code: 'VERSION_CONFLICT' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderAt('/inquiries/INQ-MOCK-3', as.cs);
    await userEvent.type(await screen.findByRole('textbox', { name: '답변 쓰기' }), '답변');
    await userEvent.click(screen.getByRole('button', { name: '답변 보내기' }));
    expect(await screen.findByText(/그 사이 다른 변경이 있었어요/)).toBeInTheDocument();
    expect(screen.queryByTestId('inquiry-reply')).not.toBeInTheDocument();
  });

  it('없는 문의는 오류로 보인다', async () => {
    renderAt('/inquiries/INQ-NOPE', as.cs);
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'not-found'); // 없는 건 — "찾을 수 없어요"
    expect(screen.queryByTestId('inquiry-body')).not.toBeInTheDocument();
  });
});
