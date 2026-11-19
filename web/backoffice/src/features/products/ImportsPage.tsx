// 일괄 등록 — 파일 한 번 올리기(2026-11-19 사용자 "콘텐츠 일괄 등록이랑 상품 일괄 등록이 같잖아" → 추천안 "그렇게 만들어").
// 근거(계약): 세 일괄 등록이 모두 같은 seed-v1.zip 을 받고 서비스마다 다른 부분만 읽는다.
//   - product `POST /product-import-batches`: product.json 의 product·skus 만("이미지·content 는 product-content-service 가 같은 묶음을 따로 받는다")
//   - product-content `POST /content-import-batches`: content 블록과 images/ 만, (source.system, seedProductId) 로 upsert — 같은 묶음을 다시 올려도 늘지 않음
//   - pricing `POST /price-import-batches`: 가격 — 승인 전 새 상품은 SKU_NOT_FOUND, 상품 승인 뒤 배치 화면 "다시 대조"로 푼다
//   그래서 화면은 한 파일을 고른 서비스마다 따로 보낸다(서비스마다 다른 Idempotency-Key, 결과도 따로 — 셋을 묶어 성공이라 하지 않는다).
//   제출·승인은 지금처럼 배치마다 따로(상품 → 콘텐츠·가격). 하나가 거절되면 그것만 다시 보내고, 결과 불명이면 같은 키로 결과를 확인한다.
// 옛 주소(/products/import·/contents/import·/prices/import)와 배치 화면은 그대로 열린다.
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand, type Command } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components as Content } from '../../api/generated/product-content';
import type { components as Pricing } from '../../api/generated/pricing';
import type { components as Product } from '../../api/generated/product';
import { useApi } from '../../app/ApiContext';
import { PageHeader } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { multipart, UploadLayout, ZipUpload } from './ProductImportPage';

const m = messages.products.imports;
type Part = 'product' | 'content' | 'price';
const PARTS: readonly Part[] = ['product', 'content', 'price'];
const BATCH_PATH: Readonly<Record<Part, string>> = { product: '/products/import', content: '/contents/import', price: '/prices/import' };

type ProductBatch = Product['schemas']['ImportBatch'];
type ContentBatch = Content['schemas']['ContentImportBatch'];
type PriceBatch = Pricing['schemas']['PriceImportBatch'];

export function ImportsPage() {
  const api = useApi();
  const [pick, setPick] = useState<ReadonlySet<Part>>(new Set(PARTS));
  const [file, setFile] = useState<File | null>(null);
  const product = useCommand((f: File, key) => request('POST', api.product.POST('/product-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file: f }) })));
  const content = useCommand((f: File, key) => request('POST', api.content.POST('/content-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file: f }) })));
  const price = useCommand((f: File, key) => request('POST', api.pricing.POST('/price-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file: f }) })));
  const cmds = { product, content, price } as const;
  const busy = PARTS.some((p) => cmds[p].busy);
  const upload = async (f: File) => {
    setFile(f);
    // 요청마다 파일 사본 — 한 파일을 세 요청이 동시에 읽다가 한쪽 스트림이 끊기는 일을 막는다
    const bytes = await f.arrayBuffer();
    const copy = () => new File([bytes], f.name, { type: f.type });
    // 서로 기다리지 않고 따로 보낸다 — 하나가 늦거나 실패해도 나머지 결과는 그대로
    for (const p of PARTS) if (pick.has(p)) void cmds[p].run(copy());
  };
  const toggle = (p: Part) =>
    setPick((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const sent = PARTS.filter((p) => cmds[p].phase.kind !== 'idle');
  return (
    <section className="space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <UploadLayout steps={m.steps} intro={m.caution} cautions={[m.cautionOrder]}>
        <fieldset className="flex flex-wrap items-center gap-4 py-3" aria-label={m.pickLabel} data-testid="imports-pick">
          <legend className="sr-only">{m.pickLabel}</legend>
          <span className="text-sm font-medium">{m.pickLabel}</span>
          {PARTS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={pick.has(p)} disabled={busy} onChange={() => toggle(p)} />
              {m.part[p]}
              <span className="text-xs text-base-content/50">{m.partReads[p]}</span>
            </label>
          ))}
        </fieldset>
        {pick.size === 0 ? (
          <p className="py-3 text-sm text-warning" data-testid="imports-none">
            {m.pickNone}
          </p>
        ) : (
          <ZipUpload busy={busy} onUpload={(f) => void upload(f)} />
        )}
      </UploadLayout>
      {sent.length > 0 && (
        <section aria-label={m.resultTitle} className="space-y-3" data-testid="imports-results">
          <h2 className="text-lg font-bold">{m.resultTitle}</h2>
          <p className="text-sm text-base-content/60">{m.resultIntro}</p>
          <div className="grid gap-3 lg:grid-cols-3">
            {sent.map((p, i) => (
              <ResultCard key={p} part={p} order={i + 1} command={cmds[p] as Command<File, unknown>} file={file} />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function ResultCard({ part, order, command, file }: { readonly part: Part; readonly order: number; readonly command: Command<File, unknown>; readonly file: File | null }) {
  const phase = command.phase;
  return (
    <article className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" data-testid={`imports-result-${part}`}>
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{order}</span>
        {m.part[part]}
      </h3>
      <CommandFeedback command={command}>{(b) => <Summary part={part} batch={b} />}</CommandFeedback>
      {/* 거절은 확정 — 이것만 새로 보낸다(새 키). 결과 불명은 위 "같은 요청으로 결과 확인"(같은 키) */}
      {phase.kind === 'rejected' && file && (
        <button type="button" className="btn btn-sm" onClick={() => void command.run(file)} data-testid={`imports-retry-${part}`}>
          {m.retry}
        </button>
      )}
    </article>
  );
}

function Summary({ part, batch }: { readonly part: Part; readonly batch: unknown }) {
  const id = (batch as { batchId?: string }).batchId ?? '';
  const open = (
    <Link className="btn btn-sm btn-primary" to={`${BATCH_PATH[part]}/${encodeURIComponent(id)}`} data-testid={`imports-open-${part}`}>
      {m.openBatch}
    </Link>
  );
  if (part === 'product') {
    const b = batch as ProductBatch;
    return (
      <div className="space-y-2 text-sm">
        <p role="status">{m.sum.product(b.productCount, b.validCount, b.invalidCount)}</p>
        <p className="text-xs text-base-content/55">{m.next.product}</p>
        {open}
      </div>
    );
  }
  if (part === 'content') {
    const b = batch as ContentBatch;
    return (
      <div className="space-y-2 text-sm">
        <p role="status">{m.sum.content(b.productCount, b.imageCount, b.createdCount, b.unchangedCount)}</p>
        <p className="text-xs text-base-content/55">{m.next.content}</p>
        {open}
      </div>
    );
  }
  const b = batch as PriceBatch;
  const noSku = b.lines.filter((l) => l.status === 'SKU_NOT_FOUND').length;
  return (
    <div className="space-y-2 text-sm">
      <p role="status">{m.sum.price(b.lineCount, b.submittableCount)}</p>
      {/* 새 상품은 승인 전 SKU 가 없다 — 오류처럼 보이지 않고 "승인 뒤 다시 대조"로 */}
      {noSku > 0 && (
        <p className="text-xs text-info" data-testid="imports-price-nosku">
          {m.sum.priceNoSku(noSku)}
        </p>
      )}
      <p className="text-xs text-base-content/55">{m.next.price}</p>
      {open}
    </div>
  );
}
