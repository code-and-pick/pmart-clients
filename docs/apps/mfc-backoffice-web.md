# MFC 백오피스 웹 (`web/mfc-backoffice`)

담당: **PC 2**(사용자 2026-11-16 — 백엔드 알림 `../pmart-backend/docs/handoff/clients/all/2026-11-16-notice-mfc-backoffice-owner-pc2.md`, 인계서 `docs/operations/backoffice-handover.md`). 로그인·센터 고르기 뼈대와 로그인·세션·토큰 코드는 PC 1. 화면이 부를 MFC API(MB-1~3)는 백엔드 PC 3 — 더 필요하면 백엔드 `docs/architecture/service-requests/mfc-backoffice-staff-apis.md` 로 요청.

- 사용자: 센터 관리자(`MFC_SUPERVISOR`) — 자기 센터(`centers`)만. 현장 작업자(`MFC_WORKER`)는 PDA 앱(`apps/mfc_app`)을 쓴다.
- 근거: 백엔드 요청 `../pmart-backend/docs/handoff/clients/mfc-backoffice/2026-11-15-request-mfc-backoffice.md`. 메뉴·API 정본은 `pmart-backend/docs/architecture/backoffice-role-menus.md` §3, 계약 `contracts/openapi/mfc-*.yaml`.
- 기본 백오피스(`web/backoffice`)에는 MFC 메뉴를 넣지 않는다(백엔드 요청 2026-11-15 cs-rider-menus §0).
- 상태(2026-11-15): **기반만**(앱 뼈대·로그인·센터 고르기·메뉴 자리). 메뉴 화면은 모두 "준비 중". 목 모드로 확인, LAN 배포·실서버 확인은 아직.
- 2026-11-16(PC 2): **위치(칸)**(§4-1)·**이동·보충**(§4-2)·**작업자**(§4-3)·**배송 현황·배차 실패**(§4-4)·**작업 현황**(§4-5)·**배정**(§4-6) 화면. 나머지 메뉴는 "준비 중". 목 모드만 확인.

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
| 인력 | 작업자 | `workers` | **됨**(§4-3) | — |
|  | 배정 | `assignments` | **됨**(§4-6) — 지난 추천은 ID 로만 | 배정 추천 계획 목록 |
| 작업 | 작업 현황 | `tasks` | **됨**(§4-5) — 확인 필요 포장은 안내만 | 확인 필요 포장 목록·확인(지금은 작업자만 — 백엔드 결정 대기) |
|  | 이동·보충 | `moves` | **됨**(§4-2) | — |
|  | 입고 | `inbound` | 준비 중 | 입고 예정(TRF, 계약만), 초기 보유 센터별 수령 대기 목록, 회수품·공급 요청 목록 |
| 배송 | 배송 현황 | `deliveries` | **됨**(§4-4) | — |
|  | 배차 실패 | `dispatch-failures` | **됨**(§4-4, 보기만) | (배차 쪽 사건에 센터가 실리기 전엔 0건 — DD-MFC) |
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

### 4-2. 이동·보충 — mfc-inbound-service 0.9.0 `/move-orders*` (`features/moves/MovePages.tsx`)
| 화면 | API | 규칙 |
|---|---|---|
| 목록 `moves` | `GET /move-orders?mfcId=&state=` | 상태를 비우면 서버 기본(진행 중 = ACTIVE·CANCEL_PENDING). 상태 거르기는 URL 쿼리. 쪽 나누기 없음(계약). 종류(재배치·자동 보충)·긴급·진행(집음/내려놓음/카트)·담당 |
| 이동 지시 `moves/new` | `POST /move-orders` → 201 MoveOrder | MFC_SUPERVISOR. 같은 키 = 같은 이동(서버) — 결과 불명(503 등)은 "같은 요청으로 결과 확인". 거절 코드는 inventory 이동 배정 그대로(CATEGORY_MISMATCH·SKU_ALREADY_SHELVED·SKU_SPLIT_NOT_ALLOWED·LOCATION_CAPACITY_EXCEEDED·LOT_NOT_SHIPPABLE·CONFIG_REQUIRED 문구) |
| 고르기 도움 | `GET /mfcs/{id}/stock?sku=`(inventory), `GET /putaway-candidates?mfcId=&sku=`(location) | 누를 때만 부른다. 위치·LOT·품질·업무 상태를 보이고 고르면 칸에 채운다 — 걸러 내지 않는다(판정은 서버). 남은 공간 null = "모름" |
| 상세 `moves/<moveId>` | `GET /move-orders/{id}` | 지시한 사람 `SYSTEM` = "시스템". 카트 정리 대기는 안내만 |
| 취소 | `POST /move-orders/{id}/cancellations` {reason} | 진행 중(ACTIVE)에만. 사유 필수. 서버가 돌려준 상태로 문구(CANCELLED = 취소, CANCEL_PENDING = 카트 되돌려 놓으면 끝남) |
- 집어 올리기·내려놓기는 현장(PDA) 일 — 이 화면에 없다.

