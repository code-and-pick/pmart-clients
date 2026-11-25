// 게시된 콘텐츠 보기(2026-11-19 사용자 "콘텐츠 조회 기능, 상품 조회 안에서도 사진") — GET /product-contents/{productId}.
// 사진: 대표(MAIN) → 상세정보 표(DETAIL) → 상세설명(DESCRIPTION) 순, 큰 사진 하나 + 아래 작은 사진(누르면 큰 사진이 바뀜). 사진 본문은 인증이 필요해 AuthedImage.
// 404(NOT_FOUND·CONTENT_NOT_PUBLISHED)는 오류가 아니라 "게시된 콘텐츠가 없어요"(+ 등록 링크). 그 밖 실패는 오류로(없음으로 바꾸지 않는다).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { AuthedImage } from './AuthedImage';

const m = messages.contents.gallery;
const ROLE_ORDER: Readonly<Record<string, number>> = { MAIN: 0, DETAIL: 1, DESCRIPTION: 2 };
const NOT_PUBLISHED = ['NOT_FOUND', 'CONTENT_NOT_PUBLISHED'];

export function useProductContent(productId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['product-contents', 'detail', productId],
    enabled: productId !== '',
    retry: false,
    queryFn: () => request('GET', api.content.GET('/product-contents/{productId}', { params: { path: { productId } } })),
  });
}

export const notPublished = (e: unknown) => e instanceof ProblemFailure && NOT_PUBLISHED.includes(e.problem.code);

/** 사진 모음 — withText 면 고객용 상품명·설명·안내·고시도 */
export function ContentGallery({ productId, withText = false }: { readonly productId: string; readonly withText?: boolean }) {
  const q = useProductContent(productId);
  const [pick, setPick] = useState(0);
  if (q.isError && notPublished(q.error)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-base-300 px-4 py-6 text-sm text-base-content/60" data-testid="content-not-published">
        <span>{m.notPublished}</span>
        <Link className="btn btn-sm btn-primary" to={`/contents/drafts/new?productId=${encodeURIComponent(productId)}`}>
          {m.register}
        </Link>
      </div>
    );
  }
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(c) => {
        const images = [...(c.images ?? [])].filter((i) => i.imageId).sort((a, b) => (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const main = images[Math.min(pick, Math.max(images.length - 1, 0))];
        return (
          <div className="space-y-4" data-testid="content-gallery">
            {images.length === 0 ? (
              <p className="rounded-lg border border-dashed border-base-300 px-4 py-6 text-center text-sm text-base-content/55">{m.noImages}</p>
            ) : (
              <div className="space-y-2">
                <div className="flex aspect-square max-h-80 w-full max-w-80 items-center justify-center overflow-hidden rounded-lg border border-base-300 bg-base-200">
                  {main?.imageId && <AuthedImage key={main.imageId} imageId={main.imageId} width={720} alt={c.name ?? m.photo} className="h-full w-full object-contain" />}
                </div>
                {images.length > 1 && (
                  <ul className="flex flex-wrap gap-2" aria-label={m.photos}>
                    {images.map((img, i) => (
                      <li key={img.imageId}>
                        <button
                          type="button"
                          onClick={() => setPick(i)}
                          aria-pressed={i === pick}
                          aria-label={m.photoN(i + 1, m.role[img.role as keyof typeof m.role] ?? '')}
                          className={`h-14 w-14 overflow-hidden rounded-md border-2 bg-base-200 ${i === pick ? 'border-primary' : 'border-transparent'}`}
                        >
                          <AuthedImage imageId={img.imageId ?? ''} width={240} alt="" className="h-full w-full object-cover" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-base-content/50">{m.count(images.length)}</p>
              </div>
            )}
            {withText && (
              <dl className="space-y-3 text-sm" data-testid="content-text">
                <div>
                  <dt className="text-xs text-base-content/50">{m.name}</dt>
                  <dd className="font-semibold">{c.name ?? messages.none}</dd>
                </div>
                {c.description && (
                  <div>
                    <dt className="text-xs text-base-content/50">{m.description}</dt>
                    <dd className="whitespace-pre-line">{c.description}</dd>
                  </div>
                )}
                {(c.notices ?? []).length > 0 && (
                  <div>
                    <dt className="text-xs text-base-content/50">{m.notices}</dt>
                    <dd>
                      <ul className="list-inside list-disc">
                        {(c.notices ?? []).map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {c.storageGuide && (
                  <div>
                    <dt className="text-xs text-base-content/50">{m.storage}</dt>
                    <dd>{c.storageGuide}</dd>
                  </div>
                )}
                {c.returnGuide && (
                  <div>
                    <dt className="text-xs text-base-content/50">{m.returns}</dt>
                    <dd>{c.returnGuide}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
