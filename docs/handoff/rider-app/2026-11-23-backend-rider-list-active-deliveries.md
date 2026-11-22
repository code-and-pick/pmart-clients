# 라이더 목록에 진행 중 배송 수

보낸 앱: rider-backoffice (PC 5)
받는 백엔드 영역: delivery (rider-service, 사본 출처는 delivery-execution)

- 작성: 2026-11-23
- 사용자(2026-11-23): 라이더 관리 목록 각 줄에 그 라이더가 지금 맡은 배송 수를 보이고 싶다. 누르면 그 라이더로 거른 배송 관리 화면으로 간다. 배송 관리와 라이더 관리가 어떻게 이어지는지 목록에서 바로 보이게 하려는 것이다.

## 지금 계약으로 안 되는 까닭
- rider `OperatingState.activeDeliveryCount`(execution 사본)는 본인 `GET /riders/me/state` 에서만 준다.
- 직원용 `GET /riders`(`StaffRiderSummary`)에는 이 값이 없다.
- execution `GET /deliveries?riderId=` 는 라이더 한 명씩이다. 한 쪽 20명이면 요청이 20번 나간다.
- tracking `GET /rider-locations?mfcId=` 의 `activeDeliveries` 는 센터 하나의 운행 중 라이더만 준다. "모든 센터"로 보면 센터 수만큼 불러야 한다(지금 2곳, 계획 26곳).

## 바라는 것
- `StaffRiderSummary` 에 `activeDeliveryCount: integer` 를 더해 주세요.
  - 진행 중 배송 수(execution 사본)이며, `OperatingState.activeDeliveryCount` 와 같은 기준이다.
  - 사본이면 갱신 시각이나 기준을 설명에 적어 주세요.
- 목록(`GET /riders`)과 `riderIds=` 묶음 조회 모두에서 주면 된다.
- 화면은 값이 없으면(옛 응답) 칸을 비우고 0 으로 바꾸지 않는다. 숫자를 누르면 `/deliveries?riderId=<라이더 번호>` 로 간다.
