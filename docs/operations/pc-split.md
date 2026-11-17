# PC 나눠 작업하기 — PC 별 역할·폴더 구조·앱 영역·기록 규칙 (2026-11-13)

여러 PC 가 이 저장소를 동시에 고친다(사용자 결정 2026-11-13 — "클라이언트 영역은 앱 단위로"). 같은 파일을 여러 PC 가 고치면 합칠 때 충돌하므로 **작업 일지·handoff·소유를 앱 영역 단위로 나눈다.** PC 담당은 바뀔 수 있어도 영역은 잘 안 바뀌므로 PC 가 아니라 영역으로 나눈다.

- 백엔드의 같은 규칙(정본): `../pmart-backend/docs/operations/pc-split.md`, 루트 `../pmart-backend/CLAUDE.md` "PC 나눠 작업하기".
- 다른 PC 에서 개발하는 법(포크·PR·시험 계정·토큰): `../pmart-backend/docs/operations/dev-on-other-pcs.md`. PC 별 할 일 체크리스트: `../pmart-backend/docs/operations/other-pcs-todo.md`(클라이언트 절 있음).
- 다른 PC 가 읽을 문서 지도(순서·PC 별·필요할 때·시작할 때 보낼 말): `docs/operations/other-pcs-start-here.md`.
- 적용: 일지의 영역별 폴더는 **2026-11-14 부터**(2026-11-13 까지의 일지는 그대로 둔다). handoff 는 **2026-11-13 에 폴더를 나눴다** — 그때까지의 문서는 `docs/handoff/archive/`(열린 것 둘만 영역 폴더).

## 1. PC 별 역할 (2026-11-13 기준)

백엔드 칸은 백엔드 `pc-split.md` §1·§1-1 과 `deploy/lan/placement.conf` 를 옮긴 것이다(정본은 백엔드). 바뀌면 백엔드 문서가 먼저 바뀐다.

| PC | IP | 백엔드 영역(개발) | 클라이언트(이 저장소) | LAN 에서 돌리는 것 |
|---|---|---|---|---|
| **PC 1** | 192.168.0.32 | **platform** — 인증·HR·승인·게이트웨이·라이브러리·배포, 다른 영역 밖의 모든 서비스. **배포·병합 유일 지점** | **customer-app 위주**(사용자 2026-11-13) + **로그인·세션·토큰 코드**(모든 앱). backoffice·hr-backoffice·web-common 은 **2026-11-16 PC 2 로 넘겼다**(PC 2 작업 중) — PC 1 은 그 전에 받은 화면 요청 중 남은 것만(`backoffice-handover.md` §4-1). **mfc-backoffice** 는 로그인·센터 고르기 뼈대만 이 PC(2026-11-15), 메뉴 화면은 PC 2(사용자 2026-11-16). **원본 main 에 넣는 유일한 PC** | 없음(빌드·Claude Code 전용, Docker 미기동) |
| **PC 2** | 192.168.0.34 | **backoffice**(2026-11-16 PC 1 에서 넘김) — 백엔드 `backoffice-bff`·`case-service` + 클라이언트 웹 | **`web/backoffice`·`web/hr-backoffice`·`web/mfc-backoffice`·`web/core`·`web/ui`(로그인·세션·토큰 부분 제외)** — 2026-11-16 넘김(mfc-backoffice 는 같은 날 사용자 결정, 백엔드 알림 `all/2026-11-16-notice-mfc-backoffice-owner-pc2.md`). 지금까지 백엔드가 보낸 화면 요청은 PC 1 이 끝까지 하고 PC 2 는 그 뒤부터. 인계서 `docs/operations/backoffice-handover.md` | 커머스 서비스(상품·고객·장바구니·검색·가격·주문·결제 등), Kafka 1 |
| **PC 3** | 192.168.0.222 | **mfc** — mfc-*-service, MFC 시뮬레이터 연결 | **mfc-app**(사용자 확정 2026-11-13) — `apps/mfc_app` | MFC 서비스 6개, CDC 재고, 검색 색인(ES) |
| **PC 4** | 192.168.0.40 | 없음. 예정 **rag**(사용자 확정 2026-11-13, 시작 전) — 백엔드만 | 미정(rag 는 클라이언트 영향 거의 없음) | **API 게이트웨이**(`https://192.168.0.40:8443`, 앱용 `http://…:8080`), **백오피스 화면**(`https://192.168.0.40`), **인사팀 백오피스 화면**(`https://192.168.0.40:8444`), auth-service·승인·bff·설정 서버·Eureka·모니터링. 화면 서빙은 backoffice 영역이 PC 2 로 가도 계속 PC 4, 배포는 PC 1 |
| **PC 5** | 192.168.0.101 | **delivery** — delivery-*·rider-service·rider-auth-service | **rider-app**(사용자 확정 2026-11-13) — `apps/rider_app` | 배송 서비스, **Keycloak**(직원 로그인 화면), employee-auth-service, hr-service, 사내 메일·웹메일(`https://192.168.0.101:8190`), RAG 실행(ollama) |

