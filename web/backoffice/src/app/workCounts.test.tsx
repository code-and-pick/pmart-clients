// 지금 일 건수(bff 0.15.0 work-counts, 2026-11-18) — 관리자 대시보드: 정확한 건수, complete=false "N건 이상", 원천 실패 "확인 못 함"
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const view = (counts: unknown[], unavailableSources: string[] = []) => HttpResponse.json({ composedAt: new Date().toISOString(), sources: [], unavailableSources, counts });

describe('지금 일 건수(관리자)', () => {
  it('진행 중 배송 상태별 막대와 지금 일 칸(목 조회에서 센 값)', async () => {
    renderAt('/', as.admin);
    expect((await screen.findAllByTestId('dash-work-delivery-row')).length).toBeGreaterThan(0);
    expect(await within(screen.getByTestId('dash-work-cases-open')).findByText(/^\d+$/)).toBeInTheDocument();
  });

  it('내 할 일 숫자는 work-counts 값 — 다 못 셌으면 "N건 이상"', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/work-counts`, () =>
        view([
          { group: 'APPROVALS', key: 'DECIDABLE_BY_ME', segment: 'PRICE', value: 2000, complete: false, source: 'approval-service' },
          { group: 'CASES', key: 'OVERDUE', segment: 'MISDELIVERY', value: 4, complete: true, source: 'case-service' },
          { group: 'CASES', key: 'OVERDUE', segment: 'RIDER_HELP', value: 3, complete: true, source: 'case-service' },
        ]),
      ),
    );
    renderAt('/', as.admin);
    expect(await within(await screen.findByTestId('dash-kpi-approvals')).findByText('2000건 이상')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-kpi-casesOverdue')).getByText('7')).toBeInTheDocument(); // 종류별 합
  });

  it('원천이 실패한 묶음은 "확인 못 함"/"?" — 0 으로 보이지 않는다(줄 없는 묶음은 0)', async () => {
    server.use(http.get(`${BFF_BASE}/views/work-counts`, () => view([{ group: 'CASES', key: 'OPEN', segment: 'OTHER', value: 2, complete: true, source: 'case-service' }], ['approval-service'])));
    renderAt('/', as.admin);
    expect(await within(await screen.findByTestId('dash-work-evidence')).findByText('확인 못 함')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-kpi-approvals')).getByText('?')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-work-handovers')).getByText('0')).toBeInTheDocument(); // case-service 는 읽었고 줄이 없음 = 0
  });

  it('관리자가 아니면 부르지 않는다(403 역할)', async () => {
    const v = renderAt('/', as.riderOps);
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-work')).not.toBeInTheDocument();
    expect(v.sent.some((r) => r.url.includes('/views/work-counts'))).toBe(false);
  });
});
