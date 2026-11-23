// 통합 조회(BO-11) — bff 0.3.0 `GET /backoffice/views/unified-lookup?q=&kind=`(백엔드 요청 backoffice/2026-11-16-request-unified-lookup, PR #25).
// - OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정). 찾는 값·종류는 URL 쿼리(q·kind) — 다시 열어도 같은 조회.
// - 응답은 ComposedView(원천별 기준 시각·신선도·실패 원천) + resolved{kind, orderId} + matches[{kind, id, summary, source}].
//   원천마다 칸을 나눠 보이고 상태를 하나로 합치지 않는다. 실패·권한 없음 원천은 그 칸에 "조회 실패"로 — 0건처럼 보이지 않게.
// - summary 는 원천 필드 이름 그대로(개인정보 없음) — 아는 이름만 한국어로, 모르는 이름은 그대로. 금액·상태를 화면에서 계산하지 않는다.
// - 고객 번호로 찾으면 주문 목록만 → 누르면 그 주문으로 다시 조회. 각 항목에서 기존 상세로(주문·배송·클레임·사건).
// - 422 UNSUPPORTED_LOOKUP(TRANSFER·TRIP·모르는 접두어)은 코드 문구로.
// - 화면 번호(bff 0.14.0, ADR-0070): 주문·배송 항목 머리는 summary.orderNumber·deliveryNumber. 시스템 ID(orderId·deliveryId·riderId)는
//   요약 칸에서 빼고 접힌 "시스템 번호" 칸에. 번호가 null 이면 ID 끝 8자리 회색 + "번호 없음". 고객의 주문 목록도 주문번호로.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { FailureAlert, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/backoffice-bff';
import { useApi } from '../../app/ApiContext';
import { StartGuide } from '../../shared/StartGuide';
import { messages } from '../../shared/messages';
import { label, when, won } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { FieldWork } from './FieldSection';
import { ChipGroup, CodeLabel, PageHeader } from '../../shared/admin';
import { DisplayNumber, SystemNumbers } from '../../shared/displayNumber';
import { EmptyBox, Icon, type IconName } from './parts';

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
  // bff 0.9.0 MFC 현장(작업 지시 FULFILLMENT·중지 요청 MFC_STOP)
  FIELD: 'mfc-fulfillment-service',
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

/** 화면 번호를 쓰는 항목(주문·배송) — 시스템 ID 는 접힌 칸으로, 화면 번호는 머리로 */
const NUMBERED = new Set(['ORDER', 'DELIVERY']);
const SYSTEM_ID_KEYS = ['orderId', 'deliveryId', 'riderId'] as const;
const NUMBER_KEYS = ['orderNumber', 'deliveryNumber'];
const strOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** 주문 항목은 orderNumber, 배송 항목은 deliveryNumber */
const numberOf = (match: Match) => strOf(match.summary?.[match.kind === 'DELIVERY' ? 'deliveryNumber' : 'orderNumber']);

/** 금액 필드(원천 값 그대로 원·천 단위 표시만 — 계산하지 않음) */
const MONEY = new Set(['approvedAmount', 'totalAmount', 'total', 'itemAmount', 'bagFee', 'deliveryTip', 'deliveryTipBase', 'deliveryFee', 'itemsTotal']);

/** 값 하나 표시 — 시각(…At)은 서울 시각, 금액은 원, 참거짓은 예/아니요, 객체는 한 단계 펼친다(계산하지 않음) */
function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return messages.none;
  if (typeof v === 'boolean') return v ? m.yes : m.no;
  if (typeof v === 'string' && /At$/.test(key)) return when(v);
  if (typeof v === 'number' && MONEY.has(key)) return won(v);
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

/**
 * 원천 코드 값 → 업무 이름 표(2026-11-18 사용자 "직관적이지 않다"). 원천(kind)마다 같은 필드 이름이 다른 상태를 뜻하므로 원천별로.
 * 이미 화면들이 쓰는 이름표를 그대로 쓴다. 표에 없는 값은 코드 그대로(CodeLabel).
 */
const CODE_NAMES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  ORDER: { status: messages.orders.statusName, deliveryMode: messages.orders.mode, outOfStockPreference: messages.orders.oos, deliveryTipReason: messages.orders.tipReasonName },
  DELIVERY: { state: messages.deliveries.executionState, type: messages.deliveries.typeName },
  DISPATCH: { state: messages.deliveries.dispatchState, failureReason: messages.deliveries.failureReasonName },
  CLAIM: { state: messages.claims.stateName, type: messages.claims.typeName, reason: messages.claims.reasonName },
  CASE: { kind: messages.cases.kindName, state: messages.cases.stateName },
  INQUIRY: { status: messages.inquiries.status, category: messages.inquiries.categoryName },
};

