보낸 앱: cdc-backoffice
받는 백엔드 영역: platform(cdc — procurement·supplier·cdc-inbound)
작성: pmart-clients PC 3(사용자 지시로 CDC 백오피스 작업), 2026-11-26
상태: **철회(2026-11-26, PC 5)** — 사용자 "상품 발주 목록 없애" → DC 백오피스에서 상품 발주 메뉴·화면·목을 지움(입고관리 메뉴도 뺌). PO-1~4 는 만들지 않아도 된다. archive 로 옮긴다.

# 요청: 상품 발주·공급사 관리 + 가짜 공급사 회신 → CDC 입고

## 사용자 지시
- "Cdc에 일단 상품 발주 탭 있어야해. 하위로 공급사 관리 탭이"
- "비즈니스 로직대로 발주관련 만들되. 실제 공급사가 있는 게 아니라, **주문에 대한 회신 가짜데이터로 받고 입고** 시키라고"

`overview.md` §4는 "1차 제외: 공급사·구매발주"이고, SCM 문서는 "초기범위 PO·ASN 생성 안 함"이다. **이 지시로 범위가 바뀐다.** 사업 문서도 함께 고쳐 주세요.

## 클라이언트가 한 것(목 전용)
- DC 백오피스 [입고·재고 › 상품 발주]에 탭 두 개를 만들었다: **발주**, **공급사 관리**.
- 지금 계약(procurement·supplier·cdc-inbound ASN)은 3단계 자리표시자다(응답 `Placeholder`, 목록 없음).
  - 그래서 **경로 이름은 그 계약을 따르고 필드는 아래처럼 제안**해 목에서만 돌린다.
  - 제안 타입은 `web/cdc-backoffice/src/api/proposed/purchase.ts`, 목은 `src/mocks/purchaseHandlers.ts`에 있다.
- 실서버(local·lan)에서는 화면이 호출하지 않고 "준비 중"을 보인다.

## PO-1 공급사(supplier-service)
- `GET /suppliers?state=ACTIVE|SUSPENDED` → `{ items: Supplier[] }`
- `GET /suppliers/{supplierId}` → `Supplier`
- `POST /suppliers` (Idempotency-Key·X-Source-System)
  - 본문: `{ name, businessNo?, contactName?, phone?, leadTimeDays, skus[], replyMode }`
  - 응답: `Supplier`
- `Supplier` 필드:
  - `supplierId`, `name`, `businessNo|null`, `contactName|null`, `phone|null`
  - `leadTimeDays`(발주 → 도착 일 수, 납기 기본값)
  - `skus[]`(공급 상품)
  - `replyMode`(FULL·PARTIAL·REJECT — 아래 가짜 공급사 규칙, 시험용)
  - `state`, `createdAt`
- 역할: CDC_SUPERVISOR·OPERATOR_ADMIN(지금 계약은 "추정 OPERATOR").

## PO-2 발주(procurement-service)
- `GET /purchase-orders?cdcId=&state=` — **목록이 없다(필수).**
  - 정렬은 발주 시각 최신 순이다. 쪽 나눔은 transfers와 같게 해 주세요.
- `POST /purchase-orders`
  - 본문: `{ cdcId, supplierId, dueDate, note?, lines[{sku, qty}] }`
  - 공급사가 공급하지 않는 SKU이거나 거래 중지 공급사면 422.
- `GET /purchase-orders/{id}`
- `POST /purchase-orders/{id}/cancellations` `{ reason }`
  - ASN 전(ISSUED·CONFIRMED·PARTIALLY_CONFIRMED)에만 된다. 그 뒤에는 409 INVALID_STATE.
- `PurchaseOrder` 필드:
  - `purchaseOrderId`, `cdcId`, `supplierId`, `supplierName`, `state`, `dueDate`, `note`
  - `lines[{ sku, orderedQty, confirmedQty|null, shippedQty|null, lot|null, expiresAt|null, receivedQty|null, rejectedQty|null }]`
  - `issuedBy`, `issuedAt`, `repliedAt`, `replyNote`
  - `asn{ asnId, shippedAt, expectedArrivalAt, vehicleNo }|null`
  - `receivedAt`, `receivedBy`, `cancelledAt`, `cancelReason`, `version`
- 상태:
  - `ISSUED` → `CONFIRMED`·`PARTIALLY_CONFIRMED`·`REJECTED`(공급사 회신)
  - → `ASN_RECEIVED`(납품 예정) → `RECEIVED`(입고 확정)
  - `CANCELLED`(ASN 전에만)

## PO-3 가짜 공급사(회신 자동 생성)
- 진짜 공급사가 없다. 발주(PurchaseOrderIssued)를 받으면 **가짜 공급사가 일정 시간 뒤 회신**한다. 규칙은 공급사의 `replyMode`를 따른다.
  - `FULL`: 전량 확정
  - `PARTIAL`: 줄마다 80%(내림) 확정, `replyNote`에 사유
  - `REJECT`: 전부 0, 거절
- 확정분은 다시 일정 시간 뒤 **ASN**으로 보낸다. 줄마다 LOT·유통기한을 붙이고 도착 예정은 납기로 한다. 경로는 계약 `POST /internal/asn-receipts`(supplier EDI → procurement → AsnReceived)를 쓴다.
- 목은 회신 5초, ASN 8초로 둔다. 실제 간격과 시뮬레이터에 둘지는 백엔드가 정한다.

## PO-4 입고(cdc-inbound)
- `POST /asn/{asnId}/receipts` `{ lines[{ sku, receivedQty, rejectedQty }] }` → `PurchaseOrder`(RECEIVED)
  - 받은 수량 + 불량 수량 ≤ ASN 수량이어야 한다. 아니면 422.
  - 상태가 ASN_RECEIVED가 아니면 409.
- 확정하면 **cdc-inventory에 그 LOT로 더한다.**
  - 목은 입고장 칸(`CDC01-C-5-91-01-0-1`)에 정상(RELEASED) 품질로 넣는다.
  - 적치 지시(`putaway-tasks`)로 이어지는지는 백엔드가 정한다.

## 화면 규칙(클라이언트)
- 확정 표시는 응답 상태만 따른다(발주 접수 ≠ 공급 확정 ≠ 입고).
- 회신·ASN을 기다리는 동안은 3초마다 다시 읽는다. 푸시나 스트림이 생기면 바꾼다.
- 계약이 정해지면 `api/proposed/purchase.ts`를 지우고 생성 타입으로 바꾼다.

## 끝남 — 철회 (2026-11-26)
- 사용자 "상품 발주 목록 없애"·"입고관리도 빼줘" → clients #595 가 DC 백오피스 상품 발주·입고관리 메뉴를 지움. 백엔드 할 일 없음. 열린 목록에서 뺐다.
