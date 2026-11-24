// 접수 건(case 0.22.0, 보기만) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const caseCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/cases')).map((r) => new URL(r.url).searchParams);

describe('접수 건 목록', () => {
  it('우선순위는 글자(P1 긴급·P2 높음), 코드는 올려 보면 — 삼각형과 한 줄(2026-11-24)', async () => {
    renderAt('/cases', as.riderOps);
    const rows = await screen.findAllByTestId('case-row');
    const cell = rows[0]!.querySelector('td')!;
    expect(cell.textContent).toMatch(/긴급|높음|보통|낮음/);
    expect(cell.textContent).not.toMatch(/P\d/);
    expect(cell.querySelector('span.flex')).not.toBeNull();
  });

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
  it('기한 넘긴 열린 사건: 맨 위 빨간 경고, 이력은 최신이 위·5개 + 더 보기, "접수 → 접수됨" 대신 "접수"(2026-11-24)', async () => {
    const at = (h: number) => `2026-11-20T${String(h).padStart(2, '0')}:00:00.000Z`;
    const history = [
      { at: at(1), action: 'OPENED', toState: 'OPEN', note: 'DispatchFailed' },
      ...[2, 3, 4, 5, 6, 7, 8].map((h) => ({ at: at(h), action: 'RECURRED', toState: 'OPEN', note: `배차 실패 ${h}번째` })),
    ];
    server.use(
      http.get(`${API_BASE}/cases/CASE-X`, () =>
        HttpResponse.json({ caseId: 'CASE-X', kind: 'DISPATCH_FAILED', state: 'OPEN', priority: 'P2', summary: '배차 실패 — 응답 만료', overdue: true, slaDueAt: at(1), openedAt: at(1), assigneeId: null, refs: [], history }),
      ),
    );
    renderAt('/cases/CASE-X', as.riderOps);
    const urgent = await screen.findByTestId('case-urgent');
    expect(urgent).toHaveTextContent('빨리 처리해 주세요');
    expect(urgent).toHaveTextContent('아직 아무도 안 맡았어요');
    expect(urgent).toHaveTextContent('7번 더');
    const list = screen.getByTestId('case-history');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('배차 실패 8번째');
    await userEvent.click(screen.getByTestId('case-history-more'));
    const all = within(screen.getByTestId('case-history')).getAllByRole('listitem');
    expect(all).toHaveLength(8);
    expect(all[7]).toHaveTextContent(/^접수\d/);
    expect(all[7]).not.toHaveTextContent('접수됨');
    expect(all[7]).toHaveTextContent('배차 실패');
  });

  it('내용·상태·처리 결과·이력, 끝난 건은 처리 끝내기 칸이 없다', async () => {
    renderAt('/cases/CASE-RH-0', as.riderOps);
    const detail = await screen.findByTestId('case-detail');
    // 2026-11-24 상세 단순화 — 내용은 제목, 상태는 제목 옆 꼬리표, 칸에는 다시 적지 않는다. 안내 상자는 없다
    expect(screen.getByRole('heading', { name: /포장 대기 — 처리함/ })).toBeInTheDocument();
    expect(detail).not.toHaveTextContent('포장 대기 — 처리함');
    expect(detail).toHaveTextContent('해결 — 매장 확인 뒤 픽업');
    expect(screen.getByTestId('case-history')).toHaveTextContent('처리 완료');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
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
