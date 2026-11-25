// 통합 백오피스와 맞추기(2026-11-19 — 지침 all/2026-11-19-request-ui-ux-align) — 목(MSW) 기준. 브라우저 확인은 아니다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { matches } from '../shared/SearchSelect';
import { server } from '../test/server';
import { as, renderAt } from '../test/render';

describe('목록 — 숫자 띠(서버가 센 값만)', () => {
  it('배송 찾기: 상태별 수(delivery-stats), 누르면 그 상태로 거른다', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    const strip = await screen.findByTestId('delivery-strip');
    expect(await within(strip).findByTestId('strip-UNASSIGNED')).toHaveTextContent(/1$/);
    expect(within(strip).getByTestId('strip-all')).toHaveTextContent(/4$/);
    await userEvent.click(within(strip).getByTestId('strip-FAILURE_REPORTED'));
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/deliveries') && new URL(r.url).searchParams.get('state') === 'FAILURE_REPORTED')).toBe(true));
    expect(within(strip).getByTestId('strip-FAILURE_REPORTED')).toHaveAttribute('aria-current', 'true');
  });

  it('통계를 못 읽으면 0 이 아니라 "?"', async () => {
    server.use(http.get(`${API_BASE}/delivery-stats`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'UNAVAILABLE', traceId: 't' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/deliveries', as.riderOps);
    const strip = await screen.findByTestId('delivery-strip');
    await waitFor(() => expect(within(strip).getByTestId('strip-all')).toHaveTextContent(/\?$/));
    expect(within(strip).getByTestId('strip-UNASSIGNED')).toHaveTextContent(/\?$/);
  });

  it('접수 건: 안 맡음·기한 넘김 수는 목록 한 쪽으로 — 다음 쪽이 있으면 "N건 이상"', async () => {
    server.use(
      http.get(`${API_BASE}/cases`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get('unassigned') === 'true') return HttpResponse.json({ items: [{ caseId: 'C-x', kind: 'RIDER_HELP', state: 'OPEN' }], page: { nextCursor: 'n2' } });
        return undefined;
      }),
    );
    renderAt('/cases', as.riderOps);
    const strip = await screen.findByTestId('case-strip');
    expect(await within(strip).findByTestId('strip-unassigned')).toHaveTextContent(/1건 이상$/); // 가로형 카드: 이름·도움말 왼쪽, 끝에 숫자(지침 §7 — 끝 숫자로 확인)
  });
});

describe('목록 → 상세', () => {
  it('목록 순서대로 이전·n/N·다음([ ] 키), 돌아오면 "최근 봄"', async () => {
    renderAt('/deliveries', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    expect(screen.queryByTestId('seen-mark')).not.toBeInTheDocument();
    await userEvent.click(within(rows[1]!).getAllByRole('link')[0]!);
    const nav = await screen.findByTestId('queue-nav');
    expect(within(nav).getByTestId('queue-pos')).toHaveTextContent('2 / 4');
    await userEvent.keyboard(']');
    await waitFor(() => expect(screen.getByTestId('queue-pos')).toHaveTextContent('3 / 4'));
    // "‹ 보던 목록으로"는 없앴다(2026-11-25) — 제목 앞 ‹ 단추로 돌아간다
    expect(within(screen.getByTestId('queue-nav')).queryByText(/보던 목록으로/)).toBeNull();
    // 시험 라우터는 history 순번이 없어 ‹ 가 바로 그 목록으로 간다(브라우저에서는 앱 안 이동이면 뒤로)
    await userEvent.click(screen.getAllByTestId('detail-back')[0]!);
    await screen.findAllByTestId('delivery-row');
    // 상세 두 건을 열어 봤다 — 그 두 줄에 "최근 봄"(이 브라우저에만 기억)
    expect(await screen.findAllByTestId('seen-mark')).toHaveLength(2);
  });

  it('배송 상세 진행 단계: 전달 실패 등록이면 고객 도착 단계에서 멈춤(지금 단계만 숨쉬기), 앞 단계는 끝남', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const steps = await screen.findByTestId('delivery-steps');
    const now = within(steps).getByRole('listitem', { current: 'step' });
    expect(now).toHaveTextContent('고객 도착');
    expect(now).toHaveTextContent('전달 실패 등록');
    expect(within(steps).getAllByTestId('step-pulse')).toHaveLength(1);
    expect(steps.querySelectorAll('[data-step-state="done"]')).toHaveLength(4);
  });
});

