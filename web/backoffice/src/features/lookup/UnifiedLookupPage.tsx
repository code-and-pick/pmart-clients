// 통합 조회(BO-11) — bff 0.3.0 `GET /backoffice/views/unified-lookup?q=&kind=`(백엔드 요청 backoffice/2026-11-16-request-unified-lookup, PR #25).
// - OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정). 찾는 값·종류는 URL 쿼리(q·kind) — 다시 열어도 같은 조회.
// - 응답은 ComposedView(원천별 기준 시각·신선도·실패 원천) + resolved{kind, orderId} + matches[{kind, id, summary, source}].
//   원천마다 칸을 나눠 보이고 상태를 하나로 합치지 않는다. 실패·권한 없음 원천은 그 칸에 "조회 실패"로 — 0건처럼 보이지 않게.
// - summary 는 원천 필드 이름 그대로(개인정보 없음) — 아는 이름만 한국어로, 모르는 이름은 그대로. 금액·상태를 화면에서 계산하지 않는다.
// - 고객 번호로 찾으면 주문 목록만 → 누르면 그 주문으로 다시 조회. 각 항목에서 기존 상세로(주문·배송·클레임·사건).
// - 422 UNSUPPORTED_LOOKUP(TRANSFER·TRIP·모르는 접두어)은 코드 문구로.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { FailureAlert, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/backoffice-bff';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { label, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';

const m = messages.lookup;

type SourceStamp = components['schemas']['SourceStamp'];
type Kind = 'ANY' | 'ORDER' | 'DELIVERY' | 'CASE' | 'CUSTOMER';
const KINDS: readonly Kind[] = ['ANY', 'ORDER', 'DELIVERY', 'CASE', 'CUSTOMER'];
const isKind = (v: string | null): v is Kind => !!v && (KINDS as readonly string[]).includes(v);

interface Match {
  readonly kind?: string;
  readonly id?: string;
  readonly summary?: Record<string, unknown>;
  readonly source?: SourceStamp;
}

/**
 * 원천 칸 → 그 원천 이름(SourceStamp.system).
 * 계약 unified-lookup 설명에 적힌 목록(PR #25 985a2ecd — 질문 handoff 답 2026-11-16).
 */
const SECTION_SYSTEM: Readonly<Record<string, string>> = {
  ORDER: 'order-service',
  DELIVERY: 'delivery-execution-service',
  DISPATCH: 'delivery-dispatch-service',
  CLAIM: 'claim-service',
  CASE: 'case-service',
  // 고객 문의는 사건과 같은 서비스지만 원천 이름이 따로(RIDER_OPS 는 권한 없음으로 여기에 온다 — 백엔드 알림 2026-11-16)
  INQUIRY: 'case-service/inquiries',
};
const SECTIONS = ['DELIVERY', 'DISPATCH', 'CLAIM', 'INQUIRY'] as const;

/** 각 항목의 기존 상세 화면 */
const detailPath = (kind: string | undefined, id: string) =>
  kind === 'ORDER'
    ? `/orders/${encodeURIComponent(id)}`
    : kind === 'DELIVERY' || kind === 'DISPATCH'
      ? `/deliveries/${encodeURIComponent(id)}`
      : kind === 'CLAIM'
        ? `/claims/${encodeURIComponent(id)}`
        : kind === 'CASE'
          ? `/cases/${encodeURIComponent(id)}`
          : kind === 'INQUIRY'
            ? `/inquiries/${encodeURIComponent(id)}`
            : null;

