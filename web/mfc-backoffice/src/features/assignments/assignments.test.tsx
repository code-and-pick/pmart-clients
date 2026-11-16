// 배정 화면 — mfc-capacity-service 0.14.0 assignments·assignment-plans 목.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('assignment-row');
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const postsTo = (sent: Request[], path: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(path));

async function checkAndPick(taskId: string, worker: string, taskType?: string) {
  const form = await screen.findByRole('form', { name: '직접 배정' });
  const id = within(form).getByRole('textbox', { name: '작업 ID' });
  if ((id as HTMLInputElement).value !== taskId) {
    await userEvent.clear(id);
    await userEvent.type(id, taskId);
  }
  if (taskType) await userEvent.selectOptions(within(form).getByRole('combobox', { name: '작업 유형' }), taskType);
  await userEvent.click(within(form).getByRole('button', { name: '지금 담당 확인' }));
  await screen.findByTestId('current-assignee');
  const select = within(form).getByRole('combobox', { name: '맡길 작업자' });
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
  await userEvent.selectOptions(select, worker);
  return form;
}

describe('배정 목록', () => {
  it('기본은 진행 중(state 를 보내지 않는다), 최근 순. 지금 맡을 수 없는 배정·근무 밖 경고는 서버 값', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['TASK-PACK-1', 'TASK-PICK-3', 'TASK-PICK-1']);
    expect(within(rows()[0]!).getByText('근무 밖')).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('다음 작업 받기')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('지금은 맡을 수 없음(재직 중이 아님)')).toBeInTheDocument();
    expect(new URL(view.gets('/assignments')[0]!.url).searchParams.get('state')).toBeNull();
  });

  it('상태(바뀜) 거르기는 URL 쿼리 → 서버로', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'SUPERSEDED');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(new URL(view.gets('/assignments').at(-1)!.url).searchParams.get('state')).toBe('SUPERSEDED');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/assignments`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 배정이 없어요.')).not.toBeInTheDocument();
  });
});

describe('직접 배정', () => {
  it('목록의 "다시 배정" → 지금 담당 확인(버전 2) → 그 버전으로 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(within(rows()[1]!).getByRole('button', { name: '다시 배정' }));
    const form = await checkAndPick('TASK-PICK-3', 'OP-wkr-1');
    expect(screen.getByTestId('current-assignee')).toHaveTextContent('지금 담당 OP-wkr-3 (버전 2)');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText(/OP-wkr-1 에게 배정했어요\(버전 3\)/)).toBeInTheDocument();
    const post = postsTo(view.sent, '/assignments')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('2');
    expect(await sentBody(post)).toEqual({ mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-3', taskType: 'PICK', workerId: 'OP-wkr-1' });
  });

  it('지금 담당을 확인하기 전에는 배정 단추가 꺼져 있다', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await screen.findByRole('form', { name: '직접 배정' });
    await userEvent.type(within(form).getByRole('textbox', { name: '작업 ID' }), 'TASK-PICK-2');
    expect(within(form).getByRole('button', { name: '배정' })).toBeDisabled();
  });

  it('같은 사람에게 다시 정하면 "바뀐 것 없음"', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PICK-1', 'OP-wkr-1');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('이미 그 작업자가 담당이에요. 바뀐 것이 없어요.')).toBeInTheDocument();
  });

  it('업무에 없는 작업 유형이면 DUTY_NOT_ALLOWED 문구', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PACK-9', 'OP-wkr-2', 'PACK');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('이 작업자의 업무에 없는 작업 유형이에요.')).toBeInTheDocument();
  });

  it('확인한 뒤 누가 먼저 바꿨으면 VERSION_CONFLICT 문구', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PICK-2', 'OP-wkr-1');
    expect(screen.getByTestId('current-assignee')).toHaveTextContent('지금 담당이 없어요(버전 0).');
    db.assignments = [
      ...db.assignments,
      { assignmentId: 'ASG-X', mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-2', taskType: 'PICK', workerId: 'OP-wkr-2', assignmentVersion: 1, state: 'ACTIVE', assignedAt: '2026-11-16T01:00:00.000Z' },
    ];
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('다른 사람이 먼저 바꿨어요. 새로 고침한 뒤 다시 해 주세요.')).toBeInTheDocument();
  });
});

describe('배정 추천', () => {
  async function calculate(view: ReturnType<typeof renderAt>) {
    await userEvent.click(await screen.findByRole('button', { name: '추천 계산' }));
    await screen.findByRole('heading', { level: 1, name: /PLAN-/ });
    return postsTo(view.sent, '/assignment-plans')[0]!;
  }

  it('계산 → 추천 화면(배정은 아직 그대로) → 확정하면 배정이 생긴다', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments?tab=plan');
    expect(await screen.findByText(/지난 추천 목록은 서버 API 가 아직 없어요/)).toBeInTheDocument();
    const post = await calculate(view);
    expect(await sentBody(post)).toEqual({ mfcId: 'MFC-BSN-01', horizonMinutes: 60 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('추천됨(확정 전)');
    const items = screen.getAllByTestId('plan-item');
    expect(within(items[0]!).getByText('TASK-PICK-2')).toBeInTheDocument();
    expect(within(items[0]!).getByText('OP-wkr-1')).toBeInTheDocument();
    expect(db.assignments.some((a) => a.taskId === 'TASK-PICK-2')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '추천 확정' }));
    expect(await screen.findByText('추천을 확정했어요.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('확정됨');
    expect(db.assignments.some((a) => a.taskId === 'TASK-PICK-2' && a.state === 'ACTIVE')).toBe(true);
  });

  it('그 사이 작업이 바뀌면 확정하지 않고(409 PLAN_STALE) 낡은 이유를 보인다', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments?tab=plan');
    await calculate(view);
    db.tasks.set('TASK-PICK-2', { ...db.tasks.get('TASK-PICK-2')!, state: 'ASSIGNED' });
    await userEvent.click(screen.getByRole('button', { name: '추천 확정' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('낡음 — 다시 계산'));
    // 거절 문구는 계획을 다시 읽은 뒤(STALE)에도 남는다
    await waitFor(() => expect(screen.getByText('그 사이 바뀐 작업이 있어 확정하지 않았어요. 다시 계산해 주세요.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '추천 확정' })).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-reasons')).toHaveTextContent('TASK-PICK-2');
    expect(db.assignments.some((a) => a.taskId === 'TASK-PICK-2')).toBe(false);
  });

  it('계산 범위는 10~480분만 보낸다', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=plan');
    const input = await screen.findByRole('spinbutton', { name: /계산 범위/ });
    await userEvent.clear(input);
    await userEvent.type(input, '600');
    expect(screen.getByRole('button', { name: '추천 계산' })).toBeDisabled();
  });
});
