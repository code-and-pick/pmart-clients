// 상품 상세·SKU·판매 상태 변경. 일시품절·판매 재개는 바로, 판매중지는 PRODUCT 승인 뒤 approvalId 와 함께(2026-10-30 결정).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { SALE_STATES, type ChangeRequestBody, type ProductDetail, type SaleState } from '../../api/models';
import { ProblemFailure, request } from '@pmart/web-core';
import { settleCommand } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';

/** handoff 2026-10-30 §4.3 판매중지 변경 요청 본문 */
export function saleStopApprovalBody(productId: string, reason: string): ChangeRequestBody {
  return {
    type: 'PRODUCT',
    targetService: 'product-service',
    targetRef: `SALE-STATE:${productId}`,
    allowedActions: ['CHANGE_SALE_STATE'],
    summary: `판매중지: ${reason}`,
    lines: [{ lineKey: productId, attributes: { saleState: 'SALE_STOPPED' } }],
  };
}

function SaleStateChange({ product }: { readonly product: ProductDetail }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const productId = product.productId ?? '';
  const [saleState, setSaleState] = useState<SaleState>(product.saleState === 'ON_SALE' ? 'TEMPORARILY_SOLD_OUT' : 'ON_SALE');
  const [reason, setReason] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [approvalBody, setApprovalBody] = useState<ChangeRequestBody | null>(null);

  const change = useCommand(
    async (v: { saleState: SaleState; reason: string; approvalId: string; version: number | undefined }, key) => {
      const r = await settleCommand(
        key,
        () =>
          request(
            'POST',
            api.product.POST('/products/{productId}/sale-state-changes', {
              ...commandParams(key, { path: { productId }, version: v.version }),
              body: { saleState: v.saleState, reason: v.reason, ...(v.approvalId ? { approvalId: v.approvalId } : {}) },
            }),
          ),
        (requestId) =>
          request(
            'GET',
            api.product.GET('/products/{productId}/sale-state-changes/{requestId}', {
              params: { path: { productId, requestId } },
            }),
          ),
      );
      await queryClient.invalidateQueries({ queryKey: ['product'] });
      return r;
    },
  );

  const stop = saleState === 'SALE_STOPPED';
  return (
    <div className="space-y-3 rounded-box bg-base-100 p-4">
      <h2 className="font-bold">{m.products.changeSaleState}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">
          {m.products.saleState}
          <select
            className="select select-sm"
            value={saleState}
            onChange={(e) => setSaleState(SALE_STATES.find((s) => s === e.target.value) ?? 'ON_SALE')}
          >
            {SALE_STATES.map((s) => (
              <option key={s} value={s}>
                {m.products.saleStateName[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          {m.reasonLabel}
          <input className="input input-sm" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {stop && (
          <label className="flex flex-col text-sm">
            {m.products.approvalIdLabel}
            <input className="input input-sm" value={approvalId} onChange={(e) => setApprovalId(e.target.value)} />
          </label>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={change.busy || !reason.trim()}
          onClick={() =>
            void change.run({ saleState, reason: reason.trim(), approvalId: stop ? approvalId.trim() : '', version: product.version })
          }
        >
          {m.products.applyChange}
        </button>
      </div>
      {stop && (
        <div className="space-y-2">
          <p className="text-sm">{m.products.stopNeedsApproval}</p>
          {approvalBody ? (
            <RequestApproval body={approvalBody} onRequested={(r) => r.approvalId && setApprovalId(r.approvalId)} />
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              disabled={!reason.trim()}
              onClick={() => setApprovalBody(saleStopApprovalBody(productId, reason.trim()))}
            >
              {m.approvals.requestApproval}
            </button>
          )}
        </div>
      )}
      <CommandFeedback command={change}>
        {() => (
          <div role="status" className="alert alert-success">
            {m.products.changeApplied}
          </div>
        )}
      </CommandFeedback>
    </div>
  );
}

/**
 * 상품 정보 수정 시작(product 0.3.0 `POST /products/{productId}/edit-drafts`, 백엔드 요청 2026-11-17 request-product-edit).
 * 서버가 현재 승인 값으로 채운 수정 초안을 만들면 그 초안 화면으로 간다. 이미 열린 수정 초안이 있으면(409 EDIT_DRAFT_EXISTS) 그 초안으로 안내.
 */
function EditStart({ productId }: { readonly productId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const start = useCommand((_: null, key) =>
    request('POST', api.product.POST('/products/{productId}/edit-drafts', { ...commandParams(key, { path: { productId } }) })).then((d) => {
      void navigate(`/products/drafts/${encodeURIComponent(d.draftId)}`);
      return d;
    }),
  );
  const failure = start.phase.kind === 'rejected' ? start.phase.failure : null;
  const existing =
    failure instanceof ProblemFailure && failure.problem.code === 'EDIT_DRAFT_EXISTS'
      ? failure.problem.details.find((x) => x.field === 'existingDraftId')?.reason
      : undefined;
  // 0.3.2: MD 가 아니면 403 — 일반 권한 문구 대신 'MD 만' 안내(백엔드 알림 2026-11-17 notice-product-edit-md-only)
  const notMd = failure instanceof ProblemFailure && failure.problem.code === 'FORBIDDEN';
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" disabled={start.busy} onClick={() => void start.run(null)}>
          {m.products.editStart}
        </button>
        <span className="text-xs opacity-70">{m.products.editStartHint}</span>
      </div>
      {existing ? (
        <div role="alert" className="alert alert-warning text-sm" data-testid="product-edit-exists">
          <span>{m.products.editDraftExists}</span>
          <Link className="link" to={`/products/drafts/${encodeURIComponent(existing)}`}>
            {m.products.editDraftOpen(existing)}
          </Link>
        </div>
      ) : notMd ? (
        <div role="alert" className="alert alert-warning text-sm" data-testid="product-edit-not-md">
          {m.products.editForbidden}
        </div>
      ) : (
        <CommandFeedback command={start} />
      )}
    </div>
  );
}

export function ProductDetailPage() {
  const { productId = '' } = useParams();
  const api = useApi();
  // 판매 상태 변경·상품 정보 수정 시작(product 0.3.2)은 MD 만(백엔드 알림 2026-11-15 product-menu-operator-admin) — 그 밖 역할(OPERATOR_ADMIN)에는 버튼을 숨긴다. 판정은 서버(403).
  const canChangeSaleState = useSession().session?.roles.includes('MD') ?? false;
  const query = useQuery({
    queryKey: ['product', 'detail', productId],
    queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId } } })),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{m.products.detailTitle(productId)}</h1>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(p) => (
          <>
            <dl className="grid grid-cols-[10rem_1fr] gap-1 rounded-box bg-base-100 p-4 text-sm">
              <dt>{m.products.internalName}</dt>
              <dd>{p.internalName ?? m.none}</dd>
              <dt>{m.products.saleState}</dt>
              <dd data-testid="sale-state">{p.saleState ? m.products.saleStateName[p.saleState] : m.none}</dd>
              <dt>{m.products.version}</dt>
              <dd>{p.version ?? m.none}</dd>
              <dt>{m.products.primaryCategoryId}</dt>
              <dd>{p.primaryCategoryId ?? m.none}</dd>
              <dt>{m.products.categoryIds}</dt>
              <dd>{(p.categoryIds ?? []).join(', ') || m.none}</dd>
              <dt>{m.approvals.dossier}</dt>
              <dd>
                {p.approvalId ? (
                  <Link className="link" to={`/approvals/${encodeURIComponent(p.approvalId)}`}>
                    {p.approvalId}
                  </Link>
                ) : (
                  m.none
                )}
              </dd>
              <dt>{m.products.publishedAt}</dt>
              <dd>{p.publishedAt ? formatSeoul(p.publishedAt) : m.none}</dd>
            </dl>
            {/* 고객용 상품명·설명·이미지는 콘텐츠(product-content-service, DISPLAY 승인)로 따로 등록한다. */}
            <Link className="btn btn-sm" to={`/contents/drafts/new?productId=${encodeURIComponent(productId)}`}>
              {m.products.addContent}
            </Link>
            {canChangeSaleState ? (
              <EditStart productId={productId} />
            ) : (
              <p className="rounded-box bg-base-100 p-4 text-sm opacity-70">{m.products.editMdOnly}</p>
            )}
            <h2 className="font-bold">{m.products.skus}</h2>
            <table className="table table-sm bg-base-100">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>{m.products.unitType}</th>
                  <th>{m.products.unitsPerSku}</th>
                  <th>{m.products.weightG}</th>
                  <th>{m.products.storageType}</th>
                  <th>{m.products.barcodes}</th>
                  <th>{m.products.saleState}</th>
                </tr>
              </thead>
              <tbody>
                {(p.skus ?? []).map((s) => (
                  <tr key={s.sku}>
                    <td>
                      <Link className="link" to={`/prices?sku=${encodeURIComponent(s.sku)}`}>
                        {s.sku}
                      </Link>
                    </td>
                    <td>{m.products.unitName[s.unitType]}</td>
                    <td>{s.unitsPerSku}</td>
                    <td>{s.weightG ?? m.notSet}</td>
                    <td>{s.logistics?.storageType ? m.products.storageName[s.logistics.storageType] : m.none}</td>
                    <td>{(s.barcodes ?? []).join(', ') || m.none}</td>
                    <td>{m.products.saleStateName[s.saleState]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canChangeSaleState ? (
              <SaleStateChange key={p.productId} product={p} />
            ) : (
              <p className="rounded-box bg-base-100 p-4 text-sm opacity-70">{m.products.saleStateMdOnly}</p>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
