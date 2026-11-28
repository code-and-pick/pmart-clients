// 상담 도우미 칸(ai-assistant 1.4.0 consult-guides, ADR-0093 — 요청서 2026-11-28-request-cs-consult-assistant)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { columnIsMember, rowIsCategory } from './ConsultGuide';

const guideCalls = (sent: Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/assistant/consult-guides'));

describe('상담 도우미 칸', () => {
  it('문의 종류를 고르기 전에는 부르지 않고, 고르면 본인 확인 표(그 종류 줄 강조)·정책 근거 — 개인정보·식별자는 보내지 않는다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cs-intakes/new', as.cs);
    expect(await screen.findByTestId('consult-guide-idle')).toBeInTheDocument();
    expect(guideCalls(view.sent)).toHaveLength(0);

    await user.type(screen.getByLabelText('고객'), 'CUS-1001');
    await user.selectOptions(screen.getByLabelText('분류'), '주문');
    const identity = await screen.findByTestId('consult-identity');
    expect(identity).toHaveTextContent('제15조 (상담 본인 확인과 주문 확인)');
    const marked = identity.querySelectorAll('tr[data-marked]');
    expect(marked).toHaveLength(1);
    expect(marked[0]!).toHaveTextContent('주문 번호 + 받는 분 이름 대조');
    const policies = screen.getAllByTestId('consult-policy');
    expect(policies[0]!).toHaveTextContent('제3조 (고객 취소)');

    const call = guideCalls(view.sent).at(-1)!;
    const q = new URL(call.url).searchParams;
    expect(Object.fromEntries(q)).toEqual({ category: 'ORDER' }); // 직접 넣은 고객 ID 는 회원 조회 결과가 아니라 보내지 않음
    expect(call.url).not.toContain('CUS-1001');
    expect(call.headers.get('X-Source-System')).toBe('backoffice-web');
  });

  it('주문을 연결하면 그 주문 상태 이름만 같이 보낸다(주문 ID 는 안 보냄)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cs-intakes/new', as.cs);
    await user.type(await screen.findByLabelText('주문 번호(선택)'), 'ORD-MOCK-1001');
    await user.selectOptions(screen.getByLabelText('분류'), '배송');
    await waitFor(() => expect(new URL(guideCalls(view.sent).at(-1)!.url).searchParams.get('orderStatus')).toMatch(/^[A-Z_]+$/));
    const url = guideCalls(view.sent).at(-1)!.url;
    expect(url).not.toContain('ORD-MOCK-1001');
    expect(await screen.findByTestId('consult-policies')).toHaveTextContent('주문 상태');
  });

  it('503 이면 "지금 안내를 불러오지 못했어요"만 — 접수 버튼은 그대로', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_BASE}/assistant/consult-guides`, () => HttpResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/cs-intakes/new', as.cs);
    await user.selectOptions(await screen.findByLabelText('분류'), '환불');
    expect(await screen.findByTestId('consult-guide-failed')).toHaveTextContent('지금 안내를 불러오지 못했어요');
    expect(screen.getByRole('button', { name: '접수 남기기' })).toBeInTheDocument();
  });

  it('403 이면 칸을 숨긴다', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_BASE}/assistant/consult-guides`, () => HttpResponse.json({ code: 'FORBIDDEN', status: 403 }, { status: 403, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/cs-intakes/new', as.cs);
    await user.selectOptions(await screen.findByLabelText('분류'), '주문');
    await waitFor(() => expect(screen.queryByTestId('consult-guide')).not.toBeInTheDocument());
  });

  it('칸 아래 자유 질문 — 답을 보이고 같은 칸에서 이어 묻는다', async () => {
    const user = userEvent.setup();
    renderAt('/cs-intakes/new', as.cs);
    const panel = await screen.findByTestId('consult-guide');
    await user.type(within(panel).getByRole('textbox', { name: '도우미에게 묻기' }), '배송 출발한 주문도 취소할 수 있나요?');
    await user.click(within(panel).getByRole('button', { name: '묻기' }));
    expect(await within(panel).findByTestId('consult-answer')).toBeInTheDocument();
  });
});

describe('본인 확인 표 강조', () => {
  it('줄 첫 칸에서 문의 종류, 머리 글자에서 회원 조회 열을 고른다', () => {
    expect(rowIsCategory('주문', 'ORDER')).toBe(true);
    expect(rowIsCategory('상품·기타', 'OTHER')).toBe(true);
    expect(rowIsCategory('상품·기타', 'PRODUCT')).toBe(true);
    expect(rowIsCategory('계정', 'ACCOUNT')).toBe(true);
    expect(rowIsCategory('배송', 'ORDER')).toBe(false);
    expect(columnIsMember('회원이 조회될 때', true)).toBe(true);
    expect(columnIsMember('회원이 조회되지 않을 때', true)).toBe(false);
    expect(columnIsMember('회원이 조회되지 않을 때', false)).toBe(true);
    expect(columnIsMember('문의 종류', false)).toBe(false);
  });
});
