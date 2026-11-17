# 고객앱 (customer_app, Flutter)

근거: `../pmart-backend/docs/business/Commerce-business-logic.md`(C), `OMS-business-logic.md`(O), `flows/order-checkout-saga.md`, `cancel-vs-handover.md`, `return-exchange-refund.md`, 계약 `contracts/openapi/*.yaml`. 숫자는 대략적인 줄 번호. 화면 ID 전체 색인은 C 부록 I.1(≈3510).
Commerce 문서의 PPC = MFC. 1차 제외: 쿠폰·프로모션·할인 배너·찜·재입고 알림·공유·AI 상담. (2026-10-24 레퍼런스 검토 후 유지 확정. 포인트 적립·1+1·증정 배지도 프로모션에 포함해 제외. `customer-app-design-review.md`)

## 1. 화면과 API

| 영역 | 화면 ID | API (gateway `/api/v1`) | 공개 |
|---|---|---|---|
| 로그인 | SCR-AUTH-001 | `POST /auth/social-logins`, `GET /auth/social-logins/{id}`, `POST …/{id}/completions`, `POST /auth/tokens`, `POST /auth/logouts`, `GET /auth/sessions/current` | 로그인 3·갱신 공개 |
| 약관 동의 | SCR-CONSENT-001 | `GET /me/consents`, `POST /me/consent-changes` (+짝 조회) | |
| 주소 | SCR-ADDRESS-001, ADDRESS-EDIT-001 | `GET/POST /me/addresses`, `PATCH/DELETE /me/addresses/{id}`, `POST /me/shopping-address-selections`, `GET /me/shopping-context`, 비회원 `POST/GET /guest-delivery-addresses` | 비회원 배송지 공개 |
| 홈 | SCR-HOME-001 | `GET /storefront/home`, `/storefront/tabs/{tabKey}`, `/storefront/sections/{id}/items`, `/storefront/banners` | 공개 |
| 카테고리·검색 | SCR-CATEGORY/SEARCH/LIST/FILTER-001 | `GET /categories/tree`, `GET /search/products`, `/search/suggestions`, `/search/filters`, `GET/DELETE /me/recent-searches` | 검색 공개 |
| 상품 | SCR-PRODUCT-001, OPTION-001 | `GET /product-contents/{productId}`, `GET /product-contents?…`(카드 일괄), `GET /prices`, `GET /products/{id}/reviews` | 리뷰 공개 |
| 장바구니 | SCR-CART-001, CART-MERGE-001 | `POST /carts`, `GET /carts/{id}`, `POST /carts/{id}/items`, `PATCH/DELETE /carts/{id}/items/{itemId}`, `GET /carts/{id}/change-requests/{requestId}`, `POST/GET /carts/{id}/merges` | 비회원은 비회원 토큰(`POST /auth/guest-sessions`, typ=GUEST, ADR-0022). 병합은 회원 토큰 + `X-Guest-Token`. 가용 UNKNOWN 안내는 `mfcId` null(배송지 미정)·`sources[]` 의 mfc-inventory UNAVAILABLE(재고 원천 장애)·그 밖으로 나눈다. 수량 ± 는 350ms 모아 최종 수량 1회 전송(목표 수량은 흐리게, 확정은 서버 값). 변경 응답의 `cart`(BR-43, GET 과 같은 모양)가 오면 그걸로 끝냄(왕복 1회). 없는 옛 서버면 수량·선택·삭제를 응답 `cartVersion` 으로 바로 반영하고 합계는 "확인 중"으로 비운 뒤 `GET` 으로 채움(담기는 다시 읽음). 품목 줄 금액 = `display.unitPrice × quantity`(표시용, 서버 `selectedItemAmount` 와 같은 식. 계약에 행 금액이 없음). 합계·주문 금액은 서버 값만 |
| 배송 방식·슬롯 | SCR-DELIVERY-SELECT-001 | `GET /slots`, `GET /delivery-conditions` | |
| 주문서·결제 | SCR-CHECKOUT-001, PAYMENT-001 | `POST /order-drafts`, `GET /order-drafts/{id}`, `POST /order-drafts/{id}/checkouts` + **토스 결제(BR-01)** | |
| 주문내역·상세 | SCR-ORDER-LIST/DETAIL-001 | `GET /orders`, `GET /orders/{id}`, `GET /claims?orderId=`(처리 내역 목록) | |
| 배송 추적 | SCR-TRACK-001 | `GET /deliveries/{id}/eta`, `GET /deliveries/{id}/stream`(SSE) | |
| 예약시간 변경 | SCR-RESCHEDULE-001 | `POST /orders/{id}/reservation-time-changes` (+짝 조회) | |
| 취소·반품·교환 | SCR-CANCEL-001, CLAIM-FORM/DETAIL-001 | `POST /claims`(CANCEL/RETURN/EXCHANGE), `GET /claims`, `GET /claims/{id}`, `POST /claims/{id}/withdrawals`, `GET /claims/{id}/refunds` | |
| 리뷰 | SCR-REVIEW-LIST/EDIT-001 | `GET /me/review-eligibilities`, `POST /reviews`, `PATCH/DELETE /reviews/{id}` | |
| 알림 | SCR-NOTICE-001 | `GET /me/notifications`, `…/{id}`, `POST …/{id}/reads`, `GET /me/notification-settings`, `POST /me/notification-setting-changes` | |
| 마이페이지·탈퇴 | SCR-ACCOUNT-001, WITHDRAW-001 | `GET /me`(Google 이름·이메일·사진 경로, ADR-0024), `GET /me/profile-image`(본인 토큰, 인증 Dio 로 바이트 → 기본 아바타 대체), `POST /me/profile-changes`, `POST /me/withdrawals`, `GET /me/withdrawals/{id}`, `POST …/revocations` | Google 값은 서버가 로그인마다 최신으로 바꾸고 앱은 표시만. 없으면 "정보 없음"·기본 아바타. 내 정보 저장은 닉네임만(`{nickname}` 즉시 APPLIED, 2026-11-03 안내). 연락처(phone)는 서버가 본인 확인 방식을 정한 뒤 열림 — 칸을 잠그고 보내지 않는다(보내면 400) |
| 고객센터 | SCR-SUPPORT-001, CHAT-001 | 고객용 경로 없음(case `cs-intakes` 는 운영자 접수). `[결정 필요]` 상담 채널 | |

