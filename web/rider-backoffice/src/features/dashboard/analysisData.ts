// 대시보드 분석 구역의 셈(화면 없이 시험한다) — 2026-11-21 사용자 "대시보드가 허전해, 라이더 시뮬레이션 분석 탭 같으면 좋겠다".
// 원천은 execution 직원 배송 목록(GET /deliveries — StaffDeliverySummary: 상태·createdAt·assignedAt·pickedUpAt·completedAt)뿐이다(새 API 없음).
// 시각 해석(목록에 있는 시각만 쓰는 근사 — 서버 정본 단계 기록은 배송 상세 history):
//   배차 요청 ≈ createdAt(배송이 생긴 때) · 라이더 찾기 = createdAt → assignedAt(지금 배정 기준 — 재배정이면 마지막 배정)
//   MFC 이동·대기 = assignedAt → pickedUpAt · 고객에게 = pickedUpAt → completedAt · 한 건 = createdAt → completedAt(COMPLETED 만)
// 시간대 칸 나누기는 라이더 시뮬레이터 ui/timeChart.ts 와 같은 고정 틀(최근 2시간 10분 칸 · 하루 1시간 칸 · 7일 하루 칸, 서울 시각).
import type { components } from '../../api/generated/delivery-execution';

/** 목록 한 줄 — 셈에 쓰는 칸(배송 ID·생긴 시각·상태)이 있는 것만 받는다 */
export type Summary = components['schemas']['StaffDeliverySummary'] & { readonly deliveryId: string; readonly createdAt: string; readonly state: components['schemas']['ExecutionState'] };
export const isRow = (x: components['schemas']['StaffDeliverySummary']): x is Summary => !!x.deliveryId && !!x.createdAt && !!x.state;
export type Kind = 'done' | 'active' | 'failed' | 'other';
export const KINDS: readonly Kind[] = ['done', 'active', 'failed', 'other'];
export const KIND_LABEL: Record<Kind, string> = { done: '완료', active: '진행 중', failed: '실패', other: '취소·회수' };

/** 상태 → 막대 색 묶음. 전달 실패 등록(FAILURE_REPORTED, 확정 전)도 실패 쪽 — 사람이 볼 일이다 */
export function kindOf(state: string | null | undefined): Kind {
  if (state === 'COMPLETED') return 'done';
  if (state === 'FAILED' || state === 'FAILURE_REPORTED') return 'failed';
  if (state === 'CANCELLED' || state === 'RETURNED_TO_STORE') return 'other';
  return 'active';
}

/** 사람이 봐야 하는 상태(지연은 약속 시각이 목록에 없어 셀 수 없다) */
export const PROBLEM_STATES: ReadonlySet<string> = new Set(['FAILURE_REPORTED', 'FAILED', 'SUSPENDED']);

export const KST = 9 * 3600_000;
const MIN = 60_000;
export const HOUR = 3600_000;
export const DAY = 86_400_000;
const RECENT_BIN = 10 * MIN;
const RECENT_BINS = 12;

