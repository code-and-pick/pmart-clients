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
    expect(await within(strip).findByTestId('strip-unassigned')).toHaveTextContent(/안 맡음1건 이상/);
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
    await userEvent.click(within(screen.getByTestId('queue-nav')).getByRole('link', { name: '‹ 보던 목록으로' }));
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
    await waitFor(() => expect(document.title).toMatch(/^\(\d+\) 배송 찾기 · PMart 라이더 백오피스$/));
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
  it('목록의 처리자는 이름 · 사번, hr 이 모르면 "직원 …끝 6자리" 그대로', async () => {
    renderAt('/staff-actions', as.admin);
    await screen.findAllByTestId('staff-action-row');
    const names = await screen.findAllByTestId('staff-name');
    await waitFor(() => expect(names.some((n) => n.textContent?.includes('P2026-'))).toBe(true));
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
