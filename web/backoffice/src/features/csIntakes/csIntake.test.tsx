// 전화·채팅 접수(case 0.12.0) — 상담원이 받은 고객 연락 기록
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const fill = async (o: { channel?: string; customer?: string; order?: string; method?: string; relation?: string; summary?: string; note?: string }) => {
  if (o.channel) await userEvent.click(await screen.findByRole('radio', { name: o.channel }));
  if (o.customer) await userEvent.type(screen.getByLabelText('고객 계정 ID'), o.customer);
  if (o.order) await userEvent.type(screen.getByLabelText('주문 번호(선택)'), o.order);
  if (o.method) await userEvent.click(screen.getByRole('radio', { name: o.method }));
  if (o.note) await userEvent.type(screen.getByLabelText('어떻게 확인했는지(필수, 200자)'), o.note);
  if (o.relation) await userEvent.click(screen.getByRole('radio', { name: o.relation }));
  await userEvent.selectOptions(screen.getByLabelText('분류'), '배송');
  if (o.summary) await userEvent.type(screen.getByLabelText('내용'), o.summary);
};

describe('전화·채팅 접수', () => {
  it('전화 + 주문 내용 대조로 남기면 상담원 문의가 생기고, 문의 목록에 "상담원 접수 · 전화"', async () => {
    const view = renderAt('/cs-intakes/new', as.cs);
    await fill({ channel: '전화', customer: 'CUS-1001', order: 'ORD-MOCK-1001', method: '주문 내용 대조', relation: '본인', summary: '배송이 늦는다는 전화' });
    await userEvent.click(screen.getByRole('button', { name: '접수 남기기' }));
    const saved = await screen.findByTestId('cs-intake-saved');
    expect(saved).toHaveTextContent('상담원 문의가 새로 생겼어요');

    const sent = view.mutations('/cs-intakes');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.get('X-Source-System')).toBeTruthy();
    expect(await sent[0]!.json()).toEqual({
      channel: 'PHONE',
      category: 'DELIVERY',
      customerRef: 'CUS-1001',
      subjectRef: 'ORD-MOCK-1001',
      summary: '배송이 늦는다는 전화',
      identityCheck: { method: 'ORDER_DETAILS_MATCH' },
      callerRelation: 'SELF',
    });

    await userEvent.click(within(saved).getByRole('link', { name: /^문의 / }));
    expect(await screen.findByText('상담원이 전화·채팅·메일로 받아 남긴 문의예요', { exact: false })).toBeInTheDocument();
    expect(await screen.findAllByTestId('cs-intake-row')).toHaveLength(1);
    expect(screen.getByText(/답변은 고객에게 가지 않아요/)).toBeInTheDocument();
  });

  it('본인 확인 규칙 — 전화면 앱 로그인 채팅을 못 고르고, 주문 대조는 주문 번호·기타는 메모가 있어야 보낸다', async () => {
    renderAt('/cs-intakes/new', as.cs);
    await fill({ channel: '전화', customer: 'CUS-1001', relation: '본인', summary: '문의' });
    expect(screen.getByRole('radio', { name: '앱 로그인 채팅' })).toBeDisabled();
    const send = screen.getByRole('button', { name: '접수 남기기' });

    await userEvent.click(screen.getByRole('radio', { name: '주문 내용 대조' }));
    expect(screen.getByTestId('cs-intake-missing')).toHaveTextContent('주문 내용 대조에는 주문 번호가 필요해요.');
    expect(send).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: '기타' }));
    expect(screen.getByTestId('cs-intake-missing')).toHaveTextContent('기타는 어떻게 확인했는지 적어야 해요.');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('어떻게 확인했는지(필수, 200자)'), '가입 이메일 확인');
    expect(send).toBeEnabled();

    await userEvent.click(screen.getByRole('radio', { name: '채팅' }));
    expect(screen.getByRole('radio', { name: '앱 로그인 채팅' })).toBeEnabled();
  });

  it('대리를 고르면 취소·환불 경고, 남긴 문의 상세에도 대리 경고', async () => {
    renderAt('/cs-intakes/new', as.cs);
    await fill({ channel: '채팅', customer: 'CUS-1001', method: '앱 로그인 채팅', relation: '대리(가족 등)', summary: '어머니 대신 문의' });
    expect(screen.getByTestId('cs-intake-proxy-warning')).toHaveTextContent('본인 확인 전에는 취소·환불을 요청하지 마세요');
    await userEvent.click(screen.getByRole('button', { name: '접수 남기기' }));
    await userEvent.click(within(await screen.findByTestId('cs-intake-saved')).getByRole('link', { name: /^문의 / }));
    expect(await screen.findByTestId('inquiry-proxy-warning')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: '문의 목록' }));
    const row = (await screen.findAllByTestId('inquiry-row'))[0]!;
    expect(row).toHaveTextContent('상담원 접수 · 채팅');
    expect(row).toHaveTextContent('대리');
  });

  it('다른 고객의 주문이면 422 CUSTOMER_ORDER_MISMATCH 문구', async () => {
    renderAt('/cs-intakes/new', as.cs);
    await fill({ channel: '전화', customer: 'CUS-2000', order: 'ORD-MOCK-1001', method: '주문 내용 대조', relation: '본인', summary: '배송 문의' });
    await userEvent.click(screen.getByRole('button', { name: '접수 남기기' }));
    expect(await screen.findByText(/그 고객의 주문이 아니에요/)).toBeInTheDocument();
  });

  it('접수 건 상세에서 "이 건으로 고객 연락 남기기" → 연결 접수, 상세 연락 기록에 보인다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.cs);
    await userEvent.click(await screen.findByRole('link', { name: '이 건으로 고객 연락 남기기' }));
    expect(await screen.findByLabelText('기존 접수 건에 연결(선택)')).toHaveValue('CASE-MOCK-1');
    await fill({ channel: '메일', customer: 'CUS-1001', method: '기타', note: '가입 메일 주소로 회신', relation: '본인', summary: '추가 문의 메일' });
    await userEvent.click(screen.getByRole('button', { name: '접수 남기기' }));
    const saved = await screen.findByTestId('cs-intake-saved');
    expect(saved).toHaveTextContent('기존 건에 연결했어요');
    expect(within(saved).queryByRole('link', { name: /^문의 / })).not.toBeInTheDocument();
    expect(await view.mutations('/cs-intakes')[0]!.json()).toMatchObject({ linkCaseId: 'CASE-MOCK-1', identityCheck: { method: 'OTHER', note: '가입 메일 주소로 회신' } });

    await userEvent.click(within(saved).getByRole('link', { name: '접수 건 CASE-MOCK-1' }));
    const log = await screen.findByRole('region', { name: '이 건의 연락 기록' });
    const row = await within(log).findByTestId('cs-intake-row');
    expect(row).toHaveTextContent('메일');
    expect(row).toHaveTextContent('추가 문의 메일');
  });

  it('라이더 운영에게는 연락 기록을 묻지 않는다(서버 403 역할)', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await screen.findByText('메모');
    expect(screen.queryByRole('region', { name: '이 건의 연락 기록' })).not.toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/cs-intakes'))).toBe(false);
  });

  it('연락 기록 조회 실패는 "남긴 연락이 없어요"로 보이지 않는다', async () => {
    server.use(
      http.get(`${API_BASE}/cs-intakes`, () =>
        HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/cases/CASE-MOCK-1', as.cs);
    const log = await screen.findByRole('region', { name: '이 건의 연락 기록' });
    await waitFor(() => expect(within(log).getByRole('button', { name: /다시/ })).toBeInTheDocument());
    expect(within(log).queryByText('남긴 연락이 없어요.')).not.toBeInTheDocument();
  });
});
