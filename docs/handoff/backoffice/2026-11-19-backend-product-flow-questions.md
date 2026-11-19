# 질문 — 상품 등록 한 흐름·"등록 진행 중" 탭에 필요한 것

보낸 앱: backoffice
받는 백엔드 영역: platform(product-service·product-content-service)
- 작성: pmart-clients PC 2, 2026-11-19
- 근거: 백엔드 백오피스 세션의 "상품 묶음 합치기" 제안. 사용자 결정: 조회부터(PR #242) → 메뉴 정리(5개, 일괄 등록 한 메뉴 — PR 이 글과 같이) → 아래 답이 오면 등록 한 흐름·등록 진행 중 탭.

## Q1. 개별 등록에서 원천 키(sourceSystem·sourceKey)로 상품 초안과 콘텐츠 초안을 미리 이어도 되나요?
- 등록 한 흐름은 "상품 정보 → 고객 화면(사진·설명) → 가격 → 제출"입니다. 상품이 승인되기 전(productId 없음)에 콘텐츠 초안을 만들어 두려면, 두 초안에 같은 원천 키를 넣어야 합니다.
  - product-content-service: `productId` 를 생략하면 같은 원천 키로 나온 ProductVersionPublished.sources 를 받을 때 이어진다.
- 그런데 두 계약 모두 sourceSystem 설명이 "**개별 입력은 생략**"입니다.
- 질문:
  - 화면이 `sourceSystem = backoffice-manual`(같은 이름이 좋을지도 알려 주세요), `sourceKey = <화면이 만든 UUID>` 로 넣어도 되나요?
  - 같은 키로 다시 보내면 열린 초안을 갱신(upsert)하니, 재시도에 같은 키를 쓰면 되나요?
- 안 된다면: 등록 흐름은 "상품 제출 → 승인 → 그 뒤 콘텐츠·가격"(지금과 같음)으로 두고, 화면은 순서 안내만 합니다.

## Q2. 상품 초안 목록 API 가 필요합니다
- "등록 진행 중" 탭에서 작성 중·제출됨·검토 중인 초안을 한곳에 보이려 합니다.
- 지금 `GET /product-drafts/{draftId}` 한 건뿐이라 목록이 없습니다(콘텐츠 초안 목록은 2026-11-19-backend-content-draft-list.md 로 이미 요청).
- 바라는 모양(콘텐츠 초안 목록과 같게):
  - `GET /product-drafts?state=DRAFT,SUBMITTED&mine=true&cursor=&size=`
  - 줄: draftId·internalName·state·validation 요약(오류 수)·updatedAt·approvalId(있으면)·targetProductId(수정 초안이면)
  - 정렬 updatedAt 최근 순, 커서.
- 그 전에는 탭을 만들지 않습니다(이 브라우저에서 만든 것만 기억하는 식으로 흉내 내지 않습니다).

## 지금 바뀐 것(참고)
- 상품 관리 메뉴 9개 → 5개: 상품 조회·상품 등록·일괄 등록(상품·콘텐츠·가격 탭)·카테고리 트리·센터 취급.
- 콘텐츠 등록은 상품 상세 "고객 화면" 탭과 상품 등록에서, 가격은 상품 목록 위 "가격 관리"와 상세 "가격" 탭에서. 옛 주소는 그대로 열립니다.
