// 공용으로 올림(2026-11-20) — 정본은 web/ui/src/console/ (@pmart/web-ui/console). 이 앱 안의 가져오기 경로를 그대로 두려고 다시 내보낸다.
export * from '@pmart/web-ui/console';

// 백오피스 화면 기준(2026-11-25 — PC 5 요청, 라이더 백오피스 모양을 공용 @pmart/web-ui/standard 로 올림): 상태 = 점 + 글자, 0건 = 회색 한 줄,
// 안내·다음 할 일 = 판 색 + 왼쪽 띠, 설명은 ⓘ, 검색 조건 = 찾기 줄 + 필터 팝업 + 칩, 구역 = 보기/처리. 같은 이름으로 덮는다(직접 내보낸 이름이 export * 보다 먼저).
export {
  ActionSection,
  AllDone,
  Caret,
  expandRowProps,
  GuideBox,
  InlineDetail,
  NextAction,
  Notice,
  PageHeader,
  SearchPanel,
  SearchRow,
  Section,
  StatCard,
  StatusBadge,
  StatusText,
  SummaryBar,
  useInlineOpen,
  ViewSection,
  type SummaryEntry,
} from '@pmart/web-ui/standard';