/** 값 하나 표시 — 시각(…At)은 서울 시각, 참거짓은 예/아니요, 객체는 한 단계 펼친다(계산하지 않음) */
function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return messages.none;
  if (typeof v === 'boolean') return v ? m.yes : m.no;
  if (typeof v === 'string' && /At$/.test(key)) return when(v);
  if (Array.isArray(v)) {
    const items = v as unknown[];
    return items.length ? items.map((x) => show('', x)).join(', ') : messages.none;
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${m.field[k] ?? k} ${show(k, x)}`)
      .join(' · ');
  }
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v);
}

function SummaryFacts({ summary, skip }: { readonly summary: Record<string, unknown> | undefined; readonly skip?: readonly string[] }) {
  const entries = Object.entries(summary ?? {}).filter(([k]) => !skip?.includes(k));
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{m.field[k] ?? k}</dt>
          <dd className="break-all">{show(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SourceLine({ source }: { readonly source: SourceStamp | undefined }) {
  if (!source) return null;
  return <p className="text-xs opacity-70">{`${source.system} · ${source.asOf.asOf ? when(source.asOf.asOf) : messages.none}`}</p>;
}

function Section({ title, failed, children }: { readonly title: string; readonly failed: boolean; readonly children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-box bg-base-100 p-4" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {failed ? (
        <p role="alert" className="alert alert-warning text-sm" data-state="source-failed">
          {m.sourceFailed}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

export function UnifiedLookupPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const rawKind = params.get('kind');
  const kind: Kind = isKind(rawKind) ? rawKind : 'ANY';
  const [input, setInput] = useState(q);
  const [kindInput, setKindInput] = useState<Kind>(kind);
  const go = (nextQ: string, nextKind: Kind) => {
    setInput(nextQ);
    setKindInput(nextKind);
    setParams(nextQ ? { q: nextQ, ...(nextKind === 'ANY' ? {} : { kind: nextKind }) } : {});
  };
  const query = useQuery({
    queryKey: ['bff', 'unified-lookup', q, kind],
    enabled: !!q,
    queryFn: () => request('GET', api.bff.GET('/views/unified-lookup', { params: { query: { q, ...(kind === 'ANY' ? {} : { kind }) } } })),
  });
  // 422(못 찾는 종류)·400 은 코드 문구로 — 그 밖 실패는 QueryState(오류·권한 없음)
  const codeFailure = query.error instanceof ProblemFailure && (query.error.problem.code === 'UNSUPPORTED_LOOKUP' || query.error.problem.code === 'VALIDATION_FAILED') ? query.error : null;

  return (
    <section className="max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">{m.title}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <form
        className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm"
        aria-label={m.search}
        onSubmit={(e) => {
          e.preventDefault();
          go(input.trim(), kindInput);
        }}
      >
        <label className="flex flex-col gap-1">
          {m.q}
          <input className="input input-sm w-64 font-mono" maxLength={128} value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.kind}
          <select className="select select-sm w-36" value={kindInput} onChange={(e) => setKindInput(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {m.kindName[k]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!input.trim()}>
          {m.search}
        </button>
        <p className="w-full text-xs opacity-70">{m.qHint}</p>
      </form>
      {q &&
        (codeFailure ? (
          <FailureAlert failure={codeFailure} />
        ) : (
          <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
            {(view) => <LookupResult view={view} onOpenOrder={(orderId) => go(orderId, 'ORDER')} />}
          </QueryState>
        ))}
      <p className="text-xs opacity-70">{m.piiNote}</p>
      <p className="text-xs opacity-70">{m.notYet}</p>
    </section>
  );
}

type LookupView = components['schemas']['ComposedView'] & {
  readonly matches?: readonly Match[];
  readonly resolved?: { readonly kind?: string; readonly orderId?: string | null };
};

function LookupResult({ view, onOpenOrder }: { readonly view: LookupView; readonly onOpenOrder: (orderId: string) => void }) {
  const matches = view.matches ?? [];
  const failed = new Set(view.unavailableSources ?? []);
  const of = (k: string) => matches.filter((x) => x.kind === k);
  const resolvedKind = view.resolved?.kind;
  const orderFailed = failed.has(SECTION_SYSTEM.ORDER!);
  return (
    <div className="space-y-3">
      <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
      {resolvedKind && <p className="text-sm">{m.resolved(label(m.kindName, resolvedKind), view.resolved?.orderId ?? null)}</p>}
      {matches.length === 0 && failed.size === 0 ? (
        <p data-state="empty" className="p-4 opacity-70">
          {m.notFound}
        </p>
      ) : resolvedKind === 'CUSTOMER' ? (
        <Section title={m.customerOrders} failed={orderFailed}>
          {of('ORDER').length === 0 ? (
            <p className="opacity-70">{m.none}</p>
          ) : (
            <ul className="space-y-2">
              {of('ORDER').map((o) => (
                <li key={o.id} data-testid="customer-order" className="space-y-1 border-b border-base-200 pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{o.id}</span>
                    <button type="button" className="btn btn-xs" onClick={() => onOpenOrder(o.id ?? '')}>
                      {m.openOrder}
                    </button>
                  </div>
                  <SummaryFacts summary={o.summary} skip={['orderId']} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <>
          <Section title={m.section.ORDER!} failed={orderFailed}>
            {of('ORDER').length === 0 ? <p className="opacity-70">{m.none}</p> : of('ORDER').map((o) => <MatchCard key={`ORDER-${o.id}`} match={o} />)}
          </Section>
          <div className="grid gap-3 md:grid-cols-2">
            {SECTIONS.map((s) => (
              <Section key={s} title={m.section[s]!} failed={failed.has(SECTION_SYSTEM[s]!)}>
                {of(s).length === 0 ? <p className="opacity-70">{m.none}</p> : of(s).map((x) => <MatchCard key={`${s}-${x.id}`} match={x} />)}
              </Section>
            ))}
          </div>
          {/* 사건은 열린 것과 닫힌 것(최근 20건)을 나눠 — 상태로만 가른다 */}
          <Section title={m.section.CASE!} failed={failed.has(SECTION_SYSTEM.CASE!)}>
            {(['open', 'closed'] as const).map((part) => {
              const list = of('CASE').filter((c) => (c.summary?.state === 'CLOSED') === (part === 'closed'));
              return (
                <div key={part} className="space-y-2" data-testid={`cases-${part}`}>
                  <h3 className="text-sm font-semibold">{m.caseParts[part]}</h3>
                  {list.length === 0 ? <p className="opacity-70">{m.none}</p> : list.map((x) => <MatchCard key={`CASE-${x.id}`} match={x} />)}
                </div>
              );
            })}
          </Section>
        </>
      )}
    </div>
  );
}

function MatchCard({ match }: { readonly match: Match }) {
  const path = match.id ? detailPath(match.kind, match.id) : null;
  return (
    <div className="space-y-1" data-testid={`match-${match.kind ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{match.id}</span>
        {path && (
          <Link className="link text-sm" to={path}>
            {m.detail}
          </Link>
        )}
      </div>
      <SummaryFacts summary={match.summary} />
      <SourceLine source={match.source} />
    </div>
  );
}
