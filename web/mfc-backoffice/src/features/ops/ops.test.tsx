// 센터 운영판·예외 처리함 — 목(MSW). 출하 약속은 서버 asOf 기준으로 판정해 시계와 무관하게 시험한다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { minutesText, promiseRows } from './opsRules';

const NOW = '2026-11-19T03:00:00.000Z';
const at = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();

interface T {
  readonly taskId: string;
  readonly taskType?: string;
  readonly state?: string;
  readonly shipmentId?: string | null;
  readonly promisedReadyAt?: string | null;
  readonly orderNumber?: string | null;
  readonly workerId?: string | null;
}
const task = (t: T) => ({
  taskId: t.taskId,
  taskType: t.taskType ?? 'PICK',
  state: t.state ?? 'IN_PROGRESS',
  version: 1,
  mfcId: 'MFC-BSN-01',
  fulfillmentId: `FUL-${t.taskId}`,
  shipmentId: t.shipmentId === undefined ? `SHP-${t.taskId}` : t.shipmentId,
  orderNumber: t.orderNumber ?? null,
  assignment: { workerId: t.workerId ?? null, assignmentVersion: 1 },
  lineCount: 1,
  plannedQty: 1,
  completedQty: 0,
  remainingQty: 1,
  promisedReadyAt: t.promisedReadyAt === undefined ? null : t.promisedReadyAt,
  createdAt: '2026-11-19T02:00:00.000Z',
  late: false,
  idle: false,
  lastActivityAt: null,
  headline: { productName: '서울우유 1L', otherLineCount: 0 },
});

/** 작업 목록을 바꾼다(쪽마다 nextCursor) */
function withTasks(pages: ReadonlyArray<ReadonlyArray<ReturnType<typeof task>>>) {
  server.use(
    http.get(`${API_BASE}/tasks`, ({ request }) => {
      const cursor = Number(new URL(request.url).searchParams.get('cursor') ?? 0);
      const next = cursor + 1 < pages.length ? String(cursor + 1) : null;
      return HttpResponse.json({ items: pages[cursor] ?? [], page: { nextCursor: next, size: 200 }, asOf: { asOf: NOW, freshness: 'CURRENT' } });
    }),
  );
}

const standard = () =>
  withTasks([
    [
      // 초과 30분 — 피킹·포장이 같은 출고(한 건으로)
      task({ taskId: 'TASK-PICK-1', shipmentId: 'SHP-1', promisedReadyAt: at(-30), orderNumber: '20000001', workerId: 'OP-wkr-1' }),
      task({ taskId: 'TASK-PACK-1', taskType: 'PACK', state: 'WAITING', shipmentId: 'SHP-1', promisedReadyAt: at(-30) }),
      // 임박 10분
      task({ taskId: 'TASK-PICK-2', state: 'READY', shipmentId: 'SHP-2', promisedReadyAt: at(10) }),
      // 여유(임박 아님)
      task({ taskId: 'TASK-PICK-5', shipmentId: 'SHP-5', promisedReadyAt: at(90) }),
      // 약속 시각 없음 — 세지 않는다
      task({ taskId: 'TASK-PICK-6', shipmentId: 'SHP-6', promisedReadyAt: null }),
      // 복귀 작업은 출하 약속과 무관
      task({ taskId: 'TASK-RET-1', taskType: 'RETURN', shipmentId: null, promisedReadyAt: at(-100) }),
    ],
  ]);

const value = (id: string) => screen.findByTestId(`${id}-value`);
const rows = () => screen.queryAllByTestId('exception-row');

describe('출하 약속 규칙(opsRules)', () => {
  it('출고별로 묶고, 약속 시각 없는 출고는 빼고, 임박은 기준 분 안', () => {
    const now = Date.parse(NOW);
    const r = promiseRows(
      [
        task({ taskId: 'A', shipmentId: 'S1', promisedReadyAt: at(-5) }),
        task({ taskId: 'B', taskType: 'PACK', state: 'WAITING', shipmentId: 'S1', promisedReadyAt: at(-5) }),
        task({ taskId: 'C', shipmentId: 'S2', promisedReadyAt: at(14) }),
        task({ taskId: 'D', shipmentId: 'S3', promisedReadyAt: at(15) }),
        task({ taskId: 'E', shipmentId: 'S4', promisedReadyAt: null }),
        task({ taskId: 'F', state: 'COMPLETED', shipmentId: 'S5', promisedReadyAt: at(-50) }),
      ] as never,
      now,
    );
    expect([r.overdue, r.dueSoon, r.noPromise]).toEqual([1, 1, 1]);
    expect(r.rows[0]!.task.taskId).toBe('A'); // 지금 단계 = 피킹
    expect(minutesText(75)).toBe('1시간 15분');
  });
});

