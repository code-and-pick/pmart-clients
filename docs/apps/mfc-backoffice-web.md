# MFC 백오피스 웹 (`web/mfc-backoffice`)

담당: **PC 2**(사용자 2026-11-16 — 백엔드 알림 `../pmart-backend/docs/handoff/clients/all/2026-11-16-notice-mfc-backoffice-owner-pc2.md`, 인계서 `docs/operations/backoffice-handover.md`). 로그인·센터 고르기 뼈대와 로그인·세션·토큰 코드는 PC 1. 화면이 부를 MFC API(MB-1~3)는 백엔드 PC 3 — 더 필요하면 백엔드 `docs/architecture/service-requests/mfc-backoffice-staff-apis.md` 로 요청.

- 사용자: 센터 관리자(`MFC_SUPERVISOR`) — 자기 센터(`centers`)만. 현장 작업자(`MFC_WORKER`)는 PDA 앱(`apps/mfc_app`)을 쓴다.
- 근거: 백엔드 요청 `../pmart-backend/docs/handoff/clients/mfc-backoffice/2026-11-15-request-mfc-backoffice.md`. 메뉴·API 정본은 `pmart-backend/docs/architecture/backoffice-role-menus.md` §3, 계약 `contracts/openapi/mfc-*.yaml`.
- 기본 백오피스(`web/backoffice`)에는 MFC 메뉴를 넣지 않는다(백엔드 요청 2026-11-15 cs-rider-menus §0).
- 상태(2026-11-15): **기반만**(앱 뼈대·로그인·센터 고르기·메뉴 자리). 메뉴 화면은 모두 "준비 중". 목 모드로 확인, LAN 배포·실서버 확인은 아직.
- 2026-11-16(PC 2): **위치(칸)** 화면(§4-1). 나머지 메뉴는 "준비 중". 목 모드만 확인.

## 1. 앱과 로그인

| 항목 | 값 |
|---|---|
| 스택 | 다른 두 백오피스와 같다(Vite + TS 7, React Router, TanStack Query, openapi-fetch, MSW, daisyUI) |
| 로그인 | employee-auth-service, `app=mfc-backoffice`, SSO — `@pmart/web-core` 직원 로그인(세션별 HttpOnly refresh 쿠키·CSRF, 탭이 다시 보일 때 세션 확인). 비밀번호는 받지 않는다 |
| 주소 | 개발 `http://localhost:5175`(`npm run dev -w web/mfc-backoffice`), LAN `https://192.168.0.40:8445`(빌드 `npm run build:lan -w web/mfc-backoffice` → PC 1 백엔드가 `lan.sh publish-mfc-backoffice <dist>`) |
| `X-Source-System` | `mfc-backoffice-web` |
| 생성 타입 | `src/api/generated/`(커밋 안 함): center-master, mfc-capacity·fulfillment·inbound·inventory·location·quality — `npm run gen:api -w web/mfc-backoffice`(백오피스 생성물에서 복사) |

## 2. 센터
- 고를 수 있는 센터 = `GET /employee-auth/sessions/current` 응답의 `centers`(employee-auth 0.6.0, 2026-11-16 — 토큰을 풀지 않는다. 승인·회수 직후 토큰과 다르면 응답을 따른다).
- 주소에 센터를 넣는다: `/c/<mfcId>/<메뉴>`. 첫 화면은 맡은 첫 센터의 첫 메뉴(작업자).
- 센터가 하나면 고르지 않고 이름만 보인다. 둘 이상이면 위에서 고르고, 바꾸면 같은 메뉴의 다른 센터로 간다.
- 이름은 같은 세션 응답의 `centerDetails`(employee-auth 0.9.0, 2026-11-16)에서 — "이름 (코드)". 서버가 이름을 못 읽은 센터(`name: null`)는 코드로만 보이고 안내한다(센터 목록은 비지 않는다). `GET /centers` 는 부르지 않는다.
- 주소의 센터가 세션 centers 에 없으면 "이 센터 권한이 없습니다" + 맡은 센터 링크. 맡은 센터가 없으면(예: 센터 없는 `OPERATOR_ADMIN`) 안내만, 메뉴 없음.

## 3. 역할
- `MFC_WORKER` 만 있는 계정: "센터 관리자만 쓰는 화면입니다"(메뉴 없음).
- `MFC_SUPERVISOR` 가 없는 그 밖 역할 + 센터: 막지 않고 안내만. 판정은 서버가 API 마다(403 → "이 센터 권한이 없습니다"). mfc API 는 `OPERATOR_ADMIN` 을 따로 통과시키지 않는다(백엔드 §2-1).

## 4. 메뉴 (`src/app/nav.ts`)

