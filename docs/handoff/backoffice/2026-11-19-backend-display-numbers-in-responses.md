# 클레임·라이더 컴플레인·문의 응답에 화면 번호 넣기 요청 (ADR-0070 이어서)

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: backoffice (case-service — 라이더 컴플레인·문의), platform (claim-service — 클레임)

- 근거: 사용자 2026-11-19 "백오피스 보충이 더 필요해 보이는 UI·UX" → "순서대로 진행". 화면 번호(ADR-0070)가 늦게 채워지는 문제.
- 지금(#151·#160): 이 세 응답에는 화면 번호가 없어 **줄마다** 따로 조회해 붙인다 — 목록 50줄이면 요청이 최대 50개(주문은 `GET /orders/lookups?orderId=` 한 건씩, 배송은 `GET /deliveries/{id}` 한 건씩, 라이더만 `GET /riders?riderIds=` 일괄).
  화면에는 번호가 한 박자 늦게 채워지고(그 사이 "ID 끝 8자리"), 실서버에서는 목록을 열 때마다 서버 부담이 크다.

## 요청

응답의 시스템 ID 옆에 화면 번호를 같이 준다(bff `views/*` 가 이미 주는 모양과 같게 — 없으면 `null`, 원천을 못 읽으면 그 칸만 `null` + `unavailableSources`).

| 응답 | 지금 있는 ID | 더해 줄 것 |
|---|---|---|
| claim `GET /claims`·`GET /claims/{claimId}` | `orderId` | `orderNumber` |
| case `GET /rider-complaints`·`GET /rider-complaints/{id}` | `riderId`·`deliveryId`·`orderId` | `rider { riderNumber, nameMasked }`·`deliveryNumber`·`orderNumber` |
| case `GET /inquiries/{inquiryId}` | `riderId`·`orderId`·`deliveryId` | `rider { riderNumber, nameMasked }`·`orderNumber`·`deliveryNumber` |

- 번호는 각 원천의 정본 값 그대로(만들지 않는다). 사본으로 들고 있기 어렵다면 bff 화면용 조회(예 `views/claims`)로 묶어 줘도 된다 — 그쪽이 맞다면 알려 달라.

## 열리면 클라이언트가 할 것

- 세 화면의 줄마다 조회(`useOrderNumbers`·`useDeliveryNumbers`)를 지우고 응답 값을 바로 쓴다. 라이더 일괄 조회도 응답에 있으면 뺀다.
- 못 읽음은 지금처럼 "번호 확인 불가", 번호 없음은 "번호 없음" — 0·빈칸으로 바꾸지 않는다.

## 질문

1. 클레임은 claim-service 가 주문번호를 들고 있게 할지(주문 만들 때 사본), bff 에서 묶을지 — 어느 쪽인지.
2. 라이더 가린 이름(`nameMasked`)을 case-service 가 들고 있어도 되는지(개인정보 범위). 안 되면 `riderNumber` 만이라도.
