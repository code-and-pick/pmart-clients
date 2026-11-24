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
| `mfc-app/2026-11-10-backend-pda-work-areas.md` | BR-52·BR-53 회신(R1~R4 일부·R8~R11·R19-1·**R20 출하대기 랙(2026-11-19 회신, PDA 반영)** 은 받음 — 나머지. 다음 차례 R12) |
| `mfc-app/2026-11-17-backend-pda-stock-check.md` | 회신 `clients/mfc-app/2026-11-17-reply-stock-check-and-work-history(-impl).md` — Q1·Q2 권한 됨, Q4 `CenterStock.productName` PDA 반영(2026-11-17). 남은 것: Q3 칸으로 재고 찾기(백엔드 MB-1, 아직) |
| `mfc-app/2026-11-17-backend-my-work-history.md` | 회신 `clients/mfc-app/2026-11-17-reply-stock-check-and-work-history-impl.md`(capacity `workers/me/activities`·fulfillment `completedAt`) — PDA 반영(2026-11-17). **남은 것: LAN 확인 뒤 archive** |
| `mfc-app/2026-11-17-backend-pick-to-cart.md` | P1~P4 모두 수용 회신(`clients/mfc-app/2026-11-17-reply-pick-to-cart.md`, fulfillment 0.8.0·inventory 0.19.0). PDA 반영 #57(main `c6f4930`, 백엔드 반영 전에 먼저 합침 — 사용자 2026-11-17). 백엔드 #91(`d5386b2f`) main·배포됨, PC 1 이 클라이언트 재생성·contracts.lock(백엔드 `2d64e515`). **남은 것: PC 3 실서버 피킹(장바구니) → 포장(패킹대) → 출하대기 확인** |
| `mfc-app/2026-11-17-backend-pick-reject-reason.md` | 회신 `clients/mfc-app/2026-11-17-reply-qc-criteria-and-reject-reason.md` — E1·E3(실행 조회 `rejectCode`·`rejectReason`) PDA 반영(2026-11-17), E2 는 안 함(실행 한 번 더 조회로 대신). **남은 것: LAN 확인 뒤 archive** |
| `mfc-app/2026-11-17-backend-lot-label.md` | LOT 라벨(QR·자체 스티커) 형식·발급·재출력·해석(L1~L6) — 피킹에서 LOT 를 찍어 선입선출 확인 |
| `mfc-app/2026-11-17-backend-shipment-ready-at-npe.md` | 회신 `clients/mfc-app/2026-11-17-reply-shipment-ready-at-npe.md` — 서버 고침(READY 전 `readyAt: null` 200), PDA 고칠 것 없음. **남은 것: LAN 피킹 → 패킹 → 출하대기 확인 뒤 archive** |
| `mfc-app/2026-11-18-backend-pick-then-pack-same-worker.md` | 회신 `clients/mfc-app/2026-11-18-reply-pick-then-pack-same-worker.md`(fulfillment 0.18.0·capacity 0.19.0) — 다음 작업 받기가 자기가 피킹한 PACK 먼저·다른 사람에게 안 줌, PDA 변경 없음. **남은 것: LAN 에서 피킹 끝 → 다음 작업이 그 PACK 인지 확인 뒤 archive** |
| `mfc-app/2026-11-18-backend-break-supervisor-pin.md` | 휴게 관리자 번호(B1·B2)·근무 휴게 구간 자동 휴게(B3) — **모두 수용 회신**(`clients/mfc-app/2026-11-18-reply-break-supervisor-pin.md`, mfc-capacity 0.20.0). PDA(#136)·mfc-backoffice(#141) 반영, 게이트웨이 `break-pin` 라우트 있음(백엔드 PR #196). 남은 것: LAN 에서 센터 번호 정하고 PDA 실기기 확인 |
| `mfc-app/2026-11-18-rider-app-return-handover-screen.md` | (rider-app PC 5 → mfc-app) PDA 반납 인증번호 화면 — 요청 1·2 PDA 반영(`mfc-app/return-handover-code`). 남은 것: 라이더 앱 실기기 확인, PC 1 `return-handover.required` 켜기. 요청 3 mfc-backoffice 목록은 `mfc-backoffice/return-handovers`(2026-11-19) |
| `mfc-backoffice/2026-11-17-backend-lists-and-roles.md` | 회신 `clients/mfc-backoffice/2026-11-18-reply-lists-and-roles.md` — MB-1 목록 9개·MB-3 확인 필요 포장 관리자 **화면 반영**(`mfc-backoffice/mb1-lists`, 2026-11-19). MB-2 는 사용자 답(1~4)과 API 요청을 `mfc-backoffice/2026-11-19-backend-quality-incidents.md` 로 보냄. 남은 것: LAN 확인(`stock-units` 게이트웨이 라우트) |
| `mfc-backoffice/2026-11-19-backend-quality-incidents.md` | 회신 `clients/mfc-backoffice/2026-11-19-reply-quality-incidents.md`(quality 0.6.0·inventory 0.27.0, R6 은 2차) — 화면 반영 `mfc-backoffice/quality-incidents`(2026-11-19). 품질 사고(MB-2) — 사용자 결정(자동+직접 등록, 결품은 파손·변질만, LOT 처리 뒤 관리자가 닫음, 고객 영향이면 case 자동) + R1 조회 구현·R2 직접 등록·R3 자동·R4 상태·R5 닫기·R6 case. 질문 5 상품 취급은 지금대로 + R7 단종은 본사가 전 센터 OFF·R8 신상품은 센터 화면 배너 안내 |
| `mfc-backoffice/2026-11-19-backend-ops-exceptions.md` | 센터 운영판(§4-0) — OE-1 센터 결품 보고 목록(+전체 건수), OE-2 출하 약속 초과·임박 건수·임박 기준. 회신 전에는 결품(SHORT) 행 없이 안내, 약속 건수는 작업 목록 1,000건까지 읽어 셈 |
| `mfc-backoffice/2026-11-19-backend-dispatch-cancel-lines.md` | "배차 불가로 취소"(claim CL-5) — 센터 관리자가 주문 행·미이행 수량을 못 읽음. DC-1 서버가 lines 채우기(추천)·DC-2 order 직원 조회를 MFC_SUPERVISOR 에게. 회신 전에는 단추 막음 |
| `all/2026-11-19-reply-ui-ux-align-mfc-backoffice.md` | (mfc-backoffice → PC 2) UI·UX 맞추기 지침 회신 — 반영 목록, web-ui 공용 동의·필요 순서. PC 2 가 공용 부품을 올리면 바꿔 끼우고 archive |
| `mfc-backoffice/2026-11-18-backend-my-account.md` | 직원 "내 정보" — 회신 `clients/mfc-backoffice/2026-11-18-reply-my-account.md`: 사용자 정정으로 비밀번호 = 센터 휴게 번호(capacity 0.20.0), 연락처 = 연락 수단 표시용(capacity 0.21.0 `staff-contacts`), EA-3·HR-3 철회. 화면 반영 `mfc-backoffice/my-info-contacts`(2026-11-19). **남은 것: LAN 확인 뒤 archive** |
| `mfc-backoffice/2026-11-24-backend-ship-promise-metrics.md` | 출하 약속 준수율 추이(날짜·시간 칸) — mfc-fulfillment `GET /metrics/ship-promises` 제안(picking-lines 와 같은 모양). 화면은 목 시뮬레이션(`shipSim.ts`), 실서버는 "API 없음"(#498) — 회신 대기 |
| `all/2026-11-16-backend-login-code-pc1-only-done.md` | 클라이언트 표(경로 보탬) 확인 |
| `customer-app/2026-11-19-backend-first-run-consents.md` | BR-59 처음 실행 약관 — ①~④ 모두 회신(`clients/customer-app/2026-11-19-reply-br59-first-run-consents.md`, customer 0.6.0~0.6.1) · 고객앱 반영(목 모드). 질문 답은 아래 문서로 보냄. **남은 것: LAN 실서버 확인 뒤 archive** |
| `customer-app/2026-11-19-backend-br59-location-service-answer.md` | BR-59 질문 답(좌표→주소 카카오 로컬 서버 경유, 지도 카카오맵 SDK, 휴대폰 위치 Android geolocator — 사용자 승인·고객앱 반영) + Q1 역지오코딩 좌표가 URL 쿼리로 추적 기록에 남는 문제 |
| `customer-app/2026-11-20-backend-review-eligibility-display.md` | BR-67 리뷰관리 개수(total)·품목 사진·주문 시각/센터 이름 — 보냄, 회신 대기 |
| `customer-app/2026-11-20-backend-order-list-lines.md` | BR-68 주문내역 카드 상품 줄·센터 이름(·판매 여부·기간 끝) — 회신 받음(order 0.17.0), 앱 반영(2026-11-20) |
| `customer-app/2026-11-20-backend-naver-token-exchange.md` | BR-69 네이버 로그인 토큰 교환 — 네이버가 client secret 없는 교환을 거절(`invalid_client`), 서버가 인가 코드를 교환해 달라(R1~R5) — 회신 받음(auth 0.10.0, LAN 배포), 고객 앱 목 모드 반영, 실기기 확인 대기 |
| `customer-app/2026-11-20-backend-naver-profile-image-after-exchange.md` | BR-70 네이버 프로필 사진 — 서버 교환(0.10.0) 뒤 앱에 access token 이 없어 0.8.0 요청을 할 수 없음, (가) 서버가 읽기·(나) 교환 응답에 주소·(다) 토큰 주기 가운데 정해 달라 — 회신 받음((나) — auth 0.10.1), 앱 반영(2026-11-20) |
| `customer-app/2026-11-20-backend-br67-68-70-withdrawal-applied.md` | BR-67(리뷰관리 값)·BR-68(주문내역 상품 줄)·BR-70(네이버 프로필 사진) 회신과 회원 탈퇴 요청(customer 0.12.0) 목 모드 반영 알림 + Q1(탈퇴 대기 중 주문 거절 문구) — LAN 확인 대기 |
| `customer-app/2026-11-20-backend-order-line-images.md` | BR-71 주문 줄의 상품 사진 — `GET /orders` `lines[]`·`GET /orders/{id}` `OrderLine` 에 `imageUrl`(R1·R2) — 보냄, 회신 대기 |
| `customer-app/2026-11-20-backend-signup-consent-restart.md` | BR-72 가입을 끝내지 않고 나갔으면 다음 로그인 때 동의부터 다시(R1~R4) — 보냄, 회신 대기 |
| `customer-app/2026-11-21-backend-coupons-applied-and-open-questions.md` | 쿠폰·할인가(ADR-0082 1~7번)·AI 상담 상품 답(rag 0.3.0) 목 모드 반영 알림 + 회신 부탁 R1(BR-71 재촉)·Q1~Q3(찜·BR-64 details 읽는 법, 탈퇴 대기 거절 문구)·스위치 상태 — 보냄, 회신 대기 |
| `customer-app/2026-11-21-backend-faq-login-policy.md` | BR-78 고객 FAQ·AI 상담 안내 문서에 카카오·네이버 로그인·가입 휴대폰 확인·앱 탈퇴 반영 + 재색인(앱 변경 없음) |
| `customer-app/2026-11-21-backend-naver-email.md` | BR-77 네이버 로그인 계정에도 이메일 — 회신 받음(서버만, 앱 변경 없음). **남은 것: 네이버 콘솔 이메일 주소 켜고 실기기 확인 뒤 archive** |
| `customer-app/2026-11-21-backend-splash-popup-display-reply.md` | 회신 — 로딩 화면 이미지 갱신(배너+이미지 주소 비교, contain+가장자리 색)·팝업 80%·4:5·contain·기억 키 배너+이미지(서버 변경 없음, 선택: Banner.endsAt). **남은 것: 실기기 확인 뒤 archive** |
| `customer-app/2026-11-21-backend-social-login-chooser-and-revoke-reply.md` | 회신 — 백엔드 요청 2건(탈퇴 때 구글 revoke·로그인 버튼마다 계정 고르기) 고객앱 반영: 구글 disconnect+signOut(탈퇴 성공 뒤만)·로그아웃 signOut, 카카오 `prompt=login`·SDK logout, 네이버 `reauthenticate`(기존). **남은 것: 실기기 확인 뒤 archive** |
| `customer-app/2026-11-21-backend-review-sort-option-helpful.md` | BR-76 상품 리뷰 추천순·옵션 필터·도움돼요(회원만) — 회신 받음(review 0.6.0, LAN 배포)·앱 실서버 연결(2026-11-21). **남은 것: 실기기 확인 뒤 archive** |
| `customer-app/2026-11-20-backend-wishlist-applied.md` | 찜(하트 — customer 0.13.0) 목 모드 반영 알림 + Q1(422 details 읽는 법) — LAN 확인 대기 |
| `customer-app/2026-11-20-backend-naver-consent-every-login.md` | BR-74 네이버 로그인마다 동의 화면 다시 — 교환 뒤 네이버 연결 끊기(R1~R5, sub 유지 확인) — 보냄, 회신 대기 |
| `customer-app/2026-11-20-backend-availability-display-applied.md` | "다 팔렸어요" 오표시(요청 availability-display §1) 목 모드 반영 알림 — 주소 없음·재고 조회 실패·배달 안 함을 품절과 구분, §2 목록 품절 표시는 계약 대기 |
| `customer-app/2026-11-20-backend-handoff-replies-applied.md` | 11-20 백엔드 요청·회신 4건(검색 교정 문구·리뷰 사진 축소본·홈 배너·BR-64 로그인 휴대폰 확인) 목 모드 반영 알림 + Q1(details 읽는 법) — LAN 확인 대기 |
| `customer-app/2026-11-19-backend-address-receiver-to-checkout.md` | BR-60 — 회신(`clients/customer-app/2026-11-19-reply-br60-address-receiver.md`, customer 0.8.0·order 0.14.0 배포) · 고객앱 반영(목 모드). **남은 것: LAN 에서 주소 저장·주문서 내 연락처 확인 뒤 archive** |
| `customer-app/2026-11-19-backend-phone-verification-signup.md` | BR-64 나머지 — 0.9.0 휴대폰 확인 화면 반영 알림 + 가입 단계 확인(R1)·한 번호 한 계정(R2)·기존 계정 안내(R3)·탈퇴 1달(R4)·기존 회원(R5)·주문 연락처(R6)·처리방침(R7) |
| `customer-app/2026-11-19-backend-naver-oauth-callback-relay.md` | BR-66 네이버 로그인 콜백 중계 — LAN 게이트웨이 공개 경로 → 앱 주소 302(고정 목적지·기록 없음), 콘솔에 넣을 주소·인증서 |
| `customer-app/2026-11-19-backend-social-login-identity.md` | BR-64 가입 즉시 휴대폰 본인 인증(옥토모)·한 번호 한 계정·기존 계정 안내·탈퇴 1달, BR-65 카카오·네이버 로그인 |
| `customer-app/2026-11-19-backend-rating-null-in-cards.md` | BR-63 홈 진열·상세 응답 평점 null(집계는 480) — 사본 채우기 |
| `customer-app/2026-11-19-backend-delivery-status-screen.md` | **급함** 배송 현황 — R1(BR-61) 주문 `shipments[].deliveryId`(없어서 라이더가 지도에 안 뜸), R2(BR-62) 주문한 센터 이름 |
| `customer-app/2026-11-19-backend-order-shipments-empty.md` | **급함** BR-61 고객 주문 조회 `shipments` 가 늘 빈 배열 → 배송 현황·라이더 지도를 열 수 없음(R1 채우기, R2 시점) |
| `customer-app/2026-11-19-backend-live-rider-location-done.md` | (delivery PC 5 요청 회신) 배송 현황 라이더 위치를 SSE 로 — 고객앱 반영(목 모드). **남은 것: 실제 배송으로 PC 5 와 지연 재기 뒤 archive** |
| `customer-app/2026-11-16-backend-review-photos-and-inbox-done.md` | 리뷰 0.2.0(사진)·고객 알림함 0.2.0 반영 확인 — 실서버 확인은 배송 완료·고객 주문 뒤 |
| `customer-app/2026-11-16-backend-review-edit-delete-done.md` | 리뷰 수정·삭제 화면 반영 확인, 빈 글 수정 질문 1개 — 실서버 확인은 배송 완료 뒤 |
| `rider-backoffice/2026-11-17-backend-rider-backoffice-base-done.md` | 라이더 백오피스 뼈대·로그인 회신 — 들어간 커밋 `756db67` 을 그대로 받음(사용자 2026-11-17), 검토·시험 11개·LAN 빌드 이름 확인. **남은 것: 실서버(8446) 로그인을 브라우저로 눌러 보기** |
| `rider-backoffice/2026-11-18-backend-rider-ops-gaps.md` | 라이더 백오피스 직원용 API 공백 7건(PC 5) — 7번 `Evidence.method` 값 목록 먼저, 2~6번 1차 포함 여부·서비스·버전 회신 |
| `customer-app/2026-11-18-backend-gap-a-applied.md` | 고객앱 갭 A 8가지 + CU-1 주문 전 재동의·마케팅 앱 반영(목 모드). R1(알림함 `templateKey`) 답 받아 반영(2026-11-18). **남은 것: 실서버 확인(할 일 43) 뒤 CU-1 스위치 켜기 알림** |
| `customer-app/2026-11-18-backend-customer-push-fcm-reply.md` | 고객앱 휴대폰 푸시 회신 — 앱 반영 끝(토큰 등록 `7cbe1f2`, 누르면 목적지 화면). Q6·Q8 은 11-18 답 받음(앱 고칠 것 없음). **남은 것: 실기기 확인, `pmart-123` json 교체 — 결과 덧붙이면 archive** |
| `customer-app/2026-11-15-backend-support-chat-inquiry.md` | 고객앱 문의·AI 상담 반영 알림 — LAN 고객 토큰으로 실제 확인, 질문 3개 |
| `customer-app/2026-11-21-backend-profile-photo-edit.md` | BR-80 내 정보 프로필 사진 올리기·기본·되돌리기 API 요청 |
| `customer-app/2026-11-22-backend-search-filter-data.md` | BR-81 검색·카테고리 필터 데이터(LAN 비어 있음)·필터 정본 질문 |
| `customer-app/2026-11-22-backend-category-banner-discount-list.md` | BR-82 카테고리 배너 자리 CATEGORY·할인 상품 목록 |
| `customer-app/2026-11-22-backend-sale-list-filters-sort.md` | BR-83 할인 상품 목록 필터(`/search/filters` onSale)·할인율순 정렬 |
| `rider-app/2026-11-23-backend-delivery-area-change.md` | 라이더 마이페이지 배달 지역 바꾸기(운행 쉴 때만·한 곳·바로 반영 — 앱 반영 #391). 서버 1) 운행 중 변경 409 INVALID_STATE 로 막기 2) 쉬는 동안 남은 operatingMfcId 정리 3) 없는·운영 안 하는 지점 거절 여부 — 회신 대기 |
| `rider-app/2026-11-23-backend-rider-list-active-deliveries.md` | 라이더 백오피스 라이더 목록 "진행 중 배송 수"(StaffRiderSummary.activeDeliveryCount — 여러 라이더를 한 번에) — 보냄, 회신 대기 |
| `rider-app/2026-11-23-backend-help-auto-close-on-delivery-end.md` | 배송이 끝나면(완료·반납·취소·실패 확정) 열린 도움요청을 서버가 자동 완료(resolvedBy system:…), 끝난 배송 조회 404 없는지(앱 반영 #431 끝난 배송 보기) — 백엔드 PR #385 로 회신 |
| `rider-app/2026-11-24-backend-help-auto-close-5h-after-delivery.md` | 도움요청 자동 완료를 배송이 끝난 즉시가 아니라 끝난 시각 + 5시간 뒤로(완료·실패·취소·반납 모두, 배정이 풀린 라이더는 지금처럼 바로). 받는 영역 delivery — 보냄, 회신 대기 |
| `rider-backoffice/2026-11-24-backend-earning-adjustment-ref.md` | 조정한 수행료(지급·미지급 모두)에 `Earning.adjustmentRef`(조정 기록 ID) 채우기 — 지금은 계약에만 있고 서버가 비워 지급 조정이 보통 수행료와 구분 안 됨, 이미 조정된 건 채우기 여부도. 받는 영역 delivery — 보냄, 회신 대기 |
| `customer-app/2026-11-23-backend-timer-theme-style.md` | BR-84 타이머 테마 머리 모양(timerStyle LABEL·BAND)·백오피스에서 고르기 |
| `customer-app/2026-11-23-backend-coupon-used-at.md` | BR-85 내 쿠폰 쓴 시각(Coupon.usedAt) |
| `customer-app/2026-11-23-backend-review-order-writable-count.md` | BR-86 리뷰 쓰기 목록 주문별 쓸 수 있는 품목 수(orderWritableCount) |
| `customer-app/2026-11-23-backend-search-zero-similar-and-typo-only.md` | BR-87 검색 0건 비슷한 상품(similarItems)·BR-88 오타일 때만 교정·제안 |
| `customer-app/2026-11-23-backend-category-image.md` | BR-89 카테고리 이미지(CategoryNode.imageUrl) |
| `customer-app/2026-11-23-backend-review-report.md` | BR-90 리뷰 신고하기(고객) + 운영자 확인 처리 |
| `customer-app/2026-11-23-backend-faq-feedback.md` | BR-91 FAQ 답 의견(도움이 되었어요/수정이 필요해요) |
| `customer-app/2026-11-23-backend-lan-seed-popup-banner-coupon.md` | LAN 시험 데이터 — 홈 팝업 2·배너 몇 개·쿠폰 몇 개(계약 변경 아님) |
| `backoffice/2026-11-24-backend-employee-label-status.md` | HR-5 이어서 — 직원 이름표에 재직 상태(status) — 사번으로 고를 때 정지(SUSPENDED) 직원은 보이되 경고(사용자 결정) — PC 1 백엔드로, 회신 대기 |
| `backoffice/2026-11-24-backend-live-stock-stream.md` | 재고 증감 실시간(PC 1 사용자 결정 — 서버가 밀어 주기 SSE) — 통합 화면 설계(대시보드 센터별 품절 칸만, SKU 재고 목록은 통합에 없음)·스트림 계약에 바라는 것(이벤트 본문·다시 연결·bff 중계) — mfc·PC 2 백엔드, 계약 대기 |
| `backoffice/2026-11-24-backend-inquiry-center-filter.md` | 문의 목록 센터 거르기 `centerId` — 고객 문의는 주문 센터(주문 없는 문의는 늘 함께·센터 없음 표시, 사용자 결정 b), 라이더 문의는 운행 센터 — PC 2 백엔드(case), 회신 대기 |
