// 고객센터·라이더 운영 화면 공통 도우미: 값 이름표, 서울 날짜·시각, 금액 글자(2026-11-20 안 쓰던 정의 목록·개인정보 가림·계약 전 안내 부품은 지움).
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { messages as m } from './messages';

/** 계약 값 → 문구. 모르는 값은 지어내지 않고 원문 그대로. 없으면 "-". */
export const label = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : m.none);

export const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : m.none);
export const won = (n: number | null | undefined) => (n === null || n === undefined ? m.none : formatKrw(n));
export const text = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? m.none : String(v));

const DAY = 86_400_000;
const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 서울 기준 오늘(YYYY-MM-DD). */
export const seoulToday = (now: Date = new Date()) => seoulDate.format(now);
/** 서울 날짜 d 에 n 일 더한 날짜. */
export const addSeoulDays = (d: string, n: number) => seoulDate.format(new Date(Date.parse(`${d}T00:00:00+09:00`) + n * DAY));
/** 서울 날짜 d 의 0시(포함 하한). */
export const seoulDayStart = (d: string) => new Date(`${d}T00:00:00+09:00`).toISOString();
/** 서울 날짜 d 다음 날 0시(끝 날짜를 포함하는 미포함 상한). */
export const seoulDayEnd = (d: string) => new Date(Date.parse(`${d}T00:00:00+09:00`) + DAY).toISOString();
/** 두 서울 날짜 사이 일수(끝 포함). */
export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00+09:00`) - Date.parse(`${from}T00:00:00+09:00`)) / DAY) + 1;
export const isSeoulDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00+09:00`));
