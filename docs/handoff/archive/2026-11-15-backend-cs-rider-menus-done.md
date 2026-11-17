# [pmart-clients → pmart-backend] 회신: 백오피스 메뉴 묶음 + 고객센터·라이더 운영 메뉴 반영 (2026-11-15)

- 보낸 앱: backoffice
- 받는 백엔드 영역: platform (§3·§4 는 delivery — PC 5)
- 원 문서: `../pmart-backend/docs/handoff/clients/backoffice/2026-11-15-clients-request-backoffice-cs-rider-menus.md`
- 클라이언트 화면 정리: `docs/apps/backoffice-web.md` §2-4

## 1. 한 것 (목 모드로 확인 — 실서버 확인은 아직)

- 웹 생성 타입을 백엔드 `cfaab74` 계약으로 다시 만들었다(`contracts.lock` web).
- 왼쪽 메뉴를 접고 펴는 묶음으로 바꿨다. 토큰 역할의 합집합으로 보이고, 하위 메뉴가 없으면 묶음도 숨긴다. MFC 메뉴는 넣지 않았다.
- 고객센터 묶음: 주문 조회(목록·상세), 문의 답변(기존 화면), 라이더 컴플레인(기록·목록·상세), 클레임 조회(결정 버튼 없음), 배송 확인(수행·배차 따로, 전달 실패 확정·반려).
- 라이더 운영 묶음: 라이더 찾기·계정 제한, 제한 검토, 전달 실패·도움요청 대기, 배송·배차 확인(픽업 전 배차 취소 포함), 라이더 컴플레인, 주문 조회.
- 계약이 아직 없는 두 화면(라이더 찾기·기본 정보, 대기 목록)도 만들었다. 목 모드에서만 메모리 목으로 보이고, LAN·로컬 빌드에서는 "서버 API 준비 전" 안내만 하고 아무 경로도 부르지 않는다(BR-54·BR-55).
- 시험: 백오피스 Vitest 173개 통과(새 23개), typecheck·lint 통과.

## 2. 메뉴 이름·순서 (요청서 제안에서 바꾼 것)

| 묶음 | 하위 메뉴(순서) | 보이는 역할 |
|---|---|---|
| 상품 관리 | 상품 조회, 상품 등록, 상품 일괄 등록, 카테고리 트리, 콘텐츠 등록, 콘텐츠 일괄 등록, 가격, 가격 일괄 등록, 센터 취급 | `MD` |
| 승인 | 승인함, 통합 승인함(bff) | `*_APPROVER`, `OPERATOR_ADMIN` |
| 고객센터 | 주문 조회, 문의 답변, 라이더 컴플레인, 클레임 조회, 배송 확인 | `CS_AGENT`, `OPERATOR_ADMIN` |
| 라이더 운영 | 라이더 찾기·계정 제한, 제한 검토, 전달 실패·도움요청 대기, 배송·배차 확인, 라이더 컴플레인, 주문 조회 | `RIDER_OPS`, `OPERATOR_ADMIN` |
| 업무 도우미 | 업무 도우미 | 모든 직원 |

- 이름은 제안 그대로. 라이더 운영 묶음에 **주문 조회**를 더했다(백엔드 정본 `backoffice-role-menus.md` §2 의 RIDER_OPS 줄에 있음).
- `OPERATOR_ADMIN` 에게 상품 관리 묶음은 안 보인다(요청서 표대로 `MD` 만). **질문**: `OPERATOR_ADMIN` 이 상품·콘텐츠·가격·센터 취급 API(product·product-content·pricing·mfc-inventory `sku-handlings`)를 서버에서 부를 수 있는가? 부를 수 있고 관리자가 상품 업무도 하면 메뉴를 연다. 못 부르면 메뉴를 열어도 403 만 보이니 지금처럼 둔다.
- `MD` 에게 승인 묶음은 안 보인다(승인함은 승인자용). MD 가 올린 건의 승인 상태는 상품 등록·일괄 등록 화면 안에서 대상 승인(`GET /approvals?targetRef=`)으로 이미 보인다.
- 첫 화면은 보이는 첫 메뉴다(상담원 → 주문 조회, 라이더 운영 → 라이더 찾기, MD → 상품 조회).

## 3. API 에 없는 칸·조건 (목록)

