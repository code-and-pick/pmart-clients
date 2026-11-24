// 가격 일괄 등록(백엔드 안내 2026-11-03): seed-v1 zip 업로드 → 서버가 묶음 가격으로 행을 미리 채움 → 운영자가 행마다 고치거나 뺌
// → 공통 효력 시각으로 제출(잠김) → PRICE 승인 요청 한 건 → 승인 뒤 행별 반영 결과.
// 화면(2026-11-18 사용자 "밋밋하다"): 머리(상태 배지)·단계 표시·숫자 카드 → 한 카드 안 가격 행 표 → 제출 카드(대조·효력 시각·제출 버튼 오른쪽 아래).
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
import { BATCH_TONE, BatchApprovals, multipart, UploadLayout, ZipUpload } from '../products/ProductImportPage';
import { seoulInputToIso } from './PricePage';
import { NextAction, PageHeader, StatusBadge } from '../../shared/admin';
import { Card, JumpLink, MiniStat, Steps, tableClass, TitleWithId } from '../products/parts';
import { DateTimeField } from '../../shared/DateTimeField';

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
      <UploadLayout steps={m.prices.importSteps}>
        <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
        <CommandFeedback command={upload} />
      </UploadLayout>
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

const CHANGE_CLASS: Readonly<Record<string, string>> = { NEW: 'badge-info', CHANGE: 'badge-warning', UNCHANGED: 'badge-ghost' };
const STATUS_TONE: Readonly<Record<string, 'success' | 'warning' | 'error' | 'ghost'>> = {
  READY: 'success',
  EXCLUDED: 'ghost',
  UNCHANGED: 'ghost',
  SKU_NOT_FOUND: 'warning',
  PRICE_REQUIRED: 'error',
  DUPLICATE_SKU: 'error',
};

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
      <td className="font-medium">{name}</td>
      <td className="font-mono text-xs">{line.sku ?? m.none}</td>
      <td className="tabular-nums text-base-content/70">{money(line.currentPrice)}</td>
      <td className="tabular-nums">{money(line.bundlePrice)}</td>
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
      <td>{line.changeType ? <span className={`badge badge-sm badge-soft ${CHANGE_CLASS[line.changeType] ?? ''}`}>{m.prices.changeTypeName[line.changeType]}</span> : m.none}</td>
      <td>
        <StatusBadge tone={STATUS_TONE[line.status] ?? 'ghost'} testId={`status-${line.seedProductId}`}>
          {m.prices.lineStatusName[line.status]}
        </StatusBadge>
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

/**
 * 다음 할 일(2026-11-18 사용자 "직관적이지 않다") — 서버 배치 state·submittableCount 만으로 하나를 고른다.
 * 버튼은 이 쪽의 구역(제출 카드·행 표·승인 현황·다른 파일 올리기)으로 내려가기만 한다.
 */
function PriceBatchNextAction({ state, submittable }: { readonly state: PriceImportBatch['state']; readonly submittable: number }) {
  switch (state) {
    case 'DRAFT':
      return submittable > 0 ? (
        <NextAction title={m.prices.nextAction.batchSubmit(submittable)} body={m.prices.nextAction.batchSubmitBody}>
          <JumpLink to="batch-submit">{m.products.go.submit}</JumpLink>
        </NextAction>
      ) : (
        <NextAction tone="warning" title={m.prices.nextAction.batchNone} body={m.prices.nextAction.batchNoneBody}>
          <JumpLink to="batch-submit">{m.products.go.submit}</JumpLink>
        </NextAction>
      );
    case 'SUBMITTED':
      return (
        <NextAction title={m.products.next.batchApproval}>
          <JumpLink to="batch-approvals">{m.products.go.approvals}</JumpLink>
        </NextAction>
      );
    case 'APPLIED':
      return <NextAction tone="success" title={m.products.next.batchApplied} />;
    case 'PARTIALLY_APPLIED':
      return (
        <NextAction tone="warning" title={m.products.next.batchPartial} body={m.prices.nextAction.batchPartialBody}>
          <JumpLink to="batch-rows">{m.products.go.rows}</JumpLink>
        </NextAction>
      );
    default:
      return (
        <NextAction tone="error" title={m.products.next.batchRejected}>
          <JumpLink to="another-upload">{m.products.go.upload}</JumpLink>
        </NextAction>
      );
  }
}

