# [pmart-clients → pmart-backend] 요청: 라이더 전달지 정확 좌표 — 고객 주소에 좌표가 없을 때도 (2026-11-18)

- 보낸 앱: rider-app (PC 5) — rider-backoffice 관제 전달지(drop-location)도 같은 문제
- 받는 백엔드 영역: delivery (delivery-execution `drop-info`·`drop-location`, delivery-dispatch 지오코딩 좌표) — 필요하면 platform(customer 배송지 저장)
- 근거: 사용자 2026-11-18 실서버 고객앱 실주문 74089765(부산 부산진구 중앙대로 672 — 삼정타워) "전달지가 해외로 찍힌다" → "좌표로 핀을 찍게 해야지(방어 코드는 꼼수)".

## 무슨 일이었나
1. 라이더 앱을 새로 설치한 뒤 진행 중 배송을 열자 제안 때 받은 좌표(메모리)가 없었고, 시험 MFC 가 앱 지점표에 없어 앱이 픽업지를 **0,0 으로 지어냈다**(앱 버그 — 고침: 수락한 제안 `GET /offers?state=ACCEPTED`·서버 `GET /mfc-pickup-points` 에서 되살리고, 없으면 null).
2. 전달지 정확 좌표(`drop-info` lat·lng)는 **null** — 고객이 주소를 지도 핀 없이 저장하면(customer 배송지 `geo` 선택값) 주문 당시 사본(O-5)에 좌표가 없다. 그래서 라이더는 dispatch 제안의 **대략 좌표(약 1km 격자)**로만 핀을 찍게 됨 — 실제 삼정타워보다 남쪽에 찍힘.

## 요청
| # | 무엇 | 왜 |
|---|---|---|
| 1 | `GET /deliveries/{id}/drop-info`(라이더)·`GET /deliveries/{id}/drop-location`(직원)이 주문 사본에 좌표가 없으면 **dispatch 가 도로명주소로 지오코딩한 정확 좌표**(delivery `drop_lat`·`drop_lng` — 배차할 때 이미 구함)를 lat·lng 로 준다. 어느 쪽 값인지 `coordinateSource`(ORDER_PIN / ADDRESS_GEOCODE) 같은 칸이 있으면 좋음 | 전달지 핀을 정확한 좌표로 — 지금은 대략 좌표뿐 |
| 2 | (근본) customer 배송지 저장 때 `geo` 가 없으면 서버가 도로명주소 지오코딩 결과로 채워 둔다 — 고객앱은 지도 핀을 안 고르면 좌표 없이 보냄 | 주문 사본부터 좌표가 있게 |

- 1 만 되어도 라이더 앱·관제는 클라이언트 변경 없이(같은 lat·lng 칸) 정확히 찍힌다. 2 는 1 을 대신하지 않음(옛 주소·옛 주문).
- 회신은 `../pmart-backend/docs/handoff/clients/rider-app/` 에서 읽겠습니다.
