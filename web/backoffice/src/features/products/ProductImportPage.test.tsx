import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ImportBatch, ProductDraft } from '../../api/models';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';

describe('상품 일괄 등록', () => {
  it('INVALID 초안의 중량·보관 방식을 배치 화면에서 채워 저장하면 다시 검증돼 VALID 가 된다', async () => {
    const draft: ProductDraft = {
      draftId: 'pd-seed-invalid',
      batchId: 'pib-seed-2',
      sourceSystem: 'bmart-capture',
      sourceKey: 'bm-1',
      state: 'DRAFT',
      input: { product: { internalName: '부사 사과 1kg', primaryCategoryId: 'p01-c01-l01' }, skus: [{ unitType: 'E', unitsPerSku: 1, volumeMl: 1000 }] },
      validationState: 'INVALID',
      problems: [
        { code: 'WEIGHT_REQUIRED', field: 'skus[0].weightG' },
        { code: 'STORAGE_TYPE_REQUIRED', field: 'skus[0].storageType' },
      ],
      draftHash: null,
      approvalId: null,
      resultProductId: null,
      resultSkus: [],
      version: 0,
      updatedAt: '2026-11-02T00:00:00Z',
    };
    db.productDrafts.set(draft.draftId, draft);
    const batch: ImportBatch = {
      batchId: 'pib-seed-2',
      format: 'SEED_V1',
      sourceSystem: 'bmart-capture',
      state: 'VALIDATED',
      productCount: 1,
      validCount: 0,
      invalidCount: 1,
      drafts: [draft],
      createdAt: '2026-11-02T00:00:00Z',
    };
    db.importBatches.set(batch.batchId, batch);
    const user = userEvent.setup();
    const view = renderAt('/products/import/pib-seed-2');

    const fill = await screen.findByLabelText('빠진 값 채우기 부사 사과 1kg');
    expect(within(fill).getByText('용량 1000mL')).toBeInTheDocument();
    // 값을 미리 채우지 않는다
    expect(within(fill).getByLabelText('중량(g)')).toHaveValue('');
    await user.type(within(fill).getByLabelText('중량(g)'), '1000');
    await user.selectOptions(within(fill).getByLabelText('보관 방식'), 'CHILLED');
    await user.click(within(fill).getByRole('button', { name: '저장·재검증' }));

    await waitFor(() => expect(screen.getByText('VALID')).toBeInTheDocument());
    expect(screen.queryByLabelText('빠진 값 채우기 부사 사과 1kg')).not.toBeInTheDocument();
    const put = view.mutations('/product-drafts/pd-seed-invalid')[0]!;
    expect(put.method).toBe('PUT');
    expect(put.headers.get('X-Expected-Version')).toBe('0');
    const body = (await put.json()) as { skus: { weightG?: number; storageType?: string; volumeMl?: number }[] };
    expect(body.skus[0]).toMatchObject({ weightG: 1000, storageType: 'CHILLED', volumeMl: 1000 });
    view.stop();
  });

  it('업로드·검증 뒤 배치 화면에서 바로 다른 파일을 올릴 수 있다(다른 메뉴로 갔다 올 필요 없음)', async () => {
    const batch: ImportBatch = {
      batchId: 'pib-seed-1',
      format: 'SEED_V1',
      sourceSystem: 'bmart-capture',
      state: 'VALIDATED',
      productCount: 0,
      validCount: 0,
      invalidCount: 0,
      drafts: [],
      createdAt: '2026-11-02T00:00:00Z',
    };
    db.importBatches.set(batch.batchId, batch);
    renderAt('/products/import/pib-seed-1');

    expect(await screen.findByRole('heading', { name: '배치 pib-seed-1' })).toBeInTheDocument();
    const another = screen.getByRole('heading', { name: '다른 파일 올리기' }).parentElement!;
    expect(within(another).getByLabelText('seed-v1.zip')).toBeInTheDocument();
    // 파일을 고르기 전에는 올릴 수 없다
    expect(within(another).getByRole('button', { name: '업로드·검증' })).toBeDisabled();
  });

  it('서버의 validCount 가 업로드 때 값(0)이어도 VALID 행이 있으면 유효 수를 행에서 세어 보이고 제출 버튼을 연다(BR-38)', async () => {
    const base: Omit<ProductDraft, 'draftId' | 'sourceKey' | 'state' | 'validationState' | 'problems'> = {
      batchId: 'pib-seed-3',
      sourceSystem: 'bmart-capture',
      input: { product: { internalName: '부사 사과 1kg', primaryCategoryId: 'p01-c01-l01' }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 1000, storageType: 'CHILLED' }] },
      draftHash: null,
      approvalId: null,
      resultProductId: null,
      resultSkus: [],
      version: 1,
      updatedAt: '2026-11-03T00:00:00Z',
    };
    const fixed: ProductDraft = { ...base, draftId: 'pd-fixed', sourceKey: 'bm-1', state: 'DRAFT', validationState: 'VALID', problems: [] };
    const broken: ProductDraft = {
      ...base,
      draftId: 'pd-broken',
      sourceKey: 'bm-2',
      state: 'DRAFT',
      validationState: 'INVALID',
      problems: [{ code: 'WEIGHT_REQUIRED', field: 'skus[0].weightG' }],
    };
    db.productDrafts.set(fixed.draftId, fixed);
    db.productDrafts.set(broken.draftId, broken);
    const batch: ImportBatch = {
      batchId: 'pib-seed-3',
      format: 'SEED_V1',
      sourceSystem: 'bmart-capture',
      state: 'VALIDATED',
      productCount: 2,
      validCount: 0, // 서버는 업로드 때 수를 그대로 둔다
      invalidCount: 2,
      drafts: [fixed, broken],
      createdAt: '2026-11-03T00:00:00Z',
    };
    db.importBatches.set(batch.batchId, batch);
    renderAt('/products/import/pib-seed-3');

    // 2026-11-18 화면: 상태 배지 + 숫자 카드(전체·유효·오류)
    expect(await screen.findByTestId('batch-valid')).toHaveTextContent('유효1');
    expect(screen.getByTestId('batch-total')).toHaveTextContent('전체 상품2');
    expect(screen.getByTestId('batch-invalid')).toHaveTextContent('오류1');
    expect(screen.getByTestId('batch-state')).toHaveTextContent('검증 끝남');
    expect(screen.getByRole('button', { name: '유효 행 제출 준비' })).toBeEnabled();
    // VALID 행도 제출 전이면 초안 화면에서 다시 고칠 수 있다(행마다 "초안 수정" 링크).
    const links = screen.getAllByRole('link', { name: '초안 수정' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/products/drafts/pd-fixed', '/products/drafts/pd-broken']);
  });

  it('제출 → 승인 요청 뒤 화면을 다시 열어도(승인 상세에 다녀옴) 승인 상세 링크가 남는다', async () => {
    const draft: ProductDraft = {
      draftId: 'pd-ok',
      batchId: 'pib-seed-4',
      sourceSystem: 'bmart-capture',
      sourceKey: 'bm-9',
      state: 'DRAFT',
      input: { product: { internalName: '부사 사과 1kg', primaryCategoryId: 'p01-c01-l01' }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 1000, storageType: 'CHILLED' }] },
      validationState: 'VALID',
      problems: [],
      draftHash: null,
      approvalId: null,
      resultProductId: null,
      resultSkus: [],
      version: 1,
      updatedAt: '2026-11-03T00:00:00Z',
    };
    db.productDrafts.set(draft.draftId, draft);
    const batch: ImportBatch = {
      batchId: 'pib-seed-4',
      format: 'SEED_V1',
      sourceSystem: 'bmart-capture',
      state: 'VALIDATED',
      productCount: 1,
      validCount: 1,
      invalidCount: 0,
      drafts: [draft],
      createdAt: '2026-11-03T00:00:00Z',
    };
    db.importBatches.set(batch.batchId, batch);
    const user = userEvent.setup();
    const first = renderAt('/products/import/pib-seed-4');

    await user.click(await screen.findByRole('button', { name: '유효 행 제출 준비' }));
    // 배치가 SUBMITTED 로 바뀌고 승인 요청 현황 영역에 "승인 요청" 버튼이 보인다.
    await user.click(await screen.findByRole('button', { name: '승인 요청' }));
    expect(await screen.findByText(/승인 요청을 올렸어요\. 승인 번호 /)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '승인 상세 보기' })).toHaveLength(1);
    first.stop();
    first.unmount();

    // 승인 상세에 다녀온 것처럼 다시 연다. 승인 목록(targetRef = productImportBatch:pib-seed-4)에서 찾아 링크를 보인다.
    renderAt('/products/import/pib-seed-4');
    const link = await screen.findByRole('link', { name: '승인 상세 보기' });
    expect(link.getAttribute('href')).toMatch(/^\/approvals\/apv-/);
    expect(screen.queryByRole('button', { name: '승인 요청' })).not.toBeInTheDocument();
    // 승인 목록 조회가 끝나면 심사 상태도 붙는다.
    // 2026-11-18 화면: 승인 번호 옆 심사 상태 배지
    expect(await screen.findByText('심사 대기')).toBeInTheDocument();
  });

  it('재업로드 행은 "기존 상품 갱신"(상품 ID 링크)으로 구분하고 제출 전에 갱신 안내를 보인다(BR-39 회신)', async () => {
    const base = {
      batchId: 'pib-seed-5',
      sourceSystem: 'bmart-capture',
      input: { product: { internalName: '부사 사과 1kg', primaryCategoryId: 'p01-c01-l01' }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 1000, storageType: 'CHILLED' }] },
      state: 'DRAFT',
      validationState: 'VALID',
      problems: [],
      draftHash: null,
      approvalId: null,
      resultProductId: null,
      resultSkus: [],
      version: 1,
      updatedAt: '2026-11-03T00:00:00Z',
    } satisfies Partial<ProductDraft>;
    const update: ProductDraft = { ...base, draftId: 'pd-upd', sourceKey: 'bm-1', registration: 'UPDATE', existingProductId: 'PRD-1', existingSkus: ['E-00000001'] };
    const fresh: ProductDraft = { ...base, draftId: 'pd-new', sourceKey: 'bm-2', registration: 'NEW', existingProductId: null, existingSkus: [] };
    db.productDrafts.set(update.draftId, update);
    db.productDrafts.set(fresh.draftId, fresh);
    const batch: ImportBatch = {
      batchId: 'pib-seed-5',
      format: 'SEED_V1',
      sourceSystem: 'bmart-capture',
      state: 'VALIDATED',
      productCount: 2,
      validCount: 2,
      invalidCount: 0,
      drafts: [update, fresh],
      createdAt: '2026-11-03T00:00:00Z',
    };
    db.importBatches.set(batch.batchId, batch);
    renderAt('/products/import/pib-seed-5');

    expect(await screen.findByText(/기존 상품 1개가 이 묶음 값으로 바뀌어요/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PRD-1' })).toHaveAttribute('href', '/products/PRD-1');
    expect(screen.getByText('기존 상품 갱신')).toBeInTheDocument();
    expect(screen.getByText('새 상품')).toBeInTheDocument();
  });
});
