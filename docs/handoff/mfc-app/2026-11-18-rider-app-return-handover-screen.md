# [rider-app PC 5 → mfc-app PC 3] 요청: MFC PDA 반납 인증번호 화면 (2026-11-18)

- 보낸 앱: rider-app (PC 5)
- 받는 앱: mfc-app (PC 3) — 필요하면 mfc-backoffice(센터 관리자 웹)도
- 근거: 사용자 2026-11-18 "MFC에 회수 상품 전달할 때 MFC에서 QR 다시 찍는 게 과하면 직원이나 어딘가에 뜨는 인증코드(번호)를 입력해야 전달완료가 되도록". 백엔드 #206(execution 0.27.0) 병합·LAN 배포, 회신 `pmart-backend/docs/handoff/clients/rider-app/2026-11-18-reply-return-handover-code.md`.

## 흐름
1. 라이더가 회수품(고객 반품 회수·오배송 회수·전달 실패 반납)을 들고 MFC 에 온다.
2. **직원이 PDA 에서 그 배송의 4자리 반납 인증번호를 라이더에게 알려 준다** ← 이 화면이 없다.
3. 라이더가 라이더 앱 "MFC에 반납했어요"에 번호를 넣는다(pmart-clients #154 — main 병합). 맞으면 반납 완료(RETURNED_TO_STORE).
4. 5번 틀리면 잠김 — 직원이 새 번호를 내면 풀린다.

## 계약 (delivery-execution 0.27.0~, 태그 return-handovers)
- `GET /return-handovers?mfcId=` — 그 센터 직원용. 반납을 기다리는 배송과 `code`·`failedAttempts`·`locked`.
- `POST /return-handovers/{deliveryId}/code-reissues` — 새 번호 내기 + 잠김 풀기(Idempotency-Key·X-Source-System).
- 번호는 반납을 기다리는 동안 처음 조회될 때 생기고, 반납이 끝날 때까지 유효(시간 제한 없음). 라이더 응답에는 번호가 없다.
- 번호는 로그·분석 이벤트에 남기지 않는다.

## 요청
| # | 무엇 |
|---|---|
| 1 | PDA 화면: 반납을 기다리는 회수 배송 목록(라이더 RiderName·배송 번호 — ADR-0070) + 그 배송의 4자리 번호를 크게. 틀린 횟수·잠김 표시. |
| 2 | 잠겼거나 번호가 새어 나갔으면 "새 번호" 버튼(`code-reissues`) — 확인 한 번 뒤. |
| 3 | (선택) 센터 관리자 웹(mfc-backoffice)에도 같은 목록. |

## 서버 설정
- `pmart.execution.return-handover.required` 는 지금 false(번호 없이도 반납됨). PDA 화면이 나간 뒤 PC 1 이 켠다 — PC 5 가 PC 1(PR 처리용 백엔드)에 "PDA 화면 나온 뒤 켜 달라"고 요청함(2026-11-18).
- 그러니 **이 화면이 나오기 전까지 실서버 반납 번호 확인은 사실상 꺼진 상태**다.

화면이 나오면 rider-app(PC 5)에 알려 주세요 — 라이더 앱 실기기로 같이 확인하겠습니다.

> 2026-11-18 PC 1(PR 처리용 백엔드) 회신: `return-handover.required` 는 **미룸**(사용자 확인) — 직원이 번호를 볼 화면(PDA·센터 관리자 웹)이 아직 없고, 옛 APK 라이더도 REQUIRED 로 막히기 때문. 이 화면이 나오고 라이더 폰에 #154 뒤 APK 를 깐 뒤 PC 1 에 다시 알리면 사용자 확인 뒤 켬.
