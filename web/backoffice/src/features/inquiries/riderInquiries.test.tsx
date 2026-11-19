// 라이더 문의(case 0.13.0, 백엔드 요청 2026-11-16 request-rider-inquiries) — 지원센터 메뉴, requesterType 거르기, 종류별 답변 역할
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const navLinks = (group: string) =>
  within(screen.getByTestId(`nav-group-${group}`))
    .getAllByRole('link', { hidden: true })
    .map((a) => a.childNodes[0]?.textContent); // 메뉴 이름만(업무 알림 숫자 빼고)

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
    expect(rows.map((r) => within(r).getByTestId('inquiry-number').textContent)).toEqual(['Q-1119-0101', 'Q-1119-0102']);
    expect(rows[0]).toHaveTextContent('정산');
    expect(rows[1]).toHaveTextContent('앱 오류');
    const list = view.sent.find((r) => new URL(r.url).pathname.endsWith('/inquiries'))!;
    expect(new URL(list.url).searchParams.get('requesterType')).toBe('RIDER');

    await userEvent.click(within(rows[0]!).getByTestId('inquiry-number'));
    expect(await screen.findByTestId('inquiry-requester')).toHaveTextContent('라이더');
    // 화면 번호(ADR-0070): 라이더 "가린 이름 · 6자리" — 시스템 ID 는 링크에만
    expect(await screen.findByTestId('inquiry-rider')).toHaveAttribute('href', '/riders/RID-MOCK-1');
    expect(await within(screen.getByTestId('inquiry-rider')).findByText(/482913/)).toBeInTheDocument();
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
    expect(rows.map((r) => within(r).getByTestId('inquiry-number').textContent)).not.toContain('INQ-MOCK-R1');
    const list = view.sent.find((r) => new URL(r.url).pathname.endsWith('/inquiries'))!;
    expect(new URL(list.url).searchParams.get('requesterType')).toBe('CUSTOMER');
  });

  it('관리자는 라이더 문의를 보기만(답변 칸 없음)', async () => {
    renderAt('/rider-inquiries/INQ-MOCK-R1', as.admin);
    expect(await screen.findByTestId('inquiry-read-only')).toHaveTextContent('라이더 문의 답변은 지원센터가 해요');
    expect(screen.queryByLabelText('답변 쓰기')).not.toBeInTheDocument();
  });

  it('상담원이 라이더 문의 목록을 열면 403 — "문의 없음"이 아니라 오류', async () => {
    renderAt('/rider-inquiries', as.cs);
    expect(await screen.findByText('이용할 수 없는 화면이에요')).toBeInTheDocument();
    expect(screen.queryByText('이 조건의 문의가 없어요.')).not.toBeInTheDocument();
  });

  it('라이더 문의 대화(case 0.21.0): 라이더가 이어 쓴 줄은 답변이 아니라 "라이더"로, 이어 쓰면 다시 답변 대기 안내', async () => {
    renderAt('/rider-inquiries/INQ-MOCK-R2', as.riderOps);
    expect(await screen.findByRole('heading', { name: '대화' })).toBeInTheDocument();
    const lines = screen.getAllByTestId('inquiry-reply');
    expect(lines.map((l) => l.getAttribute('data-author'))).toEqual(['AGENT', 'RIDER']);
    expect(lines[0]).toHaveTextContent('답변');
    expect(lines[1]).toHaveTextContent('라이더');
    expect(lines[1]).toHaveTextContent('다시 켜도 안 눌려요');
    expect(screen.getByTestId('inquiry-rider-followup')).toHaveTextContent('다시 답변을 기다려요');
    expect(screen.getByTestId('inquiry-status')).toHaveTextContent('접수');
    expect(screen.getByLabelText('답변 쓰기')).toBeInTheDocument(); // 답변은 지금처럼
  });
});
