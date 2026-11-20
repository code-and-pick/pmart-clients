# 홈 진열 편성·검색 동의어 화면 — 만든 것과 질문 2개

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: platform (storefront-service·search-service·approval-service)

- 근거: pmart-backend `docs/handoff/clients/backoffice/2026-11-20-request-home-banners-themes.md`·`2026-11-20-request-search-synonym-screen.md`
- 브랜치 `backoffice/display-synonym-inbox` (PR 번호는 PR 에 적는다). 목 모드로만 확인했다(LAN 실서버 미확인).

## 만든 것
1. **홈 진열 편성** `/display/home` (상품 관리 묶음, MD·OPERATOR_ADMIN)
   - 목록: `GET /storefront/layout-drafts?state=` + `currentLayoutVersion`. "지금 홈 고치기" = `POST …?fromCurrent=true`, "빈 편성으로 시작" = 빈 본문.
   - 편성 화면: 배너(그림 올리기 `POST /storefront/banner-images` → 미리보기는 운영자 토큰 blob, 자리·설명·누르면 갈 곳 SECTION/PRODUCT/CATEGORY/NONE·기간·순서), 상품 테마(종류·제목·부제·상품 순서·기간), 메모, 미리보기.
   - "저장하고 승인 요청" 한 번 = `PUT`(X-Expected-Version) → `POST …/submissions` → 받은 `approvalRequest` 그대로 approval `POST /change-requests` → `/submissions`. 승인 요청만 실패하면 그 단계만 다시 올리는 상자.
   - 422 `LAYOUT_INVALID` details 는 field(`themes[0].title` 등)로 그 칸 바로 아래에, `PRODUCT_NOT_PUBLISHED` 는 그 상품 줄에 보인다.
   - 배너·테마 ID 는 화면이 만든다(`B-xxxxxxxx`·`T-xxxxxxxx`, 화면에는 안 보임). 테마를 빼면 그 테마로 가던 배너는 NONE 으로.
2. **검색 동의어** `/search/synonyms` (MD·OPERATOR_ADMIN)
   - `GET /search/synonym-rules` → 화면에서 고치기·지우기·새 묶음 모으기 → approval `SEARCH_SYNONYM` 한 번(`targetRef` `pmart-product-synonyms`, `targetExpectedVersion` = 본 version, 행 UPSERT·DELETE, 고친 행에는 `attributes.before`).
   - 열린 동의어 승인이 있으면(approval `GET /approvals?type=SEARCH_SYNONYM&reviewState=REVIEW_PENDING`) "승인 대기 중" + 요청 단추 끔.
   - 반영 기록 `GET /search/synonym-rule-applications` — STALE_VERSION·LINE_REJECTED(lineReasons) 까닭을 말로.
   - "결과 없는 검색어" 줄마다 "동의어 만들기" → 그 검색어가 첫 낱말인 새 묶음. 새 규칙 ID 는 `syn-<10자 난수>`.
3. 승인함: 종류 이름 `SEARCH_SYNONYM` = "검색 동의어". 승인 상세에서 동의어 행은 규칙 ID 대신 "추가/고침/삭제 + 낱말", 진열 편성 행은 "편성 내용 보기" 링크.

## 질문
1. **전시 승인자가 편성 내용을 볼 수 없다** — `GET /storefront/layout-drafts/{draftId}` 는 MD·OPERATOR_ADMIN 만(그 밖 403)인데, 승인하는 `DISPLAY_APPROVER` 는 승인 상세에서 요약 문장 말고는 무엇을 승인하는지 볼 길이 없다(행 attributes 는 draftHash 뿐). 둘 중 하나를 부탁한다: ① 초안 조회에 `DISPLAY_APPROVER` 읽기 허용, 또는 ② approvalRequest 행 attributes 에 배너·테마 요약(제목·자리·상품 수·기간)을 실어 주기. 정해지기 전까지 승인 상세의 "편성 내용 보기"는 승인자에게 403 이 난다.
2. **`SEARCH_SYNONYM` 의 `allowedActions` 값** — 계약(ChangeRequestBody 필수 1개 이상)에 정해진 값이 없어 approval-service 시험 코드(ApprovalFlowIT)의 `APPLY_SYNONYM_RULES` 를 보낸다. 다른 값이어야 하면 알려 달라.
