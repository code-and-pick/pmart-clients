// product-service·product-content-service 목.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type {
  CategoryAdditionRequest,
  CategoryNode,
  CategoryTreeDraftRequest,
  ContentDraft,
  ContentDraftInput,
  ProductDraft,
  ProductDraftInput,
  SaleState,
} from '../api/models';
import { gs1CheckDigitProblem } from '../features/products/barcode';
import { db, nextId, timestamp } from './db';
import { expectedVersion, hash, idempotent, keyOf, operator, problem, unauthorized } from './support';

type SourceNode = CategoryTreeDraftRequest['categories'][number];
const LEVEL = { top: 'TOP', sub: 'SUB', chip1: 'CHIP1', chip2: 'CHIP2' } as const;

function flatten(nodes: readonly SourceNode[], parent: CategoryNode | null, out: CategoryNode[] = []): CategoryNode[] {
  nodes.forEach((n, i) => {
    const node: CategoryNode = {
      categoryId: n.id,
      parentId: parent?.categoryId ?? null,
      level: LEVEL[n.level],
      name: n.name,
      path: parent ? `${parent.path} > ${n.name}` : n.name,
      sortOrder: i + 1,
      exposed: true,
      ...(n.section ? { section: n.section } : {}),
    };
    out.push(node);
    flatten(n.children ?? [], node, out);
  });
  return out;
}

const allBarcodes = () => new Map([...db.products.values()].flatMap((p) => (p.skus ?? []).flatMap((s) => (s.barcodes ?? []).map((b) => [b, s.sku] as const))));

function validate(input: ProductDraftInput): Pick<ProductDraft, 'validationState' | 'problems' | 'resolvedCategoryIds'> {
  const problems: NonNullable<ProductDraft['problems']> = [];
  const s = input.skus[0];
  if (s?.weightG === undefined) problems.push({ code: 'WEIGHT_REQUIRED', field: 'skus[0].weightG' });
  if (!s?.storageType) problems.push({ code: 'STORAGE_TYPE_REQUIRED', field: 'skus[0].storageType' });
  const known = new Set((db.tree?.nodes ?? []).map((n) => n.categoryId));
  const ids = [...new Set([...(input.product.primaryCategoryId ? [input.product.primaryCategoryId] : []), ...(input.product.categoryIds ?? [])])];
  const byPath = new Map((db.tree?.nodes ?? []).map((n) => [n.path, n.categoryId]));
  for (const p of input.product.categoryPaths ?? []) {
    const id = byPath.get(p);
    if (id) ids.push(id);
    else problems.push({ code: 'CATEGORY_NOT_MAPPED', field: 'product.categoryPaths', detail: p });
  }
  for (const id of ids) if (!known.has(id)) problems.push({ code: 'CATEGORY_NOT_FOUND', field: 'product.categoryIds', detail: id });
  if (ids.length === 0 && !(input.product.categoryPaths?.length)) problems.push({ code: 'CATEGORY_NOT_MAPPED', field: 'product.primaryCategoryId' });
  // 수정 초안(product 0.3.0)은 고칠 상품 자기 SKU 의 바코드를 충돌로 보지 않는다.
  const own = new Set((db.products.get(input.targetProductId ?? '')?.skus ?? []).map((x) => x.sku));
  const used = allBarcodes();
  const seen = new Set<string>();
  for (const b of s?.barcodes ?? []) {
    if (!b.trim()) problems.push({ code: 'BARCODE_EMPTY', field: 'skus[0].barcodes' });
    else if (seen.has(b)) problems.push({ code: 'BARCODE_DUPLICATED_IN_DRAFT', field: 'skus[0].barcodes', detail: b });
    else if (gs1CheckDigitProblem(b) !== null) problems.push({ code: 'BARCODE_CHECK_DIGIT_INVALID', field: 'skus[0].barcodes', detail: gs1CheckDigitProblem(b) ?? '' });
    else if (used.has(b) && !own.has(used.get(b) ?? '')) problems.push({ code: 'BARCODE_CONFLICT', field: 'skus[0].barcodes', detail: used.get(b) ?? '' });
    seen.add(b);
  }
  return { validationState: problems.length ? 'INVALID' : 'VALID', problems, resolvedCategoryIds: ids.filter((id) => known.has(id)) };
}

/** 같은 원천 키로 이미 등록된 상품(반영된 초안). 있으면 재업로드 = 그 상품의 새 버전(BR-39 회신 2026-11-03). */
function registrationOf(input: ProductDraftInput): Pick<ProductDraft, 'registration' | 'existingProductId' | 'existingSkus'> {
  const target = input.targetProductId ? db.products.get(input.targetProductId) : undefined;
  if (target) return { registration: 'UPDATE', existingProductId: target.productId ?? null, existingSkus: (target.skus ?? []).map((x) => x.sku) };
  const applied = input.sourceKey
    ? [...db.productDrafts.values()].find((p) => p.sourceSystem === (input.sourceSystem ?? null) && p.sourceKey === input.sourceKey && p.resultProductId)
    : undefined;
  return applied
    ? { registration: 'UPDATE', existingProductId: applied.resultProductId ?? null, existingSkus: applied.resultSkus ?? [] }
    : { registration: 'NEW', existingProductId: null, existingSkus: [] };
}

