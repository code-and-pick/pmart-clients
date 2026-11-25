# 요청 — 직원이 보는 고객 탈퇴 목록(탈퇴 사유)

보낸 앱: backoffice (PC 2 — 통합 백오피스 고객센터)
받는 백엔드 영역: platform (customer-service — 탈퇴 정본, 필요하면 backoffice-bff 묶음)
작성: 2026-11-25

## 왜
- 사용자(PC 2, 2026-11-25): "탈퇴할 때 고객앱이랑 배달앱에서 사유를 적는데 그게 백오피스 어디에서 확인이 가능한지" → "요청서 써".
- 라이더는 이미 된다: rider 0.19.0 `GET /riders/withdrawals`(직원용 — 결과·막은 이유·**라이더가 적은 사유**·신청·완료 시각, 개인정보 없음) → 라이더 백오피스 "라이더 › 탈퇴".
- 고객은 안 된다: 고객 앱이 `POST /me/withdrawals` 에 `reasonCode`(40자)·`reasonText`(500자)를 보내고 서버가 받지만, 읽는 길은 고객 본인용 `GET /me/withdrawals` 뿐 — **직원이 읽는 API 가 없어** 통합 백오피스 고객 화면은 상태(탈퇴 진행 중·탈퇴함)만 보이고 사유는 못 보인다.

## 요청

### CW-1 직원용 고객 탈퇴 목록
- 예: customer-service `GET /customers/withdrawals?state=&from=&to=&reasonCode=&cursor=&size=` — 최근 신청 순.
- 줄 모양(라이더 `StaffRiderWithdrawal` 와 같은 결):
  `{ withdrawalId, customerId, customerNumber(화면 표기 6자리 — ADR-0070), state(PENDING·COMPLETED·REVOKED 등 원천 값), reasonCode, reasonText, requestedAt, completedAt?, revokedAt?, blockers?(완료를 막고 있는 미결 의무 종류 — 원천 값이 있으면) }`
- **이름·연락처·주소는 싣지 않는다**(완료되면 지워지는 값 — 목록은 고객번호만).
- 권한: 고객센터를 보는 직원(OPERATOR_ADMIN·CS_AGENT — 지금 고객 찾기와 같게). 관리자만으로 좁히려면 알려 주세요.
- 사유 코드별 건수(선택): `GET /customers/withdrawals/counts?from=&to=` → `{ counts: [{ reasonCode, count }] }` — 화면 위 숫자 띠용. 없어도 된다(목록만으로 시작).

### CW-2 고객 상세에서 그 고객의 탈퇴 요청
- 통합 백오피스 고객 상세(bff `GET /views/customer/{customerId}`)에 최근 탈퇴 요청 한 건(`withdrawal: { state, reasonCode, reasonText, requestedAt, completedAt }` 또는 null)이 있으면 상세에서도 사유를 보인다. bff 가 묶기 어렵다면 CW-1 에 `customerId` 거르기만 있어도 된다.

## 정해 주세요(사유 글 보관)
- 탈퇴가 끝나면 이름·연락처·주소록을 지운다(customer 0.12.0). **사유 글(`reasonText`)은 고객이 직접 쓴 글이라 개인정보가 섞일 수 있다.**
- 클라이언트 제안: 라이더와 같게 완료 뒤에도 사유 코드·사유 글을 남기되, 사유 글은 서버가 전화번호·메일 꼴을 가리고(만족도 의견처럼), 보관 기간은 정책(예: 탈퇴 완료 뒤 1년)으로. 이 기간·가리기 여부는 사용자·개인정보 정책 결정이라 백엔드에서 사용자에게 확인해 주세요.
- 사유 코드 목록(`reasonCode` 값과 이름)을 계약 enum 이나 설명에 적어 주면 화면이 한국어 이름으로 보인다(없으면 코드 그대로).

## 화면(받은 뒤)
- 통합 백오피스 고객센터 메뉴에 "탈퇴" 목록: 결과·사유(코드 이름 + 사유 글)·신청·완료 시각·고객번호(누르면 고객 상세). 거르기는 결과·기간·사유 코드. 라이더 백오피스 "탈퇴"와 같은 모양.
- 고객 상세에 탈퇴 요청이 있으면 상태 옆에 사유 한 줄.
- 계약 전에는 화면·목을 만들지 않는다.
