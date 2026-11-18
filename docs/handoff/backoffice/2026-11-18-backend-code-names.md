# 화면에 코드 그대로 남은 값 — 값 목록과 짧은 뜻 요청

보낸 앱: backoffice
받는 백엔드 영역: mfc (fulfillment) · platform (backoffice-bff · order-orchestration · case · approval)
날짜: 2026-11-18

## 왜
사용자가 백오피스가 "직관적이지 않다"고 했다(2026-11-18). 화면을 다시 보니 가장 큰 원인은 **개발자 말이 그대로 보이는 것**이었다. 처리 대기 화면에 `STOCK_MISMATCH`·`ESCALATED`·`PDA_OFFLINE` 이 그대로 떠 있었다.

계약에 값 목록(enum)이나 설명이 있는 코드는 모두 계약 뜻 그대로 한국어 이름으로 바꿨다. 원래 코드는 마우스를 올리면 보인다. 아래 칸들은 계약이 **자유 문자열**이거나 **뜻 설명이 없어서**, 화면이 이름을 지어내지 않고 코드 그대로 둔 것이다.

받고 싶은 것은 칸마다 **나올 수 있는 값 목록 + 한 줄 뜻**이다. enum 으로 바꿔도 되고, description 에 표로 적어도 된다. 목록 밖 값이 올 수 있으면 그렇다고 적어 달라. 그런 값은 화면이 코드 그대로 보인다.

## 요청

### mfc (mfc-fulfillment-service)
- **C1. MFC 중지 실패 사유** — `StopRequest.lastError`(1844줄 "실패로 멈춘 사유"). bff pending-work `MFC_STOP_FAILED` 의 `reasonCode` 로도 온다. 목에서는 `PDA_OFFLINE` 을 썼다. 실제로 어떤 값이 오는지 알려 달라.
- **C2. 출고·작업 막힌 사유** — `blockReason`(1279·1427·1804줄). 포장 인계 현황·통합 조회 현장 작업 칸에 보인다.
- **C3. 인계 거절 사유** — 포장 `handoverRejectReason`(1835줄). bff `MFC_HANDOVER_REJECTED` 의 `reasonCode` 로도 온다. 337줄 설명의 `RECORD_MISMATCH` 밖에 어떤 값이 있는지 알려 달라.

### platform
- **C4. 이행 확인 필요 사유** — order `FulfillmentIssue.reason`(769줄 "QUALITY_HOLD·COUNT_LOSS·SHORT·DAMAGED 등 — inventory 사유 그대로"). "등"에 들어가는 나머지 값이 필요하다.
- **C5. 멈춘 주문 오류 코드** — order-orchestration `lastErrorCode`(421·480줄). bff `STUCK_SAGA` 의 `reasonCode` 로 온다. `PAYMENT_UNKNOWN` 말고 어떤 값이 오는지 알려 달라.
- **C6. 접수 건 우선순위** — case `Priority` enum `P1~P4`(1496줄). 화면은 P1 을 "긴급"으로 쓰고 있다. P2~P4 의 뜻(예: 높음·보통·낮음)과 기한·정렬에 쓰이는지 알려 달라. 뜻을 모르면 화면은 P2 같은 표기를 그대로 둔다.
- **C7. 승인 유형 `SUPPLY_BUSINESS`** — approval `ApprovalType`(506줄). 다른 유형은 이름을 붙였는데, 이것만 무엇을 승인하는지 계약에서 읽히지 않는다.

## 받으면 화면은
받은 이름을 `messages.ts` 이름표에 넣고 `CodeLabel` 로 보인다. 원래 코드는 마우스를 올리면 그대로 보인다. 받기 전에는 지금처럼 코드 그대로 보인다(지어내지 않는다).