비회원: 둘러보기·장바구니까지. 주문서부터 로그인.

## 2. 화면별 핵심 규칙

**로그인·동의** (C 672-845)
- 사용자 취소 → 원래 화면 복귀·장바구니 유지. 제공자 장애 → 재시도. `AUTH_UNKNOWN` → 원인증 조회.
- 423 `AUTH_RESTRICTED`(15분 5회 → 10분): `retryAfterSeconds` 표시. 사용자 취소·제공자 장애는 횟수 제외(서버 판정).
- 같은 이메일로 계정 병합 안 함. 필수/선택 동의 분리, 선택 거부해도 구매 가능. 동의·앱 알림 설정·OS 권한은 서로 다른 값.
- 일반 로그인 후 회원 장바구니로 전환(자동 병합 없음). 주문서에서 로그인(`purpose=CHECKOUT`)하면 병합 확인 화면.
- 실서버 제공자는 Google 만(백엔드 ADR-0019, 2026-10-30). `google_sign_in` 으로 ID 토큰 → `providerToken`. serverClientId = 백엔드 안내의 웹 클라이언트 ID(`--dart-define=PMART_GOOGLE_SERVER_CLIENT_ID` 로 바꿀 수 있음). Android OAuth 클라이언트(패키지 `com.pmart.customer_app` + 서명 SHA-1) 등록 필요. 카카오·네이버 버튼은 실서버 모드에서 숨김(501). 애플은 Android 만 개발이라 없음(ADR-0002).
- 마이페이지 탭에 로그인 제공자·계정(제공자 SDK 의 이메일, 기기 화면에만, 저장 안 함)을 보인다. 목 계정은 `mock-…@pmart.invalid`. 앱 재시작으로 복원한 세션은 계정 표시가 없다.
- 목 모드는 앱 모서리 "목 데이터" 띠와 로그인 화면 안내로 표시한다(목 로그인은 제공자 창 없이 항상 성공).
- 앱 시작 때 저장된 refresh token 이 있으면 `GET /auth/sessions/current` 로 세션 복원(서버가 확인한 CUSTOMER 만 회원). 로그아웃은 토큰 삭제 + Google 계정 선택 해제(서버 `POST /auth/logouts` 는 아직 부르지 않음).

