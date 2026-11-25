보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1)
작성: pmart-clients PC 5, 2026-11-25

# 요청: CDC 시뮬레이터에 보이는 것을 DC 백오피스에서도 관제하기 — 빠진 조회

사용자 2026-11-25 "Dc 시뮬레이션에 있는 것도 백오피스에서 다 관제 가능하지?" → 지금은 아니다. DC 백오피스는 TRF·Wave·작업·기준정보(취급·로케이션·통로 방식)·재고(스냅샷·재계수 대기)·출고 집계까지 붙였다.
아래는 시뮬레이터 화면에는 있는데 직원 조회 API 가 없어 백오피스에 못 붙인 것. 항목마다 "새 조회" 인지 "결정 필요" 인지 적었다.

| # | 시뮬레이터에 보이는 것 | 지금 서버 | 필요 |
|---|---|---|---|
| M-1 | 작업자 위치·층별 인원(가상 작업자) | 없음 — 시뮬레이터 안에서만 움직이는 값 | **사용자 결정(2026-11-25): PDA 로 스캔한 위치** — 서버가 작업자별 마지막 스캔 위치·시각을 남긴다(시뮬레이터 가상 작업자도 PDA 와 같은 API 로). 조회 제안 `GET /cdcs/{cdcId}/workers?floor=`(작업자·지금 작업·마지막 스캔 위치·시각, 층별 인원). 어떤 스캔을 위치로 칠지·오래된 위치를 "모름"으로 볼 시간은 백엔드 설계 |
| M-2 | 입고·적치·보충·하강 흐름 | cdc-inbound 계약만(서비스 없음) | 서비스 구현 뒤 직원 목록 `GET /cdcs/{cdcId}/putaway-tasks`·`/replenishment-moves`·`/asn` 에 상태·기간 거르기 |
| M-3 | 상차·출차·운송(차량·기사·운행) | transport-*·fleet 계약만, 출발 검증은 cdc-outbound 내부 | 직원 조회 `GET /cdcs/{cdcId}/departures`(출발 준비·검증 결과·불일치 사유) — 운송은 TMS 서비스 뒤 |
| M-4 | MFC별 흐름(공급 MFC 줄) | TRF 목록에 mfcId 는 있음 | 그날 MFC별 집계 `outbound-summary` 에 `byMfc[]`(TRF 수·승인·피킹·부족) — 선택 |
| M-5 | 실시간 사건 기록(로그) | 없음 | `GET /cdcs/{cdcId}/events?since=`(Wave·작업·부족·출발 사건 최근 순) — 선택 |
| M-6 | 칸별 재고(칸 카드) | stock-snapshot 은 SKU 기준, 로케이션 occupiedQty 는 아직 null | cdc-location `occupiedQty` 채우기(cdc-inventory 사본) 또는 `stock-snapshot?locationPrefix=` |

- 설비·센서·자산(DPS 표시등·AutoStore 로봇·소터·온도·팔레트 수량)은 사용자 결정대로 넣지 않는다.
- 3D 화면·공급 MFC 고르기 같은 시뮬레이터 조작은 백오피스 범위가 아니다.
- 앱은 API 가 생기기 전까지 그 칸을 "서버에 아직 없어요"로 두고 지어낸 숫자를 보이지 않는다.
