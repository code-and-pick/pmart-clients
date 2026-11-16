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
| `backoffice/2026-11-15-backend-assistant-connected.md` | 새 백오피스 빌드 올리기, 업무 도우미·문의 답변의 HTTPS 게이트웨이 경로·CORS, 답변 POST 의 같은 키 재전송 |
| `backoffice/2026-11-15-backend-cs-rider-menus-done.md` | 고객센터·라이더 운영 메뉴 반영 회신 — BR-54~56, 역할·version 질문, PC 5 권한 반영 |
| `backoffice/2026-11-16-backend-pii-reveal-and-pending-done.md` | 주문 개인정보 열람·처리 대기 반영 확인(빌드는 archive 의 session-roles-centers 표) |
| `hr-backoffice/2026-11-16-backend-departments-and-permissions-done.md` | 본사 부서·권한 관리 반영 확인(빌드는 archive 의 session-roles-centers 표) |
| `all/2026-11-16-backend-login-code-pc1-only-done.md` | 클라이언트 표(경로 보탬) 확인 |
| `backoffice/2026-11-16-backend-product-menu-operator-admin-done.md` | 상품 관리 묶음 `OPERATOR_ADMIN` 반영 확인(빌드는 archive 의 session-roles-centers 표) |
| `hr-backoffice/2026-11-16-backend-role-list-done.md` | 역할 목록 API 반영 확인(BR-57 끝, 빌드는 archive 의 session-roles-centers 표) |
| `backoffice/2026-11-16-backend-case-order-exceptions-done.md` | 사건함 사가·결제 이상·배차 실패 화면 반영 확인(PR #13) — 실서버는 case 0.5.0 LAN 배포 뒤 |
| `web-common/2026-11-16-backend-lan-cors-dev-origins.md` | LAN 게이트웨이 CORS 에 개발 서버 출처 `http://localhost:5173·5174·5175` 추가(allowed·credentialed), refresh 쿠키가 실리는지 — PC 2 가 `dev:lan` 으로 실서버 확인용 |
| `customer-app/2026-11-16-backend-review-photos-and-inbox-done.md` | 리뷰 0.2.0(사진)·고객 알림함 0.2.0 반영 확인 — 실서버 확인은 배송 완료·고객 주문 뒤 |
| `customer-app/2026-11-15-backend-support-chat-inquiry.md` | 고객앱 문의·AI 상담 반영 알림 — LAN 고객 토큰으로 실제 확인, 질문 3개 |
