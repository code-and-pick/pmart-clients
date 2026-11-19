// 가격 바꾸기 — 한 자리에서 끝나는 흐름(2026-11-20 사용자 "가격 바꾸기 누르면 상품 조회로 나가지고, 오른쪽 팝업, 맨 아래로 가고… 사용자 흐름을 생각 안 했다").
// 같은 부품을 상품 상세 "가격" 탭과 가격 관리 오른쪽 서랍에서 쓴다. 다른 화면으로 보내거나 아래로 스크롤하지 않는다.
// 흐름: SKU 마다 지금 가격 옆에 새 가격 → (적용 시각: 승인되면 바로 / 시각 지정) → "가격 변경 승인 요청" 한 번.
// 승인되면 pricing-service 가 ApprovalDecided(PRICE) 로 가격 버전을 만들고 적용 시각에 바뀐다(pricing 계약 /price-version-applications 설명) —
// 그래서 예전 "반영 확인"(승인 번호를 다시 넣는 대조 단계)은 이 흐름에서 뺐다. 금액은 서버 값을 표시만, 미설정은 0원이 아니라 "미설정".
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, randomUuid, request } from '@pmart/web-core';
import { formatKrw, useCommand } from '@pmart/web-ui';
import { requestApproval } from '../../api/approvalFlow';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { priceChangeBody } from './PricePage';

const f = m.prices.form;
const PRICE_NOT_SET = 'PRICE_NOT_SET';

/** 지금 가격(서버 값) — 미설정은 0원이 아니라 "미설정", 못 읽으면 "?" */
function useNowPrice(sku: string): { readonly text: string; readonly amount: number | null; readonly notSet: boolean } {
  const api = useApi();
  const q = useQuery({ queryKey: ['pricing', 'price', sku], queryFn: () => request('GET', api.pricing.GET('/prices/{sku}', { params: { path: { sku } } })) });
  const notSet = q.error instanceof ProblemFailure && q.error.problem.code === PRICE_NOT_SET;
  if (notSet) return { text: m.prices.list.notSet, amount: null, notSet: true };
  if (q.data) return { text: formatKrw(q.data.basePrice), amount: q.data.basePrice, notSet: false };
  return { text: q.isError ? '?' : '…', amount: null, notSet: false };
}

/** SKU 가 무엇인지 — 상품 이름(상품 조회와 같은 queryKey, 다시 안 읽음). 상품 탭 안에서는 이름 대신 단위만 넘겨받는다 */
function useSkuName(sku: string, skip: boolean): string {
  const api = useApi();
  const skuQ = useQuery({ queryKey: ['product', 'sku', sku], enabled: !skip, queryFn: () => request('GET', api.product.GET('/skus/{sku}', { params: { path: { sku } } })) });
  const productId = skuQ.data?.productId;
  const productQ = useQuery({
    queryKey: ['product', 'detail', productId ?? ''],
    enabled: !skip && Boolean(productId),
    queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId: productId ?? '' } } })),
  });
  if (skip) return '';
  if (skuQ.isError || productQ.isError) return '?';
  return productQ.data?.internalName ?? '…';
}

function Row({ sku, label, value, onValue, locked }: { readonly sku: string; readonly label: string | undefined; readonly value: string; readonly onValue: (v: string) => void; readonly locked: boolean }) {
  const now = useNowPrice(sku);
  const name = useSkuName(sku, label !== undefined);
  const next = /^\d+$/.test(value) ? Number(value) : null;
  const diff = next !== null && now.amount !== null ? next - now.amount : null;
  return (
    <tr data-testid="price-form-row">
      <td>
        <p className="font-mono text-sm font-semibold">{sku}</p>
        <p className="truncate text-xs text-base-content/60">{label ?? name}</p>
      </td>
      <td className={`text-right tabular-nums ${now.notSet ? 'font-semibold text-error' : ''}`} data-testid="price-form-now">
        {now.text}
      </td>
      <td className="text-right">
        <label className="input input-sm w-36">
          <input
            aria-label={f.newPriceOf(sku)}
            className="text-right tabular-nums"
            inputMode="numeric"
            placeholder={f.newPricePlaceholder}
            disabled={locked}
            value={value}
            onChange={(e) => onValue(e.target.value.replace(/[^\d]/g, ''))}
          />
          <span className="text-xs text-base-content/50">원</span>
        </label>
        {diff !== null && diff !== 0 && (
          <p className={`mt-0.5 text-xs tabular-nums ${diff > 0 ? 'text-error' : 'text-info'}`} data-testid="price-form-diff">
            {f.diff(diff)}
          </p>
        )}
      </td>
    </tr>
  );
}

