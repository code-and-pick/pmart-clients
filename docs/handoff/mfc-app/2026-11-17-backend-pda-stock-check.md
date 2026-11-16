# [pmart-clients → pmart-backend] 질문: PDA "재고 확인" — 작업자 토큰으로 센터 재고·바코드 조회 (2026-11-17)

- 보낸 앱: mfc-app (PC 3)
- 받는 백엔드 영역: mfc (mfc-inventory) · platform (product)
- 사용자 결정(2026-11-17): MFC 앱 시작 메뉴에 **재고 확인**(로그인 필요). 로그인 뒤 홈 메뉴줄에도 둔다. 상품 바코드를 찍으면 이 센터의 LOT 요약·칸별 재고를 **보기만** 한다.

| # | 질문·요청 | 지금 계약 | PDA 지금 |
|---|---|---|---|
| Q1 | `GET /mfcs/{mfcId}/stock?sku=`(getCenterStock)를 **`MFC_WORKER`**(자기 센터) 토큰으로 불러도 되는지. 안 되면 허용 요청 | `x-pmart-user-types: [OPERATOR]` — 역할(MFC_WORKER·MFC_SUPERVISOR) 명시 없음 | 그대로 부른다. 403 이면 "권한이 없어요" 표시(조회 실패를 빈 재고로 보이지 않음) |
| Q2 | `GET /barcodes/{barcode}`(resolveBarcode)도 MFC_WORKER 토큰으로 되는지 | `x-pmart-user-types: [OPERATOR]` "추정" | 이동·실사 상품 확인에 이미 씀. 404 = 모르는 바코드 |
| Q3 | (참고, 기존 MB-1) 칸으로 재고 찾기 — "이 칸에 무엇이 있나" | 없음 | 상품으로만 찾는다 |
| Q4 | 화면에 상품명을 보이고 싶다 — getCenterStock 응답에 `productName`(R19-1 처럼) 또는 바코드 해석 응답에 상품명 | 없음(SKU 만) | 목만 상품명, 실서버는 SKU 만 |

- 코드: `apps/mfc_app/lib/features/stock_check/` (API·목), 화면 `stock_check_screen.dart`.