describe('센터 운영판', () => {
  it('센터 첫 화면이 홈(오늘 센터 현황)이고 왼쪽 메뉴 맨 위 "홈"으로 돌아온다', async () => {
    standard();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: '오늘 센터 현황' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈' })).toHaveAttribute('href', '/c/MFC-BSN-01/ops');
  });

  it('내 할 일 숫자 칸: 출하 약속(서버 약속 시각) · 결품·파손(서버 지표) · 인계 확인 필요 — 작업 목록은 끝나지 않은 상태를 모두, 큰 쪽으로', async () => {
    standard();
    const view = renderAt('/c/MFC-BSN-01/ops');
    expect(await value('tile-overdue')).toHaveTextContent('1건');
    expect(await value('tile-due')).toHaveTextContent('1건');
    expect(screen.getByTestId('ops-rules')).toHaveTextContent('임박 = 약속 시각까지 15분 안');
    expect(screen.getByTestId('ops-rules')).toHaveTextContent('약속 시각 없는 출고 1건은 세지 않아요');
    expect(await value('tile-short')).toHaveTextContent('2줄');
    expect(await value('tile-damaged')).toHaveTextContent('1줄');
    expect(await value('tile-handover')).toHaveTextContent('1건');
    // 이상 N 한 줄(서버 숫자) — 약속 초과·인계 확인·파손 사고
    expect(await screen.findByTestId('ops-status')).toHaveTextContent('이상 3');
    const q = new URL(view.gets('/tasks')[0]!.url).searchParams;
    expect([q.get('mfcId'), q.getAll('state'), q.get('size')]).toEqual(['MFC-BSN-01', ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'], '200']);
    const m = new URL(view.gets('/metrics/picking-lines')[0]!.url).searchParams;
    expect(m.get('from')).toBe(m.get('to'));
  });

  it('숫자 칸을 누르면 같은 화면 예외 목록이 그 유형만 — 행은 상세 화면으로 이어진다', async () => {
    standard();
    renderAt('/c/MFC-BSN-01/ops');
    await waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(4));

    // 출하 약속: 초과(30분 지남) → 임박(10분 남음), 작업 상세로
    await userEvent.click(screen.getByTestId('tile-overdue'));
    await waitFor(() => expect(rows().every((r) => r.dataset.group === 'promise')).toBe(true));
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('출하 약속 초과');
    expect(rows()[0]).toHaveTextContent('20000001');
    expect(rows()[0]).toHaveTextContent('30분 지남');
    expect(rows()[0]).toHaveTextContent('피킹 진행 중');
    expect(rows()[1]).toHaveTextContent('출하 약속 임박');
    expect(rows()[1]).toHaveTextContent('10분 남음');
    expect(rows()[1]).toHaveTextContent('정보 없음'); // 주문번호 없음
    expect(within(rows()[0]!).getByRole('link', { name: '작업 상세 — 재배정·작업 풀기' })).toHaveAttribute('href', '/c/MFC-BSN-01/tasks/TASK-PICK-1');

    // 결품·파손: 피킹 결품 보고로 열린 파손 사고만(직접 등록 사고 제외), 결품 건별 목록은 계약 없음 안내
    await userEvent.click(screen.getByTestId('tile-damaged'));
    await waitFor(() => expect(rows().every((r) => r.dataset.group === 'picking')).toBe(true));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('피킹 파손');
    expect(rows()[0]).toHaveTextContent('LOT-MILK-A');
    expect(within(rows()[0]!).getByRole('link', { name: '품질 사고 — 격리·폐기' })).toHaveAttribute('href', '/c/MFC-BSN-01/quality?tab=incidents&incidentId=QI-1');
    expect(screen.getByText(/결품\(SHORT\) 건별 목록은 서버에 센터 조회가 없어/)).toBeInTheDocument();

    // 인계 확인: 확인 필요 포장 화면으로(확인 버튼은 그 화면)
    await userEvent.click(screen.getByTestId('tile-handover'));
    await waitFor(() => expect(rows().every((r) => r.dataset.group === 'handover')).toBe(true));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('PKG-1');
    expect(within(rows()[0]!).getByRole('link', { name: '확인 필요 포장 — 실물 확인' })).toHaveAttribute('href', '/c/MFC-BSN-01/tasks#handover-checks');
    expect(screen.queryByRole('button', { name: '포장대에 있음' })).not.toBeInTheDocument();

    // 상세로 이동 — 작업 상세(작업 풀기는 그 화면)
    await userEvent.click(screen.getByRole('button', { name: '출하 약속' }));
    await waitFor(() => expect(rows()[0]!.dataset.group).toBe('promise'));
    await userEvent.click(within(rows()[0]!).getByRole('link'));
    expect(await screen.findByRole('heading', { level: 1, name: /TASK-PICK-1/ })).toBeInTheDocument();
  });

  it('필터는 URL 에 — 주소로 바로 열어도 그 유형', async () => {
    standard();
    renderAt('/c/MFC-BSN-01/ops?type=handover');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]!.dataset.group).toBe('handover');
    expect(screen.getByRole('button', { name: '인계 확인' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('작업이 많으면 끝까지 읽되 상한을 넘으면 "N건 이상" — 첫 쪽만 세지 않는다', async () => {
    const page = (n: number) => Array.from({ length: 3 }, (_, i) => task({ taskId: `T-${n}-${i}`, shipmentId: `S-${n}-${i}`, promisedReadyAt: at(-5) }));
    withTasks([page(0), page(1), page(2), page(3), page(4), page(5)]);
    const view = renderAt('/c/MFC-BSN-01/ops');
    expect(await value('tile-overdue')).toHaveTextContent('15건 이상');
    expect(view.gets('/tasks')).toHaveLength(5);
    expect(screen.getByText(/앞의 15건까지만 읽었어요/)).toBeInTheDocument();
  });

  it('조회 실패는 0건이 아니다 — 실패한 원천만 "조회 실패", 나머지는 보인다', async () => {
    standard();
    server.use(http.get(`${API_BASE}/packages`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/ops');
    const tile = screen.getByTestId('tile-handover');
    expect(await within(tile).findByText('조회 실패')).toBeInTheDocument();
    expect(within(tile).queryByText('0건')).not.toBeInTheDocument();
    expect(await screen.findByTestId('source-failed-handover')).toHaveTextContent('인계 확인 필요 조회에 실패해');
    expect(await value('tile-overdue')).toHaveTextContent('1건');
    expect(screen.queryByText('처리할 예외가 없어요')).not.toBeInTheDocument();
  });

  it('실제 0건은 0건 — 예외가 없으면 빈 목록 안내', async () => {
    withTasks([[]]);
    server.use(
      http.get(`${API_BASE}/packages`, () => HttpResponse.json({ items: [], asOf: { asOf: NOW, freshness: 'CURRENT' } })),
      http.get(`${API_BASE}/quality-incidents`, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.get(`${API_BASE}/metrics/picking-lines`, () => HttpResponse.json({ items: [], asOf: NOW })),
    );
    renderAt('/c/MFC-BSN-01/ops');
    expect(await value('tile-overdue')).toHaveTextContent('0건');
    expect(await value('tile-due')).toHaveTextContent('0건');
    expect(await value('tile-short')).toHaveTextContent('0줄');
    expect(await value('tile-damaged')).toHaveTextContent('0줄');
    expect(await value('tile-handover')).toHaveTextContent('0건');
    expect(await screen.findByText('처리할 예외가 없어요')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ops-status')).toHaveTextContent('이상 없음'));
  });

  it('센터를 바꾸면 이전 센터 예외가 잠깐도 남지 않는다', async () => {
    standard();
    renderAt('/c/MFC-BSN-01/ops', as.sup2);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // 송파는 늦게 온다 — 오는 동안 부산진 값이 보이면 안 된다.
    server.use(
      http.get(`${API_BASE}/tasks`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('mfcId') === 'MFC-SEL-01') await delay(200);
        return HttpResponse.json({ items: [], page: { nextCursor: null, size: 200 }, asOf: { asOf: NOW, freshness: 'CURRENT' } });
      }),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '센터 고르기' }), 'MFC-SEL-01');
    expect(screen.queryByText('20000001')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tile-overdue-value')).not.toBeInTheDocument();
    expect(screen.queryByText('PKG-1')).not.toBeInTheDocument();
    expect(await value('tile-overdue')).toHaveTextContent('0건');
  });

  it('권한: 작업자 전용 계정은 막고, 맡지 않은 센터는 운영판을 부르지 않는다', async () => {
    renderAt('/c/MFC-BSN-01/ops', as.worker);
    expect(await screen.findByRole('alert')).toHaveTextContent(/PDA/);
    const view = renderAt('/c/MFC-SEL-02/ops');
    expect(await screen.findAllByText(/이 센터 권한이 없습니다/)).not.toHaveLength(0);
    expect(view.gets('/tasks')).toHaveLength(0);
  });
});
