보낸 앱: rider-app
받는 백엔드 영역: delivery(rider-service·delivery-tracking·serviceability)
이어지는 문서: `rider-app/2026-11-23-backend-delivery-area-change.md`(배달 지역 바꾸기 — rider 0.23.0 으로 반영됨)

# 배달 지역 바꾸기는 그 지점 배달 가능 지역 안에 있을 때만 (2026-11-25)

## 사용자 결정
> "배달 가능 지역 내부에 있을 때만 해당 지역으로 권역 변경하게 해줘" (2026-11-25)

- 라이더가 마이페이지에서 배달 지역(MFC 지점)을 바꿀 때는, 라이더가 **지금 그 지점의 배달 가능 지역(serviceability 매핑) 안에 있어야** 한다.
- 지금 규칙(rider 0.23.0)은 그대로 둔다: 운행 중이거나 진행 중인 배송이 있으면 409 INVALID_STATE, 운영 중이 아닌 지점이면 422 MFC_NOT_AVAILABLE.

## 왜 앱만으로는 안 되나
- 계약에 "이 좌표가 어느 MFC 권역인지"를 라이더가 물을 길이 없다.
  - `POST /serviceability-checks` 는 주소로만 판정한다(ADR-0023, 요청 좌표 무시, TEST_ADDRESS 는 운영자만).
  - `GET /address-reverse-geocodes` 는 CUSTOMER·GUEST 전용이다.
- 앱에서만 막으면 우회할 수 있다. 바꾸는 명령(`PATCH /riders/me` deliveryAreas)에서 서버가 막아야 한다.

## 요청

### A-1. `PATCH /riders/me` deliveryAreas 바꿀 때 위치 검사(필수)
- 라이더의 최근 위치를 쓴다. delivery-tracking 이 받은 마지막 위치이고, 신선도 기준은 백엔드가 정한다(예: 5분 안). 이 위치가 바꿀 지점의 배달 가능 지역 안이 아니면 거절한다.
- 제안 오류 코드(이름은 백엔드가 정하면 앱이 맞춘다):
  - 422 `OUTSIDE_DELIVERY_AREA`: 지금 위치가 그 지점 권역 밖. details 에 지금 위치가 속한 mfcId(있으면).
  - 409 `LOCATION_UNKNOWN`: 최근 위치가 없거나 오래됨. 앱은 "위치를 켜고 잠시 뒤 다시" 안내.
- 같은 지점 목록을 다시 보내면(바뀌는 것 없음) 지금처럼 검사 없이 그대로 둔다.

### A-2. 지금 위치가 속한 지점 조회(권장)
- 앱이 화면에서 고를 수 없는 지점을 미리 흐리게 하고, 들어갈 수 있는 지점을 "현 위치" 로 보이게 하려는 것이다.
- 예: `GET /riders/me/location-area` → `{ mfcId: string|null, locatedAt: date-time|null }`.
  - mfcId null = 어느 권역에도 없음.
  - locatedAt null = 위치 모름.
- 조회 실패를 "권역 밖"으로 보이지 않는다(앱 규칙). A-1 이 정본이고, A-2 는 안내용이다.

## 앱이 할 일(계약이 오면)
- 배달 지역 바꾸기 화면(`apps/rider_app/lib/features/my/presentation/area_change.dart`):
  - A-2 로 지금 위치 지점을 받아, 그 외 지점은 흐리게 하고 누르면 "이 지점 배달 지역 안에 있을 때만 바꿀 수 있어요".
  - 위치 모름이면 "위치를 켜 주세요".
- A-1 거절 코드마다 안내를 붙이고, 결과 불명은 지금처럼 내 정보를 다시 읽어 맞춘다.
- 그 전까지 앱은 지금 동작 그대로다(위치 검사 없음). 계약에 없는 호출은 하지 않는다.