**주소** (C 847-957)
- 검색 → 지도 확인 → 상세주소·출입 안내·라이더 요청 → 구분 → 기본 지정 → 저장. 위치 권한 거부 시 직접 검색 유지.
- "주소 저장 성공"과 "배송 가능 판정"을 따로 표시: 가능 / 지역 외 / 운영시간 외 / 센터 제한 / 확인 중 / 확인 실패.
- 쇼핑 주소 변경 시 장바구니를 비우지 않고 재검증, 구매 불가 품목은 사유 표시·선택만 막음.
- 결제 후 주소·연락처·요청사항 변경 불가. 입력 길이 상한은 하드코딩 금지(`[결정 필요]` C 881).

**홈·목록·검색** (C 971-1218)
- 영역별 부분 실패는 그 영역만 재시도. 진행 주문 조회 실패를 "주문 없음"으로 표시하지 않음.
- 일시품절은 목록 뒤·담기 막음, 판매중지는 제외. 정렬: 기본·인기·신규·가격↑↓·별점(할인율순 없음).
- 필터는 임시 선택(적용/초기화/닫기 = 기존 유지), 결과 0개면 적용 막음. 연속 검색은 마지막 요청만 반영. 상세에서 복귀 시 검색어·필터·스크롤 복원.

**상품** (C 1068-1250)
- 카드: 이미지·이름·규격·기본가·100g/100mL당 가격·별점·리뷰 수·남은 수량·`+`. "1개 남음"은 안내일 뿐 확보 아님.
- E(낱개)/B(밀봉 묶음) 별도 SKU. 같은 기초상품 낱개 환산 합계 10개 상한(장바구니 포함, 서버 검증).
- 리뷰 집계 실패를 0점·0건으로 표시하지 않음.

**장바구니** (C 1265-1393)
- 수량은 절대값 설정(합산 아님), 서버 확정값만 반영(`cartVersion`). 상태 `CART_STABLE / CHANGE_PENDING / CHANGE_UNKNOWN`.
- 선택 해제 ≠ 삭제. 1에서 `-` 는 삭제 확인. 합계는 선택된 구매 가능 품목만.
- 배지 숫자의 의미 `[결정 필요]`(C 1301).
- "주문하기"(장바구니) ≠ "결제하기"(PG 진입).

**배송 방식·슬롯** (C 1514-1597)
- 한집 / 알뜰 / 예약. 주문서 진입 전 선택, 주문서의 "변경"은 이 화면으로.
- 예약은 서버가 준 오늘·내일 1시간 구간만, 마감 구간 비활성. 00~08시 도착 슬롯 없음(심야에도 이후 시간 예약 가능).
- 슬롯 조회 실패는 자동 재시도 없이 "다시 조회". 슬롯 선택 ≠ 확보.

