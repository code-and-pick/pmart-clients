// "같은 기초상품으로 하나 더 만들기"(2026-11-18 사용자 결정 — 옵션 조합 SKU 생성기 대신).
// PMart 의 옵션 = 같은 기초상품의 다른 판매 단위(E- 낱개 / B- 밀봉 묶음)다. SKU 는 본사가 하나씩 승인·발급하고,
// 구매 상한(구성 낱개 합산 10개)은 기초상품 단위로 센다(overview §4, OMS 업무 §151). 계약도 초안 하나에 SKU 1개(product-service ProductDraftInput).
// 그래서 조합을 펼치지 않고, 기존 상품의 기초상품(baseProductId)에 붙는 새 상품 초안을 연다.
// - 복사: 기초상품 ID·관리용 명칭(고쳐 쓰라고)·카테고리·보관 온도·주류 여부·소비기한 기준 — 판매 단위가 달라도 같은 기초상품이면 같은 값
// - 비움: 판매 단위·구성 낱개 수·중량·용량·바코드·치수·물류 — 판매 단위마다 다른 실물 값(추측해 채우지 않는다)
import type { ProductDetail, ProductDraftInput } from '../../api/models';

export function sameBaseInput(p: ProductDetail): ProductDraftInput {
  const first = p.skus?.[0];
  return {
    product: {
      ...(p.baseProductId ? { baseProductId: p.baseProductId } : {}),
      internalName: p.internalName ?? '',
      ...(p.primaryCategoryId ? { primaryCategoryId: p.primaryCategoryId } : {}),
      ...((p.categoryIds?.length ?? 0) > 0 ? { categoryIds: p.categoryIds } : {}),
    },
    skus: [
      {
        unitType: 'E',
        unitsPerSku: 1,
        ...(first?.logistics?.storageType ? { storageType: first.logistics.storageType } : {}),
        alcohol: first?.alcohol ?? false,
        ...(first?.shelfLifeGuarantee ? { shelfLifeGuarantee: first.shelfLifeGuarantee } : {}),
      },
    ],
  };
}