| 묶음 | 메뉴 | 경로 | 화면 | 서버 API 가 아직 없는 것(백엔드 §2-1) |
|---|---|---|---|---|
| 인력 | 작업자 | `workers` | 준비 중 | — |
|  | 배정 | `assignments` | 준비 중 | 배정 추천 계획 목록 |
| 작업 | 작업 현황 | `tasks` | 준비 중 | 확인 필요 포장 목록·확인(지금은 작업자만 — 백엔드 결정 대기) |
|  | 이동·보충 | `moves` | 준비 중 | — |
|  | 입고 | `inbound` | 준비 중 | 입고 예정(TRF, 계약만), 초기 보유 센터별 수령 대기 목록, 회수품·공급 요청 목록 |
| 재고·품질 | 재고 | `inventory` | 준비 중 | 센터 전체 재고 목록(상품 코드 없이), 실사 세션 목록 |
|  | 품질 | `quality` | 준비 중 | 해제 승인 대기·폐기·검수 목록, 품질 사고(계약만) |
| 센터 | 위치(칸) | `locations` | **됨**(§4-1) | — |
|  | 운영 제한 | `restrictions` | 준비 중 | — |

- "준비 중" 화면은 그 메뉴에서 서버 API 가 있는 기능과 없는 기능을 나눠 보인다. 화면을 만들면 `nav.ts` 의 `ready` 를 true 로 바꾸고 이 표를 고친다.
- 기존 화면 요청서는 그대로 쓴다: 입고 B1~B4, 피킹·포장, 근무 기본값·배정 계획(백엔드 handoff `archive/2026-11-07-clients-request-mfc-*`, `backoffice/2026-11-09-clients-notice-*`).
- 메뉴 아래 화면(목록·상세·등록)은 라우트 `c/:mfcId/<메뉴>/*` 아래에서 메뉴 화면이 자기 `<Routes>` 로 나눈다(`App.tsx` `menuPages`).

### 4-1. 위치(칸) — mfc-location-service 0.7.1 (`features/locations/LocationPages.tsx`)
| 화면 | API | 규칙 |
|---|---|---|
| 목록 `locations` | `GET /locations?mfcId=&zone=&temperatureZone=&state=` | 거르기는 URL 쿼리. 커서 "더 보기"(50개씩). 조회 실패는 오류(빈 목록 아님), 다음 쪽 실패는 받은 것까지 + 안내 |
| 등록 `locations/new` | `POST /locations` → 201 Location | 칸 코드 문법은 안내만(검사는 서버 — 400 `LOCATION_CODE_INVALID`), 409 `LOCATION_CODE_DUPLICATE`. 만든 뒤 상세로 |
| 상세 `locations/<locationId>` | `GET /locations/{id}` | 속성·상태·버전 |
| 속성 고치기 | `PUT /locations/{id}` + `X-Expected-Version` | 전체 교체 — 지금 값을 모두 다시 보낸다(도면 좌표를 빼면 지워진다). 코드는 못 바꿈. 도면 x·z 는 둘 다 넣거나 둘 다 비움 |
| 닫기·다시 열기 | `POST /locations/{id}/state-changes` {targetState, reason} + 버전 | 사유 필수(200자). ACCEPTED·결과 불명은 짝 조회 `GET …/state-changes/{requestId}`, 끝까지 모르면 "같은 요청으로 결과 확인"(같은 키) |
| 폐지 | `DELETE /locations/{id}` + 버전 | 닫힌 칸에만 버튼, 확인 표시를 해야 누를 수 있다. 재고가 있으면 서버 409 `INVALID_STATE`. 짝 조회 API 가 없어 결과가 확정되지 않으면 칸을 다시 읽어 RETIRED 일 때만 완료 |
- 실사 잠금(`COUNT_LOCKED`)은 실사 세션이 건다 — 이 화면에서 걸거나 풀지 않는다. 폐지된 칸은 고칠 수 없다.
- 완료 문구는 상세 화면 위에(성공 뒤 칸을 다시 읽으면 양식이 새 버전으로 다시 그려지므로).
- 실서버 확인 전(서버는 상태 변경·폐지를 바로 APPLIED 로 돌려준다 — `LocationService`).

## 5. 목 모드
- 목 계정: 센터 관리자(MFC 1곳 `MFC-BSN-01`), 센터 관리자(MFC 2곳 `MFC-BSN-01`·`MFC-SEL-01`), 현장 작업자, 운영 관리자(센터 없음). `src/mocks/db.ts`.
- 목 핸들러: 로그인(employee-auth — 세션 응답에 목 센터 이름), 위치(`mocks/locationHandlers.ts` — 센터 권한·코드 중복·문법·버전·폐지 조건). 메뉴 화면을 만들 때 그 계약의 목을 더한다.
- 목 위치: `MFC-BSN-01` 에 사용 중 3·닫힘 2(하나는 재고가 남아 폐지 거절)·폐지 1, `MFC-SEL-01` 에 1.
- 목 모드는 새로고침하면 목 서버 기억이 지워져 다시 로그인해야 한다(화면 안 링크로 옮겨 다닌다).