**주문서·결제** (C 1599-1849, O 245, saga)
- 표시: 품목, 방식·시간, 주소, 라이더 요청, 연락처·안심번호, 품절 시 처리(품절만 취소/전체 취소 + 다음에도 적용), 상품액·배달팁(무료 사유)·봉투값·총액, **견적 만료와 재고 예약 만료 각각**.
- 결제 버튼은 서버가 전 품목 예약·슬롯·여력·무료배달 자격 확보를 회신했을 때만(`OrderDraft.nextAction=PAY`, `resources.*`).
- 금액이 바뀌면 전후 비교 + 재동의(`RE_QUOTE_REQUIRED` 422).
- 결제 진행 문구: 결제 준비 중 → 결제 인증 중 → 결제 결과 확인 중 → 주문 완료 / 결제 실패 확인 / 결제 승인·주문 복구 중 / 취소·환불 확인 중.
- **결제창 복귀·인증 성공·PG 승인 어느 것도 "주문 완료"가 아니다.** `GET /order-drafts/{id}` 가 `orderId` 와 확정 상태를 줄 때만 완료 화면.
- 뒤로가기·새로고침·연타·재실행은 같은 결제 시도를 조회. 결과 불명(`PAYMENT_UNKNOWN`) 동안 "다시 결제" 금지. 앱 시작 시 진행 중 초안·주문을 서버에서 확인.

**주문·배송** (C 1851-1976)
- 상세는 주문 당시 스냅샷 + 원천별 `asOf`. 10,000g 초과는 분할배송: 배송별 품목·ETA·상태.
- 품목·배송 품목·주문서 품목은 주문(초안) 당시 상품명·옵션 사본(BR-35, `OrderLine`/`DraftLine.productName`·`optionLabel`)으로 보인다. 사본이 비어 오면(조회 실패·2026-11-02 이전 주문) 주문서는 장바구니 이름, 주문 상세는 sku 로만 대신한다 — 현재 상품명으로 채우지 않는다.
- 처리 내역(취소·반품·교환)은 `GET /claims?orderId=` 로 받아 "종류 · 상태 · 접수 시각"으로 보이고 줄을 누르면 처리 내역 화면. 주문 응답의 `claims` 는 서버가 아직 비워 보낸다(2026-10-31 안내 §6). 내역이 없으면 영역을 두지 않는다. 조회 실패 문구(+ 다시 확인)는 취소된 주문(`CANCELLED` 또는 응답 `claims` 있음)에서만 보인다 — 취소하지 않은 주문마다 실패 문구가 뜨지 않게(2026-11-03 사용자 요청). 그 대가로 취소 확정 전(`CONFIRMED` + 클레임 접수 중) 주문의 조회 실패는 보이지 않는다.
- 위치 조회 실패 ≠ 배송 실패. 다른 고객 주소·전체 동선 비노출.
- "같은 상품 담기"는 현재 조건 새 담기(과거 무료배달 승계 없음).

**예약시간 변경**: `상품준비`(PREPARING) 전만. `PENDING/CONFIRMED/REJECTED/UNKNOWN`, 불명이면 "변경 확인 중", 옛 시간·새 시간을 동시에 확정 표시하지 않음.

**취소·반품·교환** (C 1978-2158)
- 취소 버튼 = 요청 접수. 인계된 수량은 반품·회수로 연결(`NOT_CANCELLABLE`, `PARTIALLY_CANCELLED`).
- 기한(서버 판정, Asia/Seoul): 일반 7일, 신선 24시간, 하자·오배송·광고 상이 교환 3개월 또는 인지 30일. 교환 왕복 9,000원(단순 변심), 상품·배달 문제 0원. 회수·재배달 주소는 원주문 주소 고정.
- 품목별 승인/거절, 수거 수량과 반납 수량을 각각 표시. 철회는 심사 전까지, 그 사이는 "철회 확인 중". 첨부 성공 ≠ 접수 성공.
- 환불은 서버가 준 승인액·성공액·진행/불명액·잔액을 그대로 표시(앱 계산 금지). PG 성공 전 "완료" 표시 없음.

