// 상품 일괄 등록(seed-v1 zip) → 상품별 검증 → 유효 행 제출 준비 → PRODUCT 승인(1건 + 행 N개) → id-map.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { PmartFailure } from '@pmart/web-core';
import { type ApprovalRequestBody, type ImportBatch, STORAGE_TYPES, type ProductDraft, type ProductDraftInput, type StorageType } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, FailureAlert, reasonText } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { DraftProblems } from './ProductDraftPage';
import { DataTable, PageHeader } from '../../shared/admin';

/**
 * 제출한 배치의 승인 요청 현황(BR-41 회신 2026-11-03). 승인 목록을 `GET /approvals?targetRef=` 로 정확히 찾아 링크·심사 상태를 보이고,
 * 아직 올리지 않았으면 배치 조회가 돌려준 제출 본문(`pendingSubmission.approvalRequest` 등)으로 "승인 요청" 버튼을 보인다.
 * 화면을 떠났다 와도 서버 값으로 다시 그리므로 탭 저장소가 필요 없다. 상품·콘텐츠·가격 배치가 같이 쓴다.
 */
export function BatchApprovals({ targetRef, pending }: { readonly targetRef: string; readonly pending?: ApprovalRequestBody | null | undefined }) {
  const api = useApi();
  const queryClient = useQueryClient();
  // 이 화면에서 올린 승인 ID. RequestApproval 이 결과(승인 번호·링크)를 보이는 동안 목록에서 겹쳐 보이지 않게 뺀다.
  const [requested, setRequested] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['approval', 'list', 'target', targetRef],
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { targetRef, size: 50 } } })),
  });
  const found = (list.data?.items ?? []).filter((a) => a.targetRef === targetRef && a.approvalId && a.approvalId !== requested);
  const ids = found.map((a) => a.approvalId ?? '');
  const showRequest = !!pending && list.isSuccess && (found.length === 0 || requested !== null);

  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-4" aria-label={m.products.approvals}>
      <h2 className="font-bold">{m.products.approvals}</h2>
      {ids.length > 0 && (
        <ul className="space-y-1 text-sm">
          {ids.map((id) => {
            const a = found.find((x) => x.approvalId === id);
            return (
              <li key={id}>
                <Link className="link" to={`/approvals/${encodeURIComponent(id)}`}>
                  {m.approvals.open}
                </Link>
                {` · ${id}${a?.reviewState ? ` · ${m.approvals.reviewState[a.reviewState]}` : ''}`}
              </li>
            );
          })}
        </ul>
      )}
      {list.isPending && <p className="text-sm text-base-content/60">{m.loading}</p>}
      {list.error instanceof PmartFailure && (
        <div>
          <FailureAlert failure={list.error} />
          <button type="button" className="btn btn-xs mt-1" onClick={() => void list.refetch()}>
            {m.retry}
          </button>
        </div>
      )}
      {showRequest && pending && (
        <RequestApproval
          body={pending}
          onRequested={(r) => {
            setRequested(r.approvalId ?? '');
            void queryClient.invalidateQueries({ queryKey: ['approval', 'list'] });
          }}
        />
      )}
      {list.isSuccess && ids.length === 0 && !pending && requested === null && <p className="text-sm">{m.products.approvalNone}</p>}
    </div>
  );
}

/** multipart 본문. openapi-fetch 는 FormData 를 그대로 보내고 Content-Type 경계를 브라우저에 맡긴다. */
export const multipart = (fields: Record<string, Blob | string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return { bodySerializer: () => form };
};

