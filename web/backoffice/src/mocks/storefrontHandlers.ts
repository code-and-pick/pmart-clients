// storefront 0.7.0 진열 편성(배너·상품 테마, ADR-0075 ② BO-05) 목. 쓰기는 MD·OPERATOR_ADMIN 만, 읽기는 DISPLAY_APPROVER 도(0.7.1), 그 밖 403.
// 초안 → 제출(검사·잠금, approvalRequest) → approval DISPLAY → 승인되면 PUBLISHED(layoutVersion), 반려면 REJECTED.
// 검사 field 는 서버(LayoutRules)와 같은 모양: banners[0].imageId · themes[0].title · themes[0].productIds[1] 등.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/storefront';
import { db } from './db';
import { expectedVersion, idempotent, imageKindOf, operator, problem, unauthorized } from './support';

type Draft = components['schemas']['LayoutDraft'];
type Body = components['schemas']['LayoutDraftBody'];

const SEED_IMAGE = 'bimg-seed-winter';

function seed(): { drafts: Map<string, Draft>; images: Set<string>; current: number; seq: number } {
  const published: Draft = {
    draftId: 'LD-seed-1',
    state: 'PUBLISHED',
    version: 2,
    draftHash: 'h-seed',
    approvalId: 'apv-seed-layout-1',
    layoutVersion: 1,
    rejectionReason: null,
    createdBy: 'op-md-1',
    createdAt: '2026-11-19T01:00:00Z',
    updatedAt: '2026-11-19T02:00:00Z',
    note: '겨울 제철 채소 기획',
    banners: [{ bannerId: 'B-WINTER-VEG', placement: 'HOME_TOP', imageId: SEED_IMAGE, altText: '겨울 제철 채소 모음', linkType: 'SECTION', linkRef: 'T-WINTER-VEG', sortOrder: 0, startsAt: null, endsAt: null }],
    themes: [{ sectionId: 'T-WINTER-VEG', kind: 'SEASON', title: '겨울 제철 채소', subtitle: '지금 가장 맛있는 채소', productIds: ['P-00000001', 'P-00000002'], sortOrder: 0, startsAt: null, endsAt: null, showTimer: false }],
  };
  return { drafts: new Map([[published.draftId, published]]), images: new Set([SEED_IMAGE]), current: 1, seq: 0 };
}

export const layouts = seed();
/** 목에 올린 배너 그림(바이트) */
const uploaded = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
/** 배너 그림 크기(PNG 는 머리에서 읽음 — 시험은 직접 넣는다). 없으면 경고 없음 */
export const bannerDims = new Map<string, { w: number; h: number }>();
const BANNER_MIN: Readonly<Record<string, { ratio: number; label: string; minW: number; minH: number }>> = {
  HOME_TOP: { ratio: 2.8, label: '2.8:1', minW: 1080, minH: 386 },
  HOME_MIDDLE: { ratio: 2.8, label: '2.8:1', minW: 1080, minH: 386 },
  HOME_INLINE: { ratio: 2.8, label: '2.8:1', minW: 1080, minH: 386 },
  CATEGORY: { ratio: 2.8, label: '2.8:1', minW: 1080, minH: 386 },
  PRODUCT_DETAIL: { ratio: 4.5, label: '4.5:1', minW: 1080, minH: 240 },
  CARE_CARD: { ratio: 16 / 9, label: '16:9', minW: 720, minH: 405 },
  POPUP: { ratio: 0.8, label: '4:5', minW: 720, minH: 900 },
  SPLASH: { ratio: 0.5625, label: '9:16', minW: 720, minH: 1280 },
};
/** storefront 0.15.0 초안 warnings — 막지 않는 배너 그림 규격 경고(서버와 같은 뜻: 비율 ±10%, 최소 크기) */
function fitWarn(imageId: string, place: string, field: string) {
  const dim = bannerDims.get(imageId);
  const spec = BANNER_MIN[place];
  if (!dim || !spec) return [];
  const out: { field: string; code: 'BANNER_IMAGE_RATIO' | 'BANNER_IMAGE_TOO_SMALL'; detail: string }[] = [];
  if (Math.abs(dim.w / dim.h - spec.ratio) / spec.ratio > 0.1) out.push({ field, code: 'BANNER_IMAGE_RATIO', detail: `지금 ${dim.w}×${dim.h} — ${place} 권장 ${spec.label}` });
  else if (dim.w < spec.minW || dim.h < spec.minH) out.push({ field, code: 'BANNER_IMAGE_TOO_SMALL', detail: `지금 ${dim.w}×${dim.h} — 최소 ${spec.minW}×${spec.minH}` });
  return out;
}
const withWarnings = (d: Draft): Draft => ({
  ...d,
  warnings: [
    ...(d.banners ?? []).flatMap((b, i) => fitWarn(b.imageId, b.placement, `banners[${i}].imageId`)),
    // 0.20.0 관리 카드 그림 CARE_CARD 16:9 — 경고만
    ...(d.careCards?.items ?? []).flatMap((c, i) => fitWarn(c.imageId, 'CARE_CARD', `careCards.items[${i}].imageId`)),
  ],
});
export function resetLayouts(): void {
  Object.assign(layouts, seed());
}

