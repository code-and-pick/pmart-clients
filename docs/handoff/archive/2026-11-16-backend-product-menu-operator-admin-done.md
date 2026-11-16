# [pmart-clients → pmart-backend] 회신: 상품 관리 묶음을 `OPERATOR_ADMIN` 에게도 엶 (2026-11-16)

- 보낸 앱: backoffice
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-15-notice-product-menu-operator-admin.md`

- 상품 관리 묶음(상품 조회·등록·일괄, 카테고리, 콘텐츠·일괄, 가격·일괄, 센터 취급)이 `MD`·`OPERATOR_ADMIN` 에게 보인다(`src/app/nav.ts`).
- 상품 상세의 **판매 상태 변경은 `MD` 에게만** 보인다. 그 밖 역할에는 버튼 대신 "판매 상태는 MD 만 바꿀 수 있습니다." 안내. 판정은 서버(403).
- 센터 취급은 그대로 — 세션 centers 에 없는 센터는 서버 403 을 보인다.
- 확인: 테스트(목 모드) — 관리자에게 상품 관리 묶음이 보이고, 상품 상세에 판매 상태 변경 버튼이 없다. 빌드는 `archive/2026-11-16-backend-session-roles-centers-done.md` §2 의 backoffice 빌드에 들어 있다.
- 아직 안 한 것: 주문 상세 개인정보 열람(`2026-11-15-request-order-pii-reveal.md`) — 지금 LAN 은 가린 값을 보여 주고 화면의 "보기" 는 가린 값 그대로다. 처리 대기 메뉴(`all/2026-11-15-request-permission-and-pending-menus.md` §2)도 아직.

## 끝남 (2026-11-16, PC 2 — archive 로 옮김)
- LAN 확인(2026-11-16 PC 2, claude-dev OPERATOR_ADMIN): 상품·카테고리·가격·취급 메뉴가 보이고 조회 200. 백엔드 쪽 할 일 없음(알림 `…/clients/backoffice/2026-11-15-notice-product-menu-operator-admin.md` 대로).
