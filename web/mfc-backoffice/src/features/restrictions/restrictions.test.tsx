// 운영 제한 화면 — mfc-capacity-service 0.14.0 operation-restrictions 목.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const cards = () => screen.getAllByTestId('restriction');
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;

describe('운영 제한', () => {
  it('기본은 활성만(activeOnly 를 보내지 않는다), "해제된 것까지"는 activeOnly=false', async () => {
    const view = renderAt('/c/MFC-BSN-01/restrictions');
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0]).toHaveTextContent('수용 축소');
    expect(cards()[0]).toHaveTextContent('ORD-7');
    expect(new URL(view.gets('/operation-restrictions')[0]!.url).searchParams.get('activeOnly')).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '보기' }), '1');
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(new URL(view.gets('/operation-restrictions').at(-1)!.url).searchParams.get('activeOnly')).toBe('false');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/operation-restrictions`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/restrictions');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 운영 제한이 없어요.')).not.toBeInTheDocument();
  });

  it('등록: 수용 축소는 단위가 있어야, 승인 근거는 직접 입력 — 시각은 한국 시간 +09:00', async () => {
    const view = renderAt('/c/MFC-BSN-01/restrictions');
    const form = await screen.findByRole('form', { name: '운영 제한 등록' });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '종류' }), 'CAPACITY_REDUCE');
    fireEvent.change(within(form).getByLabelText('시작(한국)'), { target: { value: '2026-11-17T10:00' } });
    fireEvent.change(within(form).getByLabelText(/끝\(한국/), { target: { value: '2026-11-17T14:00' } });
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '인력 부족');
    await userEvent.type(within(form).getByRole('textbox', { name: /승인 근거/ }), 'AP-OPS-9');
    const submit = within(form).getByRole('button', { name: '운영 제한 등록' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByRole('spinbutton', { name: '축소 후 수용 단위' }), '10');
    await userEvent.click(submit);
    expect(await screen.findByText('운영 제한을 등록했어요.')).toBeInTheDocument();
    await waitFor(() => expect(cards()).toHaveLength(2));
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(await sentBody(post)).toEqual({
      mfcId: 'MFC-BSN-01',
      restrictionType: 'CAPACITY_REDUCE',
      approvalRef: 'AP-OPS-9',
      reason: '인력 부족',
      effectiveFrom: '2026-11-17T10:00:00+09:00',
      effectiveTo: '2026-11-17T14:00:00+09:00',
      reducedCapacityUnits: 10,
    });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('끝이 시작보다 앞이면 보내지 않는다', async () => {
    renderAt('/c/MFC-BSN-01/restrictions');
    const form = await screen.findByRole('form', { name: '운영 제한 등록' });
    fireEvent.change(within(form).getByLabelText('시작(한국)'), { target: { value: '2026-11-17T10:00' } });
    fireEvent.change(within(form).getByLabelText(/끝\(한국/), { target: { value: '2026-11-17T09:00' } });
    await userEvent.type(within(form).getByRole('textbox', { name: /승인 근거/ }), 'AP-OPS-9');
    expect(within(form).getByText('끝은 시작보다 뒤여야 해요.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '운영 제한 등록' })).toBeDisabled();
  });

  it('해제: 승인 근거·지금 버전으로 보내고, 활성 목록에서 빠진다', async () => {
    const view = renderAt('/c/MFC-BSN-01/restrictions');
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = cards()[0]!;
    const lift = within(card).getByRole('button', { name: '해제' });
    expect(lift).toBeDisabled();
    await userEvent.type(within(card).getByRole('textbox', { name: /해제 승인 근거/ }), 'AP-OPS-1L');
    await userEvent.click(lift);
    expect(await screen.findByText('운영 제한을 해제했어요.')).toBeInTheDocument();
    expect(await screen.findByText('조건에 맞는 운영 제한이 없어요.')).toBeInTheDocument();
    const del = view.sent.find((r) => r.method === 'DELETE')!;
    expect(new URL(del.url).searchParams.get('approvalRef')).toBe('AP-OPS-1L');
    expect(del.headers.get('X-Expected-Version')).toBe('1');
    expect(db.restrictions.get('RST-1')!.state).toBe('LIFTED');
  });

  it('센터 관리자가 아니면 서버 403 — 권한 문구', async () => {
    renderAt('/c/MFC-BSN-01/restrictions', as.adminWithCenter);
    const form = await screen.findByRole('form', { name: '운영 제한 등록' });
    fireEvent.change(within(form).getByLabelText('시작(한국)'), { target: { value: '2026-11-17T10:00' } });
    await userEvent.type(within(form).getByRole('textbox', { name: /승인 근거/ }), 'AP-OPS-9');
    await userEvent.click(within(form).getByRole('button', { name: '운영 제한 등록' }));
    expect(await within(form).findByText('이 센터 권한이 없습니다.')).toBeInTheDocument();
  });
});
