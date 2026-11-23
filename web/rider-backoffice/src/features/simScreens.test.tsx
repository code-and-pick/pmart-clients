// 라이더 시뮬레이터 모양 2단계(2026-11-21) — 찾기 칸 + 깔때기 팝업, 줄 아래 펼침, ⓘ 접기, 숫자 칸 거르기. 목(MSW) 기준 — 브라우저 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('검색 — 찾기 칸 + 깔때기 팝업', () => {
  it('라이더 찾기: 번호·전화 칸은 늘 보이고, 상태 거르기는 팝업 안. 고르면 칩이 생기고 ✕ 로 푼다', async () => {
    const view = renderAt('/riders', as.riderOps);
    await screen.findAllByTestId('rider-row');
    expect(screen.getByLabelText('라이더 번호')).toBeVisible();
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
    const row = rows.find((r) => r.textContent?.includes('D48213075'))!;
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(row).getByText('전달 실패 등록'));
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const inline = await screen.findByTestId('delivery-inline');
    expect(await within(inline).findByTestId('delivery-inline-execution')).toHaveTextContent('전달 실패 등록');
    expect(await within(inline).findByTestId('delivery-inline-dispatch')).toBeInTheDocument();
    expect(within(inline).getByRole('link', { name: '전체 상세 ›' })).toHaveAttribute('href', '/deliveries/DLV-1');
    // 제목(목록 화면) 그대로
    expect(screen.getByRole('heading', { name: '배송 관리' })).toBeInTheDocument();
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
  it('역할은 작은 글자 한 줄로 — 한글 이름(2026-11-23 공용 RoleText)', async () => {
    renderAt('/riders', as.riderOps);
    expect(await screen.findByTestId('header-roles')).toHaveTextContent('라이더 운영');
  });
});

describe('상세 — 보기 구역·처리 구역(2026-11-21)', () => {
  it('라이더 상세: 맨 위 요약 띠, 처리 구역(계정 제한 바꾸기·제한 검토 결정하기·원문 보기)은 한곳에', async () => {
    renderAt('/riders/RD-7', as.riderOps);
    const sum = await screen.findByTestId('rider-summary');
    expect(sum).toHaveTextContent('운행');
    expect(sum).toHaveTextContent('진행 중 배정');
    await waitFor(() => expect(sum).toHaveTextContent('이번 주 운행1시간 30분'));
    const acts = screen.getByRole('complementary', { name: '처리' });
    for (const h of ['계정 제한 바꾸기', '제한 검토 결정하기', '이름·전화 원문 보기']) expect(within(acts).getByRole('heading', { name: h })).toBeInTheDocument();
    expect(within(acts).getByRole('form', { name: '계정 제한 걸기·풀기' })).toBeInTheDocument();
    // 보기 구역 머리에 한 줄 요약, 개발 말(delivery-dispatch)은 ⓘ 안
    const asg = screen.getByRole('heading', { name: '배정 이력' }).closest('section')!;
    expect(asg).not.toHaveTextContent('delivery-dispatch');
    await waitFor(() => expect(asg).toHaveTextContent(/3건 · 진행 중 1/));
    await userEvent.click(within(asg).getByRole('button', { name: '화면 설명 보기' }));
    expect(asg).toHaveTextContent('delivery-dispatch');
  });

  it('비어 있는 처리·보기 구역은 한 줄(열린 검토 없음)', async () => {
    renderAt('/riders/RD-7', as.riderOps);
    const reviews = (await screen.findByRole('heading', { name: '제한 검토 결정하기' })).closest('section')!;
    expect(await within(reviews).findByText('열린 검토가 없어요.')).toBeInTheDocument();
    expect(within(reviews).queryByTestId('rider-reviews')).not.toBeInTheDocument();
  });

  it('수행료 조정: 걸린 금액을 크게, 고른 귀책에 따라 결과 미리보기(표시만)', async () => {
    renderAt('/adjustments', as.riderOps);
    const row = await screen.findByTestId('adjustment-row');
    expect(within(row).getByTestId('adjust-fee')).toBeInTheDocument();
    const preview = within(row).getByTestId('adjust-preview');
    expect(preview).toHaveTextContent('귀책을 고르면');
    await userEvent.selectOptions(within(row).getByLabelText('귀책'), 'RIDER');
    expect(preview).toHaveTextContent('라이더 귀책 → 미지급');
    await userEvent.selectOptions(within(row).getByLabelText('귀책'), 'STORE');
    expect(preview).toHaveTextContent('센터(MFC) 귀책 → ');
    expect(preview).toHaveTextContent('확정');
  });
});

describe('찾기 줄 — 지우기 단추 없음, 구분은 붙은 단추 줄(2026-11-21)', () => {
  it('상담함: "지우기" 단추가 없고, 구분 고르기는 늘 보이며, 걸면 끝에 "모두 지우기"', async () => {
    renderAt('/consults', as.riderOps);
    const bar = await screen.findByTestId('consults-search');
    expect(within(bar).queryByRole('button', { name: '지우기' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: '모두 지우기' })).not.toBeInTheDocument();
    const kinds = within(bar).getByRole('radiogroup', { name: '구분' });
    await userEvent.click(within(kinds).getByRole('radio', { name: '일반 문의' }));
    expect(within(kinds).getByRole('radio', { name: '일반 문의' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(bar).getByRole('button', { name: '모두 지우기' }));
    expect(within(kinds).getByRole('radio', { name: '전체' })).toHaveAttribute('aria-checked', 'true');
  });
});
