import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { PriceImportBatch } from '../../api/models';
import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';

/** 목 시드와 같은 모양: 사과(현재 4,500 → 묶음 4,900 = 변경), 미역국(가격 없음 → 3,900 = 새 가격), 망고(상품 승인 전). */
function seedBatch(): PriceImportBatch {
  const batch: PriceImportBatch = {
    batchId: 'PB-seed-1',
    format: 'SEED_V1',
    sourceSystem: 'bmart-capture',
    sourceName: 'seed-v1.zip',
    state: 'DRAFT',
    version: 0,
    lineCount: 3,
    submittableCount: 2,
    effectiveFrom: null,
    approvalTargetRef: null,
    approvalId: null,
    checkedAt: '2026-11-03T01:00:00Z',
    createdAt: '2026-11-03T01:00:00Z',
    submittedAt: null,
    lines: [
      { seedProductId: 's-1', productName: '사과 1.5kg', productId: 'P-00000001', sku: 'E-00000001', bundlePrice: 4900, basePrice: 4900, currentPrice: 4500, changeType: 'CHANGE', status: 'READY', excluded: false, edited: false },
      { seedProductId: 's-2', productName: '소고기 미역국 500g', productId: 'P-00000002', sku: 'E-00000002', bundlePrice: 3900, basePrice: 3900, currentPrice: null, changeType: 'NEW', status: 'READY', excluded: false, edited: false },
      { seedProductId: 's-3', productName: '수입 망고', productId: null, sku: null, bundlePrice: 2500, basePrice: 2500, currentPrice: null, status: 'SKU_NOT_FOUND', excluded: false, edited: false },
    ],
  };
  db.priceBatches.set(batch.batchId, batch);
  return batch;
}

