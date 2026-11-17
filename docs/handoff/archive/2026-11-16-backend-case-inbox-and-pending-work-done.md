# [pmart-clients → pmart-backend] 회신: 사건함 화면 + 처리 대기(bff) 반영 (2026-11-16)

- 보낸 앱: backoffice (사용자 2026-11-16 "여기서 일단 만들을거야" — PC 1 이 만듦)
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-16-request-case-inbox-and-pending-work.md`
- 계약: `contracts.lock`(web) 백엔드 `33587489`(case 0.4.0, backoffice-bff 0.2.0)

## 1. 처리 대기 — bff 로 바꿈 (§2)
- 메뉴 "처리 대기"(OPERATOR_ADMIN) → `/pending`. 목록은 `GET /backoffice/views/pending-work` 하나(어제 만든 order-service `GET /fulfillment-issues` 직접 목록은 지웠다). 멈춘 시각 오래된 것부터, 종류(멈춘 주문 처리·이행 확인 필요)·주문 링크·사유(reasonCode·reasonMessage, 사가 종류·단계)·상태. 원천 표시(SourceStamps), `unavailableSources` 면 "조회하지 못한 원천" 경고(빈 목록으로 보이지 않음).
- 버튼은 `allowedActions` 에 있는 것만:
  - `REQUERY_RESULT` "결제 결과 다시 확인" → `POST /backoffice/commands/order-orchestration-service/saga-requery` `{targetRef: refId, payload: {}, reason?}`(메모 선택).
  - `MARK_RESOLVED` "처리 완료(밖에서 해결)" → `…/saga-resolve`, 사유 필수 + "목록에서 빠지기만 — 주문·재고는 그대로" 경고.
  - `ACKNOWLEDGE` "확인" → order-service `POST /fulfillment-issues/{refId}/acknowledgements` `{note}`.
  - bff 명령은 `Idempotency-Key`·`X-Source-System` 을 붙이고, 응답 CommandResponse 를 `ACCEPTED`·`UNKNOWN_RESULT` 면 짝 조회 `GET /backoffice/commands/{ts}/{cmd}/{requestId}` 로 확정한다. 끝나면 목록을 다시 읽는다. 422 `NOT_REQUERYABLE`·`NOT_RESOLVABLE` 은 "이미 상태가 바뀌어 … 새로고침".
- "MFC 인계 거절·현장 중지 실패는 아직 이 목록에 없어요" 한 줄.

## 2. 사건함 — 메뉴 "지원센터"(RIDER_OPS·OPERATOR_ADMIN·CS_AGENT) (§1)
- `/cases`: 탭 안 집은 것(`unassigned=true`)·내 것(`assigneeId=<세션 운영자 ID>`)·기한 넘김(`overdue=true`)·닫힌 것(`state=CLOSED`), URL 쿼리. 서버 순서 그대로. 우선순위(P1 빨강), 종류, 요약, 관련(`refs` → 배송·주문·라이더 화면 링크), 처리 기한(`overdue` 면 빨간 "기한 넘김"), 담당, 상태. `size=100`(다음 쪽은 아직 없음).
- `/cases/{caseId}`: 사실·이력·종결. "내가 집기"(`assignments` {assigneeId: 나}) — 안 집은 열린 사건에만, RIDER_OPS·관리자. 관리자는 운영자 ID 를 넣어 다른 사람에게 배정. "닫기"(`closures` {resolution, summary}) — 관리자, 또는 RIDER_OPS 이고 안 집었거나 내가 집은 사건. 응답 사건 상세로 바로 바꾼다. 요약에 "고객 주소·연락처 원문은 적지 마세요". `X-Expected-Version` = 사건 version.
- CS_AGENT 는 "보기만" 안내, 집기·닫기 없음.
- `/cases/new-misdelivery?deliveryId=`: 오배송 열기 `POST /cases` `{kind: MISDELIVERY, subjectType: DELIVERY, subjectRef, summary, evidence?: [{system: backoffice-web, ref, kind: PHOTO}]}` → 201 → 새 사건 상세. 409 `CASE_ALREADY_OPEN` 문구.

## 3. 확인·빌드·질문
- typecheck·lint 통과, 테스트 189개(처리 대기 6·사건함 7 새로). 목 모드만 — 실서버 확인은 아직.
- 빌드: `archive/2026-11-16-backend-session-roles-centers-done.md` §2 표의 backoffice 해시를 `index-Bw-245hF.js`·`index-axp6BaGl.css` 로 바꿨다(오늘 백오피스 변경 전부).
- 질문: (1) 사건 목록 `summary` 가 없을 때 무엇을 보이면 되나(지금 caseId). (2) 오배송 `evidence.system` 에 `backoffice-web` 을 넣었는데 사진 보관 서비스 이름이 따로 있으면 알려 달라. (3) 사가 `reasonCode`(예 `PAYMENT_UNKNOWN`·`RESERVATION_REJECTED`)는 코드 그대로 보이고 있다 — 한국어 이름 표가 있으면 알려 달라.

## 끝남 (2026-11-16, PC 2 — archive 로 옮김)
- 백엔드 회신 `../pmart-backend/docs/handoff/clients/backoffice/2026-11-16-reply-case-inbox-questions.md` 대로 반영(PC 2, 브랜치 `backoffice/case-inbox-followups`):
  - §2-1 요약이 없는 사건 → 목록에 사건 번호 대신 종류 이름.
  - §3 처리 대기 bff 명령: 결과 조회 `GET /backoffice/commands/…/{requestId}` 가 501 이라 부르지 않는다. `APPLIED`·`REJECTED` 만 확정, `ACCEPTED`·`UNKNOWN_RESULT`·시간 초과는 목록을 다시 읽고 "목록에서 확인" 안내(결과 불명 — 같은 키 재전송만). 목도 결과 조회를 501 로.
  - (함께) `reply-rider-delivery-staff-apis` §1 — 도움요청 사건은 따로 실린 `requestId`·`deliveryId`(case 0.4.1)를 먼저, 없으면 `incidentId` 를 나눠 씀.
- §2-2(오배송 `evidence.system`)·§2-3(사가 `reasonMessage`)은 지금 화면 그대로.
- 결과 조회 API 가 생기면 처리 대기를 `settleCommand` 짝 조회로 되돌린다(새 handoff 로 알려 주면 됨).
