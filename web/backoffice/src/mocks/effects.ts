// 승인 결정(ApprovalDecided)을 받은 정본 서비스의 반영을 흉내 낸다.
import type { ApprovalDetail, ContentDraft, ProductDetail, ProductDraft } from '../api/models';
import { db, nextId, timestamp } from './db';
import { settlePriceImportBatch } from './priceImportHandlers';

const draftIdsOf = (a: ApprovalDetail) => (a.lines ?? []).map((l) => l.lineKey);

function updateProduct(d: ProductDraft, productId: string): ProductDraft {
  const input = d.input;
  const p = db.products.get(productId);
  const s = input?.skus[0];
  const cur = p?.skus?.[0];
  if (!input || !p || !s || !cur) return { ...d, state: 'REJECTED', problems: [{ code: 'PRODUCT_NOT_FOUND' }] };
  if (s.unitType !== cur.unitType || s.unitsPerSku !== cur.unitsPerSku) return { ...d, state: 'REJECTED', problems: [{ code: 'SKU_IDENTITY_CHANGED' }] };
  const version = (p.version ?? 0) + 1;
  db.products.set(productId, {
    ...p,
    internalName: input.product.internalName,
    primaryCategoryId: d.resolvedCategoryIds?.[0] ?? input.product.primaryCategoryId ?? p.primaryCategoryId ?? '',
    categoryIds: d.resolvedCategoryIds ?? p.categoryIds ?? [],
    version,
    approvalId: d.approvalId ?? p.approvalId ?? '',
    publishedAt: timestamp(),
    skus: [
      {
        ...cur,
        ...(s.weightG === undefined ? {} : { weightG: s.weightG }),
        volumeMl: s.volumeMl ?? null,
        alcohol: s.alcohol ?? false,
        barcodes: s.barcodes ?? [],
        logistics: { ...(s.storageType ? { storageType: s.storageType } : {}) },
        ...(s.shelfLifeGuarantee ? { shelfLifeGuarantee: s.shelfLifeGuarantee } : {}),
        ...(s.dimensions ? { dimensions: s.dimensions } : {}),
        version: cur.version + 1,
        publishedAt: timestamp(),
      },
    ],
  });
  return { ...d, state: 'APPLIED', resultProductId: productId, resultSkus: [cur.sku] };
}

function issueProduct(d: ProductDraft): ProductDraft {
  const input = d.input;
  if (!input) return d;
  if (input.targetProductId) return updateProduct(d, input.targetProductId);
  const n = ++db.seq;
  const productId = `P-${String(n).padStart(8, '0')}`;
  const s = input.skus[0];
  const sku = `${s?.unitType ?? 'E'}-${String(n).padStart(8, '0')}`;
  const product: ProductDetail = {
    productId,
    baseProductId: input.product.baseProductId ?? `BP-${productId}`,
    internalName: input.product.internalName,
    primaryCategoryId: d.resolvedCategoryIds?.[0] ?? input.product.primaryCategoryId ?? '',
    categoryIds: d.resolvedCategoryIds ?? [],
    saleState: input.product.saleState ?? 'ON_SALE',
    version: 1,
    approvalId: d.approvalId ?? '',
    publishedAt: timestamp(),
    skus: [
      {
        sku,
        productId,
        baseProductId: `BP-${productId}`,
        unitType: s?.unitType ?? 'E',
        unitsPerSku: s?.unitsPerSku ?? 1,
        ...(s?.weightG === undefined ? {} : { weightG: s.weightG }),
        saleState: 'ON_SALE',
        alcohol: s?.alcohol ?? false,
        barcodes: s?.barcodes ?? [],
        logistics: { ...(s?.storageType ? { storageType: s.storageType } : {}) },
        version: 1,
        publishedAt: timestamp(),
      },
    ],
  };
  db.products.set(productId, product);
  // 같은 원천 키의 콘텐츠 초안을 상품에 연결(ProductVersionPublished.sources)
  for (const c of db.contentDrafts.values()) {
    if (!c.productId && c.sourceKey && c.sourceKey === d.sourceKey) db.contentDrafts.set(c.draftId, { ...c, productId });
  }
  return { ...d, state: 'APPLIED', resultProductId: productId, resultSkus: [sku] };
}

