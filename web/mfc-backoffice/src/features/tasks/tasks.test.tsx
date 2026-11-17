// 작업 현황 화면 — mfc-fulfillment-service 0.4.11 목.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('task-row');
const firstCells = () => rows().map((r) => within(r).getAllByRole('cell')[0]!.textContent);
const heading = () => screen.findByRole('heading', { level: 1, name: /TASK-/ });
const problem = (status: number, code: string) =>
  HttpResponse.json({ type: 'about:blank', status, code }, { status, headers: { 'content-type': 'application/problem+json' } });

describe('작업 목록', () => {
  it('기본은 담당·진행 중(서버 기본 — state 를 보내지 않는다), 생긴 순. 늦음·멈춤은 서버 표시값', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(firstCells()).toEqual(['복귀', '피킹', '포장']));
    expect(within(rows()[0]!).getByText('늦음')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('멈춤(30분 실적 없음)')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('서울우유 1L 외 1건')).toBeInTheDocument();
    expect(screen.getByText(/담당 기준/)).toBeInTheDocument();
    const q = new URL(view.gets('/tasks')[0]!.url).searchParams;
    expect([q.get('mfcId'), q.getAll('state')]).toEqual(['MFC-BSN-01', []]);
  });

  it('상태(대기)·유형 거르기는 URL 쿼리 → 서버로', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'READY');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('없음')).toBeInTheDocument();
    expect(new URL(view.gets('/tasks').at(-1)!.url).searchParams.getAll('state')).toEqual(['READY']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '유형' }), 'PACK');
    expect(await screen.findByText('조건에 맞는 작업이 없어요.')).toBeInTheDocument();
    expect(new URL(view.gets('/tasks').at(-1)!.url).searchParams.get('type')).toBe('PACK');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/tasks`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 작업이 없어요.')).not.toBeInTheDocument();
  });

  it('확인 필요 포장은 지금 현장 작업자만 — 안내만 보인다(목록을 부르지 않는다)', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    expect(await screen.findByRole('note')).toHaveTextContent('현장 작업자(PDA)만');
    expect(view.gets('/packages')).toHaveLength(0);
  });
});

describe('작업 상세', () => {
  it('줄·출하·포장, 인계 판정은 누를 때만 부른다', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks/TASK-PICK-1');
    await heading();
    expect(screen.getAllByTestId('task-line')).toHaveLength(2);
    expect(screen.getByText('최단 경로')).toBeInTheDocument();
    const pkg = (await screen.findAllByTestId('package-row'))[0]!;
    expect(within(pkg).getByText('밀봉')).toBeInTheDocument();
    expect(view.gets('/handover-resolution')).toHaveLength(0);
    await userEvent.click(within(pkg).getByRole('button', { name: '인계 판정 보기' }));
    const r = await screen.findByTestId('resolution');
    expect(r).toHaveTextContent('인계 전(중지 없음)');
    expect(r).toHaveTextContent('점원 확인 필요');
  });

  it('작업 내놓기: 지금 담당을 보내고, 서버가 대기로 돌려주면 그렇게 보인다', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks/TASK-PICK-1');
    await heading();
    await userEvent.type(screen.getByRole('textbox', { name: '내놓는 사유(선택)' }), '교대');
    await userEvent.click(screen.getByRole('button', { name: '작업 내놓기' }));
    expect(await screen.findByText('작업을 내놓았어요. 대기로 돌아갔어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('대기(담당 없음)'));
    expect(screen.queryByRole('button', { name: '작업 내놓기' })).not.toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(await post.clone().json()).toEqual({ workerId: 'OP-wkr-1', reason: '교대' });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('재고 확정 대기 실적이 있으면 안내, 내놓기는 서버가 EXECUTION_IN_FLIGHT 로 거절', async () => {
    renderAt('/c/MFC-BSN-01/tasks/TASK-RET-1');
    await heading();
    expect(screen.getByText(/재고 확정을 기다리는 실적이 1건/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '작업 내놓기' }));
    expect(await screen.findByText('진행 중인 실적·포장이 있어요. 끝난 뒤에 내놓을 수 있어요.')).toBeInTheDocument();
    expect(db.tasks.get('TASK-RET-1')!.state).toBe('IN_PROGRESS');
  });

  it('결과 불명(503)이면 실패로 확정하지 않고 같은 키로 다시 확인', async () => {
    let first = true;
    server.use(
      http.post(`${API_BASE}/tasks/:taskId/releases`, () => {
        if (first) {
          first = false;
          return problem(503, 'DEPENDENCY_UNAVAILABLE');
        }
        return undefined;
      }),
    );
    const view = renderAt('/c/MFC-BSN-01/tasks/TASK-PACK-1');
    await heading();
    await userEvent.click(screen.getByRole('button', { name: '작업 내놓기' }));
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '작업 내놓기' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByText('작업을 내놓았어요. 대기로 돌아갔어요.')).toBeInTheDocument();
    const keys = view.sent.filter((r) => r.method === 'POST').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('막힌 작업: 막힌 이유를 보이고 내놓기 단추가 없다', async () => {
    renderAt('/c/MFC-BSN-01/tasks/TASK-PICK-3');
    await heading();
    expect(screen.getByText('결품 보고 — 신라면 5입')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '작업 내놓기' })).not.toBeInTheDocument();
  });

  it('출하 조회 실패는 "포장 없음"이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/shipments/:shipmentId`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/tasks/TASK-PICK-1');
    await heading();
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('아직 포장이 없어요.')).not.toBeInTheDocument();
  });
});