/** labels: SKU → 줄 아래 작은 글씨(상품 탭에서는 단위). 없으면 상품 이름을 읽어 보인다 */
export function PriceChangeForm({ skus, labels }: { readonly skus: readonly string[]; readonly labels?: Readonly<Record<string, string>> }) {
  const api = useApi();
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [when, setWhen] = useState<'approved' | 'at'>('approved');
  const [at, setAt] = useState('');
  const send = useCommand((body: Parameters<typeof requestApproval>[1], key) => requestApproval(api, body, key));
  const done = send.phase.kind === 'done' ? send.phase.result : null;

  const filled = skus.filter((s) => (values[s] ?? '') !== '');
  const ok = filled.length > 0 && filled.every((s) => /^\d+$/.test(values[s] ?? '') && Number(values[s]) > 0) && (when === 'approved' || at !== '');
  const reset = () => {
    setValues({});
    setWhen('approved');
    setAt('');
    send.reset();
  };

  if (done)
    return (
      <div className="space-y-3 rounded-box border border-success/30 bg-success/10 px-4 py-4" role="status" data-testid="price-form-done">
        <p className="font-semibold text-success">{f.requested(filled.length)}</p>
        <p className="text-sm">{when === 'at' ? f.appliesAt(at.replace('T', ' ')) : f.appliesOnApproval}</p>
        <div className="flex flex-wrap gap-2">
          {done.approvalId && (
            <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(done.approvalId)}`} data-testid="price-form-approval">
              {f.openApproval}
            </Link>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
            {f.again}
          </button>
        </div>
      </div>
    );

  const locked = send.busy;
  return (
    <div className="space-y-3" data-testid="price-form">
      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>{f.sku}</th>
              <th className="text-right">{f.now}</th>
              <th className="text-right">{f.next}</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <Row key={s} sku={s} label={labels?.[s]} value={values[s] ?? ''} locked={locked} onValue={(v) => setValues((x) => ({ ...x, [s]: v }))} />
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" disabled={locked}>
        <legend className="sr-only">{f.when}</legend>
        <span className="text-xs font-medium text-base-content/60">{f.when}</span>
        <label className="flex items-center gap-1.5">
          <input type="radio" className="radio radio-sm" name="price-when" checked={when === 'approved'} onChange={() => setWhen('approved')} />
          {f.onApproval}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" className="radio radio-sm" name="price-when" checked={when === 'at'} onChange={() => setWhen('at')} />
          {f.atTime}
        </label>
        {when === 'at' && <input type="datetime-local" aria-label={f.atTime} className="input input-sm" value={at} onChange={(e) => setAt(e.target.value)} />}
      </fieldset>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!ok || locked}
          data-testid="price-form-submit"
          onClick={() =>
            void send.run(
              priceChangeBody(
                filled.map((s) => ({ sku: s, basePrice: values[s] ?? '', effectiveFrom: '' })),
                when === 'at' ? at : '',
                randomUuid(),
              ),
            )
          }
        >
          {filled.length > 1 ? f.submitMany(filled.length) : f.submit}
        </button>
      </div>
      <CommandFeedback command={send}>{() => null}</CommandFeedback>
    </div>
  );
}
