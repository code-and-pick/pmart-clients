// 교대 인계(case 0.9.0 shift-handovers) — 목(MSW) 기준. 백엔드 PR #42 계약(병합·배포 전).
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

/** 지원센터(op-rider-ops-1)가 맡은 CASE-MOCK-3 을 op-cs-rider-1 에게 인계서로 */
async function writeHandover() {
  const view = renderAt('/cases/handovers', as.riderOps);
  const row = await screen.findByTestId('handover-case');
  expect(row).toHaveTextContent('위치 끊김');
  await userEvent.type(within(row).getByLabelText('다음 조치'), '라이더에게 다시 연락');
  await userEvent.type(screen.getByLabelText('후임 운영자 ID'), 'op-cs-rider-1');
  await userEvent.click(screen.getByRole('button', { name: '인계서 쓰기' }));
  expect(await screen.findByText(/인계서를 썼어요\(SH-MOCK-\d+\). 후임이 받을 때까지 담당은 그대로예요./)).toBeInTheDocument();
  return view;
}

describe('교대 인계', () => {
  it('자동으로 넘어가지 않는다는 안내, 다음 조치가 비었거나 후임이 나면 쓸 수 없다', async () => {
    renderAt('/cases/handovers', as.riderOps);
    expect((await screen.findByRole('note'))).toHaveTextContent('자동으로 넘어가거나 돌아가지 않고');
    const row = await screen.findByTestId('handover-case');
    const submit = screen.getByRole('button', { name: '인계서 쓰기' });
    await userEvent.type(screen.getByLabelText('후임 운영자 ID'), 'op-rider-ops-1');
    await userEvent.type(within(row).getByLabelText('다음 조치'), '확인');
    expect(submit).toBeDisabled(); // 후임 = 나
    await userEvent.clear(screen.getByLabelText('후임 운영자 ID'));
    await userEvent.type(screen.getByLabelText('후임 운영자 ID'), 'op-cs-rider-1');
    await userEvent.clear(within(row).getByLabelText('다음 조치'));
    expect(submit).toBeDisabled(); // 다음 조치 필수
  });

  it('쓰기 → 본문(팀·후임·건별 다음 조치), 받기 전에는 담당 그대로', async () => {
    const view = await writeHandover();
    const sent = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/shift-handovers'))!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ group: 'DELIVERY_OPS', toOperatorId: 'op-cs-rider-1', items: [{ caseId: 'CASE-MOCK-3', nextAction: '라이더에게 다시 연락' }] });
    cleanup();
    renderAt('/cases/CASE-MOCK-3', as.riderOps);
    expect(await screen.findByTestId('case-assignee')).toHaveTextContent('op-rider-ops-1');
  });

  it('후임이 모두 받기 → 건별 "받음", 담당이 후임으로, 이력 "인계됨"', async () => {
    await writeHandover();
    cleanup();
    const view = renderAt('/cases/handovers?tab=inbox', as.csRider);
    const card = await screen.findByTestId('handover');
    expect(card).toHaveTextContent('아직 받기 전이에요');
    await userEvent.click(within(card).getByRole('button', { name: '모두 받기' }));
    await waitFor(() => expect(screen.getByTestId('handover-item')).toHaveAttribute('data-outcome', 'ACCEPTED'));
    expect(screen.getByTestId('handover-item')).toHaveTextContent('받음');
    expect(await view.mutations('/acceptances')[0]!.json()).toEqual({});
    cleanup();
    renderAt('/cases/CASE-MOCK-3', as.csRider);
    expect(await screen.findByTestId('case-assignee')).toHaveTextContent('op-cs-rider-1');
    expect(screen.getByText(/인계됨 · op-cs-rider-1 → .* · op-rider-ops-1 → op-cs-rider-1: 라이더에게 다시 연락/)).toBeInTheDocument();
  });

  it('안 받은 건은 "안 받음(미인수)" — 전임 그대로, 관리자 미인수 목록에 보인다', async () => {
    await writeHandover();
    cleanup();
    const view = renderAt('/cases/handovers?tab=inbox', as.csRider);
    const card = await screen.findByTestId('handover');
    await userEvent.click(within(card).getByRole('checkbox', { name: 'CASE-MOCK-3 받기' }));
    await userEvent.click(within(card).getByRole('button', { name: '고른 것만 받기(1건 빼고)' }));
    await waitFor(() => expect(screen.getByTestId('handover-item')).toHaveAttribute('data-outcome', 'EXCLUDED'));
    expect(await view.mutations('/acceptances')[0]!.json()).toEqual({ excludedCaseIds: ['CASE-MOCK-3'] });
    cleanup();
    renderAt('/cases/handovers?tab=unreceived', as.admin);
    const un = await screen.findByTestId('handover');
    expect(un).toHaveTextContent('미인수');
    // 관리자는 대신 받을 수 없다(받기 버튼 없음)
    expect(within(un).queryByRole('button', { name: /받기/ })).not.toBeInTheDocument();
  });

  it('내가 쓴 인계는 받기 전에 취소할 수 있다', async () => {
    await writeHandover();
    await userEvent.click(screen.getByRole('tab', { name: '내가 쓴 인계' }));
    const card = await screen.findByTestId('handover');
    await userEvent.click(within(card).getByRole('button', { name: '인계서 취소' }));
    await waitFor(() => expect(screen.getByTestId('handover')).toHaveAttribute('data-state', 'CANCELLED'));
  });
});

describe('교대 인계 역할(case 0.13.1)', () => {
  it('라이더 운영은 팀이 지원센터로 고정, 후임 칸 옆에 팀 역할 안내 — 관리자는 팀을 고른다', async () => {
    renderAt('/cases/handovers', as.riderOps);
    expect(await screen.findByTestId('handover-group-fixed')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '팀' })).not.toBeInTheDocument();
    expect(screen.getByTestId('handover-to-hint')).toHaveTextContent('후임도 그 팀 역할');
    cleanup();
    renderAt('/cases/handovers', as.admin);
    expect(await screen.findByRole('combobox', { name: '팀' })).toBeInTheDocument();
  });

  it('상담원: 메뉴에 교대 인계가 없고, 화면을 열어도 쓰기 탭이 없다', async () => {
    renderAt('/cases/handovers', as.cs);
    const support = await screen.findByTestId('nav-group-support');
    expect(within(support).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).not.toContain('교대 인계');
    expect(screen.queryByRole('tab', { name: '인계서 쓰기' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '나에게 온 인계' })).toHaveAttribute('aria-selected', 'true');
  });

  it('후임에게 그 팀 역할이 없으면 수락 403 — 안내 문구, 인계서는 받기 전 그대로', async () => {
    renderAt('/cases/handovers', as.riderOps);
    const row = await screen.findByTestId('handover-case');
    await userEvent.type(within(row).getByLabelText('다음 조치'), '라이더에게 다시 연락');
    await userEvent.type(screen.getByLabelText('후임 운영자 ID'), 'op-cs-1');
    await userEvent.click(screen.getByRole('button', { name: '인계서 쓰기' }));
    await screen.findByText(/인계서를 썼어요/);
    cleanup();
    renderAt('/cases/handovers?tab=inbox', as.cs);
    const card = await screen.findByTestId('handover');
    await userEvent.click(within(card).getByRole('button', { name: '모두 받기' }));
    expect(await screen.findByTestId('handover-accept-forbidden')).toHaveTextContent('전임에게 다시 써 달라고 하세요');
    expect(screen.getByTestId('handover')).toHaveAttribute('data-state', 'PENDING');
  });
});
