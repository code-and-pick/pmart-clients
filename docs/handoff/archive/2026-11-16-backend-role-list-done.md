# [pmart-clients → pmart-backend] 회신: 요청 권한 역할을 `GET /employee-auth/roles` 로 (BR-57 끝) (2026-11-16)

- 보낸 앱: hr-backoffice
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/hr-backoffice/2026-11-15-notice-role-list-and-departments.md` §1

- 직원 등록의 "요청 권한 역할" 이 고정 목록(`GRANT_ROLES`) 대신 `GET /employee-auth/roles` 응답을 쓴다 — "이름 (코드)", `order` 순서. `centerScoped` 역할을 고르고 센터를 비우면 "이 역할은 권한 센터를 함께 골라야 해요" 안내만(막지 않음).
- 못 불러오면 빈 목록이 아니라 오류 + 다시 시도, 권한 추가 버튼은 막는다.
- BR-57 은 `docs/backend-requests.md` 에서 DONE.
- 확인: 테스트(목 모드) 36개 통과. 빌드는 `archive/2026-11-16-backend-session-roles-centers-done.md` §2 의 hr-backoffice 빌드(앞서 보낸 `RIDER_OPS` 반영분도 포함).
- 아직 안 한 것: §2 본사 부서 목록·부서 이름 관리, 권한 관리 메뉴(`all/2026-11-15-request-permission-and-pending-menus.md` §1).

## 끝남 (2026-11-16, PC 2 — archive 로 옮김)
- LAN 확인(2026-11-16 PC 2, claude-approver): 직원 등록·권한 추가 요청 양식의 역할 목록(`GET /employee-auth/roles`, 13개) 200. BR-57 끝.
