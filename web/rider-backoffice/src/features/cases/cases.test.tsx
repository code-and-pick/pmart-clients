// 접수 건(case 0.22.0, 보기만) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const caseCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/cases')).map((r) => new URL(r.url).searchParams);

describe('접수 건 목록', () => {
  it('처리 중: 배송 쪽 종류만(라이더 운영), 기한 넘김 표시, 관련 배송은 배송 상세로', async () => {
    const view = renderAt('/cases', as.riderOps);
    const rows = await screen.findAllByTestId('case-row');
    expect(rows).toHaveLength(2); // 첫 쪽 2건(목 size)
    expect(screen.queryByText('결제 결과 모름')).not.toBeInTheDocument();
    const help = rows.find((r) => r.textContent?.includes('고객 연락 안 됨'))!;
    expect(within(help).getByText('라이더 도움요청')).toBeInTheDocument();
    expect(within(help).getByText(/기한 넘김/)).toHaveAttribute('data-overdue', 'true');
    expect(await within(help).findByRole('link', { name: /48213075-1/ })).toHaveAttribute('href', '/deliveries/DLV-1');
    const q = caseCalls(view.sent)[0]!;
    expect([q.get('state'), q.get('kind'), q.get('size')]).toEqual([null, null, '50']);
  });

  it('다음 쪽은 nextCursor 로, 거르기·탭은 주소에 남는다', async () => {
    const view = renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    await userEvent.click(screen.getByRole('button', { name: /^다음/ }));
    expect(await screen.findByText('위치 3분 끊김')).toBeInTheDocument();
    expect(caseCalls(view.sent).at(-1)!.get('cursor')).toBe('2');

    // 종류는 칩(라디오)으로 고른다(2026-11-18 화면 개편)
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '종류' })).getByRole('radio', { name: '배차 실패' }));
    expect(await screen.findByText('응답 만료 — 배차 실패')).toBeInTheDocument();
    const q = caseCalls(view.sent).at(-1)!;
    expect([q.get('kind'), q.get('cursor')]).toEqual(['DISPATCH_FAILED', null]);

    await userEvent.click(screen.getByRole('tab', { name: '처리 끝남' }));
    expect(await screen.findByText('처리 끝난 접수 건이 없어요.')).toBeInTheDocument(); // 끝난 배차 실패는 없다
    expect(caseCalls(view.sent).at(-1)!.get('state')).toBe('CLOSED');
  });

  it('기한 넘긴 것만·아무도 안 맡은 것만', async () => {
    const view = renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    await userEvent.click(screen.getByLabelText('기한 넘긴 것만'));
    const rows = await screen.findAllByTestId('case-row');
    expect(rows).toHaveLength(1);
    expect(caseCalls(view.sent).at(-1)!.get('overdue')).toBe('true');
  });
});

describe('접수 건 상세', () => {
  it('내용·상태·처리 결과·이력, 보기만 안내 — 맡기·닫기 버튼 없음', async () => {
    renderAt('/cases/CASE-RH-0', as.riderOps);
    const detail = await screen.findByTestId('case-detail');
    expect(detail).toHaveTextContent('포장 대기 — 처리함');
    expect(detail).toHaveTextContent('처리 끝남');
    expect(detail).toHaveTextContent('해결 — 매장 확인 뒤 픽업');
    expect(screen.getByTestId('case-history')).toHaveTextContent('처리 끝냄');
    expect(screen.getByRole('note')).toHaveTextContent('보기만');
    expect(screen.queryByRole('button', { name: /맡기|닫기|처리 끝내기/ })).not.toBeInTheDocument();
  });

  it('라이더 운영에게 안 보이는 종류는 찾지 못함(404) — 빈 화면이 아니라 오류', async () => {
    renderAt('/cases/CASE-PAY-1', as.riderOps);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