### 4-3. 작업자 — mfc-capacity-service 0.14.0 `/mfcs/{mfcId}/workers*` (`features/workers/WorkerPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 목록 `workers` | `GET …/workers?state=` | 비우면 서버 기본(재직·정지). 지금 배정 조건(effectiveTaskTypes)·휴게·오늘 출근(일일크루)·속도는 서버 값을 보이기만 |
| 등록 `workers/new` | `POST …/workers` | workerId = 직원 계정 운영자 ID(직접 입력 — 서버는 계정 존재를 확인하지 않고 기록만). 업무 필수, 자격은 "따로 정하기"일 때만 보낸다(생략 = 서버 기본). 409 `WORKER_ALREADY_REGISTERED`, 422 `DUTY_OUTSIDE_QUALIFICATION` |
| 상세 `workers/<workerId>` | `GET …/workers/{id}` | 업무·자격(버전·만료)·PDA 업무 묶음·업무 이력·상태 이력 |
| 업무 바꾸기 | `POST …/duty-changes` + `X-Expected-Version` = dutyVersion | 사유 필수. 응답 `changed=false` 면 "바뀐 것 없음". `affectedAssignments`(맞지 않게 된 진행 중 배정)를 경고로 — 지우지 않음 |
| 자격 바꾸기 | `POST …/qualification-changes` + `X-Expected-Version` = qualificationVersion | 만료는 선택(한국 시간 입력 → +09:00) |
| 상태 바꾸기 | `POST …/state-changes` | 재직·정지·퇴사, 사유 필수, `affectedAssignments` 경고. 로그인·센터 권한은 인사팀 소관(안내만) |
| 속도 배율 | `POST …/speed-changes` | 0.5~2.0 밖이면 보내지 않음, 사유 필수 |
| 휴게 | `POST …/breaks`, `…/breaks/current/end` | 지금 휴게 여부로 단추 하나 |
| 일일크루 오늘 출근 | `POST …/day-enrollments` 본문 `{}` | 일일크루이고 아직 출근 전일 때만. 날짜를 보내지 않는다(생략 = 오늘, 서버가 정함) |
| 근무 일정 | `GET/POST …/shifts`, `POST …/shifts/{id}/cancellations` | 시각 입력은 한국 시간으로 `…+09:00` 을 붙여 보낸다. 16시간·겹침(409 `SHIFT_OVERLAP`)은 서버 판정. 취소는 사유 필수 |
- 바꾼 뒤 완료 문구·맞지 않는 배정은 상세 화면 위에(양식은 새 버전으로 다시 그려진다).
- 다음 작업 받기(`next-tasks`)는 PDA 전용 — 넣지 않는다.