export function ZipUpload({
  busy,
  onUpload,
}: {
  readonly busy: boolean;
  readonly onUpload: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  // 점선 파일 상자(2026-11-18 화면 다듬기) — 이름표·버튼 이름은 그대로
  return (
    <div className="space-y-4 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm" data-testid="zip-upload">
      <label
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${file ? 'border-primary/40 bg-primary/5' : 'border-base-300 hover:border-primary/40 hover:bg-base-200/60'}`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
          </svg>
        </span>
        <span className="font-semibold">{m.products.zipFile}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label={m.products.zipFile}
          className="file-input file-input-sm w-full max-w-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <span className="text-xs text-base-content/55">{file ? m.products.zipChosen(file.name, Math.max(1, Math.round(file.size / 1024))) : m.products.zipHint}</span>
      </label>
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary btn-sm" disabled={!file || busy} onClick={() => file && onUpload(file)}>
          {m.products.upload}
        </button>
      </div>
    </div>
  );
}

/** seed-v1.zip 을 올려 배치를 만들고(검증까지 서버가 한다) 그 배치 화면으로 간다. */
function useImportUpload() {
  const api = useApi();
  const navigate = useNavigate();
  return useCommand((file: File, key) =>
    request(
      'POST',
      api.product.POST('/product-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file }) }),
    ).then((b) => {
      void navigate(`/products/import/${encodeURIComponent(b.batchId)}`);
      return b;
    }),
  );
}

export function NewProductImportPage() {
  const upload = useImportUpload();
  return (
    <section className="space-y-4">
      <PageHeader title={m.products.importTitle} />
      <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
      <CommandFeedback command={upload} />
    </section>
  );
}

/**
 * INVALID 초안의 빠진 값(중량·보관 방식)을 배치 화면에서 바로 채운다(백엔드 요청 2026-11-02 §3-2).
 * 값을 미리 채우지 않는다 — 운영자가 상품명·용량을 보고 넣는다. 저장은 `PUT /product-drafts/{id}`(입력 전체, 버전 확인) → 서버 재검증.
 */
function FillMissing({ draft, batchId }: { readonly draft: ProductDraft; readonly batchId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const sku = draft.input?.skus[0];
  const [weightG, setWeightG] = useState(sku?.weightG === undefined ? '' : String(sku.weightG));
  const [storageType, setStorageType] = useState<StorageType | ''>(sku?.storageType ?? '');
  const save = useCommand(async (_: null, key) => {
    const input = draft.input;
    if (!input || !sku) throw new Error('input');
    const w = /^\d+$/.test(weightG.trim()) ? Number(weightG.trim()) : undefined;
    const first = {
      ...sku,
      ...(w === undefined ? {} : { weightG: w }),
      ...(storageType ? { storageType } : {}),
    };
    const body: ProductDraftInput = { ...input, skus: [first, ...input.skus.slice(1)] };
    const d = await request(
      'PUT',
      api.product.PUT('/product-drafts/{draftId}', { ...commandParams(key, { path: { draftId: draft.draftId }, version: draft.version }), body }),
    );
    await queryClient.invalidateQueries({ queryKey: ['product', 'import-batch', batchId] });
    return d;
  });
  const name = draft.input?.product.internalName ?? draft.draftId;
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm" aria-label={`${m.products.fillInvalid} ${name}`}>
      <span className="opacity-70">{m.products.volumeHint(sku?.volumeMl)}</span>
      <label className="flex flex-col">
        {m.products.weightG}
        <input className="input input-xs w-24" inputMode="numeric" value={weightG} onChange={(e) => setWeightG(e.target.value)} />
      </label>
      <label className="flex flex-col">
        {m.products.storageType}
        <select className="select select-xs" value={storageType} onChange={(e) => setStorageType(STORAGE_TYPES.find((s) => s === e.target.value) ?? '')}>
          <option value="">{m.none}</option>
          {STORAGE_TYPES.map((s) => (
            <option key={s} value={s}>
              {m.products.storageName[s]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-xs" disabled={save.busy || (!weightG.trim() && !storageType)} onClick={() => void save.run(null)}>
        {m.products.fillSave}
      </button>
      <CommandFeedback command={save}>{() => <span className="text-success">{m.products.fillSaved(name)}</span>}</CommandFeedback>
    </div>
  );
}

/** 배치 화면에서 바로 다른 파일을 올린다(다른 메뉴로 갔다 올 필요 없음). 배치가 바뀌면 새로 시작한다(key). */
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

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 배치의 유효·오류 수를 응답의 행에서 직접 센다. 서버의 `validCount`·`invalidCount` 는 업로드 때 값으로 고정돼
 * 행을 고쳐 VALID 가 된 뒤에도 "유효 0" 이다(BR-38). 행 목록이 없을 때만 서버 수를 쓴다.
 */
export function batchCounts(b: Pick<ImportBatch, 'validCount' | 'invalidCount' | 'drafts'>): { valid: number; invalid: number } {
  const drafts = b.drafts;
  if (!drafts) return { valid: b.validCount, invalid: b.invalidCount };
  const valid = drafts.filter((d) => d.validationState === 'VALID').length;
  return { valid, invalid: drafts.length - valid };
}

export function ProductImportPage() {
  const { batchId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['product', 'import-batch', batchId],
    queryFn: () => request('GET', api.product.GET('/product-import-batches/{batchId}', { params: { path: { batchId } } })),
  });
  const queryClient = useQueryClient();
  const submit = useCommand(async (_: null, key) => {
    const r = await request(
      'POST',
      api.product.POST('/product-import-batches/{batchId}/submissions', { ...commandParams(key, { path: { batchId } }) }),
    );
    // 배치를 다시 읽으면(SUBMITTED) 서버의 pendingSubmission 으로 승인 요청 현황 영역이 그려진다(BR-41).
    await queryClient.invalidateQueries({ queryKey: ['product', 'import-batch', batchId] });
    return r;
  });
  const idMap = useCommand(async () => {
    const map = await request(
      'GET',
      api.product.GET('/product-import-batches/{batchId}/id-map', { params: { path: { batchId } } }),
    );
    downloadJson('id-map.json', map);
    return map;
  });

  return (
    <section className="space-y-4">
      <PageHeader title={m.products.batch(batchId)} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => {
          const counts = batchCounts(b);
          return (
          <>
            <p className="text-sm">{`${b.state} · ${m.products.counts(b.productCount, counts.valid, counts.invalid)}`}</p>
            {(b.drafts ?? []).some((d) => d.state === 'DRAFT' && d.validationState !== 'VALID') && (
              <p className="text-sm opacity-80">{m.products.fillInvalidHint}</p>
            )}
            {(() => {
              const updates = (b.drafts ?? []).filter((d) => d.state === 'DRAFT' && d.registration === 'UPDATE').length;
              return updates > 0 ? (
                <p role="status" className="alert alert-warning alert-soft text-sm">
                  {m.products.updateNotice(updates)}
                </p>
              ) : null;
            })()}
            <DataTable>
              <tbody>
                {(b.drafts ?? []).map((d) => (
                  <tr key={d.draftId}>
                    <td>
                      <Link className="link" to={`/products/drafts/${encodeURIComponent(d.draftId)}`}>
                        {d.draftId}
                      </Link>
                    </td>
                    <td>{d.sourceKey ?? m.none}</td>
                    <td>
                      {/* 재업로드 = 기존 상품의 새 버전(BR-39 회신). 승인자·운영자가 새 등록인지 갱신인지 바로 본다. */}
                      {d.registration === 'UPDATE' ? (
                        <span className="badge badge-warning badge-sm gap-1" title={m.products.registrationName.UPDATE}>
                          {m.products.registrationName.UPDATE}
                          {d.existingProductId && (
                            <Link className="link" to={`/products/${encodeURIComponent(d.existingProductId)}`}>
                              {d.existingProductId}
                            </Link>
                          )}
                        </span>
                      ) : d.registration === 'NEW' ? (
                        <span className="badge badge-ghost badge-sm">{m.products.registrationName.NEW}</span>
                      ) : null}
                    </td>
                    <td>{d.input?.product.internalName ?? m.none}</td>
                    <td>
                      <DraftProblems draft={d} />
                      {d.state === 'DRAFT' && d.validationState !== 'VALID' && d.input && (
                        <FillMissing key={`${d.draftId}-${d.version}`} draft={d} batchId={batchId} />
                      )}
                      {/* VALID 가 된 뒤에도 제출(잠금) 전이면 초안 화면에서 전체를 고칠 수 있다. */}
                      {d.state === 'DRAFT' && (
                        <Link className="link text-sm" to={`/products/drafts/${encodeURIComponent(d.draftId)}`}>
                          {m.products.update}
                        </Link>
                      )}
                    </td>
                    <td>{d.resultSkus?.join(', ') ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <div className="flex gap-2">
              {b.state === 'VALIDATED' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={submit.busy || submit.phase.kind === 'done' || counts.valid === 0}
                  onClick={() => void submit.run(null)}
                >
                  {m.products.submitBatch}
                </button>
              )}
              <button type="button" className="btn btn-sm" disabled={idMap.busy} onClick={() => void idMap.run(undefined)}>
                {m.products.idMap}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void query.refetch()}>
                {m.checkAgain}
              </button>
            </div>
            <CommandFeedback command={idMap} />
            <CommandFeedback command={submit}>
              {(r) =>
                (r.excludedDraftIds?.length ?? 0) > 0 ? (
                  // 빠진 초안은 ID 와 함께 배치 행의 서버 사유(검증 상태·problems)를 보인다.
                  <div className="space-y-1 text-sm" aria-label={m.products.excluded}>
                    <p className="font-bold">{`${m.products.excluded} ${r.excludedDraftIds?.length ?? 0}`}</p>
                    <ul className="list-disc pl-5">
                      {(r.excludedDraftIds ?? []).map((id) => {
                        const d = (b.drafts ?? []).find((x) => x.draftId === id);
                        const why = d
                          ? [`${d.state} · ${d.validationState}`, ...(d.problems ?? []).map((p) => `${reasonText(p.code)}${p.field ? ` (${p.field})` : ''}`)].join(' · ')
                          : m.none;
                        return <li key={id}>{`${id}${d?.sourceKey ? ` (${d.sourceKey})` : ''}: ${why}`}</li>;
                      })}
                    </ul>
                  </div>
                ) : null
              }
            </CommandFeedback>
            {b.state !== 'VALIDATED' && (
              <BatchApprovals targetRef={`productImportBatch:${batchId}`} pending={b.pendingSubmission?.approvalRequest} />
            )}
          </>
          );
        }}
      </QueryState>
      <AnotherUpload key={batchId} />
    </section>
  );
}