describe('가격 일괄 등록', () => {
  it('서버가 채운 행을 표시한다 — 현재 가격·묶음 가격·구분·상태는 서버 값 그대로, 상품 승인 전 행은 제출 대상이 아니다', async () => {
    seedBatch();
    renderAt('/prices/import/PB-seed-1');

    expect(await screen.findByTestId('batch-summary')).toHaveTextContent('설정 중 · 전체 3행 · 지금 제출하면 2행');
    const apple = screen.getByText('사과 1.5kg').closest('tr')!;
    expect(within(apple).getByText('4,500원')).toBeInTheDocument();
    expect(within(apple).getByText('4,900원')).toBeInTheDocument();
    expect(within(apple).getByLabelText('등록 가격 사과 1.5kg')).toHaveValue('4900');
    expect(within(apple).getByText('가격 변경')).toBeInTheDocument();
    expect(screen.getByTestId('status-s-2')).toHaveTextContent('제출 대상');
    const mango = screen.getByText('수입 망고').closest('tr')!;
    expect(within(mango).getByText('없음')).toBeInTheDocument(); // 현재 가격 없음(0원이 아니다)
    expect(screen.getByTestId('status-s-3')).toHaveTextContent('상품 승인 전');
  });

  it('행 가격을 고쳐 저장하면 PUT(같은 버전)으로 보내고, 현재 가격과 같아진 행은 서버 판정대로 "변경 없음"이 되어 제출 수에서 빠진다', async () => {
    seedBatch();
    const user = userEvent.setup();
    const view = renderAt('/prices/import/PB-seed-1');

    const input = await screen.findByLabelText('등록 가격 사과 1.5kg');
    await user.clear(input);
    await user.type(input, '4500');
    await user.click(screen.getByRole('button', { name: '저장 사과 1.5kg' }));

    await waitFor(() => expect(screen.getByTestId('status-s-1')).toHaveTextContent('현재와 같아 제외'));
    expect(screen.getByTestId('batch-summary')).toHaveTextContent('지금 제출하면 1행');
    const put = view.mutations('/price-import-batches/PB-seed-1/lines/s-1')[0]!;
    expect(put.method).toBe('PUT');
    expect(put.headers.get('Idempotency-Key')).toBeTruthy();
    expect(put.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(put.headers.get('X-Expected-Version')).toBe('0');
    expect(await put.json()).toEqual({ basePrice: 4500, excluded: false });
    // 고친 값 표시 + 묶음 값으로 되돌리기
    expect(screen.getByText('고친 값')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '묶음 값으로 사과 1.5kg' }));
    await waitFor(() => expect(screen.getByTestId('status-s-1')).toHaveTextContent('제출 대상'));
    const revert = view.mutations('/price-import-batches/PB-seed-1/lines/s-1')[1]!;
    expect(revert.headers.get('X-Expected-Version')).toBe('1');
    expect(await revert.json()).toEqual({ basePrice: null, excluded: false });
    view.stop();
  });

  it('빼기를 켜면 그 행은 "뺌"이 되고 제출 수에서 빠진다', async () => {
    seedBatch();
    const user = userEvent.setup();
    const view = renderAt('/prices/import/PB-seed-1');

    await user.click(await screen.findByLabelText('빼기 소고기 미역국 500g'));
    await waitFor(() => expect(screen.getByTestId('status-s-2')).toHaveTextContent('뺌'));
    expect(screen.getByTestId('batch-summary')).toHaveTextContent('지금 제출하면 1행');
    expect(await view.mutations('/lines/s-2')[0]!.json()).toEqual({ basePrice: null, excluded: true });
    view.stop();
  });

  it('제출하면 배치가 잠기고 승인 요청 본문(PRICE 한 건, 행 = 제출 대상)을 그대로 승인 요청으로 올릴 수 있다', async () => {
    seedBatch();
    const user = userEvent.setup();
    const view = renderAt('/prices/import/PB-seed-1');

    await user.click(await screen.findByRole('button', { name: '제출·승인 요청 만들기' }));
    expect(await screen.findByText('2행을 제출했어요. 아래에서 승인 요청을 올리세요.')).toBeInTheDocument();
    expect(screen.getByTestId('batch-summary')).toHaveTextContent('승인 대기(잠김)');
    // 잠긴 뒤에는 고치기·빼기·제출 버튼이 없다
    expect(screen.queryByLabelText('등록 가격 사과 1.5kg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '제출·승인 요청 만들기' })).not.toBeInTheDocument();
    const submission = view.mutations('/price-import-batches/PB-seed-1/submissions')[0]!;
    expect(submission.headers.get('X-Expected-Version')).toBe('0');
    expect(await submission.json()).toEqual({});

    // 승인 요청 버튼은 배치 조회의 approvalRequest + 승인 목록(targetRef) 조회가 끝난 뒤 보인다(BR-41).
    await user.click(await screen.findByRole('button', { name: '승인 요청' }));
    expect(await screen.findByText('승인 요청을 올렸어요.')).toBeInTheDocument();
    const cr = view.mutations('/change-requests')[0]!;
    const body = (await cr.json()) as { type: string; targetRef: string; lines: { lineKey: string; requestedAmount: number; attributes: Record<string, unknown> }[] };
    expect(body.type).toBe('PRICE');
    expect(body.targetRef).toBe('priceImportBatch:PB-seed-1');
    expect(body.lines.map((l) => l.lineKey)).toEqual(['E-00000001', 'E-00000002']);
    expect(body.lines[0]!.attributes).toMatchObject({ previousPrice: 4500, basePrice: 4900, changeType: 'CHANGE', productName: '사과 1.5kg' });
    view.stop();
  });

  it('제출 대상이 없으면 제출 버튼이 비활성이다', async () => {
    const b = seedBatch();
    db.priceBatches.set(b.batchId, { ...b, submittableCount: 0, lines: b.lines.map((l) => ({ ...l, excluded: true, status: 'EXCLUDED' as const })) });
    renderAt('/prices/import/PB-seed-1');
    expect(await screen.findByRole('button', { name: '제출·승인 요청 만들기' })).toBeDisabled();
  });

  it('승인 상세에서 가격 일괄 등록 행은 상품명 · 이전 가격 → 새 가격 · 구분으로 보인다(이전 가격 없음은 "-", 0원이 아니다)', async () => {
    const seed = db.approvals.get('apv-seed-price-1')!;
    db.approvals.set('apv-seed-price-1', {
      ...seed,
      targetRef: 'priceImportBatch:PB-seed-1',
      lines: [
        { lineKey: 'E-00000001', requestedAmount: 4900, attributes: { sku: 'E-00000001', basePrice: 4900, previousPrice: 4500, changeType: 'CHANGE', productName: '사과 1.5kg' } },
        { lineKey: 'E-00000002', requestedAmount: 3900, attributes: { sku: 'E-00000002', basePrice: 3900, previousPrice: null, changeType: 'NEW', productName: '소고기 미역국 500g' } },
      ],
    });
    renderAt('/approvals/apv-seed-price-1', as.approver);
    const rows = await screen.findAllByTestId('price-line');
    expect(rows[0]).toHaveTextContent('사과 1.5kg · 4,500원 → 4,900원 · 가격 변경');
    expect(rows[1]).toHaveTextContent('소고기 미역국 500g · - → 3,900원 · 새 가격');
  });

  it('업로드 화면: 파일을 고르기 전에는 올릴 수 없다', async () => {
    renderAt('/prices/import');
    expect(await screen.findByRole('heading', { name: '가격 일괄 등록(seed-v1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '업로드·검증' })).toBeDisabled();
  });
});
