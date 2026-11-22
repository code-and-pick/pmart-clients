// ADR-0070 덧붙임(2026-11-19) — 목록·링크에는 화면 표기만(직원 이름·사번, 접수 건 C-, 문의 Q-, 클레임 "주문번호 종류", 승인 번호 없음),
// 상세에는 시스템 번호 칸. 그리고 ID 를 넣던 칸은 번호로 넣거나 골라 넣는다(사용자 "배송 번호처럼 입력하는 곳은 전부").
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { server } from '../test/server';

import { as, renderAt } from '../test/render';

describe('화면 표기(ADR-0070 덧붙임)', () => {
  it('승인함: 요청자는 이름 · 사번, 승인 번호(AP-/apv-)는 목록에 없다', async () => {
    renderAt('/approvals?view=all', as.admin);
    const rows = await screen.findAllByTestId('approval-row');
    await waitFor(() => expect(rows.some((r) => r.textContent?.includes('[목] 김엠디 · P2026-00002'))).toBe(true));
    for (const r of rows) {
      expect(r).not.toHaveTextContent(/apv-|AP-/);
      expect(r).not.toHaveTextContent(/op-[a-z]/);
    }
  });

  it('접수 건: 목록 줄·상세 머리에 C-번호, 상세에는 시스템 번호 칸(접혀 있음)', async () => {
    const user = userEvent.setup();
    renderAt('/cases?tab=all', as.admin);
    const numbers = await screen.findAllByTestId('case-number');
    expect(numbers[0]).toHaveTextContent(/^C-1119-\d{4}$/);
    const row = (await screen.findAllByTestId('case-row'))[0]!;
    expect(row).not.toHaveTextContent(/CASE-MOCK/);
    await user.click(within(row).getByTestId('case-summary'));
    // 상세가 응답을 받은 뒤(받기 전 머리 번호 칸은 비어 있다)
    await waitFor(() => expect(screen.getByTestId('case-number')).toHaveTextContent(/^C-1119-\d{4}$/));
    expect(screen.getByTestId('system-numbers')).toBeInTheDocument();
  });

  it('문의: 목록 링크 글자는 Q-번호', async () => {
    renderAt('/inquiries', as.cs);
    const links = await screen.findAllByTestId('inquiry-number');
    expect(links.map((l) => l.textContent)).toEqual(expect.arrayContaining(['Q-1119-0003']));
  });

  it('클레임: "주문번호 종류 순번"(bff 0.23.0 claimSeq), CLM- 는 목록에 없다', async () => {
    renderAt('/claims', as.cs);
    const labels = await screen.findAllByTestId('claim-label');
    await waitFor(() => expect(labels.map((l) => l.textContent)).toEqual(expect.arrayContaining(['74939002 취소 1'])));
    expect(screen.queryByText(/CLM-MOCK/)).not.toBeInTheDocument();
  });

  it('처리 대기: 사가는 "주문번호 흐름", 주문 칸은 주문번호', async () => {
    renderAt('/pending', as.admin);
    const items = await screen.findAllByTestId('pending-item');
    expect(items.some((r) => /74939001 /.test(r.textContent ?? ''))).toBe(true);
    for (const r of items) expect(r).not.toHaveTextContent(/ORD-MOCK|SAGA-MOCK|op-admin-1/);
  });
});

describe('ID 칸 → 번호로·골라 넣기', () => {
  it('상담 접수: 연결 접수 건에 C-번호를 넣으면 찾아서 그 ID 로 연결, 없는 번호면 저장이 막힌다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cs-intakes/new', as.cs);
    const link = await screen.findByPlaceholderText(/접수 건 번호/);
    await user.type(link, 'C-1119-0777'); // 목에 없는 번호
    await waitFor(() => expect(screen.getByTestId('ref-status-case')).toHaveAttribute('data-state', 'notFound'));
    expect(screen.getByText(/연결할 접수 건 번호를 확인해 주세요/)).toBeInTheDocument();
    await user.clear(link);
    await user.type(link, 'C-1119-0001');
    await waitFor(() => expect(screen.getByTestId('ref-status-case')).toHaveAttribute('data-state', 'found'));
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('caseNumber') === 'C-1119-0001')).toBe(true);
  });

  it('가격: 승인 번호를 옮겨 적는 칸이 없다 — 승인되면 가격 서비스가 바꾼다(2026-11-20 가격 흐름 다시 짬)', async () => {
    renderAt('/prices', as.md);
    await screen.findAllByTestId('price-row');
    expect(screen.queryByTestId('approval-picker-open')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('승인 ID')).not.toBeInTheDocument();
  });
});

