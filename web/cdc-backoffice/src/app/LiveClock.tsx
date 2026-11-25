// 머리줄 실시간 시계(2026-11-21 사용자 "레퍼런스 제대로 참고" — corap/mfc-control-tower 머리줄의 살아 있음 점 + KST 시계).
// 화면 표시만(판정에 쓰지 않음). 좁은 화면에서는 숨긴다.
import { useNow } from '@pmart/web-ui';

const fmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function LiveClock() {
  const now = useNow(1000);
  return (
    <span className="hidden items-center gap-2 lg:inline-flex" data-testid="live-clock">
      <span className="pm-live h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
      <time className="pm-mono text-[13px] font-semibold text-base-content/85" dateTime={new Date(now).toISOString()}>
        {fmt.format(now)}
        <small className="ml-1 font-normal text-base-content/45">KST</small>
      </time>
    </span>
  );
}
