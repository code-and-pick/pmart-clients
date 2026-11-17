// 목 모드 메모리 저장소. 응답 모양은 생성 타입(계약)을 따른다. 계약에 없는 필드는 넣지 않는다.
// 승인 결정 → 정본 반영은 실서버처럼 비동기로 보이도록 "다음 조회 때 반영 완료"로 흉내 낸다.
import type {
  ApprovalDetail,
  CategoryNode,
  CategoryTreeVersion,
  ChangeRequest,
  ContentDraft,
  ContentImportBatch,
  FilterGroup,
  ImportBatch,
  PriceImportBatch,
  PriceVersion,
  ProductDetail,
  ProductDraft,
  SkuHandling,
} from '../api/models';
import { mockAccounts } from './operators';

export interface StoredImage {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
}

/** 직원 권한의 효력은 employee-auth-service 가 정본이다 — 목 로그인이 토큰에 싣는 값 */
export interface MockGrant {
  readonly roles: readonly string[];
  readonly centers: readonly string[];
}

export interface MockSession {
  readonly sessionId: string;
  readonly operatorId: string;
  readonly deviceId: string;
  /** 지금 쓸 수 있는 refresh token 하나(회전) */
  refreshToken: string;
  /** 이미 쓴 refresh token(다시 오면 재사용 → 세션 폐기) */
  readonly used: Set<string>;
  revoked: boolean;
  readonly issuedAt: string;
}

export interface MockDb {
  seq: number;
  grants: Map<string, MockGrant>;
  sessions: Map<string, MockSession>;
  tree: { version: number; effectiveFrom: string; nodes: CategoryNode[]; filters: Record<string, FilterGroup[]> } | null;
  treeVersions: Map<number, CategoryTreeVersion & { nodes: CategoryNode[] }>;
  products: Map<string, ProductDetail>;
  productDrafts: Map<string, ProductDraft>;
  importBatches: Map<string, ImportBatch>;
  contentDrafts: Map<string, ContentDraft>;
  contentBatches: Map<string, ContentImportBatch>;
  images: Map<string, StoredImage>;
  changeRequests: Map<string, ChangeRequest>;
  approvals: Map<string, ApprovalDetail>;
  /** 결정 뒤 아직 "반영 확인 전"인 승인 */
  applying: Set<string>;
  /** 판매중지에 이미 쓴 승인 */
  usedApprovals: Set<string>;
  prices: Map<string, PriceVersion[]>;
  priceBatches: Map<string, PriceImportBatch>;
  handlings: Map<string, Map<string, SkuHandling>>;
  /** 멱등: method path key → 응답 */
  idempotent: Map<string, { status: number; body: unknown }>;
  commandResults: Map<string, unknown>;
}

const now = () => new Date().toISOString();

const seedNodes: CategoryNode[] = [
  { categoryId: 'p01', parentId: null, level: 'TOP', section: '맛있는것', name: '과일·채소', path: '과일·채소', sortOrder: 1, exposed: true },
  { categoryId: 'p01-c01', parentId: 'p01', level: 'SUB', name: '과일', path: '과일·채소 > 과일', sortOrder: 1, exposed: true },
  { categoryId: 'p01-c01-l01', parentId: 'p01-c01', level: 'CHIP1', name: '사과·배', path: '과일·채소 > 과일 > 사과·배', sortOrder: 1, exposed: true },
  { categoryId: 'p03', parentId: null, level: 'TOP', section: '맛있는것', name: '국·탕·찌개', path: '국·탕·찌개', sortOrder: 2, exposed: true },
  { categoryId: 'p03-c01', parentId: 'p03', level: 'SUB', name: '국·국밥', path: '국·탕·찌개 > 국·국밥', sortOrder: 1, exposed: true },
];

const sku = (n: number, productId: string, saleState: ProductDetail['saleState'] = 'ON_SALE') => ({
  sku: `E-${String(n).padStart(8, '0')}`,
  productId,
  baseProductId: `BP-${productId}`,
  unitType: 'E' as const,
  unitsPerSku: 1,
  weightG: 300,
  saleState: saleState ?? 'ON_SALE',
  alcohol: false,
  barcodes: [`88000000000${n}`],
  logistics: { storageType: 'CHILLED' as const },
  version: 1,
  publishedAt: '2026-10-29T01:00:00Z',
});

/** 게시된 콘텐츠 1건(사과). 콘텐츠 등록에서 상품을 고르면 이 값으로 자동 기입된다. 미역국은 게시된 콘텐츠 없음. */
function seedContentDrafts(): Map<string, ContentDraft> {
  const published: ContentDraft = {
    draftId: 'cd-seed-published-1',
    sourceSystem: null,
    sourceKey: null,
    productId: 'P-00000001',
    state: 'PUBLISHED',
    input: {
      productId: 'P-00000001',
      name: '사과 1.5kg',
      description: '아삭한 부사 사과',
      storageGuide: '냉장 보관',
      returnGuide: '신선식품은 받은 뒤 24시간 안에',
      notices: ['원산지: 국산', '품종: 부사'],
    },
    images: [],
    draftHash: null,
    approvalId: 'apv-seed-content-1',
    contentVersion: 1,
    version: 1,
    updatedAt: '2026-10-29T01:00:00Z',
  };
  return new Map([[published.draftId, published]]);
}

