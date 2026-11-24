// 배송 찾기(execution 0.4.0)·상세(수행 + 배차) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { mockDeliveries } from '../../mocks/deliveryHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const searchCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/deliveries')).map((r) => new URL(r.url).searchParams);

describe('배송 관리', () => {
  it('찾기 칸에 배송 번호(D48213075-2)를 넣으면 그 배송만, 모양이 틀리면 서버에 묻지 않고 알린다(2026-11-24)', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    const box = await screen.findByLabelText('배송·주문 번호');
    await userEvent.type(box, 'D48213075-2{Enter}');
    await waitFor(() => expect(screen.getAllByTestId('delivery-row')).toHaveLength(1));
    expect(screen.getByTestId('delivery-row')).toHaveTextContent('D48213075-2');
    const sent = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/deliveries') && new URL(r.url).searchParams.get('orderNumber'));
    expect(sent.every((r) => new URL(r.url).searchParams.get('orderNumber') === '48213075')).toBe(true);
    await userEvent.clear(box);
    await userEvent.type(box, 'D2876770{Enter}');
    expect(await screen.findByTestId('delivery-number-note')).toHaveTextContent('배송 번호');
  });

  it('-2·-3 배송은 번호 뒤에 종류(회수·반납·재발송·다시 배송), 첫 배송은 꼬리표 없음(2026-11-24)', async () => {
    renderAt('/deliveries', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    const second = rows.find((r) => r.textContent?.includes('D48213075-2'))!;
    const tag = await within(second).findByTestId('delivery-kind');
    // 짧게 "반납", 자세한 이름은 올려 보면(2026-11-24)
    expect(tag).toHaveTextContent(/^반납$/);
    expect(tag).toHaveAttribute('title', '전달 실패 반납');
    const first = rows.find((r) => /D48213075(?!-)/.test(r.textContent ?? ''))!;
    expect(within(first).queryByTestId('delivery-kind')).not.toBeInTheDocument();
  });

  it('라이더 번호로 거르면 "그 라이더가 맡은 배송"이라고 밝히고 라이더 정보로 가는 길을 둔다', async () => {
    renderAt('/deliveries?riderId=R4829', as.riderOps);
    const note = await screen.findByTestId('rider-filter-note');
    expect(note).toHaveTextContent('R4829');
    expect(note).toHaveTextContent('라이더가 맡은 배송이에요.');
    expect(within(note).getByTestId('rider-filter-link')).toHaveAttribute('href', '/riders/RD-7');
  });

  it('라이더로 거르지 않으면 안내 줄이 없다', async () => {
    renderAt('/deliveries', as.riderOps);
    await screen.findAllByTestId('delivery-row');
    expect(screen.queryByTestId('rider-filter-note')).toBeNull();
  });

  it('비워 두면 최근 배송부터, 행을 누르면 상세', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows).toHaveLength(4);
    // 화면 배송 번호(ADR-0070) "D48213075" 로 보이고 링크는 내부 ID 로
    const failed = rows.find((r) => r.textContent?.includes('D48213075'))!;
    expect(within(failed).getByText('전달 실패 등록')).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: 'D48213075' })).toHaveAttribute('href', '/deliveries/DLV-1');
    // 번호가 없으면(배정 전) ID 끝 8자리 + "번호 없음"
    const unassigned = rows.find((r) => r.textContent?.includes('DLV-2'))!;
    expect(within(unassigned).getByText('배정 전')).toBeInTheDocument();
    expect(unassigned).toHaveTextContent('번호 없음');
    const q = searchCalls(view.sent)[0]!;
    expect([q.get('orderId'), q.get('state'), q.get('sort'), q.get('size')]).toEqual([null, null, null, '20']);
  });

  it('주문 ID 완전 일치·상태로 거르고 주소에 남긴다, 없으면 "없어요"(실패와 구분)', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    await screen.findAllByTestId('delivery-row');
    // 시스템 번호(주문 ID)는 깔때기 팝업 안(2026-11-21 시뮬레이터 모양)
    await userEvent.click(screen.getByTestId('search-toggle'));
    await userEvent.type(screen.getByLabelText('주문 ID'), 'ORD-1');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findAllByTestId('delivery-row')).toHaveLength(2); // 원래 배송 + 반납 배송
    expect(searchCalls(view.sent).at(-1)!.get('orderId')).toBe('ORD-1');

    // 찾으면 팝업이 닫히고 건 조건이 칩으로 남는다 — 깔때기로 다시 연다
    expect(screen.getByRole('button', { name: '주문 한 주문 조건 바꾸기' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('search-toggle'));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '수행 상태' })).getByRole('radio', { name: '전달 완료' }));
    expect(await screen.findByText('조건에 맞는 배송이 없어요.')).toBeInTheDocument();
    const q = searchCalls(view.sent).at(-1)!;
    expect([q.get('orderId'), q.get('state')]).toEqual(['ORD-1', 'COMPLETED']);
  });
});

