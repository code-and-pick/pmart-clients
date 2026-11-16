# 알림: 백오피스 업무 도우미 실서버 연결 · 고객센터 문의 답변 화면 · 새 웹 빌드

- 보낸 앱: backoffice
- 받는 백엔드 영역: platform (ai-assistant-service 담당 영역이 나뉘었으면 그쪽)
- 작성: pmart-clients, 2026-11-15
- 답하는 것: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-04-clients-request-ai-assistant.md`, `…/archive/2026-11-09-clients-notice-assistant-lan-generative.md`
- 계약: `ai-assistant-service.yaml` 1.1.0
- 상태: 코드·시험 끝, **미커밋**. 백오피스 빌드를 새로 만들었다 — **PC 4 에는 올리지 않았다.**
- **실서버 확인은 하지 않았다**(MSW 로 흉내 낸 응답만).

## 1. 바뀐 것
- 백오피스 `/assistant` 가 local·LAN 빌드에서 게이트웨이 `/api/v1/assistant/**` 를 부른다(전에는 "연결 전" 안내만).
  - 질의 `POST /assistant/policy-questions` — 운영자 토큰, `X-Source-System: backoffice-web`, `Idempotency-Key`, 본문 `{question}`(`context` 는 보내지 않는다).
  - 다시 보기 `GET /assistant/policy-questions/{answerId}`, 내 질문 목록 `GET /assistant/question-history`.
- 응답을 잃었거나(타임아웃·503) 202 `PROCESSING` 이면 사용자가 "같은 요청으로 결과 확인"을 눌러 **같은 키·같은 질문으로 POST** 를 다시 보낸다. `GET ?requestId=` 는 쓰지 않는다.
- `answerMode=GENERATIVE` 답에는 "근거 문서를 꼭 확인" 안내를, 기준선(`BASELINE_EXTRACTIVE`·`BASELINE_HASH`)에는 "품질 미검증" 안내를 붙인다.

## 1-1. 고객센터 문의 답변 화면(새 화면)
- 답하는 것: `../pmart-backend/docs/handoff/clients/all/2026-11-09-clients-request-customer-inquiry-page.md` §2. 계약 `case-service.yaml` 0.2.0.
- 메뉴 "고객센터 문의"(`/inquiries`) — 모두에게 보이고 권한은 서버 판정(`CS_AGENT` 가 아니면 403 → "이용할 수 없는 화면").
- 목록 `GET /inquiries?status=&cursor=`(상태 필터는 URL 쿼리, "더 보기"), 상세 `GET /inquiries/{inquiryId}`, 답변 `POST /inquiries/{inquiryId}/replies`(`Idempotency-Key`·`X-Source-System: backoffice-web`·`X-Expected-Version` = 문의 `version`).
- 답변 결과를 모르면(타임아웃·5xx) 같은 키로 다시 보낸다 — **답변 POST 가 같은 키에 같은 결과를 주는지**(답변이 두 번 붙지 않는지) 확인해 달라. 계약 설명에는 문의 접수만 "같은 키 = 같은 문의"로 적혀 있다.
- 409 `VERSION_CONFLICT`·`INQUIRY_CLOSED` 는 안내하고 문의를 다시 읽는다.

## 2. 새 웹 빌드 — 올려 달라
> 2026-11-15 덧붙임: 이 빌드 대신 `2026-11-15-backend-cs-rider-menus-done.md` §6 의 새 빌드(`index-Dyq2y9wh.js`)를 올려 달라(이 문서의 기능 포함).

| 앱 | dist 폴더 (PC 1) | 진입 파일 | 주소 |
|---|---|---|---|
| 백오피스 | `C:\development\pmart-project\pmart-clients\web\backoffice\dist` | `assets/index-Bxl0nrwE.js`, `assets/index-CvVsfcBO.css` | `https://192.168.0.40` |

- API 는 `https://192.168.0.40:8443/api/v1` 만. 인사팀 백오피스는 바뀌지 않았다.

## 3. 확인해 달라
- 2026-11-09 공지의 주소는 `http://192.168.0.40:8080/api/v1/assistant/**` 였다. 지금 HTTPS 게이트웨이(`:8443`)에도 같은 경로가 열려 있는지, 백오피스 출처(`https://192.168.0.40`)의 CORS 로 `POST`·`Idempotency-Key` 헤더가 통하는지.
- 게이트웨이 `/api/v1/inquiries/**` 도 `:8443` 에서 같은 출처 CORS 로 통하는지(`X-Expected-Version` 헤더 포함). `CS_AGENT` 역할을 가진 LAN 시험 직원이 있는지.
- 올린 뒤 브라우저에서 질문 하나(예: 결품 처리) → 답·근거 표시, 근거 없는 질문 → "근거 문서를 찾지 못했어요".

## 4. 덧붙임(2026-11-15 15:10) — 토큰 없이 본 것
- `:8443` 에서 `/inquiries`·`/assistant/question-history` 401(경로 있음), 출처 `https://192.168.0.40` 사전 요청 200(허용 헤더에 `idempotency-key`·`x-source-system`·`x-expected-version`). §3 의 경로·CORS 질문은 이것으로 풀렸다 — 남은 것은 빌드 올리기와 로그인한 뒤의 실제 확인.
- 새 요청 `backoffice/2026-11-15-clients-request-backoffice-cs-rider-menus.md` 는 받았고 아직 반영 전이다. 문의 답변 화면은 이 빌드에 이미 있다(메뉴는 아직 묶지 않은 한 줄 "고객센터 문의").

## 끝남 (2026-11-16, PC 2 — archive 로 옮김)
- 백엔드 회신 `../pmart-backend/docs/handoff/clients/backoffice/2026-11-15-reply-cs-rider-menus-and-assistant.md` §0(빌드 올림)·§2(같은 키·같은 본문 = 답변 한 번, 다른 본문 409 `IDEMPOTENCY_CONFLICT`). 경로·CORS 는 §4 덧붙임대로 열려 있음.
- LAN 확인(2026-11-16 PC 2, `index-BGISi3dQ.js`): 업무 도우미 200(claude-dev·test-cs-rider), 문의 목록 200(test-cs-rider, 0건). 관리자 문의 403 은 case 0.4.2(PR #11)로 따로 처리. 답변 보내기는 문의 0건이라 실서버로 눌러 보지 않음 — 일지 미결로 남김.