export const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** 서울 0시 */
export const dayStart = (t: number) => Math.floor((t + KST) / DAY) * DAY - KST;
export const seoulDay = (t: number) => {
  const d = new Date(t + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
export const weekday = (t: number) => '일월화수목금토'[new Date(t + KST).getUTCDay()] ?? '';
export const hhmm = (t: number) => {
  const d = new Date(t + KST);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** 걸린 시간 — "45초", "12분", "1시간 5분" */
export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}초`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

export type ChartMode = 'recent' | 'day' | 'week';
export interface ChartView {
  readonly mode: ChartMode;
  readonly anchor: number;
}
export interface Frame {
  readonly mode: ChartMode;
  readonly from: number;
  readonly to: number;
  readonly step: number;
  readonly n: number;
  readonly labelEvery: number;
}

export function frame(v: ChartView, now: number): Frame {
  if (v.mode === 'recent') {
    const to = Math.floor((now + KST) / RECENT_BIN) * RECENT_BIN - KST + RECENT_BIN;
    return { mode: 'recent', from: to - RECENT_BIN * RECENT_BINS, to, step: RECENT_BIN, n: RECENT_BINS, labelEvery: 3 };
  }
  if (v.mode === 'day') {
    const from = dayStart(v.anchor);
    return { mode: 'day', from, to: from + DAY, step: HOUR, n: 24, labelEvery: 3 };
  }
  const to = dayStart(v.anchor) + DAY;
  return { mode: 'week', from: to - 7 * DAY, to, step: DAY, n: 7, labelEvery: 1 };
}

export interface Bin {
  readonly from: number;
  readonly to: number;
  readonly counts: Record<Kind, number>;
  total: number;
}

export function binCount(items: ReadonlyArray<{ readonly at: number; readonly kind: Kind }>, f: Frame): Bin[] {
  const bins: Bin[] = Array.from({ length: f.n }, (_, i) => ({ from: f.from + i * f.step, to: f.from + (i + 1) * f.step, counts: { done: 0, active: 0, failed: 0, other: 0 }, total: 0 }));
  for (const it of items) {
    if (it.at < f.from || it.at >= f.to) continue;
    const b = bins[Math.floor((it.at - f.from) / f.step)];
    if (!b) continue;
    b.counts[it.kind]++;
    b.total++;
  }
  return bins;
}

/** 처음 보는 틀 — 최근 2시간에 배송이 있으면 최근, 없으면 마지막 배송이 있던 날 하루 */
export function defaultView(starts: readonly number[], now: number): ChartView {
  if (starts.some((s) => s >= now - RECENT_BIN * RECENT_BINS && s <= now + RECENT_BIN)) return { mode: 'recent', anchor: now };
  if (!starts.length) return { mode: 'day', anchor: now };
  return { mode: 'day', anchor: Math.max(...starts) };
}

export function shift(v: ChartView, dir: -1 | 1): ChartView {
  if (v.mode === 'recent') return v;
  return { mode: v.mode, anchor: v.anchor + dir * (v.mode === 'day' ? 1 : 7) * DAY };
}

export function binLabel(mode: ChartMode, t: number): readonly [string, string?] {
  if (mode === 'recent') return [hhmm(t)];
  if (mode === 'day') return [`${new Date(t + KST).getUTCHours()}시`];
  return [seoulDay(t), weekday(t)];
}

export function binRange(mode: ChartMode, b: { readonly from: number; readonly to: number }): string {
  if (mode === 'week') return `${seoulDay(b.from)}(${weekday(b.from)}) 하루`;
  return `${mode === 'day' ? `${seoulDay(b.from)} ` : ''}${hhmm(b.from)} ~ ${hhmm(b.to)}`;
}

export function frameTitle(f: Frame, now: number): string {
  if (f.mode === 'recent') return `${hhmm(f.from)} ~ ${hhmm(f.to)}`;
  if (f.mode === 'day') return `${seoulDay(f.from)}(${weekday(f.from)})${dayStart(now) === f.from ? ' · 오늘' : ''}`;
  return `${seoulDay(f.from)} ~ ${seoulDay(f.to - DAY)}`;
}

/** 세로축 눈금 간격 1·2·5·10… */
export function niceStep(peak: number): number {
  const half = Math.max(1, peak / 2);
  for (let p = 1; p < 1e9; p *= 10) for (const m of [1, 2, 5]) if (m * p >= half) return m * p;
  return 1;
}

const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const gap = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? (b - a) / 1000 : null);

export interface Metrics {
  readonly total: number;
  readonly counts: Record<Kind, number>;
  readonly problems: number;
  /** 완료 / (완료 + 실패) — 끝난 것이 없으면 null */
  readonly rate: number | null;
  readonly avgTotalSec: number | null;
  readonly avgFindSec: number | null;
  /** 구간별 평균(완료 건 중 세 시각이 모두 있는 것만) */
  readonly phases: { readonly n: number; readonly segments: ReadonlyArray<{ readonly key: 'find' | 'store' | 'customer'; readonly sec: number }>; readonly totalSec: number } | null;
  /** 최근 12시간 1시간마다 배송이 생긴 수 */
  readonly hourly: readonly number[];
}

export function metrics(rows: readonly Summary[], now: number): Metrics {
  const counts: Record<Kind, number> = { done: 0, active: 0, failed: 0, other: 0 };
  let problems = 0;
  for (const r of rows) {
    counts[kindOf(r.state)]++;
    if (PROBLEM_STATES.has(r.state)) problems++;
  }
  const finished = counts.done + counts.failed;
  const done = rows.filter((r) => r.state === 'COMPLETED');
  const totals = done.map((r) => gap(ms(r.createdAt), ms(r.completedAt))).filter((x): x is number => x !== null);
  const finds = rows.map((r) => gap(ms(r.createdAt), ms(r.assignedAt))).filter((x): x is number => x !== null);
  const full = done
    .map((r) => [gap(ms(r.createdAt), ms(r.assignedAt)), gap(ms(r.assignedAt), ms(r.pickedUpAt)), gap(ms(r.pickedUpAt), ms(r.completedAt))] as const)
    .filter((x): x is readonly [number, number, number] => x.every((v) => v !== null));
  const phases = full.length
    ? {
        n: full.length,
        segments: [
          { key: 'find' as const, sec: avg(full.map((x) => x[0])) ?? 0 },
          { key: 'store' as const, sec: avg(full.map((x) => x[1])) ?? 0 },
          { key: 'customer' as const, sec: avg(full.map((x) => x[2])) ?? 0 },
        ],
        totalSec: avg(full.map((x) => x[0] + x[1] + x[2])) ?? 0,
      }
    : null;
  const hourly = Array.from({ length: 12 }, (_, i) => {
    const to = now - (11 - i) * HOUR;
    return rows.filter((r) => {
      const t = ms(r.createdAt);
      return t !== null && t > to - HOUR && t <= to;
    }).length;
  });
  return { total: rows.length, counts, problems, rate: finished ? counts.done / finished : null, avgTotalSec: avg(totals), avgFindSec: avg(finds), phases, hourly };
}

/** 라이더 띠 한 칸 — 맡은 때(없으면 생긴 때) ~ 끝(진행 중이면 지금) */
export interface Span {
  readonly row: Summary;
  readonly s: number;
  readonly e: number;
}

const MAX_LINES = 4;

/** 겹치는 표시는 아랫줄로(최대 4줄) — 시뮬레이터 pack 과 같다 */
export function pack(list: readonly Span[]): { readonly lines: number; readonly placed: ReadonlyArray<Span & { readonly line: number }> } {
  const ends: number[] = [];
  const placed = [...list]
    .sort((a, b) => a.s - b.s)
    .map((x) => {
      let line = ends.findIndex((end) => end <= x.s);
      if (line < 0) line = ends.length < MAX_LINES ? ends.length : MAX_LINES - 1;
      ends[line] = Math.max(ends[line] ?? 0, x.e);
      return { ...x, line };
    });
  return { lines: Math.max(1, ends.length), placed };
}

export function spanOf(r: Summary, now: number): Span | null {
  const created = ms(r.createdAt);
  if (created === null) return null;
  const start = ms(r.assignedAt) ?? created;
  const end = ms(r.completedAt) ?? (kindOf(r.state) === 'active' ? now : start);
  return { row: r, s: Math.min(start, end), e: Math.max(end, start) };
}
