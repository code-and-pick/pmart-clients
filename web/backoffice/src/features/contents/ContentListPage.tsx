// 콘텐츠 조회(2026-11-19 사용자 "콘텐츠 조회 기능이 추가됐으면") — 상품마다 고객에게 보이는 콘텐츠(사진·고객용 이름)가 게시됐는지.
// 계약만: 상품 목록 GET /products(쪽) + 게시 카드 일괄 GET /product-contents?productIds=(최대 100, 미게시는 missing).
// 줄을 누르면 오른쪽에 게시된 콘텐츠 전체(GET /product-contents/{id} — 사진·설명·안내). 작성 중 초안 목록은 계약에 없어 아직 못 보인다
// (백엔드 요청 handoff backoffice/2026-11-19-backend-content-draft-list). 숫자 카드는 불러온 상품 기준(서버가 세지 않음).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { GuideBox, PageHeader, StatCard, StatStrip, StatusBadge } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { PreviewDrawer, usePreview } from '../../shared/Preview';
import { LineIcon, tableClass } from '../products/parts';
import { AuthedImage } from './AuthedImage';
import { ContentGallery } from './ContentGallery';

const m = messages.contents.listView;
const PAGE = 50;
type View = 'all' | 'published' | 'missing';

export function ContentListPage() {
  const api = useApi();
  const pv = usePreview();
  const [params] = useSearchParams();
  const view: View = (['published', 'missing'] as const).find((v) => v === params.get('view')) ?? 'all';
  const [text, setText] = useState('');

  const products = useInfiniteQuery({
    queryKey: ['contents', 'products'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => request('GET', api.product.GET('/products', { params: { query: { size: PAGE, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const all = useMemo(() => (products.data?.pages ?? []).flatMap((p) => p.items ?? []), [products.data]);
  const ids = useMemo(() => all.flatMap((p) => (p.productId ? [p.productId] : [])), [all]);
  // 게시 카드 — 100건씩(계약 최대). 이 화면은 쪽마다 50개라 쪽 수만큼
  const chunks = useMemo(() => Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100)), [ids]);
  const cards = useQuery({
    queryKey: ['product-contents', 'cards-all', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rs = await Promise.all(chunks.map((c) => request('GET', api.content.GET('/product-contents', { params: { query: { productIds: c } } }))));
      return { items: rs.flatMap((r) => r.items ?? []), missing: rs.flatMap((r) => r.missing ?? []) };
    },
  });
  const cardOf = useMemo(() => new Map((cards.data?.items ?? []).flatMap((c) => (c.productId ? [[c.productId, c] as const] : []))), [cards.data]);
  const missing = useMemo(() => new Set(cards.data?.missing ?? []), [cards.data]);
  const stateOf = (id: string | undefined) => (!id || !cards.data ? undefined : cardOf.has(id) ? 'published' : missing.has(id) ? 'missing' : undefined);

  const q = text.trim().toLowerCase().replace(/\s+/g, '');
  const rows = all
    .filter((p) => view === 'all' || stateOf(p.productId) === view)
    .filter((p) => !q || `${p.internalName ?? ''}${(p.productId && cardOf.get(p.productId)?.name) ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(q));
  const count = (v: View) => (products.isPending || cards.isPending ? '…' : cards.isError ? '?' : String(v === 'all' ? all.length : all.filter((p) => stateOf(p.productId) === v).length) + (products.hasNextPage ? '+' : ''));

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        description={m.intro}
        actions={
          <>
            <Link className="btn btn-sm" to="/contents/import">
              {messages.nav.contentImport}
            </Link>
            <Link className="btn btn-sm btn-primary" to="/contents/drafts/new">
              {messages.nav.contentNew}
            </Link>
          </>
        }
      />
      <StatStrip label={m.countsLabel} testId="content-counts">
        <StatCard layout="row" label={m.card.all} value={count('all')} to="/contents" active={view === 'all'} testId="content-count-all" />
        <StatCard layout="row" label={m.card.published} value={count('published')} tone={/^[1-9]/.test(count('published')) ? 'success' : undefined} to="/contents?view=published" active={view === 'published'} testId="content-count-published" />
        <StatCard layout="row" label={m.card.missing} hint={m.card.missingHint} value={count('missing')} tone={/^[1-9]/.test(count('missing')) ? 'warning' : undefined} to="/contents?view=missing" active={view === 'missing'} testId="content-count-missing" />
      </StatStrip>
      <GuideBox title={m.guideTitle} items={m.guide} storeKey="contents" testId="content-guide" />
      <div className="flex flex-wrap items-end gap-3 rounded-box bg-base-300/40 px-4 py-3" role="group" aria-label={m.filters}>
        <label className="flex min-w-64 flex-col gap-1 text-xs font-medium text-base-content/60">
          {m.search}
          <span className="input input-sm flex w-80 items-center gap-2 bg-base-100">
            <LineIcon name="search" className="h-4 w-4 text-base-content/40" />
            <input className="grow" aria-label={m.search} placeholder={m.searchHint} value={text} onChange={(e) => setText(e.target.value)} />
          </span>
        </label>
      </div>
      <QueryState state={toUiState(products, (d) => d.pages.every((p) => (p.items ?? []).length === 0))} onRetry={() => void products.refetch()} emptyText={m.empty}>
        {() => (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-base-300 pb-3 text-sm">
              <h2 className="text-base font-bold">{m.card[view]}</h2>
              <span className="text-base-content/60">{m.total(rows.length)}</span>
              {cards.isError && (
                <span role="alert" className="text-warning">
                  {m.cardsFailed}
                </span>
              )}
            </div>
            <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>
                        {m.col.content}
                        <span className="block text-[11px] font-normal text-base-content/40">{m.col.contentSub}</span>
                      </th>
                      <th>{m.col.state}</th>
                      <th className="text-right">{m.col.rating}</th>
                      <th className="w-48" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-sm text-base-content/60" data-testid="content-empty">
                          {m.noMatch}
                        </td>
                      </tr>
                    )}
                    {rows.map((p, i) => {
                      const id = p.productId ?? '';
                      const card = cardOf.get(id);
                      const st = stateOf(id);
                      return (
                        <tr key={id || i} data-testid="content-row" {...pv.row(id || null)}>
                          <td className="max-w-xl">
                            <div className="flex items-center gap-3">
                              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-base-300 bg-base-200 text-base-content/45" data-testid="content-thumb">
                                {card?.mainImage?.imageId ? <AuthedImage imageId={card.mainImage.imageId} alt={card.name ?? ''} className="h-full w-full object-cover" /> : <LineIcon name="image" className="h-5 w-5" />}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-semibold">{card?.name ?? p.internalName ?? messages.none}</p>
                                <p className="truncate text-xs text-base-content/50">{m.internal(p.internalName ?? messages.none)}</p>
                              </div>
                            </div>
                          </td>
                          <td>
                            {st === 'published' ? <StatusBadge tone="success">{m.card.published}</StatusBadge> : st === 'missing' ? <StatusBadge tone="warning">{m.card.missing}</StatusBadge> : <span className="text-base-content/40">{cards.isError ? '?' : '…'}</span>}
                          </td>
                          <td className="text-right text-sm">
                            {card?.rating && card.rating.reviewCount > 0 && card.rating.averageRating !== null && card.rating.averageRating !== undefined ? (
                              <span>
                                ★ <span className="font-semibold tabular-nums">{card.rating.averageRating.toFixed(1)}</span> <span className="text-xs text-base-content/50">{m.reviews(card.rating.reviewCount)}</span>
                              </span>
                            ) : (
                              <span className="text-base-content/35">—</span>
                            )}
                          </td>
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="join">
                              <Link className="btn btn-sm join-item" to={`/contents/drafts/new?productId=${encodeURIComponent(id)}`} data-testid="content-edit">
                                {st === 'published' ? m.edit : m.register}
                              </Link>
                              <Link className="btn btn-sm join-item" to={`/products/${encodeURIComponent(id)}`}>
                                {m.product}
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {products.hasNextPage && (
                <div className="flex justify-end border-t border-base-300 px-4 py-3">
                  <button type="button" className="btn btn-sm" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>
                    {messages.more}
                  </button>
                </div>
              )}
            </div>
            {pv.id && (
              <PreviewDrawer id={pv.id} ids={rows.flatMap((p) => (p.productId ? [p.productId] : []))} onMove={pv.open} onClose={pv.close} title={cardOf.get(pv.id)?.name ?? all.find((p) => p.productId === pv.id)?.internalName ?? m.title} detailTo={`/products/${encodeURIComponent(pv.id)}`}>
                <ContentGallery key={pv.id} productId={pv.id} withText />
              </PreviewDrawer>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
