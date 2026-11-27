보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — PC 1 `pmart-backend-cdc` 세션 "CCdc 백엔드(PR 필수)"), cdc-inventory
작성: pmart-clients PC 5, 2026-11-27

# 요청 MF-1: DC 관리자가 TRF·출발별 "MFC 재고 반영(수령 확정)"을 볼 조회

사용자(2026-11-27): "재고 이관할 때 mfc랑 재고 연동되는 거 실시간으로 잘 보이게 해줘".
계약은 pmart-backend origin/main f53aa334 기준으로 봤다.

## 지금 DC 백오피스가 보여 주는 것
- DC 쪽: TRF 상태(cdc-outbound transfers), 출발 검증(departures), 운송 중 합(cdc-inventory stock-snapshot `transit`).
- MFC 쪽(이번에 더함): 운행 정차의 MFC 도착·인계 대조(transport-execution `GET /cdcs/{cdcId}/trips` — `stops[].arrivedAt·handedOverAt·handover`).
  → "MFC 재고 이동" 화면 넷째 단계 "MFC 도착·인계", 출발 줄마다 "가는 중·도착 예정 / MFC 도착 / MFC 인계 · 박스 8/8", TRF 상세 "DC → MFC 진행" 줄.

## 빠진 것
MFC 가 수령을 확정해 MFC 재고에 반영됐는지(`MfcReceiptPosted` → cdc-inventory TIN_ACK·Transit 대사)는 DC 운영자 경로가 없다.
- `GET /internal/transits`·`/internal/lot-traces`·`/internal/daily-reconciliations` 는 내부 경로.
- `GET /cdcs/{cdcId}/stock-movements` 는 sku 또는 locationCode 가 필수라 "오늘 MFC 수령" 전체를 볼 수 없고, TIN_ACK 줄의 sourceRef 는 receiptId 라 어느 TRF·출발인지 이을 수 없다.

## 바라는 모양(제안 — 이름·모양은 백엔드가 정함)
`GET /cdcs/{cdcId}/transits?date=&mfcId=&state=&page=&size=` (자기 센터 운영자, 읽기만)
- 줄 = 출발 × TRF: `trfId`·`trfNumber`·`departureId`·`departureNumber`·`mfcId`·`departedAt`
- 수량: `departedQty`(q)·`receivedNormalQty`·`quarantinedQty`·`pendingQty`·`lossQty`·`unreconciledQty`(t)
- `transitState`(IN_TRANSIT·RECEIPT_POSTED_AWAITING_ACK·TRANSIT_RECONCILED …)·`lastReceiptAt`·MFC 입고 종결(`closure.kind`·`closedAt`, MI-5)
- 또는 `GET /cdcs/{cdcId}/transfers/{trfId}` 응답에 같은 `receipt` 요약을 붙여도 된다(TRF 상세에서 한 건씩).

화면은 이 값이 오면 넷째 단계를 "MFC 인계 → MFC 재고 반영" 두 칸으로 나누고, 미정산(t > 0)은 경고로 보인다. 오기 전에는 인계까지만 보이고 "재고 반영은 아직 조회가 없음"이라고 화면에 적어 두었다.
