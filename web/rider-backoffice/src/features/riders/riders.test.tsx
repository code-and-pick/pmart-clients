// 라이더 상세 — 정산계좌 여부·지금 동의한 버전(rider 0.10.0)·배정 이력(dispatch 0.8.0), 찾기 거르기 칩. 목(MSW) 기준 — 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('라이더 찾기 — 거르기', () => {
  it('계정 제한 칩을 누르면 그 값으로 다시 찾는다', async () => {
    const view = renderAt('/riders', as.riderOps);
    expect(await screen.findAllByTestId('rider-row')).toHaveLength(2);
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '계정 제한' })).getByRole('radio', { name: '일시 중지' }));
    expect(await screen.findAllByTestId('rider-row')).toHaveLength(1);
    expect(screen.getByTestId('rider-row')).toHaveTextContent('RD-8');
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('restriction') === 'SUSPENDED')).toBe(true);
  });

  it('수단으로 거르고, 정렬을 바꾸면 sort 를 보낸다(기본 가입 최근 순)', async () => {
    const view = renderAt('/riders', as.riderOps);
    expect(await screen.findAllByTestId('rider-row')).toHaveLength(2);
    const sorts = () => view.sent.filter((r) => new URL(r.url).pathname.endsWith('/riders')).map((r) => new URL(r.url).searchParams.get('sort'));
    expect(sorts()[0]).toBe('JOINED_DESC');

    await userEvent.click(within(screen.getByRole('radiogroup', { name: '수단' })).getByRole('radio', { name: '자전거' }));
    expect(await screen.findAllByTestId('rider-row')).toHaveLength(1);
    expect(screen.getByTestId('rider-row')).toHaveTextContent('RD-8');
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('vehicleType') === 'BICYCLE')).toBe(true);

    await userEvent.click(within(screen.getByRole('radiogroup', { name: '정렬' })).getByRole('radio', { name: '상태 바뀐 최근 순' }));
    await screen.findAllByTestId('rider-row');
    expect(sorts()).toContain('STATE_CHANGED_DESC');
  });
});

describe('제한 검토 — 상태 탭·결정', () => {
  it('결정하면 목록을 다시 읽지 않고 그 줄에 결과가 남는다', async () => {
    const view = renderAt('/restriction-reviews', as.riderOps);
    const row = await screen.findByTestId('review-row');
    expect(row).toHaveTextContent('RD-8');
    expect(row).toHaveTextContent('RC-4');
    const gets = () => view.sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/restriction-reviews')).length;
    const before = gets();
    await userEvent.click(within(row).getByRole('button', { name: '제한 안 함' }));
    // 같은 줄이 닫힌 기록(상태·언제·누가)으로 바뀐다 — 결정 버튼은 사라진다
    await within(screen.getByTestId('review-row')).findByText('제한 안 함');
    const closed = screen.getByTestId('review-row');
    expect(closed).toHaveTextContent('RD-8');
    expect(closed).toHaveTextContent('OP-rops-1');
    expect(within(closed).queryByRole('button', { name: '제한함' })).not.toBeInTheDocument();
    expect(gets()).toBe(before);
  });

  it('닫힌 검토 탭에서 결정 기록(언제·누가·메모)을 본다', async () => {
    const view = renderAt('/restriction-reviews', as.riderOps);
    await screen.findByTestId('review-row');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '제한 검토' })).getByRole('radio', { name: '제한 안 함' }));
    const row = await screen.findByText('RD-7');
    const tr = row.closest('tr')!;
    expect(tr).toHaveTextContent('OP-rops-1');
    expect(tr).toHaveTextContent('고객 오해 — 통화 확인');
    expect(within(tr).queryByRole('button', { name: '제한함' })).not.toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('state') === 'DISMISSED')).toBe(true);
  });
});

