# 관리자 웹 (web/backoffice, React SPA)

담당: **PC 2**(backoffice 영역, 2026-11-16 PC 1 에서 넘김 — 인계서 `docs/operations/backoffice-handover.md`). 로그인·세션·토큰 코드는 PC 1 만 고친다(`docs/operations/pc-split.md` §1).

근거: `../pmart-backend/docs/business/BackOffice-business-logic.md`(BO, v2.0 **제안**, BO-01~BO-28), ADR-0004, 계약 `backoffice-bff`(base `/api/v1/backoffice`), `approval-service`, `case-service`, `center-master-service`, `audit-service`, `auth-service`.
BO §7(≈L1492-1510)의 화면은 "업무 동선 제안"이다. 화면을 BO 번호마다 하나씩 만들지 않고 동선별로 묶는다.

## 1. 원칙 (모든 화면)
- **BackOffice는 거래 정본을 소유하지 않는다.** 화면은 원천 상태를 그대로 보여주고, 변경은 명령을 요청할 뿐이다.
- 금지 기능(BO §1.2 L92-101): 주문 상태 직접 변경, 재고 덮어쓰기, 강제 성공, 근거 없는 검증 생략, 임의 ADJ, 승인 없는 주소 변경·할인·보상, 재고/PG/배송완료 CSV 덮어쓰기. **버튼 자체를 만들지 않는다**(서버는 422 `UNSUPPORTED_ACTION`).
- 원천별 기준시각·신선도: `ComposedView{sources[], unavailableSources[], composedAt}`, `SourceStamp` 확인 등급 `DIRECT/COPY/UNKNOWN`, `AsOf.freshness` `CURRENT/STALE/UNAVAILABLE`. 값이 없으면 "미제공".
- 조회 실패·합산으로 숫자를 만들지 않음. 기준시각이 다른 `StampedQty` 끼리 합산 금지. 비율은 분자/분모 함께, 분모 0이면 N/A.
- 명령: bff `POST /commands/{targetService}/{command}`(본문 `{targetRef, reason, payload}`) → `CommandResponse`. ACCEPTED는 접수일 뿐. `UNKNOWN_RESULT` 는 `GET /commands/{targetService}/{command}/{requestId}` 로만 해소.
- 행위마다 권한 재검사(로그인·목록·상세·증빙 다운로드·개인정보 열람·제출·승인·실행·재처리·내보내기). 버튼 숨김은 편의일 뿐. 자기승인은 서버가 `FORBIDDEN`.
- 개인정보는 목록 기본 마스킹, 원문 열람은 목적·사건·사유 입력 후(BO-25). 다운로드는 받는 시점에 현재 권한 재검사.
- 승인 5축(요청/심사/실행/전달/사건)을 한 상태로 합치지 않는다. 문구: 심사 완료 / 실행 완료 / 전달 완료 / 이관 완료 / 사건 해결(BO §13.3). 일부 반영은 "승인됨/일부 적용".
- 미설정 값은 "미설정/보류"로 표시(0·무제한·자동승인으로 대체 금지). 화면 잠금 ≠ 원장 잠금. 사건은 시간 경과로 자동 종결되지 않음.

## 2. 동선별 화면 (1차 우선순위 순)

| # | 동선 | BO | API | 1차 |
|---|---|---|---|---|
| 1 | 로그인·내 할 일 | BO-28 | 로그인 employee-auth-service(ADR-0056), `GET /employee-auth/sessions/current`, bff `/views/metrics`, `/views/case-inbox`, `/views/approval-inbox` | ✔ |
| 2 | 통합 조회·CS 접수 | BO-11 | bff `/views/unified-lookup`(q, kind), case `POST /cs-intakes` | ✔ |
| 3 | 통합 승인함·상세·결정 | BO-10 | bff `/views/approval-inbox`, approval `/approvals/{id}`, `/decisions`(APPROVE/PARTIALLY_APPROVE/REJECT/REQUEST_EVIDENCE), `/re-reviews`, `/receipts` | ✔ |
| 4 | 변경 요청 작성(상품·가격·전시·권역·센터) | BO-03~07 | approval `POST /change-requests`, `/submissions`, `/withdrawals`; 원천 조회 product/pricing/product-content/center-master | ✔ |
| 5 | 사건함·의무 | BO-22, 23, 27 | bff `/views/case-inbox`, case `/cases*`, `/obligations*`, `/action-requests`, `/shift-handovers` | ✔ |
| 6 | 실시간 배송·포장 인계 관제 | BO-20 | bff `/views/live-delivery`(mfcId), `/views/packing-handover`(mfcId), case `/help-requests` | ✔ |
| 7 | 취소·환불·반품 심사 | BO-12~14 | claim `/claims*`, `POST /claims/{id}/decisions`(운영자) | ✔ |
| 8 | MFC 관리자(작업 배정·운영 제한) | M WK-02/09/10, BO-08 | mfc-capacity `/assignment-plans`, `/operation-restrictions` | ✔ |
| 9 | 품질·재고 조정·손실 | BO-15~17 | approval 유형별 + mfc-quality | 일부 |
| 10 | 센터 기준정보·캘린더 | BO-06 | center-master `/centers*` | ✔(조회) |
| 11 | 정책 참조 | BO-09 | approval `/policy-references` | ✔(조회) |
| 12 | 권한·대행·긴급 | BO-01/02 | 사용자용 조회 없음(BR-10) | 대기 |
| 13 | 감사·개인정보 접근 | BO-25 | audit `/audit-entries*` | ✔ |
| 14 | 대량 변경 | BO-26 | approval `/batch-changes*` (업로드 → 미리보기 → 승인 → 행별 결과) | 2차 |
| 15 | SCM 공급·간선 관제 | BO-18/19 | bff `/views/replenishment-status`, `/views/trip-control` | 2단계 |
| 16 | 수행료·운송비 이의 | BO-21 | 없음 | 미정 |

