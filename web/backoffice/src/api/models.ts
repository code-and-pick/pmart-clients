// 화면이 쓰는 모델. 생성 타입에서만 뽑고(필드를 손으로 만들지 않는다), 화면은 이 파일만 참조한다.
// 계약이 바뀌면 이 파일에서 컴파일 오류로 먼저 드러난다.
import type { components as Approval } from './generated/approval';
import type { components as MfcInventory } from './generated/mfc-inventory';
import type { components as Pricing } from './generated/pricing';
import type { components as Product } from './generated/product';
import type { components as Content } from './generated/product-content';
import type { components as PromotionC } from './generated/promotion';

type A = Approval['schemas'];
type P = Product['schemas'];
type C = Content['schemas'];
type Pr = Pricing['schemas'];
type H = MfcInventory['schemas'];

// 승인
export type ApprovalType = A['ApprovalType'];
export type ReviewState = A['ReviewState'];
export type ExecutionState = A['ExecutionState'];
export type ApprovalSummary = A['ApprovalSummary'];
export type ApprovalDetail = A['Approval'];
export type ApprovalLine = A['ApprovalLine'];
export type ChangeRequestBody = A['ChangeRequestBody'];
export type ChangeRequest = A['ChangeRequest'];
export type Decision = A['Decision'];
/** 목록 필터에 내놓는 유형. GRANT = 직원 권한 요청(hr-service 등록 → 자동 제출, 백엔드 handoff 2026-11-13) */
export const APPROVAL_TYPES = ['PRODUCT', 'DISPLAY', 'PRICE', 'GRANT', 'SEARCH_SYNONYM', 'PROMOTION'] as const satisfies readonly ApprovalType[];
export const REVIEW_STATES = [
  'REVIEW_PENDING',
  'EVIDENCE_REQUIRED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
] as const satisfies readonly ReviewState[];
/** 백엔드가 지금 지원하는 결정(2026-10-30 handoff §3). 나머지는 UNSUPPORTED_ACTION 이라 버튼을 만들지 않는다. */
export type SupportedDecision = Extract<A['DecisionRequest']['decision'], 'APPROVE' | 'REJECT'>;

// 상품
export type SaleState = P['SaleState'];
export const SALE_STATES = ['ON_SALE', 'TEMPORARILY_SOLD_OUT', 'SALE_STOPPED'] as const satisfies readonly SaleState[];
export type SaleUnitType = P['SaleUnitType'];
export type StorageType = NonNullable<P['LogisticsSpec']['storageType']>;
export const STORAGE_TYPES = ['AMBIENT', 'CHILLED', 'FROZEN'] as const satisfies readonly StorageType[];
export type ProductSummary = P['ProductSummary'];
export type ProductDetail = P['Product'];
export type SkuDetail = P['SkuDetail'];
export type CategoryNode = P['CategoryNode'];
export type FilterGroup = P['FilterGroup'];
export type CategoryTreeDraftRequest = P['CategoryTreeDraftRequest'];
export type CategoryTreeVersion = P['CategoryTreeVersion'];
/** seed-v1 묶음의 categories.json 본문(없는 노드만 더하는 트리 초안, `POST /category-tree-additions`) */
export type CategoryAdditionRequest = P['CategoryAdditionRequest'];
export type ProductDraftInput = P['ProductDraftInput'];
export type ProductDraft = P['ProductDraft'];
export type ImportBatch = P['ImportBatch'];
export type SubmissionResult = P['SubmissionResult'];
export type IdMap = P['IdMap'];

// 콘텐츠
export type ImageRole = C['ImageRole'];
export const IMAGE_ROLES = ['MAIN', 'DESCRIPTION', 'DETAIL'] as const satisfies readonly ImageRole[];
export type ContentDraftInput = C['ContentDraftInput'];
export type ContentDraft = C['ContentDraft'];
export type ContentDraftSummary = C['ContentDraftSummary'];

// 행사·쿠폰(promotion 0.2.0, ADR-0082)
type PR = PromotionC['schemas'];
export type Promotion = PR['Promotion'];
export type PromotionInput = PR['PromotionInput'];
export type PromotionKind = PR['PromotionKind'];
export type PromotionState = PR['PromotionState'];
export type PromotionPhase = PR['PromotionPhase'];
export type PromotionTarget = PR['PromotionTarget'];
export type CouponPolicy = PR['CouponPolicy'];
export type QuantityOffer = PR['QuantityOffer'];
/** 0.5.0 QUANTITY_OFFER 수량 행사 1+1·2+1(ADR-0090) */
export const PROMOTION_KINDS = ['PRICE_DISCOUNT', 'COUPON', 'QUANTITY_OFFER'] as const satisfies readonly PromotionKind[];
export const PROMOTION_STATES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ENDED'] as const satisfies readonly PromotionState[];
export const ISSUE_MODES = ['DOWNLOAD', 'ADMIN', 'SIGNUP'] as const satisfies readonly CouponPolicy['issueMode'][];
export type ContentImage = C['ContentImage'];
export type ContentImportBatch = C['ContentImportBatch'];
export type ContentSubmissionResult = C['ContentSubmissionResult'];
export type ProductContent = C['ProductContent'];

// 가격
export type Price = Pr['Price'];
export type PriceVersion = Pr['PriceVersion'];
/** 가격 일괄 등록(백엔드 안내 2026-11-03): seed-v1 zip → 행(묶음 가격 미리 채움) → 고치기·빼기 → 제출 → PRICE 승인 한 건 */
export type PriceImportBatch = Pr['PriceImportBatch'];
export type PriceImportLine = Pr['PriceImportLine'];
export type PriceImportLineUpdate = Pr['PriceImportLineUpdate'];
export type PriceImportSubmissionResult = Pr['PriceImportSubmissionResult'];
export type PriceImportBatchState = PriceImportBatch['state'];
export type PriceImportLineStatus = PriceImportLine['status'];
export type PriceChangeType = NonNullable<PriceImportLine['changeType']>;

// 센터 취급 (MFC·CDC 같은 모양. CDC 의 logistics 는 화면에서 쓰지 않는다)
export type SkuHandling = H['SkuHandling'];
export type SkuHandlingPage = H['SkuHandlingPage'];
export type SkuHandlingResult = H['SkuHandlingResult'];
export type SkuHandlingBatchResult = H['SkuHandlingBatchResult'];

/** 정본 서비스의 "제출 준비" 응답이 돌려주는 승인 요청 본문(그대로 POST /change-requests). */
export type ApprovalRequestBody = P['ApprovalRequestBody'] | C['ContentApprovalRequestBody'] | Pr['PriceApprovalRequestBody'] | ChangeRequestBody;
