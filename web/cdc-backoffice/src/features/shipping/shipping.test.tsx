// 출고관리(출발 검증 0.16.0)·TRF 출발 준비·칸별 재고(0.9.0)·실사(0.8.0).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('출발 검증', () => {
  it('최신 순 목록 — 펼치면 TRF 별 결과·재고 반영·해제 실패 사유와 불일치', async () => {
    renderAt('/c/CDC01/shipping');
    const rows = await screen.findAllByTestId('departure-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('일부 일치')).toBeInTheDocument();
    await userEvent.click(rows[0]!);
    const detail = screen.getByTestId('departure-detail');
    expect(within(detail).getByText('409 INVALID_STATE')).toBeInTheDocument();
    expect(within(screen.getByTestId('departure-mismatches')).getByText('실리지 않은 LPN')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'TRF-20261126-0001' })).toHaveAttribute('href', '/c/CDC01/trf-wave/trf/TRF-20261126-0001');
  });

  it('결과 거르기는 서버로', async () => {
    const view = renderAt('/c/CDC01/shipping');
    await screen.findAllByTestId('departure-row');
    await userEvent.selectOptions(screen.getByTestId('departure-result'), 'MATCHED');
    await waitFor(() => expect(screen.getAllByTestId('departure-row')).toHaveLength(1));
    expect(view.gets('/departures').some((r) => new URL(r.url).searchParams.get('result') === 'MATCHED')).toBe(true);
  });
});

describe('TRF 출발 준비', () => {
  it('TRF 상세에 단계·준비 수량·막힌 이유', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const r = await screen.findByTestId('trf-readiness');
    expect(r).toHaveTextContent('피킹 중');
    expect(r).toHaveTextContent('피킹 부족 재할당 중');
  });
});

describe('칸별 재고', () => {
  it('로케이션 상세에 그 칸 재고', async () => {
    const view = renderAt('/c/CDC01/master/locations/CDC01-A-5-63-01-2-1');
    const rows = await screen.findAllByTestId('location-stock-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('SKU-1001')).toBeInTheDocument();
    expect(new URL(view.gets('/location-stocks')[0]!.url).searchParams.get('locationPrefix')).toBe('CDC01-A-5-63-01-2-1');
  });

  it('재고관리 [칸별 재고] — 칸 코드 앞부분으로', async () => {
    renderAt('/c/CDC01/inventory?tab=places');
    const input = await screen.findByTestId('places-prefix');
    await userEvent.clear(input);
    await userEvent.type(input, 'CDC01-A-5');
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    expect(await screen.findAllByTestId('location-stock-row')).toHaveLength(3);
  });
});

describe('실사', () => {
  it('칸을 넣고 시작하면 그 실사로 — 계수표만(장부 수량 없음), 현장 계수 대기', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=count');
    await userEvent.type(await screen.findByTestId('count-codes'), 'CDC01-A-5-03-02-1-1');
    await userEvent.click(screen.getByTestId('count-start-go'));
    expect(await screen.findByRole('heading', { name: '실사 CNT-0002' })).toBeInTheDocument();
    expect(screen.getByText('현장 PDA 계수를 기다리는 중이에요.')).toBeInTheDocument();
    expect(screen.getByTestId('count-sheet')).toHaveTextContent('SKU-1001');
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(await post.json()).toEqual({ locationCodes: ['CDC01-A-5-03-02-1-1'] });
  });

  it('결정 대기 실사를 번호로 열어 승인 — 결과 줄(장부·최종·차이)', async () => {
    renderAt('/c/CDC01/inventory?tab=count&session=CNT-0001');
    await screen.findByTestId('count-decide');
    expect(screen.getByTestId('count-approve')).toBeDisabled();
    await userEvent.type(screen.getByTestId('count-decision-reason'), '재계수 맞음');
    await userEvent.click(screen.getByTestId('count-approve'));
    expect(await screen.findByText('결정했어요.')).toBeInTheDocument();
    expect(await screen.findByTestId('count-lines')).toHaveTextContent('-2');
  });
});
