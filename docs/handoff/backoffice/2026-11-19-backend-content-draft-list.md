# 콘텐츠 초안 목록 조회 요청 (백오피스 콘텐츠 조회)

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: platform (product-content-service) — 담당이 다르면 알려 달라

- 근거: 사용자 2026-11-19 "콘텐츠 조회 기능이 추가됐으면".
- 백오피스에 "콘텐츠 조회" 화면(`/contents`)을 만들었다. 지금 계약으로 보이는 것은 **게시된 콘텐츠**뿐이다:
  - 상품 목록 `GET /products` 에 `GET /product-contents?productIds=`(카드)와 `GET /product-contents/{productId}`(전체)를 붙여 보인다.
- **작성 중·승인 대기·반려된 초안은 볼 길이 없다**. `/content-drafts` 는 만들기(POST)와 한 건 조회(`/content-drafts/{draftId}`)만 있다.
  - 그래서 초안 ID 를 알아야만 열 수 있다. 화면에는 "초안 ID로 열기"만 있다.

## 요청

### CD-1 `GET /content-drafts` — 초안 목록

- 거르기(모두 선택):
  - `state`: 초안 상태. 지금 쓰는 값 그대로(DRAFT·SUBMITTED·…), 여럿이면 쉼표.
  - `productId`: 한 상품의 초안만.
  - `cursor`·`size`: 다른 목록과 같은 쪽 방식.
- 줄: `draftId`·`productId`·`state`·`name`(고객용 상품명)·대표 이미지(있으면 `imageId`)·`approvalId`(있으면)·`updatedAt`·`version`.
- 순서: 최근 바뀐 것 먼저.
- 권한: 콘텐츠를 만들 수 있는 역할(지금 POST 와 같게).

### CD-2 (선택) 상태별 개수

- 같은 거르기(상태 빼고)로 상태별 수. 목록 상태별 개수 요청(`backoffice/2026-11-19-backend-list-status-counts.md`)과 같은 모양이면 좋겠다.

## 받으면 화면

- 콘텐츠 조회에 "작성 중·승인 대기·반려" 카드와 초안 줄을 더한다. 줄을 누르면 초안 화면(`/contents/drafts/{id}`)으로 간다.
- 그 전까지는 게시된 콘텐츠만 보이고, 안내 상자에 그렇게 적어 둔다(추측해 부르지 않는다).
