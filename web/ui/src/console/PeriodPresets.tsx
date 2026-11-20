// 공용 @pmart/web-ui/console(2026-11-20 — web/backoffice 에서 올림, ADR-0004 넓히기). 고칠 때는 이 파일을 고친다(앱마다 사본 아님).
// 기간 빠른 고르기(2026-11-20 AWS 시간 범위 고르기 "1일·1주·…·사용자 지정" 참고) — 오늘·7일·30일 단추가 아래 두 날짜 칸을 서울 날짜로 채운다.
// 날짜 칸은 그대로 있어 직접 고칠 수 있다. 지금 두 칸이 단추 범위와 같으면 그 단추가 눌려 보인다. 기간 규칙(최대 31일 등) 판정은 화면·서버 그대로.
import { addSeoulDays, seoulToday } from './dates';
import { messages } from './messages';

const DAYS = [1, 7, 30] as const;

export function PeriodPresets({ from, to, onPick }: { readonly from: string; readonly to: string; readonly onPick: (range: { readonly from: string; readonly to: string }) => void }) {
  const today = seoulToday();
  return (
    <div role="radiogroup" aria-label={messages.period.label} className="inline-flex overflow-hidden rounded-field border border-base-content/40" data-testid="period-presets">
      {DAYS.map((n, i) => {
        const start = addSeoulDays(today, -(n - 1));
        const on = from === start && to === today;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            className={`px-2.5 py-1 text-sm ${i > 0 ? 'border-l border-base-content/25' : ''} ${on ? 'bg-primary font-semibold text-primary-content' : 'bg-base-100 hover:bg-base-200'}`}
            onClick={() => onPick({ from: start, to: today })}
          >
            {messages.period.days(n)}
          </button>
        );
      })}
    </div>
  );
}