const canManage = (request: Request) => {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.roles.some((r) => r === 'MD' || r === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
  return null;
};

/** 읽기(목록·초안) — storefront 0.7.1(백엔드 회신 2026-11-20): DISPLAY_APPROVER 도 읽는다. 만들기·고치기·제출은 그대로 MD·OPERATOR_ADMIN */
const canRead = (request: Request) => {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.roles.some((r) => r === 'MD' || r === 'OPERATOR_ADMIN' || r === 'DISPLAY_APPROVER')) return problem(403, 'FORBIDDEN');
  return null;
};

// 0.9.0 문구 검사 완화 — 할인·특가·쿠폰·세일·1+1 허용, 근거 없는 "최저가"·"신선 보장"만 막는다
const PROMO = /최저가|신선\s*보장/;

function check(body: Body): { field: string; reason: string }[] {
  const out: { field: string; reason: string }[] = [];
  const themes = body.themes ?? [];
  const sections = new Set(themes.map((t) => t.sectionId));
  const seenB = new Set<string>();
  (body.banners ?? []).forEach((b, i) => {
    const at = `banners[${i}]`;
    if (seenB.has(b.bannerId)) out.push({ field: `${at}.bannerId`, reason: 'DUPLICATE_ID' });
    seenB.add(b.bannerId);
    if (!layouts.images.has(b.imageId)) out.push({ field: `${at}.imageId`, reason: 'IMAGE_NOT_FOUND' });
    const ref = b.linkRef ?? '';
    const badLink =
      b.linkType === 'NONE' ? ref !== '' : b.linkType === 'SECTION' ? !sections.has(ref) : b.linkType === 'PRODUCT' ? !db.products.has(ref) : ref === '';
    if (badLink) out.push({ field: `${at}.linkRef`, reason: 'INVALID_LINK' });
    if (b.startsAt && b.endsAt && b.startsAt >= b.endsAt) out.push({ field: `${at}.endsAt`, reason: 'INVALID_PERIOD' });
    if (PROMO.test(b.altText)) out.push({ field: `${at}.altText`, reason: 'PROMOTION_NOT_ALLOWED' });
  });
  const seenT = new Set<string>();
  themes.forEach((t, i) => {
    const at = `themes[${i}]`;
    if (seenT.has(t.sectionId)) out.push({ field: `${at}.sectionId`, reason: 'DUPLICATE_ID' });
    seenT.add(t.sectionId);
    if (t.startsAt && t.endsAt && t.startsAt >= t.endsAt) out.push({ field: `${at}.endsAt`, reason: 'INVALID_PERIOD' });
    if (PROMO.test(t.title)) out.push({ field: `${at}.title`, reason: 'PROMOTION_NOT_ALLOWED' });
    if (t.subtitle && PROMO.test(t.subtitle)) out.push({ field: `${at}.subtitle`, reason: 'PROMOTION_NOT_ALLOWED' });
    // 0.9.0 자동 랭킹·빈 테마·남은 시간
    if (t.kind === 'RANKING_AUTO') {
      if ((t.productIds ?? []).length > 0 || !t.autoSize || t.autoSize < 1 || t.autoSize > 30) out.push({ field: `${at}.autoSize`, reason: 'INVALID_AUTO_THEME' });
    } else if ((t.productIds ?? []).length === 0) out.push({ field: `${at}.productIds`, reason: 'EMPTY_THEME' });
    if (t.showTimer && !t.endsAt) out.push({ field: `${at}.endsAt`, reason: 'TIMER_NEEDS_END' });
    const seenP = new Set<string>();
    (t.productIds ?? []).forEach((p, j) => {
      if (seenP.has(p)) out.push({ field: `${at}.productIds[${j}]`, reason: 'DUPLICATE_PRODUCT' });
      seenP.add(p);
      if (db.products.get(p)?.saleState !== 'ON_SALE') out.push({ field: p, reason: 'PRODUCT_NOT_PUBLISHED' });
    });
  });
  // 0.20.0 상품페이지 관리 카드(BR-102) — 제목 1~30, 카드 1~10장, cardId C-…·중복, 올린 그림, 카드 제목 1~30, 설명 1~80, 판촉 문구 금지
  const cc = body.careCards;
  if (cc) {
    if (!cc.title || cc.title.length > 30) out.push({ field: 'careCards.title', reason: 'INVALID_TITLE' });
    else if (PROMO.test(cc.title)) out.push({ field: 'careCards.title', reason: 'PROMOTION_NOT_ALLOWED' });
    if (cc.items.length < 1 || cc.items.length > 10) out.push({ field: 'careCards.items', reason: 'INVALID_CARD_COUNT' });
    const seenC = new Set<string>();
    cc.items.forEach((c, i) => {
      const at = `careCards.items[${i}]`;
      if (!/^C-[A-Za-z0-9_-]{1,38}$/.test(c.cardId)) out.push({ field: `${at}.cardId`, reason: 'INVALID_CARD_ID' });
      else if (seenC.has(c.cardId)) out.push({ field: `${at}.cardId`, reason: 'DUPLICATE_ID' });
      seenC.add(c.cardId);
      if (!layouts.images.has(c.imageId)) out.push({ field: `${at}.imageId`, reason: 'IMAGE_NOT_FOUND' });
      if (!c.title || c.title.length > 30) out.push({ field: `${at}.title`, reason: 'INVALID_TITLE' });
      else if (PROMO.test(c.title)) out.push({ field: `${at}.title`, reason: 'PROMOTION_NOT_ALLOWED' });
      if (!c.body || c.body.length > 80) out.push({ field: `${at}.body`, reason: 'INVALID_BODY' });
      else if (PROMO.test(c.body)) out.push({ field: `${at}.body`, reason: 'PROMOTION_NOT_ALLOWED' });
    });
  }
  // 0.10.0 넘김 간격·배너 묶음·홈 순서
  const iv = body.bannerIntervalSeconds;
  if (iv != null && (iv < 2 || iv > 30)) out.push({ field: 'bannerIntervalSeconds', reason: 'INVALID_INTERVAL' });
  const groups = new Set<string>();
  (body.banners ?? []).forEach((b, i) => {
    if ((b.placement === 'HOME_INLINE') !== Boolean(b.groupId)) out.push({ field: `banners[${i}].groupId`, reason: 'INVALID_GROUP' });
    if (b.placement === 'HOME_INLINE' && b.groupId) groups.add(b.groupId);
  });
  const inTabs = new Set((body.tabs ?? []).flatMap((t) => t.sectionIds));
  const order = body.homeOrder ?? [];
  const seenO = new Set<string>();
  order.forEach((id, i) => {
    if (seenO.has(id)) out.push({ field: `homeOrder[${i}]`, reason: 'DUPLICATE_ID' });
    else if (!groups.has(id) && (!sections.has(id) || inTabs.has(id))) out.push({ field: `homeOrder[${i}]`, reason: 'UNKNOWN_SECTION' });
    seenO.add(id);
  });
  if ([...groups].some((g) => !seenO.has(g))) out.push({ field: 'homeOrder', reason: 'UNPLACED_GROUP' });
  // 0.9.0 MD 탭
  const seenK = new Set<string>();
  const used = new Set<string>();
  (body.tabs ?? []).forEach((tab, i) => {
    const at = `tabs[${i}]`;
    if (seenK.has(tab.tabKey)) out.push({ field: `${at}.tabKey`, reason: 'DUPLICATE_ID' });
    seenK.add(tab.tabKey);
    tab.sectionIds.forEach((id, j) => {
      if (!sections.has(id)) out.push({ field: `${at}.sectionIds[${j}]`, reason: 'UNKNOWN_SECTION' });
      else if (used.has(id)) out.push({ field: `${at}.sectionIds[${j}]`, reason: 'DUPLICATE_ID' });
      used.add(id);
    });
    if (tab.startsAt && tab.endsAt && tab.startsAt >= tab.endsAt) out.push({ field: `${at}.endsAt`, reason: 'INVALID_PERIOD' });
    if (tab.showTimer && !tab.endsAt) out.push({ field: `${at}.endsAt`, reason: 'TIMER_NEEDS_END' });
  });
  return out;
}

