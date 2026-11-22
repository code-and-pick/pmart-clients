# 라이더 배달 지역 바꾸기 — 서버 확인 두 가지

보낸 앱: rider-app (PC 5)
받는 백엔드 영역: delivery (rider-service)

- 작성: 2026-11-23
- 사용자 결정(2026-11-23): 이사했거나 다른 지점 근처로 옮긴 라이더는 마이페이지에서 배달 지역을 바꿀 수 있다.
  - **운행을 쉴 때만** 바꿀 수 있다.
  - 배달 지역은 **한 곳만** 둔다.
  - 바꾸면 **바로 반영**한다(운영자 승인 없음).
- 앱이 쓰는 API: `PATCH /riders/me` 의 `deliveryAreas: [{ mfcId }]`. 지금 계약 그대로이며 새 필드는 없다. `X-Expected-Version` 은 `GET /riders/me` 의 `version` 이다.
- 앱 쪽 처리: 운행 중이거나 진행 중 배송이 있으면 앱이 먼저 막고 안내한다. 운행을 새로 시작할 때는 `PUT /riders/me/state` 의 `mfcId` 를 비워 보낸다(아래 2번).

## 1. 운행 중 배달 지역 변경을 서버도 막아 주세요
- 지금 `RiderService.update` 는 `deliveryAreas` 를 운행 상태와 상관없이 바꾼다(`store.replaceAreas`).
- 앱이 막아도 오래된 앱이나 동시 요청으로 바뀔 수 있다. 운행 중에 바뀌면 `operating_mfc_id` 가 배달 지역 밖이 된다. 그러면 dispatch 후보 조회(`eligible` = `rider_delivery_area.mfc_id`)에서 빠지고, 이미 운행 중인 라이더는 지금 지점 배차를 갑자기 못 받는다.
- 바라는 동작: `ON_DUTY` 이거나 진행 중 배송이 있으면 `409 INVALID_STATE` 로 거절. 앱은 이 코드를 받으면 "운행을 종료한 뒤 배달 지역을 바꿀 수 있어요"를 보인다.
- 계약 `updateMyRider` 409 설명에 "배달지역 변경은 운행 중이면 INVALID_STATE" 를 더해 주세요.

## 2. 쉬는 동안 남은 `operatingMfcId`
- `OFF_DUTY` 로 바꿔도 `operating_mfc_id` 는 예전 지점이 남는다(`OperatingRules.decide` OFF_DUTY → `rider.operatingMfcId()`).
- 지난 앱은 운행을 시작할 때 그 값을 `mfcId` 로 보냈다. 배달 지역을 바꾼 뒤에 그렇게 보내면 `MFC_NOT_IN_AREAS` 로 거절된다. 그래서 앱(2026-11-23 판)은 운행을 새로 시작할 때 `mfcId` 를 비워 보낸다. 그러면 서버가 배달 지역 첫 MFC 로 정한다.
- 아직 업데이트하지 않은 앱을 위해, 배달 지역을 바꿀 때 `operating_mfc_id` 를 새 지역(또는 NULL)으로 맞춰 주면 좋겠다. 아니면 OFF_DUTY 일 때 `GET /riders/me/state` 의 `mfcId` 를 null 로 줘도 된다. 어느 쪽인지 알려 주세요.

## 3. (물음) 없는 지점·운영하지 않는 지점
- 지금 `deliveryAreas[].mfcId` 가 center-master 에 있는 운영 중 MFC 인지 서버가 확인하는지 알려 주세요.
- 앱은 `GET /mfc-pickup-points` 목록에서만 고르게 한다.
- 확인하지 않는다면, 없는 지점을 보냈을 때 거절(`422` 등)하고 그 코드를 알려 주세요.