**리뷰**: 품목별 배송완료 후 14일, 1건, 최초 등록 3일 미만 수정, 삭제 후 재작성 불가. "리뷰 쓰기"/"내가 쓴 리뷰" 분리. **사진**(review 0.2.0, 2026-11-16): 작성 화면 "사진 n/5" 칸(레퍼런스 11 "리뷰 쓰기"의 사진 칸) → 사진첩·카메라(image_picker, 긴 변 2,048px·품질 85) → 고르면 바로 한 장씩 `POST /review-photos`(칸마다 자기 키, 결과 불명은 같은 키로 "다시 올리기"). 리뷰당 5장·장당 10MB(JPEG·PNG·WEBP — 서버 판정). 못 올린 사진이 있으면 등록을 막고 다시 올리기·빼기를 묻는다(올라간 것만 몰래 보내지 않음). 미리보기는 기기 원본, 공개 리뷰의 사진은 `photos[].url`(게이트웨이 상대 경로, 토큰 없이). 자격의 `productName`(주문 당시 이름)을 쓴다. **수정·삭제**(백엔드 요청 `customer-app/2026-11-16-request-review-edit-delete`, 2026-11-16): "내가 쓴 리뷰" 카드 → "내 리뷰"(`/reviews/mine/{id}`, 작성자 ID 가 응답에 없어 여기서만 연다) 아래 삭제·수정. 수정은 서버 상태 `PUBLISHED` 일 때만, 기한은 서버 `editableUntil` 그대로, `LOCKED` 면 막고 "등록 후 3일이 지나 고칠 수 없어요". `PATCH` 는 `X-Expected-Version` = 상세 `version`, 바뀐 것만(아무것도 안 바뀌면 보내지 않음 — 서버 400), 사진이 그대로면 `photoIds` 를 빼고, 바꾸면 그 목록으로(붙은 사진은 서버 주소로 칸에, 새 사진은 먼저 올림). `INVALID_STATE`·`VERSION_CONFLICT` 는 안내 + "다시 불러오기"(저장 막음). 삭제는 확인 창("삭제하면 이 상품의 리뷰를 다시 쓸 수 없어요.") 뒤 `DELETE`. 둘 다 결과 불명이면 같은 키·같은 본문으로만 "다시 확인".

**알림**: 탭 → 최신 상태 화면(준비·출발·곧 도착→배송현황, 완료→주문상세, 리뷰→작성 목록, 취소·환불→처리내역). 읽음 ≠ 수령. 거래 안내는 끌 수 없음. 서버 알림함 notification 0.2.0(2026-11-16): 앱 알림함만(푸시 없음 — 화면을 열 때·앱이 다시 앞에 올 때 다시 읽는다), 고객센터 답변 알림 목적지 `INQUIRY` → 내 문의 상세.

**탈퇴**: 재인증 → 접수 → 미결 의무 있으면 "탈퇴 처리 대기"+사유, 신규 구매 차단(조회·고객센터 유지). 대기 중 철회 가능, 마케팅 동의는 자동 복원 안 함.

## 3. 금액 표시 규칙 (서버 값 표시, 클라이언트 검증은 안내용)
| 규칙 | 값 |
|---|---|
| 최소 주문 | 순수 상품액 15,000원. 부족 시 "얼마 더 담기" + PG 진입 막음 |
| 배달팁 | 한집 4,000 / 알뜰·예약 3,000. 상품액 30,000원 이상 또는 첫 구매 0원(중복 차감 없음). 분할배송 추가 없음 |
| 봉투값 | 주문당 100원 1회 |
| 첫 구매 무료 | "적용 예상 / 다른 주문에서 적용 확인 중 / 적용 확정 / 적용 불가" 4가지(C 1490-1512) |
| 부분 품절 | 15,000원 미만이 돼도 재결제·배달팁 추가 없음 |
| 타이머 | 가격 동결 10분과 재고 예약 10분은 별개. 더 이른 만료를 안내. 재진입 시 타이머 재시작 금지. 앱 타이머로 확보 해제 금지 |

