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
    expect(await within(help).findByRole('link', { name: /D48213075/ })).toHaveAttribute('href', '/deliveries/DLV-1');
    const q = caseCalls(view.sent)[0]!;
    expect([q.get('state'), q.get('kind'), q.get('size')]).toEqual([null, null, '50']);
  });

  it('다음 쪽은 nextCursor 로, 거르기·탭은 주소에 남는다', async () => {
    const view = renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    await userEvent.click(screen.getByRole('button', { name: /^다음/ }));
    expect(await screen.findByText('위치 3분 끊김')).toBeInTheDocument();
    expect(caseCalls(view.sent).at(-1)!.get('cursor')).toBe('2');

    // 종류는 깔때기 팝업 안 목록(라디오)으로 고른다(2026-11-21 시뮬레이터 모양)
    await userEvent.click(screen.getByTestId('search-toggle'));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '종류' })).getByRole('radio', { name: '배차 실패' }));
    expect(await screen.findByText('응답 만료 — 배차 실패')).toBeInTheDocument();
    const q = caseCalls(view.sent).at(-1)!;
    expect([q.get('kind'), q.get('cursor')]).toEqual(['DISPATCH_FAILED', null]);

    await userEvent.click(screen.getByRole('tab', { name: '처리 완료' }));
    expect(await screen.findByText('처리 완료된 접수 건이 없어요.')).toBeInTheDocument(); // 끝난 배차 실패는 없다
    expect(caseCalls(view.sent).at(-1)!.get('state')).toBe('CLOSED');
  });

  it('기한 넘긴 것만·아무도 안 맡은 것만', async () => {
    const view = renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    await userEvent.click(screen.getByTestId('search-toggle'));
    await userEvent.click(screen.getByLabelText('기한 넘긴 것만'));
    const rows = await screen.findAllByTestId('case-row');
    expect(rows).toHaveLength(1);
    expect(caseCalls(view.sent).at(-1)!.get('overdue')).toBe('true');
  });
});

describe('접수 건 상세', () => {
  it('내용·상태·처리 결과·이력, 끝난 건은 처리 끝내기 칸이 없다', async () => {
    renderAt('/cases/CASE-RH-0', as.riderOps);
    const detail = await screen.findByTestId('case-detail');
    expect(detail).toHaveTextContent('포장 대기 — 처리함');
    expect(detail).toHaveTextContent('처리 완료');
    expect(detail).toHaveTextContent('해결 — 매장 확인 뒤 픽업');
    expect(screen.getByTestId('case-history')).toHaveTextContent('처리 완료');
    expect(screen.getByRole('note')).toHaveTextContent('처리 끝내기');
    expect(screen.queryByRole('button', { name: /맡기|닫기|처리 끝내기/ })).not.toBeInTheDocument();
  });

  it('라이더 운영에게 안 보이는 종류는 찾지 못함(404) — 빈 화면이 아니라 오류', async () => {
    renderAt('/cases/CASE-PAY-1', as.riderOps);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('접수 건 처리 끝내기(사용자 2026-11-19 "처리 완료 버튼이 없네")', () => {
  const closeCalls = (sent: readonly Request[]) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/closures'));

  it('결과·처리 내용을 넣고 끝내면 닫히고, 같은 요청에 Idempotency-Key 가 붙는다', async () => {
    const view = renderAt('/cases/CASE-RH-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '처리 끝내기' });
    const submit = within(form).getByRole('button', { name: '처리 끝내기' });
    expect(submit).toBeDisabled(); // 처리 내용이 있어야
    await userEvent.type(within(form).getByLabelText(/처리 내용/), '고객과 통화해 문 앞에 두기로 함');
    await userEvent.click(submit);
    expect(await screen.findByTestId('case-closed-now')).toHaveTextContent('처리를 끝냈어요.');
    const call = closeCalls(view.sent)[0]!;
    expect(call.headers.get('Idempotency-Key')).toBeTruthy();
    expect((await call.clone().json()) as unknown).toEqual({ resolution: 'RESOLVED', summary: '고객과 통화해 문 앞에 두기로 함' });
    // 다시 읽으면 처리 끝 — 끝내기 칸이 사라지고 결과가 보인다
    expect(await screen.findByText(/해결 — 고객과 통화해/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '처리 끝내기' })).not.toBeInTheDocument();
  });

  it('후속 처리가 남은 건은 서버가 막는다 — 이유를 알린다', async () => {
    renderAt('/cases/CASE-DF-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '처리 끝내기' });
    await userEvent.type(within(form).getByLabelText(/처리 내용/), '배차 다시 요청함');
    await userEvent.click(within(form).getByRole('button', { name: '처리 끝내기' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('후속 처리');
  });
});
