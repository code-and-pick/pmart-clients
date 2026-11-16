# 백오피스 웹 인수인계 — PC 1 → PC 2 (2026-11-16)

- 보내는 PC: PC 1(192.168.0.32). 받는 PC: PC 2(192.168.0.34, backoffice 영역).
- 백엔드 짝 문서(정본, 읽기 전용): `../pmart-backend/docs/backoffice/HANDOVER.md` — 백엔드(backoffice-bff·case-service)와 결정 사항(§5)은 그쪽이 정본. 이 문서는 **클라이언트(`pmart-clients`) 쪽만** 적는다.
- 처음 할 일: §1 경계 확인 → §2 읽을 것 → §6 명령으로 PC 2 에서 시험이 통과하는지 → §4.

## 1. 맡는 것·안 맡는 것 (사용자 2026-11-15~16, 백엔드 인계서 §0)

| | PC 2 | PC 1 에 남음 |
|---|---|---|
| 앱 | `web/backoffice`, `web/hr-backoffice`(인사팀 화면 — 사용자 정정으로 PC 2) | `apps/customer_app` 등 나머지 |
| 웹 공통 | `web/core`·`web/ui` — **로그인·세션·토큰 부분 제외** | 로그인·세션·토큰 코드 전부(`pc-split.md` §1 "로그인·세션·토큰 코드는 PC 1 만" 표의 경로) |
| 앱 | `web/mfc-backoffice` 의 메뉴 화면(사용자 2026-11-16 — 백엔드 알림 `all/2026-11-16-notice-mfc-backoffice-owner-pc2.md`). 문서 `docs/apps/mfc-backoffice-web.md`. 화면이 부를 MFC API(MB-1~3)는 백엔드 PC 3, 더 필요하면 백엔드 `docs/architecture/service-requests/mfc-backoffice-staff-apis.md` | 로그인·센터 고르기 뼈대(PC 1 이 만듦) |
| 정하지 않음 | `tools/web-tools`(TS 5 타입 생성·ESLint) 담당 — 백엔드 인계서에 없다. 바꿀 일이 생기면 사용자에게 | |

- **시점**: 지금까지 백엔드가 클라이언트에 보낸 화면 요청은 **PC 1 이 끝까지 한다**(사용자 2026-11-16 "클라이언트쪽에 보낸 요청까지는 다하기로"). PC 2 는 그 뒤의 일부터 — 받은 화면은 확인만(§4-1).
- 로그인 경로를 바꾸는 PR 은 PC 1 이 돌려보낸다. 바꿀 일이 생기면 handoff·사용자를 통해 PC 1 에 요청한다. 화면이 토큰·역할을 **쓰는** 코드(요청에 붙이기, 401·403 화면, 역할로 메뉴 가리기)는 PC 2 가 그대로 고친다.
- `web/core`·`web/ui` 는 세 웹 앱이 같이 쓴다 — 바꿀 때 세 앱 typecheck·lint·test 를 같이 돌린다.
- 원본 main 에는 PC 1 만 넣는다. PC 2 는 포크 → `backoffice/<주제>`·`hr-backoffice/<주제>` 브랜치 → PR(`pc-split.md` "다른 PC 가 원본에 넣는 방법"). **PR 을 앞 PR 위에 쌓지 않는다** — `stacked-pr-squash-conflicts.md`.

## 2. 먼저 읽을 것 (순서대로)
1. 루트 `CLAUDE.md`(절대 규칙), `.claude/rules/api-integration.md`·`react-web.md`·`testing.md`
2. `docs/operations/pc-split.md`(PC·영역·일지·handoff 규칙), `other-pcs-start-here.md`
3. `docs/architecture/client-architecture.md`(웹 스택·API 연동), `docs/adr/0003-hr-backoffice-and-web-shared-packages.md`(웹 공통 패키지 구조)
4. 앱 문서: `docs/apps/backoffice-web.md`, `docs/apps/hr-backoffice-web.md`(화면·규칙 정본)
5. 최근 일지: `docs/worklog/backoffice/`, `hr-backoffice/`, `web-common/` 의 2026-11-14~16
6. 백엔드: `../pmart-backend/docs/backoffice/HANDOVER.md`, `../pmart-backend/docs/business/BackOffice-business-logic.md`(BO-01~28)

## 3. 지금 화면 (2026-11-16, 커밋 `f50025c` 기준)

