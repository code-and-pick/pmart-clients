# 직원 웹 UI·UX 맞추기 지침 (통합 백오피스 → MFC 백오피스·라이더 백오피스)

보낸 앱: backoffice·web-common (PC 2)
받는 앱: mfc-backoffice (PC 3), rider-backoffice (PC 5)

- 근거: 사용자 지시 2026-11-19, 백엔드 백오피스 세션을 거쳐 받음. 통합 백오피스·인사팀 백오피스에 넣은 UI·UX 를 MFC·라이더 백오피스에도 맞춘다.
- 이 문서는 `all/` 에 둔다. handoff 규칙(README)이 "자기 영역 폴더에만 쓰고, 여러 영역에 걸친 문서는 `all/`" 이기 때문이다. 두 앱이 같은 문서를 본다.
- 참고 레퍼런스: 쿠팡 윙 판매자 화면 캡처 14장(사용자 PC 의 `판매자 관리사이트 이미지/`, git 제외). 아래 규칙은 그 캡처에서 뽑은 것이다.
- **반영 상태**:
  - **main** = 이미 합쳐짐.
  - **#224** = PR 열림(가격·상품·클레임·문의·일괄 등록, 겉모습, 메뉴 색, 체크 아이콘).
  - **#231** = PR 열림(배송 두 줄 카드, 다 끝났어요 띠, 검색 칩, 등록 방식 카드, 일괄 맡기, 회색 바탕 되돌림, 최근 본 항목 이름).
  - 파일 경로는 `web/backoffice/src/` 기준이다. 인사팀 사본은 `web/hr-backoffice/src/` 같은 자리에 있다.

## 0. 추천 — 공용(web/ui)으로 올릴 것과 사본으로 둘 것

| 나눔 | 무엇 | 추천 |
|---|---|---|
| 화면 모양만(앱 API 를 모름) | GuideBox, AllDone, StatCard(row)·StatStrip, SearchPanel(summary 칩), SearchSelect(초성), ProgressSteps, StickyTitle, motion 훅, 겉모습 CSS | **`@pmart/web-ui` 로 올려 같이 쓴다**. PC 2(web-common 담당)가 옮긴다 → PC 3·PC 5 는 가져다 쓰기만 하면 된다. `useFloatingPanel`·`MultiSelectDropdown`(찾기 칸)은 이미 web-ui 에 있다 |
| 앱 조회·역할을 아는 것 | 탭 제목(앱 알림 수), 끊김 띠, 이전·다음(workQueue — 앱 경로), 최근 봄(recentViews — 앱 종류), 화면 번호(displayNumber·employeeLabels — 앱 API) | **각 앱에 사본**(이 문서의 파일을 본떠 앱 조회로 바꿔 쓴다) |
| 왼쪽 메뉴 | 라이더 백오피스 모양이 기준(아래 1-3) | 라이더는 그대로, MFC 는 맞춘다 |

