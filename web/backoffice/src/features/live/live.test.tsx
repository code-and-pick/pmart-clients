// 실시간 배송 현황 — bff 0.3.0 views/live-delivery 목(백엔드 PR #25).
import { pick } from '../../test/pick';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const liveCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/views/live-delivery')).map((r) => new URL(r.url).searchParams);

describe('실시간 배송 현황', () => {
  it('고객센터·라이더 운영 묶음 모두에 메뉴가 있다', async () => {
    renderAt('/live-delivery', as.riderOps);
    expect(await screen.findByRole('link', { name: '실시간 배송 현황' })).toHaveAttribute('href', '/live-delivery');
  });

  it('진행 중 배송을 원천별 열로 — 배송·주문·사건 상세로 가고, 약속 지남·기한 넘김을 표시', async () => {
    const view = renderAt('/live-delivery', as.cs);
    const rows = await screen.findAllByTestId('live-row');
    // 끝난 배송(DLV-LIVE-4 · D74939254)은 없다 — 진행 중 8건(모든 센터)
    expect(rows).toHaveLength(8);
    expect(screen.queryByText('D74939254')).not.toBeInTheDocument();
    const first = rows[0]!;
    expect(within(first).getByRole('link', { name: 'D74939251' })).toHaveAttribute('href', '/deliveries/DLV-LIVE-1');
    expect(within(first).getByRole('link', { name: '74939251' })).toHaveAttribute('href', '/orders/ORD-LIVE-1');
    expect(within(first).getByText('약속 지남')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: '라이더 도움요청 P1' })).toHaveAttribute('href', '/cases/CASE-MOCK-1');
    expect(within(first).getByText('기한 넘김')).toBeInTheDocument();
    // 상태 없이 부르면 cursor 를 보내지 않는다
    const sent = liveCalls(view.sent)[0]!;
    expect([sent.get('state'), sent.get('cursor'), sent.get('size')]).toEqual([null, null, '50']);
  });

  it('센터를 고르면 그 센터만 — 머리줄 센터 고르기와 같은 값(2026-11-23)', async () => {
    const view = renderAt('/live-delivery', as.admin);
    await screen.findAllByTestId('live-row');
    await pick(userEvent.setup(), '센터', /MFC-MOKPO-01/, 'MOKPO'); // 쳐서 찾는 고르기(2026-11-19)
    await waitFor(() => expect(screen.getAllByTestId('live-row')).toHaveLength(1));
    expect(liveCalls(view.sent).at(-1)!.get('mfcId')).toBe('MFC-MOKPO-01');
  });

  it('센터 칸은 머리줄과 같은 운영 중 MFC 만 — 준비 중(송파)은 없다(2026-11-24)', async () => {
    renderAt('/live-delivery', as.admin);
    await screen.findAllByTestId('live-row');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '센터' }));
    expect(await screen.findByRole('option', { name: /MFC-MOKPO-01/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /MFC-SEL-01/ })).not.toBeInTheDocument();
  });

  it('상태를 고르면 쪽 넘김 — 다음 쪽은 서버 nextCursor 로', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        const second = q.get('cursor') === 'C1';
        return HttpResponse.json({
          sources: [],
          unavailableSources: [],
          composedAt: '2026-11-16T01:00:00.000Z',
          truncated: false,
          page: { nextCursor: second ? null : 'C1' },
          items: [{ deliveryId: second ? 'DLV-P2' : 'DLV-P1', orderId: 'ORD-P', delivery: { state: 'UNASSIGNED' }, dispatch: { state: 'DISPATCHING' }, openCases: [] }],
        });
      }),
    );
    const view = renderAt('/live-delivery?state=UNASSIGNED', as.riderOps);
    expect(within(await screen.findByTestId('live-delivery')).getByRole('link')).toHaveAttribute('href', '/deliveries/DLV-P1');
    await userEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
    await waitFor(() => expect(within(screen.getByTestId('live-delivery')).getByRole('link')).toHaveAttribute('href', '/deliveries/DLV-P2'));
    const last = liveCalls(view.sent).at(-1)!;
    expect([last.get('state'), last.get('cursor')]).toEqual(['UNASSIGNED', 'C1']);
    expect(screen.queryByRole('button', { name: '다음 쪽' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '처음 쪽' })).toBeInTheDocument();
  });

  it('상태 없이 50건을 넘으면 "좁혀 주세요"', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, () =>
        HttpResponse.json({ sources: [], unavailableSources: [], composedAt: '2026-11-16T01:00:00.000Z', truncated: true, page: { nextCursor: null }, items: [{ deliveryId: 'DLV-T', delivery: { state: 'ASSIGNED' }, dispatch: { state: 'ASSIGNED' }, openCases: [] }] }),
      ),
    );
    renderAt('/live-delivery', as.cs);
    expect(await screen.findByText('더 있어요 — 센터나 상태로 좁혀 주세요.')).toBeInTheDocument();
  });

  it('배차·사건 원천 실패는 "모름"·"조회 실패" — 0건이나 정상으로 보이지 않는다', async () => {
    renderAt('/live-delivery?mfcId=MFC-MOCK-DOWN', as.admin);
    const rows = await screen.findAllByTestId('live-row');
    expect(within(rows[0]!).getByTestId('dispatch-state')).toHaveTextContent('모름(조회 실패)');
    expect(within(rows[0]!).getByTestId('open-cases')).toHaveTextContent('조회 실패');
    expect(within(screen.getByRole('region', { name: '가져온 곳' })).getByText(/못 불러온 정보: .*배차/)).toHaveAttribute('title', expect.stringMatching(/조회하지 못한 원천: .*delivery-dispatch-service/));
  });

  it('열린 접수 건을 1,000건까지만 읽었으면(casesTruncated, bff 0.9.2) null 칸은 "조회 실패"가 아니라 "확인 불가" + 안내', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/live-delivery`, () =>
        HttpResponse.json({
          sources: [{ system: 'delivery-execution-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-17T00:00:00Z', freshness: 'CURRENT' } }],
          unavailableSources: [],
          composedAt: '2026-11-17T00:00:00Z',
          casesTruncated: true,
          page: { nextCursor: null },
          items: [{ deliveryId: 'DLV-T-1', orderId: 'ORD-T-1', mfcId: 'MFC-BSN-01', type: 'FORWARD', riderId: 'RD-1', delivery: { state: 'ASSIGNED' }, dispatch: { state: 'ASSIGNED' }, promisedAt: null, openCases: null }],
        }),
      ),
    );
    renderAt('/live-delivery', as.cs);
    const row = (await screen.findAllByTestId('live-row'))[0]!;
    expect(within(row).getByTestId('open-cases')).toHaveTextContent('확인 불가');
    expect(document.querySelector('[data-state="cases-truncated"]')).not.toBeNull();
  });

  it('조회 실패(5xx)는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${BFF_BASE}/views/live-delivery`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/live-delivery', as.cs);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('진행 중인 배송이 없어요.')).not.toBeInTheDocument();
  });

  it('역할이 없으면 서버 403 — 권한 없음 화면', async () => {
    renderAt('/live-delivery', as.md);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });

  it('도착 예정(bff 0.7.0): 값이면 "도착 예정 시각"·"N분 늦음", 위치 확인·계산 전은 "확인 중", tracking 에 없으면 "—"', async () => {
    renderAt('/live-delivery', as.cs);
    const rows = await screen.findAllByTestId('live-row');
    const eta = (id: string) => within(rows.find((r) => r.textContent?.includes(id))!).getByTestId('live-eta');
    expect(eta('D74939251')).toHaveTextContent(/도착 예정 .*10:12/);
    expect(eta('D74939251')).toHaveTextContent('12분 늦음');
    expect(eta('D74939252')).toHaveTextContent('도착 예정 확인 중');
    expect(within(rows.find((r) => r.querySelector('a[href="/deliveries/DLV-LIVE-3"]'))!).getByTestId('live-eta')).toHaveTextContent('도착 예정 확인 중');
    // tracking 에 없는 배송(목 DLV-LIVE-5~9 미배정)은 '—'
    expect(rows.filter((r) => within(r).getByTestId('live-eta').textContent === '도착 예정 —').length).toBeGreaterThan(0);
  });

  it('tracking 장애면 도착 예정 "확인 불가" — 숫자를 만들지 않는다', async () => {
    renderAt('/live-delivery?mfcId=MFC-MOCK-DOWN', as.admin);
    const rows = await screen.findAllByTestId('live-row');
    expect(within(rows[0]!).getByTestId('live-eta')).toHaveTextContent('도착 예정 확인 불가');
    expect(within(rows[0]!).getByTestId('live-eta')).not.toHaveTextContent('늦음');
  });
});

