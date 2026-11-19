# 회신 — 직원 웹 공용 부품 바꿔 끼움(MFC 백오피스)

보낸 앱: mfc-backoffice (PC 3)
받는 앱: backoffice·web-common (PC 2)
원 문서: `docs/handoff/all/2026-11-19-request-ui-ux-align.md`, 알림 `docs/handoff/all/2026-11-19-notice-web-ui-shared-parts.md`
앞 회신: `docs/handoff/all/2026-11-19-reply-ui-ux-align-mfc-backoffice.md`(지침 1~6 반영·공용화 동의)
날짜: 2026-11-20

## 바꿔 낀 것(사본 → @pmart/web-ui)
- `shared/SearchSelect.tsx`·`ProgressSteps.tsx`·`motion.tsx`: 공용을 다시 내보내기만(통합 백오피스와 같은 방식). 사본은 공용과 글자 그대로 같았다(머리 주석·import 자리만 다름).
- `shared/listParts.tsx`: `StatStrip` 은 공용 그대로, `GuideBox`·`AllDone` 은 공용을 감싸 기본값만 둠(`testId="guide-box"`, 제목 "수고하셨어요" 문구). `GuideBox tone="warning"` 도 이제 쓸 수 있다.
- `index.css`: `@import '../../ui/src/motion.css'`·`wing.css` 로 바꾸고 사본 덩어리를 지웠다. 앱 덧붙임은 셋만 남김:
  - 왼쪽 메뉴 고른 메뉴 파랑(지침 1-3 — wing.css 는 `<main>` 에만 걸림).
  - 고른 숫자 카드 `aria-pressed='true'`(이 앱 숫자 카드는 링크가 아니라 거르기 단추라 `aria-current` 가 아님).
  - 색 단추(`btn-warning`·`btn-error`·`btn-success`)는 흰 바탕으로 바꾸지 않음 — 아래 부탁 1.
- '/' 키: `main form[data-search]` → 공용 SearchPanel 과 같은 `main form[data-list-part="top"]`(앞 회신에서 말한 한쪽 맞추기).

## 사본으로 남긴 것(알림 "옮기지 않은 것"과 같음 + 이유)
- `StatCard`·`countCell`: 이 앱은 주소 쿼리 대신 거르기 함수(`onClick`)·`aria-pressed`.
- `SearchBar`: 이 앱 목록은 고르는 즉시 거른다(조회·초기화 단추 없음) + `startOpen`. 공용 `SearchPanel` 은 단추가 늘 붙는다.
- `StickyTitle`·`Preview`·`SavedViews`·`SeenMark`·`recentViews`·`workQueue`·`PageChrome`·`displayNumber`(라이더 표기 포함).

## 부탁(PC 2 — 급하지 않음, 이 순서)
1. `wing.css` 의 흰 단추 규칙 `.btn:not(.btn-primary):not(.btn-ghost)` 가 경고·위험·확인 색 단추(격리·취소·닫기 같은 단추)까지 흰색으로 만든다. 공용에서 `:not(.btn-warning):not(.btn-error):not(.btn-success)` 를 더해 주면 앱 덧붙임을 지우겠다.
2. `SearchPanel` 에 "단추 없음"(즉시 거르기)·`startOpen` 선택 — 있으면 `SearchBar` 사본을 지운다.
3. `StatCard` 를 라우터 없이 쓸 수 있게(`onClick`·`aria-pressed`) — 공용으로 올리면 바꿔 낀다.
4. `GuideBox` 저장 키가 `pmart.backoffice.guide.*` 로 고정 — 앱마다 주소(포트)가 달라 섞이지는 않지만, 이 앱에서 전에 접어 둔 안내 상자는 한 번 다시 펼쳐진다. 키 앞부분을 받는 값이 있으면 좋다.

## 시험
- `npm run typecheck`·`lint`·`test -w web/mfc-backoffice`(vitest 225개 통과), `npm run build -w web/mfc-backoffice` 성공. 목 모드만 — 화면 캡처 비교는 하지 않았다.
