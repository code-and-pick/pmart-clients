// 개인정보 열람 기록(audit 0.3.0, OPERATOR_ADMIN) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { mockPiiLogs } from '../../mocks/piiAccessLogHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const listCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/pii-access-logs')).map((r) => new URL(r.url).searchParams);

describe('개인정보 열람 기록', () => {
  it('메뉴는 본사 관리자에게만 — 감사 묶음', async () => {
    renderAt('/session', as.admin);
    const group = await screen.findByTestId('nav-group-audit');
    expect(within(group).getByRole('link', { name: '개인정보 열람 기록', hidden: true })).toHaveAttribute('href', '/pii-access-logs');
  });

  it('상담원은 메뉴가 없고, 주소로 열면 서버 403 — 권한 없음 화면(빈 목록 아님)', async () => {
    renderAt('/pii-access-logs', as.cs);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
    expect(screen.queryByTestId('nav-group-audit')).not.toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 열람 기록이 없어요.')).not.toBeInTheDocument();
  });

  it('새 것부터 — 직원·정보주체·항목·주문 참조·사유, 주문·라이더 화면으로 간다', async () => {
    const view = renderAt('/pii-access-logs', as.admin);
    const rows = await screen.findAllByTestId('pii-log-row');
    expect(rows).toHaveLength(mockPiiLogs.length);
    const order = rows.find((r) => r.textContent?.includes('오배송 확인 — 수령지 대조'))!;
    expect(order).toHaveTextContent('이름, 주소, 출입 메모·배송 요청사항'); // 항목마다 이름 + 원래 코드(title)(2026-11-18)
    expect(within(order).getByTitle('ENTRANCE')).toHaveTextContent('출입 메모·배송 요청사항');
    expect(within(order).getByRole('link', { name: 'ORDER:ORD-MOCK-1001' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001');
    const rider = rows.find((r) => r.textContent?.includes('라이더 연락 두절 확인'))!;
    expect(within(rider).getByText('라이더')).toBeInTheDocument();
    expect(within(rider).getByRole('link', { name: 'RD-1' })).toHaveAttribute('href', '/riders/RD-1');
    expect(within(rider).getByTitle('RIDER_OPS')).toHaveTextContent('라이더 운영'); // 역할 이름 + 원래 코드(title)
    const sent = listCalls(view.sent)[0]!;
    expect([sent.get('size'), sent.get('cursor'), sent.get('from')]).toEqual(['50', null, null]);
  });

  it('거르기는 주소에 남고, 기간은 한국 날짜 0시부터 종료일 다음 날 0시 전까지', async () => {
    const view = renderAt('/pii-access-logs', as.admin);
    await screen.findAllByTestId('pii-log-row');
    await userEvent.type(screen.getByLabelText('열람한 직원(운영자 ID)'), 'op-cs-1');
    await userEvent.selectOptions(screen.getByLabelText('정보주체 종류'), 'CUSTOMER');
    await userEvent.type(screen.getByLabelText('시작일'), '2026-11-15');
    await userEvent.type(screen.getByLabelText('종료일(그날 포함)'), '2026-11-15');
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(listCalls(view.sent).some((q) => q.get('actorId') === 'op-cs-1')).toBe(true));
    const q = listCalls(view.sent).find((s) => s.get('actorId') === 'op-cs-1')!;
    expect([q.get('subjectType'), q.get('from'), q.get('to')]).toEqual(['CUSTOMER', '2026-11-14T15:00:00.000Z', '2026-11-15T15:00:00.000Z']);
    // 목: 11-15(한국) 에 op-cs-1 이 고객을 본 기록만
    const expected = mockPiiLogs.filter(
      (l) => l.actor.actorId === 'op-cs-1' && l.subjectType === 'CUSTOMER' && l.occurredAt >= '2026-11-14T15:00:00Z' && l.occurredAt < '2026-11-15T15:00:00Z',
    );
    await waitFor(() => expect(screen.getAllByTestId('pii-log-row')).toHaveLength(expected.length));
    // 거르기 칸은 주소에서 다시 읽는다(조회 뒤 다시 그려도 값이 남는다)
    expect(screen.getByLabelText('열람한 직원(운영자 ID)')).toHaveValue('op-cs-1');
  });

  it('시작일이 종료일보다 늦으면 부르지 않고 안내', async () => {
    const view = renderAt('/pii-access-logs?from=2026-11-16&to=2026-11-14', as.admin);
    expect(await screen.findByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦어요');
    expect(listCalls(view.sent)).toHaveLength(0);
  });

  it('다음 쪽은 서버 nextCursor 로, 처음 쪽으로 돌아간다', async () => {
    server.use(
      http.get(`${API_BASE}/pii-access-logs`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(cursor ? { items: [mockPiiLogs[1]], page: { size: 50, nextCursor: null } } : { items: [mockPiiLogs[0]], page: { size: 50, nextCursor: 'CUR-2' } });
      }),
    );
    const view = renderAt('/pii-access-logs', as.admin);
    await screen.findAllByTestId('pii-log-row');
    await userEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
    await waitFor(() => expect(listCalls(view.sent).some((q) => q.get('cursor') === 'CUR-2')).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: '처음 쪽' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '처음 쪽' })).not.toBeInTheDocument());
  });

  it('목록을 못 읽으면 오류(빈 목록 아님)', async () => {
    server.use(http.get(`${API_BASE}/pii-access-logs`, () => new HttpResponse(null, { status: 503 })));
    renderAt('/pii-access-logs', as.admin);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 열람 기록이 없어요.')).not.toBeInTheDocument();
  });

  it('한 건 상세 — 사유·기록한 서비스·역할, 목록으로 돌아가면 거르기 유지', async () => {
    const target = mockPiiLogs.find((l) => l.subjectType === 'RIDER')!;
    renderAt('/pii-access-logs?subjectType=RIDER', as.admin);
    const row = (await screen.findAllByTestId('pii-log-row'))[0]!;
    await userEvent.click(within(row).getAllByRole('link')[0]!);
    const detail = await screen.findByTestId('pii-log-detail');
    expect(detail).toHaveTextContent(target.purpose);
    expect(within(detail).getByTitle('rider-service')).toHaveTextContent('라이더'); // 기록한 서비스 = 업무 이름 + 원래 이름(title)
    expect(within(detail).getByTitle('RIDER_OPS')).toHaveTextContent('라이더 운영');
    expect(detail).toHaveTextContent(target.piiAccessLogId);
    await userEvent.click(screen.getByRole('link', { name: '목록으로' }));
    expect(await screen.findByLabelText('정보주체 종류')).toHaveValue('RIDER');
  });
});