function newProductDraft(input: ProductDraftInput, batchId: string | null = null): ProductDraft {
  const d: ProductDraft = {
    draftId: nextId('pd'),
    batchId,
    sourceSystem: input.sourceSystem ?? null,
    sourceKey: input.sourceKey ?? null,
    state: 'DRAFT',
    input,
    draftHash: null,
    approvalId: null,
    resultProductId: null,
    resultSkus: [],
    version: 0,
    updatedAt: timestamp(),
    ...validate(input),
    ...registrationOf(input),
  };
  db.productDrafts.set(d.draftId, d);
  return d;
}

const productApproval = (targetRef: string, drafts: readonly ProductDraft[], summary: string) => ({
  type: 'PRODUCT' as const,
  targetService: 'product-service' as const,
  targetRef,
  allowedActions: ['ISSUE_SKU', 'PUBLISH_PRODUCT_VERSION'],
  summary,
  lines: drafts.map((d) => ({
    lineKey: d.draftId,
    targetRef: `productDraft:${d.draftId}`,
    attributes: {
      draftId: d.draftId,
      draftHash: d.draftHash,
      sourceKey: d.sourceKey,
      internalName: d.input?.product.internalName,
      registration: d.registration ?? 'NEW',
      ...(d.registration === 'UPDATE' ? { existingProductId: d.existingProductId, existingSkus: d.existingSkus } : {}),
    },
  })),
});

function contentProblems(d: ContentDraft): NonNullable<ContentDraft['problems']> {
  const out: NonNullable<ContentDraft['problems']> = [];
  if (!d.productId) out.push({ code: 'PRODUCT_NOT_LINKED', field: 'productId' });
  if (!d.input?.name) out.push({ code: 'NAME_REQUIRED', field: 'name' });
  if (!(d.images ?? []).some((i) => i.role === 'MAIN')) out.push({ code: 'MAIN_IMAGE_REQUIRED', field: 'images' });
  return out;
}

/** 조회 때마다 제출 가능 여부를 다시 계산(상품 승인으로 연결되면 바뀐다) */
/**
 * 신규/기존 게시 갱신(BR-44, 백엔드 회신 2026-11-04): 심사 전 초안(DRAFT·SUBMITTED)만. 연결 상품 또는 같은 원천 키에
 * 이미 게시된 콘텐츠가 있으면 UPDATE(+ 지금 게시본). 게시·반려된 초안은 null.
 */
function contentRegistrationOf(d: ContentDraft): Pick<ContentDraft, 'registration' | 'publishedContentVersion' | 'publishedDraftId' | 'publishedAt'> {
  if (d.state !== 'DRAFT' && d.state !== 'SUBMITTED') return { registration: null, publishedContentVersion: null, publishedDraftId: null, publishedAt: null };
  const pub = [...db.contentDrafts.values()].find(
    (p) => p.state === 'PUBLISHED' && p.draftId !== d.draftId && ((d.productId && p.productId === d.productId) || (d.sourceKey && p.sourceKey === d.sourceKey)),
  );
  return pub
    ? { registration: 'UPDATE', publishedContentVersion: pub.contentVersion ?? null, publishedDraftId: pub.draftId, publishedAt: pub.updatedAt ?? null }
    : { registration: 'NEW', publishedContentVersion: null, publishedDraftId: null, publishedAt: null };
}

function viewContent(d: ContentDraft): ContentDraft {
  if (d.state !== 'DRAFT') return { ...d, ...contentRegistrationOf(d) };
  const problems = contentProblems(d);
  return { ...d, ...contentRegistrationOf(d), problems, submittable: problems.length === 0 };
}

function newContentDraft(input: ContentDraftInput): ContentDraft {
  const linked =
    input.productId ??
    [...db.productDrafts.values()].find((p) => p.sourceKey && p.sourceKey === input.sourceKey && p.resultProductId)?.resultProductId ??
    null;
  const d: ContentDraft = {
    draftId: nextId('cd'),
    sourceSystem: input.sourceSystem ?? null,
    sourceKey: input.sourceKey ?? null,
    productId: linked,
    state: 'DRAFT',
    input,
    images: [],
    draftHash: null,
    approvalId: null,
    contentVersion: null,
    version: 0,
    updatedAt: timestamp(),
  };
  db.contentDrafts.set(d.draftId, d);
  return viewContent(d);
}

const contentApproval = (targetRef: string, drafts: readonly ContentDraft[], summary: string) => ({
  type: 'DISPLAY' as const,
  targetService: 'product-content-service' as const,
  targetRef,
  allowedActions: ['PUBLISH_CONTENT'],
  summary,
  lines: drafts.map((d) => ({
    lineKey: d.draftId,
    targetRef: `contentDraft:${d.draftId}`,
    attributes: (() => {
      const r = contentRegistrationOf(d);
      return {
        draftId: d.draftId,
        draftHash: d.draftHash,
        productId: d.productId,
        name: d.input?.name,
        registration: r.registration,
        ...(r.registration === 'UPDATE' ? { publishedContentVersion: r.publishedContentVersion } : {}),
      };
    })(),
  })),
});

