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
