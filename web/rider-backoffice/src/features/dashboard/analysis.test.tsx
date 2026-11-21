// 대시보드 분석 구역(2026-11-21) — 목(MSW) 기준. 셈(타일)·막대 누르면 목록·배송 번호 누르면 같은 자리 흐름·읽기 상한 알림.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { ANALYSIS_MAX_PAGES } from './AnalysisSection';
import { dur, metrics, type Summary } from './analysisData';

const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

function rows(now: number): Summary[] {
  // 지금 1시간 안 — 최근 2시간 틀의 막대에 들어간다
  const base = (i: number, state: Summary['state'], extra: Partial<Summary> = {}): Summary => ({
    deliveryId: `DLV-T${i}`,
    deliveryNumber: `5000000${i}-1`,
    orderNumber: `5000000${i}`,
    version: 1,
    type: 'FORWARD',
    state,
    riderId: 'RD-7',
    mfcId: 'MFC-BSJ-01',
    createdAt: iso(now - 40 * MIN),
    ...extra,
  });
  return [
    base(1, 'COMPLETED', { assignedAt: iso(now - 38 * MIN), pickedUpAt: iso(now - 30 * MIN), completedAt: iso(now - 20 * MIN) }),
    base(2, 'COMPLETED', { assignedAt: iso(now - 36 * MIN), pickedUpAt: iso(now - 28 * MIN), completedAt: iso(now - 10 * MIN) }),
    base(3, 'FAILED', { assignedAt: iso(now - 37 * MIN), pickedUpAt: iso(now - 30 * MIN), completedAt: iso(now - 15 * MIN) }),
  ];
}

const serve = (items: readonly Summary[]) =>
  server.use(
    http.get(`${API_BASE}/deliveries`, ({ request }) => {
      if (new URL(request.url).searchParams.get('deliveryIds')) return undefined;
      return HttpResponse.json({ items, page: { nextCursor: null, size: 50 } });
    }),
  );

describe('대시보드 분석 셈', () => {
  it('완료율은 완료/(완료+실패), 한 건 평균은 완료 건의 생김 → 완료, 구간 셋', () => {
    const now = Date.now();
    const m = metrics(rows(now), now);
    expect(m.total).toBe(3);
    expect(Math.round((m.rate ?? 0) * 100)).toBe(67);
    expect(dur(m.avgTotalSec)).toBe('25분'); // (20 + 30) / 2
    expect(m.problems).toBe(1);
    expect(m.phases?.segments.map((s) => s.key)).toEqual(['find', 'store', 'customer']);
  });
});

describe('대시보드 분석 구역', () => {
  it('타일 수치 → 막대를 누르면 아래 목록 → 배송 번호를 누르면 같은 자리에 흐름', async () => {
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const section = await screen.findByTestId('analysis');
    expect(await within(section).findByTestId('an-tile-total')).toHaveTextContent('3건');
    expect(within(section).getByTestId('an-tile-rate')).toHaveTextContent('67%');
    expect(within(section).getByTestId('an-tile-problems')).toHaveTextContent('1건');
    const bar = within(section)
      .getAllByTestId('an-bar')
      .find((b) => /3건$/.test(b.getAttribute('aria-label') ?? ''));
    expect(bar).toBeDefined();
    await userEvent.click(bar!);
    const list = await within(section).findByTestId('an-bin-list');
    expect(within(list).getAllByTestId('an-open-delivery')).toHaveLength(3);
    await userEvent.click(within(list).getAllByTestId('an-open-delivery')[0]!);
    const flow = await within(section).findByTestId('an-flow');
    expect(flow).toHaveTextContent('라이더 배정');
    expect(flow).toHaveTextContent('픽업');
    // 같은 화면 그대로(다른 화면으로 넘어가지 않음)
    expect(screen.getByTestId('todo-strip')).toBeInTheDocument();
  });

  it('라이더별 띠의 표시를 누르면 표 아래에 그 배송 흐름', async () => {
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const table = await screen.findByTestId('an-riders');
    expect(table).toHaveTextContent('3건');
    await userEvent.click(within(table).getAllByTestId('an-mark')[0]!);
    expect(await screen.findByTestId('an-flow')).toHaveTextContent('배차 요청');
  });

  it('읽기 상한까지 읽어도 7일 앞에 못 닿으면 "일부만"을 알린다(숨기지 않음)', async () => {
    let calls = 0;
    const now = Date.now();
    server.use(
      http.get(`${API_BASE}/deliveries`, ({ request }) => {
        if (new URL(request.url).searchParams.get('deliveryIds')) return undefined;
        calls++;
        return HttpResponse.json({ items: rows(now).map((r) => ({ ...r, deliveryId: `${r.deliveryId}-${calls}` })), page: { nextCursor: `c${calls}`, size: 50 } });
      }),
    );
    renderAt('/dashboard', as.riderOps);
    expect(await screen.findByTestId('analysis-partial', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(calls).toBe(ANALYSIS_MAX_PAGES);
  });
});
