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

  it('최근 TRF 의 Wave 를 고르면 그 Wave 작업 — 묶음은 TRF 수, 부족은 빨강', async () => {
    renderAt('/c/CDC01/tasks');
    const select = await screen.findByTestId('task-wave-select');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('WAVE-20261126-01'));
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
    expect(within(lines).getByText(/MFC-BJG-01 TRF-20261126-0001 · 32\/40/)).toBeInTheDocument();
    expect(screen.getByTestId('task-fields')).toHaveTextContent('BUSAN');
  });
});
