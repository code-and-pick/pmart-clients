// 라이더 문의(case 0.13.0, 백엔드 요청 2026-11-16 request-rider-inquiries) — 지원센터 메뉴, requesterType 거르기, 종류별 답변 역할
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const navLinks = (group: string) =>
  within(screen.getByTestId(`nav-group-${group}`))
    .getAllByRole('link', { hidden: true })
    .map((a) => a.textContent);

describe('라이더 문의', () => {
  it('메뉴: 지원센터에 "라이더 문의" — 라이더 운영에게는 보이고 상담원에게는 없다', async () => {
    const rider = renderAt('/rider-inquiries', as.riderOps);
    await screen.findAllByTestId('inquiry-row');
    expect(navLinks('support')).toContain('라이더 문의');
    rider.unmount();

    renderAt('/cases', as.cs);
    await screen.findByTestId('nav-group-support');
    expect(navLinks('support')).not.toContain('라이더 문의');
  });

  it('목록은 requesterType=RIDER 로 묻고, 상세는 라이더 ID(라이더 찾기 링크) — 답변은 지원센터가', async () => {
    const view = renderAt('/rider-inquiries', as.riderOps);
    const rows = await screen.findAllByTestId('inquiry-row');
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual(['INQ-MOCK-R1', 'INQ-MOCK-R2']);
    expect(rows[0]).toHaveTextContent('정산');
    expect(rows[1]).toHaveTextContent('앱 오류');
    const list = view.sent.find((r) => new URL(r.url).pathname.endsWith('/inquiries'))!;
    expect(new URL(list.url).searchParams.get('requesterType')).toBe('RIDER');

    await userEvent.click(within(rows[0]!).getByRole('link', { name: 'INQ-MOCK-R1' }));
    expect(await screen.findByTestId('inquiry-requester')).toHaveTextContent('라이더');
    expect(screen.getByRole('link', { name: 'RID-MOCK-1' })).toHaveAttribute('href', '/riders/RID-MOCK-1');
    expect(screen.queryByText('고객 ID')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '이 문의로 라이더 컴플레인 기록' })).not.toBeInTheDocument();
    expect(screen.getByText('라이더는 앱의 문의에서 답변을 봐요. 답변은 고칠 수 없어요.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('답변 쓰기'), '정산은 내일 반영돼요');
    await userEvent.click(screen.getByRole('button', { name: '답변 보내기' }));
    await waitFor(() => expect(screen.getByTestId('inquiry-status')).toHaveTextContent('답변 완료'));
    const sent = view.mutations('/replies');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.get('X-Expected-Version')).toBe('1');
    expect(screen.getByRole('link', { name: '라이더 문의 목록' })).toHaveAttribute('href', '/rider-inquiries');
  });

  it('고객센터 문의 목록은 requesterType=CUSTOMER — 라이더 문의가 섞이지 않는다', async () => {
    const view = renderAt('/inquiries', as.admin);
    const rows = await screen.findAllByTestId('inquiry-row');
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).not.toContain('INQ-MOCK-R1');
    const list = view.sent.find((r) => new URL(r.url).pathname.endsWith('/inquiries'))!;
    expect(new URL(list.url).searchParams.get('requesterType')).toBe('CUSTOMER');
  });

  it('관리자는 라이더 문의를 보기만(답변 칸 없음)', async () => {
    renderAt('/rider-inquiries/INQ-MOCK-R1', as.admin);
    expect(await screen.findByTestId('inquiry-read-only')).toHaveTextContent('라이더 문의 답변은 지원센터(RIDER_OPS)가 해요');
    expect(screen.queryByLabelText('답변 쓰기')).not.toBeInTheDocument();
  });

  it('상담원이 라이더 문의 목록을 열면 403 — "문의 없음"이 아니라 오류', async () => {
    renderAt('/rider-inquiries', as.cs);
    expect(await screen.findByText('이용할 수 없는 화면이에요')).toBeInTheDocument();
    expect(screen.queryByText('이 조건의 문의가 없어요.')).not.toBeInTheDocument();
  });
});
