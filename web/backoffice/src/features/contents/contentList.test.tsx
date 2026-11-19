// 콘텐츠 조회·상품 사진(2026-11-19)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const rowOf = (name: string) => screen.getAllByTestId('product-row').find((r) => r.textContent?.includes(name))!;

// 2026-11-19 상품 묶음 합치기 1단계 — 콘텐츠 조회 화면은 상품 목록의 "콘텐츠" 열·거르기와 상세 "고객 화면" 탭으로
describe('상품 목록 — 콘텐츠 게시 상태', () => {
  it('줄마다 콘텐츠 게시됨/미게시(게시 카드 서버 값), "미게시만"으로 거른다', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.md);
    await waitFor(() => expect(within(rowOf('사과 1.5kg')).getByTestId('product-content-state')).toHaveTextContent('게시됨'));
    expect(within(rowOf('소고기 미역국')).getByTestId('product-content-state')).toHaveTextContent('미게시');
    await user.selectOptions(screen.getByRole('combobox', { name: '콘텐츠' }), 'missing');
    await waitFor(() => expect(screen.getAllByTestId('product-row')).toHaveLength(1));
    expect(screen.getByTestId('product-row')).toHaveTextContent('소고기 미역국');
  });

  it('옛 주소 /contents?view=missing 은 상품 목록 미게시 거르기로', async () => {
    renderAt('/contents?view=missing', as.md);
    await waitFor(() => expect(screen.getAllByTestId('product-row')).toHaveLength(1));
    expect(screen.getByRole('combobox', { name: '콘텐츠' })).toHaveValue('missing');
  });
});

describe('상품 상세 탭', () => {
  it('고객 화면 탭 — 게시된 콘텐츠(사진·설명·고시)와 수정 단추', async () => {
    const user = userEvent.setup();
    renderAt('/products/P-00000001', as.md);
    await user.click(await screen.findByRole('tab', { name: '고객 화면' }));
    const text = await screen.findByTestId('content-text');
    expect(text).toHaveTextContent('아삭한 부사 사과');
    expect(text).toHaveTextContent('원산지: 국산');
    expect(screen.getByTestId('tab-content-edit')).toHaveAttribute('href', '/contents/drafts/new?productId=P-00000001');
  });

  it('가격 탭 — SKU 마다 지금 기본가(서버 값)', async () => {
    renderAt('/products/P-00000001?tab=price', as.md);
    expect(await screen.findByTestId('base-price')).toHaveTextContent('4,500원');
  });

  it('옛 주소 /contents?preview=<상품> 은 그 상품의 고객 화면 탭으로', async () => {
    renderAt('/contents?preview=P-00000001', as.md);
    expect(await screen.findByTestId('content-text')).toHaveTextContent('아삭한 부사 사과');
  });
});

describe('상품 상세 사진', () => {
  it('게시된 상품은 사진, 미게시는 오류가 아니라 등록 안내', async () => {
    renderAt('/products/P-00000001', as.md);
    expect(await screen.findByTestId('content-gallery')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('content-gallery').querySelector('img')).not.toBeNull());
  });

  it('미게시 상품', async () => {
    renderAt('/products/P-00000002', as.md);
    expect(await screen.findByTestId('content-not-published')).toHaveTextContent('게시된 콘텐츠가 없어');
  });
});

describe('상품 상세 — 시스템 ID 대신(ADR-0070 덧붙임)', () => {
  it('제목은 이름만, 카테고리는 경로, 승인은 "승인 보기" — ID 는 "시스템 번호" 접기 안에만', async () => {
    renderAt('/products/P-00000001', as.md);
    expect(await screen.findByRole('heading', { level: 1, name: '사과 1.5kg' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('primary-category')).toHaveTextContent('과일·채소 > 과일 > 사과·배'));
    expect(screen.getAllByTestId('exposed-category')[0]).toHaveTextContent('과일·채소 > 과일 > 사과·배');
    expect(screen.getByTestId('product-approval')).toHaveTextContent('승인 보기');
    const outside = document.querySelector('section')!.cloneNode(true) as HTMLElement;
    outside.querySelector('[data-testid="system-numbers"]')?.remove();
    expect(outside.textContent).not.toMatch(/P-00000001|p01-c01-l01|apv-seed-1/);
    expect(screen.getByTestId('system-numbers')).toHaveTextContent('P-00000001');
  });
});
