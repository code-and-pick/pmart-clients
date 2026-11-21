// storefront 0.7.0 진열 편성(배너·상품 테마, ADR-0075 ② BO-05) 목. 쓰기는 MD·OPERATOR_ADMIN 만, 읽기는 DISPLAY_APPROVER 도(0.7.1), 그 밖 403.
// 초안 → 제출(검사·잠금, approvalRequest) → approval DISPLAY → 승인되면 PUBLISHED(layoutVersion), 반려면 REJECTED.
// 검사 field 는 서버(LayoutRules)와 같은 모양: banners[0].imageId · themes[0].title · themes[0].productIds[1] 등.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/storefront';
import { db } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

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

const bodyOf = (b: Body): Body => ({ banners: b.banners ?? [], themes: b.themes ?? [], tabs: b.tabs ?? [], homeOrder: b.homeOrder ?? [], bannerIntervalSeconds: b.bannerIntervalSeconds ?? null, note: b.note ?? null });

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
    return HttpResponse.json({ items, currentLayoutVersion: layouts.current });
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
      return { status: 201, body: d };
    });
  }),

  http.get(`${API_BASE}/storefront/layout-drafts/:id`, ({ request, params }) => {
    const denied = canRead(request);
    if (denied) return denied;
    const d = layouts.drafts.get(String(params['id']));
    return d ? HttpResponse.json(d) : problem(404, 'NOT_FOUND');
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
      const next: Draft = { ...d, ...bodyOf(body), state: 'DRAFT', version: d.version + 1, updatedAt: new Date().toISOString() };
      layouts.drafts.set(d.draftId, next);
      return { status: 200, body: next };
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

  http.post(`${API_BASE}/storefront/banner-images`, async ({ request }) => {
    const denied = canManage(request);
    if (denied) return denied;
    const form = await request.formData();
    const file = form.get('file');
    return idempotent(request, () => {
      if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) return problem(422, 'IMAGE_INVALID');
      const imageId = `bimg-${++layouts.seq}`;
      layouts.images.add(imageId);
      return { status: 201, body: { imageId, url: `/api/v1/storefront/banner-images/${imageId}`, contentType: file.type, width: 720, height: 240 } };
    });
  }),

  http.get(`${API_BASE}/storefront/banner-images/:id`, ({ params }) => {
    const id = String(params['id']);
    if (!layouts.images.has(id)) return problem(404, 'NOT_FOUND');
    return new HttpResponse(bannerSvg(id === SEED_IMAGE ? '겨울 제철 채소' : '새 배너'), { headers: { 'Content-Type': 'image/svg+xml' } });
  }),
];