function AnotherUpload() {
  const upload = useImportUpload();
  return (
    <div id="another-upload" className="scroll-mt-4 space-y-2">
      <h2 className="font-bold">{m.products.uploadAnother}</h2>
      {/* 다른 파일 올리기 — 틀 안에(2026-11-19 올리기 상자가 틀 없이 번호 줄만 되어서) */}
      <div className="rounded-box border border-base-300 bg-base-100 px-6 pb-5 shadow-sm">
        <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
      </div>
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
      <PageHeader
        back={{ to: '/prices/import', label: m.prices.importTitle }}
        title={query.data ? <TitleWithId title={m.prices.batchHeading(query.data.lineCount)} id={m.products.batch} /> : m.products.batch}
        actions={query.data ? <StatusBadge tone={BATCH_TONE[query.data.state] ?? 'ghost'}>{m.prices.batchStateName[query.data.state]}</StatusBadge> : null}
      />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => (
          <>
            <Steps steps={m.prices.importSteps} now={b.state === 'DRAFT' ? 1 : 3} label={m.prices.stepsLabel} />
            <PriceBatchNextAction state={b.state} submittable={b.submittableCount} />
            <div className="pm-stat-strip flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
              <MiniStat label={m.prices.statLines} value={b.lineCount} />
              <MiniStat label={m.prices.statSubmittable} value={b.submittableCount} tone={b.submittableCount > 0 ? 'success' : 'muted'} />
              <div className="flex-[2_1_20rem] bg-base-100 px-5 py-4 text-sm">
                <p data-testid="batch-summary">
                  {`${m.prices.batchStateName[b.state]} · ${m.prices.batchSummary(b.lineCount, b.submittableCount)}`}
                  {b.checkedAt && ` · ${m.prices.checkedAt} ${formatSeoul(b.checkedAt)}`}
                  {b.effectiveFrom && ` · ${m.prices.effectiveFrom} ${formatSeoul(b.effectiveFrom)}`}
                </p>
                {b.approvalId && (
                  <Link className="link link-primary text-sm" to={`/approvals/${encodeURIComponent(b.approvalId)}`}>
                    {m.prices.approvalOf(b.approvalId)}
                  </Link>
                )}
              </div>
            </div>
            {b.state !== 'DRAFT' && <p className="rounded-box bg-base-300/50 px-4 py-3 text-sm text-base-content/75">{m.prices.lockedHint}</p>}
            <div id="batch-rows" className="scroll-mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
                <h2 className="font-bold">{m.prices.linesCard}</h2>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => void query.refetch()}>
                  {m.checkAgain}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className={tableClass}>
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
                </table>
              </div>
            </div>

            {b.state === 'DRAFT' && (
              <Card
                id="batch-submit"
                title={m.prices.submitTitle}
                hint={m.prices.submitHint}
                footer={
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={submit.busy || submit.phase.kind === 'done' || b.submittableCount === 0}
                    onClick={() => void submit.run({ version: b.version, effectiveFrom })}
                  >
                    {m.prices.submitBatch}
                  </button>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-sm" disabled={refresh.busy || submit.busy} onClick={() => void refresh.run(b.version)}>
                    {m.prices.refresh}
                  </button>
                  <span className="text-xs text-base-content/60">{m.prices.refreshHint}</span>
                </div>
                <CommandFeedback command={refresh} />
                <label className="flex w-fit flex-col gap-1 text-sm">
                  <span className="text-xs font-medium text-base-content/60">{m.prices.submitEffectiveFrom}</span>
                  <DateTimeField value={effectiveFrom} disabled={submit.busy} onChange={setEffectiveFrom} />
                </label>
              </Card>
            )}
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
