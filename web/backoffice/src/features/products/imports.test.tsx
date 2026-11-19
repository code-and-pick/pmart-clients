// 일괄 등록(파일 한 번 올리기)·상품 메뉴 5개(2026-11-19 상품 묶음 합치기 — 메뉴 정리)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { messages } from '../../shared/messages';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const zip = () => new File(['PK'], 'seed-v1.zip', { type: 'application/zip' });

// 가격 목은 Node 시험 환경에서 업로드 본문(formData)을 읽다가 끊긴다(브라우저 목 모드에서는 정상 — 2026-11-19 화면 확인).
// 이 화면 시험은 가격 응답을 계약 모양(PriceImportBatch)으로 정해 둔다 — 새 상품 1줄은 SKU_NOT_FOUND.
const priceLine = (seedProductId: string, status: 'READY' | 'SKU_NOT_FOUND') => ({ seedProductId, status, edited: false, excluded: false, sku: status === 'READY' ? 'E-00000001' : null, basePrice: 4500 });
const usePriceBatch = () =>
  server.use(
    http.post(`${API_BASE}/price-import-batches`, () =>
      HttpResponse.json({ batchId: 'PB-T1', format: 'SEED_V1', state: 'DRAFT', version: 0, lineCount: 2, submittableCount: 1, lines: [priceLine('seed-1', 'READY'), priceLine('seed-2', 'SKU_NOT_FOUND')] }, { status: 201 }),
    ),
  );

describe('일괄 등록 — 파일 한 번 올리기', () => {
  it('한 파일을 상품·콘텐츠·가격에 따로 보내고 결과 카드 셋(배치 열기). 가격의 SKU 없음은 "승인 뒤 다시 대조" 안내', async () => {
    const user = userEvent.setup();
    usePriceBatch();
    const view = renderAt('/imports', as.md);
    await user.upload(await screen.findByLabelText('seed-v1.zip'), zip());
    await user.click(screen.getByRole('button', { name: '업로드·검증' }));
    for (const p of ['product', 'content', 'price']) expect(await screen.findByTestId(`imports-open-${p}`)).toBeInTheDocument();
    expect(screen.getByTestId('imports-open-content').getAttribute('href')).toMatch(/^\/contents\/import\//);
    expect(screen.getByTestId('imports-price-nosku')).toHaveTextContent('상품 승인 뒤');
    // 서비스마다 다른 멱등키
    const keys = ['/product-import-batches', '/content-import-batches', '/price-import-batches'].map((p) => view.mutations(p)[0]?.headers.get('Idempotency-Key'));
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    view.stop();
  });

  it('가격을 빼면 상품·콘텐츠만 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/imports', as.md);
    await user.click(await screen.findByRole('checkbox', { name: /가격/ }));
    await user.upload(screen.getByLabelText('seed-v1.zip'), zip());
    await user.click(screen.getByRole('button', { name: '업로드·검증' }));
    expect(await screen.findByTestId('imports-open-content')).toBeInTheDocument();
    expect(screen.queryByTestId('imports-result-price')).toBeNull();
    expect(view.mutations('/price-import-batches')).toHaveLength(0);
    view.stop();
  });

  it('하나가 거절되면 그 카드에만 실패와 "이것만 다시 보내기" — 나머지 결과는 그대로', async () => {
    const user = userEvent.setup();
    usePriceBatch();
    server.use(
      http.post(`${API_BASE}/content-import-batches`, () =>
        HttpResponse.json({ type: 'about:blank', title: 'VALIDATION_FAILED', status: 400, code: 'VALIDATION_FAILED', traceId: 't' }, { status: 400, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/imports', as.md);
    await user.upload(await screen.findByLabelText('seed-v1.zip'), zip());
    await user.click(screen.getByRole('button', { name: '업로드·검증' }));
    expect(await screen.findByTestId('imports-retry-content')).toBeInTheDocument();
    expect(await screen.findByTestId('imports-open-product')).toBeInTheDocument();
    expect(screen.getByTestId('imports-open-price')).toBeInTheDocument();
  });
});

describe('일괄 등록 메뉴', () => {
  it('상품 관리 메뉴는 5개, 옛 주소 /prices/import 에서도 "일괄 등록"이 켜진다', async () => {
    renderAt('/prices/import', as.md);
    const nav = await screen.findByRole('navigation');
    await waitFor(() => expect(within(nav).getByRole('link', { name: '일괄 등록' })).toHaveAttribute('data-active', 'alias'));
    for (const gone of ['콘텐츠 등록', '콘텐츠 일괄 등록', '가격 일괄 등록', '상품 일괄 등록']) expect(within(nav).queryByRole('link', { name: gone })).toBeNull();
  });
});

// 2026-11-19 사용자 "상품 등록할 때 사진 등록하던 게 없어졌다" — 메뉴 정리 뒤에도 상품 등록에서 사진 등록으로
describe('상품 등록 — 사진·설명 입구', () => {
  it('등록 방식 고르기에 "사진·설명 등록" 카드 → 콘텐츠 등록 화면', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    expect(await screen.findByTestId('draft-after')).toHaveTextContent('사진·설명 → 가격');
    await user.click(await screen.findByTestId('start-photo'));
    expect(await screen.findByRole('heading', { name: messages.contents.draftTitle })).toBeInTheDocument();
  });
});