### backoffice — 메뉴 묶음(`web/backoffice/src/app/nav.ts`, 역할은 세션 응답 `sessions/current`, 판정은 서버)
| 묶음 | 보는 역할 | 화면 |
|---|---|---|
| 상품 관리 | MD·OPERATOR_ADMIN(판매 상태 변경은 MD 만) | 상품·초안·일괄 등록, 카테고리, 콘텐츠, 가격, 취급 |
| 승인 | `*_APPROVER`·OPERATOR_ADMIN | 승인함, bff 승인함 |
| 고객센터 | CS_AGENT·OPERATOR_ADMIN | 주문(상세 개인정보 원문 열람 — 사유 + `pii-reveals`, 이 주문의 배송), 고객 문의, 라이더 컴플레인, 클레임, 배송 |
| 라이더 운영 | RIDER_OPS·OPERATOR_ADMIN | 라이더 찾기·상세(원문 열람·계정 제한·이 라이더의 배송), 제한 검토, 배송(찾기·전달 실패 확정 대기), 컴플레인, 주문 |
| 지원센터 | RIDER_OPS·OPERATOR_ADMIN·CS_AGENT | 사건함(미배정·내 것·기한 넘김·닫힘, 종류 거르기, 집기·닫기, 도움요청 내용), 오배송 확인 열기. `/delivery-help-requests` → `/cases?kind=RIDER_HELP` |
| 처리 대기 | OPERATOR_ADMIN | bff `views/pending-work` — 결제 결과 다시 확인·처리 완료(사유 필수)·이행 확인 |
| 업무 도우미 | 모두 | RAG 질문 |

### hr-backoffice
직원 등록(요청 권한 역할은 `GET /employee-auth/roles`), 본사 부서, 권한 관리(지금 권한 보기·추가/변경 요청·즉시 회수), 소속 변경(이전 센터 권한 다음 날 00:00 종료 안내), 정지·퇴사.

### 시험(목 모드, 2026-11-16 PC 1 에서 실행)
backoffice 194, hr-backoffice 46, web/core 25, web/ui 2, mfc-backoffice 16 — 모두 통과, typecheck·lint 통과. **실서버에서 사람이 눌러 본 것은 아직 없다**(사건함·처리 대기·권한 관리·라이더·배송).

## 4. 남은 일

### 4-1. PC 1 이 마저 할 것 (보낸 요청 — PC 2 는 반영 뒤 확인만)
| 일 | 근거 | 상태 |
|---|---|---|
| **개인정보 열람 기록 메뉴**(OPERATOR_ADMIN, audit 0.3.0 `GET /pii-access-logs`) | 백엔드 `handoff/clients/backoffice/2026-11-16-notice-pii-access-log-api.md` | PC 2 가 함(브랜치 `backoffice/pii-access-logs`, `backoffice-web.md` §2-7) |
| 처리 대기 명령의 결과 불명 처리 | 백엔드 회신 `2026-11-16-reply-case-inbox-questions.md` §3 — 결과 조회 `GET /backoffice/commands/…/{requestId}` 는 501, 시간 초과·`UNKNOWN_RESULT` 면 **목록을 다시 읽어** 확인해 달라 | **끝남(2026-11-16 PC 2)** — 결과 조회를 부르지 않고 목록 다시 읽기 |
| 사건 `refs` 의 `requestId`(case 0.4.1) | 백엔드 회신 `backoffice/2026-11-16-reply-rider-delivery-staff-apis.md` §1 — RIDER_HELP·DELIVERY_INCIDENT 는 `incidentId` 가 늘 있고, 0.4.1 부터 `requestId` 도 따로. 그 전 사건은 `incidentId` 만 | **끝남(2026-11-16 PC 2)** — `requestId`·`deliveryId` 먼저, 없으면 `incidentId`(계약 다시 생성 필요 없음 — refType 은 문자열) |

- 끝난 것(11-16 오전 백엔드 회신): backoffice 빌드 `index-BGISi3dQ.js`(f50025c — 라이더·배송 포함)가 LAN 에 올라갔다. hr `index-Bkg8rNsZ.js`·mfc `index-ChSinewe.js` 는 그대로. 실서버에서 사람이 눌러 본 화면은 아직 없다.