function applyProduct(a: ApprovalDetail, approved: boolean) {
  const ref = a.targetRef ?? '';
  if (ref.startsWith('categoryTreeVersion:')) {
    const v = db.treeVersions.get(Number(ref.split(':')[1]));
    if (!v) return;
    if (approved) {
      db.treeVersions.set(v.version, { ...v, state: 'EFFECTIVE', approvalId: a.approvalId ?? null, effectiveFrom: timestamp() });
      db.tree = { version: v.version, effectiveFrom: timestamp(), nodes: v.nodes, filters: {} };
    } else {
      db.treeVersions.set(v.version, { ...v, state: 'REJECTED' });
    }
    return;
  }
  if (ref.startsWith('SALE-STATE:')) return; // 판매 상태 변경 명령이 approvalId 로 참조한다
  for (const id of draftIdsOf(a)) {
    const d = db.productDrafts.get(id);
    if (!d) continue;
    db.productDrafts.set(
      id,
      approved
        ? issueProduct({ ...d, approvalId: a.approvalId ?? null })
        : { ...d, state: 'REJECTED', approvalId: a.approvalId ?? null, problems: [{ code: 'APPROVAL_REJECTED' }] },
    );
  }
  if (ref.startsWith('productImportBatch:')) {
    const b = db.importBatches.get(ref.split(':')[1] ?? '');
    if (b) db.importBatches.set(b.batchId, { ...b, state: approved ? 'APPLIED' : 'REJECTED' });
  }
}

function applyContent(a: ApprovalDetail, approved: boolean) {
  for (const id of draftIdsOf(a)) {
    const d = db.contentDrafts.get(id);
    if (!d) continue;
    const next: ContentDraft = approved
      ? { ...d, state: 'PUBLISHED', approvalId: a.approvalId ?? null, contentVersion: 1, submittable: false }
      : { ...d, state: 'REJECTED', approvalId: a.approvalId ?? null, problems: [{ code: 'APPROVAL_REJECTED' }] };
    db.contentDrafts.set(id, next);
  }
  const ref = a.targetRef ?? '';
  if (ref.startsWith('contentImportBatch:')) {
    const b = db.contentBatches.get(ref.split(':')[1] ?? '');
    if (b) db.contentBatches.set(b.batchId, { ...b, state: approved ? 'PUBLISHED' : 'REJECTED' });
  }
}

function applyPrice(a: ApprovalDetail) {
  for (const line of a.lines ?? []) {
    const attrs = (line.attributes ?? {}) as { sku?: string; basePrice?: number; effectiveFrom?: string };
    const sku = attrs.sku ?? line.lineKey;
    if (!db.products.size || ![...db.products.values()].some((p) => p.skus?.some((s) => s.sku === sku))) continue; // SKU_NOT_FOUND 행
    const at = attrs.effectiveFrom ?? a.effectiveFrom ?? timestamp();
    const effective = new Date(at).getTime() <= Date.now() ? timestamp() : at;
    const list = db.prices.get(sku) ?? [];
    const future = new Date(effective).getTime() > Date.now();
    const updated = list.map((v) => (!future && v.state === 'EFFECTIVE' ? { ...v, state: 'SUPERSEDED' as const, effectiveTo: effective } : v));
    updated.unshift({
      sku,
      priceVersion: list.length + 1,
      basePrice: attrs.basePrice ?? line.requestedAmount ?? 0,
      effectiveFrom: effective,
      effectiveTo: null,
      approvalId: a.approvalId ?? '',
      state: future ? 'SCHEDULED' : 'EFFECTIVE',
    });
    db.prices.set(sku, updated);
  }
}

/** 결정 직후 호출. 실행 축은 VALIDATING 으로 두고, 다음 조회 때 APPLIED 로 보인다. */
export function decide(a: ApprovalDetail, approved: boolean): void {
  if (a.targetService === 'product-service') applyProduct(a, approved);
  if (a.targetService === 'product-content-service') applyContent(a, approved);
  if (a.targetService === 'pricing-service' && approved) applyPrice(a);
  if (a.targetService === 'pricing-service' && a.approvalId) settlePriceImportBatch(a.targetRef, a.approvalId, approved);
  if (approved && a.approvalId) db.applying.add(a.approvalId);
}

/** 조회 시점: 반영 중이던 승인을 반영 완료로. */
export function settle(approvalId: string): void {
  if (!db.applying.delete(approvalId)) return;
  const a = db.approvals.get(approvalId);
  if (!a) return;
  db.approvals.set(approvalId, {
    ...a,
    executionState: 'APPLIED',
    deliveryState: 'ACKNOWLEDGED',
    receipts: [
      ...(a.receipts ?? []),
      {
        receiptId: nextId('rcpt'),
        approvalId,
        receiverService: a.targetService ?? '',
        receiptSeq: 1,
        result: 'APPLIED',
        deliveryState: 'ACKNOWLEDGED',
        receivedAt: timestamp(),
      },
    ],
  });
}