역할 표: BO §3.1(L126-141). 담당 그룹: CS / MFC_OPS / DELIVERY_OPS / SCM / FINANCE / QUALITY / SECURITY.
권한 거절 사유(auth): NO_ROLE, OUT_OF_CENTER_SCOPE, DELEGATION_EXPIRED, DELEGATION_SCOPE_EXCEEDED, NOT_OWNER, SELF_APPROVAL, PRINCIPAL_RESTRICTED, SESSION_INVALID — 사용자 문구로 매핑.

## 2-1. 임시 백오피스: 상품·콘텐츠·가격·승인·센터 취급 (2026-10-30)
근거: `../pmart-backend/docs/handoff/2026-10-30-clients-notice-temp-backoffice-api.md`(기준 `86e156e`). 위 표의 #3·#4 를 bff 없이 원서비스 경로로 먼저 만든다.

| 메뉴 | 경로 | API |
|---|---|---|
| 로그인 | `/login`, `/auth/callback` | employee-auth-service — 게이트웨이 `GET /employee-auth/logins`(브라우저 이동, Keycloak 화면) → 복귀 `?ticket=` → `POST /employee-auth/tokens`(`X-Device-Id`). 이 앱은 비밀번호를 받지 않는다. 목 모드는 목 계정 버튼(목 티켓). auth-service 운영자 로그인은 2026-11-13 없어짐 |
| 내 세션 | `/session` | `GET /employee-auth/sessions/current`, `POST /employee-auth/logouts`(SSO). 비밀번호 변경 없음(Keycloak 이 관리) |
| 승인함·상세 | `/approvals`, `/approvals/:id` | approval `GET /approvals`, `GET /approvals/{id}`, `POST …/decisions`(APPROVE·REJECT 만) |
| 카테고리 트리 | `/categories` | product `GET /categories/tree`, `…/filters`, `POST /category-tree-versions`. 카테고리 추가는 `categories.json`(`POST /category-tree-additions`) 또는 seed-v1 zip(`POST /category-tree-addition-uploads`, multipart) — 결과·승인 흐름 동일(2026-11-03 회신) |
| 상품 등록 | `/products/drafts/new`, `/products/drafts/:id` | `/product-drafts*` → 제출 준비 → 승인 요청. 대표 카테고리는 노출 목록에 자동 포함(화면은 "대표" 배지로 맨 앞, 전송은 `primaryCategoryId` + 나머지 `categoryIds` — 서버가 대표를 맨 앞에 합친다) |
| 상품 일괄 | `/products/import`, `/products/import/:id` | `/product-import-batches*`, id-map 내려받기. 제출 뒤 "승인 요청 현황"(`BatchApprovals`, 상품·콘텐츠·가격 공통): `GET /approvals?targetRef=…ImportBatch:{batchId}` 로 승인 상세 링크·심사 상태, 아직 안 올렸으면 배치 조회의 `pendingSubmission.approvalRequest`(가격은 `approvalRequest`)로 "승인 요청" 버튼(BR-41 회신). 탭 저장소 없음. 유효·오류 수와 "유효 행 제출 준비" 활성은 응답 `drafts[]` 에서 직접 센다(서버 `validCount` 는 업로드 때 값, BR-38). 행 `registration` NEW/UPDATE 를 "구분"으로(UPDATE = 기존 상품의 새 버전, 상품 ID 링크·SKU 유지), UPDATE 가 있으면 제출 전 안내. 승인 상세도 행 attributes 로 같은 표시(BR-39 회신) |
| 상품 조회·판매 상태 | `/products`, `/products/:id` | `GET /products`, `/skus`, `/barcodes`, `POST …/sale-state-changes` + 짝 조회 |
| 콘텐츠 등록·일괄 | `/contents/drafts/*`, `/contents/import/*` | `/content-drafts*`, 이미지 업로드, `/content-import-batches*`. 행·승인 상세에 신규/기존 게시 갱신(`registration`, 갱신이면 지금 게시본 버전·시각 — BR-44, 서버 값만, null 이면 "-") |
| 가격 | `/prices?sku=` | `GET /prices/{sku}`(PRICE_NOT_SET = 미설정), `/price-versions/{sku}`, PRICE 변경 요청, `POST /price-version-applications` + 짝 조회 |
| 가격 일괄 등록 | `/prices/import`, `/prices/import/:id` | pricing `/price-import-batches*`(2026-11-03 안내): 같은 seed-v1 zip 업로드 → 서버가 묶음 가격으로 행을 채움(화면은 zip 을 풀지 않음) → 행 `PUT …/lines/{seedProductId}`(고치기·되돌리기·빼기, `X-Expected-Version`) · `POST …/refreshes`(다시 대조) → `POST …/submissions`(공통 효력 시각, 잠김) → 응답 `approvalRequest` 그대로 PRICE 승인 요청 한 건 → 승인 뒤 `GET` 으로 행별 `result`. 상품 일괄 등록 승인(SKU 발급) 뒤에만 가능 |
| 센터 취급 | `/handlings?type=&center=` | `/mfcs/{id}/sku-handlings`·`/cdcs/{id}/sku-handlings`, `…/sku-handling-batches` |