describe('화면 틀', () => {
  it("'/' 키는 이 화면 검색 조건의 첫 칸으로(입력 칸 안에서는 그냥 글자)", async () => {
    renderAt('/deliveries', as.riderOps);
    const form = await screen.findByRole('form', { name: '검색 조건' });
    await userEvent.keyboard('/');
    expect(form.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('INPUT');
  });

  it('브라우저 탭 제목: 화면 이름 + 아직 받지 않은 도움요청 수', async () => {
    renderAt('/deliveries', as.riderOps);
    await waitFor(() => expect(document.title).toMatch(/^\(\d+\) 배송 관리 \| 라이더백오피스$/));
  });

  it('인터넷이 끊기면 띠로 알리고, 다시 이어지면 잠깐 알린다', async () => {
    renderAt('/dashboard', as.riderOps);
    await screen.findByTestId('todo-strip');
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    try {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      act(() => void window.dispatchEvent(new Event('offline')));
      expect(await screen.findByTestId('offline-banner')).toHaveTextContent('인터넷 연결이 끊겼어요.');
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      act(() => void window.dispatchEvent(new Event('online')));
      expect(await screen.findByTestId('online-again')).toBeInTheDocument();
    } finally {
      delete (navigator as { onLine?: boolean }).onLine;
      if (online) Object.defineProperty(Navigator.prototype, 'onLine', online);
    }
  });

  it('밝은/어두운 화면 단추', async () => {
    renderAt('/dashboard', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '어두운 화면으로' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'pmart-dark');
    await userEvent.click(screen.getByRole('button', { name: '밝은 화면으로' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'pmart');
  });

  it('쳐서 찾는 고르기: 초성으로도 찾는다', () => {
    expect(matches({ value: 'MFC-BSJ-01', label: 'PMart 부산진구지점', keywords: 'MFC-BSJ-01' }, 'ㅂㅅㅈ')).toBe(true);
    expect(matches({ value: 'MFC-BSJ-01', label: 'PMart 부산진구지점', keywords: 'MFC-BSJ-01' }, 'bsj-01')).toBe(true);
    expect(matches({ value: 'MFC-BSJ-01', label: 'PMart 부산진구지점' }, 'ㄱㄴ')).toBe(false);
  });

  it('센터 고르기는 쳐서 찾는 칸 — 센터 ID 는 목록에 보이지 않는다(ADR-0070)', async () => {
    renderAt('/dashboard', as.riderOps);
    const picker = await screen.findByRole('combobox', { name: '센터' });
    await waitFor(() => expect(picker).not.toBeDisabled());
    await userEvent.type(picker, 'ㅂㅅ');
    const option = await screen.findByRole('option', { name: 'PMart 부산진구지점' });
    expect(option).not.toHaveTextContent('MFC-');
    fireEvent.click(option);
    expect(picker).toHaveValue('PMart 부산진구지점');
  });
});

describe('움직임', () => {
  it('접수 건 기한 15분 안이면 남은 분(숨쉬기), 기한 넘김은 서버 overdue 그대로', async () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    server.use(
      http.get(`${API_BASE}/cases`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get('unassigned') || q.get('overdue')) return undefined;
        return HttpResponse.json({ items: [{ caseId: 'C-soon', kind: 'RIDER_HELP', state: 'OPEN', priority: 'P2', summary: '곧 기한', slaDueAt: soon, overdue: false }], page: { nextCursor: null } });
      }),
    );
    renderAt('/cases', as.riderOps);
    const mark = await screen.findByTestId('sla-soon');
    expect(mark).toHaveTextContent(/(9|10)분 남음/);
    expect(mark).toHaveClass('breathe');
  });
});

