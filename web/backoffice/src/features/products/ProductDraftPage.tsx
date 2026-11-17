// 상품 초안 1건: 새로 만들기 / 조회·수정·제출 준비 → PRODUCT 승인 요청 → 반영 결과(productId·SKU).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import type { ProductDraft, ProductDraftInput } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, reasonText } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { ProductDraftForm } from './ProductDraftForm';
import { PageHeader } from '../../shared/admin';

export function DraftProblems({ draft }: { readonly draft: ProductDraft }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        {`${m.products.state}: ${draft.state} · ${m.products.validation}: `}
        <span className={draft.validationState === 'VALID' ? 'text-success' : 'text-error'}>{draft.validationState}</span>
      </p>
      {(draft.problems?.length ?? 0) > 0 && (
        <ul className="list-disc pl-5" aria-label={m.products.problems}>
          {(draft.problems ?? []).map((p, i) => (
            <li key={`${p.code}-${i}`}>{`${reasonText(p.code)}${p.field ? ` (${p.field})` : ''}${p.detail ? ` — ${p.detail}` : ''}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewProductDraftPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState('');
  const create = useCommand((body: ProductDraftInput, key) =>
    request('POST', api.product.POST('/product-drafts', { ...commandParams(key), body })).then((d) => {
      void navigate(`/products/drafts/${encodeURIComponent(d.draftId)}`);
      return d;
    }),
  );

  return (
    <section className="space-y-4">
      <PageHeader title={m.products.draftTitle} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (openId.trim()) void navigate(`/products/drafts/${encodeURIComponent(openId.trim())}`);
        }}
      >
        {/* BR-26: 초안 목록 API 가 없어 ID 로 연다 */}
        <input
          aria-label={m.products.openDraft}
          placeholder={m.products.openDraft}
          className="input input-sm"
          value={openId}
          onChange={(e) => setOpenId(e.target.value)}
        />
        <button type="submit" className="btn btn-sm">
          {m.search}
        </button>
      </form>
      <ProductDraftForm
        submitLabel={m.products.create}
        busy={create.busy}
        onSubmit={(input) => void create.run(input)}
      />
      <CommandFeedback command={create} />
    </section>
  );
}

export function ProductDraftPage() {
  const { draftId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['product', 'draft', draftId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => request('GET', api.product.GET('/product-drafts/{draftId}', { params: { path: { draftId } } })),
  });

  const update = useCommand(async ({ body, version }: { body: ProductDraftInput; version: number }, k) => {
    const d = await request(
      'PUT',
      api.product.PUT('/product-drafts/{draftId}', { ...commandParams(k, { path: { draftId }, version: version }), body }),
    );
    queryClient.setQueryData(key, d);
    return d;
  });
  const submit = useCommand(async (_: null, k) => {
    const r = await request(
      'POST',
      api.product.POST('/product-drafts/{draftId}/submissions', { ...commandParams(k, { path: { draftId } }) }),
    );
    await queryClient.invalidateQueries({ queryKey: key });
    return r;
  });

  return (
    <section className="space-y-4">
      <PageHeader title={m.products.draftDetail(draftId)} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            {/* product 0.3.0 수정 초안(edit-drafts): input.targetProductId = 고칠 상품 */}
            {d.input?.targetProductId && (
              <div className="space-y-1 rounded-box border border-base-300 bg-base-100 p-3 text-sm" data-testid="product-edit-note">
                <p className="font-bold">
                  {`${m.products.editOf} — `}
                  <Link className="link" to={`/products/${encodeURIComponent(d.input.targetProductId)}`}>
                    {d.input.targetProductId}
                  </Link>
                </p>
                <p className="opacity-80">{m.products.editNote}</p>
              </div>
            )}
            <DraftProblems draft={d} />
            {d.state === 'DRAFT' && d.input && (
              <ProductDraftForm
                key={d.version}
                initial={d.input}
                edit={Boolean(d.input.targetProductId)}
                submitLabel={m.products.update}
                busy={update.busy}
                onSubmit={(body) => void update.run({ body, version: d.version })}
              />
            )}
            <CommandFeedback command={update} />
            {d.state === 'DRAFT' && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={submit.busy || d.validationState !== 'VALID'}
                onClick={() => void submit.run(null)}
              >
                {m.products.submit}
              </button>
            )}
            <CommandFeedback command={submit}>
              {(r) => (
                <div className="space-y-2">
                  <p role="status" className="text-sm">
                    {m.products.locked}
                  </p>
                  <RequestApproval body={r.approvalRequest} />
                </div>
              )}
            </CommandFeedback>
            {d.approvalId && (
              <p className="text-sm">
                <Link className="link" to={`/approvals/${encodeURIComponent(d.approvalId)}`}>
                  {`${m.approvals.open} (${d.approvalId})`}
                </Link>
              </p>
            )}
            <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
              <h2 className="font-bold">{m.products.result}</h2>
              {d.state === 'APPLIED' && d.resultProductId ? (
                <p>
                  <Link className="link" to={`/products/${encodeURIComponent(d.resultProductId)}`}>
                    {d.resultProductId}
                  </Link>
                  {` · ${(d.resultSkus ?? []).join(', ')}`}
                </p>
              ) : (
                <p className="opacity-70">
                  {m.products.resultPending}
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => void query.refetch()}>
                    {m.checkAgain}
                  </button>
                </p>
              )}
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}