- **클라이언트 담당(사용자 확정 2026-11-13, PC 2 넘김 2026-11-16): PC 1 = customer-app 위주 + 로그인 코드, PC 2 = backoffice·hr-backoffice·mfc-backoffice·web-common(로그인 제외), PC 3 = mfc-app, PC 5 = rider-app.** PC 4(rag)는 클라이언트 앱 영역이 없다. mfc-backoffice 화면이 부르는 MFC API 는 백엔드 PC 3(mfc 영역)이 만든다. 바뀌면 이 표를 고친다.
- mfc-app 은 2026-11-13 까지 PC 1 이 고쳤다(직원 로그인 — 일지 `docs/worklog/2026-11-13.md`). 남은 일(정지 안내를 `SUBJECT_BLOCKED` 기준으로, 실기기 로그인 확인)은 PC 3 이 이어받는다 — `../pmart-backend/docs/operations/other-pcs-todo.md` 클라이언트 절.
- 두 백오피스의 HTTP 주소(80·8081)는 2026-11-13 에 닫혔다(HTTPS 로 301). LAN 빌드의 API 주소는 `https://192.168.0.40:8443/api/v1`.
- Flutter 앱(mfc_app·customer_app)은 게이트웨이 `http://192.168.0.40:8080/api/v1` 을 그대로 쓴다(디버그 빌드).
- 웹 빌드 배포: **PC 4 에 직접 복사하지 않는다.** `npm run build:lan -w web/<앱>` 뒤 dist 폴더와 진입 파일 이름을 handoff 로 알리면 PC 1 의 백엔드가 `lan.sh publish-backoffice`·`publish-hr-backoffice`·`publish-mfc-backoffice` 로 올린다(직접 복사한 빌드는 다음 배포 때 덮인다 — 2026-11-13 겪음).

### 로그인·세션·토큰 코드는 PC 1 만 고친다 (사용자 2026-11-15)
"백오피스, mfc 로그인, 소셜 로그인같은 작업은 pc1에서 하는걸로 정해서 다른쪽에서 코드가 오염되는걸 막고싶어" — 백엔드 알림 `../pmart-backend/docs/handoff/clients/all/2026-11-15-notice-login-code-pc1-only.md`, 백엔드 정본 `pmart-backend/docs/operations/pc-split.md` §1-3.

| 앱·패키지 | PC 1 만 고치는 경로 |
|---|---|
| `web/core` | `src/employeeAuth.ts`·`session.ts`·`sessionPersistence.ts`·`tokens.ts`, `pmartFetch.ts` 의 토큰 갱신 부분 |
| 웹 앱(backoffice·hr-backoffice·mfc-backoffice) | `src/features/session`, 그리고 그것을 받치는 `src/api/employeeAuth.ts`·`src/api/sessionPersistence.ts`·`src/app/SessionContext.tsx` |
| `apps/customer_app` | `lib/features/auth`(Google 로그인) |
| `apps/mfc_app` | `lib/features/auth`(직원 로그인) |
| `packages/pmart_core` | `lib/src/auth_tokens.dart`·`lib/src/interceptors.dart` |