### 4-4. 배송 현황·배차 실패 — bff 0.3.1 `live-delivery`, case 0.5.2 (`features/delivery/CenterDeliveryPages.tsx`, 2026-11-16)
- 화면 용어(사용자 2026-11-16): 백엔드 case 는 "접수 건"(배차 실패 접수 건), 상태 접수됨·처리 끝남·다시 처리 중, 종결 → 처리 결과 — 백오피스와 같다(`backoffice-web.md` §2-4).
- 백엔드 요청 `mfc-backoffice/2026-11-16-request-center-deliveries-and-dispatch-failures.md`(사용자 "①②③ 추천대로", 배송 원문 §1·§3.6). 새 묶음 "배송".
- **배송 현황** `deliveries`: bff `GET /backoffice/views/live-delivery?mfcId=<주소의 센터>&state=&size=50&cursor=` — 백오피스와 같은 API, 센터 관리자는 자기 센터 고정(다른 센터 403). 상태 비우면 진행 중 전부(오래된 순 50, 넘으면 truncated), 상태 고르면 `page.nextCursor`. 1분마다 다시 읽기. 배차 원천 실패 "모름(조회 실패)", `openCases null` "조회 실패", 못 읽은 원천 경고. "약속 지남"은 서버 `promisedAt < composedAt` 만. 열린 배차 실패 사건은 이 앱의 사건 상세로. 배송·주문 상세 화면은 이 앱에 없어 번호만.
- **배차 실패** `dispatch-failures`: case `GET /cases?kind=DISPATCH_FAILED&centerId=<센터>&size=50`(탭 "처리 중" / "처리 끝남"(`state=CLOSED`), 탭은 URL — 센터 관리자는 닫지 않으므로 열림·닫힘 대신 처리 단계로 부른다, 사용자 2026-11-16) · `GET /cases/{caseId}`(요약·관련·기한·담당·종결·이력). **보기만** — 집기·닫기 버튼 없음(서버 403), "처리는 지원센터(라이더 운영)" 안내. 배차 쪽 사건에 센터가 실리기 전(배송 영역 DD-MFC)에는 0건이 정상이라 안내.
- API 클라이언트: `api.bff`(`/api/v1/backoffice`)·`api.cases`. 계약 타입은 `gen:api` 의 mfc-backoffice 복사 목록에 backoffice-bff·case 를 더해 만든다(`tools/web-tools/gen-api.mjs`).
- 목 `mocks/centerDeliveryHandlers.ts`(우리 센터 진행 중 2·끝난 1·다른 센터 1, 사건 열린 1·닫힌 1·다른 센터 1 — 상태 SUSPENDED 로 거르면 배차·사건 원천 실패). 시험 `features/delivery/centerDelivery.test.tsx`(7).

### 4-5. 작업 현황 — mfc-fulfillment-service 0.4.11 (`features/tasks/TaskPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 목록 `tasks` | `GET /tasks?mfcId=&type=&state=` | state 를 비우면 서버 기본(ASSIGNED·IN_PROGRESS). 유형·상태 거르기는 URL 쿼리(상태는 하나씩). 커서 더 보기. 담당은 capacity 배정의 투영 — 응답 asOf 를 "담당 기준"으로. 늦음·멈춤은 서버 표시값(자동으로 빼앗지 않음) |
| 상세 `tasks/<taskId>` | `GET /tasks/{id}` | 줄(계획·완료·취소·남음·확정 대기), 막힌 이유, 포장 위치, 방문 순서 방법. 재고 확정 대기 실적이 있으면 안내 |
| 작업 내놓기 | `POST /tasks/{id}/releases` {workerId = 지금 담당, reason?} | ASSIGNED·IN_PROGRESS 이고 담당이 있을 때만 단추. 409 `EXECUTION_IN_FLIGHT` 문구, 503 은 결과 불명(같은 키로 확인). 응답 상태가 READY 일 때만 "내놓음" |
| 출하·포장 | `GET /shipments/{id}`, `GET /packages/{id}/handover-resolution`(누를 때만) | 포장 상태·인계 허가(만료 시각)·라이더. 판정과 "점원 확인 필요" 표시 |
- 확인 필요 포장 목록·확인(`GET /packages?checkRequired=true`, `handover-checks`)은 지금 MFC_WORKER 만(MB-3 결정 대기) — 목록 위에 안내만, 부르지 않는다.
- 시작·실적·포장·배차 요청은 현장 일 — 넣지 않는다.

