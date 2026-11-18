// 라이더 공지·직원 조치 이력(2026-11-18, PC 5) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { mergeActions, rangeProblem, seoulDayStart } from './StaffActionsPage';

const posts = (sent: readonly Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.includes(part));

describe('공지 보내기', () => {
  it('쓰고 → 한 번 더 확인 → 보내면 서버가 알려 준 받은 수를 보이고 목록에 더한다', async () => {
    const view = renderAt('/notices', as.riderOps);
    expect(await screen.findAllByTestId('notice-row')).toHaveLength(1);
    const form = screen.getByTestId('notice-form');
    const send = within(form).getByRole('button', { name: '보내기' });
    expect(send).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/제목/), '내일 점검 안내');
    await userEvent.type(within(form).getByLabelText(/내용/), '새벽 2시~3시 앱 점검이 있어요.');
    await userEvent.click(send);
    // 확인 전에는 보내지 않는다
    expect(posts(view.sent, '/rider-notices')).toHaveLength(0);
    expect(await screen.findByTestId('notice-confirm-target')).toHaveTextContent('전체 라이더');
    await userEvent.click(within(screen.getByTestId('notice-confirm')).getByRole('button', { name: '보내기' }));
    expect(await screen.findByTestId('notice-sent')).toHaveTextContent('128명에게 보냈어요.');
    const req = posts(view.sent, '/rider-notices')[0]!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(req.headers.get('X-Source-System')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ title: '내일 점검 안내', body: '새벽 2시~3시 앱 점검이 있어요.', target: { type: 'ALL' } });
    expect(await screen.findAllByTestId('notice-row')).toHaveLength(2);
  });

  it('센터를 고르면 그 센터만, 고르기 전에는 보낼 수 없다', async () => {
    const view = renderAt('/notices', as.riderOps);
    const form = await screen.findByTestId('notice-form');
    await userEvent.type(within(form).getByLabelText(/제목/), '센터 공지');
    await userEvent.type(within(form).getByLabelText(/내용/), '주차 위치가 바뀌었어요.');
    await userEvent.click(within(form).getByLabelText('한 센터 라이더'));
    expect(within(form).getByRole('button', { name: '보내기' })).toBeDisabled();
    const picker = await within(form).findByRole('combobox');
    const option = await within(picker).findAllByRole('option');
    await userEvent.selectOptions(picker, option.at(-1)!);
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    await userEvent.click(within(await screen.findByTestId('notice-confirm')).getByRole('button', { name: '보내기' }));
    expect(await screen.findByTestId('notice-sent')).toHaveTextContent('42명에게 보냈어요.');
    const body = (await posts(view.sent, '/rider-notices')[0]!.clone().json()) as { target: { type: string; mfcId?: string } };
    expect(body.target.type).toBe('MFC');
    expect(body.target.mfcId).toBeTruthy();
  });
});

describe('조치 이력', () => {
  it('관리자: 원천 셋을 시각 내림차순으로 합쳐 한 표에', async () => {
    renderAt('/staff-actions', as.admin);
    const rows = await screen.findAllByTestId('staff-action-row');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent('상태 바로잡기');
    expect(rows[1]).toHaveTextContent('계정 제한');
    expect(rows[2]).toHaveTextContent('배차 취소');
    // RiderName — 라이더 번호(라이더 요약을 따로 불러온 뒤)
    expect(await within(screen.getAllByTestId('staff-action-row')[1]!).findByText('730115')).toBeInTheDocument();
  });

  it('관리자가 아니면 메뉴에 없고 주소로 열어도 안내만', async () => {
    renderAt('/staff-actions', as.riderOps);
    expect(await screen.findByTestId('admin-only')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '조치 이력' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '공지 보내기' })).toBeInTheDocument();
  });

  it('한 원천이 실패하면 그 원천만 알리고 나머지는 보인다(빈 목록으로 숨기지 않는다)', async () => {
    server.use(http.get(`${API_BASE}/dispatch-staff-actions`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE', traceId: 't' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/staff-actions', as.admin);
    expect(await screen.findByTestId('source-failed-dispatch')).toHaveTextContent('배차');
    expect(await screen.findAllByTestId('staff-action-row')).toHaveLength(6);
  });

  it('섞기: 더 있는 원천의 마지막 시각보다 오래된 줄은 숨긴다', () => {
    const row = (at: string, action: string) => ({ at, action, actorId: 'OP' });
    const { shown, hidden } = mergeActions([
      { rows: [row('2026-11-18T03:00:00Z', 'A'), row('2026-11-18T01:00:00Z', 'A')], hasMore: true },
      { rows: [row('2026-11-18T02:00:00Z', 'B'), row('2026-11-17T00:00:00Z', 'B')], hasMore: false },
    ]);
    expect(shown.map((r) => r.at)).toEqual(['2026-11-18T03:00:00Z', '2026-11-18T02:00:00Z', '2026-11-18T01:00:00Z']);
    expect(hidden).toBe(1);
  });

  it('기간: 서울 날짜 → 그날 0시, 끝일은 다음 날 0시, 31일 넘으면 막는다', () => {
    expect(seoulDayStart('2026-11-18')).toBe('2026-11-17T15:00:00.000Z');
    expect(seoulDayStart('2026-11-18', true)).toBe('2026-11-18T15:00:00.000Z');
    expect(rangeProblem('2026-10-01', '2026-11-18')).toBe('기간은 최대 31일까지 볼 수 있어요.');
    expect(rangeProblem('2026-11-10', '2026-11-01')).toBe('끝일이 시작일보다 앞서요.');
    expect(rangeProblem('2026-11-01', '2026-11-18')).toBeNull();
    expect(rangeProblem('', '')).toBeNull();
  });
});