- **예외: `apps/rider_app` 로그인은 rider-app 담당(PC 5)이 만든다**(사용자 2026-11-15). 공용 `pmart_core` 토큰 코드는 위 표대로 PC 1.
- 업무 화면이 토큰을 **쓰는** 코드(요청에 붙이기, 401·403 화면, 역할로 메뉴 가리기)는 각 앱 담당이 그대로 쓴다 — 위 경로를 **바꾸는** 것만 PC 1. 바꿀 일이 생기면 handoff 나 사용자를 통해 PC 1 에 요청한다.
- 새 앱(예 mfc-backoffice)은 로그인·세션 부분을 PC 1 이 먼저 만들고, 메뉴·업무 화면은 담당 PC 가 만든다.

### 다른 PC 가 원본에 넣는 방법 — 포크 → PR → PC 1 병합

PC 마다 GitHub 계정이 다르고, PC 1 이 아닌 계정은 원본(`code-and-pick/pmart-clients`)에 push 할 수 없다(triage 권한 — 사용자가 만든 구조, 포크는 허용). 절차는 백엔드 `dev-on-other-pcs.md` §0 과 같다(저장소 이름만 다르다).

```bash
gh repo fork code-and-pick/pmart-clients --clone=false
git remote add fork https://github.com/<내 계정>/pmart-clients.git
git switch -c <앱 영역>/<주제>          # 예 mfc-app/login-notice — 작업 → 커밋(일지 포함)
git fetch origin && git rebase origin/main
git push fork <앱 영역>/<주제>
gh pr create --repo code-and-pick/pmart-clients --base main --head <내 계정>:<앱 영역>/<주제>
```

- PR 설명에 바꾼 것·실행한 시험·영향 앱 영역·공통 문서(§5) 갱신 필요를 적는다.
- 받기는 늘 `git pull origin main`. PC 1 의 작업은 원본 main 에 바로 들어가므로 작업 시작·PR 전에 받아서 rebase 한다.
- PR 을 앞 PR 위에 쌓지 않는다(원본은 squash 로 합쳐 뒤 PR 이 매번 충돌한다). 쌓아야 하면 앞 PR 이 합쳐진 뒤 `rebase --onto` 로 옮긴다 — 내역·방법: `stacked-pr-squash-conflicts.md`.
- 쌓은 묶음이 모두 준비되면 PC 1 은 **맨 위 PR 하나만 squash 로 합치고 아래 PR 은 닫는다**(사용자 2026-11-16). 맨 위 PR 설명에 묶음 전체 요약을 적는다 — 같은 문서 §4-3·§5.

## 2. 폴더 구조

### 저장소 배치 — 같은 부모 폴더의 형제

```
<부모 폴더>/                 # 드라이브·경로는 어디든 된다(PC 1 은 C:\development\pmart-project)
  pmart-backend/             # 백엔드(읽기만). 계약·상태표·handoff 회신·LAN 시험 계정 파일이 여기 있다
  pmart-clients/             # 이 저장소
  pmart-mfc-simulation/      # MFC 시뮬레이터(백엔드 mfc 영역이 맡는다)
```

`tools/gen_api.dart`·`npm run gen:api` 와 문서가 `../pmart-backend` 를 가정하므로 **형제로 둔다.** 백엔드를 최신으로 받아 둬야 계약·회신이 맞는다(`git -C ../pmart-backend pull origin main`).

### 이 저장소 — 폴더와 앱 영역

```
apps/
  customer_app/        # customer-app
  mfc_app/             # mfc-app
  rider_app/           # rider-app
packages/              # Dart 공유(pmart_api 생성 클라이언트·pmart_core·pmart_ui) — 공통(아래 §3)
web/
  backoffice/          # backoffice
  hr-backoffice/       # hr-backoffice
  mfc-backoffice/      # mfc-backoffice
  core/  ui/           # web-common (@pmart/web-core · @pmart/web-ui)
tools/
  gen_api.dart         # Dart 계약 생성 — 공통
  web-tools/           # web-common (타입 생성·ESLint)
docs/
  apps/<앱>.md                         # 앱별 화면·규칙 — 그 앱 영역이 고친다
  worklog/<앱 영역>/YYYY-MM-DD.md       # 작업 일지 — 자기 영역 폴더에만(§4)
  worklog/YYYY-MM-DD.md                # 2026-11-13 까지의 일지(그대로 둔다)
  handoff/<앱 영역|all>/YYYY-MM-DD-backend-<주제>.md   # 백엔드로 보내는 문서(§5) — 끝나면 handoff/archive/
  operations/pc-split.md               # 이 문서
  architecture/ · adr/ · roadmap.md · backend-requests.md   # 공통 문서(§6)
contracts.lock · CLAUDE.md · .claude/rules/   # 공통(§6)
```

