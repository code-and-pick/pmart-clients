// 가격 일괄 등록(백엔드 안내 2026-11-03): seed-v1 zip 업로드 → 서버가 묶음 가격으로 행을 미리 채움 → 운영자가 행마다 고치거나 뺌
// → 공통 효력 시각으로 제출(잠김) → PRICE 승인 요청 한 건 → 승인 뒤 행별 반영 결과.
// 화면은 zip 을 풀지 않고 가격을 미리 채우지 않는다. 금액·구분·상태는 서버 값을 표시만 한다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { ProblemFailure } from '@pmart/web-core';
import type { PriceImportBatch, PriceImportLine, PriceImportLineUpdate } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, reasonText } from '../../shared/Feedback';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { BatchApprovals, multipart, ZipUpload } from '../products/ProductImportPage';
import { seoulInputToIso } from './PricePage';
import { DataTable, PageHeader } from '../../shared/admin';

const batchKey = (batchId: string) => ['pricing', 'import-batch', batchId] as const;

const money = (v: number | null | undefined) => (v === null || v === undefined ? m.prices.noCurrent : formatKrw(v));

function useImportUpload() {
  const api = useApi();
  const navigate = useNavigate();
  return useCommand((file: File, key) =>
    request(
      'POST',
      api.pricing.POST('/price-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file }) }),
    ).then((b) => {
      void navigate(`/prices/import/${encodeURIComponent(b.batchId)}`);
      return b;
    }),
  );
}

export function NewPriceImportPage() {
  const upload = useImportUpload();
  return (
    <section className="space-y-4">
      <PageHeader title={m.prices.importTitle} />
      <p className="text-sm opacity-80">{m.prices.importHint}</p>
      <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
      <CommandFeedback command={upload} />
    </section>
  );
}

/** 행 하나의 고치기·되돌리기·빼기. 응답(배치 전체)으로 표를 갱신한다. 버전이 어긋나면 새로 불러온다. */
function useLineUpdate(batch: PriceImportBatch) {
  const api = useApi();
  const queryClient = useQueryClient();
  const cmd = useCommand(async (v: { seedProductId: string; body: PriceImportLineUpdate }, key) => {
    try {
      const next = await request(
        'PUT',
        api.pricing.PUT('/price-import-batches/{batchId}/lines/{seedProductId}', {
          ...commandParams(key, { path: { batchId: batch.batchId, seedProductId: v.seedProductId }, version: batch.version }),
          body: v.body,
        }),
      );
      queryClient.setQueryData(batchKey(batch.batchId), next);
      return next;
    } catch (e) {
      if (e instanceof ProblemFailure && e.problem.code === 'VERSION_CONFLICT') {
        await queryClient.invalidateQueries({ queryKey: batchKey(batch.batchId) });
      }
      throw e;
    }
  });
  return cmd;
}

function LineRow({ batch, line }: { readonly batch: PriceImportBatch; readonly line: PriceImportLine }) {
  const editable = batch.state === 'DRAFT';
  const name = line.productName ?? line.seedProductId;
  const [input, setInput] = useState(line.basePrice === null || line.basePrice === undefined ? '' : String(line.basePrice));
  const update = useLineUpdate(batch);
  const typed = /^\d+$/.test(input.trim()) ? Number(input.trim()) : null;
  const changed = typed !== null && typed !== (line.basePrice ?? null);
  // 빼기·되돌리기 때도 고친 값은 유지한다(서버 규칙: basePrice null = 묶음 값으로).
  const keep = line.edited ? (line.basePrice ?? null) : null;

  return (
    <tr data-status={line.status} className={line.excluded ? 'opacity-60' : ''}>
      <td>{name}</td>
      <td>{line.sku ?? m.none}</td>
      <td>{money(line.currentPrice)}</td>
      <td>{money(line.bundlePrice)}</td>
      <td>
        {editable && !line.excluded ? (
          <div className="flex items-center gap-1">
            <input
              aria-label={m.prices.priceInputFor(name)}
              className="input input-xs w-24"
              inputMode="numeric"
              value={input}
              disabled={update.busy}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-xs"
              aria-label={m.prices.saveLineFor(name)}
              disabled={update.busy || typed === null || typed < 1 || !changed}
              onClick={() => void update.run({ seedProductId: line.seedProductId, body: { basePrice: typed, excluded: false } })}
            >
              {m.prices.saveLine}
            </button>
            {line.edited && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                aria-label={m.prices.revertLineFor(name)}
                disabled={update.busy}
                onClick={() => void update.run({ seedProductId: line.seedProductId, body: { basePrice: null, excluded: false } })}
              >
                {m.prices.revertLine}
              </button>
            )}
          </div>
        ) : (
          money(line.basePrice)
        )}
        {line.edited && <span className="badge badge-outline badge-xs ml-1">{m.prices.edited}</span>}
      </td>
      <td>{line.changeType ? m.prices.changeTypeName[line.changeType] : m.none}</td>
      <td>
        <span data-testid={`status-${line.seedProductId}`}>{m.prices.lineStatusName[line.status]}</span>
        {update.phase.kind === 'rejected' && <CommandFeedback command={update} />}
        {update.phase.kind === 'unknown' && <CommandFeedback command={update} />}
      </td>
      <td>
        {editable ? (
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            aria-label={m.prices.excludeFor(name)}
            checked={line.excluded}
            disabled={update.busy}
            onChange={(e) => void update.run({ seedProductId: line.seedProductId, body: { basePrice: keep, excluded: e.target.checked } })}
          />
        ) : line.excluded ? (
          m.prices.exclude
        ) : (
          ''
        )}
      </td>
      <td>
        {line.result?.state && (
          <span data-testid={`result-${line.seedProductId}`}>
            {`${m.prices.lineResultName[line.result.state]}${line.result.priceVersion ? ` v${line.result.priceVersion}` : ''}${
              line.result.reasonCode ? ` · ${reasonText(line.result.reasonCode)}` : ''
            }`}
          </span>
        )}
      </td>
    </tr>
  );
}

