# [pmart-clients → pmart-backend] 회신: 본사 부서 목록 + 권한 관리 메뉴 (2026-11-16)

- 보낸 앱: hr-backoffice
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/hr-backoffice/2026-11-15-notice-role-list-and-departments.md` §2, `../pmart-backend/docs/handoff/clients/all/2026-11-15-request-permission-and-pending-menus.md` §1

## 1. 본사 부서 (hr 0.3.0)
- 등록·소속 변경의 "본사 부서" 입력: `GET /hr/departments` 목록에서 고르거나(이름 있으면 "이름 (코드)") 새 코드를 친다. 목록에 있는 코드면 이름을, 없는 코드면 "새 부서 코드" 안내. 목록을 못 불러오면 안내 + 직접 입력.
- 새 메뉴 "본사 부서"(`/departments`): 코드·이름·소속 직원 수 표, 이름 저장과 부서 추가는 `PUT /hr/departments/{code}`(`Idempotency-Key`·`X-Source-System`, 비우면 `{}` — 이름 지움).

## 2. 권한 관리 (BO-01)
- 새 메뉴 "권한 관리"(`/permissions`): 검색어 → `GET /hr/employees?q=` → 직원을 고르면 `/permissions/{operatorId}`.
- 지금 권한: `GET /employee-auth/employees/{operatorId}` — 로그인 상태, `effectiveRoles`(역할 이름은 `GET /employee-auth/roles`)·`effectiveCenters`, 마지막 로그인. `grants[]` 표: 역할·센터·기간(`validUntil` null = "근무 기간까지")·승인(`RULE:` 이면 "자동 승인")·상태(유효·끝남·회수됨 + 누가·언제·사유). `roles` 중 유효한 grant 에 없는 것은 "관리자 보정 값"으로 표시만. 404 `EMPLOYEE_NOT_FOUND` 는 "계정 발급 중".
- 진행 중 요청: hr 직원의 `requestedGrants` 상태.
- 추가·변경 요청: 역할(목록)·센터·기간·사유 → `POST /hr/employees/{operatorId}/grant-requests`(`X-Expected-Version` = hr 직원 version, 한 줄씩). 결정 안 된 요청이 있으면 폼 대신 안내, 409 `GRANT_REQUEST_PENDING` 문구.
- 회수: 유효한 줄에만 "회수" → "회수하면 이 직원은 바로 로그아웃돼요" + 사유 → `POST /employee-auth/employees/{operatorId}/grant-revocations` {grantId, reason}. 응답(직원 조회 결과)으로 바로 바꾼다. `OPERATOR_ADMIN`·`HR_ADMIN` 줄은 (사용자에게 `OPERATOR_ADMIN` 이 없으면) 버튼 없음, 자기 자신은 회수·요청 모두 없음.

## 3. 확인·빌드
- typecheck·lint 통과, 테스트 46개 통과(목 모드). 실서버 확인은 아직.
- 빌드: `web-common/2026-11-16-backend-session-roles-centers-done.md` §2 표의 hr-backoffice 해시를 바꿨다(`index-Bkg8rNsZ.js`·`index-CU0EfKq_.css`).

## 4. 덧붙임 — hr 0.4.0 소속 변경 자동 종료 반영 (백엔드 8e7c84eb)
- 소속 변경 창 안내를 "권한은 바뀌지 않아요" → "이전 센터 권한은 내일 00:00 에 자동으로 끝나요(오늘 안에 인계). 새 센터 권한은 권한 관리에서 따로 요청"으로 바꿨다. 목도 같은 규칙(이전 센터가 든 grant 의 validUntil = 다음 날 00:00 서울).
- 빌드 해시는 web-common 회신 §2 표(`index-Bkg8rNsZ.js`).
