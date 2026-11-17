// 기본 판매가격: 조회(현재·예약·이력), 변경 요청(approval PRICE 변경 요청을 화면에서 직접 만든다), 승인 반영 확인.
// 금액은 서버 값을 표시만 한다. PRICE_NOT_SET 은 0원이 아니라 "미설정(판매 불가)".
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

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
import { DataTable, PageHeader } from '../../shared/admin';

const SKU_PATTERN = /^[EB]-\d{8}$/;
const PRICE_NOT_SET = 'PRICE_NOT_SET';

/** datetime-local(서울 기준 입력) → ISO-8601 +09:00 */
export const seoulInputToIso = (v: string) => (v ? `${v.length === 16 ? `${v}:00` : v}+09:00` : '');

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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm">
        <h2 className="mb-2 font-bold">{`${m.prices.current} · ${sku}`}</h2>
        {notSet ? (
          <p role="status" data-state="not-set" className="text-warning">
            {m.prices.notSet}
          </p>
        ) : (
          <QueryState state={toUiState(price)} onRetry={() => void price.refetch()}>
            {(p) => (
              <dl className="grid grid-cols-[8rem_1fr] gap-1">
                <dt>{m.prices.current}</dt>
                <dd data-testid="base-price">{formatKrw(p.basePrice)}</dd>
                <dt>{m.prices.effectiveFrom}</dt>
                <dd>{`${formatSeoul(p.effectiveFrom)} (v${p.priceVersion})`}</dd>
                {p.nextChange?.basePrice !== undefined && (
                  <>
                    <dt>{m.prices.next}</dt>
                    <dd>{`${formatKrw(p.nextChange.basePrice)}${p.nextChange.effectiveFrom ? ` · ${formatSeoul(p.nextChange.effectiveFrom)}` : ''}`}</dd>
                  </>
                )}
              </dl>
            )}
          </QueryState>
        )}
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm">
        <h2 className="mb-2 font-bold">{m.prices.history}</h2>
        <QueryState state={toUiState(history, (d) => (d.items?.length ?? 0) === 0)} onRetry={() => void history.refetch()}>
          {(h) => (
            <DataTable>
              <tbody>
                {(h.items ?? []).map((v, i) => (
                  <tr key={v.priceVersion ?? i}>
                    <td>{`v${v.priceVersion ?? m.none}`}</td>
                    <td>{v.basePrice === undefined ? m.none : formatKrw(v.basePrice)}</td>
                    <td>{v.effectiveFrom ? formatSeoul(v.effectiveFrom) : m.none}</td>
                    <td>{v.state ? m.prices.versionState[v.state] : m.none}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryState>
      </div>
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

  return (
    <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="font-bold">{m.prices.changeTitle}</h2>
      <p className="text-xs text-base-content/60">{m.prices.effectiveHint}</p>
      <label className="flex w-fit flex-col text-sm">
        {m.prices.requestedEffectiveFrom}
        <input type="datetime-local" className="input input-sm" disabled={body !== null} value={common} onChange={(e) => setCommon(e.target.value)} />
      </label>
      <DataTable>
        <thead>
          <tr>
            <th>{m.prices.sku}</th>
            <th>{m.prices.basePrice}</th>
            <th>{m.prices.lineEffectiveFrom}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input aria-label={`${m.prices.sku} ${i + 1}`} className="input input-sm w-36" disabled={body !== null} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value.trim() })} />
              </td>
              <td>
                <input aria-label={`${m.prices.basePrice} ${i + 1}`} className="input input-sm w-28" inputMode="numeric" disabled={body !== null} value={l.basePrice} onChange={(e) => setLine(i, { basePrice: e.target.value.trim() })} />
              </td>
              <td>
                <input type="datetime-local" className="input input-sm" disabled={body !== null} value={l.effectiveFrom} onChange={(e) => setLine(i, { effectiveFrom: e.target.value })} />
              </td>
              <td>
                {body === null && lines.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    {m.prices.removeLine}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {body === null ? (
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, emptyLine()])}>
            {m.prices.addLine}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={() => setBody(priceChangeBody(lines, common, randomUuid()))}>
            {m.approvals.requestApproval}
          </button>
        </div>
      ) : (
        <RequestApproval body={body} onRequested={(r) => r.approvalId && setApprovalId(r.approvalId)} />
      )}

      <div className="space-y-2 border-t border-base-300 pt-3">
        <h3 className="font-semibold">{m.prices.confirmTitle}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            {m.prices.approvalId}
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
    </div>
  );
}

export function PricePage() {
  const [params, setParams] = useSearchParams();
  const sku = params.get('sku') ?? '';
  const [input, setInput] = useState(sku);
  return (
    <section className="space-y-4">
      <PageHeader title={m.prices.title} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (SKU_PATTERN.test(input.trim())) setParams({ sku: input.trim() });
        }}
      >
        <input aria-label={m.prices.sku} placeholder="E-00000001" className="input input-sm" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!SKU_PATTERN.test(input.trim())}>
          {m.prices.lookup}
        </button>
      </form>
      {sku && SKU_PATTERN.test(sku) && <PriceLookup key={sku} sku={sku} />}
      <PriceChange key={sku} initialSku={SKU_PATTERN.test(sku) ? sku : ''} />
    </section>
  );
}
