# handoff — 백엔드로 보내는 요청·질문·회신

pmart-clients 와 pmart-backend 는 서로의 저장소에 쓰지 않는다. 각자 자기 `docs/handoff/` 에만 쓰고 상대 것은 읽기만 한다.
백엔드가 보낸 것은 `../pmart-backend/docs/handoff/clients/` 에서 읽는다.

## 폴더 — 앱 영역별 (2026-11-13 사용자 결정)

| 폴더 | 무엇 |
|---|---|
| `customer-app/` `mfc-app/` `rider-app/` `backoffice/` `hr-backoffice/` `mfc-backoffice/` `web-common/` | 그 앱 영역이 보내는 문서 — **자기 영역 폴더에만 쓴다** |
| `all/` | 여러 앱 영역에 걸친 문서 |
| `archive/` | 처리가 끝난 문서(양쪽 할 일이 끝났거나 뒤 문서가 대체). 2026-11-13 폴더를 나눌 때 그때까지의 문서 35개를 옮겼다(이름 그대로) |

- 폴더는 첫 문서를 쓸 때 만든다(빈 폴더는 git 에 없다).
- 파일 이름: **`YYYY-MM-DD-backend-<주제>.md`**(폴더가 앱 영역을 말한다). `archive/` 의 옛 파일은 옛 이름 그대로다.
- 첫머리에 `보낸 앱: <앱 영역>`, `받는 백엔드 영역: platform|mfc|delivery`, 회신이면 원 문서 경로를 적는다.
- 끝난 문서는 `archive/` 로 옮긴다(`git mv`, 이름 그대로). 이 저장소 문서가 그 경로를 가리키면 같은 커밋에서 고친다. 옮기는 것은 그 영역 담당 — 다른 영역 폴더의 문서는 옮기지 않는다.
- 항목 번호(BR-xx)는 양쪽이 그대로 쓴다. 상태표는 `docs/backend-requests.md`.
- 규칙 정본: `docs/operations/pc-split.md` §5.

## 지금 열려 있는 문서 (2026-11-16)

| 문서 | 기다리는 것 |
|---|---|
| `mfc-app/2026-11-10-backend-pda-work-areas.md` | BR-52·BR-53 회신(R1~R4 일부·R8~R11·R19-1 은 받음 — 나머지. 다음 차례 R12 → R20) |
| `mfc-app/2026-11-17-backend-pda-stock-check.md` | PDA 재고 확인 — 작업자 토큰으로 센터 재고·바코드 조회 되는지(Q1·Q2), 상품명(Q4) |
| `mfc-app/2026-11-17-backend-my-work-history.md` | 작업자 본인 오늘 업무 내역 — 기간 거르기·completedAt(R1·R2), 입고·검사·이동·실사 내 내역(R3) |
| `backoffice/2026-11-16-backend-pii-reveal-and-pending-done.md` | 주문 개인정보 열람·처리 대기 — LAN 조회 화면은 확인(2026-11-16 PC 2), 원문 열람은 실서버에서 아직 안 눌러 봄 |
| `all/2026-11-16-backend-login-code-pc1-only-done.md` | 클라이언트 표(경로 보탬) 확인 |
| `backoffice/2026-11-16-backend-case-order-exceptions-done.md` | 사건함 사가·결제 이상·배차 실패 화면 반영 확인(PR #13) — case 0.5.0 LAN 배포됨(백엔드 알림, 데이터 0건), 사건이 생기면 실서버 확인 |
| `hr-backoffice/2026-11-16-backend-keycloak-400-provisioning.md` | LAN 직원 계정 발급이 KEYCLOAK_400 으로 실패·되돌림(재현 3명) — PC 1 원인 확인 |
| `backoffice/2026-11-16-backend-rider-help-chat.md` | 라이더 도움요청 상담 대화 — 답 받음(백엔드 #60 대화 API·#62 DE-2 권한·새 메시지·가림·처리 중 시점), 반영·배포 뒤 화면. 전화 기능 보류 |
| `customer-app/2026-11-16-backend-review-photos-and-inbox-done.md` | 리뷰 0.2.0(사진)·고객 알림함 0.2.0 반영 확인 — 실서버 확인은 배송 완료·고객 주문 뒤 |
| `customer-app/2026-11-16-backend-review-edit-delete-done.md` | 리뷰 수정·삭제 화면 반영 확인, 빈 글 수정 질문 1개 — 실서버 확인은 배송 완료 뒤 |
| `customer-app/2026-11-15-backend-support-chat-inquiry.md` | 고객앱 문의·AI 상담 반영 알림 — LAN 고객 토큰으로 실제 확인, 질문 3개 |
