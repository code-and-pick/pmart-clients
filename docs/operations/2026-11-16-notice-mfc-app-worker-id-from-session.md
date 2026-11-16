# 알림: mfc-app 실서버 로그인 뒤 홈이 "이용할 수 없는 화면이에요" — 센터·작업자 ID 가 목 값 (2026-11-16, PC 1)

- 받는 곳: PC 3(mfc-app)
- 보낸 곳: PC 1 (원인 조사만, 앱 코드는 손대지 않았다)
- PC 3 일지 `docs/worklog/mfc-app/2026-11-16.md` "역할별 홈" 항목의 **발견(고치지 않음)** 과 같은 문제다. 실기기에서 실제로 드러났다.

## 1. 증상
- LAN 실서버에서 `mfcw-pp-11` 로 로그인하면 로그인은 된다.
- 그 뒤 홈이 "이용할 수 없는 화면이에요 / 권한이 없거나 이용 조건을 충족하지 않아요"(`pmart_ui` `stateForbidden` — 403 을 받았을 때의 화면)다.

## 2. 계정은 정상
- 백엔드 `docs/operations/lan-test-accounts.md`: `mfcw-pp-11` = 역할 `MFC_WORKER`, 센터 `MFC-SEED-01`, 업무 피킹·포장. 시뮬레이터는 `pp-01~10` 만 쓰고 `pp-11~30` 은 PDA 용이다.

## 3. 원인 (코드를 읽고 추정 — 실제 요청은 아직 확인 안 함)
- `apps/mfc_app/lib/features/tasks/presentation/task_controllers.dart:19-24`
  - `currentMfcIdProvider` = `'MFC-MOCK-01'`
  - `currentWorkerIdProvider` = `MockTaskRepository.workerId`
- 실서버 모드에서 둘을 바꾸는 곳이 없다(`main.dart` 는 목 로그인만 바꾼다).
- 그래서 홈 `meProvider` 가 `GET /mfcs/MFC-MOCK-01/workers/<목 작업자>` 를 부르고, `MFC-SEED-01` 작업자 토큰으로 다른 센터를 조회하니 403 이다.
- 이 두 값을 쓰는 다른 곳도 같은 문제다: 다음 작업 받기·휴게(`work_controller.dart`), 인계 확인, 포장 `packedBy`, 재고 이동, 입고, 반품 `workerId`, 작업 목록.

## 4. 계약 근거
- `../pmart-backend/contracts/openapi/mfc-capacity-service.yaml:567` "workerId = 로그인 계정(운영자 ID, 토큰 subject)"
- 같은 파일 `:605` "PDA 는 본인 토큰으로 자기 workerId(= 토큰 subject)를 불러 …"
- 시뮬레이터도 `OP-…` 운영자 ID 를 workerId 로 써서 `POST next-tasks` 가 통했다(`pmart-mfc-simulation` 일지 2026-11-16).

## 5. 고치는 방향 (제안)
- 작업자 ID: 로그인 세션 `EmployeeSession.operatorId`(토큰 `sub`, `OP-…`). 목 모드는 지금처럼 목 작업자.
- 센터 ID: 토큰 `centers` 클레임. 정해지지 않은 것은 추측하지 말고 정한다.
  - 센터가 하나면 그 센터.
  - 없거나 여럿이면 어떻게 할지(안내 화면·센터 고르기) 백엔드 또는 사용자에게 확인.
  - `EmployeeSession` 주석이 "역할·센터는 화면 안내용(판정은 서버)" 이다 — 요청 경로 값으로 써도 되는지 함께 확인.
- 고칠 곳은 `lib/features/tasks/…/task_controllers.dart` 쪽(세션을 **쓰는** 코드)이라 PC 3 이 고친다. `lib/features/auth`(`EmployeeSession` 등)를 **바꿔야** 하면 그 부분은 PC 1 에 요청한다(`docs/operations/pc-split.md` "로그인·세션·토큰 코드는 PC 1 만 고친다").
- 확인: PDA 로그에서 요청 주소에 `MFC-MOCK-01` 이 보이면 원인 확정. 고친 뒤 `mfcw-pp-11` 로 다시 로그인해 홈에 이름·업무가 뜨는지 본다.

## 6. 참고 — 로그인 중 "로그인을 마치지 못했어요(시간이 지났을 수 있어요)"
- 앱 문제가 아니라 백엔드 employee-auth 시간 제한이다.
  - 로그인 시작 → Keycloak 콜백: 10분(`login-attempt-ttl`). 넘으면 앱으로 돌아오지 못한다(400).
  - 로그인 티켓 → 토큰 교환: 60초·한 번(`ticket-ttl`). 넘으면 401 `TICKET_INVALID` → 이 문구.
- Keycloak 로그인 화면을 오래 켜 두면 생긴다. "로그인" 을 다시 누르면 된다.
