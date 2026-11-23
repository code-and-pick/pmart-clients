# 라이더 배달 지역 구역 이름 요청 (백오피스 라이더 상세)

보낸 앱: backoffice (PC 2)
받는 백엔드 영역: delivery (rider-service — 라이더 배달 지역 deliveryAreas). 구역 이름 원천은 delivery-serviceability-service(권역 매핑 버전 zones[].name)라 그쪽과 나눠야 하면 알려 주세요.

- 근거: 사용자 2026-11-23 "어색한 부분 더 있는지 찾아내기 전에 한번 더 확인해" — 상세 화면 점검에서 라이더 상세 "배달 지역"이 "부산진구 MFC · ZONE-MOCK-1"처럼 구역 **시스템 ID** 로 보인다. 센터는 이름으로 바꿨지만 구역은 이름을 받을 길이 없다.
- 지금 받는 것: rider-service 직원 상세 `GET /riders/{riderId}` 의 `deliveryAreas[]` = `{mfcId, zoneId}` 뿐(이름 없음).
- 이름이 있는 곳: delivery-serviceability `ServiceabilityVersion.zones[].name`. 하지만 운영자용은 `GET /serviceability-versions/{version}`(버전 번호를 알아야 함)뿐이고, 지금 발효 버전은 내부용 `/internal/serviceability-versions/current` 에만 있어 백오피스가 부를 수 없다.
- 클라이언트가 직접 만들지 않는 이유: 구역 이름을 화면에 적어 두면 권역 버전이 바뀔 때 틀린 이름이 된다. 원천 값만 보인다.

## 요청 (둘 중 하나)
1. **(바람)** rider-service `deliveryAreas[]` 에 `zoneName`(지금 발효 권역의 구역 이름, 못 읽으면 null)을 더해 주세요. 직원 상세·목록(`StaffRiderSummary`에 지역이 있으면 거기도).
2. 또는 delivery-serviceability 에 운영자용 지금 발효 버전 조회(예 `GET /serviceability-versions/current?includeGeometry=false`, 역할 CS_AGENT·RIDER_OPS·OPERATOR_ADMIN)를 열어 주세요. 그러면 화면이 zoneId → name 을 찾는다.

## 받은 뒤 화면
- 라이더 상세 "배달 지역": "부산진구 MFC · 서면 구역"처럼 센터 이름 · 구역 이름. 이름이 null 이면 구역 ID 를 흐리게(지금처럼), 조회 실패는 "구역 이름 확인 불가"(없음과 구분).

## 끝남 (2026-11-24)
- 라이더 백엔드 #391(rider 0.26.0)이 1안(deliveryAreas[].zoneName)으로 반영, 화면은 프론트 #438 로 "센터 이름 · 구역 이름"(null 이면 구역 ID 흐리게). LAN 배포 8e939013.