describe('목록 번호는 bff 화면 조회 한 번으로(2026-11-19 백엔드 회신 — 줄마다 부르지 않는다)', () => {
  it('클레임 목록: bff views/claims 한 번, 주문 번호 조회(orders/lookups)는 줄마다 부르지 않는다', async () => {
    const view = renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-label').map((l) => l.textContent)).toEqual(expect.arrayContaining(['74939002 취소 1'])));
    const paths = view.sent.map((r) => new URL(r.url).pathname);
    expect(paths.filter((p) => p.endsWith('/views/claims')).length).toBeGreaterThan(0);
    expect(paths.some((p) => p.endsWith('/orders/lookups'))).toBe(false);
    expect(paths.some((p) => /\/claims$/.test(p) && !p.includes('/views/'))).toBe(false);
  });

  it('라이더 컴플레인 목록: bff views/rider-complaints 한 번, 배송 상세·라이더 일괄 조회는 부르지 않는다', async () => {
    const view = renderAt('/rider-complaints', as.riderOps);
    await screen.findAllByTestId('complaint-row');
    const paths = view.sent.map((r) => new URL(r.url).pathname);
    expect(paths.some((p) => p.endsWith('/views/rider-complaints'))).toBe(true);
    expect(paths.some((p) => /\/deliveries\/[^/]+$/.test(p))).toBe(false);
    expect(paths.some((p) => p.endsWith('/riders'))).toBe(false);
  });
});

describe('라이더 컴플레인 종류별 수(case 0.26.0)', () => {
  it('종류마다 칸, 누르면 그 종류로 거르고 강조, 거르기 조건(라이더 등)은 수에도 그대로', async () => {
    const user = userEvent.setup();
    const view = renderAt('/rider-complaints?riderId=R4785', as.riderOps);
    const strip = await screen.findByTestId('complaint-counts');
    await waitFor(() => expect(within(strip).getAllByRole('link').length).toBe(3));
    await waitFor(() => expect(within(strip).getByTestId('complaint-count-MISDELIVERY')).toHaveTextContent(/\d/));
    const counts = view.sent.find((r) => new URL(r.url).pathname.endsWith('/rider-complaints/counts'))!;
    expect(new URL(counts.url).searchParams.get('riderId')).toBe('RID-MOCK-1'); // 번호로 거른 라이더 ID 그대로
    expect(new URL(counts.url).searchParams.get('complaintType')).toBeNull(); // 종류는 빼고 센다
    await user.click(within(strip).getByTestId('complaint-count-MISDELIVERY'));
    expect(await screen.findByTestId('complaint-count-MISDELIVERY')).toHaveAttribute('aria-current', 'true');
  });

  it('수를 못 읽으면(배포 전 404 등) 칸마다 "?" — 0 으로 보이지 않는다', async () => {
    server.use(http.get(`${API_BASE}/rider-complaints/counts`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND', traceId: 't' }, { status: 404, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/rider-complaints', as.riderOps);
    const strip = await screen.findByTestId('complaint-counts');
    await waitFor(() => expect(within(strip).getByTestId('complaint-count-REPORT')).toHaveTextContent('?'));
    expect(strip).not.toHaveTextContent(/^0$/);
  });
});

describe('직원 표시 묶음 조회', () => {
  it('승인함 한 쪽의 요청자들을 hr employee-labels 한두 번에 묻는다(줄마다 아님)', async () => {
    const view = renderAt('/approvals?view=all', as.admin);
    const rows = await screen.findAllByTestId('approval-row');
    await waitFor(() => expect(rows.some((r) => r.textContent?.includes('P2026-'))).toBe(true));
    const label = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/hr/employee-labels'));
    expect(label.length).toBeLessThanOrEqual(2);
    expect(label.length).toBeLessThan(rows.length + 1);
  });
});
