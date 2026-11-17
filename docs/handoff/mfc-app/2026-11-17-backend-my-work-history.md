# [pmart-clients → pmart-backend] 요청: 작업자 본인 "오늘 업무 내역" 조회 (2026-11-17)

- 보낸 앱: mfc-app (PC 3)
- 받는 백엔드 영역: mfc (fulfillment · inbound · inventory · quality · capacity)
- 사용자 요청(2026-11-17): "작업자마다 본인의 금일 작업내용을 체크할 수 있어야" — PDA 업무 고르기·업무 진행 화면 위 작은 바의 "업무 내역" 칩 → 오늘 업무 내역.

| # | 요청 | 지금 계약 | PDA 지금 |
|---|---|---|---|
| R1 | `GET /tasks`(fulfillment)에 **기간 거르기**(예: `activitySince`/`completedFrom`·`To`) 또는 오늘 것만 | 없음. `assignee=me` + `state` 만 | `state=COMPLETED,CLOSED_PARTIAL,IN_PROGRESS` 를 받아 `lastActivityAt` 이 오늘(서울)인 것만 화면이 고름 — 오래 쓰면 목록이 길어진다(쪽 나누기 첫 쪽만) |
| R2 | `TaskSummary` 에 **`completedAt`** | 없음(`lastActivityAt` 만) | 완료 시각 대신 마지막 실적 시각을 보임 |
| R3 | 입고(받기·검수)·품질검사·적치·보충·이동·회수품·실사의 **내 처리 내역**(한 곳에서 — 예: mfc-capacity "작업자 실적" `GET /mfcs/{mfcId}/workers/me/activities?date=`) | 없음(각 서비스에 내 내역 조회 없음) | 피킹·패킹·출고·복귀만 보이고, 화면에 "입고·품질검사·재고 이동·실사 내역은 서버에서 아직 받을 수 없어요" 안내 |
| R4 | (있으면) 오늘 처리 수량·건수 합계를 서버가 — 앱이 더하지 않게 | 없음 | 건수만(완료·진행 중) 센다 |

- 코드: `apps/mfc_app/lib/features/my_work/presentation/my_work.dart`, `TaskRepository.myHistory`.
