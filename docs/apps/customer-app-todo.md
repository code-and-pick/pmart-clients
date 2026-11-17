# 고객앱 해야 할 일 (PC 1)

- 만든 날: 2026-11-17 (사용자 "해야 할 일 md 파일을 작성해줘")
- 고친 날: 2026-11-17
- 끝난 항목은 지우지 말고 `~~취소선~~` + 커밋을 적는다. 새 항목은 맨 아래 절에 더한다.
- 계약·회신 경로: 백엔드 회신은 `../pmart-backend/docs/handoff/clients/<customer-app|all>/`, 우리 요청은 `docs/handoff/customer-app/`.

## 1. 백엔드 준비됨 — 고객앱이 만들 것

| # | 할 일 | 근거(계약·백엔드 문서) | 메모 |
|---|---|---|---|
| 1 | **고객센터 문의에 사진 붙이기** — 한 장씩 `POST /inquiry-photos`(multipart) → 문의 `photoIds`(5장, 장당 10MB), 남긴 뒤 보완 `POST /inquiries/{id}/photos`, 상세 사진 보기 | case 0.14.0, `clients/all/2026-11-17-request-inquiry-photos.md` | 사용자 2026-11-17 "해야 할 일에 기억". 사진 실패해도 문의는 남게(첨부 성공 ≠ 접수 성공). 리뷰 사진 코드(`features/reviews`) 방식 그대로. 백오피스 보기는 #59 로 끝남 |
| 2 | 문의 만족도 — 답변 받은 문의에 1~5점 + 한 줄(200자), 한 번만 | case 0.15.0, `clients/all/2026-11-17-request-inquiry-satisfaction.md` | 409 `INQUIRY_NOT_ANSWERED`·`ALREADY_RATED` 문구 |
| 3 | 리뷰 수정·삭제 화면 — "내가 쓴 리뷰"에서 수정(`PATCH`, `X-Expected-Version`, 3일 안 — `editableUntil` 그대로)·삭제(삭제 뒤 재작성 불가 안내) | review 0.2.0, `clients/customer-app/2026-11-16-request-review-edit-delete.md` | 앱에 API 호출 코드는 있음(`updateReview`·`deleteReview`), 화면 없음 |
| 4 | 실시간 도착 예정·배송 현황 실서버 확인 + 라이더 위치 점(픽업 뒤만) | tracking 0.5.0(`/eta`·`/stream` 구현), 0.6.0 `riderLocation`, `clients/customer-app/2026-11-17-reply-delivery-eta.md`·`…-reply-reference-gap-delivery.md` | 앱 구현은 있음(501 이던 것). 라이더 위치 지도는 새로. 매장 위치는 보이지 않음(결정) |
| 5 | 전달 완료 사진·놓은 곳 보기(오배송 확인) | execution `GET /deliveries/{id}/delivery-proof`·`evidence-photos/{ref}`(백엔드 PR #80), 같은 회신 | 사진은 앱에 저장하지 않음(`no-store`). **백엔드 main 반영 확인 먼저** |
| 6 | 배송 신고(지연·미수령·오배송)를 문의로 — `POST /inquiries` 에 배송 ID·신고 종류 | case(백엔드 PR #82), 같은 회신 | **백엔드 main 반영 확인 먼저** |
| 7 | 최근 검색어·인기 키워드 | search 0.2.0 `/me/recent-searches`·`suggestions.popular` | `search_screen.dart` 주석에 "로그인 단계에서 붙인다"만 있음 |
| 8 | 비회원 장바구니 병합(주문서 로그인 뒤) | cart `POST /carts/{id}/merges`, BR-50(OPEN) | BR-50 질문 회신부터 확인 |
| 9 | 주소 수정·삭제 | customer `PATCH`·`DELETE /me/addresses/{id}` | 레퍼런스 대비 A 목록에도 있음 |
| 10 | 회원 탈퇴·탈퇴 철회, 내 동의 목록, AI 상담 답 다시 찾기·다시 보기 | customer `/me/withdrawals`·`GET /me/consents`, customer-assistant `GET /customer-assistant/questions(/{id})` | 화면 위치는 레퍼런스 캡처 먼저 |
| 25 | **약관 동의(CU-1) — 급함** (1단계 로그인 흐름 끝 2026-11-17, 남은 것 = 주문 전 재동의·설정 마케팅): 로그인 동의 완료 본문 `providerToken`+`consents`(필수 + 선택 MARKETING, 끈 것도 false), `/me/consent-changes` 먼저 부르기 지움, 재동의 안내(`newAccount=false`), 완료 오류 표, 로그인해 있는 고객의 주문 전 재동의(`GET /me/consents` `requiredConsentOutdated`), 설정의 마케팅 켜고 끄기 | auth 0.2.0·customer 0.3.0, `clients/customer-app/2026-11-17-notice-consents.md`(BR-20 회신 포함) | **최신 계약으로 다시 만들면 고객앱이 컴파일되지 않음**(2026-11-17, `consentChangeRequestId` 없어짐). LAN 스위치 2개는 앱 반영 때까지 꺼짐 — 준비되면 백엔드(PC 1 백엔드)와 함께 켬. `contracts.lock`(dart)은 이것과 함께 올림 |
| 26 | 주소 검색(카카오 우편번호) 스크립트 도메인 `t1.daumcdn.net` → `t1.kakaocdn.net`, 이름 `daum.Postcode` → `kakao.Postcode` — **2026-11-30 종료**, 옛 주소면 검색 창 위에 개발자 공지가 고객에게 보임 | PC 5 알림 `docs/handoff/rider-app/2026-11-17-pc1-postcode-domain.md`(라이더앱은 #63 에서 바꿈) | 고객앱 `postcode_screen.dart` |

## 2. 백엔드에 회신할 것

| # | 할 일 | 근거 |
|---|---|---|
| 11 | **레퍼런스 대비 빠진 기능 A 목록의 착수 순서 회신**(오늘 순서 5번) | `clients/customer-app/2026-11-17-notice-reference-gap.md` — 회신은 `docs/handoff/customer-app/` 또는 PR 본문 |
| 12 | 재고 표시 요청 등록 — 목록 카드의 센터 재고 상태(일시품절), 상세·목록의 "N개 남음" 기준·개수 | 2026-11-17 조사(storefront·search 에 재고 필드 없음, product-content·cart 의 LOW 는 "아직 쓰지 않음"). 레퍼런스 대비 C(정책 결정 대기)에 "카드의 남은 수량" — **사용자 결정 뒤** `backend-requests.md` 에 BR 등록 |

## 3. 사용자 결정 기다림

| # | 물음 | 맥락 |
|---|---|---|
| 13 | 지금 주소로 배달하지 않아 숨긴 상품이 다시 보일 때 자동으로 다시 선택할지 | `e7d937f` — 지금은 선택이 꺼진 채 보임 |
| 14 | 장바구니에 "지금 주소로 배달하지 않는 상품 N개는 숨겼어요" 한 줄을 넣을지 | 같음 — 지금은 안내 없음 |
| 15 | "10개 미만이면 N개 남음" 표시를 할지(정책) | 위 12 와 같이 |
| 16 | lock 커밋 메시지의 백엔드 SHA 바로잡기 기록(`8fb3058`, `0a57b9f`)을 남길지 | 기능 영향 없음 |

## 4. 실서버·실기기에서 확인할 것 (목 모드로만 확인함)

| # | 기능 | 커밋 |
|---|---|---|
| 17 | 주문서 진입 전 재고 부족 422 → 장바구니 표시, 배달 안 하는 상품 숨김 | `e7d937f` |
| 18 | 화면용 주문번호 8자리(주문 상세·결제 완료) | `53fb6c9` |
| 19 | 오배송 다시 배송비 9,000원 결제·환불 고르기 — LAN 에 고객 잘못 오배송 건이 있어야 함(백오피스 접수부터) | `e9115ca` |
| 20 | 예약 시간 변경 거절 사유·오늘·내일 슬롯 | `aba8b12` |
| 21 | 알림함(쌓이는지, 푸시는 BR-09 전이라 없음) | 2026-11-16 |

## 5. 다른 PC 일 중 PC 1 이 챙길 것

| # | 할 일 | 맥락 |
|---|---|---|
| 22 | PC 3 의 실서버 PDA 피킹(장바구니) → 포장(패킹대) → 출하대기 확인 결과 받기 | #57(`c6f4930`), 백엔드 #91 배포. handoff README·PR #57 댓글 |
| 23 | mfc-fulfillment 0.9.0(백오피스 처리 대기 F-4) — 백오피스 처리 대기의 MFC 목록이 켜지면 PC 2 PR 검토 | 백엔드 #95(PC 3). mfc_app 은 영향 없음 |

## 6. 사용자가 백엔드에 전달할 것

| # | 문서 | 상태 |
|---|---|---|
| 24 | `docs/handoff/mfc-app/2026-11-17-backend-pick-reject-reason.md`(실적 거절 사유를 응답·조회에) | #57 로 main 에 들어옴 — 전달 여부 확인 필요 |
