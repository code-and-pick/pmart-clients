// 승인된 상품 고르기(콘텐츠 등록용). 2026-11-02 "검색·필터 없는 드롭다운" → 2026-11-19 사용자 요청으로 쳐서 찾는 고르기(SearchSelect).
// 목록은 GET /products 를 쪽 단위로 불러온다. 다 불러오지 않았으면 "더 불러오기"를 보인다.
import { SearchSelect } from '../../shared/SearchSelect';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { PmartFailure } from '@pmart/web-core';
import type { ProductSummary } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { FailureAlert } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';

const PAGE_SIZE = 200;

export function ProductPicker({
  label,
  value,
  onChange,
  onClear,
}: {
  readonly label: string;
  readonly value: string;
  /** 고른 상품. 목록에 없는 ID(상품 상세에서 넘어온 값 등)면 product 는 없다. */
  readonly onChange: (productId: string, product?: ProductSummary) => void;
  /** 상품이 골라져 있을 때 오른쪽 X — 폼 전체를 비운다. */
  readonly onClear?: () => void;
}) {
  const api = useApi();

  const query = useInfiniteQuery({
    queryKey: ['product', 'picker'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.product.GET('/products', {
          params: { query: { size: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });

  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.items ?? []) ?? [], [query.data]);

  // 쳐서 찾는 고르기(2026-11-19 사용자 "데이터가 많아지면 일일이 찾기 힘들다") — 불러온 상품 안에서 이름·상태·상품 ID 로 좁힌다(서버 검색 아님, 계약에 검색 조건 없음).
  // 목록에는 관리용 명칭 · 판매 상태만(시스템 ID 는 보이지 않게 — ADR-0070 덧붙임), ID 는 붙여 넣어도 찾게 숨은 낱말로.
  const options = useMemo(
    () =>
      loaded.flatMap((p) =>
        p.productId
          ? [{ value: p.productId, label: p.internalName ?? m.none, ...(p.saleState ? { hint: m.products.saleStateName[p.saleState] } : {}), keywords: p.productId }]
          : [],
      ),
    [loaded],
  );

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <SearchSelect
          label={label}
          className="min-w-0 flex-1"
          value={value}
          options={options}
          loading={query.isPending}
          loadingText={m.loading}
          placeholder={m.contents.pickerSearch}
          emptyText={m.contents.pickerNoMatch(loaded.length)}
          onChange={(id) => onChange(id, loaded.find((p) => p.productId === id))}
          footer={
            query.hasNextPage ? (
              <button type="button" className="btn btn-ghost btn-xs" disabled={query.isFetchingNextPage} onMouseDown={(e) => e.preventDefault()} onClick={() => void query.fetchNextPage()}>
                {m.contents.pickerMore(loaded.length)}
              </button>
            ) : undefined
          }
        />
        {value && onClear && (
          <button type="button" className="btn btn-ghost btn-xs btn-circle" aria-label={m.contents.clearAll} title={m.contents.clearAll} onClick={onClear}>
            ✕
          </button>
        )}
      </div>
      {query.error instanceof PmartFailure && <FailureAlert failure={query.error} />}
    </div>
  );
}