### 저장소에 없어서 PC 마다 다시 만들거나 받아야 하는 것

| 것 | 어떻게 |
|---|---|
| 생성 클라이언트(`packages/pmart_api/gen/`, `web/*/src/**/generated/`) | `dart tools/gen_api.dart`(약 6분, `flutter pub get` 보다 먼저), `npm run gen:api -w web/backoffice`·`-w web/hr-backoffice`·`-w web/mfc-backoffice` |
| `node_modules` | `npm install`(루트), `npm install --prefix tools/web-tools` |
| 웹 빌드(`web/*/dist`) | `npm run build:lan -w web/<앱>` — 올리는 것은 PC 1(§1) |
| 고객앱 레퍼런스 캡처 `docs/customer-app-design/` | git 제외 — **PC 1 에만 있다.** 고객앱 화면 작업은 이 폴더가 있어야 한다(다른 PC 가 맡으면 사용자가 복사) |
| LAN 시험 계정 비밀번호 | 백엔드 `deploy/lan/.secrets/` 에 필요한 파일만(사용자가 복사). 저장소 루트에 두지 않고, 이 저장소에는 절대 넣지 않는다. `keycloak-admin-password` 는 PC 1 밖으로 옮기지 않는다 |
| LAN 루트 CA | PC 2~5 Windows 에는 설치돼 있다. PDA·폰은 `../pmart-backend/deploy/lan/tls/pmart-lan-root-ca.crt` 를 기기에 설치해야 직원 로그인 화면(브라우저)이 열린다. **Flutter 앱의 API 호출(Dio·`Image.network`)은 기기에 설치한 CA·안드로이드 `network_security_config` 를 쓰지 않는다** — `https://192.168.0.40:8443` 을 쓰려면 앱 `main` 에서 `if (!kReleaseMode) trustPmartLanRootCa();`(`pmart_core`, 2026-11-16, ADR-0057 T6 — 운영 빌드 제외)를 부른다. 고객앱은 넣었다. **mfc_app(PC 3)·rider_app(PC 5)은 아직 `http://…:8080` — HTTPS 로 옮길 때 이 한 줄을 넣는다** |

## 3. 앱 영역

| 영역 | 폴더 |
|---|---|
| **customer-app** | `apps/customer_app` |
| **mfc-app** | `apps/mfc_app` |
| **rider-app** | `apps/rider_app` |
| **backoffice** | `web/backoffice` |
| **hr-backoffice** | `web/hr-backoffice` |
| **mfc-backoffice** | `web/mfc-backoffice` (센터 관리자 웹, 2026-11-15) |
| **web-common** | `web/core`·`web/ui`·`tools/web-tools` (웹앱 공통 — 한 주인) |

- 영역 이름은 백엔드 제안과 같다(백엔드가 handoff 파일 이름에 그대로 쓴다).
- **web-common**: 2026-11-16 backoffice·hr-backoffice 와 함께 PC 2 로 넘겼다(백엔드 인계서 `pmart-backend/docs/backoffice/HANDOVER.md` §0). 단 `web/core` 의 직원 로그인·세션·토큰 코드와 웹 앱의 로그인 부분은 PC 1 이 맡는다(§1 표). `tools/web-tools` 담당은 정하지 않았다.
- 위 표에 없는 공통 폴더(`packages/pmart_*`, `tools/gen_api.dart`)는 따로 영역을 두지 않았다. 고칠 때는 고친 앱 영역의 일지에 적고 `영향: <다른 앱 영역>` 을 단다. 담당을 정해야 하면 사용자가 정한다(미정).
- 남의 영역 폴더를 고쳐야 하면 직접 고치지 말고 사용자에게 먼저 알린다(그 영역 담당과 겹치지 않게).

