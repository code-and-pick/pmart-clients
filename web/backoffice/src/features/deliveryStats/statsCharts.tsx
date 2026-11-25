// 배송 운영 통계 그림 부품(2026-11-25 사용자 "라이더 배송운영통계는 라이더 백오피스의 운영통계 화면 그대로 가져오고").
// 정본: web/rider-backoffice/src/features/stats/StatsPage.tsx 의 HeroCard·Ring·RateBar·TimeFlow·SourceBar·ReasonBars·DailyChart·StackBar·Legend·BigRate·RateCell.
// 값은 화면이 모은 서버 집계만 그린다 — 분모 0·못 읽음은 "—"(0% 로 보이지 않는다). 좋고 나쁨의 기준선은 정책에 없어 색 세기를 바꾸지 않는다.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { messages } from '../../shared/messages';

const s = messages.deliveryStats;

export const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 1000) / 10}%` : '—');

/** 초 → "N초"·"N분"·"N시간 M분", 없으면 "—" */
export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const x = Math.max(0, Math.round(sec));
  if (x < 60) return `${x}초`;
  const mi = Math.round(x / 60);
  if (mi < 60) return `${mi}분`;
  const h = Math.floor(mi / 60);
  return mi % 60 ? `${h}시간 ${mi % 60}분` : `${h}시간`;
}

/** 카드 — 제목 + 한 줄 설명 */
export function HeroCard({ title, sub, testId, children }: { readonly title: string; readonly sub: string; readonly testId: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5" aria-label={title} data-testid={testId}>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mb-4 text-xs text-base-content/60">{sub}</p>
      {children}
    </section>
  );
}

/** 큰 원(한 가지 대표 비율). 분모 0 이면 원은 비우고 "—" */
export function Ring({ num, den, label, hint, testId }: { readonly num: number; readonly den: number; readonly label: string; readonly hint: string; readonly testId: string }) {
  const p = den > 0 ? num / den : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex shrink-0 flex-col items-center" data-testid={testId}>
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-base-200)" strokeWidth="10" />
          {den > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-success)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-extrabold tabular-nums">{pct(num, den)}</span>
      </div>
      <span className="mt-1 text-sm font-semibold">{label}</span>
      <span className="text-xs text-base-content/60">{hint}</span>
    </div>
  );
}

const TONE: Record<'good' | 'warn' | 'bad' | 'neutral', string> = { good: 'bg-success', warn: 'bg-warning', bad: 'bg-error', neutral: 'bg-info' };

/** 비율 한 줄 — 이름 · 값(오른쪽) · 막대 · 건수. 분모 0·못 읽음은 막대 없이 사유 */
export function RateBar({ label, num, den, hint, tone, unavailable = false, to, testId }: { readonly label: string; readonly num: number; readonly den: number; readonly hint: string; readonly tone: keyof typeof TONE; readonly unavailable?: boolean; readonly to?: string; readonly testId: string }) {
  const empty = unavailable || den <= 0;
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        {to ? (
          <Link to={to} className="text-sm text-base-content/80 hover:text-primary" data-testid={`${testId}-link`}>
            {label} ›
          </Link>
        ) : (
          <span className="text-sm text-base-content/80">{label}</span>
        )}
        <span className="text-lg font-bold tabular-nums">{empty ? '—' : pct(num, den)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
        {!empty && <div className={`h-full rounded-full ${TONE[tone]}`} style={{ width: `${Math.min(100, (num / den) * 100)}%` }} />}
      </div>
      <span className="text-xs text-base-content/60">{hint}</span>
    </div>
  );
}

/** 걸린 시간 — 세 구간을 이은 한 줄(길이 = 평균 시간 비율) + 구간별 값. 값이 없는 구간은 줄에서 빼고 "—" */
export function TimeFlow({ legs }: { readonly legs: ReadonlyArray<{ readonly key: string; readonly label: string; readonly sec: number | null; readonly n: number | null; readonly color: string; readonly testId: string }> }) {
  const known = legs.filter((l) => l.sec !== null && l.sec > 0);
  const sum = known.reduce((x, l) => x + (l.sec ?? 0), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-base-content/70">{s.totalTime}</span>
        <span className="text-3xl font-extrabold tabular-nums" data-testid="tile-total-time">
          {sum > 0 ? dur(sum) : '—'}
        </span>
      </div>
      <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-base-200" role="img" aria-label={legs.map((l) => `${l.label} ${dur(l.sec)}`).join(', ')}>
        {known.map((l) => (
          <span key={l.key} style={{ flexGrow: l.sec ?? 0, backgroundColor: l.color }} />
        ))}
      </div>
      <ol className="mt-4 space-y-2.5">
        {legs.map((l) => (
          <li key={l.key} className="flex items-center gap-2 text-sm" data-testid={l.testId}>
            <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden="true" />
            <span className="flex-1 text-base-content/80">{l.label}</span>
            <span className="text-xs text-base-content/50">{l.n === null ? s.hint.failed : s.hint.count(l.n)}</span>
            <b className="w-14 text-right tabular-nums">{dur(l.sec)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 배정 출처 — 한 줄 쌓은 막대 + 범례(이름·건수·비율) */
export function SourceBar({ parts }: { readonly parts: ReadonlyArray<{ readonly label: string; readonly n: number; readonly color: string }> }) {
  const sum = parts.reduce((x, p) => x + p.n, 0);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-base-200" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}건`).join(', ')}>
        {sum > 0 && parts.filter((p) => p.n > 0).map((p) => <span key={p.label} style={{ flexGrow: p.n, backgroundColor: p.color }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="flex items-center gap-1.5 text-base-content/70">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
              {p.label}
            </span>
            <b className="text-lg tabular-nums">{p.n}</b>
            <span className="ml-1 text-xs text-base-content/50">{pct(p.n, sum)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 배차 실패 사유 — 많은 순 가로 막대(길이 = 가장 많은 사유 기준) */
export function ReasonBars({ items }: { readonly items: ReadonlyArray<{ readonly label: string; readonly n: number }> }) {
  if (items.length === 0) return <p className="text-sm text-base-content/60">{s.noFailures}</p>;
  const sorted = [...items].sort((x, y) => y.n - x.n);
  const max = Math.max(1, ...sorted.map((x) => x.n));
  return (
    <ul className="space-y-2.5" data-testid="stats-failure-reasons">
      {sorted.map((x) => (
        <li key={x.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-base-content/80">{x.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
            <span className="block h-full rounded-full bg-base-content/45" style={{ width: `${(x.n / max) * 100}%` }} />
          </span>
          <b className="text-right tabular-nums">{x.n}</b>
        </li>
      ))}
    </ul>
  );
}

/** 날짜별 완료·실패 막대(왼쪽이 오래된 날). 높이는 그 기간에서 가장 많은 날 기준. 날이 많으면 날짜 글자는 5일마다 */
export function DailyChart({ points }: { readonly points: ReadonlyArray<{ readonly d: string; readonly done: number; readonly failed: number }> }) {
  const max = Math.max(1, ...points.map((p) => p.done + p.failed));
  const sparse = points.length > 10;
  return (
    <div className="mb-4" data-testid="stats-daily-chart">
      <Legend parts={[[s.legendDone, 'bg-success'], [s.legendFailed, 'bg-error']]} />
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`${s.dailyChart(points.length)}: ${points.map((p) => `${p.d} 완료 ${p.done} 실패 ${p.failed}`).join(', ')}`}>
        {points.map((p, i) => {
          const sum = p.done + p.failed;
          return (
            <div key={p.d} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs font-semibold tabular-nums">{sum}</span>
              <div className="flex w-full max-w-10 flex-col overflow-hidden rounded-t" style={{ height: `${(sum / max) * 100}%`, minHeight: sum > 0 ? 3 : 0 }}>
                <div className="bg-error/85" style={{ flexGrow: p.failed }} />
                <div className="bg-success/85" style={{ flexGrow: p.done }} />
              </div>
              <span className="h-4 text-[11px] text-base-content/60">{!sparse || i % 5 === 0 || i === points.length - 1 ? p.d.slice(5) : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 한 줄 쌓인 막대 — 전체 길이 = 이 줄의 합(가장 큰 줄 기준), 칸마다 색, 아래 작은 글로 실제 수 */
export function StackBar({ parts, max, text, warn = false }: { readonly parts: ReadonlyArray<readonly [number, string]>; readonly max: number; readonly text: string; readonly warn?: boolean }) {
  const sum = parts.reduce((t, [v]) => t + v, 0);
  return (
    <div className="min-w-40 space-y-1" data-testid="stack-bar">
      <div className="flex h-2.5 gap-[2px]" style={{ width: `${Math.max(4, (sum / max) * 100)}%` }} aria-hidden="true">
        {parts
          .filter(([v]) => v > 0)
          .map(([v, cls], i) => (
            <span key={i} className={`h-full rounded-[3px] ${cls}`} style={{ flexGrow: v, flexBasis: 0 }} />
          ))}
      </div>
      <p className={`text-xs tabular-nums ${warn ? 'font-semibold text-warning' : 'text-base-content/70'}`}>{text}</p>
    </div>
  );
}

/** 범례 — 표 위 한 줄(색 점 + 이름) */
export function Legend({ parts }: { readonly parts: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-base-content/70" data-testid="stats-legend">
      {parts.map(([name, cls]) => (
        <span key={name} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-[3px] ${cls}`} aria-hidden="true" />
          {name}
        </span>
      ))}
    </div>
  );
}

/** 완료율 크게 — 분모 0 이면 "—" */
export function BigRate({ num, den }: { readonly num: number; readonly den: number }) {
  if (den <= 0) return <span className="text-base-content/40">—</span>;
  return (
    <span className="text-lg font-bold tabular-nums" data-testid="rate-done">
      {pct(num, den)}
    </span>
  );
}

/** 비율 칸 — 숫자 옆 작은 막대. 완료율은 초록, 지연율은 주황. 분모 0 이면 "—" */
export function RateCell({ num, den, kind }: { readonly num: number; readonly den: number; readonly kind: 'done' | 'late' }) {
  if (den <= 0) return <span className="text-base-content/40">—</span>;
  const w = Math.min(100, Math.round((num / den) * 100));
  return (
    <span className="inline-flex min-w-28 items-center gap-2" data-testid={`rate-${kind}`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
        <span className={`block h-full rounded-full ${kind === 'done' ? 'bg-success' : 'bg-warning'}`} style={{ width: `${w}%` }} />
      </span>
      <span className="tabular-nums">{pct(num, den)}</span>
    </span>
  );
}
