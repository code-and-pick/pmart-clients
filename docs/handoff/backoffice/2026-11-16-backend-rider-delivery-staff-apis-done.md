# [pmart-clients → pmart-backend] 회신: 라이더 찾기·상세·원문 열람, 직원 배송 찾기, 도움요청 → 사건함 반영 (2026-11-16)

- 보낸 앱: backoffice (PC 1 — 인계서 "지금까지 보낸 화면 요청은 클라이언트 쪽이 끝까지")
- 받는 백엔드 영역: platform (delivery 쪽 확인은 PC 5)
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-16-notice-rider-delivery-staff-apis.md`
- BR: BR-54·BR-55·BR-56 → DONE(`docs/backend-requests.md`)

## 1. 라이더 (rider 0.4.0)
- `/riders` 찾기: 라이더 ID·전화(숫자만, 10~11자리가 아니면 보내기 전에 막음) 완전 일치 + 제한·운행 상태·수단 거르기, 정렬(가입·상태 바뀐 최근 순), 쪽 이동(`page`·`hasNext`). 이름 검색 칸 없음. 목록 이름·전화는 받은 가린 값 그대로.
- `/riders/{id}` 상세: `GET /riders/{id}` — 가린 이름·전화, 수단, 운행(상태·센터·신규 배차·진행 중 배송 수), 배달 지역, 배차 방식, 제한(상태·기한), 마지막 위치, 가입.
- 원문 열람: 항목(이름·전화) 고르고 사유 2~200자 → `POST /riders/{id}/pii-reveals`(`Idempotency-Key`·`X-Source-System`). 고른 항목만 원문, 열람 기록 ID·시각 표시, 원문은 화면 메모리에만("다시 가리기"·화면 이동이면 사라짐). 503·결과 불명은 같은 키 "결과 확인".
- 계정 제한 `X-Expected-Version` 은 이제 상세의 `version`(BOD-6)을 보낸다(전에는 최근 이력 줄 version). 제한을 바꾸면 상세를 다시 읽는다. RIDER_OPS 도 제한·검토 화면을 쓴다(403 안내 시험을 지움).
- "이 라이더의 배송" = `GET /deliveries?riderId=`.
- 목 `riderDirectoryMock` 지움.

## 2. 배송 (execution 0.4.0, dispatch 0.3.2)
- `/deliveries`: 배송 번호로 열기 + 찾기(주문 ID·라이더 ID·상태, 오래된 순, cursor "더 보기"), 버튼 "전달 실패 확정 대기" = `state=FAILURE_REPORTED&sort=OLDEST`. 행 → 배송·주문·라이더 화면.
- 주문 상세에 "이 주문의 배송"(`GET /deliveries?orderId=`). 배송 상세의 배차는 상담원도 본다(취소 폼은 그대로 — 서버가 CS_AGENT 취소 403).

## 3. 도움요청 → 사건함
- 권고대로 도움요청 대기 화면·목(helpQueueMock)을 지우고 `/delivery-help-requests` 는 `/cases?kind=RIDER_HELP` 로 넘긴다. 사건함 목록에 종류 거르기(`kind`)를 더했다.
- 라이더 도움요청·전달 실패 사건 상세: `refs` 의 `incidentId`(`<deliveryId>:<requestId>`)로 `GET /deliveries/{id}/help-requests/{requestId}` — 분류·단계·라이더가 쓴 내용·사진 참조·상태. 처리는 사건 집기·닫기.
- 질문: 사건 `refs` 에 `incidentId` 가 늘 오나(아니면 `requestId` 를 따로 실어 줄 수 있나). 지금은 `incidentId` 가 없으면 도움요청 단건을 열지 않는다.

## 4. 확인·빌드
- typecheck·lint 통과, 테스트 194개(목 모드 — 라이더 찾기·전화 검사·원문 열람·이 라이더의 배송·실패 대기·주문의 배송·도움요청 사건, 권한 변경 반영). 실서버 확인은 아직.
- 빌드: `web-common/2026-11-16-backend-session-roles-centers-done.md` §2 표의 backoffice 해시를 `index-BGISi3dQ.js`·`index-axp6BaGl.css` 로 바꿨다(오늘 백오피스 변경 전부).
