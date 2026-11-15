# [pmart-clients → pmart-backend] 회신: 메뉴·센터를 `sessions/current` 응답으로 바꿈 + 빌드 3개 올리기 (2026-11-16)

- 보낸 앱: web-common (+ backoffice·hr-backoffice·mfc-backoffice — 로그인·세션 코드라 PC 1)
- 받는 백엔드 영역: platform
- 원 문서: `../pmart-backend/docs/handoff/clients/web-common/2026-11-15-request-session-roles-centers.md`
- 계약: `contracts.lock`(web) 을 백엔드 `853cca60` 으로 다시 생성(employee-auth 0.8.0·hr 0.3.0·order 0.6.0 포함)

## 1. 한 것 (목 모드로 확인, 실서버 확인은 아직)
- `web/core/src/operatorSession.ts`(새): `GET /employee-auth/sessions/current` 응답의 `roles`·`centers` 를 화면 세션으로 쓴다. 부르는 때 = 토큰이 생기거나 바뀔 때(로그인·새로고침 복원·토큰 갱신 뒤)와 탭이 다시 보일 때(ADR-0061 확인과 같은 호출 — 30초 안에는 한 번).
  - 처음 받기 전에는 "불러오는 중", 처음 받기가 실패하면 오류 + 다시 시도(빈 역할로 메뉴를 그리지 않는다). 이미 받은 값이 있으면 다시 받다 실패해도 그 값을 둔다. 늦게 온 옛 응답은 버린다.
  - 401 은 그대로 갱신 → 거절이면 로그인 화면. 정지·퇴사(401 `SESSION_EXPIRED`)도 같은 길.
- 세 앱의 메뉴(`nav.ts`·`App.tsx`)와 MFC 백오피스 센터 고르기가 이 값을 읽는다. access token 은 풀지 않는다 — `parseOperatorToken` 은 목 서버(MSW)·시험용으로만 남겼다.
- 응답과 토큰이 다르면(승인 직후 등) 화면은 응답을 따른다 — 시험으로 확인(토큰은 센터 1곳, 응답은 2곳 → 센터 고르기가 보인다).
- 확인: typecheck·lint(core·ui·세 앱) 통과. 테스트 core 24·backoffice 174·hr-backoffice 36·mfc-backoffice 16 통과(목 모드).

## 2. 요청 — 빌드 올리기
- (2026-11-16 다시 빌드: 센터 이름 반영 `2026-11-16-backend-session-center-names-done.md` , backoffice 열람·처리 대기, hr 부서·권한 관리, backoffice 사건함·처리 대기(bff)·라이더/배송 직원 API까지 담았다. 아래가 최신 해시.)

| 앱 | 명령 | 진입 파일 |
|---|---|---|
| backoffice | `lan.sh publish-backoffice` | `assets/index-BGISi3dQ.js`, `assets/index-axp6BaGl.css` |
| hr-backoffice | `lan.sh publish-hr-backoffice` | `assets/index-Bkg8rNsZ.js`, `assets/index-CU0EfKq_.css` |
| mfc-backoffice | `lan.sh publish-mfc-backoffice` | `assets/index-ChSinewe.js`, `assets/index-BtcOg322.css` |

- 세 빌드 모두 이 회신의 변경 + `backoffice/2026-11-16-backend-product-menu-operator-admin-done.md` + `hr-backoffice/2026-11-16-backend-role-list-done.md` 를 담았다.
- 올린 뒤 실서버에서 볼 것: 로그인 뒤 메뉴가 그대로 보이는지, MFC 백오피스 `claude-mfc-sup` 로 센터(`MFC-SEED-01`)가 잡히는지.
