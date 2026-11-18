// 기본 판매가격: 조회(현재·예약·이력), 변경 요청(approval PRICE 변경 요청을 화면에서 직접 만든다), 승인 반영 확인.
// 화면(2026-11-18 사용자 "밋밋하다"): SKU 찾기 줄 → 두 칸(현재 기본가 큰 숫자·예약 / 가격 이력 세로 줄) → 변경 요청 카드(단계 표시·행 표·반영 확인).
// 금액은 서버 값을 표시만 한다. PRICE_NOT_SET 은 0원이 아니라 "미설정(판매 불가)".
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { commandParams } from '../../api/command';
import { ProblemFailure } from '@pmart/web-core';
import type { ChangeRequestBody } from '../../api/models';
import { request } from '@pmart/web-core';
import { settleCommand } from '@pmart/web-core';
import { randomUuid } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { Card, EmptyState, LineIcon, Steps, tableClass } from '../products/parts';

const SKU_PATTERN = /^[EB]-\d{8}$/;
const PRICE_NOT_SET = 'PRICE_NOT_SET';

/** datetime-local(서울 기준 입력) → ISO-8601 +09:00 */
export const seoulInputToIso = (v: string) => (v ? `${v.length === 16 ? `${v}:00` : v}+09:00` : '');

const VERSION_TONE: Readonly<Record<string, Tone>> = { SCHEDULED: 'info', EFFECTIVE: 'success', SUPERSEDED: 'ghost', REJECTED: 'error' };

