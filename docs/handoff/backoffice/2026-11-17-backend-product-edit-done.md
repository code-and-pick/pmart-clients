보낸 앱: backoffice(PC 2)
받는 백엔드 영역: platform(PC 1 — product-service)

# [pmart-clients → pmart-backend] 회신: 상품 정보 수정 화면 (2026-11-17)

- 원 요청: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-17-request-product-edit.md`
- 계약: product-service 0.3.2(백엔드 main `c475ff94`). 목으로만 확인 — LAN 배포 알림을 받으면 실서버로 확인한다.

## 한 것
1. **상품 상세 → "상품 정보 수정 시작"**: `POST /products/{productId}/edit-drafts`(본문 없음, `Idempotency-Key`·`X-Source-System`). 201 → 그 초안 화면으로 이동. 0.3.2 대로 MD 에게만 버튼, 그 밖 역할은 "MD 만 시작할 수 있어요" 안내(판정은 서버 403).
2. **409 `EDIT_DRAFT_EXISTS`**: `details[].field = existingDraftId` 의 `reason` 으로 "이미 수정 중인 초안이 있어요 · 그 초안 열기" 링크(SUBMITTED 면 같은 초안 화면이 승인 링크·결과를 보여 줌).
3. **수정 초안 폼**: `input` 을 통째로 채우고 저장은 폼 값 전체 PUT(`X-Expected-Version`). `targetProductId`·`baseProductId` 는 그대로 싣는다. 판매 단위·입수는 바꿀 수 없게 막음, SKU 추가·JSON 채우기 없음. 판매 상태는 넣지 않음.
   - 기존 폼에 없던 **소비기한 보장(`minRemainingDays`·`maxDaysSinceManufacture`)·실물 치수(`widthMm`·`depthMm`·`heightMm`·`dimensionsSource`)** 칸을 더했다(새 상품 초안에도). 치수는 세 값이 다 있어야 보낸다.
4. **바코드**: 쉼표 목록 그대로(선행 0 유지). 숫자만 8·12·13·14자리면 화면에서 GS1 검사 숫자를 미리 보고 "끝자리가 N 이어야 해요" 경고(서버가 정본). Enter(스캐너)는 저장하지 않고 다음 바코드 자리를 만든다.
5. **문제 표시**: `problems[]` 에 `detail` 도 보인다(맞는 끝자리·충돌 SKU). 새 코드 문구: `BARCODE_CHECK_DIGIT_INVALID`·`BARCODE_EMPTY`·`SKU_IDENTITY_CHANGED`.
6. 제출·승인·결과는 기존 초안 흐름 그대로(VALID 일 때만 제출, 승인 링크, `APPLIED` 면 같은 상품 링크).

## 안 한 것
- 상품 상세의 "수정 중(초안 …, 승인 대기)" 배지: 상세 응답에 열린 수정 초안이 없어, 수정 시작을 눌러 409 가 올 때만 안내한다.

## 확인
- 백오피스 테스트 265개 통과(새 시험 5개), typecheck·lint 통과. 목 캡처(상세 버튼, 수정 초안 — 시드 바코드 검사 숫자 경고).
