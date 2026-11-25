// 이미지 본문도 인증이 필요하다(<img src> 는 JWT 를 못 보냄). BR-25: 방식이 정해질 때까지 fetch + Bearer → blob URL.
// 같은 imageId 의 본문은 바뀌지 않아(내용 주소) blob URL 을 캐시에 두고 다시 쓴다(탭을 닫으면 해제된다).
// width 를 주면 축소본(product-content 0.3.0 `?w=240|480|720` — JPEG, 원본보다 작을 때만 줄임, 권한은 원본과 같아 초안 사진도 됨).
// 2026-11-25 PC1 백엔드 제안: 칸 크기 × 화소 비율 2 이상인 가장 작은 단계. 원본이 필요한 곳(규격 경고)은 width 없이 — 지금 규격 경고는 올리기 전 로컬 파일로 재서 해당 없음.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';

export function AuthedImage({ imageId, alt, className, width }: { readonly imageId: string; readonly alt: string; readonly className?: string; readonly width?: 240 | 480 | 720 }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['content', 'image', imageId, width ?? 'original'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const blob = await request(
        'GET',
        api.content.GET('/content-images/{imageId}', { params: { path: { imageId }, query: width ? { w: width } : {} }, parseAs: 'blob' }),
      );
      return URL.createObjectURL(blob);
    },
  });

  if (query.isPending) return <span className="loading loading-spinner loading-sm" />;
  if (query.isError) return <span className="text-error text-xs">{m.contents.imageUnavailable}</span>;
  return <img src={query.data} alt={alt} className={className} />;
}
