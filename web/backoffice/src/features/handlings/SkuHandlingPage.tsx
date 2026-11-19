// 센터 SKU 취급 ON/OFF(MFC·CDC). 기본 OFF(레코드 없음 = OFF, version 0). 자기 센터만(세션 centers — 서버는 토큰 centers 로 판정) — 판정은 서버.
// 센터 목록 API(center-master)가 아직 없어 센터 ID 를 입력한다. 필터·센터·커서는 URL 쿼리.
// 화면(2026-11-18 사용자 "밋밋하다"): 안내 띠 → 센터 고르기 줄(종류 칩·ID·사유) → 한 카드(센터 이름·ON/OFF 밑줄 탭·고르면 나오는 일괄 변경 줄·표·아래 건수). 센터 전에는 빈 상태 안내.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { commandParams, type IdempotencyKey } from '../../api/command';
import type { Api } from '../../api/client';
import { CommandRejectedFailure, UnknownResultFailure } from '@pmart/web-core';
import type { SkuHandling, SkuHandlingBatchResult, SkuHandlingPage as Page, SkuHandlingResult } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { ChipGroup, CodeLabel, PageHeader, StatusBadge } from '../../shared/admin';
import { ago, EmptyState, tableClass, UnderlineTabs } from '../products/parts';

type CenterType = 'MFC' | 'CDC';

interface ListArgs {
  readonly centerId: string;
  readonly enabled: boolean | undefined;
  readonly cursor: string | undefined;
}

/** MFC·CDC 는 같은 모양이고 경로만 다르다. */
function handlingApi(api: Api, type: CenterType) {
  const query = (a: ListArgs) => ({
    ...(a.enabled === undefined ? {} : { enabled: a.enabled }),
    ...(a.cursor ? { cursor: a.cursor } : {}),
    size: 100,
  });
  return type === 'MFC'
    ? {
        list: (a: ListArgs): Promise<Page> =>
          request('GET', api.mfcInventory.GET('/mfcs/{mfcId}/sku-handlings', { params: { path: { mfcId: a.centerId }, query: query(a) } })),
        change: (centerId: string, key: IdempotencyKey, version: number, body: { sku: string; enabled: boolean; reason?: string }): Promise<SkuHandlingResult> =>
          request('POST', api.mfcInventory.POST('/mfcs/{mfcId}/sku-handlings', { ...commandParams(key, { path: { mfcId: centerId }, version: version }), body })),
        batch: (centerId: string, key: IdempotencyKey, body: BatchBody): Promise<SkuHandlingBatchResult> =>
          request('POST', api.mfcInventory.POST('/mfcs/{mfcId}/sku-handling-batches', { ...commandParams(key, { path: { mfcId: centerId } }), body })),
      }
    : {
        list: (a: ListArgs): Promise<Page> =>
          request('GET', api.cdcInventory.GET('/cdcs/{cdcId}/sku-handlings', { params: { path: { cdcId: a.centerId }, query: query(a) } })),
        change: (centerId: string, key: IdempotencyKey, version: number, body: { sku: string; enabled: boolean; reason?: string }): Promise<SkuHandlingResult> =>
          request('POST', api.cdcInventory.POST('/cdcs/{cdcId}/sku-handlings', { ...commandParams(key, { path: { cdcId: centerId }, version: version }), body })),
        batch: (centerId: string, key: IdempotencyKey, body: BatchBody): Promise<SkuHandlingBatchResult> =>
          request('POST', api.cdcInventory.POST('/cdcs/{cdcId}/sku-handling-batches', { ...commandParams(key, { path: { cdcId: centerId } }), body })),
      };
}

interface BatchBody {
  reason?: string;
  items: Array<{ sku: string; enabled: boolean; expectedVersion: number }>;
}

/** 200 응답도 status 를 본다. APPLIED 가 아니면 확정하지 않는다(짝 조회가 없어 같은 키 재전송으로 확인). */
function confirmApplied<T extends { status: string; requestId: string }>(r: T): T {
  if (r.status === 'APPLIED') return r;
  if (r.status === 'REJECTED') throw new CommandRejectedFailure(undefined, r.requestId);
  throw new UnknownResultFailure(undefined, r.requestId);
}

