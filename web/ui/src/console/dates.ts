// 공용 @pmart/web-ui/console(2026-11-20 — web/backoffice 에서 올림, ADR-0004 넓히기). 고칠 때는 이 파일을 고친다(앱마다 사본 아님).
const DAY = 86_400_000;
const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 오늘(서울) YYYY-MM-DD */
export const seoulToday = (now: Date = new Date()) => seoulDate.format(now);
/** 서울 날짜 d 에서 n 일 뒤(앞이면 음수) */
export const addSeoulDays = (d: string, n: number) => seoulDate.format(new Date(Date.parse(`${d}T00:00:00+09:00`) + n * DAY));
