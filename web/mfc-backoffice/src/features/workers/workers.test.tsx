// 작업자 화면 — mfc-capacity-service 0.14.0 workers 목.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('worker-row');
const names = () => rows().map((r) => within(r).getAllByRole('cell')[0]!.textContent);
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const posts = (sent: Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(part));
const heading = () => screen.findByRole('heading', { level: 1 });

describe('작업자 목록', () => {
  it('기본은 재직·정지(서버 기본 — state 를 보내지 않는다). 지금 배정 조건·휴게·오늘 출근은 서버 값', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers');
    await waitFor(() => expect(names()).toEqual(['김현장', '박일일', '이알바', '최정지']));
    const [kim, park, lee] = rows();
    expect(within(kim!).getByText('피킹, 포장')).toBeInTheDocument();
    expect(within(park!).getByText('출근 전')).toBeInTheDocument();
    expect(within(lee!).getByText('휴게 중')).toBeInTheDocument();
    expect(new URL(view.gets('/workers')[0]!.url).searchParams.get('state')).toBeNull();
  });

  it('퇴사 거르기는 URL 쿼리 → 서버로', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers');
    await waitFor(() => expect(rows()).toHaveLength(4));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'LEFT');
    await waitFor(() => expect(names()).toEqual(['정퇴사']));
    expect(new URL(view.gets('/workers').at(-1)!.url).searchParams.get('state')).toBe('LEFT');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/mfcs/:mfcId/workers`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/workers');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('조건에 맞는 작업자가 없어요.')).not.toBeInTheDocument();
  });
});

describe('작업자 등록', () => {
  it('운영자 ID·이름·업무 → 등록(자격은 생략 = 서버 기본) → 상세', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/new');
    await userEvent.type(await screen.findByRole('textbox', { name: /운영자 ID/ }), 'OP-new-1');
    await userEvent.type(screen.getByRole('textbox', { name: '이름' }), '한신입');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '고용 형태' }), 'PART_TIME');
    await userEvent.click(screen.getByRole('checkbox', { name: '피킹' }));
    await userEvent.click(screen.getByRole('button', { name: '작업자 등록' }));
    expect(await screen.findByText('작업자를 등록했어요.')).toBeInTheDocument();
    expect(await heading()).toHaveTextContent('한신입');
    const post = posts(view.sent, '/workers')[0]!;
    expect(await sentBody(post)).toEqual({ workerId: 'OP-new-1', displayName: '한신입', employmentType: 'PART_TIME', duty: { taskTypes: ['PICK'] } });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('이미 등록된 사람이면 WORKER_ALREADY_REGISTERED 문구', async () => {
    renderAt('/c/MFC-BSN-01/workers/new');
    await userEvent.type(await screen.findByRole('textbox', { name: /운영자 ID/ }), 'OP-wkr-9');
    await userEvent.type(screen.getByRole('textbox', { name: '이름' }), '정퇴사');
    await userEvent.click(screen.getByRole('checkbox', { name: '피킹' }));
    await userEvent.click(screen.getByRole('button', { name: '작업자 등록' }));
    expect(await screen.findByText(/이미 등록된 작업자예요/)).toBeInTheDocument();
  });
});

describe('작업자 상세', () => {
  it('업무 바꾸기: 지금 업무 버전으로 보내고, 맞지 않게 된 진행 중 배정을 알린다(지우지 않음)', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    expect(await heading()).toHaveTextContent('김현장');
    const form = screen.getByRole('form', { name: '업무 바꾸기' });
    await userEvent.click(within(form).getByRole('checkbox', { name: '피킹' }));
    await userEvent.type(within(form).getByRole('textbox', { name: '업무 바꾸기 사유' }), '포장 전담');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await screen.findByText('바꿨어요.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: /맞지 않는 진행 중 배정/ })).getByText('피킹 · TASK-PICK-1')).toBeInTheDocument();
    const post = posts(view.sent, '/duty-changes')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    expect(await sentBody(post)).toEqual({ taskTypes: ['PACK'], reason: '포장 전담' });
    expect(db.assignments).toHaveLength(1);
  });

  it('다른 사람이 먼저 업무를 바꿨으면 VERSION_CONFLICT 문구', async () => {
    renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    const w = db.workers.get('MFC-BSN-01/OP-wkr-1')!;
    db.workers.set('MFC-BSN-01/OP-wkr-1', { ...w, duties: [{ ...w.duties[0]!, dutyVersion: 3 }] });
    const form = screen.getByRole('form', { name: '업무 바꾸기' });
    await userEvent.type(within(form).getByRole('textbox', { name: '업무 바꾸기 사유' }), '변경');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await screen.findByText('다른 사람이 먼저 바꿨어요. 새로 고침한 뒤 다시 해 주세요.')).toBeInTheDocument();
  });

  it('상태 정지: 사유 필수, 이력에 남고 진행 중 배정을 알린다', async () => {
    renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    const form = screen.getByRole('form', { name: '상태 바꾸기' });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '상태' }), 'SUSPENDED');
    expect(within(form).getByRole('button', { name: '저장' })).toBeDisabled();
    await userEvent.type(within(form).getByRole('textbox', { name: '상태 바꾸기 사유' }), '무단 결근');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('정지'));
    expect(screen.getByText('피킹 · TASK-PICK-1')).toBeInTheDocument();
    expect(screen.getByText('재직 → 정지')).toBeInTheDocument();
  });

  it('속도 배율은 0.5~2.0 만 보낼 수 있다', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    const form = screen.getByRole('form', { name: '속도 배율 바꾸기' });
    const input = within(form).getByRole('spinbutton', { name: '속도 배율' });
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    await userEvent.type(within(form).getByRole('textbox', { name: '속도 배율 바꾸기 사유' }), '숙련');
    expect(within(form).getByRole('button', { name: '저장' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '1.2');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await screen.findByText('바꿨어요.')).toBeInTheDocument();
    expect(await sentBody(posts(view.sent, '/speed-changes')[0]!)).toEqual({ speedFactor: 1.2, reason: '숙련' });
  });

  it('휴게 중이면 "휴게 끝" → 끝내고 다시 읽는다', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/OP-wkr-2');
    expect(await heading()).toHaveTextContent('휴게 중');
    await userEvent.click(screen.getByRole('button', { name: '휴게 끝' }));
    expect(await screen.findByText('휴게를 끝냈어요.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '휴게 시작' })).toBeInTheDocument();
    expect(posts(view.sent, '/breaks/current/end')).toHaveLength(1);
  });

  it('일일크루: 오늘 출근 등록(날짜는 보내지 않는다 — 서버가 오늘로) → 지금 배정 조건이 생긴다', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/OP-day-1');
    await heading();
    expect(screen.getByText('지금 받을 수 있는 작업이 없어요.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '오늘 출근 등록' }));
    expect(await screen.findByText('오늘 출근을 등록했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: '오늘 출근 등록' })).not.toBeInTheDocument());
    expect(screen.getByText('출근 등록됨')).toBeInTheDocument();
    expect(await sentBody(posts(view.sent, '/day-enrollments')[0]!)).toEqual({});
  });

  it('일일크루가 아니면 출근 등록 단추가 없다', async () => {
    renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    expect(screen.queryByRole('button', { name: '오늘 출근 등록' })).not.toBeInTheDocument();
  });

  it('근무 등록은 한국 시간(+09:00)으로 보내고, 겹치면 SHIFT_OVERLAP 문구', async () => {
    const view = renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    await waitFor(() => expect(screen.getAllByTestId('shift-row')).toHaveLength(1));
    const form = screen.getByRole('form', { name: '근무 등록' });
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: '2026-11-18T09:00' } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: '2026-11-18T18:00' } });
    await userEvent.click(within(form).getByRole('button', { name: '근무 등록' }));
    expect(await screen.findByText('근무를 등록했어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('shift-row')).toHaveLength(2));
    expect(await sentBody(posts(view.sent, '/shifts')[0]!)).toEqual({ startAt: '2026-11-18T09:00:00+09:00', endAt: '2026-11-18T18:00:00+09:00' });

    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: '2026-11-17T12:00' } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: '2026-11-17T20:00' } });
    await userEvent.click(within(form).getByRole('button', { name: '근무 등록' }));
    expect(await screen.findByText('이 사람의 다른 예정 근무와 겹쳐요.')).toBeInTheDocument();
  });

  it('근무 취소: 사유를 적어야 보내고, 목록에서 빠진다', async () => {
    renderAt('/c/MFC-BSN-01/workers/OP-wkr-1');
    await heading();
    const row = (await screen.findAllByTestId('shift-row'))[0]!;
    expect(within(row).getByRole('button', { name: '취소' })).toBeDisabled();
    await userEvent.type(within(row).getByRole('textbox'), '휴무로 변경');
    await userEvent.click(within(row).getByRole('button', { name: '취소' }));
    expect(await screen.findByText('예정된 근무가 없어요.')).toBeInTheDocument();
    expect(db.shifts.get('SHIFT-1')!.state).toBe('CANCELLED');
  });

  it('센터 관리자가 아니면 서버 403 — 권한 문구, 바뀌지 않음', async () => {
    renderAt('/c/MFC-BSN-01/workers/OP-wkr-1', as.adminWithCenter);
    await heading();
    const form = screen.getByRole('form', { name: '상태 바꾸기' });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: '상태' }), 'SUSPENDED');
    await userEvent.type(within(form).getByRole('textbox', { name: '상태 바꾸기 사유' }), '정지');
    await userEvent.click(within(form).getByRole('button', { name: '저장' }));
    expect(await screen.findByText('이 센터 권한이 없습니다.')).toBeInTheDocument();
    expect(db.workers.get('MFC-BSN-01/OP-wkr-1')!.state).toBe('ACTIVE');
  });
});