- **공용으로 올리는 PR 은 PC 2 가 따로 보낸다**(#224·#231 이 합쳐진 뒤). 그 전에 먼저 하려면 사본으로 시작하고, 올라오면 바꿔 끼운다.

## 1. 겉모습 (쿠팡 윙 느낌)

### 1-1. 본문 — `index.css` 의 `data-skin="wing"` 덩어리 (#224 `cecd0b9`·`55c9dc3`, 회색 바탕 #231 `ed25c27`)
- `App.tsx` 의 `<main ... data-skin="wing">` 하나로 본문 전체에 건다. 왼쪽 메뉴·머리줄·어두운 화면에는 걸지 않는다.
- 규칙:
  - 강조색은 파랑 `#346aff` 하나(`--color-primary`). 바탕은 연회색(전과 같게), 상자·카드는 흰색.
  - 그림자 없이 얇은 회색 테두리(`#e3e6ea`), 모서리 `0.375rem`.
  - 쪽 제목 `1.5rem` 굵게(옆 아이콘 상자 숨김).
  - 표: 머리줄 회색 `#f5f6f8`·13px, 칸 14px·위아래 여백 1rem.
  - 단추: 흰 바탕 + `#c9ced6` 테두리(파랑 단추는 그대로).
  - 고른 카드·칩: 파랑 테두리 + 옅은 파랑 `#f0f5ff`.
  - 숫자 카드 왼쪽 색 띠는 숨기고, 숫자 색으로만 구분한다.
- CSS 만이라 기능은 바뀌지 않는다. 시험도 그대로 통과했다.

### 1-2. 진행 단계 체크 (#224 `be2a3bb`)
- 끝난 단계 동그라미: 글자 `✓` 대신 굵은 흰 선 체크 SVG(`path d="M5 12.5l4.5 4.5L19 7.5"`, strokeWidth 3).

### 1-3. 왼쪽 메뉴 색 (#224 `7cef334`) — 라이더 백오피스가 기준
- 고른 메뉴: `bg-primary text-primary-content font-semibold rounded-md`. 하위 메뉴는 왼쪽 안내선 없이 들여쓰기만 한다.
- 지금 묶음 이름은 흰 글자, 다른 묶음은 `text-neutral-content/60`. 민트(accent)는 쓰지 않는다.
- 로고: 청록 `P` 배지(`bg-accent`) + 앱 이름.

## 2. 목록 화면 패턴

| 패턴 | 파일 | 커밋 | 규칙 |
|---|---|---|---|
| 상태 숫자 카드(가로형) | `shared/admin.tsx` `StatCard layout="row"`, `StatStrip` | #224 `4e3d1f6` | 이름은 왼쪽, 큰 숫자는 오른쪽. 누르면 그 상태로(주소 쿼리). 서버가 전체를 세지 않으면 "불러온 것 기준" 문구와 넘치면 "+"(0·전체처럼 보이지 않게) |
| 안내 상자 | `shared/admin.tsx` `GuideBox`(tone info·warning) | #224 `df30d38` | ⓘ 제목 + 글머리 몇 줄, 접기는 브라우저에 기억. **문구는 화면에 이미 있는 업무 문구만**(새 규칙을 만들지 않는다) |
| 검색 조건 칩 접기 | `shared/admin.tsx` `SearchPanel summary` | #231 `1e8777d` | 조건을 건 뒤엔 "🔍 검색 조건 [종류 취소▾] … 검색 열기" 한 줄. 조건이 없으면 펼침. 시스템 ID 조건은 "한 주문/한 라이더" |
| 다 끝났어요 띠 | `shared/admin.tsx` `AllDone` | #231 `1e8777d`·`e94b16f` | **서버 성공 0건일 때만**(읽는 중·실패·일부 원천 못 읽음·잘림이면 안 그림). 빈 안내와 겹치지 않게 |
| 먼저 확인 + 진행 단계 두 줄 | `features/live/LiveDeliveryPage.tsx` `LiveBoards` | #231 `1e8777d` | 위는 문제(빨강·주황), 아래는 단계(› 화살표). 누르면 그 줄만. **라이더 관제·MFC 운영판에 바로 맞는 모양** |
| '/' 검색 칸 | `app/ShortcutHelp.tsx` | main `3222d26` | 입력 칸 밖에서 '/' → `main form[data-list-part="top"]` 첫 칸 |
| 최근 봄 | `shared/recentViews.ts`, `shared/SeenMark.tsx` | main `3222d26`, 이름 고침 #231 `ed25c27` | 이름에 **시스템 ID·개인정보를 넣지 않는다**(화면 번호·종류만). 예전 ID 이름 항목은 숨김 |
| 내 보기 | `shared/SavedViews.tsx` | main `9b8f37f` | 주소 조건 저장, 연락처 같은 조건은 저장 안 함 |
| 일괄 행동 줄 | `features/cases/CasePages.tsx` `useBulkPick` | #231 `e94b16f` | 계약에 일괄 명령이 없으면 건마다(다시 읽은 version·각자 Idempotency-Key, 실패만 같은 키로 다시). 결과는 서버 응답대로 |
| 쿠팡 윙 화면 짜임 예 | `features/prices/PriceList.tsx`, `features/products/ProductListPage.tsx`, `features/claims/ClaimPages.tsx`, `features/inquiries/InquiryPages.tsx` | #224 | 카드 → 안내 → 회색 검색 띠 → 머리줄(총·선택·일괄·정렬) → 줄(썸네일·이름·값·상태·[행동 ⋮]) |

## 3. 상세 화면 패턴

| 패턴 | 파일 | 커밋 | 규칙 |
|---|---|---|---|
| 이전·다음 | `shared/workQueue.tsx`(`useRememberQueue`·`RememberQueue`·`QueueNav`) | main `8e32f64`·`0ae6764` | 목록이 순서를 sessionStorage 에 기억, 상세 위 "‹ 보던 목록으로 · ‹ 이전 · n/N · 다음 ›", `[` `]` 키. 기억하는 주소에서 연락처·찾기 말은 뺀다 |
| 제목 띠 | `shared/StickyTitle.tsx` + `DetailHeader` | main `a28b21a` | 제목 카드가 화면 위로 나가면 얇은 띠(제목·배지·맨 위로). **명령 단추는 복제하지 않는다** |
| 진행 단계 | `shared/ProgressSteps.tsx` | main `e139744`(막대)·`f2acdcc`(숨쉬기), 체크 #224 `be2a3bb` | 닿은 단계로 들어오는 선은 초록(`i <= step`), 지금 단계만 숨쉬기 |
| 미리보기 Enter | `shared/Preview.tsx` | main `0ae6764` | 미리보기 중 Enter = 상세 열기(단추·링크에 초점이면 가로채지 않음) |

## 4. 움직임 (main `e6a7bdb`·`f2acdcc`)
- `shared/motion.tsx`: `useChangeDelta`·`useStatChange`(바뀐 숫자 칸만 잠깐 빛남 + ▲▼), `useNewIds`(새로 들어온 줄 5초 강조, 탭·거르기 바뀌면 다시 셈), `useNow`.
- `index.css`: `.step-pulse`·`.stat-changed`·`.row-new`·`.breathe`·`.msg-new`·`.flow-bar`.
- 원칙:
  - 지금 일이 벌어지거나 방금 바뀐 곳에만 움직임을 넣는다.
  - 바뀜은 서버 값의 변화로만 판단한다. 처음 값이나 "?"는 바뀜이 아니다.
  - **`prefers-reduced-motion: reduce` 면 모두 끈다.**

## 5. 화면 틀
- 탭 제목·끊김 띠: `app/PageChrome.tsx`(main `3222d26`, 인사팀 `a28b21a`).
  - 탭 제목은 "(급한 일 수) 화면 이름 · 앱 이름". 급한 일 수는 메뉴 배지와 같은 조회로, 각 앱에 맞는 것을 쓴다(라이더: 관제 이상, MFC: 운영 이상).
  - 끊김 띠는 `navigator.onLine` 을 보고, 다시 이어지면 4초 동안 안내한다.
- 쳐서 찾는 고르기 `shared/SearchSelect.tsx`(main `64fcbbe`): 초성 검색, ↑↓·Enter·Esc, 숨은 낱말(코드 붙여 넣기). 펼친 목록은 `useFloatingPanel`(web-ui)로 position: fixed — 카드 `overflow-hidden` 에 잘리지 않는다(#224 `5ddf2e9`). 시험 도우미 `test/pick.ts`.

## 6. 화면 번호 (ADR-0070 덧붙임)
- `shared/displayNumber.tsx`(`DisplayNumber`·`SystemNumbers`), `shared/employeeLabels.ts`(직원 "이름 · 사번", hr `employee-labels` 50개씩 묶음), `shared/numberLookups.ts`, `shared/RefNumber.tsx`.
- 커밋: main `ed3e74c`(직원 이름)·`c8aa0b3`·`0e8c946`·`574880d`, PR #203 `2104e8b`.
- 규칙:
  - 목록·링크·칩·탭 제목·최근 봄에는 화면 번호나 이름만 보인다.
  - 시스템 ID 는 상세의 "시스템 번호" 접기 안에만 둔다.
- MFC 백오피스에는 이미 `displayNumber.tsx`·`OperatorLabel.tsx` 가 있다. 라이더 백오피스에는 `displayNumbers.tsx` 가 있다. 이름과 모양만 위와 맞추면 된다.

## 7. 맞출 때 지킬 것(공통)
- 계약에 없는 값으로 숫자·상태를 만들지 않는다. 서버가 세지 않는 수는 "불러온 것 기준"이라고 적는다.
- 조회 실패를 0·빈 목록·"다 끝났어요"로 보이지 않는다.
- 시험: 카드 숫자는 끝 숫자로 확인한다. 예: `toHaveTextContent(/기다림2$/)`. 이름 속 숫자("24~72시간")와 헷갈리지 않게 하기 위해서다.
- 개발 서버를 오래 켜 두면 CPU 때문에 시험이 무작위로 5초 시간 초과가 난다. 끝나면 끈다.

## 회신
- 공용(web-ui)으로 올리는 것에 동의하는지, 먼저 필요한 부품이 무엇인지 이 폴더(`all/`)에 회신 문서로 남겨 달라. PC 2 가 그 순서로 올린다.
