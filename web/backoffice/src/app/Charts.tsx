// 대시보드 그림 부품(2026-11-20 사용자 "통계 쪽 지표 보여주는 게 구리다"). 새 라이브러리 없이 div·SVG 로만.
// 그림 기준(dataviz): 얇은 막대(최대 24px, 끝 4px 둥글게·바닥은 각지게), 실선 머리카락 눈금, 값은 골라서만(오늘·최고), 나머지는 눈금·도움말(마우스·키보드)로.
// 색은 index.css 의 --pm-chart-* 토큰(밝은·어두운 화면 따로 고름, 색맹 검사 통과). 글자는 데이터 색을 쓰지 않는다.
// 못 읽은 값(null)은 0 으로 그리지 않는다 — 막대는 점선 빈칸, 추세선은 끊는다.
import { useId, type ReactNode } from 'react';

/** 눈금 위 끝 — 깔끔한 수(1·2·2.5·5 × 10ⁿ)로 올림 */
export function niceMax(max: number): number {
  if (max <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= max) return s * p;
  return 10 * p;
}

/** 눈금 글자 — 1만 넘으면 "만"으로 줄인다(한 축 한 방식) */
export function tickText(v: number, big: boolean): string {
  if (!big) return v.toLocaleString('ko-KR');
  return v === 0 ? '0' : `${(v / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만`;
}

export interface Column {
  readonly key: string;
  /** 아래 이름(예 11.18·오늘) */
  readonly label: string;
  /** null = 못 읽음(점선 빈칸) */
  readonly value: number | null;
  /** 막대 위에 보일 글자(골라서만 — 없으면 안 보임). 못 읽었으면 "?" 를 넘긴다 */
  readonly cap?: string | undefined;
  /** 도움말 줄(값 먼저, 이름 다음) */
  readonly tip: ReadonlyArray<readonly [ReactNode, string]>;
  readonly loading?: boolean;
  readonly strong?: boolean;
  /** 도움말 머리(없으면 아래 이름) — 예 2026-11-20 */
  readonly title?: string;
}

