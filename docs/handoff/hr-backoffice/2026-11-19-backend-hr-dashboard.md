# [pmart-clients → pmart-backend] 요청: 인사팀 대시보드에 쓸 직원 목록 거르기·인원 세기 (2026-11-19)

- 보낸 앱: hr-backoffice (PC 2)
- 받는 백엔드 영역: platform (hr-service, 지금 계약 0.8.0)
- 근거: 사용자 2026-11-19 "인사 쪽 웹에는 대시보드가 필요 없어? 넣을 게 마땅치 않나?" → 넣고 싶은 것은 있지만 지금 계약으로는 숫자를 서버에서 받을 수 없어 먼저 요청하기로 함(사용자 "응").
- 화면 규칙: 클라이언트는 서버가 센 값만 숫자로 보인다. 목록을 받아 와서 세거나 날짜를 계산해 "N명"으로 확정하지 않는다(조회 실패를 0으로 보이지 않는다).

## 지금 할 수 없는 것

`GET /hr/employees` 는 `status`·`affiliationCode`·`q` 로만 거르고 몇 명인지 세어 주지 않는다. 그래서 인사 담당자가 첫 화면에서 볼 다음 것들을 서버 값으로 보일 수 없다.

| 보고 싶은 것 | 막히는 이유 |
|---|---|
| 계정 발급 실패 — 다시 시도가 필요한 직원 | `provisioning.step` 으로 거를 수 없음 |
| 권한 승인을 기다리는 직원(`requestedGrants[].submission = SUBMITTED`) | 거를 수 없음 |
| 계약 종료가 가까운 직원(파트타임·일일크루) | `endDate` 로 거를 수 없음 |
| 최근 등록한 직원 | `createdAt` 으로 거르거나 정렬할 수 없음 |
| 재직·정지·퇴사 인원 | 상태로 거를 수는 있지만 세어 주지 않음(첫 쪽 50개까지만 "50명 이상"으로만 보임) |

## 요청

### H-D1. 직원 목록 거르기 더하기 — `GET /hr/employees`

| 쿼리 | 뜻 |
|---|---|
| `provisioningStep` | 계정 발급 단계(여러 개 쉼표, 예 `FAILED,COMPENSATED`) |
| `grantSubmission` | 요청 권한 중 이 상태가 하나라도 있는 직원(예 `SUBMITTED`) |
| `endDateFrom`·`endDateTo` | 계약 종료일 범위(서울 날짜, 둘 다 포함). 종료일이 없는 직원(정규직)은 빠진다 |
| `createdFrom`·`createdTo` | 등록 시각 범위 |
| `sort` | `CREATED_DESC`(지금처럼 기본값이면 그대로 둬도 된다) · `END_DATE_ASC` |

- 판정은 지금처럼 서버가 하고, 권한도 지금과 같이 `HR_ADMIN` 만.

### H-D2. 인원 세기 — 예 `GET /hr/employees/counts`

- 한 번 불러 아래 숫자를 받는다(bff `views/work-counts` 처럼 `value`·`complete`).
  - 상태별: `ACTIVE`·`SUSPENDED`·`LEFT`
  - 계정 발급 실패: `FAILED`+`COMPENSATED`
  - 권한 승인 대기 직원 수(`SUBMITTED` 가 있는 직원)
  - 계약 종료 임박: 오늘부터 N일 안(N 은 쿼리 `endingWithinDays`, 기본 7)
- 숫자를 다 못 센 경우가 있다면 `complete=false` 로 알려 주면 "N명 이상"으로 보인다.
- 원천을 못 읽은 경우는 오류(503 등)로 — 클라이언트는 "확인 못 함"으로 보이고 0 으로 바꾸지 않는다.

## 열리면 클라이언트가 할 것

인사팀 백오피스에 대시보드(첫 화면)를 둔다 — 기본 백오피스 대시보드와 같은 모양.

- 숫자 카드: 재직·정지·퇴사(H-D2)
- 내 할 일: 계정 발급 실패 N(→ `?provisioningStep=FAILED,COMPENSATED` 목록), 권한 승인 대기 N, 계약 종료 7일 안 N(H-D1·H-D2) — 누르면 그 조건으로 거른 직원 목록
- 최근 등록한 직원 5명(H-D1 `createdFrom`·정렬)

## 질문

1. H-D2 를 따로 만들기보다 bff `views/work-counts` 에 HR 묶음(`group: EMPLOYEES`)을 더하는 편이 맞다면 그쪽도 괜찮다. 어느 쪽으로 할지 알려 달라(`HR_ADMIN` 이 work-counts 를 부를 수 있어야 한다 — 지금은 관리자만).
2. 계약 종료 "임박" 기준(7일)을 업무 규칙으로 정해 둔 값이 있으면 그 값을 쓰겠다. 없으면 클라이언트가 7일로 묻는다.
