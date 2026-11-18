# 라이더 백오피스 웹 (`web/rider-backoffice`)

담당: **PC 5**(delivery 영역 — 사용자 2026-11-17 "라이더 백오피스는 PC5로"). 앱 뼈대와 로그인·세션·토큰 코드는 PC 1(2026-11-17, 이 문서와 같은 커밋). 화면이 부를 배송·라이더 API 는 백엔드 PC 5 가 만든다.

- 사용자: 라이더 운영·지원센터(`RIDER_OPS` — 모든 센터), 운영 관리자(`OPERATOR_ADMIN`). 그 밖 역할은 막지 않고 안내만(판정은 서버, API 마다 403).
- 근거: 사용자 2026-11-17 "라이더 백오피스 새로 만들어야 할 것 같아서, 관제까지 넣을 거야. 로그인 기능 똑같이" → "관제 화면 같은 건 내 쪽에서 만들지 말고 앱 뼈대랑 로그인만".
- **상태(2026-11-17): 뼈대만** — 로그인·세션·메뉴 자리(관제·라이더·배송·배차·지원센터, 모두 "화면 준비 중"). 목 모드로 확인(시험 11개), LAN 빌드는 PC 1 이 올린다.
- **아직 정하지 않은 것(사용자)**: 기본 백오피스(`web/backoffice`)에 이미 있는 라이더 운영 화면(라이더 찾기·제한, 배송 찾기·배차 취소, 사건함 배송 쪽, 도움요청 대화, 수행료 조정)을 이 앱으로 옮길지(2026-11-15 결정 "라이더 운영 메뉴는 기본 백오피스에" 를 바꾸는 일). 정해지기 전에는 기본 백오피스 화면을 그대로 둔다.

## 1. 앱과 로그인

| 항목 | 값 |
|---|---|
| 스택 | 다른 백오피스와 같다(Vite + TS 7, React Router, TanStack Query, openapi-fetch, MSW, daisyUI) |
| 로그인 | employee-auth-service, `app=rider-backoffice`, SSO — `@pmart/web-core` 직원 로그인(세션별 HttpOnly refresh 쿠키·CSRF, 탭이 다시 보일 때 세션 확인, 처음 열 때 조용한 로그인 확인). 비밀번호는 받지 않는다 |
| 주소 | 개발 `http://localhost:5176`(`npm run dev -w web/rider-backoffice`), LAN `https://192.168.0.40:8446`(`http://…:8084` 는 넘기기만). LAN 빌드·올리기는 PC 1(병합한 main 에서 `npm run build:lan -w web/rider-backoffice` → `lan.sh publish-rider-backoffice <dist>`) — PC 5 는 PR 만 |
| `X-Source-System` | `rider-backoffice-web` |
| 센터 | 고르지 않는다(RIDER_OPS 는 모든 센터 역할) — MFC 백오피스와 다르다 |
| 생성 타입 | 뼈대는 `web/core` 의 employee-auth 만 쓴다. 메뉴 화면을 만들 때 `tools/web-tools/gen-api.mjs` 복사 대상에 이 앱(rider·delivery-*·case·backoffice-bff 등)을 더하고 `.gitignore` 의 `web/rider-backoffice/src/api/generated/` 에 둔다 |

## 2. 로그인 코드는 PC 1 만

`src/features/session`, `src/api/employeeAuth.ts`·`src/api/sessionPersistence.ts`·`src/app/SessionContext.tsx` 는 PC 1 만 고친다(`docs/operations/pc-split.md` §1 표). PC 5 는 메뉴·업무 화면(`src/app/App.tsx`·`nav.ts`·`src/features/<메뉴>`·`src/mocks`·`src/shared/messages.ts`)을 만든다.

## 3. 메뉴 자리 (`src/app/nav.ts`)

| 묶음 | 메뉴 | 경로 | 비고 |
|---|---|---|---|
| 관제 | 라이더 관제 | `/control` | 직원용 라이더 위치 목록 API 가 아직 없다(delivery-tracking — 백엔드 PC 5) |
| 라이더 | 라이더 찾기 | `/riders` | |
| 배송·배차 | 배송 찾기 | `/deliveries` | |
| 지원센터 | 접수 건 | `/cases` | |
| 수행료 | 지급 관리 | `/payouts` | 2026-11-19 — execution 0.29.0 `GET /rider-payouts`(라이더×지급 예정일 묶음, RIDER_OPS·OPERATOR_ADMIN 보기), 결과 표시 `POST …/results`(PAYING·PAID·FAILED+사유, **관리자만**). 지급 실행은 외부 회계 |
| 지원센터 | 소명·이의 | `/appeals` | 2026-11-19 — rider 0.15.0 `GET /rider-appeals`(기본 결정 대기)·`POST …/decisions`(유지·인정 + 메모). 제한 소명 인정 = 서버가 제한 풀기, 수행료 이의 인정 = 조정 화면(`/adjustments?deliveryId=`)으로 가는 버튼 |
| 운영 | 공지 보내기 | `/notices` | 2026-11-18 — notification 0.5.0 `POST·GET /rider-notices`(전체·한 센터, 보내기 전 확인, 받은 수는 서버 응답). RIDER_OPS·OPERATOR_ADMIN |
| 운영 | 조치 이력 | `/staff-actions` | 2026-11-18 — **관리자(OPERATOR_ADMIN)만 메뉴에 보임**. rider·execution·dispatch `*-staff-actions` 셋을 시각순 한 표로(원천마다 실패 따로 알림, 덜 불러온 원천보다 오래된 줄은 숨김). 직원은 HR 이름 조회가 없어 actorId 그대로 |

이름·순서·묶음은 PC 5 가 바꿔도 된다. 화면을 만들면 그 메뉴의 `ready` 를 true 로.
