// 공용으로 바꿈(2026-11-20 웹 백오피스 맞추기 4단계) — 정본은 web/ui/src/console/ (@pmart/web-ui/console). 이 앱 안의 가져오기 경로를 그대로 두려고 다시 내보낸다.
export * from '@pmart/web-ui/console';

/**
 * "저장한 보기" — 라이더 백오피스에서는 그리지 않는다(2026-11-24 사용자 "저장한 보기가 뭐임?" → "응 일단 없애").
 * 공용 부품(@pmart/web-ui/console)의 같은 이름을 이 앱에서만 덮는다 — 화면들은 그대로 둬도 아무것도 안 보인다.
 */
export function SavedViews(props: { readonly listKey: string }) {
  void props;
  return null;
}