function SummaryFacts({ summary, skip, kind }: { readonly summary: Record<string, unknown> | undefined; readonly skip?: readonly string[]; readonly kind?: string | undefined }) {
  const entries = Object.entries(summary ?? {}).filter(([k]) => !skip?.includes(k));
  const names = CODE_NAMES[kind ?? ''] ?? {};
  // 이름은 위에 작게, 값은 아래(Shopify 상세처럼) — 넓으면 두 칸
  return (
    <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0 space-y-0.5">
          <dt className="text-xs text-base-content/50">{m.field[k] ?? k}</dt>
          <dd className="break-all font-medium">{names[k] && typeof v === 'string' && v ? <CodeLabel code={v} names={names[k]} /> : show(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SourceLine({ source }: { readonly source: SourceStamp | undefined }) {
  if (!source) return null;
  return (
    <p className="text-xs text-base-content/45">
      <CodeLabel code={source.system} names={messages.systemName} />
      {` · ${source.asOf.asOf ? when(source.asOf.asOf) : messages.none}`}
    </p>
  );
}

const SECTION_ICON: Readonly<Record<string, IconName>> = { ORDER: 'box', FIELD: 'store', DELIVERY: 'truck', DISPATCH: 'user', CLAIM: 'return', INQUIRY: 'doc', CASE: 'flag', CUSTOMER: 'user' };

/** 원천 칸 — 머리(그림·이름·건수) + 내용. 실패·권한 없음이면 건수 없이 "조회 실패"(0건처럼 보이지 않게) */
function Section({ title, icon, failed, count, children }: { readonly title: string; readonly icon: IconName; readonly failed: boolean; readonly count?: number; readonly children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-base-300 bg-base-200/40 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <h2 className="font-semibold">{title}</h2>
        {!failed && count !== undefined && <span className="badge badge-sm badge-ghost ml-auto tabular-nums">{count}</span>}
      </div>
      <div className="space-y-3 px-4 py-3">
        {failed ? (
          <p role="alert" className="alert alert-warning alert-soft text-sm" data-state="source-failed">
            {m.sourceFailed}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

const Nothing = () => <p className="text-sm text-base-content/50">{m.none}</p>;

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

  // 화면(2026-11-18): 큰 검색 상자(종류 칩 + 번호) → 찾은 대상 띠 → 두 칸(왼쪽 주문·현장·접수 건, 오른쪽 배송·배차·클레임·문의)
  return (
    <section className="space-y-4">
      <PageHeader title={m.title} />
      <form
        className="space-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-4 shadow-sm"
        aria-label={m.search}
        onSubmit={(e) => {
          e.preventDefault();
          go(input.trim(), kindInput);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-base-content/55">{m.kind}</span>
          <ChipGroup label={m.kind} value={kindInput} options={KINDS.map((k) => ({ value: k, label: m.kindName[k] ?? k }))} onChange={setKindInput} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="input input-md min-w-0 flex-1">
            <Icon name="search" className="h-5 w-5 text-base-content/40" />
            <input aria-label={m.q} placeholder={m.q} className="font-mono" maxLength={128} value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            {m.search}
          </button>
        </div>
      </form>
      {q ? (
        codeFailure ? (
          <FailureAlert failure={codeFailure} />
        ) : (
          <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
            {(view) => <LookupResult view={view} onOpenOrder={(orderId) => go(orderId, 'ORDER')} />}
          </QueryState>
        )
      ) : (
        // 찾기 전(2026-11-18): 넣을 번호 모양 + 최근 본 주문·배송·접수 건
        <StartGuide recentKinds={['order', 'delivery', 'case']} />
      )}
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
  const fieldCount = matches.filter((x) => x.kind === 'FULFILLMENT' || x.kind === 'MFC_STOP').length;
  return (
    <div className="space-y-4">
      <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
      {resolvedKind && (
        <div className="flex items-center gap-3 rounded-box border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <Icon name={SECTION_ICON[resolvedKind] ?? 'search'} className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">{m.resolved(label(m.kindName, resolvedKind), view.resolved?.orderId ?? null)}</p>
        </div>
      )}
      {matches.length === 0 && failed.size === 0 ? (
        <div data-state="empty">
          <EmptyBox icon="search">{m.notFound}</EmptyBox>
        </div>
      ) : resolvedKind === 'CUSTOMER' ? (
        <Section title={m.customerOrders} icon="user" failed={orderFailed} count={of('ORDER').length}>
          {of('ORDER').length === 0 ? (
            <Nothing />
          ) : (
            <ul className="divide-y divide-base-300/70">
              {of('ORDER').map((o) => (
                <li key={o.id} data-testid="customer-order" className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      <DisplayNumber number={numberOf(o)} systemId={o.id} />
                    </span>
                    <button type="button" className="btn btn-xs btn-outline btn-primary ml-auto" onClick={() => onOpenOrder(o.id ?? '')}>
                      {m.openOrder}
                    </button>
                  </div>
                  <SummaryFacts summary={o.summary} skip={['orderId', ...NUMBER_KEYS]} kind="ORDER" />
                  {/* 목록 줄이라 시스템 번호 칸은 두지 않는다(ADR-0070 덧붙임 — 시스템 ID 는 주문 상세에서) */}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <Section title={m.section.ORDER!} icon="box" failed={orderFailed} count={of('ORDER').length}>
              {of('ORDER').length === 0 ? <Nothing /> : of('ORDER').map((o) => <MatchCard key={`ORDER-${o.id}`} match={o} />)}
            </Section>
            {/* 현장(MFC) — 주문 아래. 실패는 "조회 실패", 기록 없으면 없음 */}
            <Section title={m.section.FIELD!} icon="store" failed={failed.has(SECTION_SYSTEM.FIELD!)} count={fieldCount}>
              <FieldWork matches={matches} />
            </Section>
            {/* 사건은 열린 것과 닫힌 것(최근 20건)을 나눠 — 상태로만 가른다 */}
            <Section title={m.section.CASE!} icon="flag" failed={failed.has(SECTION_SYSTEM.CASE!)} count={of('CASE').length}>
              <div className="grid gap-4 md:grid-cols-2">
                {(['open', 'closed'] as const).map((part) => {
                  const list = of('CASE').filter((c) => (c.summary?.state === 'CLOSED') === (part === 'closed'));
                  return (
                    <div key={part} className="space-y-2" data-testid={`cases-${part}`}>
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <span className={`h-2 w-2 rounded-full ${part === 'open' ? 'bg-warning' : 'bg-base-300'}`} aria-hidden="true" />
                        {m.caseParts[part]}
                      </h3>
                      {list.length === 0 ? <Nothing /> : list.map((x) => <MatchCard key={`CASE-${x.id}`} match={x} />)}
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
          <div className="min-w-0 space-y-4">
            {SECTIONS.map((s) => (
              <Section key={s} title={m.section[s]!} icon={SECTION_ICON[s] ?? 'doc'} failed={failed.has(SECTION_SYSTEM[s]!)} count={of(s).length}>
                {of(s).length === 0 ? <Nothing /> : of(s).map((x) => <MatchCard key={`${s}-${x.id}`} match={x} />)}
              </Section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatchCard({ match }: { readonly match: Match }) {
  const path = match.id ? detailPath(match.kind, match.id) : null;
  const numbered = NUMBERED.has(match.kind ?? '');
  return (
    <div className="space-y-2 rounded-box border border-base-300/70 bg-base-200/30 p-3" data-testid={`match-${match.kind ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {numbered ? (
          <span className="font-semibold">
            <DisplayNumber number={numberOf(match)} systemId={match.id} />
          </span>
        ) : (
          <span className="font-mono font-semibold">{match.id}</span>
        )}
        {path && (
          <Link className="ml-auto text-sm text-primary hover:underline" to={path}>
            {m.detail}
          </Link>
        )}
      </div>
      <SummaryFacts summary={match.summary} skip={numbered ? [...SYSTEM_ID_KEYS, ...NUMBER_KEYS] : []} kind={match.kind} />
      {numbered && (
        <SystemNumbers
          ids={[
            { label: messages.displayNumber.system[match.kind === 'DELIVERY' ? 'deliveryId' : 'orderId'], id: match.id },
            ...SYSTEM_ID_KEYS.filter((k) => strOf(match.summary?.[k]) !== match.id).map((k) => ({ label: messages.displayNumber.system[k], id: strOf(match.summary?.[k]) })),
          ]}
        />
      )}
      <SourceLine source={match.source} />
    </div>
  );
}
