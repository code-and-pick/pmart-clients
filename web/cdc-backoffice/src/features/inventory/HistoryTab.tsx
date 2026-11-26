// 재고관리 [이동 이력] — cdc-inventory 0.20.0 `GET /cdcs/{cdcId}/stock-movements`(LG-1, 백엔드 회신 2026-11-26-reply-stock-movements).
// 한 줄 = 원결과(commit) 하나: 언제·무슨 종류·어느 칸·버킷이 얼마나·원천 참조·처리자. sku 또는 칸 하나는 있어야 부른다(서버 400 — 센터 전체 훑기 막음).
// 기간은 출고일처럼 날짜(Asia/Seoul)로 고르고 서버에는 그날 00:00 ~ 끝날 24:00 로 보낸다(기본 = 서버 기본 최근 7일, 최대 31일 — 넘으면 서버 400).
// 뒤 수량(잔고)은 서버가 주지 않는다 — 지금 수량은 재고 현황·칸별 재고.
// 다른 탭에서 `?tab=history&sku=&lot=` 또는 `&loc=` 로 바로 온다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-inventory';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';

const t = messages.movements;
type Kind = components['schemas']['PostingKind'];
type Movement = components['schemas']['StockMovement'];
const KINDS: readonly Kind[] = ['ALLOCATION', 'ALLOCATION_ADD', 'RELEASE', 'TOUT', 'TIN_ACK', 'TIN_CORRECTION', 'TRANSPORT_LOSS', 'MOVE', 'QUALITY_HOLD', 'QUALITY_RELEASE', 'DISPOSAL', 'CNT', 'INITIAL_BALANCE'];
const PAGE_SIZE = 50;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const startOf = (d: string) => new Date(`${d}T00:00:00+09:00`).toISOString();
const endOf = (d: string) => new Date(new Date(`${d}T00:00:00+09:00`).getTime() + 86_400_000).toISOString();

/** 다른 탭에서 이력으로 가는 주소 */
export const historyPath = (cdcId: string, q: { sku?: string | undefined; lot?: string | undefined; loc?: string | undefined }) => {
  const p = new URLSearchParams({ tab: 'history' });
  if (q.sku) p.set('sku', q.sku);
  if (q.lot) p.set('lot', q.lot);
  if (q.loc) p.set('loc', q.loc);
  return `${centerPath(cdcId, 'inventory')}?${p.toString()}`;
};

export function HistoryLink({ cdcId, sku, lot, loc, testId }: { readonly cdcId: string; readonly sku?: string | undefined; readonly lot?: string | undefined; readonly loc?: string | undefined; readonly testId?: string }) {
  return (
    <Link className="link link-hover text-xs text-primary" to={historyPath(cdcId, { sku, lot, loc })} data-testid={testId ?? 'history-link'} onClick={(e) => e.stopPropagation()}>
      {t.link}
    </Link>
  );
}