/** 세로 막대(하나의 계열) — 강조할 막대(오늘)만 진한 색, 나머지는 같은 색 옅게 */
export function ColumnChart({ columns, big = false, testIdCol, label, avg }: { readonly columns: readonly Column[]; readonly big?: boolean; readonly testIdCol?: string; readonly label: string; readonly avg?: { readonly value: number; readonly text: string } | null }) {
  const top = niceMax(Math.max(0, avg?.value ?? 0, ...columns.map((c) => c.value ?? 0)));
  const ticks = [top, top / 2, 0];
  return (
    <div className="relative pl-10" role="group" aria-label={label}>
      {/* 눈금(실선 머리카락) */}
      <div className="pointer-events-none absolute inset-x-0 top-5 bottom-7" aria-hidden="true">
        {ticks.map((t, i) => (
          <div key={t} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${(i / (ticks.length - 1)) * 100}%`, transform: 'translateY(-50%)' }}>
            <span className="w-8 text-right text-[11px] tabular-nums text-base-content/45">{tickText(t, big)}</span>
            <span className={`h-px flex-1 ${t === 0 ? 'bg-base-content/25' : 'bg-base-300/70'}`} />
          </div>
        ))}
        {/* 기준선(평균) — 눈금과 헷갈리지 않게 점선 + 이름표 */}
        {avg && avg.value > 0 && (
          <div className="absolute right-0 left-10 z-10 border-t border-dashed border-base-content/45" style={{ top: `${(1 - avg.value / top) * 100}%` }} data-testid="chart-avg">
            <span className="absolute -top-2.5 left-0 rounded bg-base-100 px-1 text-[11px] font-medium text-base-content/65">{avg.text}</span>
          </div>
        )}
      </div>
      <div className="relative flex h-52 items-stretch">
        {columns.map((c) => {
          const h = c.value === null ? 0 : (c.value / top) * 100;
          return (
            <div key={c.key} className="group relative flex flex-1 flex-col items-center outline-none" tabIndex={0} data-testid={testIdCol} aria-label={`${c.label} ${c.tip.map(([v, n]) => `${n} ${typeof v === 'string' || typeof v === 'number' ? v : ''}`).join(', ')}`}>
              {/* 막대 칸: 위 글자 자리(20px) + 그림 + 아래 이름 자리(28px) */}
              <div className="relative mt-5 mb-7 flex w-full flex-1 items-end justify-center rounded-md group-hover:bg-base-200/60 group-focus-visible:bg-base-200/60">
                {c.value === null ? (
                  <div className="h-full w-6 rounded-t border border-dashed border-base-content/20" aria-hidden="true" />
                ) : (
                  <div
                    className="w-6 rounded-t transition-[height] duration-300"
                    style={{ height: `${Math.max(c.value > 0 ? 3 : 0, h)}%`, background: c.strong ? 'var(--pm-chart-1)' : 'var(--pm-chart-1-soft)' }}
                    aria-hidden="true"
                  />
                )}
                {c.cap && (
                  <span className="absolute text-xs font-semibold text-base-content/80" style={{ bottom: `calc(${c.value === null ? 50 : Math.max(0, h)}% + 4px)` }}>
                    {c.cap}
                  </span>
                )}
              </div>
              <span className={`absolute bottom-1 text-[11px] ${c.strong ? 'font-semibold text-base-content' : 'text-base-content/55'}`}>{c.label}</span>
              {/* 도움말(마우스·키보드) — 값은 진하게, 이름은 옅게 */}
              <div className="pointer-events-none invisible absolute bottom-[calc(100%-1rem)] left-1/2 z-20 min-w-36 -translate-x-1/2 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-lg group-hover:visible group-focus-visible:visible" role="tooltip">
                <p className="mb-1 text-base-content/55">{c.title ?? c.label}</p>
                {c.tip.map(([v, n]) => (
                  <p key={n} className="flex items-center justify-between gap-4">
                    <span className="text-base-content/60">{n}</span>
                    <span className="font-semibold tabular-nums">{c.loading ? '…' : v}</span>
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 작은 추세선 — 못 읽은 날(null)에서 끊는다. 마지막 점만 찍는다. 0~1 비율이면 max=1 */
export function TrendLine({ values, max, testId, className = 'h-10 w-28' }: { readonly values: ReadonlyArray<number | null>; readonly max?: number; readonly testId?: string; readonly className?: string }) {
  const id = useId();
  if (values.length < 2 || values.every((v) => v === null)) return null;
  const hi = max ?? Math.max(1, ...values.map((v) => v ?? 0));
  const W = 100;
  const H = 32;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 3 - (v / hi) * (H - 8);
  // 끊긴 조각들
  const runs: Array<Array<[number, number]>> = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const prev = values[i - 1];
    if (i === 0 || prev === null || prev === undefined) runs.push([]);
    runs.at(-1)!.push([x(i), y(v)]);
  });
  const lastI = values.findLastIndex((v) => v !== null);
  const last = values[lastI]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`shrink-0 overflow-visible ${className}`} preserveAspectRatio="none" aria-hidden="true" data-testid={testId}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--pm-chart-1)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--pm-chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {runs.map((r, k) =>
        r.length > 1 ? (
          <g key={k}>
            <polygon points={`${r[0]![0]},${H} ${r.map((p) => p.join(',')).join(' ')} ${r.at(-1)![0]},${H}`} fill={`url(#${id})`} />
            <polyline points={r.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--pm-chart-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ) : null,
      )}
      {/* 끝점(둥근 점 — 비율이 늘어나도 동그랗게 보이도록 HTML 위가 아니라 작은 원 두 겹) */}
      <circle cx={x(lastI)} cy={y(last)} r={3.2} fill="var(--color-base-100)" vectorEffect="non-scaling-stroke" />
      <circle cx={x(lastI)} cy={y(last)} r={2.2} fill="var(--pm-chart-1)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 앞 기간 대비 증감 — 방향 × 좋은 쪽(올라가면 좋음/나쁨)으로 색, 화살표와 글자 함께(색만으로 알리지 않음) */
export function Delta({ text, dir, upIsGood = true, testId }: { readonly text: string; readonly dir: -1 | 0 | 1; readonly upIsGood?: boolean; readonly testId?: string }) {
  const good = dir === 0 ? null : (dir > 0) === upIsGood;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good === null ? 'text-base-content/55' : good ? 'text-success' : 'text-error'}`} data-testid={testId}>
      <span aria-hidden="true">{dir > 0 ? '▲' : dir < 0 ? '▼' : '–'}</span>
      {text}
    </span>
  );
}

export interface Part {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly fill: string;
  /** 칸 안 글자색(흰색 또는 거의 검정 — 채움 밝기에 따라) */
  readonly ink: string;
}

/** 한 덩어리를 나눈 막대 — 높이 28px, 칸마다 4px 둥글게·2px 틈, 넓은 칸에만 몫(%)을 안에 적는다. 범례는 부르는 쪽 */
export function SegmentBar({ parts, label, thin = false }: { readonly parts: readonly Part[]; readonly label: string; readonly thin?: boolean }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className={`flex w-full gap-[2px] ${thin ? 'h-2' : 'h-7'}`} role="img" aria-label={`${label}: ${parts.filter((p) => p.value > 0).map((p) => `${p.label} ${p.value} (${Math.round((p.value / total) * 100)}%)`).join(', ')}`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => {
          const share = p.value / total;
          return (
            <div
              key={p.key}
              className={`flex min-w-[3px] items-center overflow-visible px-2 text-xs font-semibold ${thin ? 'rounded-full' : 'rounded'}`}
              style={{ flexGrow: p.value, flexBasis: 0, background: p.fill, color: p.ink }}
              title={`${p.label} ${p.value.toLocaleString('ko-KR')} · ${Math.round(share * 100)}%`}
            >
              {!thin && share >= 0.12 ? `${Math.round(share * 100)}%` : ''}
            </div>
          );
        })}
    </div>
  );
}

// ───────────────────────── 통계 화면 공통(2026-11-20 사용자 "그래프·통계가 있는 곳은 맞춰라, 더 고급스럽게") ─────────────────────────

/** 숫자 줄 — 숫자 칸들을 한 상자에(칸 사이 머리카락 선). 숫자 카드 여러 장을 띄워 놓지 않는다 */
export function KpiStrip({ children, cols = 3, testId }: { readonly children: ReactNode; readonly cols?: 2 | 3 | 4; readonly testId?: string }) {
  const grid = cols === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <div className={`pm-kpi-strip grid overflow-hidden rounded-box border border-base-300 bg-base-100 ${grid}`} data-testid={testId}>
      {children}
    </div>
  );
}

/** 숫자 칸 — 이름 / 큰 숫자(+단위) / 증감·설명 / (오른쪽) 추세. tone=danger 면 숫자 빨강 + 위 띠 */
export function KpiCell({ label, value, unit, hero = false, tone, delta, sub, trend, testId, children }: {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string | undefined;
  readonly hero?: boolean;
  readonly tone?: 'danger' | 'warning' | 'muted' | undefined;
  readonly delta?: ReactNode;
  readonly sub?: ReactNode;
  readonly trend?: ReactNode;
  readonly testId?: string;
  readonly children?: ReactNode;
}) {
  const color = tone === 'danger' ? 'text-error' : tone === 'warning' ? 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]' : tone === 'muted' ? 'text-base-content/45' : '';
  return (
    <div className="pm-kpi relative min-w-0 px-5 py-4" data-testid={testId}>
      {tone === 'danger' && <span className="absolute inset-x-0 top-0 h-0.5 bg-error" aria-hidden="true" />}
      <p className="truncate text-sm text-base-content/70">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className={`min-w-0 truncate font-semibold leading-tight tracking-tight ${hero ? 'text-[34px]' : 'text-[28px]'} ${color}`}>
          {value}
          {unit && <span className="ml-1 text-base font-medium text-base-content/55">{unit}</span>}
        </div>
        {trend}
      </div>
      {(delta || sub) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-base-content/55">
          {delta}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** 몫 막대(0~1) — 채움 = 값, 바탕 = 같은 색 옅게. tone 으로 위험(빨강)·주의 표시. 값이 없으면(null) 빈 바탕만 */
export function Meter({ value, tone = 'neutral', className = 'w-full max-w-56' }: { readonly value: number | null; readonly tone?: 'neutral' | 'danger' | 'warning' | 'good'; readonly className?: string }) {
  const fill = tone === 'danger' ? 'var(--color-error)' : tone === 'warning' ? 'var(--color-warning)' : tone === 'good' ? 'var(--color-success)' : 'var(--pm-chart-1)';
  return (
    <span className={`mt-1.5 block h-1.5 overflow-hidden rounded-full ${className}`} style={{ background: `color-mix(in oklab, ${fill} 16%, var(--color-base-200))` }} aria-hidden="true">
      {value !== null && value > 0 && <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, value * 100))}%`, background: fill }} />}
    </span>
  );
}

