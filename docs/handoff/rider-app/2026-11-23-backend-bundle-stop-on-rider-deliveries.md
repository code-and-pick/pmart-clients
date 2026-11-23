# 라이더 배송 조회에 알뜰 묶음·방문 순서

보낸 앱: rider-app (PC 5)
받는 백엔드 영역: delivery (delivery-execution `GET /riders/me/deliveries`·`GET /deliveries/{id}` — 값은 dispatch Assignment)

- 작성: 2026-11-23
- 사용자(2026-11-23): "가게가 하나고 알뜰배달 2건이면 가게는 한 번에 가서 2개 동시에 픽업하고 1번째 고객 - 2번째 고객 전달 이렇게 돼야지."

## 앱이 한 것 (지금 계약으로)
- 같은 가게의 픽업 전 배송을 한 번에 처리한다. 서버 명령은 배송마다 따로 보낸다.
  - 가게 도착 한 번 → 배송마다 `store-arrivals`
  - QR 한 화면에서 모든 포장
  - 모두 인계 확정되면 배송마다 `pickups`
- 픽업 뒤에는 방문 순서가 앞인 고객부터 연다. 전달 완료 카드를 닫으면 다음 고객으로 간다.
- 방문 순서는 제안의 `stopSequence`(dispatch Offer)를 **수락할 때 앱 메모리에 받아 둔다**.

## 문제
- 수락 뒤에는 라이더가 읽을 수 있는 곳에 묶음·방문 순서가 없다.
  - `DeliveryExecution` 에 `bundleId`·`stopSequence` 가 없다.
  - dispatch `Assignment` 에는 있지만 라이더용 경로가 없다.
- 그래서 앱을 다시 켜거나 다른 기기로 로그인하면 순서를 잃는다. 그때는 진행 중 목록 순서로 간다.

## 바라는 것
- 라이더 본인이 읽는 `GET /riders/me/deliveries` 와 `GET /deliveries/{deliveryId}` 응답에 다음을 넣어 주세요.
  - `bundleId`: 알뜰 묶음, 묶음 아니면 null
  - `stopSequence`: 묶음 안 고객 방문 순서(1부터), 묶음 아니면 null
- 값은 배정 때 dispatch Assignment 의 값 그대로면 된다.
- 넣어 주시면 앱은 그 값을 먼저 쓰고, 없을 때만 수락 때 받아 둔 값을 쓴다.