describe('실시간 배송 현황 — 화면 번호(bff 0.14.0, ADR-0070)', () => {
  const rowWith = (rows: readonly HTMLElement[], text: string) => rows.find((r) => r.textContent?.includes(text))!;

  it('목록은 배송·주문 번호와 라이더 번호만(가린 이름은 title) — 시스템 ID 는 링크 대상으로만', async () => {
    renderAt('/live-delivery', as.cs);
    const row = rowWith(await screen.findAllByTestId('live-row'), 'D74939251');
    expect(within(row).getByTestId('live-delivery')).toHaveTextContent('D74939251');
    expect(within(row).getByTestId('live-order')).toHaveTextContent('74939251');
    expect(within(row).getByTestId('live-rider')).toHaveTextContent(/^R4781$/); // ADR-0085 목록은 번호만
    expect(within(within(row).getByTestId('live-rider')).getByTestId('rider-label')).toHaveAttribute('title', '김*수');
    // 시스템 ID 는 글자로 보이지 않는다(링크 href 에만)
    expect(row).not.toHaveTextContent('DLV-LIVE-1');
    expect(row).not.toHaveTextContent('ORD-LIVE-1');
    expect(row).not.toHaveTextContent('RD-1');
    expect(within(row).getByRole('link', { name: 'D74939251' })).toHaveAttribute('href', '/deliveries/DLV-LIVE-1');
  });

  it('번호가 null 이면 "번호 없음"(번호를 지어내지 않고 ID 끝 8자리도 안 보인다 — ADR-0070 덧붙임), 미배정은 "미배정"', async () => {
    renderAt('/live-delivery', as.cs);
    const rows = await screen.findAllByTestId('live-row');
    const noNumber = rows.find((r) => r.querySelector('a[href="/deliveries/DLV-LIVE-3"]'))!;
    const delivery = within(noNumber).getByTestId('live-delivery');
    expect(delivery).toHaveTextContent('번호 없음');
    expect(delivery).not.toHaveTextContent('V-LIVE-3');
    expect(delivery).not.toHaveTextContent('DLV-LIVE-3');
    expect(within(delivery).getByRole('link')).toHaveAttribute('href', '/deliveries/DLV-LIVE-3');
    expect(within(noNumber).getByTestId('live-order')).toHaveTextContent('번호 없음');
    // 탈퇴 라이더처럼 번호·이름이 null — riderId 끝 8자리 + 번호 없음
    expect(within(rowWith(rows, 'D74939252')).getByTestId('live-rider')).toHaveTextContent('번호 없음');
    expect(within(rowWith(rows, 'D74939255')).getByTestId('live-rider')).toHaveTextContent('미배정');
  });

  it('rider-service 를 못 읽으면 라이더 칸은 "번호 확인 불가" — 원천 줄에도 실패 원천으로 보이고 나머지는 그대로', async () => {
    renderAt('/live-delivery?mfcId=MFC-MOCK-DOWN', as.admin);
    const row = rowWith(await screen.findAllByTestId('live-row'), 'D74939251');
    const rider = within(row).getByTestId('live-rider');
    expect(rider).toHaveTextContent('번호 확인 불가');
    expect(rider).not.toHaveTextContent('번호 없음');
    expect(within(screen.getByRole('region', { name: '가져온 곳' })).getByText(/못 불러온 정보: .*라이더/, { selector: '.badge-error' })).toHaveAttribute('title', expect.stringMatching(/rider-service/));
    expect(within(row).getByTestId('live-order')).toHaveTextContent('74939251');
  });
});