describe('직원 이름 · 사번(hr employee-labels)', () => {
  it('목록의 처리자는 이름만(사번은 올려 보면), hr 이 모르면 "직원 …끝 6자리" 그대로', async () => {
    renderAt('/staff-actions', as.admin);
    await screen.findAllByTestId('staff-action-row');
    const names = await screen.findAllByTestId('staff-name');
    await waitFor(() => expect(names.some((n) => n.getAttribute('title')?.includes('P2026-'))).toBe(true));
    for (const n of screen.getAllByTestId('staff-name')) expect(n.textContent).not.toMatch(/P2026-/);
    for (const n of screen.getAllByTestId('staff-name')) expect(n.textContent).not.toMatch(/^OP-/);
  });

  it('hr 를 못 읽으면 이름을 지어내지 않고 전처럼 "직원 …"', async () => {
    server.use(http.get(`${API_BASE}/hr/employee-labels`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'UNAVAILABLE', traceId: 't' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/staff-actions', as.admin);
    await screen.findAllByTestId('staff-action-row');
    const names = await screen.findAllByTestId('staff-name');
    await waitFor(() => expect(names[0]).toHaveTextContent(/직원/));
    expect(screen.queryByText(/P2026-/)).not.toBeInTheDocument();
  });
});

// 2차(2026-11-19 — PR #224·#231·#232 가 main 에 들어간 뒤): 쿠팡 윙 겉모습·안내 상자·다 끝났어요·검색 칩·관제 두 줄 카드
const at = '2026-11-17T05:00:00.000Z';
const gps = { lat: 35.15, lng: 129.06, recordedAt: at, receivedAt: at, quality: 'GOOD' };
const problem = { type: 'about:blank', title: 'x', status: 503, code: 'UNAVAILABLE', traceId: 't' };
const fail503 = () => HttpResponse.json(problem, { status: 503, headers: { 'content-type': 'application/problem+json' } });

describe('2차 — 겉모습·안내·다 끝났어요', () => {
  // 2026-11-20 웹 백오피스 맞추기: 쿠팡 윙(data-skin=wing) → 공용 콘솔 틀(흰 메뉴·위치 줄) — 통합 백오피스와 같다
  it('공용 콘솔 틀 — 윙 표시 없음, 흰 왼쪽 메뉴(side-menu)·위치 줄(page-title)', async () => {
    renderAt('/deliveries', as.riderOps);
    await screen.findAllByTestId('delivery-row');
    expect(document.querySelector('main')).not.toHaveAttribute('data-skin');
    expect(screen.getByTestId('side-menu')).toHaveClass('bg-base-100');
    expect(screen.getByTestId('page-title')).toHaveTextContent('배송 관리');
  });

  it('진행 단계의 끝난 단계는 흰 선 체크(글자 ✓ 아님)', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const steps = await screen.findByTestId('delivery-steps');
    expect(within(steps).getAllByTestId('step-check')).toHaveLength(4);
    expect(steps).not.toHaveTextContent('✓');
  });

  it('상담 관리에는 화면 안내(ⓘ) 줄이 없다(2026-11-24 사용자 "i 화면 안내 없애")', async () => {
    renderAt('/consults', as.riderOps);
    await screen.findByTestId('strip-help');
    expect(screen.queryByTestId('consults-guide')).not.toBeInTheDocument();
  });

  it('상담함: 세 원천이 모두 0건이면 "수고하셨어요", 하나라도 못 읽으면 그리지 않는다', async () => {
    const emptyDeliveries = http.get(`${API_BASE}/deliveries`, () => HttpResponse.json({ items: [], page: { nextCursor: null } }));
    server.use(http.get(`${API_BASE}/delivery-help-requests`, () => HttpResponse.json({ items: [] })), http.get(`${API_BASE}/inquiries`, () => HttpResponse.json({ items: [], page: { nextCursor: null } })), emptyDeliveries);
    const first = renderAt('/consults', as.riderOps);
    expect(await screen.findByTestId('consults-all-done')).toHaveTextContent('상담할 건이 없어요.');
    expect(screen.getByTestId('consults-all-done')).not.toHaveTextContent('수고하셨어요'); // 성공처럼 보이지 않게(2026-11-21)
    first.unmount();
    server.use(http.get(`${API_BASE}/inquiries`, fail503));
    renderAt('/consults', as.riderOps);
    expect(await screen.findByTestId('consults-partial')).toBeInTheDocument();
    expect(screen.queryByTestId('consults-all-done')).not.toBeInTheDocument();
  });

  it('추가 배달료: 거르기 없이 신청 0건이면 "수고하셨어요", 조회 실패면 오류(0건으로 보이지 않음)', async () => {
    server.use(http.get(`${API_BASE}/surcharge-requests`, () => HttpResponse.json({ items: [], page: { nextCursor: null } })));
    const first = renderAt('/surcharges', as.riderOps);
    expect(await screen.findByTestId('surcharge-all-done')).toHaveTextContent('처리할 신청이 없어요.');
    first.unmount();
    server.use(http.get(`${API_BASE}/surcharge-requests`, fail503));
    renderAt('/surcharges', as.riderOps);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('surcharge-all-done')).not.toBeInTheDocument();
  });

  it('검색 조건 칩(시뮬레이터 모양): 건 조건만 칩으로, 깔때기로 팝업을 열고, ✕ 로 하나만 푼다', async () => {
    const view = renderAt('/deliveries?state=FAILURE_REPORTED&riderId=RD-7', as.riderOps);
    const chips = await screen.findAllByTestId('search-chip');
    // 라이더는 찾기 칸에 보여 칩이 아니다(2026-11-24 "검색한 게 필터에 한 라이더라고 뜰 필요 없는") — 상태만 칩
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('전달 실패 등록');
    // 찾기 칸은 늘 보이고, 상태·종류 고르기는 팝업 안
    expect(screen.getByRole('form', { name: '검색 조건' })).toBeInTheDocument();
    expect(screen.queryByTestId('search-popup')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /거르기 조건 열기 \(1개 걸림\)/ }));
    expect(within(screen.getByTestId('search-popup')).getByRole('radio', { name: '전달 실패 등록' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('search-popup')).not.toBeInTheDocument();
    // ✕ = 그 조건만 풀기(라이더 조건은 남는다) — 주소가 정본
    await userEvent.click(screen.getByRole('button', { name: '수행 상태 조건 풀기' }));
    await waitFor(() => expect(screen.queryAllByTestId('search-chip')).toHaveLength(0));
    await waitFor(() => {
      const q = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/deliveries')).map((r) => new URL(r.url).searchParams).at(-1)!;
      expect(q.get('state')).toBeNull();    });
  });
});