공통 흐름: 정본 "제출 준비" 응답의 `approvalRequest` → approval `POST /change-requests` → `…/submissions`(approvalId). 두 요청 키는 사용자 행위 키 하나에서 만든다(`{key}:cr`, `{key}:submit`). 판매중지·가격은 화면이 변경 요청 본문을 직접 만든다(handoff §4.3·§4.5).
승인 뒤 정본 반영은 비동기라 승인 상세에서 1초 간격·최대 30회 폴링하고, 끝나지 않으면 "아직 확인되지 않음 + 다시 확인"으로 둔다.
토큰: access 는 탭 메모리, refresh 는 이 탭의 sessionStorage(새로고침 복원용 — BR-03 전 임시, localStorage 금지). 401 → pmartFetch single-flight 로 `POST /employee-auth/tokens/refresh` 한 번(회전된 refresh 로 즉시 교체) → 원 요청 재전송. 갱신이 거절되면(`TOKEN_INVALID`·`TOKEN_REUSED` 등) 토큰을 지우고 로그인 화면(`/login?from=`). 갱신 결과 불명이면 같은 refresh 를 다시 보내지 않는다(재사용으로 세션이 끊김). `X-Device-Id` 는 탭마다 UUID(로그인 시작·티켓 교환·갱신이 같은 값).

직원 로그인(ADR-0056, 2026-11-12 · 2026-11-13 모든 모드로): employee-auth-service 하나 — `/login` 버튼 → 게이트웨이 `GET /employee-auth/logins`(브라우저 이동, Keycloak 화면) → `/auth/callback?ticket=` → `POST /employee-auth/tokens`. 갱신 `POST /employee-auth/tokens/refresh`, 로그아웃 `POST /employee-auth/logouts` → 200 `idpLogoutUri` 로 브라우저 이동(SSO — Keycloak 세션까지 끝내고 `/login` 으로 돌아옴). 백오피스는 Keycloak 주소를 갖지 않는다. 목 모드에는 Keycloak 이 없어 로그인 화면의 목 계정 버튼이 `mock.<운영자 ID>` 티켓으로 복귀 주소를 연다(티켓 교환부터는 같은 코드 — 인사팀 백오피스와 같은 방식, `src/mocks/authHandlers.ts`). auth-service 의 운영자 로그인·비밀번호 변경·운영자 계정 API 는 백엔드가 2026-11-13 없앴고(`clients-notice-auth-operator-login-removed`), 이 앱의 그 코드(아이디·비밀번호 로그인, 운영자 계정 화면)도 같은 날 지웠다 — 직원 등록·권한은 인사팀 백오피스.
실행 모드: `dev`(목) / `dev:local`(Vite 프록시 → localhost:8080 — 로컬에는 Keycloak 이 없어 화면 로그인은 안 된다, 직원 토큰은 백엔드 `dev-on-other-pcs.md` §1 의 dev-tokens) / `dev:lan`·`build:lan`(게이트웨이 `https://192.168.0.40:8443/api/v1` 직접, 브라우저는 `https://192.168.0.40` 으로 연다 — HTTP 80 은 2026-11-13 닫혀 HTTPS 로 넘어간다. 이름 `d603-16` 은 다른 PC 에서 IPv6 링크 로컬로 풀려 안 열림 — 2026-11-06). 빌드는 PC 4 에 직접 올리지 않고 백엔드가 `lan.sh publish-backoffice` 로 올린다.
막힌 것: 이미지 인증(BR-25), 초안 목록(BR-26), 센터 목록(center-master 다음 작업 → 센터 ID 입력).