## 4. 상태 → 고객 문구 (잠정, BR-12)
| `OrderStatus` | 문구 |
|---|---|
| DRAFT / RESOURCE_PENDING | 주문 확인 중 |
| PAYMENT_PENDING | 결제 진행 중 |
| PAYMENT_UNKNOWN | 결제 결과 확인 중 |
| CONFIRMED | 주문 확인 |
| PREPARING | 상품 준비 중 |
| PARTIALLY_HANDED_OVER | 배송 준비 |
| IN_DELIVERY | 배송 중 |
| PARTIALLY_DELIVERED | 일부 전달 |
| COMPLETED | 배송 완료 |
| CANCELLED | 주문 취소 |
| EXPIRED | 주문 시간 만료 |

## 5. `[결정 필요]` (UI 영향)
입력 길이·주소록 상한, 장바구니 배지 의미, 남은 수량 노출 임계값, "마지막으로 둘러보기" 단계 여부, 안심번호, 08/09시 개시·슬롯 정원, 일반 취소 마감, 반품비·환불 시점, 리뷰 사진 제한, 첨부 제한, 상담 채널, 알림 문구·잠금화면 노출, 주문 조회 기간, 약관 구성, 주류 판매(PG 인증).

## 고객센터 — 문의·AI 상담 (2026-11-15)
백엔드 요청 2026-11-09 `customer-inquiry-page`·`customer-chat-assistant`. 코드 `lib/features/support/`. **회원만**(비회원은 로그인 안내). 실서버 연결 코드 있음(`PMART_ENV=local` 이면 LAN API) — LAN 에서 사람이 눌러 본 확인만 아직.
- 들어오는 곳: 마이페이지 "고객센터"(`/support`), 주문 상세 "문의하기"(주문을 고른 상태로 문의 남기기), AI 상담의 "고객센터에 문의 남기기".
- **고객센터 메인** `/support`: "무엇을 도와드릴까요?" + AI 채팅 상담 / 문의 남기기 / 내 문의 내역(레퍼런스 9-2 "3-1. 문의하기" 모양). 상담사 실시간 연결은 없다(2026-11-09 결정).
- **문의 남기기** `/support/inquiries/new` → `POST /inquiries`(case-service 0.2.0): 종류 7가지(주문·배송·결제·환불·상품·회원·기타) 필수, 제목(선택, 100자), 내용(1~2000자), 주문(선택 — 주문 상세에서 오면 붙어 있고 뺄 수 있다. 없으면 "주문 고르기"로 내 주문 목록 `GET /orders` 첫 쪽에서 고른다 — 고르면 종류가 비어 있을 때 "주문"으로), `origin`(문의 페이지 / AI 상담에서 넘어옴).
  - 접수일 뿐 취소·환불을 실행하지 않는다. 사진 첨부 없음(1차). 답변이 달리면 알림함에 "문의에 답변이 등록되었어요"(notification 0.2.0, 목적지 INQUIRY → 이 문의 상세).
  - 결과를 모르면(타임아웃·5xx·503) 내용을 잠그고 "접수됐는지 다시 확인" — **같은 키·같은 본문**으로 다시 보낸다(서버: 같은 키 = 같은 문의). 422 `ORDER_NOT_FOUND` 는 "주문을 빼고 다시".
