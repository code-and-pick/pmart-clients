import { pick } from '../../test/pick';
import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ProductDraftInput } from '../../api/models';
import { renderAt } from '../../test/render';

const jsonFile = (obj: unknown) => new File([JSON.stringify(obj)], 'product.json', { type: 'application/json' });
const upload = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } });

describe('상품 등록 폼', () => {
  it('카테고리는 트리 드롭다운에서 대표 1개·노출 여러 개를 고르고, 대표 카테고리의 필터 옵션을 고르면 함께 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/drafts/new');

    // 대표 카테고리는 쳐서 찾는 고르기(2026-11-19) — 경로로 좁혀 고른다
    await waitFor(() => expect(screen.getByRole('combobox', { name: '대표 카테고리' })).toBeEnabled());
    await pick(user, '대표 카테고리', '과일·채소 > 과일', '채소 > 과일');
    // 대표 카테고리 필터(목: 원산지 국산/수입)
    await user.click(await screen.findByLabelText('원산지: 국산'));
    await user.click(screen.getByRole('button', { name: '노출 카테고리' }));
    await user.click(screen.getByRole('checkbox', { name: '과일·채소 > 과일 > 사과·배' }));
    await user.click(screen.getByRole('checkbox', { name: '국·탕·찌개 > 국·국밥' }));
    // 대표 카테고리는 노출 목록에 자동으로 들어가 맨 앞에 "대표"로 보이고 뺄 수 없다.
    const chosen = within(screen.getByRole('list', { name: '고른 노출 카테고리' })).getAllByRole('listitem');
    expect(chosen).toHaveLength(3);
    expect(chosen[0]).toHaveTextContent('과일·채소 > 과일 · 대표');
    expect(within(chosen[0]!).queryByRole('button')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '과일·채소 > 과일 (대표)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '노출 카테고리' })).toHaveTextContent('노출 카테고리 2개 선택');
    await user.click(screen.getByRole('button', { name: '국·탕·찌개 > 국·국밥 빼기' }));

    await user.type(screen.getByLabelText('관리용 명칭'), '사과');
    await user.type(screen.getByLabelText('중량(g)'), '1000');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('상품 초안');

    const body = (await view.mutations('/product-drafts')[0]!.json()) as ProductDraftInput;
    expect(body.product.primaryCategoryId).toBe('p01-c01');
    expect(body.product.categoryIds).toEqual(['p01-c01-l01']);
    expect(body.product.categoryPaths).toBeUndefined();
    expect(body.filterOptions).toEqual([{ filterGroupId: 'origin', option: '국산' }]);
    view.stop();
  });

  it('SKU 를 여러 개 넣을 수 있고, 물류 규격은 적은 것만 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/drafts/new');
    await user.type(screen.getByLabelText('관리용 명칭'), '우유');
    await pick(user, '대표 카테고리', /^과일·채소$/); // 쳐서 찾는 고르기(2026-11-19)

    await user.click(screen.getByRole('button', { name: 'SKU 추가' }));
    const sku1 = within(screen.getByRole('region', { name: 'SKU 1' }));
    const sku2 = within(screen.getByRole('region', { name: 'SKU 2' }));
    await user.type(sku1.getByLabelText('중량(g)'), '1000');
    await user.type(sku1.getByLabelText('박스 입수'), '12');
    await user.selectOptions(sku2.getByLabelText('판매 단위'), 'B');
    await user.clear(sku2.getByLabelText('구성 낱개 수'));
    await user.type(sku2.getByLabelText('구성 낱개 수'), '4');
    await user.type(sku2.getByLabelText('중량(g)'), '4000');
    await user.type(sku2.getByLabelText('바코드(쉼표 구분, 앞자리 0 유지)'), '08800001, 08800002');
    // 세 번째는 넣었다가 지운다
    await user.click(screen.getByRole('button', { name: 'SKU 추가' }));
    await user.click(screen.getByRole('button', { name: 'SKU 3 삭제' }));
    expect(screen.queryByRole('region', { name: 'SKU 3' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('상품 초안');

    const body = (await view.mutations('/product-drafts')[0]!.json()) as ProductDraftInput;
    expect(body.skus).toEqual([
      { unitType: 'E', unitsPerSku: 1, weightG: 1000, alcohol: false, logistics: { unitsPerBox: 12 } },
      { unitType: 'B', unitsPerSku: 4, weightG: 4000, alcohol: false, barcodes: ['08800001', '08800002'] },
    ]);
    view.stop();
  });

  it('seed-v1 product.json 으로 채운다: 이름 경로는 트리에서 찾아 ID 로, 못 찾은 경로는 서버 매핑으로 남기고, 전체 지우기로 비운다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/drafts/new');
    await waitFor(() => expect(screen.getByRole('combobox', { name: '대표 카테고리' })).toBeEnabled()); // 카테고리 트리를 다 받은 뒤

    upload(
      screen.getByLabelText('상품 JSON 파일로 채우기'),
      jsonFile({
        product: {
          seedProductId: 'bm-1',
          internalName: '부사 사과 1kg',
          primaryCategory: ['과일·채소', '과일', '사과·배'],
          categories: [['과일·채소', '과일', '사과·배'], ['국·탕·찌개', '국·국밥'], ['과일·채소', '열대과일']],
          saleState: 'ON_SALE',
        },
        skus: [{ sku: null, unitType: 'E', unitsPerSku: 1, weightG: 1000, storageType: 'CHILLED', alcohol: null, barcodes: ['0880000000012'] }],
      }),
    );

    expect(await screen.findByText(/채웠어요: SKU 1개, 카테고리 2개 매핑, 이름 경로 1개는 서버 매핑/)).toBeInTheDocument();
    expect(screen.getByLabelText('관리용 명칭')).toHaveValue('부사 사과 1kg');
    expect(screen.getByRole('combobox', { name: '대표 카테고리' })).toHaveValue('과일·채소 > 과일 > 사과·배'); // 칸에는 경로 이름(보내는 값은 아래 p01-c01-l01)
    expect(screen.getByLabelText('중량(g)')).toHaveValue('1000');
    expect(screen.getByLabelText('보관 방식')).toHaveValue('CHILLED');
    expect(screen.getByLabelText('바코드(쉼표 구분, 앞자리 0 유지)')).toHaveValue('0880000000012');
    expect(screen.getByText(/과일·채소 > 열대과일/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('상품 초안');
    const body = (await view.mutations('/product-drafts')[0]!.json()) as ProductDraftInput;
    expect(body.product.primaryCategoryId).toBe('p01-c01-l01');
    expect(body.product.categoryIds).toEqual(['p03-c01']);
    // ID 를 정했으므로 이름 경로는 보내지 않는다(둘 다 보내면 서버가 어느 쪽을 믿을지 모호).
    expect(body.product.categoryPaths).toBeUndefined();
    view.stop();
  });

  it('전체 지우기는 상품명·카테고리·SKU 를 모두 비운다', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new');
    await user.type(screen.getByLabelText('관리용 명칭'), '사과');
    await pick(user, '대표 카테고리', /^과일·채소$/); // 쳐서 찾는 고르기(2026-11-19)
    await user.type(screen.getByLabelText('중량(g)'), '1000');
    await user.click(screen.getByRole('button', { name: 'SKU 추가' }));

    await user.click(screen.getByRole('button', { name: /전체 지우기/ }));

    expect(screen.getByLabelText('관리용 명칭')).toHaveValue('');
    expect(screen.getByLabelText('대표 카테고리')).toHaveValue('');
    expect(screen.getByLabelText('중량(g)')).toHaveValue('');
    expect(screen.queryByRole('region', { name: 'SKU 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초안 저장' })).toBeDisabled();
  });
});
