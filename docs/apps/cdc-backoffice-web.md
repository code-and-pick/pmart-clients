# DC 백오피스 웹 (`web/cdc-backoffice`)

담당: **PC 5**(사용자 2026-11-25 "너는 이제부터 DC백오피스 화면 세션도 담당한다"). 서버(employee-auth 앱·게이트웨이 CORS·PC 4 서빙)는 백엔드 PC 1, **cdc-* API 는 PC 1 의 별도 CDC 세션**(`D:\development\pmart-project\pmart-backend-cdc` — pmart-backend 같은 저장소 `cdc/*` 가지, 사용자 2026-11-26).

- 근거: 백엔드 요청 `../pmart-backend/docs/handoff/clients/all/2026-11-25-request-cdc-backoffice.md`, 계획 `../pmart-backend/docs/cdc/cdc-backoffice-plan.md`.
- 사용자: DC 관리자(`CDC_SUPERVISOR` — 토큰 centers 의 DC 만), 운영 관리자(`OPERATOR_ADMIN`). `CDC_WORKER` 만 있으면 "PDA 에서" 안내. 그 밖 역할은 막지 않고 안내만(판정은 서버).
- 겉모양: **MFC 백오피스와 같게**(사용자 2026-11-25) — 공용 콘솔 틀(`ConsoleShell`)·왼쪽 메뉴 묶음·머리줄(시계·DC 고르기·단축키·밝기·내 정보·앱 바꾸기).
- **상태(2026-11-26): 1·2단계 화면** — 대시보드(출고 집계)·TRF·Wave(출발 준비)·통합 작업관리·출고관리(출발 검증)·기준정보(칸 재고)·재고(칸별·실사·재계수). 나머지 8개 메뉴는 "준비 중". DC 고르기는 center-master type=CDC 와 세션 centers 가 겹치는 것만. 시뮬레이터 관제 빈칸은 `docs/handoff/cdc-backoffice/2026-11-25-backend-monitoring-gaps.md`.

## 1. 앱과 로그인

| 항목 | 값 |
|---|---|
| 로그인 | employee-auth `app=cdc-backoffice`, SSO(`@pmart/web-core` 그대로 — 앱 이름만 넘긴다) |
| 주소 | 개발 `http://localhost:5177`(`npm run dev -w web/cdc-backoffice`), LAN `https://192.168.0.40:8447` — 빌드·올리기는 PC 1(`npm run build:lan -w web/cdc-backoffice` → `lan.sh publish-cdc-backoffice <dist>`) |
| `X-Source-System` | `cdc-backoffice-web` |
| DC | 주소 `/c/:cdcId/<메뉴>` — 세션 `centers` 의 DC 만(지금 `CDC01` 칠곡 DC). 이름은 sessions/current `centerDetails` |
| 생성 타입 | `tools/web-tools/gen-api.mjs` 복사 대상: center-master·hr·product·cdc-inventory·cdc-location·cdc-outbound·cdc-quality·cdc-inbound |
| 앱 바꾸기 | `web/ui` `AppLauncher` 에 `cdc-backoffice`("DC 백오피스", 8447·5177) — 모든 직원에게 보임 |

## 2. 메뉴 자리 (`src/app/nav.ts`)

| 묶음 | 메뉴 | 경로 | 서버 |
|---|---|---|---|
| 실시간 관제 | 대시보드·관제 | `dashboard` | 맨 위 "오늘 흐름" 일곱 칸(최근 TRF 200건·운행 정차·transits — 칸 누르면 그 단계 요청, 2026-11-27)·"지금 손봐야 할 것"(건수 있는 일만 이유와 함께 — 재고 못 찾음·피킹 부족·출발 불일치·지연 운행·MFC 입고 안 맞음·보류 Wave·재계수·실사 결정·가용 0·기한 임박) · outbound-summary(byMfc 0.18.0)·주의할 일(shortages·recount-holds·count-sessions·departures·waves hold·stock-snapshot)·workers byFloor — 입고·KPI 없음 |
| 실시간 관제 | MFC 재고 이동 | `mfc-flow` | transfers(단계)·departures·stock-snapshot transit·trips 정차(MFC 도착·인계)·transits(MFC 입고 — 다섯째 걸음, cdc-inventory 0.22.0) — 15초마다. 최근 출발 50건 줄마다 인계·입고, 입고 상태 거르기(`?receipt=`), 펼치면 상품·LOT 별 입고 수량(2026-11-27 "MFC 입고 확인" 메뉴를 합침). TRF 목록 "출발" 옆·TRF 진행 줄 마지막 칸도 transits |
| 출고 운영 | TRF·Wave | `trf-wave` | transfers·waves·미출발 취소·Wave 보류·취소·합치기·나누기(0.22.0)·화면 번호 |
| 출고 운영 | 통합 작업관리 | `tasks` | tasks·regions·담당 바꾸기·보류·우선순위(0.20.0) |
| 출고 운영 | 피킹·분배 | `picking` | FC 피킹만(DPS·AutoStore·소터는 작업 화면만, 설비 칸 없음)·피킹 부족 재할당(shortages) |
| 출고 운영 | 출고관리 | `shipping` | departures·LPN(lpns 0.19.0) |
| 출고 운영 | 출하·운송 | `transport` | TMS 1단계(2026-11-26): 운행 trips·정차·예상 도착·인계 대조·예외 + 직원 대신 입력(transport-execution 0.2.0), 배차 생성·계획완료·결행·취소·요청서 옮기기·이관요청서(수신·V1~V8 검증 결과·보완 주체·상품별 수량)·노선(transport-planning 0.2.0) · 차량·기사·운송사(fleet 0.2.0)·노선 등록·정규차 지정 · 도크(cdc-location 0.8.0 dock-reservations — 계획완료 때 자동, 바꾸기는 다음) |
| 입고·재고 | 기준정보 | `master` | sku-handlings·locations·aisle-pick-methods |
| 입고·재고 | 재고관리 | `inventory` | stock-snapshot(합계 카드·거르기·상품 이름 productName 0.17.0)·location-stocks·count-sessions·recount-holds·품질 보류·폐기·리콜(cdc-quality 0.3.0)·이동 이력(stock-movements 0.20.0) |
| 입고·재고 | 보충관리 | `replenishment` | 자동 보충 작업(putaway-tasks kind=REPLENISHMENT)·보충 판단(replenishment-checks) |
| 인력·시스템 | 작업자·인력 | `workers` | 근무조·계획 인원(시뮬레이터 값)·배치·출근·현황(cdc-outbound 0.29.0 WF-2) |
| 인력·시스템 | 리포트·KPI | `reports` | 운영 확인 기준(operating-metrics 0.28.0 — 있는 자료만, 나머지 N/A)·일별 출고(0.27.0)·작업자 실적(0.27.0) |

**빼는 것**(사용자 2026-11-25 "설비센서자산 같은 건 제외"): 시설·설비, 환경·품질(온도·HACCP), 물류 자산 — 자리도 없다.
다음 차례(사용자 추천 순서): 작업관리·Wave → 기준정보 → 재고 → 대시보드.
