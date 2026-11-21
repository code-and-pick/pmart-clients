// ComposedView 의 원천·기준시각·신선도·확인 등급·미제공 원천을 숨기지 않고 보여 준다.
// 화면(2026-11-18 사용자 "직관적이지 않다"): 다 최신이면 한 줄("기준 오후 3:16 · 모두 최신")로 줄이고 원천마다의 줄은 "출처 N곳"을 펼쳐 본다.
// 지연·확인 불가·못 읽은 원천은 접지 않고 노란·빨간 표시로 바로 보인다(서비스 이름은 한국어 업무 이름 + 원래 이름).
import type { components } from '../api/generated/backoffice-bff';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from './messages';

type SourceStamp = components['schemas']['SourceStamp'];

interface Props {
  readonly sources: readonly SourceStamp[];
  readonly unavailableSources?: readonly string[] | undefined;
}

/** 서비스 이름 → 업무 이름(모르면 원래 이름) */
export const systemName = (system: string): string => m.systemName[system] ?? system;

const line = (s: SourceStamp) => {
  const freshness = s.asOf.freshness;
  return `${s.system} · ${m.confidence[s.confidence]} · ${freshness ? m.freshness[freshness] : m.freshness.UNAVAILABLE}${s.asOf.asOf ? ` · ${formatSeoul(s.asOf.asOf)}` : ''}`;
};

export function SourceStamps({ sources, unavailableSources }: Props) {
  const late = sources.filter((s) => s.asOf.freshness !== 'CURRENT');
  const missing = unavailableSources ?? [];
  // 기준 시각은 가장 오래된 원천의 시각(그보다 새 것으로 보이지 않게)
  const oldest = sources
    .map((s) => s.asOf.asOf)
    .filter((t): t is string => Boolean(t))
    .sort()[0];
  return (
    <section aria-label={m.sources} className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
      {sources.length > 0 && (
        <span className="inline-flex items-center gap-1.5" data-testid="source-summary">
          <span className={`h-1.5 w-1.5 rounded-full ${late.length === 0 ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
          {oldest ? m.sourceSummary.asOf(formatSeoul(oldest)) : m.sourceSummary.noTime}
          {late.length === 0 && ` · ${m.sourceSummary.allCurrent}`}
        </span>
      )}
      {late.map((s) => (
        <span key={s.system} data-freshness={s.asOf.freshness ?? 'UNAVAILABLE'} className="badge badge-warning badge-soft badge-sm" title={line(s)}>
          {`${systemName(s.system)} ${s.asOf.freshness ? m.freshness[s.asOf.freshness] : m.freshness.UNAVAILABLE}`}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="badge badge-error badge-soft badge-sm" title={`${m.unavailableSources}: ${missing.join(', ')}`}>
          {`${m.sourceSummary.missing}: ${missing.map(systemName).join(', ')}`}
        </span>
      )}
      {sources.length > 0 && (
        // 펼칠 때 화면 오른쪽 밖으로 나가면 오른쪽 끝에 맞춰 연다(2026-11-21 점검 — 768px 처리 대기에서 목록 끝이 잘렸다). CSP 라 style 속성 대신 element.style
        <details
          className="group relative"
          onToggle={(e) => {
            const ul = e.currentTarget.querySelector('ul');
            if (!ul || !e.currentTarget.open) return;
            ul.style.left = '';
            ul.style.right = '';
            if (ul.getBoundingClientRect().right > window.innerWidth - 8) {
              ul.style.left = 'auto';
              ul.style.right = '0';
            }
          }}
        >
          <summary className="cursor-pointer list-none rounded px-1 underline decoration-dotted underline-offset-2 hover:text-base-content">{m.sourceSummary.detail(sources.length)}</summary>
          <ul className="absolute left-0 top-6 z-20 w-max max-w-[90vw] space-y-1 rounded-box border border-base-300 bg-base-100 p-3 text-xs text-base-content shadow-lg">
            {sources.map((s) => (
              <li key={s.system} data-freshness={s.asOf.freshness ?? 'UNAVAILABLE'}>
                <span className="font-medium">{systemName(s.system)}</span> <span className="text-base-content/60">{line(s)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
