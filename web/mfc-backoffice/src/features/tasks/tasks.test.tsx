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

  it('확인 필요 포장(MB-3): 센터 관리자도 목록을 보고, 가져감은 한 번 더 물은 뒤 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    const box = await screen.findByTestId('handover-checks');
    const row = (await within(box).findAllByTestId('handover-check-row'))[0]!;
    expect(row).toHaveTextContent('PKG-1');
    expect(row).toHaveTextContent('RDR-1');
    const req = view.gets('/packages')[0]!;
    expect(Object.fromEntries(new URL(req.url).searchParams)).toEqual({ mfcId: 'MFC-BSN-01', checkRequired: 'true' });

    // 취소하면 보내지 않는다.
    await userEvent.click(within(row).getByRole('button', { name: '포장대에 없음(라이더가 가져감)' }));
    await userEvent.click(within(row).getByRole('button', { name: '취소' }));
    expect(view.sent.filter((r) => r.method === 'POST' && r.url.endsWith('/handover-checks'))).toHaveLength(0);

    await userEvent.click(within(row).getByRole('button', { name: '포장대에 없음(라이더가 가져감)' }));
    expect(within(row).getByRole('alertdialog')).toHaveTextContent('되돌릴 수 없어요');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(view.sent.some((r) => r.method === 'POST' && r.url.endsWith('/packages/PKG-1/handover-checks'))).toBe(true));
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/packages/PKG-1/handover-checks'))!;
    expect(await post.clone().json()).toEqual({ result: 'TAKEN_BY_RIDER' });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    // 확정되면 목록을 다시 읽어 그 포장이 빠진다.
    expect(await within(box).findByText('확인할 포장이 없어요')).toBeInTheDocument();
  });

  it('확인 필요 포장: 허가가 아직 살아 있으면(409 FENCE_ACTIVE) 거절 안내', async () => {
    server.use(http.post(`${API_BASE}/packages/:id/handover-checks`, () => HttpResponse.json({ status: 409, code: 'FENCE_ACTIVE', title: 'x', type: 'about:blank' }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BSN-01/tasks');
    const row = (await screen.findAllByTestId('handover-check-row'))[0]!;
    await userEvent.click(within(row).getByRole('button', { name: '포장대에 있음' }));
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    expect(await within(row).findByRole('alert')).toBeInTheDocument();
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
    // 화면용 주문번호·라벨 인계 숫자(fulfillment 0.13.0 F-5·F-8)
    expect(screen.getByTestId('order-number')).toHaveTextContent('주문번호 20000001');
    expect(within(pkg).getByTestId('handover-code')).toHaveTextContent('482913');
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

// 담당 바꾸기·내려놓기(백엔드 알림 2026-11-19 notice-reassign-release — 서버 변경 없음)
describe('작업 목록 행 조치', () => {
  const rowOf = (type: string) => rows().find((r) => within(r).getAllByRole('cell')[0]!.textContent === type)!;

  it('늦음·멈춤 행이 위로, 진행 중·배정됨은 담당 바꾸기·내려놓기', async () => {
    renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(rows()).toHaveLength(3));
    // 복귀(늦음)·피킹(멈춤)이 포장보다 위
    expect(firstCells()).toEqual(['복귀', '피킹', '포장']);
    const pick = rowOf('피킹');
    expect(within(pick).getByRole('button', { name: '담당 바꾸기' })).toBeInTheDocument();
    expect(within(pick).getByRole('button', { name: '내려놓기' })).toBeInTheDocument();
  });

  it('담당 바꾸기: 그 유형을 맡을 수 있는 재직 작업자만(휴게 중 표시), 진행 중이면 현장 주의, 지금 배정 버전·사유를 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(within(rowOf('피킹')).getByRole('button', { name: '담당 바꾸기' }));
    const form = await screen.findByRole('form', { name: /담당 바꾸기/ });
    expect(within(form).getByTestId('reassign-warn')).toHaveTextContent('"시작"부터 다시');
    expect(within(form).getByTestId('reassign-warn')).toHaveTextContent('장바구니');
    const select = await within(form).findByRole('combobox', { name: '새 담당' });
    // 지금 담당(OP-wkr-1)·정지(OP-wkr-3)·피킹 업무 없는 사람은 없다
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['작업자 고르기', '이알바 (OP-wkr-2) · 휴게 중']);
    expect(within(form).getByRole('button', { name: '담당 바꾸기' })).toBeDisabled(); // 사유 전
    await userEvent.selectOptions(select, 'OP-wkr-2');
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '교대');
    await userEvent.click(within(form).getByRole('button', { name: '담당 바꾸기' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('OP-wkr-2 에게 넘겼어요.');
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/assignments'))!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-1', taskType: 'PICK', workerId: 'OP-wkr-2', reason: '교대' });
    // 목록을 다시 읽어 새 담당이 보인다
    await waitFor(() => expect(within(rowOf('피킹')).getByText(/이알바|OP-wkr-2/)).toBeInTheDocument());
  });

  it('담당 바꾸기: 그 사이 다른 배정(409 VERSION_CONFLICT)이면 거절 안내', async () => {
    server.use(http.post(`${API_BASE}/assignments`, () => problem(409, 'VERSION_CONFLICT')));
    renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(within(rowOf('피킹')).getByRole('button', { name: '담당 바꾸기' }));
    const form = await screen.findByRole('form', { name: /담당 바꾸기/ });
    await userEvent.selectOptions(await within(form).findByRole('combobox', { name: '새 담당' }), 'OP-wkr-2');
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '지연');
    await userEvent.click(within(form).getByRole('button', { name: '담당 바꾸기' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('다른 사람이 먼저 바꿨어요');
  });

  it('내려놓기: 사유를 받아 지금 담당으로 보내고 대기로, 실적이 처리 중이면(409 EXECUTION_IN_FLIGHT) 안내', async () => {
    const view = renderAt('/c/MFC-BSN-01/tasks');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(within(rowOf('피킹')).getByRole('button', { name: '내려놓기' }));
    const form = await screen.findByRole('form', { name: /내려놓기/ });
    expect(within(form).getByRole('button', { name: '내려놓기' })).toBeDisabled();
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '교대');
    await userEvent.click(within(form).getByRole('button', { name: '내려놓기' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('내려놓았어요');
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/tasks/TASK-PICK-1/releases'))!;
    expect(await post.clone().json()).toEqual({ workerId: 'OP-wkr-1', reason: '교대' });

    // 복귀 작업은 확정 대기 실적이 있어 거절
    await userEvent.click(within(rowOf('복귀')).getByRole('button', { name: '내려놓기' }));
    const form2 = await screen.findByRole('form', { name: /내려놓기/ });
    await userEvent.type(within(form2).getByRole('textbox', { name: '사유' }), '교대');
    await userEvent.click(within(form2).getByRole('button', { name: '내려놓기' }));
    expect(await within(form2).findByRole('alert')).toHaveTextContent('진행 중인 실적');
  });
});
