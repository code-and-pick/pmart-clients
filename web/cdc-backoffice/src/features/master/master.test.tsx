// 기준정보 — 상품 취급 켜기/끄기(기대 버전·서버 판정), 로케이션 목록 거르기·점유 모름, 상태 바꾸기(사유 필수·서버 상태로 확인), 통로 피킹 방식.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('상품 취급', () => {
  it('끄면 기대 버전을 붙여 보내고, 서버가 바꾼 값으로 다시 그린다', async () => {
    const view = renderAt('/c/CDC01/master');
    const rows = await screen.findAllByTestId('handling-row');
    expect(rows).toHaveLength(4);
    await userEvent.click(screen.getByTestId('handling-toggle-SKU-1001'));
    expect(await screen.findByText('SKU-1001 취급을 껐어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/sku-handlings'))!;
    expect(post.headers.get('X-Expected-Version')).toBe('2');
    expect(await post.json()).toEqual({ sku: 'SKU-1001', enabled: false });
    await waitFor(() => expect(screen.getByTestId('handling-toggle-SKU-1001')).toHaveTextContent('켜기'));
  });

  it('바꾼 사람은 운영자 ID 가 아니라 이름 · 사번(ADR-0070, 2026-11-26)', async () => {
    renderAt('/c/CDC01/master');
    const rows = await screen.findAllByTestId('handling-row');
    expect(await within(rows[0]!).findByText('칠관리')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText('OP-cdc-sup')).not.toBeInTheDocument();
    expect(within(rows[0]!).getByTestId('operator-label')).toHaveAttribute('title', 'OP-cdc-sup');
  });

  it('SKU 줄을 누르면 아래에 상품 정보(이름·보관 온도·단위) — 켜기/끄기 단추는 펼치지 않는다(2026-11-26)', async () => {
    renderAt('/c/CDC01/master');
    const rows = await screen.findAllByTestId('handling-row');
    await userEvent.click(within(rows[0]!).getByText('SKU-1001'));
    const info = await screen.findByTestId('sku-info');
    expect(await within(info).findByText('냉동 만두 1kg')).toBeInTheDocument();
    expect(info).toHaveTextContent('냉동');
    expect(info).toHaveTextContent('박스당 12개');
    await userEvent.click(within(rows[0]!).getByText('SKU-1001'));
    expect(screen.queryByTestId('sku-info')).not.toBeInTheDocument();
  });

  it('판매 중지 상품을 켜면 서버 거절(SKU_INACTIVE)을 보인다', async () => {
    renderAt('/c/CDC01/master?tab=handling');
    await screen.findAllByTestId('handling-row');
    await userEvent.click(screen.getByTestId('handling-toggle-SKU-9001'));
    expect(await screen.findByText('판매 중지(비활성) 상품은 취급을 켤 수 없어요.')).toBeInTheDocument();
  });
});

describe('로케이션', () => {
  it('목록 거르기는 서버로, 점유를 모르면 "모름"(0 아님)', async () => {
    const view = renderAt('/c/CDC01/master?tab=locations');
    const rows = await screen.findAllByTestId('loc-row');
    expect(rows).toHaveLength(5);
    expect(within(rows[1]!).getAllByText('모름')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByTestId('loc-zone'), 'FROZEN');
    await waitFor(() => expect(screen.getAllByTestId('loc-row')).toHaveLength(2));
    expect(view.gets('/cdcs/CDC01/locations').some((r) => new URL(r.url).searchParams.get('temperatureZone') === 'FROZEN')).toBe(true);
  });

  it('상태 바꾸기: 사유 없으면 안 보내고, 보내면 다시 읽은 상태로 "바뀌었어요"', async () => {
    const view = renderAt('/c/CDC01/master/locations/CDC01-B-6-67-01-1-1');
    expect(await screen.findByRole('heading', { name: 'CDC01-B-6-67-01-1-1' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('loc-send'));
    expect(screen.getByText('사유를 적어 주세요.')).toBeInTheDocument();
    expect(view.sent.some((r) => r.method === 'POST')).toBe(false);
    await userEvent.type(screen.getByTestId('loc-reason'), '다시 씀');
    await userEvent.click(screen.getByTestId('loc-send'));
    expect(await screen.findByText('바뀌었어요.')).toBeInTheDocument();
    expect(screen.getAllByText('사용 중').length).toBeGreaterThan(0);
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    expect(await post.json()).toEqual({ action: 'UNBLOCK', reason: '다시 씀' });
  });

  it('폐기는 승인 번호 칸이 나오고, 없으면 서버 거절', async () => {
    renderAt('/c/CDC01/master/locations/CDC01-C-5-02-24-3-1');
    await screen.findByRole('heading', { name: 'CDC01-C-5-02-24-3-1' });
    await userEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(screen.getByTestId('loc-approval')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('loc-reason'), '잘못 등록');
    await userEvent.click(screen.getByTestId('loc-send'));
    expect(await screen.findByText('폐기는 승인 번호가 필요해요.')).toBeInTheDocument();
  });
});

describe('통로 피킹 방식', () => {
  it('설정된 통로만', async () => {
    renderAt('/c/CDC01/master?tab=aisles');
    const rows = await screen.findAllByTestId('aisle-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('DPS(냉동)')).toBeInTheDocument();
  });
});
