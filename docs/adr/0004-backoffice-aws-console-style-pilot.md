# ADR-0004 백오피스 UI·UX 를 AWS 콘솔 모양으로 개편한다 — `web/backoffice` 시범

- 상태: 시범 (2026-11-20, 사용자 결정)
- 관련: ADR-0001(스택), ADR-0003(웹 공유 패키지). 기준 문서 `docs/apps/backoffice-ui-guide.md`

## 배경
- 사용자 지시(2026-11-20): "백오피스 UI UX 를 전면 개정한다. 레퍼런스는 AWS 콘솔". 또 "시범적으로 backoffice 에만 일차적으로 적용".
- 지금 웹 백오피스 4개(기본·인사팀·MFC·라이더)는 라이더 백오피스 관리자 형식을 **앱마다 사본**(`src/shared/admin.tsx`·`index.css` 테마 블록)으로 쓴다(2026-11-18 사용자 결정 — 한 PC 가 고친 것이 다른 앱을 바꾸지 않게).
- 네 앱은 공유 패키지 `@pmart/web-ui`(상태 표시·명령 결과·앱 바꾸기·고르기 상자·목록 부품)와 `motion.css`·`wing.css` 를 같이 쓴다.
- AWS 콘솔은 공개 디자인 시스템 Cloudscape(Apache-2.0)로 만들어졌다. 레퍼런스 캡처에는 계정 번호·사용자 이름이 찍혀 있다.

## 결정
1. AWS 콘솔(Cloudscape)의 **모양과 규칙만** 따른다. 스택은 그대로(daisyUI 5 + Tailwind 4) — Cloudscape 등 새 UI 라이브러리를 들이지 않는다.
2. **시범은 `web/backoffice` 하나.** 고치는 곳은 그 앱의 `index.css` 테마 변수, `src/shared/admin.tsx`, `src/features/**` 뿐이다.
3. `web/ui`·`web/core`·공용 CSS 는 **고치지 않는다.** 공용 부품이 새 모양과 안 맞으면 backoffice 안에서 감싸거나 backoffice CSS 로 덮는다.
4. 기준(수치·부품 규칙·적용 현황)의 정본은 `docs/apps/backoffice-ui-guide.md`. 캡처는 `web/aws-ui-reference/`(git 제외, 이 캡처가 있는 PC 에만)에 둔다.
5. 화면을 고친 뒤에는 같은 폭으로 캡처해 레퍼런스와 한 이미지로 나란히 비교하고, 남은 차이를 기준 문서 "적용 현황"에 적는다.
6. 순서: 디자인 토큰 → 뼈대 → 목록 공통 부품(한 화면 먼저, 사용자 확인 뒤 나머지) → 상세·폼·대시보드.

## 넓힐 조건
다음이 모두 되면 인사팀·MFC·라이더 백오피스에도 넓힐지 사용자가 정한다(새 ADR 로).
- 기준 문서 "적용 현황"의 backoffice 단계가 모두 끝남.
- 사용자가 화면으로 확인함.
- backoffice typecheck·lint·test 통과.

넓히게 되면 그때 공용 부품을 `@pmart/web-ui` 로 올릴지(ADR-0003), 앱마다 사본으로 둘지 함께 정한다.

## 결과
- 시범 동안 backoffice 만 다른 모양이다. 앱 바꾸기로 다른 백오피스로 가면 모양이 달라진다(의도한 차이).
- 다른 PC 의 앱에는 영향이 없다. 로그인 화면·로그인 시험(PC 1 몫)이 찾는 글자는 그대로 둔다.
- 캡처는 저장소에 없으므로 다른 PC 는 글로 된 기준 문서만 본다.
