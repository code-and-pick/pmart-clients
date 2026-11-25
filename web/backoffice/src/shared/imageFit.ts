// 사진 권장 규격 — 서버가 준 값(2026-11-24 사용자 "규격 값은 백엔드 값으로", "서버에서 막지 않고 경고만 표시").
// 배너: storefront `GET /storefront/banner-image-specs`(자리별 비율·권장·최소), 상품 사진: product-content `GET /content-drafts/image-specs`(역할별).
// 화면은 값을 지어내지 않는다 — 못 읽으면 권장 안내·미리 경고를 띄우지 않는다(서버 초안 warnings 는 그대로 보인다).
// 미리 경고: 그림을 불러올 때 실제 크기를 읽어 비율이 ±tolerance 밖이면 "잘려요", 최소(배너)·권장 가로(상품)보다 작으면 "흐릴 수 있어요". 올리기·제출은 막지 않는다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';

export interface ImageSpec {
  /** 가로 ÷ 세로(없으면 비율은 보지 않는다 — 상세 사진처럼 세로 자유) */
  readonly ratio?: number;
  readonly ratioLabel?: string;
  readonly tolerance: number;
  /** cover = 칸을 채우고 넘치는 쪽을 잘라 냄, contain = 그림을 다 보이고 남는 곳을 채움(고객 앱 로딩 화면) */
  readonly fit: 'cover' | 'contain';
  readonly recommendedWidth: number;
  readonly recommendedHeight: number | null;
  /** 이보다 작으면 흐릴 수 있다(배너는 서버 최소, 상품 사진은 권장 가로) */
  readonly minWidth: number;
  readonly minHeight: number | null;
}

/** "1:1"·"2.8:1"·"4:5"·"9:16" → 가로 ÷ 세로 */
const ratioOf = (label: string | null | undefined): number | undefined => {
  const r = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(label ?? '');
  return r ? Number(r[1]) / Number(r[2]) : undefined;
};

/** 배너 자리별 규격(서버 값) — 못 읽었으면 data 가 없다 */
export function useBannerSpecs() {
  const api = useApi();
  return useQuery({
    queryKey: ['storefront', 'banner-image-specs'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const r = await request('GET', api.storefront.GET('/storefront/banner-image-specs', {}));
      const by: Record<string, ImageSpec> = {};
      for (const x of r.items) {
        by[x.placement] = {
          ratio: x.ratio,
          ratioLabel: x.ratioLabel,
          tolerance: r.ratioTolerance,
          // 로딩 화면은 고객 앱이 그림을 다 보이고 남는 곳을 색으로 채운다(start_screens BoxFit.contain)
          fit: x.placement === 'SPLASH' ? 'contain' : 'cover',
          recommendedWidth: x.recommendedWidth,
          recommendedHeight: x.recommendedHeight,
          minWidth: x.minWidth,
          minHeight: x.minHeight,
        };
      }
      return { maxBytes: r.maxBytes, contentTypes: r.contentTypes, by };
    },
  });
}

/** 상품 사진 역할별 규격(서버 값) */
export function useContentSpecs() {
  const api = useApi();
  return useQuery({
    queryKey: ['product-content', 'image-specs'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const r = await request('GET', api.content.GET('/content-drafts/image-specs', {}));
      const by: Record<string, ImageSpec & { readonly maxCount: number | null }> = {};
      for (const x of r.items) {
        const ratio = ratioOf(x.ratioLabel);
        by[x.role] = {
          ...(ratio !== undefined ? { ratio, ratioLabel: x.ratioLabel ?? '' } : {}),
          tolerance: x.ratioTolerance ?? 0.1,
          fit: 'cover',
          recommendedWidth: x.recommendedWidth,
          recommendedHeight: x.recommendedHeight ?? null,
          minWidth: x.recommendedWidth,
          minHeight: x.recommendedHeight ?? null,
          maxCount: x.maxCount ?? null,
        };
      }
      return { maxBytes: r.maxBytes, contentTypes: r.contentTypes, maxImages: r.maxImagesPerDraft, by };
    },
  });
}

/** 권장 안내 한 줄 — 권장 1960×700(2.8:1) · 최소 1080×386 / 권장 가로 1000 */
export function specText(s: ImageSpec | undefined, withMin: boolean): string | null {
  if (!s) return null;
  const rec = s.recommendedHeight ? `권장 ${s.recommendedWidth}×${s.recommendedHeight}${s.ratioLabel ? `(${s.ratioLabel})` : ''}` : `권장 가로 ${s.recommendedWidth}`;
  return withMin && s.minHeight ? `${rec} · 최소 ${s.minWidth}×${s.minHeight}` : rec;
}

/** 형식·용량 한 줄 — JPEG·PNG·WEBP · 5MB 이하 */
export function formatText(contentTypes: readonly string[], maxBytes: number): string {
  const names = contentTypes.map((t) => t.replace(/^image\//, '').toUpperCase()).join('·');
  return `${names} · ${Math.round(maxBytes / 1024 / 1024)}MB 이하`;
}

/** 그림 칸 옆 한 줄(PC5 대조 2026-11-25 "회색 세 줄이 길다") — JPEG·PNG·WEBP 5MB · 권장 1960×700(2.8:1). 최소는 넘으면 주황 경고로 */
export function specLine(contentTypes: readonly string[], maxBytes: number, s: ImageSpec | undefined): string {
  const names = contentTypes.map((t) => t.replace(/^image\//, '').toUpperCase()).join('·');
  const rec = specText(s, false);
  return `${names} ${Math.round(maxBytes / 1024 / 1024)}MB${rec ? ` · ${rec}` : ''}`;
}

/** 권장과 다른 점(없으면 null). w·h 는 그림의 실제 픽셀 */
export function fitWarning(w: number, h: number, spec: ImageSpec | undefined): string | null {
  if (!spec || !(w > 0) || !(h > 0)) return null;
  const parts: string[] = [];
  if (spec.ratio !== undefined) {
    const r = w / h;
    if (Math.abs(r - spec.ratio) / spec.ratio > spec.tolerance) {
      const how = spec.fit === 'contain' ? '남는 곳은 색으로 채워요' : r > spec.ratio ? '양옆이 잘려요' : '위아래가 잘려요';
      parts.push(`${spec.ratioLabel ?? ''}과 달라 ${how}`);
    }
  }
  if (w < spec.minWidth || (spec.minHeight !== null && h < spec.minHeight)) parts.push(`${spec.minHeight !== null ? `${spec.minWidth}×${spec.minHeight}` : `가로 ${spec.minWidth}px`}보다 작아 흐릴 수 있어요`);
  return parts.length ? `${w}×${h} — ${parts.join(' · ')}` : null;
}