describe('배송 상세', () => {
  it('이 배송에 있었던 일: 걸린 사건·같은 주문의 다른 배송(2026-11-24)', async () => {
    renderAt('/deliveries/DLV-2', as.riderOps);
    const story = await screen.findByTestId('delivery-story');
    expect(await within(story).findByTestId('story-case')).toHaveTextContent('배차 실패');
  });

  it('이 배송에 있었던 일: 같은 주문의 다른 배송(종류 꼬리표와 함께)', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const story = await screen.findByTestId('delivery-story');
    const list = await within(story).findByTestId('story-siblings');
    expect(list).toHaveTextContent('D48213075-2');
    // 이 주문 배송을 순번 순으로, 이 배송은 "이 배송" 표시(다른 배송의 상태가 이 배송 일로 보이지 않게 — 2026-11-24)
    expect(within(list).getByTestId('story-this')).toHaveTextContent('D48213075');
    expect(within(list).getByTestId('story-this')).toHaveTextContent('이 배송');
  });

  it('이 주문의 배송: 미지급인 배송 줄 옆에 "미지급" 네모칸(이유는 올려 보면, 2026-11-24)', async () => {
    const d4 = mockDeliveries.find((d) => d.deliveryId === 'DLV-4')!;
    server.use(
      http.get(`${API_BASE}/deliveries/DLV-4`, () =>
        HttpResponse.json({
          ...d4,
          earning: { earningId: 'ERN-4', deliveryId: 'DLV-4', riderId: 'RD-7', calculable: false, settlementState: 'ADJUSTED', note: '라이더 귀책 오배송(사건 CASE-1a757af4-2bc4) — 배달료 미지급' },
        }),
      ),
    );
    renderAt('/deliveries/DLV-1', as.riderOps);
    const list = await screen.findByTestId('story-siblings');
    const rows = within(list).getAllByRole('listitem');
    const second = rows.find((r) => r.textContent?.includes('D48213075-2'))!;
    const tag = await within(second).findByTestId('story-fee-tag');
    expect(tag).toHaveTextContent('미지급');
    expect(tag).toHaveAttribute('title', '라이더 귀책 오배송 — 배달료 미지급');
    // 따로 "수행료" 줄은 없다(줄 옆 네모칸으로)
    expect(screen.queryByTestId('story-fee')).not.toBeInTheDocument();
  });

  it('수행료 미지급 이유에서 긴 사건 ID 는 빼고 보인다(2026-11-24)', async () => {
    server.use(
      http.get(`${API_BASE}/deliveries/DLV-3`, () =>
        HttpResponse.json({
          ...mockDeliveries.find((d) => d.deliveryId === 'DLV-3')!,
          earning: { ...mockDeliveries.find((d) => d.deliveryId === 'DLV-3')!.earning!, calculable: false, settlementState: 'ADJUSTED', note: '라이더 귀책 오배송(사건 CASE-1a757af4-2bc4-4f0b-8876-be4b3856460d) — 배달료 미지급' },
        }),
      ),
    );
    renderAt('/deliveries/DLV-3', as.riderOps);
    const fee = await screen.findByTestId('story-fee');
    expect(fee).toHaveTextContent('미지급 — 라이더 귀책 오배송 — 배달료 미지급');
    expect(fee).not.toHaveTextContent('CASE-');
  });

  it('수행·배차를 따로 — 전달 실패 사유, 주문 품목, 수행 이력', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const exec = await screen.findByTestId('execution-detail');
    expect(exec).toHaveTextContent('전달 실패 등록');
    expect(exec).toHaveTextContent('48213075');
    expect(exec).toHaveTextContent('PMart 부산진구지점');
    expect(screen.getByTestId('failure-detail')).toHaveTextContent('연락 안 됨');
    expect(screen.getByTestId('order-items')).toHaveTextContent(/그릭요거트 플레인 400g\s*3/);
    expect(screen.getByTestId('execution-history')).toHaveTextContent(/픽업.*· 라이더/);
    const dispatch = await screen.findByTestId('dispatch-detail');
    expect(dispatch).toHaveTextContent('배정');
    // 라이더는 화면 번호(ADR-0070) "R4829"(가린 이름은 title) — 내부 ID 는 접힌 "시스템 번호"에만
    expect(await within(dispatch).findByText('R4829')).toBeInTheDocument();
    expect(within(dispatch).getByTestId('rider-name')).toHaveAttribute('title', '김*수'); // 목록·표는 번호만(ADR-0085)
    expect(dispatch).not.toHaveTextContent('RD-7');
    expect(screen.getByTestId('system-ids')).toHaveTextContent('RD-7');
    // 전달 실패 등록 상태 — 확정·반려 폼이 있다(2026-11-17 조치 붙임)
    expect(await screen.findByRole('form', { name: '전달 실패 확정·반려' })).toBeInTheDocument();
  });

  it('배차를 못 읽어도 수행은 보이고, 배차 칸만 오류(0·빈 값으로 바꾸지 않음)', async () => {
    renderAt('/deliveries/DLV-4', as.riderOps);
    const exec = await screen.findByTestId('execution-detail');
    expect(exec).toHaveTextContent('전달 실패 반납');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-detail')).not.toBeInTheDocument();
  });
  it('배차 시도 표(계기·상태·제안별 라이더 응답)와 도착 예정(tracking eta — 남은 분·지연은 서버 값)', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const attempts = await screen.findAllByTestId('dispatch-attempt');
    expect(attempts).toHaveLength(1);
    // 제안받은 라이더는 화면 번호(ADR-0070) — RD-7 은 "R4829", 조회에 없는 RD-9 는 ID 끝 + "번호 없음"
    const offers = within(attempts[0]!).getAllByRole('listitem');
    expect(offers.find((o) => o.textContent?.includes('거절'))).toHaveTextContent('번호 없음');
    const accepted = offers.find((o) => o.textContent?.includes('수락'))!;
    expect(await within(accepted).findByText('R4829')).toBeInTheDocument();
    expect(within(accepted).getByTestId('rider-name')).toHaveAttribute('title', '김*수');
    const eta = await screen.findByTestId('eta-detail');
    expect(within(eta).getByText('고객 도착')).toBeInTheDocument();
    expect(within(eta).getByText(/35분 남음 · 5.4km/)).toBeInTheDocument();
    expect(within(eta).getByText('약속보다 5분 늦음')).toBeInTheDocument();
  });

  it('배차 시도: 최신이 위, 처음엔 3개만 — 더 보기로 나머지, 라이더 없이 20분 넘으면 빨간 배차 지연 경고(2026-11-24)', async () => {
    const at = (h: number) => ({ attemptId: `AT-${h}`, trigger: 'RETRY', state: 'FAILED', failureReason: 'EXPIRED', startedAt: `2026-11-20T${String(h).padStart(2, '0')}:00:00.000Z`, offers: [] });
    server.use(
      http.get(`${API_BASE}/deliveries/DLV-2/dispatch`, () =>
        HttpResponse.json({ deliveryId: 'DLV-2', orderId: 'ORD-2', mfcId: 'MFC-BSJ-01', type: 'FORWARD', state: 'DISPATCHING', attempts: [at(1), at(2), at(3), at(4), at(5)] }),
      ),
    );
    renderAt('/deliveries/DLV-2', as.riderOps);
    const shown = await screen.findAllByTestId('dispatch-attempt');
    expect(shown).toHaveLength(3);
    // 최신(05시)이 맨 위
    expect(shown[0]).toHaveTextContent('11. 20. 오후 2:00');
    await userEvent.click(screen.getByTestId('dispatch-attempts-more'));
    expect(screen.getAllByTestId('dispatch-attempt')).toHaveLength(5);
    const alert = await screen.findByTestId('dispatch-delay');
    expect(alert).toHaveTextContent('배차 지연');
    expect(alert).toHaveTextContent('배차 시도 5번');
  });

  it('배차 실패한 배송은 시도마다 실패 사유', async () => {
    renderAt('/deliveries/DLV-2', as.riderOps);
    const attempts = await screen.findAllByTestId('dispatch-attempt');
    expect(attempts).toHaveLength(3);
    expect(within(attempts[2]!).getByText('라이더 없음')).toBeInTheDocument();
    expect(within(await screen.findByTestId('eta-detail')).getAllByText('도착 예정 확인 중')).toHaveLength(2);
  });
});