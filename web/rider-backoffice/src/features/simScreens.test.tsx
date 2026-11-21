// 라이더 시뮬레이터 모양 2단계(2026-11-21) — 찾기 칸 + 깔때기 팝업, 줄 아래 펼침, ⓘ 접기, 숫자 칸 거르기. 목(MSW) 기준 — 브라우저 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('검색 — 찾기 칸 + 깔때기 팝업', () => {
  it('라이더 찾기: 번호·전화 칸은 늘 보이고, 상태 거르기는 팝업 안. 고르면 칩이 생기고 ✕ 로 푼다', async () => {
    const view = renderAt('/riders', as.riderOps);
    await screen.findAllByTestId('rider-row');
    expect(screen.getByLabelText('라이더 번호(6자리)')).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: '계정 제한' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '거르기 조건 열기' }));
    const pop = screen.getByTestId('search-popup');
    // 거르기 네 묶음이 모두 팝업에 있다(정보 손실 없음)
    for (const g of ['가입 상태', '계정 제한', '운행', '수단']) expect(within(pop).getByRole('radiogroup', { name: g })).toBeInTheDocument();
    await userEvent.click(within(pop).getByRole('radio', { name: '일시 중지' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /거르기 조건 열기 \(1개 걸림\)/ })).toBeInTheDocument());
    // 바깥(뒤판)을 누르면 닫힌다
    await userEvent.click(document.querySelector('.pm-pop-back')!);
    expect(screen.queryByTestId('search-popup')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-chip')).toHaveTextContent('일시 중지');
    await userEvent.click(screen.getByRole('button', { name: '계정 제한 조건 풀기' }));
    await waitFor(() => expect(screen.queryByTestId('search-chip')).not.toBeInTheDocument());
    const last = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/riders')).at(-1)!;
    expect(new URL(last.url).searchParams.get('restriction')).toBeNull();
  });

  it('주소의 거르기가 정본 — 주소로 열면 칩과 팝업 선택이 그 값', async () => {
    renderAt('/riders?vehicleType=BICYCLE', as.riderOps);
    expect(await screen.findByTestId('search-chip')).toHaveTextContent('자전거');
    await userEvent.click(screen.getByTestId('search-toggle'));
    expect(within(screen.getByRole('radiogroup', { name: '수단' })).getByRole('radio', { name: '자전거' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('목록 줄 — 누르면 바로 아래에 펼친 상세', () => {
  it('배송 찾기: 줄을 누르면 화면을 옮기지 않고 아래에 수행·배차, 다시 누르면 접힌다', async () => {
    renderAt('/deliveries', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    const row = rows.find((r) => r.textContent?.includes('48213075-1'))!;
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(row).getByText('전달 실패 등록'));
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const inline = await screen.findByTestId('delivery-inline');
    expect(await within(inline).findByTestId('delivery-inline-execution')).toHaveTextContent('전달 실패 등록');
    expect(await within(inline).findByTestId('delivery-inline-dispatch')).toBeInTheDocument();
    expect(within(inline).getByRole('link', { name: '전체 상세 ›' })).toHaveAttribute('href', '/deliveries/DLV-1');
    // 제목(목록 화면) 그대로
    expect(screen.getByRole('heading', { name: '배송 찾기' })).toBeInTheDocument();
    await userEvent.click(within(row).getByText('전달 실패 등록'));
    expect(screen.queryByTestId('delivery-inline')).not.toBeInTheDocument();
  });

  it('라이더 찾기: Enter 로도 펼치고, 한 번에 한 줄만', async () => {
    renderAt('/riders', as.riderOps);
    const rows = await screen.findAllByTestId('rider-row');
    rows[0]!.focus();
    await userEvent.keyboard('{Enter}');
    const inline = await screen.findByTestId('rider-inline');
    expect(await within(inline).findByTestId('rider-inline-info')).toBeInTheDocument();
    await userEvent.click(rows[1]!.querySelector('td:last-child')!);
    await waitFor(() => expect(screen.getAllByTestId('rider-inline')).toHaveLength(1));
    expect(rows[0]).toHaveAttribute('aria-expanded', 'false');
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('번호 링크는 그대로 상세 화면으로', async () => {
    renderAt('/riders', as.riderOps);
    const rows = await screen.findAllByTestId('rider-row');
    const link = within(rows[0]!).getAllByRole('link')[0]!;
    expect(link.getAttribute('href')).toMatch(/^\/riders\//);
  });
});

describe('화면 설명 ⓘ', () => {
  it('제목 아래 긴 설명은 처음엔 접혀 있고 ⓘ 로 연다(문장은 그대로)', async () => {
    renderAt('/deliveries', as.riderOps);
    const info = await screen.findByTestId('page-info');
    expect(info).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(info);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(info.closest('header')!.querySelector('.pm-info-text')).not.toBeNull();
  });
});

describe('머리 줄 역할', () => {
  it('역할은 작은 글자 한 줄로 그대로 보인다', async () => {
    renderAt('/riders', as.riderOps);
    expect(await screen.findByTestId('header-roles')).toHaveTextContent('RIDER_OPS');
  });
});