// 0.12.0 BR-84: 남은 시간을 끄면 timerStyle 은 null 로, 켜고 비우면 LABEL 로 저장(계약 설명대로)
const themeOf = (t: NonNullable<Body['themes']>[number]) => ({ ...t, timerStyle: t.showTimer ? (t.timerStyle ?? 'LABEL') : null });
const bodyOf = (b: Body): Body => ({ banners: b.banners ?? [], themes: (b.themes ?? []).map(themeOf), tabs: b.tabs ?? [], homeOrder: b.homeOrder ?? [], bannerIntervalSeconds: b.bannerIntervalSeconds ?? null, note: b.note ?? null, careCards: b.careCards ?? null });

/** approval DISPLAY 결정(effects.decide) — 승인이면 새 진열 버전으로 게시, 반려면 REJECTED */
export function decideLayout(draftId: string, approved: boolean, comment: string | null): void {
  const d = layouts.drafts.get(draftId);
  if (!d || d.state !== 'SUBMITTED') return;
  if (approved) {
    layouts.current += 1;
    layouts.drafts.set(draftId, { ...d, state: 'PUBLISHED', layoutVersion: layouts.current, version: d.version + 1, updatedAt: new Date().toISOString() });
  } else layouts.drafts.set(draftId, { ...d, state: 'REJECTED', rejectionReason: comment, version: d.version + 1, updatedAt: new Date().toISOString() });
}

