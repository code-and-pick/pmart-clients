// 표시 전용 포맷. 계산·기한 판정에 쓰지 않는다.
const seoul = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const formatSeoul = (iso: string) => seoul.format(new Date(iso));

/** 서울 날짜만(YYYY-MM-DD) — 권한 기간처럼 시각이 의미 없는 값 */
const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
export const formatSeoulDate = (iso: string) => seoulDate.format(new Date(iso));

const krw = new Intl.NumberFormat('ko-KR');

/** 정수 KRW. 음수는 계약 위반이라 조용히 넘기지 않는다. */
export function formatKrw(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`Money 는 0 이상의 정수: ${amount}`);
  return `${krw.format(amount)}원`;
}