1. **BR-54** 직원용 라이더 찾기·상세(`GET /riders`, `GET /riders/{riderId}`, BOD-3). 화면은 BOD-3 제안 모양으로 가정했다. 확정되면 경로·필드를 알려 달라.
2. **BR-55** 전달 실패·도움요청 대기 목록(BOD-4). "처리함" 닫기 API 를 둘지 정해지면 버튼을 붙인다.
3. **BR-56** 주문 조회(`GET /orders/lookups/{orderId}`)와 문의(`Inquiry`)에 배송 번호가 없다. 컴플레인 기록·배송 확인은 deliveryId 가 필요해서, 지금은 상담원이 배송 번호를 직접 넣는다. 주문 상세에 배송 번호 목록을 싣거나, 주문 ID 로 배송을 찾는 직원용 조회가 있으면 좋겠다.
4. 개인정보 원문 열람: 클라이언트 규칙은 "원문 열람은 사유 입력 흐름"인데 그런 API 가 없다. 지금 주문 상세의 배송지·연락처·출입 메모는 기본으로 가리고 "보기"로 연다(화면 안에서만, 기록 없음). 열람 기록이 필요하면 API 를 정해 달라.
5. 역할 확인: 계약 설명에 역할이 적혀 있지 않은 곳이 있다.
   - `GET /claims`·`/claims/{id}`·`/refunds` 의 직원 역할: 화면은 고객센터 묶음에만 뒀다. `RIDER_OPS` 도 보게 되는지.
   - `GET /deliveries/{id}`(execution) 의 직원 역할: 목은 `CS_AGENT`·`RIDER_OPS`·`OPERATOR_ADMIN` 허용으로 흉내 냈다.
6. 계정 제한 `X-Expected-Version`: 화면은 `GET /riders/{riderId}/restrictions` 의 최근 이력 `version` 을 보낸다. 이력이 없는 라이더는 헤더 없이 보낸다. 라이더 version 을 응답에 따로 실어 줄지, 이 방식이 맞는지.
7. 제한 검토 `RESTRICTED`: "먼저 계정 제한을 건 뒤"를 서버가 막는지(어떤 code 로) — 목은 409 `INVALID_STATE` 로 흉내 냈다.

## 4. PC 5 반영 전 화면 동작

- 배차 조회의 `CS_AGENT`·`RIDER_OPS`, 그리고 `RIDER_OPS` 의 계정 제한·제한 검토·배차 취소·실패 결정은 지금 403 이 그대로 오류로 보인다. 화면은 이미 있으니 서버 권한만 열리면 된다.

## 5. 11-09 요청서의 MFC 메뉴

- 기본 백오피스에는 MFC 메뉴를 하나도 시작하지 않았다. 옮길 것은 없다. (PDA 앱 `apps/mfc_app` 은 따로 진행 중이고 이 결정과 관계없다.)

## 6. 새 웹 빌드 — 올려 달라 (`publish-backoffice`)

| 앱 | dist 폴더 (PC 1) | 진입 파일 | 주소 |
|---|---|---|---|
| 백오피스 | `C:\development\pmart-project\pmart-clients\web\backoffice\dist` | `assets/index-Dyq2y9wh.js`, `assets/index-BA51wX7k.css` | `https://192.168.0.40` |

- `npm run build:lan -w web/backoffice` 결과. API 는 `https://192.168.0.40:8443/api/v1` 만. 인사팀 백오피스는 바뀌지 않았다.
- 이 빌드는 `2026-11-15-backend-assistant-connected.md` §2 의 빌드(`index-Bxl0nrwE.js`)를 대신한다(업무 도우미·문의 답변 포함).
- 올린 뒤 확인: `test-cs-rider@pmart.com` 로그인 → 왼쪽에 고객센터·라이더 운영·업무 도우미 묶음, 주문 조회(기간 7일)가 목록을 받는지, 라이더 찾기·대기 목록은 "서버 API 준비 전" 안내인지. 관리자 시험 계정으로 승인·고객센터·라이더 운영 묶음. 비밀번호는 PC 1 에서 파일로만(채팅·로그에 붙이지 않는다).

## 끝남 (2026-11-16, PC 2 — archive 로 옮김)
- 백엔드 회신 `…/clients/backoffice/2026-11-15-reply-cs-rider-menus-and-assistant.md` §1(질문 모두 답), `2026-11-15-notice-product-menu-operator-admin.md`(§2 질문 → 관리자에게 상품 묶음, 아래 product-menu 회신). BR-54~56 끝(`2026-11-16-reply-rider-delivery-staff-apis.md`, 화면 반영 2026-11-16 04:00 일지).
- LAN 확인(2026-11-16 PC 2): test-cs-rider 메뉴 = 고객센터·라이더 운영·지원센터·업무 도우미, 조회 화면 200. 라이더 0건이라 상세·제한은 실서버 미확인 — 일지 미결로 남김.
