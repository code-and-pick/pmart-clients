// 같은 기초상품으로 하나 더 만들기(2026-11-18 사용자 결정 — 옵션 조합 SKU 생성기 대신)
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import type { ProductDraftInput } from '../../api/models';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

describe('같은 기초상품으로 하나 더', () => {
  it('상품 상세 → 공통 칸만 채운 새 초안, 판매 단위 실물 값은 비움 → 저장 본문에 기초상품 ID', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/P-00000001', as.md);
    await user.click(await screen.findByRole('link', { name: '같은 기초상품으로 하나 더' }));

    expect(await screen.findByTestId('same-base-id')).toHaveTextContent('같은 기초상품의 다른 판매 단위로 붙어요'); // 기초상품 ID 는 보이지 않는다(ADR-0070)
    const name = screen.getByLabelText('관리용 명칭');
    expect(name).toHaveValue('사과 1.5kg');
    // 판매 단위마다 다른 실물 값 — 원래 상품(300g·바코드)을 복사하지 않는다
    expect(screen.getByLabelText('중량(g)')).toHaveValue('');
    expect(screen.getByLabelText('보관 방식')).toHaveValue('CHILLED');

    await user.clear(name);
    await user.type(name, '사과 1.5kg 2봉');
    await user.selectOptions(screen.getByLabelText('판매 단위'), 'B');
    await user.clear(screen.getByLabelText('구성 낱개 수'));
    await user.type(screen.getByLabelText('구성 낱개 수'), '2');
    await user.type(screen.getByLabelText('중량(g)'), '3000');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    // 저장 뒤 초안 화면에도 어느 기초상품에 붙는지 보인다
    expect(await screen.findByTestId('draft-base-product')).toHaveTextContent('같은 기초상품의 다른 판매 단위로 붙어요'); // 기초상품 ID 는 보이지 않는다(ADR-0070)
    const sent = view.mutations('/product-drafts');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    const body = (await sent[0]!.clone().json()) as ProductDraftInput;
    expect(body.product).toMatchObject({ baseProductId: 'BP-P-00000001', internalName: '사과 1.5kg 2봉', primaryCategoryId: 'p01-c01-l01' });
    expect(body.skus).toHaveLength(1);
    expect(body.skus[0]).toMatchObject({ unitType: 'B', unitsPerSku: 2, weightG: 3000, storageType: 'CHILLED', alcohol: false });
    expect(body.skus[0]!.barcodes).toBeUndefined();
  });

  it('원래 상품을 못 읽으면 빈 폼을 열지 않는다(기초상품 연결이 빠진 새 상품 방지)', { timeout: 15000 }, async () => {
    server.use(http.get(`${API_BASE}/products/:productId`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'SERVICE_UNAVAILABLE', retryable: true }, { status: 503 })));
    renderAt('/products/drafts/new?sameBaseAs=P-00000001', as.md);
    // 다시 읽을 수 있는 실패(503 retryable) — 자동 재시도가 끝난 뒤 다시 시도 버튼
    await screen.findByRole('button', { name: '다시 시도' }, { timeout: 8000 });
    expect(screen.queryByLabelText('관리용 명칭')).not.toBeInTheDocument();
  });
});
