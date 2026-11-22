// 문의 만족도(case 0.15.0, 관리자만)·배송 신고(0.16.0)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('문의 만족도', () => {
  it('관리자: 기간의 "답변 N건 중 M건 응답"·평균·점수별 — 서버에 답변 시각 기간으로 묻는다', async () => {
    const view = renderAt('/inquiry-satisfaction?from=2026-11-10&to=2026-11-16', as.admin);
    expect(await screen.findByTestId('satisfaction-response')).toHaveTextContent('답변 2건 중 1건 응답(1/2)');
    expect(screen.getByTestId('satisfaction-average')).toHaveTextContent('4.00점');
    const rows = screen.getAllByTestId('satisfaction-score');
    expect(rows.map((r) => r.textContent)).toEqual(['5점0%0건', '4점100%1건', '3점0%0건', '2점0%0건', '1점0%0건']); // 2026-11-20 몫(%) 칸 더함 — 응답 1건 중
    expect(screen.queryByText(/상담원별 순위·이름은 보여 주지 않아요/)).not.toBeInTheDocument(); // 설명 줄은 뺐다(2026-11-20) — 서버가 상담원별 값을 주지 않는다
    const q = new URL(view.sent.find((r) => new URL(r.url).pathname.endsWith('/satisfaction-summary'))!.url).searchParams;
    expect(q.get('answeredFrom')).toBe('2026-11-10T00:00:00+09:00');
    expect(q.get('answeredTo')).toBe('2026-11-16T23:59:59+09:00');
  });

  it('남긴 건이 없으면 평균은 "—"(0 으로 만들지 않음), 92일 넘는 기간은 보낼 수 없다', async () => {
    renderAt('/inquiry-satisfaction?from=2026-10-01&to=2026-10-07', as.admin);
    expect(await screen.findByTestId('satisfaction-response')).toHaveTextContent('이 기간에 답변한 문의가 없어요');
    expect(screen.getByTestId('satisfaction-average')).toHaveTextContent('—');
    const from = screen.getByLabelText('시작일');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-01-01');
    expect(screen.getByText('기간은 92일까지예요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보기' })).toBeDisabled();
  });

  it('상담원: 메뉴에 없고, 문의 상세에도 고객 점수가 없다(관리자에게만 온다)', async () => {
    renderAt('/inquiries/INQ-MOCK-1', as.cs);
    await screen.findByTestId('inquiry-body');
    expect(screen.queryByTestId('inquiry-satisfaction')).not.toBeInTheDocument();
    const cs = screen.getByTestId('nav-group-cs');
    expect(within(cs).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).not.toContain('문의 만족도');
  });

  it('관리자: 문의 상세에 고객 점수·한 줄', async () => {
    renderAt('/inquiries/INQ-MOCK-1', as.admin);
    const s = await screen.findByTestId('inquiry-satisfaction');
    expect(s).toHaveTextContent('4/5점');
    expect(s).toHaveTextContent('빨리 답해 줘서 좋았어요');
  });
});

describe('배송 신고(case 0.16.0)', () => {
  it('목록에 "배송 신고 · 못 받음", 상세에 배송 번호 링크', async () => {
    renderAt('/inquiries', as.cs);
    const rows = await screen.findAllByTestId('inquiry-row');
    const row = rows.find((r) => r.textContent?.includes('Q-1119-0003'))!;
    expect(within(row).getByTestId('inquiry-delivery-issue')).toHaveTextContent('배송 신고 · 못 받음');
    await userEvent.click(within(row).getByTestId('inquiry-number'));
    const issue = await screen.findByTestId('inquiry-delivery-issue');
    expect(issue).toHaveTextContent('못 받음 · 배송');
    // 화면 배송 번호(ADR-0070) — 링크는 시스템 ID
    expect(within(issue).getByTestId('inquiry-delivery')).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
    expect(await within(issue).findByText('D74939001')).toBeInTheDocument();
  });
});
