# [pmart-clients → pmart-backend] 요청: MFC 반납 인증번호 — 라이더가 직원 번호를 넣어야 반납 완료 (2026-11-18)

- 보낸 앱: rider-app (PC 5) — MFC PDA 앱(mfc-app, PC 3)이 번호를 보여 줘야 함
- 받는 백엔드 영역: delivery (delivery-execution `returns/store-deliveries`) · mfc (mfc-inbound 회수품 반입 — 직원 화면에 번호)
- 근거: 사용자 2026-11-18 "MFC에 회수 상품 전달할 때 MFC에서 QR 다시 찍는 게 과하면 직원이나 어딘가에 뜨는 인증코드(번호)를 입력해야 전달완료가 되도록 해야할 것 같은데."

## 지금
- 라이더 앱: 회수 배송(CLAIM_RETURN·MISDELIVERY_RECOVERY·FAILED_DELIVERY_RETURN)에서 "MFC에 반납했어요" → 확인 창 → `POST /deliveries/{id}/returns/store-deliveries` → RETURNED_TO_STORE(배송 끝·수행료).
- 계약 0.5.0 설명대로 "MFC 점원 수령 확인(mfc-inbound)이 생기기 전까지는 MFC 도착을 반납으로 본다" — **라이더 혼자 눌러도 반납 완료**. `receivedByStaffRef` 는 선택이고 확인하지 않는다.
- 직원 쪽 반입(`POST /return-receipts`)은 따로 기록되고 라이더 반납과 이어지지 않는다.

## 요청 (이름·자릿수는 제안 — 백엔드가 정하면 앱이 맞춘다)
| # | 무엇 | 제안 |
|---|---|---|
| 1 | 반납 인증번호 발급 | 회수 배송마다 숫자 **4자리** 번호. 라이더에게는 주지 않는다(라이더 API 응답에 넣지 않음). |
| 2 | 직원에게 보여 주기 | MFC PDA(mfc-app) 회수품 받기 화면·센터 관리자 웹에서, 도착한 회수 배송(라이더 이름·배송 번호)과 번호를 볼 수 있는 조회 — 예: mfc-inbound `GET /return-handovers?mfcId=` 또는 delivery 쪽 직원 조회에 `handoverCode`. 권한: MFC 직원(그 센터). |
| 3 | 반납 때 확인 | `returns/store-deliveries` 요청에 `handoverCode`(필수로 바꾸거나, 회수 배송에 번호가 있으면 필수). 틀리면 **422 `RETURN_HANDOVER_CODE_MISMATCH`**(상태 그대로), 맞으면 지금처럼 RETURNED_TO_STORE. |
| 4 | 틀림 반복 | 몇 번 틀리면 잠글지(예: 5회 → 지원센터 연결) — 백엔드·업무 결정에 맡김. |
| 5 | 이어 주기(선택) | 번호가 맞으면 직원 반입(return-receipts)과 같은 배송으로 묶어 "누가 받았는지"가 남게(`receivedByStaffRef` 를 서버가 채움). |

- 같은 Idempotency-Key 재시도는 지금과 같이(번호 확인 결과도 같은 키면 같은 응답).
- 번호는 로그·이벤트에 남기지 않는다(라이더 앱도 남기지 않음).

## 클라이언트가 해 둔 것 (목에서만)
- 라이더 앱: 반납 버튼 → **인증번호 4자리 입력 창**(직원 PDA 에 뜬 번호) → 요청 payload `handoverCode` → 틀리면 "인증번호가 맞지 않아요. MFC 직원에게 번호를 다시 확인해 주세요". 목 번호 4827.
- 계약에 없어서 **실서버(local)는 지금처럼 확인 창만** 띄우고 `handoverCode` 를 보내지 않는다(`returnHandoverCodeRequiredProvider` 가 목에서만 켬). 계약이 생기면 실서버도 켠다.
- MFC PDA 앱에서 번호 보여 주기는 계약이 정해지면 PC 3(mfc-app) 이 맡는다.

## 회신 부탁
- 계약 이름(필드·코드·직원 조회 경로)과 배포 시점.
- 번호 발급 시점(배정 때 / 라이더 MFC 도착 때)과 유효 시간이 있는지.
