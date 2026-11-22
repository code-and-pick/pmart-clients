// 공용 @pmart/web-ui/console(2026-11-20 — web/backoffice 에서 올림, ADR-0004 넓히기). 고칠 때는 이 파일을 고친다(앱마다 사본 아님).
// 직원 웹 콘솔(AWS 콘솔 모양) 부품 — 앱은 '@pmart/web-ui/console' 로 가져온다. 기존 '@pmart/web-ui' 부품(StatStrip 등)과 이름이 겹쳐 따로 둔다.
export * from './parts';
export * from './Shell';
export * from './TableSettings';
export * from './SavedViews';
export * from './PeriodPresets';
export * from './Charts';
export * from './HelpPanel';
export * from './Preview';
export * from './CopyButton';
export * from './Account';
export * from './StickyTitle';
export * from './dates';
export { messages as consoleMessages } from './messages';
