# handoff — 백엔드로 보내는 요청·질문·회신

pmart-clients 와 pmart-backend 는 서로의 저장소에 쓰지 않는다. 각자 자기 `docs/handoff/` 에만 쓰고 상대 것은 읽기만 한다.
백엔드가 보낸 것은 `../pmart-backend/docs/handoff/clients/` 에서 읽는다.

## 폴더 — 앱 영역별 (2026-11-13 사용자 결정)

| 폴더 | 무엇 |
|---|---|
| `customer-app/` `mfc-app/` `rider-app/` `backoffice/` `hr-backoffice/` `mfc-backoffice/` `rider-backoffice/` `web-common/` | 그 앱 영역이 보내는 문서 — **자기 영역 폴더에만 쓴다** |
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
| `web-common/2026-11-18-backend-csrf-cookie-pileup.md` | 백오피스 CSRF 쿠키(`__Secure-pmart_ea_csrf_{sessionId}`, Path=/·만료 없음)가 같은 호스트에 쌓여 431 — C1 Max-Age 반영 회신(employee-auth 0.12.1, 앱 변경 없음). **남은 것: LAN 배포 뒤 백오피스 사이트 데이터 한 번 지우기 안내, 확인되면 archive** |
| `mfc-app/2026-11-10-backend-pda-work-areas.md` | BR-52·BR-53 회신(R1~R4 일부·R8~R11·R19-1 은 받음 — 나머지. 다음 차례 R12 → R20) |
| `mfc-app/2026-11-17-backend-pda-stock-check.md` | PDA 재고 확인 — 작업자 토큰으로 센터 재고·바코드 조회 되는지(Q1·Q2), 상품명(Q4) |
| `mfc-app/2026-11-17-backend-my-work-history.md` | 작업자 본인 오늘 업무 내역 — 기간 거르기·completedAt(R1·R2), 입고·검사·이동·실사 내 내역(R3) |
| `mfc-app/2026-11-17-backend-pick-to-cart.md` | P1~P4 모두 수용 회신(`clients/mfc-app/2026-11-17-reply-pick-to-cart.md`, fulfillment 0.8.0·inventory 0.19.0). PDA 반영 #57(main `c6f4930`, 백엔드 반영 전에 먼저 합침 — 사용자 2026-11-17). 백엔드 #91(`d5386b2f`) main·배포됨, PC 1 이 클라이언트 재생성·contracts.lock(백엔드 `2d64e515`). **남은 것: PC 3 실서버 피킹(장바구니) → 포장(패킹대) → 출하대기 확인** |
| `mfc-app/2026-11-17-backend-pick-reject-reason.md` | 실적 거절 사유(`rejectCode`·`rejectReason`)를 실행 조회·응답에(E1~E3) — 지금은 PDA 가 거절 이유를 못 보인다 |
| `mfc-app/2026-11-17-backend-lot-label.md` | LOT 라벨(QR·자체 스티커) 형식·발급·재출력·해석(L1~L6) — 피킹에서 LOT 를 찍어 선입선출 확인 |
| `mfc-app/2026-11-17-backend-shipment-ready-at-npe.md` | **버그(급함)** 출고 조회 `GET /shipments/{id}` 가 READY 전(`ready_at` NULL)이면 500 — `TaskStore.shipmentReadyAt` NPE, 패킹 화면이 안 열림(S1·S2) |
| `mfc-app/2026-11-18-backend-pick-then-pack-same-worker.md` | **급함** 피킹을 끝낸 사람에게 그 주문 PACK 을 먼저(R1~R3) — 지금은 다음 작업이 다른 주문 PICK 이라 한 주문 피패킹을 이어 갈 수 없다 |
| `mfc-app/2026-11-18-backend-break-supervisor-pin.md` | 휴게 관리자 번호(B1·B2)·근무 휴게 구간 자동 휴게(B3) — **모두 수용 회신**(`clients/mfc-app/2026-11-18-reply-break-supervisor-pin.md`, mfc-capacity 0.20.0). PDA 반영(#136). 남은 것: mfc-backoffice 번호 설정·근무 휴게 구간 화면, 게이트웨이 `break-pin` 라우트(PC 1) |
| `mfc-backoffice/2026-11-17-backend-lists-and-roles.md` | MFC 센터 관리자 웹 — 목록 API 전부(MB-1, 품질 대기 → 실사 → 입고 → 센터 재고·지난 추천 순), 품질 사고 구현(MB-2), 권한 결정(MB-3: 확인 필요 포장 관리자 허용, 정정·칸 변경 관리자만, 상품 취급 관리자+MD) |
| `all/2026-11-16-backend-login-code-pc1-only-done.md` | 클라이언트 표(경로 보탬) 확인 |
| `customer-app/2026-11-16-backend-review-photos-and-inbox-done.md` | 리뷰 0.2.0(사진)·고객 알림함 0.2.0 반영 확인 — 실서버 확인은 배송 완료·고객 주문 뒤 |
| `customer-app/2026-11-16-backend-review-edit-delete-done.md` | 리뷰 수정·삭제 화면 반영 확인, 빈 글 수정 질문 1개 — 실서버 확인은 배송 완료 뒤 |
| `rider-backoffice/2026-11-17-backend-rider-backoffice-base-done.md` | 라이더 백오피스 뼈대·로그인 회신 — 들어간 커밋 `756db67` 을 그대로 받음(사용자 2026-11-17), 검토·시험 11개·LAN 빌드 이름 확인. **남은 것: 실서버(8446) 로그인을 브라우저로 눌러 보기** |
| `rider-backoffice/2026-11-18-backend-rider-ops-gaps.md` | 라이더 백오피스 직원용 API 공백 7건(PC 5) — 7번 `Evidence.method` 값 목록 먼저, 2~6번 1차 포함 여부·서비스·버전 회신 |
| `customer-app/2026-11-18-backend-gap-a-applied.md` | 고객앱 갭 A 8가지 + CU-1 주문 전 재동의·마케팅 앱 반영(목 모드). R1(알림함 `templateKey`) 답 받아 반영(2026-11-18). **남은 것: 실서버 확인(할 일 43) 뒤 CU-1 스위치 켜기 알림** |
| `customer-app/2026-11-18-backend-customer-push-fcm-reply.md` | 고객앱 휴대폰 푸시 회신 — 앱 반영 끝(토큰 등록 `7cbe1f2`, 누르면 목적지 화면). Q6·Q8 은 11-18 답 받음(앱 고칠 것 없음). **남은 것: 실기기 확인, `pmart-123` json 교체 — 결과 덧붙이면 archive** |
| `customer-app/2026-11-15-backend-support-chat-inquiry.md` | 고객앱 문의·AI 상담 반영 알림 — LAN 고객 토큰으로 실제 확인, 질문 3개 |