describe('관제 — 시뮬레이터 모양(2026-11-25)', () => {
  it('맨 위 한 줄 확인할 일(위치 끊김·신규배차 꺼짐), 아래 숫자 칸(운행 중·배송 중·대기·위치 끊김)', async () => {
    server.use(
      http.get(`${API_BASE}/rider-locations`, () =>
        HttpResponse.json({
          asOf: at,
          items: [
            { riderId: 'RD-7', location: gps, stale: false, newDispatchEnabled: true, activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER' }, { deliveryId: 'DLV-3', stage: 'AT_STORE' }] },
            { riderId: 'RD-8', location: gps, stale: true, newDispatchEnabled: false, activeDeliveries: [] },
          ],
        }),
      ),
    );
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const boards = await screen.findByTestId('control-boards');
    expect(within(boards).getByTestId('control-stat-stale')).toHaveTextContent(/1명$/);
    expect(within(boards).getByTestId('control-stat-dispatch-off')).toHaveTextContent(/1명$/);
    expect(within(boards).getByTestId('control-issue-stale')).toHaveTextContent('위치 끊김·없음 1명');
    expect(within(boards).getByTestId('control-stat-all')).toHaveTextContent(/2명$/);
    expect(within(boards).getByTestId('control-flow-waiting')).toHaveTextContent(/0명$/);
    // 단계별 수 칸은 없다(배송 관리 진행 단계에 있음)
    expect(within(boards).queryByTestId('control-flow-TO_CUSTOMER')).toBeNull();
    expect(within(boards).getByTestId('control-flow-delivering')).toHaveTextContent(/1명$/);
    await userEvent.click(within(boards).getByTestId('control-stat-stale'));
    await waitFor(() => expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-8']));
  });

  it('확인할 일이 모두 0 이면 한 줄 "이상 없음"', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json({ asOf: at, items: [{ riderId: 'RD-7', location: gps, stale: false, newDispatchEnabled: true, activeDeliveries: [] }] })));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findByTestId('control-all-clear')).toHaveTextContent('이상 없음 — 지금 확인할 일이 없어요');
  });
});
