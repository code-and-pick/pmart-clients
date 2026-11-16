# 요청: LAN 게이트웨이 CORS 에 웹 개발 서버 출처(localhost:5173·5174·5175) 추가

- 보낸 앱: web-common (backoffice·hr-backoffice·mfc-backoffice 셋 다)
- 받는 백엔드 영역: platform (게이트웨이 설정·LAN 배포 — PC 1)
- 작성: pmart-clients PC 2, 2026-11-16
- 고칠 곳(백엔드·설정 저장소 — 클라이언트는 읽기만): `pmart-config/api-gateway-lan.yml` `pmart.gateway.cors.allowed-origins`·`credentialed-origins`

## 1. 왜
- PC 2 가 mfc-backoffice 메뉴 화면 9개와 backoffice 화면(사건함 0.5.0, 곧 통합 조회)을 만들었는데, **실서버에서 확인할 길이 없다.**
  - LAN 8445 빌드는 11-15 기반 빌드(`index-ChSinewe.js`)라 새 메뉴가 없다. 새 빌드는 PR 이 차례로 합쳐진 뒤에야 올릴 수 있다(쌓은 PR 금지 — 8개가 줄 서 있음).
  - 개발 서버를 LAN 게이트웨이에 바로 붙이는 모드(`npm run dev:lan -w web/<앱>` — API `https://192.168.0.40:8443/api/v1`)가 이미 있고, **직원 로그인 복귀 주소는 이미 허용돼 있다**(`pmart-config/employee-auth-service-lan.yml`: `http://localhost:5173/auth/callback`·`5174`·`5175`).
  - 그런데 **게이트웨이 CORS 허용 출처에 `http://localhost:517x` 가 없어** 브라우저가 API 응답을 막는다(지금 `api-gateway-lan.yml` 은 192.168.0.40·d603-16 의 443·8444·8445 만).

## 2. 요청
`pmart-config/api-gateway-lan.yml` 에 아래 출처를 더해 LAN 게이트웨이에 반영해 달라.

| 설정 | 더할 출처 |
|---|---|
| `allowed-origins` | `http://localhost:5173`, `http://localhost:5174`, `http://localhost:5175` |
| `credentialed-origins` | 같은 셋 — 직원 세션 refresh 쿠키(ADR-0059)를 쓰는 경로라 필요 |

- 5173 = backoffice, 5174 = hr-backoffice, 5175 = mfc-backoffice(각 앱 `vite.config.ts` 의 `server.port`, `strictPort`).
- 확인해 줄 것: refresh 쿠키가 `http://localhost` 페이지에서 오는 교차 출처 요청에도 실리는지(쿠키 속성 SameSite·Secure). 브라우저는 `http://localhost` 를 보안 출처로 다루지만, 백엔드 쿠키 설정에 따라 다를 수 있다. 안 되면 그 이유와 다른 방법(예: 개발 서버를 HTTPS 로)을 알려 달라.
- 보안: LAN 개발 환경 한정(`-lan.yml`). 운영 설정에는 넣지 않는다.

## 3. 반영되면 클라이언트가 할 일
- `npm run dev:lan -w web/mfc-backoffice`(5175)로 띄우고, 사용자가 `claude-mfc-sup` 으로 로그인해 메뉴 9개를 실서버에서 확인한다. backoffice(5173)·hr-backoffice(5174)도 같은 방식.
- 결과는 각 앱 일지와 회신 handoff 로 알린다.