## 2-2. 업무 도우미 (정책·업무 절차 질의응답, 2026-11-04, BR-46 / 계약 1.1.0 반영 2026-11-06)
- 경로 `/assistant`(질문·답변·내 질문 목록), `/assistant/answers/:answerId`(답변 다시 보기). 코드 `src/features/assistant/`.
- 읽기 전용. 주문·재고·환불·승인 변경 버튼, AI 자동 실행 없음. 메뉴는 모든 직원에게 보이고 권한은 서버 판정(403·404).
- 계약 `ai-assistant-service.yaml` 1.1.0(ADR-0036). 화면은 `AssistantPort` 뒤에 둔다. 목 모드는 `draftMock`(계약 모양, "목 답변" 표시), local·LAN 빌드는 `httpAssistant`(생성 타입 + pmartFetch)로 게이트웨이 `/api/v1/assistant/**` 를 부른다(2026-11-15 — 서비스는 2026-11-09 LAN 배포, 생성 답변). 실서버 확인은 아직 안 함. `GET ?requestId=` 는 쓰지 않는다 — 결과 불명·202 는 같은 키·같은 질문 POST 로 다시 확인한다(계약상 같은 답, 409 `INVALID_STATE` 때 하라는 것도 같은 POST). 생성 답변(`GENERATIVE`)에는 "근거 문서를 꼭 확인" 안내를 붙인다(백엔드 공지: 다른 주제를 근거로 답한 경우가 있었다).
- 질의 `POST /assistant/policy-questions`: 새 전송 = 새 Idempotency-Key. 결과 불명(타임아웃·503 `DEPENDENCY_UNAVAILABLE`·응답 유실)과 202 `PROCESSING` 은 같은 키·같은 질문으로만 재확인(계약: 같은 키 = 같은 답). 답을 받은 질문을 그대로 다시 보내지 않는다(질문을 고치거나 "새 질문"). 403·409·422 `CONFIG_REQUIRED` 는 거절로 확정.
- 표시: 답변·근거 본문은 일반 텍스트(HTML·마크다운 해석 없음). 기준선(`BASELINE_EXTRACTIVE`·`BASELINE_HASH`)이면 "품질 미검증" 안내. 인용은 지위(authority 6종)·생애(ACTIVE 외만 표시, 대체 문서·대체 제안)·구현 기록(날짜 기준, 현재 구현 보장 아님)을 따로, 저장소 상대 경로·절·문서 버전·기준일·색인 시점(스냅샷·revision·커밋 안 된 변경)·근거 본문(접기). 상대 경로가 아니면 가린다. 링크 없음(1차에 문서 열람 API 없음).
- 상태: `NO_GROUNDING`·`REALTIME_DATA_REQUIRED`·`OUT_OF_SCOPE`·`FORBIDDEN_SCOPE` 는 각자 안내(서버 안내 문장 함께) ≠ 오류. 상태 확인(health) 경로는 게이트웨이에 없어 응답 코드로만 구분.
- 내 질문 목록 `GET /assistant/question-history`(최근 순, 커서 "더 보기"). 질문 원문은 서버가 저장하지 않아 `answerPreview` 로 구분. 조회 실패는 오류로(빈 목록 아님). 질의 뒤 목록 다시 조회.
- 답변 다시 보기 `GET /assistant/policy-questions/{answerId}`: 202 처리 중이면 "다시 확인", 404·409 는 오류로.
- 계정 전환·로그아웃: 이전 계정의 `['assistant', owner]` 캐시 삭제, 화면 상태 새로 시작.

## 2-3. 고객센터 문의 답변 (2026-11-15, case-service 0.2.0)
- 경로 `/inquiries`(목록), `/inquiries/:inquiryId`(상세·답변). 코드 `src/features/inquiries/`. 역할 `CS_AGENT` 만(서버 403). 2026-11-15 부터 고객센터 묶음 안 "문의 답변"(§2-4). 문의 상세에서 "이 문의로 라이더 컴플레인 기록"(문의 ID·주문 ID 채움).
- 목록 `GET /inquiries?status=&cursor=`: 최근 접수 순, 상태 필터(전체·접수·답변 완료·종료)는 URL 쿼리, 커서 "더 보기". 조회 실패는 빈 목록이 아니라 오류로.
- 상세 `GET /inquiries/{inquiryId}`: 상태·종류·고객 ID·주문·들어온 곳(문의 페이지 / AI 상담에서 넘어옴)·사건 번호, 본문, 답변들. 본문·답변은 일반 텍스트.
- 답변 `POST /inquiries/{inquiryId}/replies`(본문 1~4000자, `X-Expected-Version` = 문의 `version`). 반영되면 `ANSWERED`. 결과 불명은 같은 키로만 재확인, 409 `VERSION_CONFLICT`·`INQUIRY_CLOSED` 는 안내 + 다시 읽기. 종료(CLOSED) 문의에는 답변 칸이 없다.
- 답변은 응대일 뿐 주문·환불을 바꾸지 않는다. 고객 알림은 없다(고객은 앱 "내 문의"에서 본다).
- 실서버 확인은 아직 안 함(목: `mocks/inquiryHandlers.ts`, 목 계정 "상담원 최").

