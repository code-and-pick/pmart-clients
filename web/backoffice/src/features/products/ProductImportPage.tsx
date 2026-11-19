// 상품 일괄 등록(seed-v1 zip) → 상품별 검증 → 유효 행 제출 준비 → PRODUCT 승인(1건 + 행 N개) → id-map.
// 화면(2026-11-18 사용자 "밋밋하다 — Shopify·Medusa 처럼"): 올리기 화면은 단계 표시 + 점선 파일 상자,
// 배치 화면은 머리(상태 배지·단계) → 숫자 카드(전체·유효·오류) → 한 카드 안 상품 행 표(이름 굵게·초안 ID 작게) + 아래 작업 줄 → 승인 현황 카드.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { PmartFailure } from '@pmart/web-core';
import { type ApprovalRequestBody, type ImportBatch, STORAGE_TYPES, type ProductDraft, type ProductDraftInput, type StorageType } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, FailureAlert, reasonText } from '../../shared/Feedback';
import { fieldWhere } from '../../shared/hideIds';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { DraftProblems } from './ProductDraftPage';
import { NextAction, PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { Card, JumpLink, MiniStat, Steps, tableClass, TitleWithId } from './parts';

const REVIEW_TONE: Readonly<Record<string, Tone>> = {
  REVIEW_PENDING: 'warning',
  EVIDENCE_REQUIRED: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'info',
  REJECTED: 'error',
};

/** 배치 상태 배지 색(상품·콘텐츠·가격 배치가 같이 쓴다) */
export const BATCH_TONE: Readonly<Record<string, Tone>> = {
  VALIDATED: 'info',
  UPLOADED: 'info',
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  APPLIED: 'success',
  PUBLISHED: 'success',
  PARTIALLY_APPLIED: 'warning',
  PARTIALLY_PUBLISHED: 'warning',
  REJECTED: 'error',
};

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
    <Card id="batch-approvals" title={m.products.approvals} label={m.products.approvals}>
      {ids.length > 0 && (
        <ul className="divide-y divide-base-300 text-sm">
          {ids.map((id) => {
            const a = found.find((x) => x.approvalId === id);
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link className="link link-primary font-medium" to={`/approvals/${encodeURIComponent(id)}`}>
                    {m.approvals.open}
                  </Link>
                </span>
                {a?.reviewState && <StatusBadge tone={REVIEW_TONE[a.reviewState] ?? 'ghost'}>{m.approvals.reviewState[a.reviewState]}</StatusBadge>}
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
      {list.isSuccess && ids.length === 0 && !pending && requested === null && <p className="text-sm text-base-content/60">{m.products.approvalNone}</p>}
    </Card>
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
  const u = m.products.uploadView;
  // 2026-11-19 쿠팡 윙 "상품 일괄등록" 참고: 번호 붙은 줄(1. 파일 고르기 2. 서버 검사) + 가운데 큰 올리기 단추. 이름표·버튼 이름은 그대로
  return (
    <div className="divide-y divide-base-300" data-testid="zip-upload">
      <div className="grid gap-3 py-4 md:grid-cols-[14rem_1fr]">
        <p className="text-sm font-medium">{u.step1}</p>
        <label
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-7 text-center transition-colors ${file ? 'border-primary/40 bg-primary/5' : 'border-base-300 hover:border-primary/40 hover:bg-base-200/60'}`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
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
          <span className="text-xs text-base-content/55">{file ? m.products.zipChosen(file.name, Math.max(1, Math.round(file.size / 1024))) : null}</span>
        </label>
      </div>
      <div className="flex justify-center pt-5">
        <button type="button" className="btn btn-primary gap-2 px-8" disabled={!file || busy} onClick={() => file && onUpload(file)}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16" />
          </svg>
          {m.products.upload}
        </button>
      </div>
    </div>
  );
}

/**
 * 올리기 화면 공통 짜임(상품·콘텐츠·가격 일괄 등록) — 2026-11-19 쿠팡 윙 "상품 일괄등록" 참고:
 * 화면 너비 그대로 "파일 올리기 요청" 접는 상자(단계 표시 · 번호 줄 · 큰 단추). 주의 띠·[주의] 한 줄은 뺐다(2026-11-20 사용자 "쓸데없는 말 다 지워" — 단계 표시로 흐름이 보인다).
 */
export function UploadLayout({ steps, children }: { readonly steps: readonly string[]; readonly children: ReactNode }) {
  const u = m.products.uploadView;
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-4">
      <section className="rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={u.sectionTitle}>
        <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-base-300 px-6 py-4 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="text-lg font-semibold">{u.sectionTitle}</span>
          <span className="flex items-center gap-4">
            <Steps steps={steps} now={0} />
            <span className="text-base-content/50" aria-hidden="true">
              {open ? '▴' : '▾'}
            </span>
          </span>
        </button>
        {open && <div className="space-y-3 px-6 pb-5">{children}</div>}
      </section>
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
      <UploadLayout steps={m.products.importSteps}>
        <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
        <CommandFeedback command={upload} />
      </UploadLayout>
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
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm" aria-label={`${m.products.fillInvalid} ${name}`}>
      <span className="self-center text-xs text-base-content/60">{m.products.volumeHint(sku?.volumeMl)}</span>
      <label className="flex flex-col text-xs">
        {m.products.weightG}
        <input className="input input-xs w-24" inputMode="numeric" value={weightG} onChange={(e) => setWeightG(e.target.value)} />
      </label>
      <label className="flex flex-col text-xs">
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
      <button type="button" className="btn btn-xs btn-primary" disabled={save.busy || (!weightG.trim() && !storageType)} onClick={() => void save.run(null)}>
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

/**
 * 다음 할 일(2026-11-18 사용자 "직관적이지 않다") — 서버 배치 state 와 행의 검증 결과 수만으로 하나를 고른다.
 * 버튼은 이 쪽의 구역(행 표·승인 현황·다른 파일 올리기)으로 내려가기만 한다.
 */
function BatchNextAction({ state, valid, invalid }: { readonly state: ImportBatch['state']; readonly valid: number; readonly invalid: number }) {
  switch (state) {
    case 'VALIDATED':
      if (invalid > 0) {
        return (
          <NextAction tone="warning" title={m.products.next.batchFix(invalid)} body={m.products.next.batchFixBody(valid)}>
            <JumpLink to="batch-rows">{m.products.go.rows}</JumpLink>
          </NextAction>
        );
      }
      return valid > 0 ? (
        <NextAction title={m.products.next.batchSubmit(valid)}>
          <JumpLink to="batch-rows">{m.products.go.rows}</JumpLink>
        </NextAction>
      ) : (
        <NextAction tone="warning" title={m.products.next.batchNone} />
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
        <NextAction tone="warning" title={m.products.next.batchPartial}>
          <JumpLink to="batch-approvals">{m.products.go.approvals}</JumpLink>
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

const importStep = (state: ImportBatch['state']) => (state === 'VALIDATED' ? 1 : state === 'SUBMITTED' ? 3 : 4);

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
      <PageHeader
        back={{ to: '/products/import', label: m.products.importTitle }}
        title={query.data ? <TitleWithId title={m.products.batchHeading(query.data.productCount)} id={m.products.batch} /> : m.products.batch}
        actions={
          query.data ? <StatusBadge tone={BATCH_TONE[query.data.state] ?? 'ghost'} testId="batch-state">{m.products.batchStateName[query.data.state] ?? query.data.state}</StatusBadge> : null
        }
      />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => {
          const counts = batchCounts(b);
          // 다음 할 일은 아래 BatchNextAction(서버 state·행 검증 결과만)
          const updates = (b.drafts ?? []).filter((d) => d.state === 'DRAFT' && d.registration === 'UPDATE').length;
          return (
            <>
              <Steps steps={m.products.importSteps} now={importStep(b.state)} />
              <BatchNextAction state={b.state} valid={counts.valid} invalid={counts.invalid} />
              <div className="grid grid-cols-3 gap-3" data-testid="batch-counts">
                <MiniStat label={m.products.statTotal} value={b.productCount} testId="batch-total" />
                <MiniStat label={m.products.statValid} value={counts.valid} tone="success" testId="batch-valid" />
                <MiniStat label={m.products.statInvalid} value={counts.invalid} tone={counts.invalid > 0 ? 'error' : 'muted'} testId="batch-invalid" />
              </div>
              {updates > 0 && (
                <p role="status" className="alert alert-warning alert-soft text-sm">
                  {m.products.updateNotice(updates)}
                </p>
              )}
              <div id="batch-rows" className="scroll-mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
                  <h2 className="font-bold">{m.products.rowsTitle}</h2>
                  {(b.drafts ?? []).some((d) => d.state === 'DRAFT' && d.validationState !== 'VALID') && (
                    <p className="max-w-2xl text-xs text-base-content/60">{m.products.fillInvalidHint}</p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>{m.products.internalName}</th>
                        <th>{m.contents.rowHead.sourceKey}</th>
                        <th>{m.products.registration}</th>
                        <th>{m.products.validation}</th>
                        <th>SKU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(b.drafts ?? []).map((d) => (
                        <tr key={d.draftId} className="align-top">
                          <td className="min-w-48">
                            <p className="font-medium">{d.input?.product.internalName ?? m.none}</p>
                            <Link className="text-xs text-primary hover:underline" to={`/products/drafts/${encodeURIComponent(d.draftId)}`}>
                              {m.products.openDraftShort}
                            </Link>
                          </td>
                          <td className="font-mono text-xs">{d.sourceKey ?? m.none}</td>
                          <td>
                            {/* 재업로드 = 기존 상품의 새 버전(BR-39 회신). 승인자·운영자가 새 등록인지 갱신인지 바로 본다. */}
                            {d.registration === 'UPDATE' ? (
                              <span className="badge badge-warning badge-soft badge-sm gap-1" title={m.products.registrationName.UPDATE}>
                                {m.products.registrationName.UPDATE}
                                {d.existingProductId && (
                                  <Link className="link" to={`/products/${encodeURIComponent(d.existingProductId)}`}>
                                    {d.existingProductId}
                                  </Link>
                                )}
                              </span>
                            ) : d.registration === 'NEW' ? (
                              <span className="badge badge-info badge-soft badge-sm">{m.products.registrationName.NEW}</span>
                            ) : null}
                          </td>
                          <td className="min-w-64">
                            <DraftProblems draft={d} />
                            {d.state === 'DRAFT' && d.validationState !== 'VALID' && d.input && (
                              <FillMissing key={`${d.draftId}-${d.version}`} draft={d} batchId={batchId} />
                            )}
                            {/* VALID 가 된 뒤에도 제출(잠금) 전이면 초안 화면에서 전체를 고칠 수 있다. */}
                            {d.state === 'DRAFT' && (
                              <Link className="link link-primary mt-1 inline-block text-xs" to={`/products/drafts/${encodeURIComponent(d.draftId)}`}>
                                {m.products.update}
                              </Link>
                            )}
                          </td>
                          <td>
                            {(d.resultSkus ?? []).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {(d.resultSkus ?? []).map((s) => (
                                  <span key={s} className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-xs">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* 아래 작업 줄: 보조 동작 왼쪽, 제출(주 동작) 오른쪽 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 bg-base-200/40 px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-sm" disabled={idMap.busy} onClick={() => void idMap.run(undefined)}>
                      {m.products.idMap}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void query.refetch()}>
                      {m.checkAgain}
                    </button>
                  </div>
                  {b.state === 'VALIDATED' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={submit.busy || submit.phase.kind === 'done' || counts.valid === 0}
                      onClick={() => void submit.run(null)}
                    >
                      {m.products.submitBatch}
                    </button>
                  )}
                </div>
              </div>
              <CommandFeedback command={idMap} />
              <CommandFeedback command={submit}>
                {(r) =>
                  (r.excludedDraftIds?.length ?? 0) > 0 ? (
                    // 빠진 초안은 ID 와 함께 배치 행의 서버 사유(검증 상태·problems)를 보인다.
                    <div className="space-y-1 rounded-box border border-warning/40 bg-warning/5 px-4 py-3 text-sm" aria-label={m.products.excluded}>
                      <p className="font-bold">{`${m.products.excluded} ${r.excludedDraftIds?.length ?? 0}`}</p>
                      <ul className="list-disc pl-5">
                        {(r.excludedDraftIds ?? []).map((id) => {
                          const d = (b.drafts ?? []).find((x) => x.draftId === id);
                          const why = d
                            ? [`${m.products.draftStateName[d.state] ?? d.state} · ${m.products.validationName[d.validationState] ?? d.validationState}`, ...(d.problems ?? []).map((p) => `${fieldWhere(p.field) ? `${fieldWhere(p.field)} ` : ''}${reasonText(p.code)}`)].join(' · ')
                            : m.none;
                          return <li key={id}>{`${d?.input?.product.internalName || d?.sourceKey || m.products.unnamed}: ${why}`}</li>;
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