/** 한 줄 요약 — 서버 숫자에서 바로 읽히는 사실만(가장 많은 날·가장 낮은 종류 등). 지어낸 해석·목표는 넣지 않는다 */
export function Insight({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-base-content/75" data-testid={testId}>
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-current text-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M14 7h7v7" />
      </svg>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export interface LinePoint {
  readonly key: string;
  readonly label: string;
  /** 0~1 비율, null = 판정할 건이 없음(선을 끊는다) */
  readonly value: number | null;
  readonly tip: ReadonlyArray<readonly [ReactNode, string]>;
  readonly title?: string;
}

/** 비율 추이(0~100%) — 2px 선 + 옅은 바닥 + 점, 값 없는 날은 끊고 아래에 "—". 기준선(기간 합 비율) 점선. 마우스·키보드로 그날 숫자 */
export function LineChart({ points, label, avg, testId, testIdPoint, height = 'h-44' }: { readonly points: readonly LinePoint[]; readonly label: string; readonly avg?: { readonly value: number; readonly text: string } | null; readonly testId?: string; readonly testIdPoint?: string; readonly height?: string }) {
  const n = points.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => (1 - v) * 100;
  const runs: Array<Array<[number, number]>> = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const prev = points[i - 1];
    if (i === 0 || !prev || prev.value === null) runs.push([]);
    runs.at(-1)!.push([x(i), y(p.value)]);
  });
  const lastI = points.findLastIndex((p) => p.value !== null);
  return (
    <div className="relative pt-6 pl-10" role="group" aria-label={label} data-testid={testId}>
      <div className={`relative ${height}`}>
        {/* 눈금 100·50·0% */}
        {[1, 0.5, 0].map((t) => (
          <div key={t} className="pointer-events-none absolute -left-10 right-0 flex items-center gap-2" style={{ top: `${y(t)}%`, transform: 'translateY(-50%)' }} aria-hidden="true">
            <span className="w-8 text-right text-[11px] tabular-nums text-base-content/45">{`${t * 100}%`}</span>
            <span className={`h-px flex-1 ${t === 0 ? 'bg-base-content/25' : 'bg-base-300/70'}`} />
          </div>
        ))}
        {avg && (
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-base-content/45" style={{ top: `${y(avg.value)}%` }}>
            <span className="absolute -top-2.5 left-0 rounded bg-base-100 px-1 text-[11px] font-medium text-base-content/65">{avg.text}</span>
          </div>
        )}
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {runs.map((r, k) => (
            <g key={k}>
              {r.length > 1 && <polygon points={`${r[0]![0]},100 ${r.map((p) => p.join(',')).join(' ')} ${r.at(-1)![0]},100`} fill="var(--pm-chart-1)" fillOpacity={0.08} />}
              {r.length > 1 && <polyline points={r.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--pm-chart-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
            </g>
          ))}
        </svg>
        {/* 점·누를 자리(날마다 한 칸 — 점보다 넓게) */}
        <div className="absolute inset-0 flex">
          {points.map((p, i) => (
            <div key={p.key} className="group relative flex-1 outline-none" tabIndex={0} data-testid={testIdPoint} aria-label={`${p.title ?? p.label} ${p.tip.map(([v, nm]) => `${nm} ${typeof v === 'string' ? v : ''}`).join(', ')}`}>
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-base-content/20 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
              {p.value !== null ? (
                <span
                  className={`absolute left-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-100 ${i === lastI ? 'h-3 w-3' : 'h-2.5 w-2.5'}`}
                  style={{ top: `${y(p.value)}%`, background: 'var(--pm-chart-1)' }}
                  aria-hidden="true"
                />
              ) : (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-base-content/45" aria-hidden="true">
                  —
                </span>
              )}
              {i === lastI && p.value !== null && (
                <span className="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-base-content" style={{ top: `calc(${y(p.value)}% - 22px)` }}>{`${Math.round(p.value * 100)}%`}</span>
              )}
              <div className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1 min-w-36 -translate-x-1/2 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-lg group-hover:visible group-focus-visible:visible" role="tooltip">
                <p className="mb-1 text-base-content/55">{p.title ?? p.label}</p>
                {p.tip.map(([v, nm]) => (
                  <p key={nm} className="flex items-center justify-between gap-4">
                    <span className="text-base-content/60">{nm}</span>
                    <span className="font-semibold tabular-nums">{v}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex">
        {points.map((p, i) => (
          <span key={p.key} className={`flex-1 text-center text-[11px] ${i === n - 1 ? 'font-semibold text-base-content' : 'text-base-content/55'}`}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
