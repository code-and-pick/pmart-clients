# 직원 배송 목록에 단계 시각·약속 시각 넣기 (라이더 백오피스 대시보드 분석)

> **끝남(2026-11-21):** 백엔드 PR #324 → delivery-execution 0.34.0 병합(bb0f47d2)·LAN 배포(17:15). 클라이언트는 PR #362 로 붙임(다섯 구간 평균·늦음 표시). promisedAt 은 배포 뒤 배정분부터.

- 보낸 앱: rider-backoffice (PC 5)
- 받는 백엔드 영역: delivery (delivery-execution — 필요하면 delivery-dispatch)
- 쓴 날: 2026-11-21
- 사용자 지시: "라이더 백오피스 대시보드가 좀 허전해. 라이더시뮬레이션의 분석탭 같으면 좋겠는데" → 못 채운 칸을 "응 넣어"(2026-11-21)

## 왜
라이더 백오피스 대시보드 분석 구역(PR #356)은 execution `GET /deliveries`(StaffDeliverySummary) 7일치로 구간별 평균·시간대 막대를 그린다.
목록에 `assignedAt`·`pickedUpAt`·`completedAt` 만 있어 아래를 셀 수 없다(배송마다 `GET /deliveries/{id}` history 를 읽으면 되지만 7일치 수백 건을 하나씩 읽을 수 없다).

1. 구간별 평균을 시뮬레이터처럼 나누기 — "MFC 이동"(배정→가게 도착)과 "MFC 대기"(가게 도착→픽업), "고객 앞 대기"(고객 도착→완료)
2. 배송별 지연 — 약속 시각(promisedAt)과 완료 시각 비교. 날짜·센터 합계는 dispatch `GET /metrics/on-time-deliveries` 로 이미 채운다(이 요청과 별개로 씀). 막대·라이더 표에서 **어느 배송이 늦었는지** 표시하려면 배송 단위 값이 필요하다.
3. "라이더 찾기" — 지금은 생성(createdAt)→마지막 배정(assignedAt)이라 재배정이 있으면 길게 잡힌다. 첫 배차 요청·첫 배정 시각이 있으면 정확해진다.

## 바라는 것 (StaffDeliverySummary 에 칸 추가, 모두 nullable·읽기 전용)
| 칸 | 뜻 |
|---|---|
| `arrivedAtStoreAt` | 가게 도착(ARRIVED_AT_STORE) 처음 기록 시각 |
| `arrivedAtCustomerAt` | 고객 도착(ARRIVED_AT_CUSTOMER) 처음 기록 시각 |
| `promisedAt` | 고객 약속 끝(dispatch `promisedAt` 과 같은 뜻 — 주문 뒤 50분 또는 예약 끝) |
| `firstAssignedAt` | 첫 배정 시각(재배정 전) — 어려우면 빼도 됨 |
| `completionMethod` | 완료 방법(라이더 완료·고객 수령 확인·자동 완료) — 자동 완료는 실제 전달 시각이 아니라 평균에서 빼려고. 어려우면 빼도 됨 |

개인정보는 없다(시각·코드만). 목록 권한·거르기는 그대로.

## 아직 없는 동안
대시보드는 가게 도착·고객 도착을 나누지 않은 3구간(라이더 찾기 → MFC 이동·대기 → 고객에게)으로 그리고, 펼친 배송 하나의 흐름은 `GET /deliveries/{id}` history 로 단계 시각을 다 보인다. 지연 합계는 `/metrics/on-time-deliveries`.
