// 흐름 파악(사용자 2026-11-27 "백오피스로 내용이나 실시간 흐름을 파악하기가 너무 어렵다" → 1·2·4):
// 대시보드 오늘 흐름 일곱 칸, 지금 손봐야 할 것, 머리줄 번호로 찾기, TRF 상세의 손볼 것.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';
import { flowStageOf } from './flowStage';

describe('오늘 흐름', () => {
  it('TRF 상태 → 일곱 단계(취소는 뺌)', () => {
    expect(flowStageOf('ALLOCATION_FAILED', undefined, undefined)).toBe('RECEIVED');
    expect(flowStageOf('PARTIALLY_ALLOCATED', undefined, undefined)).toBe('ALLOCATED');
    expect(flowStageOf('IN_WAVE', undefined, undefined)).toBe('PICKING');
    expect(flowStageOf('LOADED', undefined, undefined)).toBe('PACKING');
    expect(flowStageOf('DEPARTED', undefined, undefined)).toBe('ON_WAY');
    expect(flowStageOf('CANCELLED', undefined, undefined)).toBeNull();
  });

  it('대시보드 맨 위 일곱 칸 — 칸을 누르면 그 단계 요청, 요청은 TRF 상세로', async () => {
    renderAt('/c/CDC01/dashboard');
    const board = await screen.findByTestId('flow-board');
    await waitFor(() => expect(within(board).getByTestId('flow-board-PICKING')).toHaveTextContent('3건'));
    expect(within(board).getByTestId('flow-board-ALLOCATED')).toHaveTextContent('2건');
    expect(within(board).getByTestId('flow-board-RECEIVED')).toHaveTextContent('손볼 것 1');
    await userEvent.click(within(board).getByTestId('flow-board-RECEIVED'));
    const rows = within(board).getAllByTestId('flow-board-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('T927460');
    expect(rows[0]).toHaveTextContent('재고를 못 찾음');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/c/CDC01/trf-wave/trf/TRF-20261126-0006');
  });

  it('지금 손봐야 할 것 — 건수 있는 일은 이유와 함께 위에, 0 인 것은 "문제 없음" 한 줄', async () => {
    renderAt('/c/CDC01/dashboard');
    const todo = await screen.findByTestId('dash-attention');
    await waitFor(() => expect(within(todo).getByTestId('attn-allocFailed')).toHaveTextContent('재고를 못 찾은 요청'));
    expect(within(todo).getByTestId('attn-allocFailed')).toHaveAttribute('href', '/c/CDC01/trf-wave?state=ALLOCATION_FAILED');
    expect(within(todo).getByTestId('attn-shortages')).toHaveTextContent('선반에서 물건이 모자란다고');
    await waitFor(() => expect(within(todo).getByTestId('attn-receiptBad')).toHaveTextContent('MFC 입고 수량이 안 맞는 출발'));
  });
});

describe('번호로 찾기', () => {
  it('머리줄에서 T 번호 → TRF 상세, W 번호 → Wave 상세, 없으면 못 찾았다고', async () => {
    renderAt('/c/CDC01/dashboard');
    const input = await screen.findByTestId('number-search-input');
    await userEvent.type(input, 'T482913');
    await userEvent.click(screen.getByTestId('number-search-go'));
    expect(await screen.findByTestId('trf-fields')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('number-search-input'), 'W4821');
    await userEvent.click(screen.getByTestId('number-search-go'));
    expect(await screen.findByTestId('wave-fields')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('number-search-input'), 'T000000');
    await userEvent.click(screen.getByTestId('number-search-go'));
    expect(await screen.findByTestId('number-search-note')).toHaveTextContent('T000000 를 찾지 못했어요');
  });
});

describe('TRF 상세 — 이 요청에서 손볼 것', () => {
  it('피킹 부족이 걸린 요청은 무엇이 어디서 모자란지', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const box = await screen.findByTestId('trf-issues');
    await waitFor(() => expect(box).toHaveTextContent('SKU-1002 2개가 CDC01-B-6-67-01-1-1 칸에서 모자라요'));
  });

  it('손볼 것이 없으면 없다고', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0004');
    const box = await screen.findByTestId('trf-issues');
    await waitFor(() => expect(box).toHaveTextContent('손볼 것이 없어요.'));
  });
});
