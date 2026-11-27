// 통합 작업관리 — Wave 를 골라야 목록(waveId 필수), 묶음 작업 TRF 수, 상세 줄·TRF 별 몫.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('작업 목록', () => {
  it('Wave 를 고르기 전에는 서버에 작업을 묻지 않는다', async () => {
    const view = renderAt('/c/CDC01/tasks');
    expect(await screen.findByTestId('task-no-wave')).toBeInTheDocument();
    await waitFor(() => expect(view.gets('/cdcs/CDC01/waves')).toHaveLength(1));
    expect(view.gets('/cdcs/CDC01/tasks')).toHaveLength(0);
  });

  it('Wave 를 안 골랐으면 최근 Wave 를 진행 중 먼저 보이고, 누르면 그 Wave 작업', async () => {
    const view = renderAt('/c/CDC01/tasks');
    const rows = await screen.findAllByTestId('task-recent-wave');
    expect(rows).toHaveLength(2);
    const w = rows.find((r) => r.textContent?.includes('W4821'))!;
    expect(w).toHaveTextContent('TRF 2건');
    await userEvent.click(w);
    await waitFor(() => expect(view.gets('/cdcs/CDC01/tasks').length).toBeGreaterThan(0));
    expect(new URL(view.gets('/cdcs/CDC01/tasks')[0]!.url).searchParams.get('waveId')).toBe('WAVE-20261126-01');
  });

  it('최근 TRF 의 Wave 를 고르면 그 Wave 작업 — 묶음은 TRF 수, 부족은 빨강', async () => {
    renderAt('/c/CDC01/tasks');
    const select = await screen.findByTestId('task-wave-select');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('W4821'));
    await userEvent.selectOptions(select, 'WAVE-20261126-01');
    const rows = await screen.findAllByTestId('task-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('묶음 TRF 2개')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('(부족 2)')).toHaveClass('text-error');
    expect(screen.getByTestId('task-wave-head')).toHaveTextContent('진행 중');
  });

  it('상태 거르기', async () => {
    renderAt('/c/CDC01/tasks?waveId=WAVE-20261126-01');
    await screen.findAllByTestId('task-row');
    await userEvent.selectOptions(screen.getByTestId('task-state'), 'DONE');
    await waitFor(() => expect(screen.getAllByTestId('task-row')).toHaveLength(1));
  });
});

describe('작업 상세', () => {
  it('줄과 TRF 별 몫', async () => {
    renderAt('/c/CDC01/tasks/TSK-0001');
    const lines = await screen.findByTestId('task-lines');
    // TRF 별 몫 = MFC 이름 · TRF 화면 번호 · 피킹/계획
    expect(within(lines).getByText('T482913')).toBeInTheDocument();
    expect((await within(lines).findAllByText('부산진구 MFC')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('task-fields')).toHaveTextContent('BUSAN');
  });
});

describe('작업 조작', () => {
  it('시작 전 작업 — 보류하면 서버 상태(보류)로, 멱등키·버전과 함께', async () => {
    const view = renderAt('/c/CDC01/tasks/TSK-0004');
    await userEvent.click(await screen.findByTestId('task-op-hold'));
    await userEvent.click(screen.getByTestId('task-op-go'));
    await waitFor(() => expect(screen.getByTestId('task-op-resume')).toBeInTheDocument());
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/holds'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Expected-Version')).toBeTruthy();
  });

  it('우선순위 — 지금 값과 같거나 범위를 벗어나면 못 보냄', async () => {
    renderAt('/c/CDC01/tasks/TSK-0004');
    await userEvent.click(await screen.findByTestId('task-op-priority'));
    expect(screen.getByTestId('task-op-go')).toBeDisabled();
    await userEvent.clear(screen.getByTestId('task-priority'));
    await userEvent.type(screen.getByTestId('task-priority'), '200');
    expect(screen.getByTestId('task-op-go')).toBeDisabled();
    await userEvent.clear(screen.getByTestId('task-priority'));
    await userEvent.type(screen.getByTestId('task-priority'), '50');
    await userEvent.click(screen.getByTestId('task-op-go'));
    await waitFor(() => expect(screen.getByTestId('task-controls')).toHaveTextContent('우선순위 50'));
  });
});