/** 1x1 PNG(목 이미지 본문) */
const APPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#fff4f2"/><path d="M48 30c-6-6-26-6-26 18 0 18 14 32 26 28 12 4 26-10 26-28 0-24-20-24-26-18z" fill="#e5383b"/><path d="M48 30c0-8 4-14 10-16" stroke="#6b3e26" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M52 22c6-6 14-6 18-2-6 6-14 6-18 2z" fill="#3a9d23"/><ellipse cx="36" cy="46" rx="5" ry="9" fill="#ff8a8c" opacity=".6"/></svg>';
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

export const catalogHandlers = [
  // ---------- 카테고리 ----------
  http.get(`${API_BASE}/categories/tree`, () =>
    db.tree ? HttpResponse.json({ version: db.tree.version, effectiveFrom: db.tree.effectiveFrom, nodes: db.tree.nodes }) : problem(404, 'CATEGORY_TREE_NOT_EFFECTIVE'),
  ),
  http.get(`${API_BASE}/categories/:id/filters`, ({ params }) => {
    const id = String(params['id']);
    if (!db.tree?.nodes.some((n) => n.categoryId === id)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ categoryId: id, version: db.tree.version, groups: db.tree.filters[id] ?? [] });
  }),
  http.post(`${API_BASE}/category-tree-versions`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as CategoryTreeDraftRequest;
    return idempotent(request, () => {
      const version = Math.max(db.tree?.version ?? 0, ...db.treeVersions.keys()) + 1;
      const nodes = flatten(body.categories, null);
      const countsByLevel: Record<string, number> = {};
      for (const n of nodes) countsByLevel[n.level] = (countsByLevel[n.level] ?? 0) + 1;
      const v = {
        version,
        state: 'DRAFT' as const,
        nodeCount: nodes.length,
        filterGroupCount: body.filters.length,
        countsByLevel,
        approvalId: null,
        effectiveFrom: null,
        approvalRequest: {
          type: 'PRODUCT' as const,
          targetService: 'product-service' as const,
          targetRef: `categoryTreeVersion:${version}`,
          allowedActions: ['APPLY_CATEGORY_TREE'],
          summary: `카테고리 트리 v${version} (노드 ${nodes.length})`,
          lines: [{ lineKey: String(version) }],
        },
      };
      db.treeVersions.set(version, { ...v, nodes });
      return { status: 201, body: v };
    });
  }),
  // seed-v1 categories.json → 발효 트리에 없는 노드만 더한 초안(2026-11-02 백엔드 요청 §2-2)
  http.post(`${API_BASE}/category-tree-additions`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as CategoryAdditionRequest;
    return idempotent(request, () => addCategories(body));
  }),
  // seed-v1 zip 업로드(백엔드 회신 2026-11-03 §3). 목은 zip 을 풀지 않고, 묶음에 든 것으로 치는 고정 categories 를 같은 규칙으로 더한다.
  http.post(`${API_BASE}/category-tree-addition-uploads`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    return idempotent(request, () => addCategories(zipBundleCategories));
  }),
  http.get(`${API_BASE}/category-tree-versions/:v`, ({ params }) => {
    const v = db.treeVersions.get(Number(params['v']));
    if (!v) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ version: v.version, state: v.state, nodeCount: v.nodeCount, filterGroupCount: v.filterGroupCount, countsByLevel: v.countsByLevel ?? {}, approvalId: v.approvalId ?? null, effectiveFrom: v.effectiveFrom ?? null });
  }),

  // ---------- 상품 초안 ----------
  http.post(`${API_BASE}/product-drafts`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const input = (await request.json()) as ProductDraftInput;
    return idempotent(request, () => ({ status: 201, body: newProductDraft(input) }));
  }),
  http.get(`${API_BASE}/product-drafts/:id`, ({ params }) => {
    const d = db.productDrafts.get(String(params['id']));
    return d ? HttpResponse.json(d) : problem(404, 'NOT_FOUND');
  }),
  http.put(`${API_BASE}/product-drafts/:id`, async ({ request, params }) => {
    const input = (await request.json()) as ProductDraftInput;
    return idempotent(request, () => {
      const d = db.productDrafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(422, 'DRAFT_NOT_EDITABLE');
      if (expectedVersion(request) !== undefined && expectedVersion(request) !== d.version) return problem(409, 'VERSION_CONFLICT');
      const next: ProductDraft = { ...d, input, version: d.version + 1, updatedAt: timestamp(), ...validate(input) };
      db.productDrafts.set(d.draftId, next);
      return { status: 200, body: next };
    });
  }),
  http.post(`${API_BASE}/product-drafts/:id/submissions`, ({ request, params }) =>
    idempotent(request, () => {
      const d = db.productDrafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(422, 'DRAFT_NOT_EDITABLE');
      if (d.validationState !== 'VALID') return problem(422, 'DRAFT_INVALID');
      const locked: ProductDraft = { ...d, state: 'SUBMITTED', draftHash: hash(d.input) };
      db.productDrafts.set(d.draftId, locked);
      return {
        status: 200,
        body: { submittedDraftIds: [d.draftId], excludedDraftIds: [], approvalRequest: productApproval(`productDraft:${d.draftId}`, [locked], `상품 등록: ${d.input?.product.internalName ?? d.draftId}`) },
      };
    }),
  ),

  // 상품 정보 수정 시작(product 0.3.0~0.3.2): MD 만, 현재 승인 값으로 채운 수정 초안. 열린(DRAFT·SUBMITTED) 수정 초안이 있으면 409.
  http.post(`${API_BASE}/products/:id/edit-drafts`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    return idempotent(request, () => {
      if (!who.roles.includes('MD')) return problem(403, 'FORBIDDEN');
      const p = db.products.get(String(params['id']));
      if (!p?.productId) return problem(404, 'PRODUCT_NOT_FOUND');
      const open = [...db.productDrafts.values()].find((d) => d.input?.targetProductId === p.productId && (d.state === 'DRAFT' || d.state === 'SUBMITTED'));
      if (open) return problem(409, 'EDIT_DRAFT_EXISTS', [{ field: 'existingDraftId', reason: open.draftId }]);
      const s = p.skus?.[0];
      const input: ProductDraftInput = {
        targetProductId: p.productId,
        product: {
          internalName: p.internalName ?? '',
          ...(p.baseProductId ? { baseProductId: p.baseProductId } : {}),
          ...(p.primaryCategoryId ? { primaryCategoryId: p.primaryCategoryId } : {}),
          categoryIds: (p.categoryIds ?? []).filter((id) => id !== p.primaryCategoryId),
        },
        skus: s
          ? [
              {
                unitType: s.unitType,
                unitsPerSku: s.unitsPerSku,
                ...(s.weightG === undefined ? {} : { weightG: s.weightG }),
                ...(s.volumeMl == null ? {} : { volumeMl: s.volumeMl }),
                ...(s.netContent ? { netContent: s.netContent } : {}), // product 0.4.0 — 현재 값을 옮겨 담는다
                ...(s.logistics?.storageType ? { storageType: s.logistics.storageType } : {}),
                alcohol: s.alcohol ?? false,
                ...(s.shelfLifeGuarantee ? { shelfLifeGuarantee: s.shelfLifeGuarantee } : {}),
                ...(s.dimensions ? { dimensions: s.dimensions } : {}),
                ...(s.dimensionsSource ? { dimensionsSource: s.dimensionsSource } : {}),
                barcodes: s.barcodes ?? [],
              },
            ]
          : [],
      };
      return { status: 201, body: newProductDraft(input) };
    });
  }),

  // ---------- 상품 일괄(seed-v1) — 목은 zip 을 읽지 않고 고정 3건을 만든다 ----------
  http.post(`${API_BASE}/product-import-batches`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    return idempotent(request, () => {
      if (!db.tree) return problem(422, 'CATEGORY_TREE_NOT_EFFECTIVE');
      const batchId = nextId('pib');
      const seeds: ProductDraftInput[] = [
        { sourceSystem: 'bmart-capture', sourceKey: `seed-${batchId}-1`, product: { internalName: '부사 사과 1kg', categoryPaths: ['과일·채소 > 과일 > 사과·배'] }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 1000, storageType: 'CHILLED' }] },
        { sourceSystem: 'bmart-capture', sourceKey: `seed-${batchId}-2`, product: { internalName: '사골곰탕 500g', categoryPaths: ['국·탕·찌개 > 국·국밥'] }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 500, storageType: 'AMBIENT' }] },
        { sourceSystem: 'bmart-capture', sourceKey: `seed-${batchId}-3`, product: { internalName: '수입 망고', categoryPaths: ['과일·채소 > 열대과일'] }, skus: [{ unitType: 'E', unitsPerSku: 1, weightG: 400, storageType: 'CHILLED' }] },
      ];
      const drafts = seeds.map((s) => newProductDraft(s, batchId));
      const valid = drafts.filter((d) => d.validationState === 'VALID').length;
      const batch = { batchId, format: 'SEED_V1' as const, sourceSystem: 'bmart-capture', state: 'VALIDATED' as const, productCount: drafts.length, validCount: valid, invalidCount: drafts.length - valid, drafts, createdAt: timestamp() };
      db.importBatches.set(batchId, batch);
      return { status: 201, body: batch };
    });
  }),
  http.get(`${API_BASE}/product-import-batches/:id`, ({ params }) => {
    const b = db.importBatches.get(String(params['id']));
    if (!b) return problem(404, 'NOT_FOUND');
    const drafts = (b.drafts ?? []).map((d) => db.productDrafts.get(d.draftId) ?? d);
    // BR-41 회신: 승인 대기(SUBMITTED) 동안 잠긴 행으로 제출 응답과 같은 본문을 다시 만든다.
    const locked = drafts.filter((d) => d.state === 'SUBMITTED');
    const pendingSubmission =
      b.state === 'SUBMITTED' && locked.length > 0
        ? {
            submittedDraftIds: locked.map((d) => d.draftId),
            excludedDraftIds: drafts.filter((d) => d.state !== 'SUBMITTED').map((d) => d.draftId),
            approvalRequest: productApproval(`productImportBatch:${b.batchId}`, locked, `상품 일괄 등록 ${locked.length}건`),
          }
        : undefined;
    return HttpResponse.json({ ...b, drafts, ...(pendingSubmission ? { pendingSubmission } : {}) });
  }),
  http.post(`${API_BASE}/product-import-batches/:id/submissions`, ({ request, params }) =>
    idempotent(request, () => {
      const b = db.importBatches.get(String(params['id']));
      if (!b) return problem(404, 'NOT_FOUND');
      const drafts = (b.drafts ?? []).map((d) => db.productDrafts.get(d.draftId) ?? d);
      const ok = drafts.filter((d) => d.state === 'DRAFT' && d.validationState === 'VALID');
      if (ok.length === 0) return problem(422, 'NOTHING_TO_SUBMIT');
      const locked = ok.map((d) => {
        const l: ProductDraft = { ...d, state: 'SUBMITTED', draftHash: hash(d.input) };
        db.productDrafts.set(d.draftId, l);
        return l;
      });
      db.importBatches.set(b.batchId, { ...b, state: 'SUBMITTED' });
      return {
        status: 200,
        body: {
          submittedDraftIds: locked.map((d) => d.draftId),
          excludedDraftIds: drafts.filter((d) => !ok.includes(d)).map((d) => d.draftId),
          approvalRequest: productApproval(`productImportBatch:${b.batchId}`, locked, `상품 일괄 등록 ${locked.length}건`),
        },
      };
    }),
  ),
  http.get(`${API_BASE}/product-import-batches/:id/id-map`, ({ params }) => {
    const b = db.importBatches.get(String(params['id']));
    if (!b) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      batchId: b.batchId,
      sourceSystem: b.sourceSystem,
      products: (b.drafts ?? []).map((d0) => {
        const d = db.productDrafts.get(d0.draftId) ?? d0;
        return { seedProductId: d.sourceKey ?? '', pmartProductId: d.resultProductId ?? null, sku: d.resultSkus?.[0] ?? null, state: d.state };
      }),
    });
  }),

  // ---------- 상품 조회·판매 상태 ----------
  http.get(`${API_BASE}/products`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const items = [...db.products.values()]
      .filter((p) => !q.get('saleState') || p.saleState === q.get('saleState'))
      .filter((p) => !q.get('categoryId') || (p.categoryIds ?? []).includes(q.get('categoryId') ?? ''))
      .map(({ productId, baseProductId, internalName, primaryCategoryId, saleState, version }) => ({ productId, baseProductId, internalName, primaryCategoryId, saleState, version }));
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),
  http.get(`${API_BASE}/products/:id`, ({ params }) => {
    const p = db.products.get(String(params['id']));
    return p ? HttpResponse.json(p) : problem(404, 'NOT_FOUND');
  }),
  http.get(`${API_BASE}/skus/:sku`, ({ params }) => {
    const s = [...db.products.values()].flatMap((p) => p.skus ?? []).find((x) => x.sku === params['sku']);
    return s ? HttpResponse.json(s) : problem(404, 'NOT_FOUND');
  }),
  http.get(`${API_BASE}/barcodes/:barcode`, ({ params }) => {
    const s = [...db.products.values()].flatMap((p) => p.skus ?? []).find((x) => (x.barcodes ?? []).includes(String(params['barcode'])));
    return s
      ? HttpResponse.json({ barcode: params['barcode'], sku: s.sku, productId: s.productId, unitType: s.unitType, unitsPerSku: s.unitsPerSku, version: s.version })
      : problem(404, 'BARCODE_NOT_MAPPED');
  }),
  http.post(`${API_BASE}/products/:id/sale-state-changes`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const body = (await request.json()) as { saleState: SaleState; reason: string; approvalId?: string };
    return idempotent(request, () => {
      const p = db.products.get(String(params['id']));
      if (!p) return problem(404, 'NOT_FOUND');
      if (!who.roles.includes('MD')) return problem(403, 'FORBIDDEN');
      if (expectedVersion(request) !== undefined && expectedVersion(request) !== p.version) return problem(409, 'VERSION_CONFLICT');
      if (body.saleState === 'SALE_STOPPED') {
        const a = body.approvalId ? db.approvals.get(body.approvalId) : undefined;
        if (!a || a.reviewState !== 'APPROVED' || a.targetRef !== `SALE-STATE:${p.productId}`) return problem(422, 'APPROVAL_REQUIRED');
        if (db.usedApprovals.has(a.approvalId ?? '')) return problem(409, 'INVALID_STATE');
        db.usedApprovals.add(a.approvalId ?? '');
      }
      const version = (p.version ?? 0) + 1;
      db.products.set(p.productId ?? '', { ...p, saleState: body.saleState, version, skus: (p.skus ?? []).map((s) => ({ ...s, saleState: body.saleState })) });
      const result = { status: 'APPLIED', requestId: keyOf(request), version, occurredAt: timestamp() };
      db.commandResults.set(keyOf(request), result);
      return { status: 200, body: result };
    });
  }),
  http.get(`${API_BASE}/products/:id/sale-state-changes/:rid`, ({ params }) => {
    const r = db.commandResults.get(String(params['rid']));
    return r ? HttpResponse.json(r as Record<string, unknown>) : problem(404, 'NOT_FOUND');
  }),

  // ---------- 콘텐츠 ----------
  http.post(`${API_BASE}/content-drafts`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const input = (await request.json()) as ContentDraftInput;
    return idempotent(request, () => {
      if (input.productId && !db.products.has(input.productId)) return problem(422, 'PRODUCT_NOT_FOUND');
      return { status: 201, body: newContentDraft(input) };
    });
  }),
  http.get(`${API_BASE}/content-drafts/:id`, ({ params }) => {
    const d = db.contentDrafts.get(String(params['id']));
    return d ? HttpResponse.json(viewContent(d)) : problem(404, 'NOT_FOUND');
  }),
  // 상품 카드 일괄 조회(계약 listProductContents — 최대 100건, 미게시는 missing). 상품 조회 썸네일·고객용 이름(2026-11-19)
  http.get(`${API_BASE}/product-contents`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll('productIds').flatMap((s) => s.split(',')).filter(Boolean);
    if (ids.length > 100) return problem(400, 'VALIDATION_FAILED');
    const card = (productId: string) => {
      const d = [...db.contentDrafts.values()].find((c) => c.state === 'PUBLISHED' && c.productId === productId);
      if (!d) return null;
      const main = (d.images ?? []).find((i) => i.role === 'MAIN');
      return { productId, contentVersion: d.contentVersion ?? 1, name: d.input?.name, ...(main ? { mainImage: { imageId: main.imageId, role: 'MAIN', sortOrder: 0, url: main.url } } : {}), options: [] };
    };
    const items = ids.flatMap((id) => {
      const c = card(id);
      return c ? [c] : [];
    });
    return HttpResponse.json({ asOf: timestamp(), items, missing: ids.filter((id) => !card(id)) });
  }),
  // 게시된 콘텐츠(고객 공개 API). 콘텐츠 등록의 상품 선택 자동 기입이 읽는다. 게시된 것이 없으면 404.
  http.get(`${API_BASE}/product-contents/:id`, ({ params }) => {
    const productId = String(params['id']);
    const d = [...db.contentDrafts.values()].find((c) => c.state === 'PUBLISHED' && c.productId === productId);
    if (!d) return problem(404, 'NOT_FOUND');
    const i = d.input ?? {};
    return HttpResponse.json({
      productId,
      contentVersion: d.contentVersion ?? 1,
      name: i.name,
      description: i.description ?? null,
      storageGuide: i.storageGuide ?? null,
      returnGuide: i.returnGuide ?? null,
      notices: i.notices ?? [],
      // 게시 초안의 사진 그대로(2026-11-19 상품 상세·콘텐츠 조회 사진)
      images: (d.images ?? []).map((img) => ({ imageId: img.imageId, role: img.role, sortOrder: img.sortOrder, url: img.url })),
      options: [],
    });
  }),
  http.put(`${API_BASE}/content-drafts/:id`, async ({ request, params }) => {
    const input = (await request.json()) as ContentDraftInput;
    return idempotent(request, () => {
      const d = db.contentDrafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(422, 'DRAFT_NOT_EDITABLE');
      if (expectedVersion(request) !== undefined && expectedVersion(request) !== d.version) return problem(409, 'VERSION_CONFLICT');
      if (input.productId && !db.products.has(input.productId)) return problem(422, 'PRODUCT_NOT_FOUND');
      const next: ContentDraft = { ...d, input, productId: input.productId ?? d.productId ?? null, version: d.version + 1, updatedAt: timestamp() };
      db.contentDrafts.set(d.draftId, next);
      return { status: 200, body: viewContent(next) };
    });
  }),
  http.post(`${API_BASE}/content-drafts/:id/images`, async ({ request, params }) => {
    const form = await request.formData();
    return idempotent(request, async () => {
      const d = db.contentDrafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(422, 'DRAFT_NOT_EDITABLE');
      const file = form.get('file');
      const roleField = form.get('role');
      const role = typeof roleField === 'string' ? roleField : '';
      const sortOrder = Number(form.get('sortOrder') ?? 0);
      // 테스트(Node fetch/msw)에서는 파일이 다른 Blob 구현으로 올 수 있어 instanceof 대신 모양으로 본다.
      const isFile = (x: unknown): x is Blob => typeof x === 'object' && x !== null && typeof (x as Blob).arrayBuffer === 'function';
      if (!isFile(file) || !['MAIN', 'DESCRIPTION', 'DETAIL'].includes(role) || (role === 'MAIN' && sortOrder !== 0)) {
        return problem(422, 'IMAGE_INVALID');
      }
      const imageId = nextId('img');
      db.images.set(imageId, { bytes: await file.arrayBuffer(), contentType: file.type || 'image/png' });
      const image = { imageId, role: role as 'MAIN' | 'DESCRIPTION' | 'DETAIL', sortOrder, url: `/api/v1/content-images/${imageId}`, contentType: file.type, width: null, height: null, bytes: file.size, sha256: imageId };
      const images = [...(d.images ?? []).filter((i) => !(i.role === image.role && i.sortOrder === sortOrder)), image];
      db.contentDrafts.set(d.draftId, { ...d, images, updatedAt: timestamp() });
      return { status: 201, body: image };
    });
  }),
  http.get(`${API_BASE}/content-images/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const img = db.images.get(String(params['id']));
    if (img) return new HttpResponse(img.bytes, { headers: { 'content-type': img.contentType } });
    // 목 사과 그림(상품 조회 썸네일 확인용) — 그 밖 img-seed 는 1px
    if (String(params['id']) === 'img-seed-apple') return new HttpResponse(APPLE_SVG, { headers: { 'content-type': 'image/svg+xml' } });
    return String(params['id']).startsWith('img-seed') ? new HttpResponse(PIXEL, { headers: { 'content-type': 'image/png' } }) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/content-drafts/:id/submissions`, ({ request, params }) =>
    idempotent(request, () => {
      const d = db.contentDrafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(422, 'DRAFT_NOT_EDITABLE');
      const problems = contentProblems(d);
      if (problems.some((p) => p.code === 'PRODUCT_NOT_LINKED')) return problem(422, 'PRODUCT_NOT_LINKED');
      if (problems.length > 0) return problem(422, 'DRAFT_INVALID', problems.map((p) => ({ field: p.field ?? '', reason: p.code })));
      const locked: ContentDraft = { ...d, state: 'SUBMITTED', draftHash: hash(d.input), submittable: false };
      db.contentDrafts.set(d.draftId, locked);
      return { status: 200, body: { submittedDraftIds: [d.draftId], excludedDraftIds: [], approvalRequest: contentApproval(`contentDraft:${d.draftId}`, [locked], `콘텐츠 게시: ${d.input?.name ?? d.draftId}`) } };
    }),
  ),
  http.post(`${API_BASE}/content-import-batches`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    return idempotent(request, () => {
      const batchId = nextId('cib');
      // 가장 최근 상품 일괄 배치의 원천 키로 연결(목). 없으면 연결되지 않은 초안.
      const lastBatch = [...db.importBatches.values()].at(-1);
      const keys = (lastBatch?.drafts ?? []).slice(0, 2).map((d) => d.sourceKey ?? '');
      const sources = keys.length > 0 ? keys : [`seed-${batchId}-1`];
      const items = sources.map((sourceKey, i) => {
        const draft = newContentDraft({ sourceSystem: 'bmart-capture', sourceKey, name: `상품 ${i + 1}`, description: '상세설명(OCR 초안, 검수 필요)', notices: ['원산지: 국산'] });
        const imageId = `img-seed-${batchId}-${i}`;
        const withImage: ContentDraft = { ...draft, images: [{ imageId, role: 'MAIN', sortOrder: 0, url: `/api/v1/content-images/${imageId}` }] };
        db.contentDrafts.set(draft.draftId, withImage);
        return { sourceKey, draftId: draft.draftId, outcome: 'CREATED' as const, draft: viewContent(withImage) };
      });
      const batch = { batchId, format: 'SEED_V1' as const, sourceSystem: 'bmart-capture', state: 'UPLOADED' as const, productCount: items.length, createdCount: items.length, updatedCount: 0, unchangedCount: 0, imageCount: items.length, uploadedImageCount: items.length, items, createdAt: timestamp() };
      db.contentBatches.set(batchId, batch);
      return { status: 201, body: batch };
    });
  }),
  http.get(`${API_BASE}/content-import-batches/:id`, ({ params }) => {
    const b = db.contentBatches.get(String(params['id']));
    if (!b) return problem(404, 'NOT_FOUND');
    const drafts = (b.items ?? []).flatMap((it) => (it.draftId && db.contentDrafts.get(it.draftId) ? [viewContent(db.contentDrafts.get(it.draftId) as ContentDraft)] : []));
    // BR-41 회신: 승인 대기(SUBMITTED) 동안 잠긴 행으로 제출 응답과 같은 본문을 다시 만든다.
    const locked = drafts.filter((d) => d.state === 'SUBMITTED');
    const pendingSubmission =
      b.state === 'SUBMITTED' && locked.length > 0
        ? {
            submittedDraftIds: locked.map((d) => d.draftId),
            excludedDraftIds: drafts.filter((d) => d.state !== 'SUBMITTED').map((d) => d.draftId),
            approvalRequest: contentApproval(`contentImportBatch:${b.batchId}`, locked, `콘텐츠 일괄 게시 ${locked.length}건`),
          }
        : undefined;
    return HttpResponse.json({
      ...b,
      items: (b.items ?? []).map((it) => {
        const d = it.draftId ? db.contentDrafts.get(it.draftId) : undefined;
        return d ? { ...it, draft: viewContent(d) } : it;
      }),
      ...(pendingSubmission ? { pendingSubmission } : {}),
    });
  }),
  http.post(`${API_BASE}/content-import-batches/:id/submissions`, ({ request, params }) =>
    idempotent(request, () => {
      const b = db.contentBatches.get(String(params['id']));
      if (!b) return problem(404, 'NOT_FOUND');
      const drafts = (b.items ?? []).flatMap((it) => (it.draftId && db.contentDrafts.get(it.draftId) ? [viewContent(db.contentDrafts.get(it.draftId) as ContentDraft)] : []));
      const ok = drafts.filter((d) => d.state === 'DRAFT' && d.submittable);
      if (ok.length === 0) return problem(422, 'NOTHING_TO_SUBMIT');
      const locked = ok.map((d) => {
        const l: ContentDraft = { ...d, state: 'SUBMITTED', draftHash: hash(d.input), submittable: false };
        db.contentDrafts.set(d.draftId, l);
        return l;
      });
      db.contentBatches.set(b.batchId, { ...b, state: 'SUBMITTED' });
      return {
        status: 200,
        body: {
          submittedDraftIds: locked.map((d) => d.draftId),
          excludedDraftIds: drafts.filter((d) => !ok.includes(d)).map((d) => d.draftId),
          approvalRequest: contentApproval(`contentImportBatch:${b.batchId}`, locked, `콘텐츠 일괄 게시 ${locked.length}건`),
        },
      };
    }),
  ),
];

