# 상품(SKU)별 결품률 요청 (백오피스 대시보드 지표)

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: mfc (mfc-fulfillment-service — 원천 피킹 줄), platform (backoffice-bff — 지표 조회로 묶을 때). 담당이 다르면 알려 주세요.
항목: BR-69

- 근거: 사용자가 2026-11-20 "상품별 SKU 결손률"을 물었다(대시보드 매출·통계 탭 지표).
- 지금 받는 것: bff 0.20.0 `GET /views/metrics?metric=SHORTAGE_RATE`(원천 mfc-fulfillment 0.19.0 `GET /metrics/picking-lines`, 요청 F-10).
  - 날짜·센터별 피킹 줄(`pickedLines`)과 결품 줄(`shortLines`), 사유(SHORT·DAMAGED·BLOCKED)별 줄.
  - **상품·SKU 로 나눈 값은 없다.** 그래서 "어느 상품이 자주 결품되나"를 화면이 보여 줄 수 없다.
  - 화면은 지금 전체 비율과 사유별 줄 수까지만 보인다(2026-11-20 목 모드 반영).
- 클라이언트가 직접 만들지 않는 이유: 결품 보고 목록(fulfillment 0.21.0 `GET /shortages`)을 다 읽어 SKU 로 세면 분모(그 SKU 의 피킹 줄)가 없다. 비율을 지어내게 되므로 서버 집계를 요청한다.

## 요청

### SK-1 SKU별 피킹·결품 줄 집계

- 원천 예: mfc-fulfillment `GET /metrics/picking-lines/by-sku?from=&to=&mfcId=&reason=&sort=&limit=`.
  - 기간은 지금 picking-lines 와 같다(피킹 시작 한국 날짜, 상한 92일).
  - `mfcId` 는 선택(본사 관리자는 모든 센터).
- 응답 줄마다:
  - `sku`, `productId`(있으면), 상품명 사본(있으면 — 없으면 화면이 상품 조회로 이름을 찾는다)
  - `pickedLines`(그 SKU 가 들어간, 피킹을 시작한 주문 줄 — 원래 주문 작업만, 재발송 제외, 지금 F-10 정의 그대로)
  - `shortLines`, `shortLinesByReason`(SHORT·DAMAGED·BLOCKED·SPOILED)
- 결품 줄이 0 인 SKU 는 빼도 된다(상위만 보여 준다).
- `sort`: `shortLines`(기본) 또는 `shortRate`. 비율 정렬이면 피킹 줄이 아주 적은 SKU 가 위로 오므로 `minPickedLines` 같은 하한을 두면 좋겠다. 하한 값은 백엔드가 정해 알려 달라.
- `limit`: 기본 10, 최대 50.

### SK-2 (선택) bff 지표로 묶기

- bff `GET /views/metrics` 에 SKU 묶음을 넣어도 되고, 대시보드가 원천을 바로 불러도 된다. 게이트웨이 경로·권한(OPERATOR_ADMIN, 그 밖은 자기 센터)만 알려 주면 된다.

## 화면 계획(회신 뒤)

- 대시보드 매출·통계 "지표" 칸 아래에 "결품 많은 상품 상위 N"을 둔다.
  - 줄마다 상품 이름·SKU, 결품 줄 / 피킹 줄, 사유별 줄 수.
  - 상품별 판매 상위와 같은 모양으로 그린다.
- 비율은 서버 분자·분모로만 계산한다. 분모가 0 이면 "—"를 보인다. 못 읽으면 "불러오지 못했어요"라고 쓰고 0 으로 보이지 않는다.
- 회신 전에는 이 칸을 만들지 않는다. 지금은 전체 결품률·사유별까지만 보인다.
