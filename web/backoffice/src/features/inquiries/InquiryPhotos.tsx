// 문의 사진(case 0.14.0 — 백엔드 요청 all/2026-11-17-request-inquiry-photos). 상세의 photos[] 를 붙인 순서대로 보여 준다.
// 본문 `GET /inquiry-photos/{photoId}` 는 토큰이 필요하다(공개 아님) — <img src> 로 바로 못 써서 토큰을 붙여 받아 blob URL 로 그린다.
// 못 보는 사진 404·역할 없음 403·저장소 준비 전 503 은 "불러오지 못함"으로(빈칸·성공으로 보이지 않게). 사진 내용·URL 은 로그에 남기지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';

type Photo = components['schemas']['InquiryPhoto'];

function usePhoto(photoId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['inquiries', 'photo', photoId],
    // 같은 photoId 의 본문은 바뀌지 않는다 — blob URL 을 다시 쓴다(탭을 닫으면 해제)
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob = await request('GET', api.cases.GET('/inquiry-photos/{photoId}', { params: { path: { photoId } }, parseAs: 'blob' }));
      return URL.createObjectURL(blob);
    },
  });
}

function Thumb({ photo, index, onOpen }: { readonly photo: Photo; readonly index: number; readonly onOpen: () => void }) {
  const q = usePhoto(photo.photoId);
  if (q.isPending) return <span className="loading loading-spinner loading-sm" />;
  if (q.isError)
    return (
      <span className="flex flex-col items-start gap-1 text-xs text-error" data-testid="inquiry-photo-error">
        {m.inquiries.photoUnavailable}
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void q.refetch()}>
          {m.retry}
        </button>
      </span>
    );
  return (
    <button type="button" className="overflow-hidden rounded-lg border border-base-300 transition hover:ring-2 hover:ring-primary/40" aria-label={m.inquiries.photoOpen(index + 1)} onClick={onOpen}>
      <img src={q.data} alt={m.inquiries.photoAlt(index + 1)} className="h-20 w-20 object-cover" />
    </button>
  );
}

function Large({ photo, index, onClose }: { readonly photo: Photo; readonly index: number; readonly onClose: () => void }) {
  const q = usePhoto(photo.photoId);
  return (
    <figure className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="inquiry-photo-large">
      {q.data && <img src={q.data} alt={m.inquiries.photoAlt(index + 1)} className="max-h-[70vh] max-w-full object-contain" />}
      <figcaption className="flex items-center gap-2 text-xs opacity-70">
        {m.inquiries.photoAlt(index + 1)}
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {m.inquiries.photoClose}
        </button>
      </figcaption>
    </figure>
  );
}

export function InquiryPhotos({ photos }: { readonly photos: readonly Photo[] | undefined }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos || photos.length === 0) return null;
  const big = open === null ? undefined : photos[open];
  return (
    <section className="mt-3 space-y-2 border-t border-base-300/70 pt-3" aria-label={m.inquiries.photos(photos.length)}>
      <h3 className="text-xs font-semibold text-base-content/60">{m.inquiries.photos(photos.length)}</h3>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.photoId} data-testid="inquiry-photo">
            <Thumb photo={p} index={i} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>
      {big && open !== null && <Large photo={big} index={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