## 2-4. 메뉴 묶음 · 고객센터 · 라이더 운영 (2026-11-15, 백엔드 요청 `backoffice/2026-11-15-clients-request-backoffice-cs-rider-menus.md`)
- **메뉴 묶음**(`src/app/nav.ts`): 상품 관리(`MD`·`OPERATOR_ADMIN` — 2026-11-15 사용자, 판매 상태 변경만 `MD`: 그 밖 역할은 버튼 대신 "MD 만 바꿀 수 있습니다") / 승인(`*_APPROVER`·`OPERATOR_ADMIN`) / 조회·현황(`CS_AGENT`·`RIDER_OPS`·`OPERATOR_ADMIN` — 주문 조회·통합 조회·실시간 배송 현황·배송·배차 확인·라이더 컴플레인) / 고객센터(`CS_AGENT`·`OPERATOR_ADMIN` — 문의 답변·클레임 조회) / 라이더 운영(`RIDER_OPS`·`OPERATOR_ADMIN` — 라이더 찾기·계정 제한·제한 검토) / 업무 도우미(모든 직원). 세션 응답(`sessions/current` 0.6.0) 역할의 합집합, 하위 메뉴가 없으면 묶음도 숨김. 접고 펴는 `<details>` — 지금 화면의 묶음만 펼친 채 시작. 같은 화면은 한 묶음에만 — 두 역할이 함께 쓰는 조회는 조회·현황 묶음(2026-11-16 사용자: 두 역할 계정에서 같은 메뉴가 두 번 강조돼 보이던 것, 백엔드 알림 `handoff/backoffice/2026-11-16-backend-menu-shared-lookup-group.md`). 메뉴 숨김은 편의 — 주소로 열면 서버 403 이 오류로 보인다. 첫 화면은 역할 묶음의 첫 화면(상담원 = 주문 조회, 라이더 운영 = 라이더 찾기, 역할 묶음이 없으면 조회·현황, 그것도 없으면 내 세션). MFC 메뉴는 넣지 않는다(MFC 백오피스는 따로 앱, 2026-11-15 사용자 결정).
- **주문 조회** `/orders`, `/orders/:orderId` — order 0.3.0 `GET /orders/lookups`(조건은 URL 쿼리, 기본 기간 오늘까지 7일, 주문 ID·고객 ID 없으면 기간 31일 이하 — 보내기 전 안내, 연락처는 숫자만 완전 일치 9~11자리, `page`·`hasNext` 쪽 이동). 목록 연락처는 서버가 가린 값. 상세: 금액 구성·결제 번호·주문 상품·이행 확인 필요 기록·이 주문의 클레임(`GET /claims?orderId=`), 배송지는 서버가 가린 값 + 사유 입력 원문 열람(아래 "주문 상세 배송지 열람"), 이 주문의 배송(execution 0.4.0 `GET /deliveries?orderId=`). 취소 버튼 없음(ADR-0060).
- **라이더 컴플레인** `/rider-complaints`(목록 — 라이더·배송·종류·기간 필터, 커서), `/rider-complaints/new`(기록 — 배송 번호·종류 필수, 주문·문의·메모 선택, 쿼리로 미리 채움), `/rider-complaints/:id`(상세·메모). case 0.3.0. 라이더는 서버가 채운다(422 `RIDER_NOT_ASSIGNED`·`DELIVERY_NOT_FOUND`·`INQUIRY_NOT_FOUND` 안내). 결과 불명은 같은 키로 확인.
- **주문 상세 배송지 열람**(2026-11-16, order 0.4.0·0.5.0): 상세는 서버가 가린 값 그대로(이름 첫·끝 글자, 010-****-1234, 상세주소 `***`, 출입 메모·배송 요청사항은 "가림"). 원문은 "원문 열람" — 항목(이름·연락처·상세주소·출입 메모/요청사항) 고르고 사유 2~200자 → `POST /orders/lookups/{orderId}/pii-reveals`(열람 기록이 남은 뒤 고른 항목만 원문). 원문은 화면 메모리에만, "다시 가리기"·화면 이동으로 사라짐. 503·결과 불명은 원문 없이 같은 키 "결과 확인".
- **처리 대기** `/pending`(2026-11-16, `OPERATOR_ADMIN` 만) — bff 0.2.0 `GET /backoffice/views/pending-work`(멈춘 주문 처리 + 이행 확인 필요, 원천 표시·못 읽은 원천 경고). 버튼은 `allowedActions` 만: 결제 결과 다시 확인(`saga-requery`), 처리 완료(`saga-resolve`, 사유 필수·주문·재고 그대로 경고) — bff 명령 프록시 — 짝 조회 `GET …/commands/…/{requestId}` 는 아직 501 이라 부르지 않고, `ACCEPTED`·`UNKNOWN_RESULT`·시간 초과면 목록을 다시 읽어 "목록에서 확인"(결과 불명, 같은 키 재전송만, 2026-11-16 백엔드 회신 reply-case-inbox-questions §3), 확인(order-service acknowledgements). 422 `NOT_REQUERYABLE`·`NOT_RESOLVABLE` = 새로고침 안내. **MFC 중지 실패·인계 거절**(bff 0.4.0, 백엔드 알림 `notice-pending-work-mfc-retry`): `allowedActions: [RETRY]` → "다시 시도"(메모 필수) → bff `mfc-fulfillment-service/stop-retry`·`handover-retry`. APPLIED = 목록에서 빠짐, REJECTED = "다시 실패 — 원인 고친 뒤 다시", 그 밖은 위와 같이 목록 다시 읽기. 인계 거절은 "실물 확인 → 재고 정정 → 다시 시도" 안내. 처리 완료 버튼 없음. 메모는 MFC 에 아직 저장 안 됨 — "기록됨"이라 쓰지 않음. MFC 목록은 PC 3 API(F-4) 전까지 서버 설정으로 꺼짐 — `sources` 에 mfc-fulfillment-service 가 없으면 "아직 이 목록에 나오지 않아요(장애 아님)" 안내. LAN(2026-11-16, claude-dev): 0건 + 그 안내 확인, 재시도 명령은 대상이 없어 실서버로 보내 보지 않음.
- **지원센터 사건** `/cases`·`/cases/:caseId`·`/cases/new-misdelivery`(2026-11-16, `RIDER_OPS`·`OPERATOR_ADMIN`, `CS_AGENT` 보기 + 오배송 열기) — case 0.4.0. 탭 안 집은 것·내 것·기한 넘김·닫힌 것(URL), refs 링크, 기한 넘김 빨강, 요약이 없으면 종류 이름. 도움요청 사건은 `requestId`·`deliveryId` ref(case 0.4.1) 먼저, 없으면 `incidentId` 를 나눠 도움요청 단건. 내가 집기·관리자 배정(`assignments`), 닫기(`closures` 결과·요약 — 개인정보 금지 안내), 오배송 열기(`POST /cases` MISDELIVERY, 409 `CASE_ALREADY_OPEN`). **목록은 bff 0.5.0 `GET /backoffice/views/case-inbox`**(2026-11-16, 백엔드 요청 `request-case-inbox-linked-state`): "연결 상태" 열 — 연결 배송(수행 상태)·주문(주문 상태)을 원천 값 이름표로, `confidence UNKNOWN` → "확인 불가"(장애이거나 그 역할이 못 보는 원천 — 지원센터는 주문을 못 볼 수 있음), `state null`·DIRECT → "원천에 없음". `unavailableSources` 에 case-service 면 목록 조회 실패(빈 목록 아님). 50건씩 `page.nextCursor`(URL `cursor`). 집기·닫기·상세는 case 직접. LAN(claude-dev): 안 집은 것 1건(위치 끊김, 연결 배송 "전달 완료"), 원천 case·delivery-execution 최신.
- **클레임 조회** `/claims`, `/claims/:id` — claim 0.1.0 목록·상세·환불(`/refunds`). 결정 버튼 없음(서버 501). 환불은 서버 상태 그대로(PG 성공 전 "완료" 아님).
- **배송 확인** `/deliveries`(배송 번호로 열기 + 찾기: 주문 ID·라이더 ID·상태·오래된 순, "전달 실패 확정 대기" = `state=FAILURE_REPORTED&sort=OLDEST`, cursor 더 보기 — execution 0.4.0, 2026-11-16), `/deliveries/:id` — 배송 수행(execution `GET /deliveries/{id}`)과 배차(dispatch `GET …/dispatch` — 상담원도 조회)를 따로 읽고 따로 보인다(한쪽 403 이어도 다른 쪽은 보인다). `FAILURE_REPORTED` 면 전달 실패 확정·반려(`X-Expected-Version` = 수행 version, `APPLIED`/`ACCEPTED` 문구 구분), 배차 `ASSIGNED` 면 픽업 전 배차 취소(사유 4가지 — 운영자 판단은 승인 번호 필수, 다시 배차 기본 켬, 202 접수 → 짝 조회 `GET …/assignment-cancellations/{requestId}` 로 확정까지, 422 `PICKED_UP_CASE_REQUIRED` 안내). "이 배송으로 라이더 컴플레인 기록" 링크.
- **라이더 찾기·계정 제한** `/riders`, `/riders/:riderId` — rider 0.4.0(2026-11-16, BR-54 끝): 찾기 = 라이더 ID·전화(숫자 10~11자리) 완전 일치 + 제한·운행·수단·정렬, 쪽 이동(이름 검색 없음). 상세 = 가린 이름·전화 + 사유 입력 원문 열람(`POST /riders/{id}/pii-reveals`, 항목 이름·전화), 운행·배달 지역·배차 방식·제한·마지막 위치. 계정 제한 현재·이력·걸기/바꾸기/풀기(사유 필수·기한·증빙·승인 번호, `X-Expected-Version` = 상세의 라이더 version — BOD-6, RIDER_OPS 도), 이 라이더의 배송·열린 제한 검토·컴플레인.
- **제한 검토** `/riders/restriction-reviews` — 열림·제한함·기각 탭, 묶인 컴플레인, 열린 검토는 행마다 "제한함으로 닫기"·"기각"(메모), 닫으면 그 자리에서 결과 표시.
- **도움요청 대기**는 지원센터 사건함으로 옮겼다(2026-11-16, BR-55 끝) — `/delivery-help-requests` 는 `/cases?kind=RIDER_HELP` 로 넘기고, 라이더 도움요청 사건 상세에 도움요청 단건(`GET /deliveries/{id}/help-requests/{requestId}` — 라이더가 쓴 내용·사진 참조). 전달 실패 확정 대기는 배송 확인의 찾기.
- 권한(서버 판정, 지금 계약): 배차 조회는 `CS_AGENT`·`RIDER_OPS` 가, 계정 제한·제한 검토·배차 취소·실패 결정은 `RIDER_OPS` 가 PC 5 반영 뒤에 열린다 — 그 전에는 403 이 오류로 보인다(목도 같게 흉내).
- 개인정보: 주문 목록·상세는 서버가 가린 값, 원문은 사유를 적고 `pii-reveals`(2026-11-16 — 위 "주문 상세 배송지 열람"). 라이더 상세의 이름·연락처는 아직 `Masked`(화면 안 가림, "보기"). 검색 조건·연락처·주소·메모·열람 사유를 로그에 남기지 않는다.
- 목: `mocks/opsHandlers.ts`(주문 3·배송 4·클레임 2·컴플레인 2·라이더 2·검토 1), 목 계정 "라이더 운영 정"(`RIDER_OPS`)·"상담·라이더운영 한"(`CS_AGENT`+`RIDER_OPS`, LAN `test-cs-rider` 와 같은 역할). 실서버 확인은 아직 안 함.