describe('라이더 상세 — 열린 제한 검토·컴플레인', () => {
  it('그 라이더의 열린 검토와 컴플레인 기록을 보인다', async () => {
    const view = renderAt('/riders/RD-8', as.riderOps);
    const reviews = await screen.findByTestId('rider-reviews');
    expect(within(reviews).getByText('파손')).toBeInTheDocument();
    const complaints = await screen.findAllByTestId('complaint-row');
    expect(complaints).toHaveLength(3);
    expect(complaints[0]).toHaveTextContent('RC-6');
    expect(within(complaints[0]!).getByRole('link', { name: 'DLV-6' })).toHaveAttribute('href', '/deliveries/DLV-6');
    const rv = view.sent.find((r) => new URL(r.url).pathname.endsWith('/restriction-reviews'))!;
    expect([new URL(rv.url).searchParams.get('riderId'), new URL(rv.url).searchParams.get('state')]).toEqual(['RD-8', 'OPEN']);
    const rc = view.sent.find((r) => new URL(r.url).pathname.endsWith('/rider-complaints'))!;
    expect(new URL(rc.url).searchParams.get('riderId')).toBe('RD-8');
  });

  it('없으면 없다고, 컴플레인을 못 읽으면 빈 기록이 아니라 오류로 보인다', async () => {
    server.use(http.get(`${API_BASE}/rider-complaints`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 })));
    renderAt('/riders/RD-7', as.riderOps);
    expect(await screen.findByText('열린 검토가 없어요.')).toBeInTheDocument();
    const section = screen.getByRole('heading', { name: '컴플레인' }).closest('section')!;
    expect(await within(section).findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(within(section).queryByText('컴플레인 기록이 없어요.')).not.toBeInTheDocument();
  });
});

describe('라이더 상세 — 정산계좌·동의', () => {
  it('계좌는 등록 여부와 은행 이름만, 동의는 지금 동의한 버전으로 보인다', async () => {
    renderAt('/riders/RD-7', as.riderOps);
    const bank = await screen.findByTestId('rider-bank');
    expect(bank).toHaveTextContent('등록');
    expect(bank).toHaveTextContent('국민은행');
    expect(screen.getByText('지금 동의한 버전')).toBeInTheDocument();
    expect(screen.queryByText('동의 이력')).not.toBeInTheDocument();
    const consents = screen.getByTestId('rider-consents');
    expect(consents).toHaveTextContent('TERMS_OF_SERVICE');
    expect(consents).toHaveTextContent('2026-10');
  });

  it('계좌가 없으면 미등록, 동의가 없으면 없다고 보인다', async () => {
    renderAt('/riders/RD-8', as.riderOps);
    expect(await screen.findByTestId('rider-bank')).toHaveTextContent('미등록');
    expect(screen.getByText('동의한 항목이 없어요.')).toBeInTheDocument();
  });
});

describe('라이더 상세 — 배정 이력', () => {
  it('배정 최신순 — 결과·수행료(서버 값)·배차 취소 기록', async () => {
    const view = renderAt('/riders/RD-7', as.riderOps);
    const rows = await screen.findAllByTestId('assignment-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('진행 중');
    expect(rows[0]).toHaveTextContent('3,900');
    expect(within(rows[0]!).getByRole('link', { name: 'DLV-1' })).toHaveAttribute('href', '/deliveries/DLV-1');
    expect(rows[1]).toHaveTextContent('이 라이더로 끝남');
    expect(rows[2]).toHaveTextContent('픽업 전 취소');
    expect(rows[2]).toHaveTextContent('운영자 · 라이더 미도착');
    expect(rows[2]).toHaveTextContent('20분 넘게 가게에 안 옴');
    const req = view.sent.find((r) => new URL(r.url).pathname.endsWith('/rider-assignments'));
    expect(new URL(req!.url).searchParams.get('riderId')).toBe('RD-7');
  });

  it('다음 쪽은 서버가 준 cursor 로 부른다', async () => {
    server.use(
      http.get(`${API_BASE}/rider-assignments`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const row = (id: string) => ({ deliveryId: id, assignedAt: '2026-11-17T02:00:00.000Z', outcome: 'DONE', cancellation: null });
        return HttpResponse.json(cursor === 'C2' ? { items: [row('DLV-B')], page: { nextCursor: null } } : { items: [row('DLV-A')], page: { nextCursor: 'C2' } });
      }),
    );
    renderAt('/riders/RD-7', as.riderOps);
    expect(await screen.findByTestId('assignment-row')).toHaveTextContent('DLV-A');
    await userEvent.click(within(screen.getByTestId('rider-assignments').parentElement!).getByRole('button', { name: '다음 ›' }));
    expect(await screen.findByText('DLV-B')).toBeInTheDocument();
  });

  it('못 읽으면 빈 이력이 아니라 오류로 보인다', async () => {
    server.use(http.get(`${API_BASE}/rider-assignments`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 })));
    renderAt('/riders/RD-7', as.riderOps);
    const section = (await screen.findByRole('heading', { name: '배정 이력' })).closest('section')!;
    expect(await within(section).findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(within(section).queryByText('배정 이력이 없어요.')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('assignment-row')).not.toBeInTheDocument();
  });
});