/** 없는 카테고리만 더한 트리 초안(JSON 본문·zip 업로드 공통, 목 규칙). */
function addCategories(body: CategoryAdditionRequest) {
  const base = db.tree;
  const existing = new Map((base?.nodes ?? []).map((n) => [n.categoryId, n]));
  const byPath = new Map((base?.nodes ?? []).map((n) => [n.path ?? n.name, n.categoryId]));
  const levels = ['TOP', 'SUB', 'CHIP1', 'CHIP2'] as const;
  const added: CategoryNode[] = [];
  const skipped: string[] = [];
  for (const c of body.categories) {
    const ids = c.pmartCategoryIdLevels;
    if (!ids || ids.length === 0) {
      skipped.push(c.bmartPath.join(' > '));
      continue;
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const name = c.bmartPath[i] ?? id;
      const path = c.bmartPath.slice(0, i + 1).join(' > ');
      const known = existing.get(id);
      if (known) {
        if (known.name !== name) return problem(400, 'CATEGORY_CONFLICT');
        continue;
      }
      const other = byPath.get(path);
      if (other && other !== id) return problem(400, 'CATEGORY_CONFLICT');
      const node: CategoryNode = { categoryId: id, parentId: i === 0 ? null : ids[i - 1]!, level: levels[i] ?? 'CHIP2', name, path, sortOrder: 99, exposed: true };
      existing.set(id, node);
      byPath.set(path, id);
      added.push(node);
    }
  }
  if (added.length === 0) return problem(422, 'NOTHING_TO_ADD');
  const version = Math.max(base?.version ?? 0, ...db.treeVersions.keys()) + 1;
  const nodes = [...(base?.nodes ?? []), ...added];
  const v = {
    version,
    state: 'DRAFT' as const,
    nodeCount: nodes.length,
    filterGroupCount: Object.keys(base?.filters ?? {}).length,
    countsByLevel: {},
    approvalId: null,
    effectiveFrom: null,
    baseVersion: base?.version ?? null,
    addedCategoryIds: added.map((n) => n.categoryId),
    skippedPaths: skipped,
    approvalRequest: {
      type: 'PRODUCT' as const,
      targetService: 'product-service' as const,
      targetRef: `categoryTreeVersion:${version}`,
      allowedActions: ['APPLY_CATEGORY_TREE'],
      summary: `카테고리 추가 v${version} (+${added.length})`,
      lines: [{ lineKey: String(version) }],
    },
  };
  db.treeVersions.set(version, { ...v, nodes });
  return { status: 201, body: v };
}

/** zip 안에 들어 있다고 치는 seed-v1 categories(목). 냉동·간편식 > 만두 > 고기만두 세 단계가 새로 더해진다. */
const zipBundleCategories: CategoryAdditionRequest = {
  categories: [{ bmartPath: ['냉동·간편식', '만두', '고기만두'], pmartCategoryIdLevels: ['p09', 'p09-c01', 'p09-c01-l01'], pmartCategoryId: 'p09-c01-l01' }],
};
