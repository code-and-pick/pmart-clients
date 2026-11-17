# 인사팀 백오피스 (web/hr-backoffice, React SPA)

담당: **PC 2**(backoffice 영역, 2026-11-16 PC 1 에서 넘김 — 인계서 `docs/operations/backoffice-handover.md`). 로그인·세션·토큰 코드는 PC 1 만 고친다(`docs/operations/pc-split.md` §1).

근거: 백엔드 handoff `2026-11-13-clients-request-hr-backoffice.md`(사용자 결정 2026-11-13 — 별도 앱·SSO), 백엔드 ADR-0056(결정 5·7·8·10), 계약 `hr-service.yaml` 0.1.0·`employee-auth-service.yaml`·`center-master-service.yaml`(`GET /centers`), 흐름 `docs/business/flows/employee-account-provisioning.md`(백엔드). 클라이언트 결정은 ADR-0003.

상태(2026-11-13): 목 서버로 구현·검증 → LAN 배포·실서버 확인 23/23(`docs/handoff/archive/2026-11-13-backend-hr-backoffice-lan-deployed.md`) → **HTTPS 로 옮김(`https://192.168.0.40:8444`, 옛 `http://…:8081` 은 HTTPS 로 넘어간다)**. HTTPS 주소에서의 브라우저 확인과 사람 손 확인은 아직. 요청 권한 기간은 종료일이 없으면 "기한 없음"(정규직 — 백엔드 회신 `clients-reply-hr-backoffice-deployed`).

## 1. 원칙
- 사용자는 인사팀(`HR_ADMIN`). 역할이 없으면 서버가 403 → "이용할 수 없는 화면". 화면은 세션 응답(`sessions/current` 0.6.0 의 `roles`)으로 "인사 권한이 없습니다" 안내만 하고 막지 않는다(판정은 서버). 본인 조회(`/hr/employees/me`)만 모든 직원.
- hr-service 가 정본인 것(직원 신원·고용 정보·계정 발급 단계)만 보여 주고 바꾼다. **권한의 효력은 다루지 않는다** — 요청 권한은 상태만 보이고 승인 버튼이 없다(승인은 지금 백오피스 승인함, 인사와 권한 분리).
- 비밀번호를 받지 않는다. 로그인 비밀번호는 본인이 Keycloak 메일 링크로 정한다. 사서함 초기 비밀번호는 응답을 **한 번만** 보여 주고 저장·로그·클립보드 자동 복사를 하지 않는다.
- 상태 변경은 사유 + `X-Expected-Version`(직원 `version`). 서버 응답이 온 것만 화면에 반영한다. 계정 발급 단계는 서버 값만 보인다(등록 201 ≠ 발급 완료).

## 2. 앱·로그인
| 항목 | 값 |
|---|---|
| 로그인 | employee-auth-service, 백오피스와 같은 흐름·같은 코드(`@pmart/web-core` `createEmployeeAuth`). 앱 이름 `hr-backoffice` |
| SSO | 백오피스에 로그인돼 있으면 비밀번호 없이 들어온다. 로그아웃(`idpLogoutUri`)은 두 앱의 Keycloak 세션을 같이 끝낸다 |
| 주소 | 개발 `http://localhost:5174`, LAN `https://192.168.0.40:8444`(복귀 `…/auth/callback`, API `https://192.168.0.40:8443/api/v1`). 빌드는 백엔드가 `lan.sh publish-hr-backoffice` 로 올린다 |
| `X-Source-System` | `hr-backoffice-web` |
| 보관 | access token 메모리, refresh token·기기 ID 는 탭 sessionStorage(`pmart.hr-backoffice.session`) |
| 빌드 모드 | `mock`(MSW, 목 계정 버튼 — Keycloak 없음, 티켓 교환부터는 실제 코드) / `local`(게이트웨이 프록시) / `lan` |