/** 목 배너 그림(SVG) — 실제 서버는 올린 바이트 그대로 */
const bannerSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#7c6cf2"/><stop offset="1" stop-color="#4fb3a5"/></linearGradient></defs><rect width="720" height="240" fill="url(#g)"/><text x="40" y="135" font-size="40" font-family="sans-serif" fill="#fff">${label}</text></svg>`;

export const storefrontHandlers = [
  http.get(`${API_BASE}/storefront/layout-drafts`, ({ request }) => {
    const denied = canRead(request);
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state');
    const items = [...layouts.drafts.values()].filter((d) => !state || d.state === state).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
    return HttpResponse.json({ items: items.map(withWarnings), currentLayoutVersion: layouts.current });
  }),

  http.post(`${API_BASE}/storefront/layout-drafts`, async ({ request }) => {
    const denied = canManage(request);
    if (denied) return denied;
    const who = operator(request)!;
    const fromCurrent = new URL(request.url).searchParams.get('fromCurrent') === 'true';
    const body = (await request.json()) as Body;
    return idempotent(request, () => {
      const published = [...layouts.drafts.values()].find((d) => d.state === 'PUBLISHED' && d.layoutVersion === layouts.current);
      const src = fromCurrent ? (published ? bodyOf(published) : bodyOf({})) : bodyOf(body);
      const draftId = `LD-${++layouts.seq}`;
      const d: Draft = { ...src, draftId, state: 'DRAFT', version: 0, draftHash: null, approvalId: null, layoutVersion: null, rejectionReason: null, createdBy: who.subject, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      layouts.drafts.set(draftId, d);
      return { status: 201, body: withWarnings(d) };
    });
  }),

  http.get(`${API_BASE}/storefront/layout-drafts/:id`, ({ request, params }) => {
    const denied = canRead(request);
    if (denied) return denied;
    const d = layouts.drafts.get(String(params['id']));
    return d ? HttpResponse.json(withWarnings(d)) : problem(404, 'NOT_FOUND');
  }),

  http.put(`${API_BASE}/storefront/layout-drafts/:id`, async ({ request, params }) => {
    const denied = canManage(request);
    if (denied) return denied;
    const body = (await request.json()) as Body;
    return idempotent(request, () => {
      const d = layouts.drafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT' && d.state !== 'REJECTED') return problem(409, 'INVALID_STATE');
      const v = expectedVersion(request);
      if (v !== undefined && v !== d.version) return problem(409, 'VERSION_CONFLICT');
      // 계약 스키마(altText·title minLength 1, 탭 sectionIds minItems 1) — 어기면 400 VALIDATION_FAILED(칸 경로)
      const bad = [
        ...(body.banners ?? []).flatMap((b, i) => (b.altText ? [] : [{ field: `banners[${i}].altText`, reason: 'MIN_LENGTH' }])),
        ...(body.themes ?? []).flatMap((t, i) => (t.title ? [] : [{ field: `themes[${i}].title`, reason: 'MIN_LENGTH' }])),
        ...(body.tabs ?? []).flatMap((t, i) => [...(t.title ? [] : [{ field: `tabs[${i}].title`, reason: 'MIN_LENGTH' }]), ...(t.sectionIds.length > 0 ? [] : [{ field: `tabs[${i}].sectionIds`, reason: 'MIN_ITEMS' }])]),
      ];
      if (bad.length > 0) return problem(400, 'VALIDATION_FAILED', bad);
      const next: Draft = { ...d, ...bodyOf(body), state: 'DRAFT', version: d.version + 1, updatedAt: new Date().toISOString() };
      layouts.drafts.set(d.draftId, next);
      return { status: 200, body: withWarnings(next) };
    });
  }),

  http.post(`${API_BASE}/storefront/layout-drafts/:id/submissions`, ({ request, params }) => {
    const denied = canManage(request);
    if (denied) return denied;
    return idempotent(request, () => {
      const d = layouts.drafts.get(String(params['id']));
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'DRAFT') return problem(409, 'INVALID_STATE');
      const details = check(d);
      if (details.length > 0) return problem(422, 'LAYOUT_INVALID', details);
      const draftHash = `h-${d.draftId}-${d.version}`;
      layouts.drafts.set(d.draftId, { ...d, state: 'SUBMITTED', draftHash, version: d.version + 1 });
      const n = (d.banners?.length ?? 0) + (d.themes?.length ?? 0);
      return {
        status: 200,
        body: {
          draftId: d.draftId,
          draftHash,
          approvalRequest: {
            type: 'DISPLAY',
            targetService: 'storefront-service',
            targetRef: d.draftId,
            allowedActions: ['PUBLISH_LAYOUT'],
            summary: `홈 진열 편성 — 배너 ${d.banners?.length ?? 0}개 · 테마 ${d.themes?.length ?? 0}개${n === 0 ? '(모두 내림)' : ''}`,
            lines: [{ lineKey: d.draftId, attributes: { draftHash } }],
          },
        },
      };
    });
  }),

  // storefront 0.15.0 배너 자리별 규격(서버 값 그대로 — 2026-11-24)
  http.get(`${API_BASE}/storefront/banner-image-specs`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const banner = (placement: string) => ({ placement, ratio: 2.8, ratioLabel: '2.8:1', recommendedWidth: 1960, recommendedHeight: 700, minWidth: 1080, minHeight: 386 });
    return HttpResponse.json({
      ratioTolerance: 0.1,
      maxBytes: 5 * 1024 * 1024,
      contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
      items: [
        banner('HOME_TOP'),
        banner('HOME_MIDDLE'),
        banner('HOME_INLINE'),
        banner('CATEGORY'),
        // 0.20.0 상품 상세 배너 4.5:1(고객 앱 칸 411×91dp), 관리 카드 그림 16:9
        { placement: 'PRODUCT_DETAIL', ratio: 4.5, ratioLabel: '4.5:1', recommendedWidth: 1960, recommendedHeight: 436, minWidth: 1080, minHeight: 240 },
        { placement: 'CARE_CARD', ratio: 16 / 9, ratioLabel: '16:9', recommendedWidth: 1080, recommendedHeight: 608, minWidth: 720, minHeight: 405 },
        { placement: 'POPUP', ratio: 0.8, ratioLabel: '4:5', recommendedWidth: 1080, recommendedHeight: 1350, minWidth: 720, minHeight: 900 },
        { placement: 'SPLASH', ratio: 0.5625, ratioLabel: '9:16', recommendedWidth: 1080, recommendedHeight: 1920, minWidth: 720, minHeight: 1280 },
      ],
    });
  }),
  http.post(`${API_BASE}/storefront/banner-images`, async ({ request }) => {
    const denied = canManage(request);
    if (denied) return denied;
    const form = await request.formData();
    const file = form.get('file');
    return idempotent(request, async () => {
      // 계약: JPEG·PNG·WEBP(파일 앞부분으로 판정), 5MB 이하. 가로·세로는 막지 않는다
      const kind = file instanceof Blob ? await imageKindOf(file) : null;
      if (!(file instanceof Blob) || !kind || file.size > 5 * 1024 * 1024) return problem(422, 'IMAGE_INVALID');
      const imageId = `bimg-${++layouts.seq}`;
      layouts.images.add(imageId);
      // 올린 그림을 그대로 돌려준다(전에는 늘 "새 배너" 그림이라 무엇을 올렸는지 볼 수 없었다)
      const bytes = await file.arrayBuffer();
      uploaded.set(imageId, { bytes, contentType: kind });
      if (kind === 'image/png' && bytes.byteLength >= 24) {
        const v = new DataView(bytes);
        bannerDims.set(imageId, { w: v.getUint32(16), h: v.getUint32(20) });
      }
      return { status: 201, body: { imageId, url: `/api/v1/storefront/banner-images/${imageId}`, contentType: kind, width: null, height: null } };
    });
  }),

  http.get(`${API_BASE}/storefront/banner-images/:id`, ({ params }) => {
    const id = String(params['id']);
    if (!layouts.images.has(id)) return problem(404, 'NOT_FOUND');
    const up = uploaded.get(id);
    if (up) return new HttpResponse(up.bytes, { headers: { 'Content-Type': up.contentType } });
    return new HttpResponse(bannerSvg(id === SEED_IMAGE ? '겨울 제철 채소' : '새 배너'), { headers: { 'Content-Type': 'image/svg+xml' } });
  }),
];