## 2-5. 통합 조회 (BO-11, 2026-11-16, bff 0.3.0 — 백엔드 요청 `backoffice/2026-11-16-request-unified-lookup.md`, PR #25)
- 메뉴 "통합 조회" `/lookup` — 고객센터·라이더 운영 묶음의 **두 번째**(첫 화면 = 묶음 첫 메뉴는 그대로). OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정 — 그 밖 403 → 권한 없음 화면).
- `GET /backoffice/views/unified-lookup?q=&kind=` — 찾는 값·종류는 URL 쿼리. 종류 고르기는 번호로 알아서(ANY, 보내지 않음)·주문·배송·사건·고객(TRANSFER·TRIP 은 원천이 없어 고르기에 없음). 422 `UNSUPPORTED_LOOKUP`(전화번호 등)은 코드 문구, 5xx 는 오류(빈 결과 아님), 없는 대상은 "찾는 대상이 없어요".
- 결과: 원천 표시(`SourceStamps` — 기준 시각·신선도·조회 못 한 원천), "○로 찾음 → 주문 …", 주문 칸 위 + 배송(수행)·배차·클레임·고객 문의 칸 + 사건 칸(열린 것 / 닫힌 것 최근 20건, `state` 로만 나눔). **실패·권한 없음 원천은 그 칸에 "조회 실패 또는 볼 권한 없음"**(0건과 구분). 원천 이름 ↔ 칸: order-service·delivery-execution-service·delivery-dispatch-service·claim-service·case-service·case-service/inquiries — 계약 설명에 적힌 목록(PR #25 985a2ecd, 질문 handoff 답). 닫힌 사건은 백엔드 PR #26(case 0.5.1) 부터 닫힌 시각 최근 순 — 그 전 LAN 은 오래된 순(화면은 받은 순서대로).
- `summary` 는 원천 필드 이름 그대로 — 아는 이름만 한국어, 모르는 이름은 그대로, 시각(…At)은 서울 시각, 객체는 한 단계 펼침. 금액·상태를 계산하지 않는다. 개인정보는 오지 않는다(원문은 주문 상세 열람).
- 각 항목 "상세 보기": 주문 `/orders/{id}`·배송·배차 `/deliveries/{id}`·클레임 `/claims/{id}`·사건 `/cases/{id}`·문의 `/inquiries/{id}`. 고객 번호면 주문 목록만 → "이 주문으로 다시 조회"(q = 주문, kind ORDER).
- 계약 타입: bff 0.3.0 이 main 에 없어(PR #25) 그 브랜치 계약으로 로컬 생성(생성물은 커밋 안 함) — PR #25 병합 뒤 `gen:api` 로 다시, `contracts.lock` 은 PC 1. 목 `mocks/lookupHandlers.ts`.

## 2-6. 실시간 배송 현황 (2026-11-16, bff 0.3.0 — 백엔드 요청 `backoffice/2026-11-16-request-live-delivery.md`, PR #25, 배송 원문 §10.1)
- 메뉴 "실시간 배송 현황" `/live-delivery` — 고객센터·라이더 운영 묶음, 통합 조회 다음. OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정, 셋 다 모든 센터 — 그 밖 403 → 권한 없음 화면).
- `GET /backoffice/views/live-delivery?mfcId=&state=&size=50&cursor=` — 센터·상태·쪽은 URL 쿼리. 센터 고르기는 center-master `GET /centers?type=MFC`(못 읽으면 "모든 센터"만 + 안내). 상태 고르기는 진행 중 9개 중 하나(비우면 진행 중 전부).
- 상태를 비우면 오래된 순 50건, 쪽 넘김 없음 — `truncated` 면 "더 있어요 — 센터나 상태로 좁혀 주세요". 상태를 고르면 `page.nextCursor` 로 "다음 쪽"/"처음 쪽"(상태 없이 cursor 를 보내지 않는다).
- 표: 배송(→ 배송 상세)·주문(→ 주문 상세)·센터·종류·수행 상태·배차 상태·라이더(없으면 "미배정")·예정 시간대(arrivalWindow 받은 그대로) + "약속 지남"(promisedAt < 응답 composedAt — 화면 시계를 쓰지 않음)·열린 사건(종류·우선순위 → 사건 상세, overdue 면 "기한 넘김").
- 원천 실패: 배차 `state null` → "모름(조회 실패)", `openCases null` → "조회 실패"(0건과 구분), 원천 줄에 "조회하지 못한 원천". 5xx 는 오류(빈 목록 아님).
- 1분마다 자동 새로 고침(요청서 — 30초 이상 권장), 수동 "새로 고침". latestEta 는 아직 늘 null 이라 열 없음(안내 문구만). 개인정보 없음.
- 목 `mocks/liveDeliveryHandlers.ts`(진행 중 8·끝남 1, `mfcId=MFC-MOCK-DOWN` 이면 배차·사건 원천 실패).
- LAN 확인(2026-11-16 PC 2, `dev:lan` + 게이트웨이 CORS 개발 출처, test-cs-rider): 실시간 배송 1건(미배정·배차 실패·열린 사건 없음), 센터 목록 1곳. 통합 조회 — 주문 번호로 주문·배송(수행)·배차 칸, 원천 6개, 고객 번호로 주문 목록, 전화번호 422 문구 모두 정상. 그 자리에서 고친 것: "○로 찾음" 조사 → "○ 번호로 찾음", 금액 필드 원·천 단위, 실서버 필드 이름 한국어(결품 처리·봉투값·배달팁·시도 번호·실패 사유 등).
## 3. 기술 메모
- 개발: Vite 프록시 `/api → http://localhost:8080` (CORS 없음, BR-04). 목은 MSW.
- 모든 목록은 커서 페이지(`size`, `cursor`). 표·필터 상태는 URL 쿼리에 둔다(공유·새로고침 복원).
- 명령 버튼은 제출 중 비활성 + 같은 `Idempotency-Key` 재시도. `reason` 입력 필수 명령은 폼에서 강제.

## 4. `[결정 필요]`
BO-Q01(운영자 IAM·로그인·추가 인증), Q02(역할·범위), Q06(승인함↔원승인 연결), Q07(재심사·승인선), Q19(신선도 임계·SLA), Q20(개인정보 열람·다운로드·보존), Q21(대량 변경 상한·양식), Q22(지표 정의), Q03/Q04(상품·가격 실행 정본), Q05(권역 중첩). 카카오 지도 앱 키 발급·허용 도메인.