## 3. 화면
| 경로 | 화면 | API |
|---|---|---|
| `/login`, `/auth/callback` | 로그인·복귀 | `GET /employee-auth/logins`(브라우저 이동), `POST /employee-auth/tokens` |
| `/employees` | 직원 목록(검색어·상태·소속 코드, 더 보기) | `GET /hr/employees` |
| `/employees/new` | 직원 등록(기본 정보 + 요청 권한 행) | `POST /hr/employees`, `GET /centers` |
| `/employees/:operatorId` | 상세: 기본 정보, 계정 발급 단계, 요청 권한 상태, 인사 처리 | `GET /hr/employees/{id}` + 아래 명령 |
| `/departments` | 본사 부서(2026-11-16): 코드·이름·소속 직원 수, 이름 저장, 부서 추가. 등록·소속 변경의 본사 부서 입력은 이 목록에서 고르거나(datalist) 새 코드 | `GET /hr/departments`, `PUT /hr/departments/{code}`(hr 0.3.0) |
| `/permissions`, `/permissions/:operatorId` | 권한 관리(BO-01, 2026-11-16): 직원 찾기 → 지금 쓰는 역할·센터(effective), 승인된 권한(유효·끝남·회수됨, 자동 승인 표시, 승인·회수한 사람은 이름 — `approverName`·`revokedByName` 0.10.0, 없으면 운영자 ID), 관리자 보정 값, 권한 요청 상태. 추가·변경 요청(승인 거침, 한 번에 하나 — `GRANT_REQUEST_PENDING`), 회수(승인 없이 즉시 — "바로 로그아웃" 확인 + 사유). `OPERATOR_ADMIN`·`HR_ADMIN` 줄·자기 자신은 회수 버튼 없음. 계정 발급 전(404 `EMPLOYEE_NOT_FOUND`)은 "계정 발급 중" | `GET /hr/employees`, `GET /employee-auth/employees/{id}`(0.7.0), `POST /hr/employees/{id}/grant-requests`(hr 0.3.0), `POST /employee-auth/employees/{id}/grant-revocations`(0.8.0) |
| `/session` | 내 인사 정보·세션·로그아웃 | `GET /hr/employees/me`, `GET /employee-auth/sessions/current`, `POST /employee-auth/logouts` |

상세 화면의 명령: 소속 변경(`affiliation-changes`), 정지(`suspensions`)·복귀(`reinstatements`)·퇴사(`departures`), 안내 메일 다시(`invite-resends`), 발급 다시 시도(`provisioning-retries`), 사서함 초기 비밀번호(`mailbox-password-resets`).

- 계정 발급 단계 표시: REQUESTED·MAILBOX_CREATED·IAM_CREATED·INVITE_SENT = "발급 중"(3초마다 다시 조회), DONE = "완료", FAILED·COMPENSATED = "실패 — 다시 시도"(다시 시도 버튼). 오류 코드는 서버 값 그대로 작게.
- 요청 권한: PENDING → SUBMITTED(승인 대기, 15초마다 다시 조회) → APPROVED / REJECTED.
- 정지·퇴사는 "로그인이 바로 막힌다" 경고와 사유 입력을 거친다.

## 4. 백엔드 회신으로 정해진 것 (`../pmart-backend/docs/handoff/clients/2026-11-13-clients-reply-hr-backoffice-questions.md`)
| # | 답 | 구현 |
|---|---|---|
| Q1 | 본사 부서 코드는 목록·API 없음(자유 입력). 이전한 기존 직원은 임시로 `HQ` — **2026-11-16 `GET /hr/departments` 가 생김** | 목록에서 고르기 + 새 코드 입력(형식만 검사), 이름은 `/departments` |
| Q2 | `HR_ADMIN` 도 `GET /centers` 가능 | 센터는 목록에서 고르기(실패하면 안내 + 코드 직접 입력) |
| Q3 | 발급 다시 시도는 FAILED·COMPENSATED(그 밖은 409 `INVALID_STATE`) | 두 단계에 버튼 |
| Q4 | `GrantRequestState` 에 `reason`·`approvalRef` 추가 | 상세의 요청 권한 표에 근거·승인 ID |
| Q5 | 409 = `MAIL_ID_TAKEN`·`VERSION_CONFLICT`·`INVALID_STATE`·`KEYCLOAK_<상태>`·`MAILBOX_<상태>`. 퇴사도 버전이 다르면 409. 이미 그 상태인 복귀·퇴사는 200 | 앞의 셋은 전용 문구, 나머지는 일반 문구 + code |
| Q6 | `GRANT` 승인 행 `attributes.employee{operatorId, employeeNo, mailAddress, affiliation}` — 이름은 없음 | 백오피스 승인 상세가 역할·센터·기간·근거·대상 직원을 표시 |
| — | 복귀: 파트타임·일일크루는 기존 계약 종료일이 지났으면 새 종료일 필요(400 `VALIDATION_FAILED` `endDate`) | 복귀 화면에 안내, 서버 거절을 그대로 보임 |
| — | 요청 권한 역할 = `GET /employee-auth/roles`(0.5.0, BR-57 끝남 2026-11-16) — "이름 (코드)", 순서 그대로, `centerScoped` 면 센터를 고르라고 안내. 못 불러오면 오류 + 권한 추가 막음 | `src/features/employees/roles.ts` |

## 5. 하지 않은 것
- 개인정보 마스킹: 인사 화면은 이름·메일을 그대로 보인다(계약에 사유 입력 열람 API 없음, 주민번호·연락처 등은 계약에 없다).
- 직원 정보 수정(이름·고용 형태·기간 변경) — 계약에 API 가 없다.