export function createDb(): MockDb {
  const products = new Map<string, ProductDetail>();
  for (const [i, name] of [
    [1, '사과 1.5kg'],
    [2, '소고기 미역국 500g'],
  ] as const) {
    const productId = `P-${String(i).padStart(8, '0')}`;
    products.set(productId, {
      productId,
      baseProductId: `BP-${productId}`,
      internalName: name,
      primaryCategoryId: i === 1 ? 'p01-c01-l01' : 'p03-c01',
      categoryIds: [i === 1 ? 'p01-c01-l01' : 'p03-c01'],
      saleState: 'ON_SALE',
      version: 1,
      skus: [sku(i, productId)],
      approvalId: `apv-seed-${i}`,
      publishedAt: '2026-10-29T01:00:00Z',
    });
  }

  const approvals = new Map<string, ApprovalDetail>();
  approvals.set('apv-seed-price-1', {
    approvalId: 'apv-seed-price-1',
    changeRequestId: 'cr-seed-price-1',
    type: 'PRICE',
    targetService: 'pricing-service',
    targetRef: 'PRICE-seed-1',
    summary: '기본가 변경 1건',
    requesterId: 'op-md-1',
    requestState: 'SUBMITTED',
    reviewState: 'REVIEW_PENDING',
    executionState: 'NOT_REQUESTED',
    deliveryState: 'PENDING',
    caseId: null,
    submittedAt: '2026-10-30T01:00:00Z',
    expiresAt: null,
    version: 0,
    approvalVersion: 1,
    allowedActions: ['APPLY_PRICE_VERSION'],
    lines: [{ lineKey: 'E-00000002', requestedAmount: 3900, attributes: { sku: 'E-00000002', basePrice: 3900 } }],
    decisions: [],
    receipts: [],
  });

  // 직원 권한 요청(GRANT): 인사팀 백오피스의 직원 등록이 계정 발급 뒤 자동으로 올린다(백엔드 handoff 2026-11-13).
  approvals.set('apv-seed-grant-1', {
    approvalId: 'apv-seed-grant-1',
    changeRequestId: 'cr-seed-grant-1',
    type: 'GRANT',
    targetService: 'employee-auth-service',
    targetRef: 'OP-seed-new-1',
    summary: '직원 권한 요청 P2026-00014 hong@pmart.com (hr-service GR-seed-1)',
    requesterId: 'OP-seed-hr-1',
    requestState: 'SUBMITTED',
    reviewState: 'REVIEW_PENDING',
    executionState: 'NOT_REQUESTED',
    deliveryState: 'PENDING',
    caseId: null,
    submittedAt: '2026-11-13T01:00:00Z',
    expiresAt: null,
    version: 0,
    approvalVersion: 1,
    allowedActions: [],
    lines: [
      {
        lineKey: 'MD',
        attributes: {
          role: 'MD',
          centers: [],
          validFrom: '2026-11-13',
          reason: '상품팀 배치',
          employee: { operatorId: 'OP-seed-new-1', employeeNo: 'P2026-00014', mailAddress: 'hong@pmart.com', affiliation: { type: 'HQ_DEPARTMENT', code: 'HQ' } },
        },
      },
    ],
    decisions: [],
    receipts: [],
  });

  // 관리자 본인(op-admin-1)에게 권한을 주는 요청 — 자기 권한 요청 승인 금지(approval-service 2026-11-17)
  approvals.set('apv-seed-grant-self', {
    ...approvals.get('apv-seed-grant-1')!,
    approvalId: 'apv-seed-grant-self',
    changeRequestId: 'cr-seed-grant-self',
    targetRef: 'op-admin-1',
    summary: '직원 권한 요청 관리자 본인 (hr-service GR-seed-2)',
    lines: [{ lineKey: 'MD', attributes: { role: 'MD', centers: [], validFrom: '2026-11-17', reason: '겸직', employee: { operatorId: 'op-admin-1', employeeNo: 'P2026-00001', mailAddress: 'admin@pmart.com', affiliation: { type: 'HQ_DEPARTMENT', code: 'HQ' } } } }],
  });

  return {
    seq: 100,
    grants: new Map<string, MockGrant>(mockAccounts.map((a) => [a.operatorId, { roles: [...a.roles], centers: [...a.centers] }])),
    sessions: new Map(),
    tree: {
      version: 1,
      effectiveFrom: '2026-10-29T00:00:00Z',
      nodes: seedNodes,
      filters: {
        'p01-c01': [{ filterGroupId: 'origin', name: '원산지', selectionMode: 'MULTIPLE', common: false, options: ['국산', '수입'] }],
      },
    },
    treeVersions: new Map(),
    products,
    productDrafts: new Map(),
    importBatches: new Map(),
    contentDrafts: seedContentDrafts(),
    contentBatches: new Map(),
    images: new Map(),
    changeRequests: new Map(),
    approvals,
    applying: new Set(),
    usedApprovals: new Set(),
    prices: new Map([
      [
        'E-00000001',
        [
          {
            sku: 'E-00000001',
            priceVersion: 1,
            basePrice: 4500,
            effectiveFrom: '2026-10-29T00:00:00+09:00',
            effectiveTo: null,
            approvalId: 'apv-seed-price-0',
            state: 'EFFECTIVE',
          },
        ],
      ],
    ]),
    priceBatches: new Map(),
    handlings: new Map(),
    idempotent: new Map(),
    commandResults: new Map(),
  };
}

export let db: MockDb = createDb();

/** 테스트마다 초기 상태로 */
export function resetDb(): void {
  db = createDb();
}

export const nextId = (prefix: string) => `${prefix}-${++db.seq}`;
export const timestamp = now;