export function HistoryTab({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const applied = {
    sku: params.get('sku') ?? '',
    lot: params.get('lot') ?? '',
    loc: params.get('loc') ?? '',
    kind: (KINDS.find((k) => k === params.get('kind')) ?? ''),
    from: isDate(params.get('from')) ? params.get('from')! : '',
    to: isDate(params.get('to')) ? params.get('to')! : '',
  };
  const kindQ = KINDS.find((k) => k === applied.kind);
  const page = Math.max(0, Number(params.get('hp') ?? '0') || 0);
  const [f, setF] = useState(applied);
  const ready = !!(applied.sku || applied.loc);
  const apply = (next: typeof applied, p = 0) => {
    const q = new URLSearchParams({ tab: 'history' });
    for (const [k, v] of Object.entries(next)) if (v.trim()) q.set(k, v.trim());
    if (p) q.set('hp', String(p));
    setParams(q, { replace: true });
  };
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'stock-movements', applied, page],
    enabled: ready,
    queryFn: () =>
      request(
        'GET',
        api.inventory.GET('/cdcs/{cdcId}/stock-movements', {
          params: {
            path: { cdcId },
            query: {
              page,
              size: PAGE_SIZE,
              ...(applied.sku ? { sku: applied.sku } : {}),
              ...(applied.lot ? { lot: applied.lot } : {}),
              ...(applied.loc ? { locationCode: applied.loc } : {}),
              ...(kindQ ? { kind: kindQ } : {}),
              ...(applied.from ? { from: startOf(applied.from) } : {}),
              ...(applied.to ? { to: endOf(applied.to) } : {}),
            },
          },
        }),
      ),
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="space-y-3">
      <p className="max-w-4xl text-sm text-base-content/60">{t.lead}</p>
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        data-testid="history-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.sku.trim() || f.loc.trim()) apply(f);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {t.sku}
          <input className="input input-sm w-36 font-mono" value={f.sku} onChange={(e) => set('sku', e.target.value)} data-testid="history-sku" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.lot}
          <input className="input input-sm w-28 font-mono" value={f.lot} onChange={(e) => set('lot', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.loc}
          <input className="input input-sm w-52 font-mono" value={f.loc} onChange={(e) => set('loc', e.target.value)} data-testid="history-loc" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.kind}
          <select className="select select-sm w-36" value={f.kind} onChange={(e) => set('kind', e.target.value)} data-testid="history-kind">
            <option value="">{t.all}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k] ?? k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.from}
          <input type="date" className="input input-sm w-36" value={f.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.to}
          <input type="date" className="input input-sm w-36" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!f.sku.trim() && !f.loc.trim()} data-testid="history-go">
          {t.go}
        </button>
        <span className="w-full text-xs text-base-content/55">{t.need}</span>
      </form>
      {!ready ? (
        <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60" data-testid="history-need">
          {t.need}
        </p>
      ) : (
        <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.empty}>
          {(data) => (
            <div className="space-y-2">
              {data.from && data.to && <p className="text-xs text-base-content/60">{t.range(formatSeoul(data.from), formatSeoul(data.to))}</p>}
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm" data-testid="history-table">
                  <thead>
                    <tr>
                      <th>{t.at}</th>
                      <th>{t.kind}</th>
                      <th>{t.deltas}</th>
                      <th>{t.source}</th>
                      <th>{t.actor}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((m) => (
                      <tr key={m.commitId} data-testid="history-row" className="align-top">
                        <td className="whitespace-nowrap">{formatSeoul(m.appliedAt)}</td>
                        <td>
                          <span className="badge badge-sm badge-outline whitespace-nowrap">{t.kinds[m.postingKind] ?? m.postingKind}</span>
                        </td>
                        <td>
                          <Deltas cdcId={cdcId} m={m} focus={applied.loc} />
                        </td>
                        <td className="font-mono text-xs">{m.sourceRef ?? messages.none}</td>
                        <td className="text-xs">
                          <Actor m={m} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2 text-sm">
                <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => apply(applied, page - 1)}>
                  {messages.trf.prev}
                </button>
                <span>{messages.trf.page(page)}</span>
                <button type="button" className="btn btn-sm" disabled={!data.hasNext} onClick={() => apply(applied, page + 1)}>
                  {messages.trf.next}
                </button>
              </div>
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

function Deltas({ cdcId, m, focus }: { readonly cdcId: string; readonly m: Movement; readonly focus: string }) {
  const many = new Set(m.deltas.map((d) => `${d.sku}|${d.lot}`)).size > 1;
  return (
    <ul className="space-y-0.5 text-xs" data-testid="history-deltas">
      {m.deltas.map((d, i) => (
        <li key={`${d.sku}-${d.lot}-${d.locationCode ?? ''}-${d.bucket}-${i}`} className="flex flex-wrap items-center gap-x-2">
          {(many || i === 0) && (
            <span className="text-base-content/70">
              <SkuName sku={d.sku} /> · <span className="font-mono">{d.lot}</span>
            </span>
          )}
          {d.locationCode ? (
            <Link className={`font-mono link-hover ${d.locationCode === focus ? 'font-semibold' : ''}`} to={historyPath(cdcId, { loc: d.locationCode })}>
              {d.locationCode}
            </Link>
          ) : (
            <span className="text-base-content/55">{t.noLoc}</span>
          )}
          <span>{t.buckets[d.bucket] ?? d.bucket}</span>
          <span className={`font-semibold tabular-nums ${d.delta > 0 ? 'text-success' : d.delta < 0 ? 'text-error' : ''}`}>{d.delta > 0 ? `+${d.delta}` : d.delta}</span>
        </li>
      ))}
    </ul>
  );
}

function Actor({ m }: { readonly m: Movement }) {
  // 운영자 ID 면 이름으로, 서비스 이름·SYSTEM 이면 그대로, 없으면(사건 구독·옛 원결과) 원천 시스템
  if (!m.actorId) return <span className="text-base-content/60">{m.sourceSystem}</span>;
  if (m.actorId.startsWith('OP-')) return <Who id={m.actorId} />;
  return <span className="font-mono">{m.actorId}</span>;
}