## 4. 작업 일지 — 앱 영역별 폴더

- **`docs/worklog/<앱 영역>/YYYY-MM-DD.md`**. 자기 영역 파일에만 쓴다.
- 다른 영역에 영향을 준 일은 자기 일지에 `영향: backoffice` 처럼 적는다(남의 일지에 쓰지 않는다).
- 형식과 나머지 규칙은 `docs/worklog/README.md` 그대로.

## 5. handoff — 앱 영역별 폴더

- 클라이언트 → 백엔드: **`docs/handoff/<앱 영역>/YYYY-MM-DD-backend-<주제>.md`**(사용자 결정 2026-11-13 — 파일 이름이 아니라 폴더로 나눈다). 여러 앱에 걸치면 `docs/handoff/all/`. 자기 영역 폴더에만 쓴다. 폴더·규칙·열린 문서 목록은 `docs/handoff/README.md`.
  - 처리가 끝난 문서는 `docs/handoff/archive/` 로 옮긴다(`git mv`, 이름 그대로 — 그 영역 담당이). 이 저장소 문서가 그 경로를 가리키면 같은 커밋에서 고친다.
  - 첫머리에 **`보낸 앱: <앱 영역>`** 과 **`받는 백엔드 영역: platform|mfc|delivery`** 를 적는다. 회신이면 원 문서 경로도 적는다.
  - 받는 영역 고르기: 인증·로그인·HR·승인·게이트웨이·배포·공통 계약과 아래 둘 밖의 모든 서비스는 platform(PC 1), MFC 업무 API(mfc-*-service)는 mfc(PC 3), 배송·라이더(delivery-*·rider-service·rider-auth-service)는 delivery(PC 5).
  - 예: `docs/handoff/mfc-app/2026-11-14-backend-picking-scan.md`(받는 백엔드 영역 mfc).
- 백엔드 → 클라이언트: `../pmart-backend/docs/handoff/clients/<받는 앱 영역|all>/YYYY-MM-DD-<종류>-<주제>.md`(종류 request·reply·notice, 첫머리 `보낸 영역:` — 같은 폴더 구조, 제안 `docs/handoff/archive/2026-11-13-backend-handoff-folders.md`). 각 앱 담당은 **자기 앱 영역 폴더와 `all/`** 만 읽으면 된다. 2026-11-13 까지의 파일은 `clients/` 바로 아래 `…-clients-…`.
- 한 주제는 한 앱 영역이 보낸다(같은 주제를 두 PC 가 따로 보내지 않는다).
- 백엔드는 다른 PC 의 handoff 를 **원본 main 에 들어온 뒤** 읽는다(PC 1 의 것만 작업 폴더에서 바로 읽는다). 다른 PC 는 handoff 를 PR 에 넣어 보낸다.

## 6. 여럿이 고치는 문서 — PC 1 이 합칠 때 몰아서

`docs/backend-requests.md`, `contracts.lock`, `docs/roadmap.md`, `docs/architecture/`, 루트 `CLAUDE.md`·`.claude/rules/`, 이 문서처럼 여러 앱 영역이 고치는 파일은 다른 PC 가 따로 고치지 않는다. 자기 일지·handoff 파일에만 적고(예: "BR-xx 등록 필요", "계약 다시 생성: employee-auth, 백엔드 SHA") PR 설명에 갱신 필요를 적으면, PC 1 이 합치면서 한 번에 반영한다. 자기 앱 줄 하나만 고치는 것은 괜찮다.

## 7. 다른 PC 도 알아야 할 사실은 저장소 문서에

Claude 메모는 PC 마다 따로라 서로 모른다. 다른 PC 도 알아야 할 사실(바뀐 규칙·계정 받는 법·배포 방법)은 메모가 아니라 저장소 문서에 둔다 — 이 문서, 루트 `CLAUDE.md`, 백엔드 `docs/operations/dev-on-other-pcs.md`·`other-pcs-todo.md`.

## 8. 아직 정하지 않은 것 (사용자 결정)

- `tools/web-tools` 담당.
- 공통 폴더(`packages/pmart_*`·`tools/gen_api.dart`)의 담당.