function PriceLookup({ sku }: { readonly sku: string }) {
  const api = useApi();
  const price = useQuery({
    queryKey: ['pricing', 'price', sku],
    queryFn: () => request('GET', api.pricing.GET('/prices/{sku}', { params: { path: { sku } } })),
  });
  const history = useQuery({
    queryKey: ['pricing', 'versions', sku],
    queryFn: () => request('GET', api.pricing.GET('/price-versions/{sku}', { params: { path: { sku }, query: { size: 50 } } })),
  });
  const notSet = price.error instanceof ProblemFailure && price.error.problem.code === PRICE_NOT_SET;

  // 왼쪽(2/3): 현재 기본가 큰 숫자 + 예약된 다음 가격, 오른쪽(1/3): 가격 이력 세로 줄(최신 위)
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <Card title={m.prices.current} aside={<span className="rounded bg-base-200 px-2 py-0.5 font-mono text-xs">{sku}</span>} className="lg:col-span-2">
        {notSet ? (
          <div role="status" data-state="not-set" className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-4 text-warning">
            <LineIcon name="tag" className="h-6 w-6 shrink-0" />
            <span className="font-medium">{m.prices.notSet}</span>
          </div>
        ) : (
          <QueryState state={toUiState(price)} onRetry={() => void price.refetch()}>
            {(p) => (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                  <p className="text-4xl font-bold tracking-tight tabular-nums" data-testid="base-price">
                    {formatKrw(p.basePrice)}
                  </p>
                  <span className="pb-1.5 font-mono text-sm text-base-content/50">{`v${p.priceVersion}`}</span>
                </div>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div className="space-y-0.5">
                    <dt className="text-xs text-base-content/50">{m.prices.effectiveFrom}</dt>
                    <dd className="font-medium">{formatSeoul(p.effectiveFrom)}</dd>
                  </div>
                  {p.nextChange?.basePrice !== undefined && (
                    <div className="space-y-0.5 rounded-lg border border-info/30 bg-info/5 px-3 py-2">
                      <dt className="text-xs text-info">{m.prices.next}</dt>
                      <dd className="font-medium">{`${formatKrw(p.nextChange.basePrice)}${p.nextChange.effectiveFrom ? ` · ${formatSeoul(p.nextChange.effectiveFrom)}` : ''}`}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </QueryState>
        )}
      </Card>
      <Card title={m.prices.history}>
        <QueryState state={toUiState(history, (d) => (d.items?.length ?? 0) === 0)} onRetry={() => void history.refetch()} emptyText={m.prices.noHistory}>
          {(h) => (
            <ol className="relative space-y-4 border-l border-base-300 pl-4">
              {(h.items ?? []).map((v, i) => (
                <li key={v.priceVersion ?? i} className="relative">
                  <span className={`absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-base-100 ${v.state === 'EFFECTIVE' ? 'bg-success' : v.state === 'SCHEDULED' ? 'bg-info' : 'bg-base-300'}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{v.basePrice === undefined ? m.none : formatKrw(v.basePrice)}</span>
                    {v.state ? <StatusBadge tone={VERSION_TONE[v.state] ?? 'ghost'}>{m.prices.versionState[v.state]}</StatusBadge> : m.none}
                  </div>
                  <p className="text-xs text-base-content/50">
                    <span className="font-mono">{`v${v.priceVersion ?? m.none}`}</span>
                    {` · ${v.effectiveFrom ? formatSeoul(v.effectiveFrom) : m.none}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

interface Line {
  sku: string;
  basePrice: string;
  effectiveFrom: string;
}

const emptyLine = (sku = ''): Line => ({ sku, basePrice: '', effectiveFrom: '' });

/** handoff 2026-10-30 §4.5 PRICE 변경 요청 본문. requestedAmount = attributes.basePrice. */
export function priceChangeBody(lines: readonly Line[], requestedEffectiveFrom: string, refId: string): ChangeRequestBody {
  const common = seoulInputToIso(requestedEffectiveFrom);
  return {
    type: 'PRICE',
    targetService: 'pricing-service',
    targetRef: `PRICE-${refId}`,
    allowedActions: ['APPLY_PRICE_VERSION'],
    summary: `기본가 변경 ${lines.length}건`,
    ...(common ? { requestedEffectiveFrom: common } : {}),
    lines: lines.map((l) => {
      const amount = Number(l.basePrice);
      const at = seoulInputToIso(l.effectiveFrom);
      return {
        lineKey: l.sku,
        requestedAmount: amount,
        attributes: { sku: l.sku, basePrice: amount, ...(at ? { effectiveFrom: at } : {}) },
      };
    }),
  };
}

const validLine = (l: Line) => SKU_PATTERN.test(l.sku) && /^\d+$/.test(l.basePrice);

function PriceChange({ initialSku }: { readonly initialSku: string }) {
  const api = useApi();
  const [lines, setLines] = useState<Line[]>([emptyLine(initialSku)]);
  const [common, setCommon] = useState('');
  const [body, setBody] = useState<ChangeRequestBody | null>(null);
  const [approvalId, setApprovalId] = useState('');

  const ok = lines.length > 0 && lines.every(validLine) && new Set(lines.map((l) => l.sku)).size === lines.length;
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const effectiveOf = (l: Line) => seoulInputToIso(l.effectiveFrom) || seoulInputToIso(common);
  const confirmable = approvalId.trim().length > 0 && lines.every((l) => effectiveOf(l));

  const confirm = useCommand((v: { approvalId: string; lines: Line[] }, key) =>
    settleCommand(
      key,
      () =>
        request(
          'POST',
          api.pricing.POST('/price-version-applications', {
            ...commandParams(key),
            body: {
              approvalId: v.approvalId,
              items: v.lines.map((l) => ({ sku: l.sku, basePrice: Number(l.basePrice), effectiveFrom: effectiveOf(l) })),
            },
          }),
        ),
      (requestId) =>
        request('GET', api.pricing.GET('/price-version-applications/{requestId}', { params: { path: { requestId } } })),
    ),
  );

  // 단계: ① 행 입력 → ② 승인 요청 → ③ 반영 확인(보기용 — 화면 상태로만 고른다)
  const step = body === null ? 0 : approvalId.trim() ? 2 : 1;
  const label = 'text-xs font-medium text-base-content/60';
  return (
    <Card title={m.prices.changeTitle} hint={m.prices.effectiveHint} aside={<Steps steps={m.prices.changeSteps} now={step} label={m.prices.stepsLabel} />}>
      <label className="flex w-fit flex-col gap-1 text-sm">
        <span className={label}>{m.prices.requestedEffectiveFrom}</span>
        <input type="datetime-local" className="input input-sm" disabled={body !== null} value={common} onChange={(e) => setCommon(e.target.value)} />
      </label>
      <div className="overflow-hidden rounded-lg border border-base-300">
        <div className="border-b border-base-300 bg-base-200/40 px-4 py-2 text-xs font-medium text-base-content/60">{m.prices.linesTitle}</div>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>{m.prices.sku}</th>
                <th>{m.prices.basePrice}</th>
                <th>{m.prices.lineEffectiveFrom}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="text-xs text-base-content/45">{i + 1}</td>
                  <td>
                    <input aria-label={`${m.prices.sku} ${i + 1}`} className="input input-sm w-36 font-mono" disabled={body !== null} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value.trim() })} />
                  </td>
                  <td>
                    <input aria-label={`${m.prices.basePrice} ${i + 1}`} className="input input-sm w-28 text-right tabular-nums" inputMode="numeric" disabled={body !== null} value={l.basePrice} onChange={(e) => setLine(i, { basePrice: e.target.value.trim() })} />
                  </td>
                  <td>
                    <input type="datetime-local" className="input input-sm" disabled={body !== null} value={l.effectiveFrom} onChange={(e) => setLine(i, { effectiveFrom: e.target.value })} />
                  </td>
                  <td className="text-right">
                    {body === null && lines.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        {m.prices.removeLine}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {body === null ? (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines([...lines, emptyLine()])}>
            + {m.prices.addLine}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={() => setBody(priceChangeBody(lines, common, randomUuid()))}>
            {m.approvals.requestApproval}
          </button>
        </div>
      ) : (
        <RequestApproval body={body} onRequested={(r) => r.approvalId && setApprovalId(r.approvalId)} />
      )}

      <div className="space-y-2 rounded-lg border border-base-300 bg-base-200/30 px-4 py-3">
        <h3 className="font-semibold">{m.prices.confirmTitle}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className={label}>{m.prices.approvalId}</span>
            <input className="input input-sm" value={approvalId} onChange={(e) => setApprovalId(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ok || !confirmable || confirm.busy}
            onClick={() => void confirm.run({ approvalId: approvalId.trim(), lines })}
          >
            {m.prices.confirm}
          </button>
        </div>
        <CommandFeedback command={confirm}>
          {(r) => (
            <ul role="status" className="text-sm">
              {('items' in r ? (r.items ?? []) : []).map((it, i) => (
                <li key={it.sku ?? i}>{`${it.sku ?? m.none} · v${it.priceVersion ?? m.none} · ${it.state ? m.prices.versionState[it.state] : m.none}`}</li>
              ))}
              <li>{r.status === 'APPLIED' ? m.approvals.executionState.APPLIED : r.status}</li>
            </ul>
          )}
        </CommandFeedback>
      </div>
    </Card>
  );
}

export function PricePage() {
  const [params, setParams] = useSearchParams();
  const sku = params.get('sku') ?? '';
  const [input, setInput] = useState(sku);
  const valid = SKU_PATTERN.test(sku);
  return (
    <section className="space-y-4">
      <PageHeader
        title={m.prices.title}
        description={m.prices.intro}
        actions={
          <Link className="btn btn-sm" to="/prices/import">
            {m.prices.importTitle}
          </Link>
        }
      />
      {/* SKU 찾기 줄 */}
      <form
        className="flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (SKU_PATTERN.test(input.trim())) setParams({ sku: input.trim() });
        }}
      >
        <label className="input input-sm flex w-64 items-center gap-2">
          <LineIcon name="search" className="h-4 w-4 text-base-content/40" />
          <input aria-label={m.prices.sku} placeholder="E-00000001" className="grow font-mono" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!SKU_PATTERN.test(input.trim())}>
          {m.prices.lookup}
        </button>
      </form>
      {sku && valid ? (
        <PriceLookup key={sku} sku={sku} />
      ) : (
        <div className="rounded-box border border-dashed border-base-300 bg-base-100">
          <EmptyState icon="tag">{m.prices.pickSku}</EmptyState>
        </div>
      )}
      <PriceChange key={sku} initialSku={valid ? sku : ''} />
    </section>
  );
}
