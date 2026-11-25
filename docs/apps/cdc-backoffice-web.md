# DC 백오피스 웹 (`web/cdc-backoffice`)

담당: **PC 5**(사용자 2026-11-25 "너는 이제부터 DC백오피스 화면 세션도 담당한다"). 서버(employee-auth 앱·게이트웨이 CORS·PC 4 서빙·cdc-* API)는 백엔드 PC 1.

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
| 생성 타입 | `tools/web-tools/gen-api.mjs` 복사 대상: center-master·hr·cdc-inventory·cdc-location·cdc-outbound |
| 앱 바꾸기 | `web/ui` `AppLauncher` 에 `cdc-backoffice`("DC 백오피스", 8447·5177) — 모든 직원에게 보임 |

## 2. 메뉴 자리 (`src/app/nav.ts`)

| 묶음 | 메뉴 | 경로 | 서버 |
|---|---|---|---|
| 실시간 관제 | 대시보드·관제 | `dashboard` | outbound-summary(0.11.0) — 입고·KPI 없음 |
| 출고 운영 | TRF·Wave | `trf-wave` | transfers·waves·미출발 취소 |
| 출고 운영 | 통합 작업관리 | `tasks` | tasks·regions |
| 출고 운영 | 피킹·분배 | `picking` | FC 피킹만(DPS·AutoStore·소터는 작업 화면만, 설비 칸 없음) |
| 출고 운영 | 출고관리 | `shipping` | work-results |
| 출고 운영 | 출하·운송 | `transport` | 계약만 |
| 입고·재고 | 기준정보 | `master` | sku-handlings·locations·aisle-pick-methods |
| 입고·재고 | 입고관리 | `inbound` | 계약만 |
| 입고·재고 | 재고관리 | `inventory` | stock-snapshot(cdc-inventory 0.6.0+) |
| 입고·재고 | 보충관리 | `replenishment` | 계약만 |
| 입고·재고 | 반품·회수 | `returns` | 없음 |
| 인력·시스템 | 작업자·인력 | `workers` | 없음 |
| 인력·시스템 | 리포트·KPI | `reports` | 없음 |
| 인력·시스템 | 시스템관리 | `system` | 없음 |

**빼는 것**(사용자 2026-11-25 "설비센서자산 같은 건 제외"): 시설·설비, 환경·품질(온도·HACCP), 물류 자산 — 자리도 없다.
다음 차례(사용자 추천 순서): 작업관리·Wave → 기준정보 → 재고 → 대시보드.
