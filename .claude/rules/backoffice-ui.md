---
paths:
  - "web/backoffice/**"
---

# 백오피스 UI·UX 개편 규칙 (시범, ADR-0004)

- `web/backoffice` 화면은 AWS 콘솔 모양으로 개편 중이다. 기준(수치·부품 규칙·적용 현황)은 `docs/apps/backoffice-ui-guide.md`.
- 화면을 만들거나 고치기 전에 기준 문서의 해당 장과 그 장의 캡처(`web/aws-ui-reference/`, git 제외 — 있는 PC 에서만)를 먼저 연다.
- 고치는 곳은 `web/backoffice/src/index.css` 테마 변수, `src/shared/admin.tsx`, `src/features/**` 만. **`web/ui`·`web/core`·공용 CSS·다른 웹 앱은 고치지 않는다.** 공용 부품이 안 맞으면 backoffice 안에서 감싸거나 CSS 로 덮는다.
- 색·수치는 테마 변수로. 화면마다 하드코딩하지 않는다. 새 UI 라이브러리를 들이지 않는다.
- 고친 뒤 같은 폭으로 캡처해 레퍼런스와 한 이미지로 나란히 비교하고, 남은 차이를 숨기지 않고 보고한다. 기준 문서 "적용 현황" 줄을 고친다.
- 모양만 바꾼다. 업무 규칙(서버 확정만 확정 표시·조회 실패 표시·개인정보 마스킹·화면 용어)과 시험이 찾는 글자·aria-label 은 그대로 둔다.