function AnotherUpload() {
  const upload = useImportUpload();
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{m.products.uploadAnother}</h2>
      <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
      <CommandFeedback command={upload} />
    </div>
  );
}

export function PriceImportPage() {
  const { batchId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const query = useQuery({
    queryKey: batchKey(batchId),
    queryFn: () => request('GET', api.pricing.GET('/price-import-batches/{batchId}', { params: { path: { batchId } } })),
  });

  const refresh = useCommand(async (version: number, key) => {
    const next = await request(
      'POST',
      api.pricing.POST('/price-import-batches/{batchId}/refreshes', { ...commandParams(key, { path: { batchId }, version }) }),
    );
    queryClient.setQueryData(batchKey(batchId), next);
    return next;
  });

  const submit = useCommand(async (v: { version: number; effectiveFrom: string }, key) => {
    const iso = seoulInputToIso(v.effectiveFrom);
    const r = await request(
      'POST',
      api.pricing.POST('/price-import-batches/{batchId}/submissions', {
        ...commandParams(key, { path: { batchId }, version: v.version }),
        body: iso ? { effectiveFrom: iso } : {},
      }),
    );
    // 서버가 제출 직전에 다시 대조한다 — 응답 batch 로 표를 갱신한다.
    queryClient.setQueryData(batchKey(batchId), r.batch);
    return r;
  });

  return (
    <section className="space-y-4">
      <PageHeader title={`${m.prices.importTitle} · ${m.products.batch(batchId)}`} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => (
          <>
            <p className="text-sm" data-testid="batch-summary">
              {`${m.prices.batchStateName[b.state]} · ${m.prices.batchSummary(b.lineCount, b.submittableCount)}`}
              {b.checkedAt && ` · ${m.prices.checkedAt} ${formatSeoul(b.checkedAt)}`}
              {b.effectiveFrom && ` · ${m.prices.effectiveFrom} ${formatSeoul(b.effectiveFrom)}`}
            </p>
            {b.approvalId && (
              <Link className="link text-sm" to={`/approvals/${encodeURIComponent(b.approvalId)}`}>
                {m.prices.approvalOf(b.approvalId)}
              </Link>
            )}
            {b.state !== 'DRAFT' && <p className="text-sm opacity-80">{m.prices.lockedHint}</p>}
            <div className="overflow-x-auto">
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.prices.productName}</th>
                    <th>{m.prices.sku}</th>
                    <th>{m.prices.currentPrice}</th>
                    <th>{m.prices.bundlePrice}</th>
                    <th>{m.prices.basePriceInput}</th>
                    <th>{m.prices.changeType}</th>
                    <th>{m.prices.lineStatus}</th>
                    <th>{m.prices.exclude}</th>
                    <th>{m.prices.lineResult}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.lines.map((l) => (
                    <LineRow key={`${l.seedProductId}:${l.basePrice ?? ''}:${l.excluded}`} batch={b} line={l} />
                  ))}
                </tbody>
              </DataTable>
            </div>

            {b.state === 'DRAFT' && (
              <div className="space-y-3 rounded-box border border-base-300 bg-base-100 shadow-sm p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-sm" disabled={refresh.busy || submit.busy} onClick={() => void refresh.run(b.version)}>
                    {m.prices.refresh}
                  </button>
                  <span className="text-xs text-base-content/60">{m.prices.refreshHint}</span>
                </div>
                <CommandFeedback command={refresh} />
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col text-sm">
                    {m.prices.submitEffectiveFrom}
                    <input type="datetime-local" className="input input-sm" value={effectiveFrom} disabled={submit.busy} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={submit.busy || submit.phase.kind === 'done' || b.submittableCount === 0}
                    onClick={() => void submit.run({ version: b.version, effectiveFrom })}
                  >
                    {m.prices.submitBatch}
                  </button>
                  <span className="text-xs text-base-content/60">{m.prices.submitHint}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void query.refetch()}>
                {m.checkAgain}
              </button>
            </div>
            <CommandFeedback command={submit}>
              {(r) => (
                <p role="status" className="text-sm">
                  {m.prices.submitted(r.approvalRequest.lines.length)}
                </p>
              )}
            </CommandFeedback>
            {/* BR-41 회신: 승인 대기 동안 배치 조회의 approvalRequest 로 "승인 요청"을, 승인 목록(targetRef)으로 상세 링크를 보인다. */}
            {b.state !== 'DRAFT' && <BatchApprovals targetRef={`priceImportBatch:${batchId}`} pending={b.approvalRequest} />}
          </>
        )}
      </QueryState>
      <AnotherUpload key={batchId} />
    </section>
  );
}
