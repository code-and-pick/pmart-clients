# [pmart-clients → pmart-backend] 회신: 주문 상세 개인정보 열람 + 처리 대기 메뉴 (2026-11-16)

- 보낸 앱: backoffice
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-15-request-order-pii-reveal.md`, `../pmart-backend/docs/handoff/clients/all/2026-11-15-request-permission-and-pending-menus.md` §2

## 1. 주문 상세 — 가린 값 + 사유 열람 (order 0.4.0·0.5.0)
- 상세는 서버가 가린 값을 그대로 보인다. 출입 메모·배송 요청사항(null)은 "가림". 예전 "보기"(화면 안 토글)는 지웠다.
- "원문 열람": 항목(`NAME`·`PHONE`·`ADDRESS`·`ENTRANCE`, 기본 넷 다 — 하나씩 끌 수 있다) + 사유 2~200자 → `POST /orders/lookups/{orderId}/pii-reveals`(`Idempotency-Key`·`X-Source-System`). 응답의 고른 항목만 원문, 나머지는 가린 값. `ENTRANCE` 면 응답 최상위 `deliveryNote` 도.
- 원문은 화면 메모리에만(저장·로그·URL 없음). "다시 가리기"나 화면 이동이면 사라진다. 열람 기록 ID·시각을 보인다.
- 503(`DEPENDENCY_UNAVAILABLE`·`UNKNOWN_RESULT`)·연결 끊김은 원문 없이 "같은 요청으로 결과 확인" — **같은 키·같은 본문**으로 다시 보낸다. 400·403·404(`ORDER_NOT_FOUND`·`SHIPPING_COPY_NOT_FOUND`)는 문구로.

## 2. 처리 대기 — 이행 확인 필요 (order 0.6.0, OPERATOR_ADMIN)
- 메뉴 묶음 "처리 대기"(OPERATOR_ADMIN 만) → `/pending/fulfillment-issues`. `GET /fulfillment-issues?state=` — 센터 입력을 비우면 `mfcId` 없이(모든 센터), 넣으면 그 센터만. 상태 탭 OPEN·ACKNOWLEDGED·RESOLVED(URL 쿼리). 주문 번호 → 직원 주문 상세.
- "확인 처리": 메모 1~500자(개인정보를 적지 말라는 안내) → `POST /fulfillment-issues/{issueId}/acknowledgements`. 확인은 표시만이라고 화면에 적었다.
- 멈춘 주문 조치·인계 재시도·현장 중지 재시도: "준비 중" 목록만(버튼 없음).

## 3. 확인·빌드
- typecheck·lint 통과, 테스트 181개 통과(목 모드 — 열람 항목·헤더·503 같은 키, 처리 대기 목록·센터·확인·실패). 실서버 확인은 아직.
- 빌드: `archive/2026-11-16-backend-session-roles-centers-done.md` §2 표의 backoffice 해시를 이 변경까지 담은 것으로 바꿨다(`index-BEI3dP9H.js`·`index-CfStOUC1.css`).
- 아직 안 한 것: 개인정보 열람 기록 조회 메뉴(`backoffice/2026-11-16-notice-pii-access-log-api.md`).

## 닫음 (2026-11-18 PC 2)
- LAN 원문 열람 확인(관리자 계정, 사용자 승인): 주문 확정 주문 상세에서 연락처 한 칸만 사유 "PC 2 실서버 원문 열람 확인"으로 열람 → 원문 표시 + 열람 기록 번호·"이 화면을 떠나면 다시 가려져요" 안내. 개인정보 열람 기록 목록 맨 위에 같은 건(관리자·고객·연락처·보기·ORDER 연결·사유)이 남음. 원문 값은 기록·대화에 옮기지 않음. → archive.
