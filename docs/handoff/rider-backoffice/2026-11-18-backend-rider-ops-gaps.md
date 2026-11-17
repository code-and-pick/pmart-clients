# [pmart-clients → pmart-backend] 요청: 라이더 백오피스 — 화면은 있는데 직원용 API 가 없는 것 (2026-11-18)

- 보낸 앱: rider-backoffice (PC 5)
- 받는 백엔드 영역: delivery (rider-service·delivery-execution·delivery-dispatch)
- 근거: 사용자 2026-11-17 "PMart 라이더 백오피스 — 클라이언트 담당"(A 대시보드 ~ G 정산), main #88(메뉴 11개) + 이 PR(배차 시도·도착 예정·도움요청 사진·처리함·가리기·관제 지도)
- 클라이언트 처리: 아래는 모두 **화면에 만들지 않거나 "직원용 API 없음"으로 안내만** 한다(추측 호출·가짜 값 없음). 생기면 붙인다.

| # | 화면 | 필요한 것 | 지금 화면 |
|---|---|---|---|
| 1 | 가입 승인 | 승인·거절 명령, `GET /riders` 의 `signupStatus` 거르기 | 사용자 결정 "일단은 바로 승인되게, 정책은 나중에" — 최근 가입 목록 + 자동 승인 안내만. **정책 정해지면** 요청 |
| 2 | 라이더 상세 | 정산계좌 등록 여부(있음/없음만, 계좌번호 X) | "직원용 API 없음" 안내 |
| 3 | 라이더 상세 | 약관·개인정보 동의 이력(항목·버전·동의 시각) | "직원용 API 없음" 안내 |
| 4 | 라이더 상세 | 이 라이더의 배정·배차 취소 이력(배송별 배정/해제 시각·사유) | 배송 찾기(`riderId`)로 대신, 배송 상세에는 시도별 제안 표 |
| 5 | 배송 찾기 | `StaffDeliverySummary.orderNumber`(8자리) | 주문번호는 찾기 조건으로만, 번호는 상세에서 |
| 6 | 배송 상태 정정 | 직원이 근거 사진을 올릴 경로(`evidenceRefs` 를 채울 업로드) | 사진 없이 사유만 보냄 |
| 7 | 배송 상세 완료 증빙 | **`Evidence.method` 값 목록을 계약 enum 으로**. 지금 계약은 `method: { type: string }` 이고, `CUSTOMER_CONFIRMED` 는 설명 글에만, `AUTO_COMPLETED` 는 알림(`2026-11-17-notice-ops-action-apis.md` — `evidence.method AUTO_COMPLETED`)에만 있음. 자동 완료가 정말 `evidence.method` 로 오는지(아니면 증빙 없이 이력 actor SYSTEM_EVENT 만인지)도 | FACE·CONTACTLESS·CUSTOMER_CONFIRMED·AUTO_COMPLETED 는 이름표, 그 밖 값은 받은 그대로 보임 |

- 질문: 7번(값 목록)은 이름표가 맞는지 확인용이라 먼저 부탁드립니다. 1번 외(2~6)를 1차에 넣을지, 넣는다면 어느 서비스·버전인지 회신 부탁드립니다. `../pmart-backend/docs/handoff/clients/rider-backoffice/` 에서 읽겠습니다.
- 참고(이미 반영): rider 0.9.0 `/riders/stats`·`signupStatus`·`signupDecidedBy`, execution `/delivery-stats` — #88 대시보드가 씀(contracts.lock f5324066).