### 4-2. PC 2 일 (추천 순서)
1. **받은 화면 확인** — 4-1 이 반영된 빌드가 LAN 에 올라오면 시험 계정(§6)으로 메뉴마다 눌러 보고, 빠진 것만 고친다.
2. 열린 handoff 정리 — §5 표의 backoffice·hr-backoffice 문서는 백엔드 확인이 오면 PC 2 가 `archive/` 로 옮긴다.
3. 백엔드가 새로 보내는 화면 요청(백엔드 인계서 §4: case R-3 사가·결제 이상 사건, 배송 쪽 사건 번호 연결, bff 다른 `/views/*` 등) — 이것부터가 PC 2 일. 리뷰(ADR-0063)·고객 알림함(ADR-0064)의 백오피스 화면은 만들지 않는다(리뷰 숨김·신고 없음 — 사용자 결정, 정책이 정해질 때).
4. 백오피스 관련 열린 BR(`docs/backend-requests.md`): BR-10(상세 조회·내보내기), BR-25(인증 필요한 상품 이미지 표시), BR-26(초안 목록), BR-31(상품 검색어). BR 상태표는 PC 1 이 합칠 때 고친다 — PC 2 는 일지·PR 설명에 "BR-xx 갱신 필요"만.

## 5. 열린 handoff (클라이언트 → 백엔드, `docs/handoff/`)
| 문서 | 기다리는 것 | 넘김 |
|---|---|---|
| `backoffice/2026-11-16-backend-pii-reveal-and-pending-done.md` | 반영 확인 — LAN 조회는 확인, 원문 열람 실서버 미확인 | PC 2 |
| (끝남 — 2026-11-16 PC 2 `archive/`) `2026-11-15-backend-assistant-connected.md`, `…-cs-rider-menus-done.md`, `2026-11-16-backend-product-menu-operator-admin-done.md`, `…-departments-and-permissions-done.md`, `…-role-list-done.md`, `…-case-inbox-and-pending-work-done.md` | 회신 받음·LAN 조회 화면 확인(각 문서 끝 "끝남") / 사건함 질문은 클라이언트 후속 반영(PR #19) | — |
| (끝남 — 2026-11-16 `archive/`) `2026-11-16-backend-rider-delivery-staff-apis-done.md`, `…-session-roles-centers-done.md`, `…-session-center-names-done.md` | 회신·빌드 올림 확인 | — |
| `web-common/2026-11-14-backend-logout-propagation.md`, `…-refresh-cookie-silent-login.md` | 로그인 관련 | PC 1 |

## 6. 규칙·도구
- 명령(루트에서): `npm install`, `npm install --prefix tools/web-tools`, `npm run gen:api -w web/backoffice`(생성물은 커밋 안 함), `npm run typecheck|lint|test -w web/<앱>`. 검증은 목 모드(MSW)만.
- dev 서버: backoffice 5173, hr-backoffice 5174, mfc-backoffice 5175(목 모드 `npm run dev -w …`, 실서버 `dev:local`). 5173 을 다른 프로그램이 쓰고 있으면 다른 포트로.
- LAN 빌드: `npm run build:lan -w web/<앱>` → dist·진입 파일 이름을 handoff 로 알리면 PC 1 이 `lan.sh publish-*` 로 올린다. PC 4 에 직접 복사하지 않는다.
- 일지: `docs/worklog/backoffice/`·`hr-backoffice/`·`web-common/` 의 `YYYY-MM-DD.md`(자기 영역만). handoff: `docs/handoff/backoffice/`·`hr-backoffice/` 에 `YYYY-MM-DD-backend-<주제>.md`(첫머리 `보낸 앱:`·`받는 백엔드 영역:`).
- 계약: `contracts.lock`(web) 은 PC 1 이 합칠 때 고친다. PR 설명에 "계약 다시 생성: <서비스>, 백엔드 SHA".
- 개인정보 원문: 기본 가림 → 사유 → 열람 기록 뒤에만(ADR-0062). 원문은 화면 메모리에만, 콘솔·로그·분석에 남기지 않는다. 열람 사유도 로그 금지.
- 시험 계정·토큰: 백엔드 인계서 §6(`claude-dev` OPERATOR_ADMIN, `test-cs-rider@pmart.com` CS_AGENT·RIDER_OPS, `claude-approver`, `claude-mfc-sup`). 비밀번호는 PC 1 에서 파일로 받는다 — 저장소·빌드 설정·채팅에 넣지 않는다.
- 화면을 바꾸면 보고에 캡처를 붙인다(자기 dev 서버·자기 브라우저, 사용자 2026-11-16).
