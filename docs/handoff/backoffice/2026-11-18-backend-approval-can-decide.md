# 승인 상세·목록에 "이 사람이 지금 심사할 수 있는지" 값 요청

보낸 앱: backoffice
받는 백엔드 영역: platform (approval-service)
날짜: 2026-11-18

## 왜
백오피스 화면을 직관적으로 고치면서(사용자 2026-11-18) 승인 상세 맨 위에 "다음 할 일" 카드를 넣었다. 심사 대기(`REVIEW_PENDING`·`EVIDENCE_REQUIRED`)면 "심사해 주세요"를 보인다.

목 계정으로 승인자(PRODUCT_APPROVER·DISPLAY_APPROVER·PRICE_APPROVER) 작업을 끝까지 해 보니:
- 승인함 목록에 **직원 권한(GRANT) 요청도 함께 보이고**, 열면 "심사해 주세요"와 승인·반려 버튼이 나온다.
- 그런데 GRANT 수동 심사 역할은 `approver-roles.GRANT = OPERATOR_ADMIN`(`docs/architecture/service-requests/approval-service.md` 39줄)이라 눌러도 서버가 403 으로 막는다.
- 화면은 `approver-roles` 설정을 모르므로(설정이 바뀔 수 있고, 화면이 판정을 만들면 안 된다) 이 사람에게 심사 권한이 있는지 미리 알 수 없다. 지금은 눌러 본 뒤에야 안다.

`Approval.allowedActions` 는 요청에 정해진 결정 종류라서 "지금 보는 사람"의 권한이 아니다.

## 요청
- **R1.** `GET /approvals/{approvalId}` 응답에 지금 토큰의 사람이 이 건을 지금 결정할 수 있는지를 서버가 판정한 값을 실어 주세요. 예: `viewerCanDecide: boolean` 과 못 하면 이유 `viewerDecideBlockedReason: NO_ROLE | SELF_APPROVAL | GRANT_TO_SELF | NOT_PENDING | OUT_OF_CENTER_SCOPE …`(이름·값은 백엔드가 정함). auth 거절 사유(`docs/apps/backoffice-web.md` §2 끝 줄)와 맞추면 화면 문구를 그대로 쓸 수 있다.
- **R2.** (선택) `GET /approvals` 목록에도 같은 값, 또는 `decidableByMe=true` 거르기. 승인자의 첫 화면 "내 할 일 — 심사 대기 승인 N건"이 지금은 자기가 심사할 수 없는 건까지 센다.

## 받으면 화면은
- R1: `viewerCanDecide=false` 면 다음 할 일 카드를 "○○ 역할이 심사해요"(정보)로, 승인·반려 버튼은 끈다(지금 자기 요청·자기 권한 요청에서 하는 것과 같게).
- R2: 내 할 일·메뉴 알림의 심사 대기 수를 그 값으로 센다.

받기 전까지 화면은 지금처럼 버튼을 두고, 서버 403 을 거절 문구로 보인다(판정을 지어내지 않는다).