function HandlingRow({
  type,
  centerId,
  row,
  reason,
  checked,
  onCheck,
}: {
  readonly type: CenterType;
  readonly centerId: string;
  readonly row: SkuHandling;
  readonly reason: string;
  readonly checked: boolean;
  readonly onCheck: (v: boolean) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toggle = useCommand(async (enabled: boolean, key) => {
    const r = confirmApplied(
      await handlingApi(api, type).change(centerId, key, row.version, { sku: row.sku, enabled, ...(reason ? { reason } : {}) }),
    );
    await queryClient.invalidateQueries({ queryKey: ['handlings', type, centerId] });
    return r;
  });

  return (
    <tr className={checked ? 'bg-primary/5' : ''}>
      <td>
        <input type="checkbox" aria-label={`select ${row.sku}`} className="checkbox checkbox-sm" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
      </td>
      <td>
        <p className="font-mono font-medium">{row.sku}</p>
        <p className="font-mono text-xs text-base-content/50">{row.productId ?? m.none}</p>
      </td>
      <td>{row.skuState ? <StatusBadge tone={row.skuState === 'ACTIVE' ? 'success' : 'ghost'}><CodeLabel code={row.skuState} names={m.handlings.skuStateName} /></StatusBadge> : m.none}</td>
      <td data-testid={`handling-${row.sku}`}>
        <span className={`badge badge-sm font-semibold ${row.handlingEnabled ? 'badge-success' : 'badge-ghost'}`}>{row.handlingEnabled ? m.handlings.on : m.handlings.off}</span>
      </td>
      <td className="whitespace-nowrap">
        {row.updatedAt ? (
          <>
            <p className="text-sm">{ago(row.updatedAt)}</p>
            <p className="text-xs text-base-content/45">{`${formatSeoul(row.updatedAt)} · v${row.version}`}</p>
          </>
        ) : (
          <p className="font-mono text-xs text-base-content/50">{`v${row.version}`}</p>
        )}
      </td>
      <td className="space-y-1 text-right">
        <button type="button" className={`btn btn-xs ${row.handlingEnabled ? 'btn-ghost border-base-300' : 'btn-success btn-soft'}`} disabled={toggle.busy} onClick={() => void toggle.run(!row.handlingEnabled)}>
          {row.handlingEnabled ? m.handlings.turnOff : m.handlings.turnOn}
        </button>
        <CommandFeedback command={toggle}>{(r) => (r.changed === false ? <p className="text-xs">{m.handlings.noChange}</p> : null)}</CommandFeedback>
      </td>
    </tr>
  );
}

export function SkuHandlingPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const type: CenterType = params.get('type') === 'CDC' ? 'CDC' : 'MFC';
  const centerId = params.get('center') ?? '';
  const enabledParam = params.get('enabled');
  const enabled = enabledParam === 'true' ? true : enabledParam === 'false' ? false : undefined;
  const cursor = params.get('cursor') ?? undefined;
  const [centerInput, setCenterInput] = useState(centerId);
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchEnabled, setBatchEnabled] = useState(true);

  const query = useQuery({
    queryKey: ['handlings', type, centerId, enabled, cursor],
    enabled: centerId.length > 0,
    queryFn: () => handlingApi(api, type).list({ centerId, enabled, cursor }),
  });

  const batch = useCommand(async (body: BatchBody, key) => {
    const r = confirmApplied(await handlingApi(api, type).batch(centerId, key, body));
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: ['handlings', type, centerId] });
    return r;
  });

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'cursor') next.delete('cursor');
    setParams(next);
    setSelected(new Set());
  };

  const rows = query.data?.items ?? [];
  return (
    <section className="space-y-4">
      <PageHeader title={m.handlings.title} />

      {/* 센터 고르기 줄 */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
        <div className="space-y-1">
          <div className="text-xs font-medium text-base-content/55">{m.handlings.centerType}</div>
          <ChipGroup<CenterType>
            label={m.handlings.centerType}
            value={type}
            onChange={(v) => setParam('type', v)}
            options={[
              { value: 'MFC', label: 'MFC' },
              { value: 'CDC', label: 'CDC' },
            ]}
          />
        </div>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('center', centerInput.trim());
          }}
        >
          <div className="text-xs font-medium text-base-content/55">{m.handlings.centerId}</div>
          <div className="join">
            <input aria-label={m.handlings.centerId} placeholder="MFC-BSN-01" className="input input-sm join-item font-mono" value={centerInput} onChange={(e) => setCenterInput(e.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary join-item">
              {m.search}
            </button>
          </div>
        </form>
        <label className="min-w-64 flex-1 space-y-1">
          <span className="block text-xs font-medium text-base-content/55">{`${m.reasonLabel} · ${m.handlings.reasonHint}`}</span>
          <input aria-label={m.reasonLabel} className="input input-sm w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>

      {!centerId ? (
        <div className="rounded-box border border-dashed border-base-300 bg-base-100">
          <EmptyState icon="store">{m.handlings.pickCenter}</EmptyState>
        </div>
      ) : (
        <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
          {/* 센터 이름 줄 + 취급 탭(밑줄) */}
          <div className="flex items-center gap-2 border-b border-base-300 px-5 py-3">
            <span className="badge badge-neutral badge-sm">{type}</span>
            <h2 className="font-mono font-bold">{centerId}</h2>
          </div>
          <UnderlineTabs<'' | 'true' | 'false'>
            label={m.handlings.filter}
            value={enabledParam === 'true' || enabledParam === 'false' ? enabledParam : ''}
            onChange={(v) => setParam('enabled', v)}
            options={[
              { value: '', label: m.approvals.filterAll },
              { value: 'true', label: m.handlings.on },
              { value: 'false', label: m.handlings.off },
            ]}
          />
          {/* 고른 SKU 일괄 변경 줄(고르면 나타난다 — Shopify 일괄 작업 줄처럼) */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-primary/5 px-5 py-2.5 text-sm">
              <span className="font-semibold text-primary">{m.handlings.selected(selected.size)}</span>
              <span className="text-xs text-base-content/60">{`${m.handlings.batch} (${selected.size}) · ${m.handlings.batchAllOrNothing}`}</span>
              <div className="ml-auto flex gap-2">
                <select aria-label={m.handlings.batch} className="select select-sm w-28" value={batchEnabled ? 'true' : 'false'} onChange={(e) => setBatchEnabled(e.target.value === 'true')}>
                  <option value="true">{m.handlings.turnOn}</option>
                  <option value="false">{m.handlings.turnOff}</option>
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={batch.busy}
                  onClick={() =>
                    void batch.run({
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                      items: rows.filter((r) => selected.has(r.sku)).map((r) => ({ sku: r.sku, enabled: batchEnabled, expectedVersion: r.version })),
                    })
                  }
                >
                  {m.handlings.batch}
                </button>
              </div>
            </div>
          )}
          <QueryState state={toUiState(query, (d) => (d.items?.length ?? 0) === 0)} onRetry={() => void query.refetch()}>
            {(d) => (
              <>
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th className="w-10" />
                        <th>SKU · {m.products.productId}</th>
                        <th>{m.handlings.skuState}</th>
                        <th>{m.handlings.filter}</th>
                        <th>{m.handlings.updatedAt}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(d.items ?? []).map((row) => (
                        <HandlingRow
                          key={`${row.sku}-${row.version}`}
                          type={type}
                          centerId={centerId}
                          row={row}
                          reason={reason.trim()}
                          checked={selected.has(row.sku)}
                          onCheck={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(row.sku);
                            else next.delete(row.sku);
                            setSelected(next);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
                  <span className="text-base-content/55">{m.handlings.shown(d.items?.length ?? 0, Boolean(d.page?.nextCursor))}</span>
                  {d.page?.nextCursor && (
                    <button type="button" className="btn btn-sm" onClick={() => setParam('cursor', d.page?.nextCursor ?? '')}>
                      {m.more}
                    </button>
                  )}
                </div>
              </>
            )}
          </QueryState>
        </div>
      )}
      <CommandFeedback command={batch}>
        {(r) => (
          <p role="status" className="text-success text-sm">
            {r.changedCount === undefined ? m.handlings.applied : m.handlings.changed(r.changedCount)}
          </p>
        )}
      </CommandFeedback>
    </section>
  );
}