### 4-6. 배정 — mfc-capacity-service 0.14.0 `/assignments`·`/assignment-plans*` (`features/assignments/AssignmentPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 배정 목록(탭 `?tab=` 기본) | `GET /assignments?mfcId=&state=&date=&workerId=&taskId=` | state 생략 = ACTIVE. 거르기는 URL 쿼리. 출처(직접·추천 확정·다음 작업 받기), 경고(OFF_SHIFT = 근무 밖), `workerEligibility`(지금 맡을 수 없으면 사유) — 서버 값. 진행 중 행에 "다시 배정" |
| 직접 배정(`?tab=manual`) | `GET /assignments?taskId=`(지금 담당 확인) → `POST /assignments` + `X-Expected-Version` | 확인한 지금 담당 버전(없으면 0)으로 보낸다 — 확인 전·작업 ID 를 바꾸면 단추 꺼짐. 작업자는 재직 작업자 목록에서(못 불러오면 직접 입력). 응답 버전이 그대로면 "바뀐 것 없음", OFF_SHIFT 는 알리기만. 422 `WORKER_NOT_REGISTERED`·`WORKER_NOT_ACTIVE`·`DUTY_NOT_ALLOWED`·`ZONE_NOT_QUALIFIED`, 409 `VERSION_CONFLICT` 문구 |
| 배정 추천(`?tab=plan`) | `POST /assignment-plans` {mfcId, horizonMinutes 10~480} | 계산만으로는 배정이 바뀌지 않는다. 계산하면 추천 화면으로. 지난 추천 목록 API 가 없어(MB-1) 추천 ID 로 연다 |
| 추천 화면 `assignments/plans/<planId>` | `GET /assignment-plans/{id}`, `POST …/commits` | 상태·계산 결과·평가(못 넣음·늦음·최대 부하)·한계(limitations)·근무 미등록 작업자·추천 배정·못 넣은 작업(사유). PROPOSED 만 확정 단추. 409 `PLAN_STALE` 이면 계획을 다시 읽어 STALE·낡은 이유를 보인다(아무것도 배정 안 됨) |
- 계산 입력(`…/input`)은 아직 화면에 넣지 않았다(재현 디버그용).

## 5. 목 모드
- 목 계정: 센터 관리자(MFC 1곳 `MFC-BSN-01`), 센터 관리자(MFC 2곳 `MFC-BSN-01`·`MFC-SEL-01`), 현장 작업자, 운영 관리자(센터 없음). `src/mocks/db.ts`.
- 목 핸들러: 로그인(employee-auth — 세션 응답에 목 센터 이름), 위치(`mocks/locationHandlers.ts` — 센터 권한·코드 중복·문법·버전·폐지 조건), 이동(`mocks/moveHandlers.ts` — 관리자만 지시·취소, 카테고리 칸 거절, 재고·적치 후보), 작업자(`mocks/workerHandlers.ts` — 관리자만 바꾸기(휴게·출근은 본인도), 버전·중복·자격 밖 업무·근무 겹침·맞지 않는 배정), 작업(`mocks/taskHandlers.ts` — 기본 상태·커서·내놓기 조건·출하·인계 판정), 배정(`mocks/assignmentHandlers.ts` — 버전·적격 422·같은 사람·추천 계산(READY 작업 → 적격 작업자)·확정 재확인 PLAN_STALE). 메뉴 화면을 만들 때 그 계약의 목을 더한다.
- 목 이동: 진행 중 2(긴급 재배치·자동 보충), 카트 정리 대기 1, 끝남 1(+ 다른 센터 1). 목 재고는 `SKU-MILK-1` 세 줄(하나는 격리).
- 목 작업자(`MFC-BSN-01`): 김현장(정규직, 자격이 업무보다 넓음, 진행 중 피킹 배정 1·근무 1), 이알바(알바, 휴게 중), 박일일(일일크루, 출근 전), 최정지(정지), 정퇴사(퇴사).
- 목 작업(`MFC-BSN-01`): 피킹 진행 중(멈춤, 출하 SHP-1 — 포장 PKG-1 밀봉·허가 만료), 포장 담당, 피킹 대기(담당 없음), 피킹 막힘, 피킹 끝남, 복귀 진행 중(늦음·재고 확정 대기 실적 1).
- 목 위치: `MFC-BSN-01` 에 사용 중 3·닫힘 2(하나는 재고가 남아 폐지 거절)·폐지 1, `MFC-SEL-01` 에 1.
- 목 모드는 새로고침하면 목 서버 기억이 지워져 다시 로그인해야 한다(화면 안 링크로 옮겨 다닌다).