- **내 문의** `/support/inquiries`(`GET /inquiries`, 최근 순, "더 보기") · 상세 `/support/inquiries/:inquiryId`(`GET /inquiries/{id}` — 상태 접수/답변 완료/종료, 본문, 답변). 당겨서 새로 고친다(답변 알림은 알림함에만 — 푸시 없음). 이어 쓰기는 없다(새 문의로). 조회 실패는 "문의 없음"이 아니라 오류.
- **AI 채팅 상담** `/support/chat` → `POST /customer-assistant/questions`(customer-assistant-service 0.1.0, 질문 1~500자):
  - 처음에 상담 종류를 고른다(레퍼런스 고객센터 2-1·2-4): **일반 문의** / **주문 건에 대한 문의**. 고르기 전에는 입력 칸이 막혀 있다. 주문 건이면 `GET /customer-assistant/recent-orders`(최근 5개)를 "날짜 / 주문 번호" 버튼으로 보이고, 고르면 상담센터 말풍선이 바로 답한다 — 고른 주문 카드(서버 상태·도착 예정) + "궁금한 점을 적어 주세요, 취소·반품 신청은 주문 상세에서" + "주문 상세 보기"(사용자 2026-11-16 "주문 고른 뒤 연결이 안 된다"; 질문을 대신 보내지 않는다). 고른 주문을 그 뒤 질문마다 `orderId` 로 붙인다(입력 칸 위 "주문 … 에 대해 묻고 있어요 · 종류 바꾸기"). 조회 실패는 오류 + 다시 시도, 주문이 없으면 안내 + "일반 문의로 물어보기". 종류는 화면 안 구분일 뿐 서버에 보내지 않는다.
  - 대화는 한 줄 시간순(사용자 2026-11-16): 고른 종류·주문은 고른 자리에 남고, 질문·답은 그 아래로, "종류 바꾸기"로 다시 고르는 선택지는 맨 끝에 나온다(전에는 선택 칸이 맨 위 한 자리라 새 선택이 앞 대화보다 위에 나오고 앞 선택은 지워졌다).
  - 질문 하나씩 답한다(앞 질문을 기억하지 않는다 — 화면에 안내). 대화는 앱 실행 동안만 메모리에 두고 계정이 바뀌면 비운다.
  - 새 질문 = 새 `Idempotency-Key`. 202 `PROCESSING` 이면 2초 간격으로 3번까지 같은 키로 다시 묻고, 그래도 안 되거나 응답을 잃으면 "다시 확인"(같은 키 — 요청 제한에 세지 않는다). `GET ?requestId=` 는 쓰지 않는다.
  - 상태별: `ANSWERED` 답만(서버가 주는 근거 `citations` 는 고객에게 보이지 않는다 — 사용자 2026-11-16 "개발 단계라도 근거 보기는 안 나왔으면") / `NO_GROUNDING` 답 + 문의 남기기 / `REALTIME_DATA_REQUIRED` 최근 주문 카드 — 고르면 같은 질문을 `orderId` 와 함께 **새 키로** / `ORDER_STATUS` 답 + 주문 카드(서버 `statusLabel`·도착 예정 시간대) + 문의 남기기 / `OUT_OF_SCOPE`(취소·환불·반품 같은 실행 요청) 답 + 바로 아래 최근 주문 카드(`GET /customer-assistant/recent-orders` 최대 5개 — 누르면 주문 상세, 거기서 취소·반품 신청은 서버 판정. AI 는 취소하지 않는다, 사용자 2026-11-16) + 주문 내역 + 문의 남기기. 주문 조회 실패는 오류 + 다시 시도.
  - 문의 남기기 버튼은 질문을 문의 본문 초안으로 넣고 `origin = ASSISTANT_HANDOFF`, 주문이 있으면 그대로 넘긴다.
  - 429 `RATE_LIMITED`(1분 5개·하루 50개): 서버 `detail` 문장을 그대로 보이고 문의 남기기 버튼을 둔다. 422 `CONFIG_REQUIRED`·`ORDER_NOT_FOUND`, 403 은 각자 안내.
  - 답변·주문 상태 문장은 서버 값 그대로(일반 텍스트). 앱이 지어내지 않는다.
- 레퍼런스와 다른 점(2026-11-15 나란히 비교): 상담센터 머리줄·인사 말풍선·시각 표시·"상담종료"·만족도 조사 없음(상담사 연결이 없고 브랜드 문구라 넣지 않음), 내 말풍선은 연보라(브랜드색), 최근 주문 버튼에 센터 이름 없음(계약 `OrderBrief` 에 없다), 사진 버튼 없음(첨부 없음).
- 안 만든 것: 답변 다시 보기(`GET …/{answerId}`) — 고객 질문 목록 API 가 없어 다시 열 곳이 없다(결과 불명은 같은 키 POST 로 확인). 대화 기록 저장.
