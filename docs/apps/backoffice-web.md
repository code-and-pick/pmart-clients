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

직원 로그인(ADR-0056, 2026-11-12 · 2026-11-13 모든 모드로): employee-auth-service 하나 — `/login` 버튼 → 게이트웨이 `GET /employee-auth/logins`(브라우저 이동, Keycloak 화면) → `/auth/callback?ticket=` → `POST /employee-auth/tokens`.
갱신 `POST /employee-auth/tokens/refresh`, 로그아웃 `POST /employee-auth/logouts` → 200 `idpLogoutUri` 로 브라우저 이동(SSO — Keycloak 세션까지 끝내고 `/login` 으로 돌아옴).
백오피스는 Keycloak 주소를 갖지 않는다.
목 모드에는 Keycloak 이 없어 로그인 화면의 목 계정 버튼이 `mock.<운영자 ID>` 티켓으로 복귀 주소를 연다(티켓 교환부터는 같은 코드 — 인사팀 백오피스와 같은 방식, `src/mocks/authHandlers.ts`).
auth-service 의 운영자 로그인·비밀번호 변경·운영자 계정 API 는 백엔드가 2026-11-13 없앴고(`clients-notice-auth-operator-login-removed`), 이 앱의 그 코드(아이디·비밀번호 로그인, 운영자 계정 화면)도 같은 날 지웠다 — 직원 등록·권한은 인사팀 백오피스.
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
- **상담원 접수 문의**(case 0.12.0): 목록·상세에 `origin: STAFF_INTAKE` 는 "상담원 접수 · 전화/채팅/메일", `callerRelation: PROXY` 는 "대리" 표시 + 상세 경고("본인 확인 전에는 취소·환불을 요청하지 마세요"). 고객 앱에 없는 문의라 답변 안내 문구가 다르다(알림 없음, 통화·채팅 기록용). 상세에 "이 문의로 고객 연락 남기기"·"이 문의의 연락 기록".
- **전화·채팅 접수** `/cs-intakes/new`(case 0.12.0, 백엔드 PR #68·요청서 `backoffice/2026-11-16-request-cs-intake` — `features/csIntakes/CsIntakePages.tsx`, 고객센터 묶음 "전화·채팅 접수", `CS_AGENT`·`OPERATOR_ADMIN`): 경로(전화·채팅·메일)·고객 계정 ID·주문(선택, 주문 상세 새 창)·본인 확인 방법(필수 — 주문 내용 대조는 주문 필요, 앱 로그인 채팅은 채팅만, 기타는 메모 필수, 화면도 막음)·본인/대리(대리면 노란 경고)·분류(라이더 일은 라이더 컴플레인으로 안내)·내용(개인정보 금지)·동의 기록(접어 둠, 기록만)·기존 건 연결(선택) → `POST /cs-intakes`(같은 키 재전송). 새 문의/연결 결과 링크. 422 `CUSTOMER_ORDER_MISMATCH`·`ORDER_NOT_FOUND` 코드 문구. 접수 건 상세에 "이 건으로 고객 연락 남기기"·"이 건의 연락 기록"(`GET /cs-intakes?caseId=`, 상담원·관리자에게만). 목으로만 확인, 실서버 쓰기는 사용자 승인 뒤.
- **라이더 문의** `/rider-inquiries`(case 0.13.0, 백엔드 요청 `backoffice/2026-11-16-request-rider-inquiries` — 지원센터 묶음, 메뉴 항목은 `RIDER_OPS`·`OPERATOR_ADMIN` 만): 고객 문의 화면을 같이 쓰고 목록은 `requesterType=RIDER`(고객센터 문의는 `CUSTOMER` — 관리자도 메뉴별로 나뉨). 분류 정산·앱 오류, 상세 "문의한 사람"·라이더 ID(라이더 찾기 링크), 컴플레인·연락 기록 없음. 답변은 `RIDER_OPS` 만(관리자 보기만, 서버도 종류별 403). 못 보는 종류 403 은 오류로. LAN(관리자 세션) 목록·상세 보기 확인(답변은 안 보냄).
- **라이더 문의 대화**(case 0.21.0, 백엔드 안내 `all/2026-11-17-notice-rider-inquiry-chat` — PR #80): 상세 replies 를 보낸 쪽으로(라이더 이어 쓰기 `authorType RIDER` = "라이더", 지원센터 = "답변"), 라이더 문의 제목 "대화", 라이더가 이어 써 접수로 돌아오면 "다시 답변을 기다려요". 답변은 그대로 `/replies`. LAN 읽기 — 답변 1줄 "답변".
- **문의 사진**(case 0.14.0, 백엔드 요청 `all/2026-11-17-request-inquiry-photos` — `features/inquiries/InquiryPhotos.tsx`): 고객·라이더 문의 상세에 `photos[]` 썸네일(붙인 순서)·누르면 크게 보기. 본문 `GET /inquiry-photos/{photoId}` 는 토큰을 붙여 받아 blob URL(공개 아님). 404·403·503 은 "사진을 불러오지 못했어요" + 다시 시도(빈칸으로 두지 않음). 사진 없는 문의는 칸 없음. 올리기·보완은 고객·라이더 앱 몫. LAN(관리자 세션, 2026-11-17): 라이더 문의 목록 4건·백엔드 시험 문의 사진 1장 보임(읽기만).
- **문의 만족도** `/inquiry-satisfaction`(case 0.15.0, 백엔드 요청 `all/2026-11-17-request-inquiry-satisfaction` — 고객센터 묶음, 메뉴 항목 `OPERATOR_ADMIN` 만): 답변 시각 기간(최대 92일, URL `from`·`to`) → "답변 N건 중 M건 응답(M/N)", 평균(없으면 "—"), 1~5점 막대. 상담원별 순위·이름 없음(사용자 결정 — 상담원 평가에 쓰지 않음). 문의 상세 고객 점수·한 줄은 서버가 관리자에게만 줄 때만. **배송 신고**(0.16.0): 고객 문의 목록 "배송 신고 · 늦음/못 받음/잘못 배송", 상세에 배송 번호 링크. 목으로만 확인.
- **문의 닫기**(case 0.19.0 #102, 백엔드 요청 `all/2026-11-17-request-inquiry-close`): 문의 상세 "문의 닫기" — 답변 역할 직원만(고객 문의 상담원, 라이더 문의 지원센터, 관리자 버튼 없음), 경고(다시 열 수 없음·상담 종료일 뿐) + 사유 필수 2~500자(직원에게만 보임) → `POST …/closures`. 닫힌 문의는 "종료 · 고객/라이더/직원이 닫음 · 시각" + 직원 사유, 답변 칸 대신 "새 문의로" 안내. LAN(test-cs-rider, 읽기만): 백엔드가 닫은 시험 문의 INQ-4c0cd749… — "직원이 닫음 · 시각"·사유·닫기 버튼 없음 확인. 닫기 쓰기는 안 보냄.
- 답변은 응대일 뿐 주문·환불을 바꾸지 않는다. 고객 알림은 없다(고객은 앱 "내 문의"에서 본다).
- 실서버 확인은 아직 안 함(목: `mocks/inquiryHandlers.ts`, 목 계정 "상담원 최").

## 2-4. 메뉴 묶음 · 고객센터 · 라이더 운영 (2026-11-15, 백엔드 요청 `backoffice/2026-11-15-clients-request-backoffice-cs-rider-menus.md`)
- **메뉴 묶음**(`src/app/nav.ts`):
  - 상품 관리(`MD`·`OPERATOR_ADMIN` — 2026-11-15 사용자, 판매 상태 변경만 `MD`: 그 밖 역할은 버튼 대신 "MD 만 바꿀 수 있습니다")
  - 승인(`*_APPROVER`·`OPERATOR_ADMIN`)
  - 조회·현황(`CS_AGENT`·`RIDER_OPS`·`OPERATOR_ADMIN` — 주문 조회·통합 조회·실시간 배송 현황·배송·배차 확인·라이더 컴플레인)
  - 고객센터(`CS_AGENT`·`OPERATOR_ADMIN` — 문의 답변·클레임 조회)
  - 라이더 운영(`RIDER_OPS`·`OPERATOR_ADMIN` — 라이더 찾기·계정 제한·제한 검토)
  - 업무 도우미(모든 직원).
  - 세션 응답(`sessions/current` 0.6.0) 역할의 합집합, 하위 메뉴가 없으면 묶음도 숨김.
  - 접고 펴는 `<details>` — 지금 화면의 묶음만 펼친 채 시작.
  - 같은 화면은 한 묶음에만 — 두 역할이 함께 쓰는 조회는 조회·현황 묶음(2026-11-16 사용자: 두 역할 계정에서 같은 메뉴가 두 번 강조돼 보이던 것, 백엔드 알림 `handoff/archive/2026-11-16-backend-menu-shared-lookup-group.md`).
  - 메뉴 숨김은 편의 — 주소로 열면 서버 403 이 오류로 보인다.
  - 첫 화면은 역할 묶음의 첫 화면(상담원 = 주문 조회, 라이더 운영 = 라이더 찾기, 역할 묶음이 없으면 조회·현황, 그것도 없으면 내 세션).
  - MFC 메뉴는 넣지 않는다(MFC 백오피스는 따로 앱, 2026-11-15 사용자 결정).
- **주문 조회** `/orders`, `/orders/:orderId` — order 0.3.0 `GET /orders/lookups`(조건은 URL 쿼리, 기본 기간 오늘까지 7일, 주문 ID·고객 ID 없으면 기간 31일 이하 — 보내기 전 안내, 연락처는 숫자만 완전 일치 9~11자리, `page`·`hasNext` 쪽 이동). 목록 연락처는 서버가 가린 값. 상세: 금액 구성·결제 번호·주문 상품·이행 확인 필요 기록·이 주문의 클레임(`GET /claims?orderId=`), 배송지는 서버가 가린 값 + 사유 입력 원문 열람(아래 "주문 상세 배송지 열람"), 이 주문의 배송(execution 0.4.0 `GET /deliveries?orderId=`). 취소 버튼 없음(ADR-0060).
- **라이더 컴플레인** `/rider-complaints`(목록 — 라이더·배송·종류·기간 필터, 커서), `/rider-complaints/new`(기록 — 배송 번호·종류 필수, 주문·문의·메모 선택, 쿼리로 미리 채움), `/rider-complaints/:id`(상세·메모). case 0.3.0. 라이더는 서버가 채운다(422 `RIDER_NOT_ASSIGNED`·`DELIVERY_NOT_FOUND`·`INQUIRY_NOT_FOUND` 안내). 결과 불명은 같은 키로 확인.
- **주문 상세 배송지 열람**(2026-11-16, order 0.4.0·0.5.0): 상세는 서버가 가린 값 그대로(이름 첫·끝 글자, 010-****-1234, 상세주소 `***`, 출입 메모·배송 요청사항은 "가림"). 원문은 "원문 열람" — 항목(이름·연락처·상세주소·출입 메모/요청사항) 고르고 사유 2~200자 → `POST /orders/lookups/{orderId}/pii-reveals`(열람 기록이 남은 뒤 고른 항목만 원문). 원문은 화면 메모리에만, "다시 가리기"·화면 이동으로 사라짐. 503·결과 불명은 원문 없이 같은 키 "결과 확인".
- **처리 대기** `/pending`(2026-11-16, `OPERATOR_ADMIN` 만) — bff 0.2.0 `GET /backoffice/views/pending-work`(멈춘 주문 처리 + 이행 확인 필요, 원천 표시·못 읽은 원천 경고).
  - 버튼은 `allowedActions` 만: 결제 결과 다시 확인(`saga-requery`), 처리 완료(`saga-resolve`, 사유 필수·주문·재고 그대로 경고) — bff 명령 프록시 — 짝 조회 `GET …/commands/…/{requestId}` 는 아직 501 이라 부르지 않고, `ACCEPTED`·`UNKNOWN_RESULT`·시간 초과면 목록을 다시 읽어 "목록에서 확인"(결과 불명, 같은 키 재전송만, 2026-11-16 백엔드 회신 reply-case-inbox-questions §3), 확인(order-service acknowledgements). 422 `NOT_REQUERYABLE`·`NOT_RESOLVABLE` = 새로고침 안내.
  - **MFC 중지 실패·인계 거절**(bff 0.4.0, 백엔드 알림 `notice-pending-work-mfc-retry`): `allowedActions: [RETRY]` → "다시 시도"(메모 필수) → bff `mfc-fulfillment-service/stop-retry`·`handover-retry`. APPLIED = 목록에서 빠짐, REJECTED = "다시 실패 — 원인 고친 뒤 다시", 그 밖은 위와 같이 목록 다시 읽기. 인계 거절은 "실물 확인 → 재고 정정 → 다시 시도" 안내. 처리 완료 버튼 없음. 메모는 MFC 에 아직 저장 안 됨 — "기록됨"이라 쓰지 않음.
  - **MFC 묶음 켜짐**(bff 0.8.0 #96, 백엔드 요청 `request-pending-work-mfc`): 항목마다 "최근 재시도: 누가 · 언제 · 사유"(lastRetry, 없으면 줄 없음), 다시 시도 "사유(필수, 500자)" — 누가·사유가 MFC 재시도 기록으로 남는다는 안내. 다시 실패(REJECTED)여도 목록을 다시 읽어 최근 재시도를 갱신. LAN(관리자): 지금 항목 0건, MFC 원천 켜짐("아직 연결 전" 안내 안 보임).
  - **더 있음**(bff 0.9.1 #100): MFC 목록이 1,000건을 넘어 뒤를 못 읽었으면(truncated) 목록 위 "오래된 것부터 처리하거나 센터로 나눠 보세요". LAN 지금 false·0건이라 목으로만.
  - MFC 목록은 PC 3 API(F-4) 전까지 서버 설정으로 꺼짐 — `sources` 에 mfc-fulfillment-service 가 없으면 "아직 이 목록에 나오지 않아요(장애 아님)" 안내.
  - LAN(2026-11-16, claude-dev): 0건 + 그 안내 확인, 재시도 명령은 대상이 없어 실서버로 보내 보지 않음.
- **지원센터 사건** `/cases`·`/cases/:caseId`·`/cases/new-misdelivery`(2026-11-16, `RIDER_OPS`·`OPERATOR_ADMIN`, `CS_AGENT` 보기 + 오배송 열기) — case 0.4.0.
  - 탭 아무도 안 맡은 것·내 것·기한 넘김·닫힌 것(URL), refs 링크, 기한 넘김 빨강, 요약이 없으면 종류 이름. 도움요청 사건은 `requestId`·`deliveryId` ref(case 0.4.1) 먼저, 없으면 `incidentId` 를 나눠 도움요청 단건.
  - 내가 맡기·관리자 배정(`assignments`), 닫기(`closures` 결과·요약 — 개인정보 금지 안내), 오배송 열기(`POST /cases` MISDELIVERY, 409 `CASE_ALREADY_OPEN`).
  - **오배송 귀책·고객 선택**(case 0.11.0, ADR-0065, 백엔드 요청 `request-misdelivery-fault-choice` — 2026-11-16): 오배송 접수에 "누구 잘못인가요?"(라이더 실수·지도·시스템 오류·고객 주소 오입력 등) 필수 + "고객이 고른 처리"(재발송 기본·전 품목 환불) → `misdelivery {fault, resolution}` 늘 보냄.
  - **고객 잘못도 고를 수 있음**(백엔드 #49~#53 배포 — 요청서 다시 씀): 처리 = 다시 배송(기본)·환불(상품값 − 9,000원, 정책 안내만). 고객 잘못 + 다시 배송은 두 단계 — 배송(execution)에서 주문 번호를 읽어 order 0.9.0 `POST /orders/lookups/{orderId}/redelivery-destinations` {deliveryId, roadAddress, detailAddress?, postalCode?, reason} → destinationId → case `misdelivery.redeliveryDestinationId`. 실제 주소는 입력만(기록 뒤 화면에서 지움, 다시 보여 주지 않음), 사유에 주소·전화번호 금지 안내, ①만 되고 ②가 실패하면 주소를 다시 쓰지 않고 접수만 다시. 200m 무료·넘으면 고객 앱 9,000원·30분 미결제면 회수 후 상품값 − 9,000원 환불 안내.
  - 라이더 실수엔 "라이더 원래 배달료가 지급되지 않습니다" 안내. 상세 refs 의 fault·resolution 은 이름표("귀책 라이더 실수"·"고객 선택 전 품목 환불"). 422 `INVALID_MISDELIVERY_RESOLUTION`·`REDELIVERY_DESTINATION_REQUIRED` 문구. 실서버 접수·주소 기록은 실제 회수 배차·결제 요청이 일어나 보내 보지 않음(목 모드만).
  - **목록은 bff 0.5.0 `GET /backoffice/views/case-inbox`**(2026-11-16, 백엔드 요청 `request-case-inbox-linked-state`): "연결 상태" 열 — 연결 배송(수행 상태)·주문(주문 상태)을 원천 값 이름표로, `confidence UNKNOWN` → "확인 불가"(장애이거나 그 역할이 못 보는 원천 — 지원센터는 주문을 못 볼 수 있음), `state null`·DIRECT → "원천에 없음". `unavailableSources` 에 case-service 면 목록 조회 실패(빈 목록 아님). 50건씩 `page.nextCursor`(URL `cursor`). 맡기·닫기·상세는 case 직접. LAN(claude-dev): 아무도 안 맡은 것 1건(위치 끊김, 연결 배송 "전달 완료"), 원천 case·delivery-execution 최신.
  - **다시 열기·넘기기**(case 0.6.0·0.7.0, 백엔드 요청 `request-case-reopen`·`request-case-transfer`): 닫힌 사건 "다시 열기"(사유 필수, 닫기와 같은 사람 — 배송 쪽 지원센터·관리자, 관리자 팀 사건 관리자; 상담원 없음) → `reopenings`, 다시 열림·담당 비움·기한 새로, 지난 종결은 "지난 종결"로 남김. 409 `CASE_ALREADY_OPEN` → 통합 조회 `/lookup?q=<대상>` 로 열린 사건 찾기 안내. refs `previousCaseId` → "이전 사건" 링크. 배송 쪽 열린 사건 "관리자에게 넘기기"(지원센터는 안 집었거나 자기가 집은 것)·"지원센터로 돌려보내기"(관리자만) → `transfers`(사유 필수). 상세에 담당 팀, 관리자 팀으로 간 배송 쪽 사건은 목록·상세에 "관리자 처리 중" + 지원센터·상담원 보기만 안내(맡기·닫기·넘기기 숨김). 이력 REOPENED "다시 열림"·TRANSFERRED "넘김"(note 그대로). LAN(claude-dev, 2026-11-16): 백엔드가 시험한 위치 끊김 사건 — 다시 열림·지원센터·담당 없음, 이력 넘김 2·닫힘·다시 열림 표시 확인(명령은 보내지 않음).
  - **후속 처리**(case 0.8.0 의무, 백엔드 요청 `request-case-obligations` — `features/cases/FollowUps.tsx`): 접수 건 상세 "후속 처리 (N건 남음)" — 종류·담당 팀(비우면 접수 건 팀)·수량·기록 금액·기한·상태·결과 이력. "결과 남기기": 완료(수량·금액 일부 가능)·시도 기록(상태 그대로, 메모 필수)·면제·실패(관리자만, 사유 필수), 근거(어느 곳·번호) 필수 → `POST /obligations/{id}/resolutions`. 버튼은 담당 팀(지원센터 = RIDER_OPS, 고객센터 = CS_AGENT)·관리자에게만. "후속 처리 추가"(지원센터·관리자, 8종) → `POST /cases/{id}/obligations`. 남아 있으면 "완료 처리" 비활성 + 안내, 서버 409 `OPEN_OBLIGATIONS` 도 코드 문구. 금액은 "기록 금액" — 환불·보상은 클레임·결제 메뉴 안내. 고객센터 메뉴 "고객센터 후속 처리" `/follow-ups/cs`(`GET /obligations?owner=CS`, 처리 중 / 처리 끝남 = RESOLVED·WAIVED·FAILED 합침). LAN(claude-dev): 목록 0건 200, 상세 칸·추가 폼 표시(명령은 보내지 않음).
  - **교대 인계**(case 0.9.0 shift-handovers, 백엔드 요청 `request-shift-handover`·PR #42 — 병합·배포 전, `features/cases/HandoverPages.tsx`): 지원센터 › 교대 인계 `/cases/handovers`, 탭 인계서 쓰기·나에게 온 인계·내가 쓴 인계·미인수(관리자). 쓰기 = 내가 맡은 처리 중 접수 건(팀별, 기본 전부 선택) + 건마다 다음 조치(필수)·확인 기한 + 후임 → `POST /shift-handovers`(관리자는 전임을 바꿔 대신 쓰기). 받기 전에는 담당 그대로, 자동으로 넘어가거나 돌아가지 않고 알림 없음 — 화면에 안내. 수락은 후임 본인만(건별 받기/안 받기 → `acceptances` {excludedCaseIds}), 결과 건별(받음·안 받음(미인수)·그사이 바뀌어 건너뜀·권한 없어 건너뜀). 취소는 받기 전 전임·관리자. 이력 HANDOVER_REQUESTED "인계서에 들어감"·HANDED_OVER "인계됨". LAN(claude-dev, 17:20): 내가 쓴 인계에 백엔드 시험 인계서(받음 — 건 ACCEPTED), 접수 건 이력 "인계서에 들어감"·"인계됨", 담당 이동 확인(명령은 보내지 않음).
  - **교대 인계 역할**(case 0.13.1, 백엔드 요청 `request-handover-roles`·PR #74, 사용자 "(나)"): 메뉴·쓰기 탭은 `RIDER_OPS`·`OPERATOR_ADMIN` 만(상담원은 메뉴 없음 — 받기도 403), 라이더 운영은 팀 지원센터 고정(관리자만 팀 고름), 후임 칸 옆 "후임도 그 팀 역할이 있어야" 안내, 수락 403 → "전임에게 다시 써 달라고 하세요"(인계서는 받기 전 그대로). LAN(관리자 세션) 화면 열림 확인, 쓰기·수락은 안 보냄.
  - **메모**(case 0.10.0 — `features/cases/CaseNotes.tsx`): 접수 건 상세 "메모" — 오래된 것부터, 남기기(1~500자, 관리자·지원센터·상담원, 처리 끝난 건에도), "개인정보(전화번호·주소)는 쓰지 마세요" 안내, 고치기·지우기 없음, 가리기는 관리자만(사유) → 가린 메모는 내용 없이 "가린 메모 — 가린 사람 · 사유". LAN: 백엔드 시험 메모 1건 가린 상태로 표시 확인.
  - **오배송 회수 진행**(case 0.8.1·bff 0.5.1): refs `recoveryDeliveryId` → "회수 배송" 링크, 이력 RECOVERY_CREATED "회수 배송 생김"·RECOVERY_PICKED_UP "회수함"·RECOVERY_RETURNED "매장 반납", "반납돼도 저절로 끝나지 않음" 안내, 사건함 연결 상태에서 회수 배송을 따로 이름. LAN 은 회수 배송이 있는 접수 건이 없어 목 모드만.
  - **재발송 배송**(case 0.11.2·bff 0.5.2, 백엔드 PR #48): refs `reshipmentDeliveryId` → "재발송 배송" 링크, 이력 RESHIPMENT_CREATED "재발송 배송 생김", 연결 상태에서 원래 배송(subjectRef)·회수 배송(recoveryDeliveryId)·재발송 배송(reshipmentDeliveryId)을 따로 이름, 안내 "회수가 끝나거나 재발송이 생겨도 저절로 끝나지 않음". LAN 에 오배송 접수 건이 없어 목 모드만(2026-11-16).
  - **라이더와 대화**(execution 0.6.0, 백엔드 #60 — `features/cases/HelpChat.tsx`): 라이더 도움요청 접수 건 상세 "라이더와 대화" — refs 의 `deliveryId`·`requestId` 로 `GET …/help-requests/{requestId}/messages`(오래된 것부터, 상세를 연 동안 5초마다 `after=<마지막 seq>` 만 다시 읽음, 다시 읽기 실패는 받은 대화를 두고 경고), 답장 `POST …/messages`(1~1,000자, 같은 키 재전송 = 같은 메시지, 개인정보 안내), 처리 끝난 건은 답장 칸 대신 "다시 처리하면 이어서" 안내·409 `HELP_REQUEST_CLOSED` 코드 문구. 답장 역할·새 메시지 표시·대화 가림·처리 중 시점은 DE-2(PC 5) 반영 뒤 바꾼다(지금은 계약대로). 목으로만 확인, 실서버 답장은 사용자 승인 뒤.
  - **대화 보완**(execution 0.8.0 DE-2, 백엔드 회신 `backoffice/2026-11-17-reply-help-chat-de2`): 답장은 `RIDER_OPS`·`OPERATOR_ADMIN` 만, 관리자 팀으로 넘긴 건은 관리자만(상담원·그 밖은 보기만 안내). 관리자 "가리기"(사유 2~500자, `…/messages/{id}/maskings`) → "관리자가 가린 메시지 — 누가 · 사유", 가린 뒤 대화를 처음부터 다시 읽음. 접수 건 명령(맡기·다시 열기·넘기기) 뒤 도움요청 상태를 다시 읽음(맡으면 처리 중). 사건함 "새 메시지" 점(bff 0.6.0 #88): 연결 칸 "도움요청 상태" + 라이더 마지막 시각이 지원센터 답보다 늦고(또는 답 없음) 이 직원이 그 대화를 열어 보지 않았으면 점. 읽음은 **서버**(case 0.20.0·bff 0.10.0 #114 — 사용자 "가가가나"): 접수 건을 열 때·대화에서 새 라이더 메시지를 받을 때 `POST /cases/{id}/views`(본문·멱등 키 없음 — 공통 fetch "키 없음" 표시), 점 = HELP_REQUEST `lastRiderMessageAt` 이 있고 내 `myLastSeenAt` 이 없거나 더 이름. 탭 sessionStorage 는 뺌. 목으로만 확인(LAN 도움요청 건 없음, 접수 건 상세를 열면 실서버에 "봤음"이 남는다).
  - **행위 요청 기록**(case 0.17.0·0.17.1, 백엔드 요청 `request-action-requests` — `features/cases/ActionRequests.tsx`): 다른 서비스에 한 요청(원결과 다시 조회·미전달 재전송·승인된 보상 실행·검토 요청)과 결과 ID 를 남기기만(대신 실행하지 않음 — "기록만 해요" 안내). 맡을 수 있는 사람만(처리 끝난 건 새 요청 없음), 보상 실행은 승인 번호 필수, 대상 ID·승인 번호 100자. 결과(보냄·접수됨·반영됨·거절됨·결과 모름) + 보유 서비스·결과 ID(같이), 반영·거절 뒤에는 결과 버튼 없음. 이력 "행위 요청"·"행위 결과". 목으로만 확인.
  - **접수 건 현황** `/case-metrics`(case 0.18.0 `GET /cases/metrics`, 백엔드 요청 `request-case-metrics` — 처리 대기 묶음, 관리자만): 종류별 처리 중·아무도 안 맡음("N건 중 M건")·기한 지남(빨강, 사건함 기한 넘김 탭 링크), 팀별 후속 처리, 받기 전 인계서(미인수 탭 링크), 고객·라이더 문의 답변 대기(가장 오래된 것, 문의 목록 링크). 건수만 — 비율·목표·개인별 없음, 0건 줄은 0, 조회 실패는 오류. 1분마다·새로고침. LAN(관리자): 오배송·위치 끊김 각 1(기한 지남), 라이더 문의 대기 3 — 백엔드 값과 같음.
  - **알림 배지**(백엔드 요청 `request-last-seen-and-badges` §2 — 백엔드 변경 없음, `features/cases/CaseBadges.tsx`): 메뉴 "접수 건" 옆에 아무도 안 맡은(파랑)·기한 지난(빨강) 개수 — 1분마다 `GET /cases?unassigned=true|overdue=true&size=50`, 다음 쪽이 있으면 "50+", 0이면 배지 없음, 못 읽으면 "?". 늘었을 때만 잠깐 강조(소리·브라우저 알림 없음). 지원센터·관리자만. LAN(test-cs-rider): 기한 지남 2.
- **클레임 조회** `/claims`, `/claims/:id` — claim 0.1.0 목록·상세·환불(`/refunds`). 결정 버튼 없음(서버 501). 환불은 서버 상태 그대로(PG 성공 전 "완료" 아님).
- **배송 확인** `/deliveries`(배송 번호로 열기 + 찾기: 주문 ID·라이더 ID·상태·오래된 순, "전달 실패 확정 대기" = `state=FAILURE_REPORTED&sort=OLDEST`, cursor 더 보기 — execution 0.4.0, 2026-11-16), `/deliveries/:id` — 배송 수행(execution `GET /deliveries/{id}`)과 배차(dispatch `GET …/dispatch` — 상담원도 조회)를 따로 읽고 따로 보인다(한쪽 403 이어도 다른 쪽은 보인다). `FAILURE_REPORTED` 면 전달 실패 확정·반려(`X-Expected-Version` = 수행 version, `APPLIED`/`ACCEPTED` 문구 구분), 배차 `ASSIGNED` 면 픽업 전 배차 취소(사유 4가지 — 운영자 판단은 승인 번호 필수, 다시 배차 기본 켬, 202 접수 → 짝 조회 `GET …/assignment-cancellations/{requestId}` 로 확정까지, 422 `PICKED_UP_CASE_REQUIRED` 안내). "이 배송으로 라이더 컴플레인 기록" 링크.
- **라이더 찾기·계정 제한** `/riders`, `/riders/:riderId` — rider 0.4.0(2026-11-16, BR-54 끝): 찾기 = 라이더 ID·전화(숫자 10~11자리) 완전 일치 + 제한·운행·수단·정렬, 쪽 이동(이름 검색 없음). 상세 = 가린 이름·전화 + 사유 입력 원문 열람(`POST /riders/{id}/pii-reveals`, 항목 이름·전화), 운행·배달 지역·배차 방식·제한·마지막 위치. 계정 제한 현재·이력·걸기/바꾸기/풀기(사유 필수·기한·증빙·승인 번호, `X-Expected-Version` = 상세의 라이더 version — BOD-6, RIDER_OPS 도), 이 라이더의 배송·열린 제한 검토·컴플레인.
- **제한 검토** `/riders/restriction-reviews` — 열림·제한함·기각 탭, 묶인 컴플레인, 열린 검토는 행마다 "제한함으로 닫기"·"기각"(메모), 닫으면 그 자리에서 결과 표시.
- **도움요청 대기**는 지원센터 사건함으로 옮겼다(2026-11-16, BR-55 끝) — `/delivery-help-requests` 는 `/cases?kind=RIDER_HELP` 로 넘기고, 라이더 도움요청 사건 상세에 도움요청 단건(`GET /deliveries/{id}/help-requests/{requestId}` — 라이더가 쓴 내용·사진 참조). 전달 실패 확정 대기는 배송 확인의 찾기.
- 권한(서버 판정, 지금 계약): 배차 조회는 `CS_AGENT`·`RIDER_OPS` 가, 계정 제한·제한 검토·배차 취소·실패 결정은 `RIDER_OPS` 가 PC 5 반영 뒤에 열린다 — 그 전에는 403 이 오류로 보인다(목도 같게 흉내).
- 개인정보: 주문 목록·상세는 서버가 가린 값, 원문은 사유를 적고 `pii-reveals`(2026-11-16 — 위 "주문 상세 배송지 열람"). 라이더 상세의 이름·연락처는 아직 `Masked`(화면 안 가림, "보기"). 검색 조건·연락처·주소·메모·열람 사유를 로그에 남기지 않는다.
- 목: `mocks/opsHandlers.ts`(주문 3·배송 4·클레임 2·컴플레인 2·라이더 2·검토 1), 목 계정 "라이더 운영 정"(`RIDER_OPS`)·"상담·라이더운영 한"(`CS_AGENT`+`RIDER_OPS`, LAN `test-cs-rider` 와 같은 역할). 실서버 확인은 아직 안 함.

- **화면 용어(사용자 2026-11-16)**: 백엔드 case(사건함)는 화면에서 **"접수 건"**(메뉴 지원센터 › 접수 건, 오배송 접수). 열림/닫힘 대신 처리 단계 — 상태 OPEN 접수됨·CLOSED 처리 끝남·REOPENED 다시 처리 중, 탭·칸 "처리 중"/"처리 끝남", 동작 닫기 → "완료 처리", 다시 열기 → "다시 처리하기", 종결 → "처리 결과". 의무(obligation)는 "후속 처리". 계약·백엔드 문서 이름(case·사건함)은 그대로.

## 2-5. 통합 조회 (BO-11, 2026-11-16, bff 0.3.0 — 백엔드 요청 `backoffice/2026-11-16-request-unified-lookup.md`, PR #25)
- 메뉴 "통합 조회" `/lookup` — 고객센터·라이더 운영 묶음의 **두 번째**(첫 화면 = 묶음 첫 메뉴는 그대로). OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정 — 그 밖 403 → 권한 없음 화면).
- `GET /backoffice/views/unified-lookup?q=&kind=` — 찾는 값·종류는 URL 쿼리. 종류 고르기는 번호로 알아서(ANY, 보내지 않음)·주문·배송·사건·고객(TRANSFER·TRIP 은 원천이 없어 고르기에 없음). 422 `UNSUPPORTED_LOOKUP`(전화번호 등)은 코드 문구, 5xx 는 오류(빈 결과 아님), 없는 대상은 "찾는 대상이 없어요".
- 결과: 원천 표시(`SourceStamps` — 기준 시각·신선도·조회 못 한 원천), "○로 찾음 → 주문 …", 주문 칸 위 + 배송(수행)·배차·클레임·고객 문의 칸 + 사건 칸(열린 것 / 닫힌 것 최근 20건, `state` 로만 나눔). **실패·권한 없음 원천은 그 칸에 "조회 실패 또는 볼 권한 없음"**(0건과 구분). 원천 이름 ↔ 칸: order-service·delivery-execution-service·delivery-dispatch-service·claim-service·case-service·case-service/inquiries — 계약 설명에 적힌 목록(PR #25 985a2ecd, 질문 handoff 답). 닫힌 사건은 백엔드 PR #26(case 0.5.1) 부터 닫힌 시각 최근 순 — 그 전 LAN 은 오래된 순(화면은 받은 순서대로).
- `summary` 는 원천 필드 이름 그대로 — 아는 이름만 한국어, 모르는 이름은 그대로, 시각(…At)은 서울 시각, 객체는 한 단계 펼침. 금액·상태를 계산하지 않는다. 개인정보는 오지 않는다(원문은 주문 상세 열람).
- 각 항목 "상세 보기": 주문 `/orders/{id}`·배송·배차 `/deliveries/{id}`·클레임 `/claims/{id}`·사건 `/cases/{id}`·문의 `/inquiries/{id}`. 고객 번호면 주문 목록만 → "이 주문으로 다시 조회"(q = 주문, kind ORDER).
- 계약 타입: bff 0.3.0 이 main 에 없어(PR #25) 그 브랜치 계약으로 로컬 생성(생성물은 커밋 안 함) — PR #25 병합 뒤 `gen:api` 로 다시, `contracts.lock` 은 PC 1. 목 `mocks/lookupHandlers.ts`.
- **현장(MFC)**(bff 0.9.0 #98, 백엔드 요청 `request-lookup-fulfillment` — `features/lookup/FieldSection.tsx`): 주문 아래 칸. 작업 지시(원래·재발송, 센터 수락·거절 사유) → 출고별 피킹 → 포장 → 인계 순서, 막힘 사유 빨강·수량(완료/계획·취소)·작업자 ID, 점원 결품 보고, 포장 인계 거절 사유. 중지 요청 PENDING + 오류면 관리자에게 처리 대기 링크. 원천 실패는 "조회 실패", 기록 없으면 "현장 기록이 없어요". 옛 "아직 없는 원천: MFC" 안내 뺌. LAN(test-cs-rider): ORD-bd33c14e… 피킹 진행 중·포장 대기 보임.

## 2-6. 실시간 배송 현황 (2026-11-16, bff 0.3.0 — 백엔드 요청 `backoffice/2026-11-16-request-live-delivery.md`, PR #25, 배송 원문 §10.1)
- 메뉴 "실시간 배송 현황" `/live-delivery` — 고객센터·라이더 운영 묶음, 통합 조회 다음. OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정, 셋 다 모든 센터 — 그 밖 403 → 권한 없음 화면).
- `GET /backoffice/views/live-delivery?mfcId=&state=&size=50&cursor=` — 센터·상태·쪽은 URL 쿼리. 센터 고르기는 center-master `GET /centers?type=MFC`(못 읽으면 "모든 센터"만 + 안내). 상태 고르기는 진행 중 9개 중 하나(비우면 진행 중 전부).
- 상태를 비우면 오래된 순 50건, 쪽 넘김 없음 — `truncated` 면 "더 있어요 — 센터나 상태로 좁혀 주세요". 상태를 고르면 `page.nextCursor` 로 "다음 쪽"/"처음 쪽"(상태 없이 cursor 를 보내지 않는다).
- 표: 배송(→ 배송 상세)·주문(→ 주문 상세)·센터·종류·수행 상태·배차 상태·라이더(없으면 "미배정")·예정 시간대(arrivalWindow 받은 그대로) + "약속 지남"(promisedAt < 응답 composedAt — 화면 시계를 쓰지 않음)·열린 사건(종류·우선순위 → 사건 상세, overdue 면 "기한 넘김").
- 원천 실패: 배차 `state null` → "모름(조회 실패)", `openCases null` → "조회 실패"(0건과 구분), 원천 줄에 "조회하지 못한 원천". 5xx 는 오류(빈 목록 아님).
- 1분마다 자동 새로 고침(요청서 — 30초 이상 권장), 수동 "새로 고침". latestEta 는 아직 늘 null 이라 열 없음(안내 문구만). 개인정보 없음.
- 목 `mocks/liveDeliveryHandlers.ts`(진행 중 8·끝남 1, `mfcId=MFC-MOCK-DOWN` 이면 배차·사건 원천 실패).
- LAN 확인(2026-11-16 PC 2, `dev:lan` + 게이트웨이 CORS 개발 출처, test-cs-rider): 실시간 배송 1건(미배정·배차 실패·열린 사건 없음), 센터 목록 1곳. 통합 조회 — 주문 번호로 주문·배송(수행)·배차 칸, 원천 6개, 고객 번호로 주문 목록, 전화번호 422 문구 모두 정상. 그 자리에서 고친 것: "○로 찾음" 조사 → "○ 번호로 찾음", 금액 필드 원·천 단위, 실서버 필드 이름 한국어(결품 처리·봉투값·배달팁·시도 번호·실패 사유 등).
- **도착 예정**(bff 0.7.0 #90, 백엔드 요청 `request-live-delivery-eta`): 약속 시각 아래 "도착 예정 시각"(tracking AVAILABLE 일 때만)·"N분 늦음"(빨강), 위치 확인·계산 전은 "확인 중", tracking 장애는 "확인 불가", 그 밖은 "—" — 숫자를 지어내지 않음. 옛 "도착 예상 시각은 아직 없어요" 안내 뺌. LAN 진행 중 배송 0건이라 목으로만 확인.
- **포장 인계 현황** `/packing-handover`(bff 0.11.0, 백엔드 요청 `all/2026-11-17-request-packing-handover` — 조회·현황 묶음, 본사 셋, `features/live/PackingHandoverPage.tsx`): 센터 필수(고르기 전에는 묻지 않음), 출고 상태 거르기(기본 끝나지 않은 것), 주문번호(없으면 주문 ID)·재발송, 단계는 서버 값(PACKING + 패킹 시작 전 "패킹 대기", 막힘 이유 — #140 규칙, null 이면 "—"+원천 값), "포장 N · 인계 M · 남음 K" + 포장별 펼치기, 출고대기·배차 요청 시각, 배송(상태·라이더). MFC 원천 실패는 "0건 아님", 배송 원천만 실패면 배송 칸 "—". 30초 새로 읽기, 더 보기. 센터 관리자 화면은 PC 3. LAN(관리자): MFC-SEED-01 인계 완료 1건(포장 1·인계 1·남음 0, 전달 완료).

## 2-7. 개인정보 열람 기록 (2026-11-16, audit 0.3.0 — 백엔드 알림 `backoffice/2026-11-16-notice-pii-access-log-api.md`, ADR-0062 결정 9·10)
- 메뉴 "감사" 묶음 → "개인정보 열람 기록" `/pii-access-logs`(상세 `/pii-access-logs/{id}`). **OPERATOR_ADMIN 만**(메뉴도 관리자에게만, 그 밖 역할이 주소로 열면 서버 403 → "이용할 수 없는 화면").
- `GET /pii-access-logs?actorId=&subjectType=&subjectRef=&caseRef=&accessType=&from=&to=&size=50&cursor=` — 거르기는 URL 쿼리. 기간은 한국 날짜 → 시작일 0시(+09:00)부터 종료일 다음 날 0시 전까지(to 미포함). 시작일 > 종료일이면 부르지 않고 안내. 열람 시각 새 것부터 50건, `page.nextCursor` 로 다음 쪽.
- 표: 열람 시각(→ 상세)·열람한 직원(운영자 ID·그때 역할)·정보주체(종류 + ID, 라이더는 라이더 상세로)·열어 본 항목(이름·연락처·주소·출입 메모)·방식·관련 주문·접수 건(`ORDER:` → 주문 상세, `RIDER:` → 라이더 상세)·열람 사유. 상세는 센터 범위·건수·화면·기록한 서비스·기록 시각·기록 ID 까지. 목록으로 돌아가면 거르기 유지.
- 기록에 원문 개인정보 값은 없다(참조·항목 코드·사유만). 열람 사유는 직원이 쓴 글 — 화면에만, 콘솔·로그에 남기지 않는다. 기록은 2년 뒤 파기(안내 문구).
- 목 `mocks/piiAccessLogHandlers.ts`(7건 — 직원 3, 고객·라이더). 시험 `features/piiAccess/piiAccess.test.tsx`(8).
- LAN 확인(2026-11-16 PC 2, `dev:lan`): test-cs-rider(CS_AGENT·RIDER_OPS) → 메뉴 없음, 주소로 열면 403 "이용할 수 없는 화면". claude-dev(OPERATOR_ADMIN) → 감사 묶음·목록 1건(11-15 상담원의 주문 연락처 보기, 주문 참조 → 주문 상세)·상세(화면·기록한 서비스 order-service·기록 ID), 거르기 — 날짜 11-15 1건·11-16 0건("없어요")·라이더 0건·주문 참조 1건·없는 직원 0건 모두 서버 결과대로.

## 3. 기술 메모
- 개발: Vite 프록시 `/api → http://localhost:8080` (CORS 없음, BR-04). 목은 MSW.
- 모든 목록은 커서 페이지(`size`, `cursor`). 표·필터 상태는 URL 쿼리에 둔다(공유·새로고침 복원).
- 명령 버튼은 제출 중 비활성 + 같은 `Idempotency-Key` 재시도. `reason` 입력 필수 명령은 폼에서 강제.

## 4. `[결정 필요]`
BO-Q01(운영자 IAM·로그인·추가 인증), Q02(역할·범위), Q06(승인함↔원승인 연결), Q07(재심사·승인선), Q19(신선도 임계·SLA), Q20(개인정보 열람·다운로드·보존), Q21(대량 변경 상한·양식), Q22(지표 정의), Q03/Q04(상품·가격 실행 정본), Q05(권역 중첩). 카카오 지도 앱 키 발급·허용 도메인.
