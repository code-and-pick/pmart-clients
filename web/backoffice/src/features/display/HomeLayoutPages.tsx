// 홈 진열 편성 — 일반 배너·상품 테마(storefront 0.7.0 layouts, ADR-0075 ② BO-05 — PC 1 요청서 2026-11-20 request-home-banners-themes).
// 초안(DRAFT) → 저장(PUT, X-Expected-Version) → 제출(검사·잠금, approvalRequest) → approval DISPLAY → 승인되면 PUBLISHED(새 홈 버전), 반려면 REJECTED(고쳐서 다시).
// 콘텐츠 게시와 같은 모양. 한 번 누르면 저장 → 제출 → 승인 요청까지(승인 요청만 실패하면 그 단계만 다시 올리는 상자).
// 고객 홈은 승인 뒤에만 바뀐다 — 미리보기는 초안 본문으로 그린다. 배너·테마·탭 ID 는 화면이 만들고 보이지 않는다(ADR-0070).
// storefront 0.9.0(2026-11-21 PC 1 요청서 request-home-promotion-extras): 배너 자리 팝업·로딩 화면, 테마 남은 시간 표시(showTimer — endsAt 필수),
// 자동 랭킹 테마(RANKING_AUTO — 상품 대신 autoSize 1~30), MD 탭(tabs — 넣은 테마는 홈에서 빠짐). 할인·특가·쿠폰 문구는 이제 허용, 근거 없는 "최저가"·"신선 보장"만 서버가 막는다.
// storefront 0.10.0(같은 요청서 "추가 — 0.10.0"): 배너 넘김 간격(bannerIntervalSeconds 2~30초), 홈 중간 배너 묶음(HOME_INLINE + groupId G-…),
// 홈 순서(homeOrder — 배너 묶음·테마를 보일 순서대로, 위/아래 단추로 옮김. 끌어 옮기기는 나중 — 사용자).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { PmartFailure, ProblemFailure, randomUuid, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { requestApproval } from '../../api/approvalFlow';
import { commandParams, IdempotencyKey } from '../../api/command';
import type { components } from '../../api/generated/storefront';
import type { ApprovalRequestBody } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { RequestApproval } from '../approvals/RequestApproval';
import { ProductPicker } from '../contents/ProductPicker';
import { Person } from '../lookup/parts';
import { multipart } from '../products/ProductImportPage';
import { DataTable, PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { FailureAlert } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages } from '../../shared/messages';
import { SearchSelect } from '../../shared/SearchSelect';

const m = messages.homeLayout;
type Draft = components['schemas']['LayoutDraft'];
type Body = components['schemas']['LayoutDraftBody'];
type Banner = components['schemas']['LayoutBanner'];
type Theme = components['schemas']['LayoutTheme'];
type Tab = components['schemas']['LayoutTab'];
type State = Draft['state'];

const STATES = ['DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED'] as const;
const TONE: Readonly<Record<State, Tone>> = { DRAFT: 'ghost', SUBMITTED: 'warning', PUBLISHED: 'success', REJECTED: 'error' };
const shortId = () => randomUuid().replace(/-/g, '').slice(0, 8).toUpperCase();

/** 목록·제목 — 메모가 있으면 메모, 없으면 "편성 초안" */
const titleOf = (d: Pick<Draft, 'note'>) => d.note?.trim() || m.draftTitle;

export function HomeLayoutListPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = STATES.find((s) => s === raw);
  const query = useQuery({
    queryKey: ['storefront', 'layout-drafts', state ?? 'ALL'],
    queryFn: () => request('GET', api.storefront.GET('/storefront/layout-drafts', { params: { query: state ? { state } : {} } })),
  });
  const create = useCommand((fromCurrent: boolean, key) => {
    const cp = commandParams(key);
    return request('POST', api.storefront.POST('/storefront/layout-drafts', { ...cp, params: { ...cp.params, query: { fromCurrent } }, body: {} })).then((d) => {
      void navigate(`/display/home/${encodeURIComponent(d.draftId)}`);
      return d;
    });
  });
  const current = query.data?.currentLayoutVersion;

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        actions={
          <>
            <button type="button" className="btn btn-sm btn-ghost border-base-300" disabled={create.busy} data-testid="layout-new-empty" onClick={() => void create.run(false)}>
              {m.fromEmpty}
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={create.busy} data-testid="layout-new-current" onClick={() => void create.run(true)}>
              {m.fromCurrent}
            </button>
          </>
        }
      />
      {/* 초안 만들기는 실패만 보인다(성공은 바로 그 초안으로 — '반영됐어요' 알림은 맞지 않다) */}
      {(create.phase.kind === 'rejected' || create.phase.kind === 'unknown') && <FailureAlert failure={create.phase.failure} />}
      {current !== undefined && (
        <p className="text-sm text-base-content/70" data-testid="layout-current">
          {m.current(current)}
        </p>
      )}
      <div role="tablist" className="tabs tabs-border">
        {(['ALL', ...STATES] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={(state ?? 'ALL') === s}
            className={`tab ${(state ?? 'ALL') === s ? 'tab-active' : ''}`}
            onClick={() => setParams(s === 'ALL' ? {} : { state: s })}
          >
            {m.tabs[s]}
          </button>
        ))}
      </div>
      <QueryState state={query.data && query.data.items.length === 0 ? { kind: 'empty' } : toUiState(query)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.col.title}</th>
                <th>{m.col.parts}</th>
                <th>{m.col.state}</th>
                <th>{m.col.by}</th>
                <th className="text-right">{m.col.at}</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((d) => (
                // 줄을 누르면 바로 편성 화면(미리보기 서랍 없음 — 2026-11-20 "터치 2번")
                <tr key={d.draftId} className="cursor-pointer" data-testid="layout-row" onClick={() => void navigate(`/display/home/${encodeURIComponent(d.draftId)}`)}>
                  <td>
                    <Link className="link" to={`/display/home/${encodeURIComponent(d.draftId)}`} onClick={(e) => e.stopPropagation()}>
                      {titleOf(d)}
                    </Link>
                  </td>
                  <td className="text-sm text-base-content/70">{m.parts(d.banners?.length ?? 0, d.themes?.length ?? 0)}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge tone={TONE[d.state]}>{m.state[d.state]}</StatusBadge>
                      {d.state === 'PUBLISHED' && d.layoutVersion === r.currentLayoutVersion && (
                        <span className="badge badge-primary badge-sm" data-testid="layout-live">
                          {m.live}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="text-sm">
                    <Person id={d.createdBy} />
                  </td>
                  <td className="whitespace-nowrap text-right text-sm text-base-content/70">{formatSeoul(d.updatedAt ?? d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </QueryState>
    </section>
  );
}

// ───────── 편성 화면 ─────────

const bodyOf = (d: Draft): Body => ({
  banners: d.banners ?? [],
  themes: d.themes ?? [],
  tabs: d.tabs ?? [],
  homeOrder: d.homeOrder ?? [],
  bannerIntervalSeconds: d.bannerIntervalSeconds ?? null,
  note: d.note ?? null,
});

/** 홈 중간 배너 묶음(HOME_INLINE) groupId — 배너 순서에서 처음 나온 순서. 화면에는 "배너 묶음 1·2…"로만 보인다 */
const groupsOf = (b: Body): string[] => [...new Set((b.banners ?? []).flatMap((x) => (x.placement === 'HOME_INLINE' && x.groupId ? [x.groupId] : [])))];
/** 홈에 보이는 테마(MD 탭에 넣은 것 빼고) */
const homeThemesOf = (b: Body): Theme[] => {
  const tabbed = new Set((b.tabs ?? []).flatMap((t) => t.sectionIds));
  return (b.themes ?? []).filter((t) => !tabbed.has(t.sectionId));
};
/**
 * 보낼 홈 순서(0.10.0) — 저장된 순서 중 아직 홈에 있는 것 + 빠진 테마(테마 순서)·묶음을 뒤에.
 * 옮긴 적 없고 묶음도 없으면 [](서버가 예전처럼 테마 순서) — 지운 테마·탭에 넣은 테마는 빠지고(UNKNOWN_SECTION), 새 묶음은 늘 들어간다(UNPLACED_GROUP)
 */
const homeOrderOf = (b: Body): string[] => {
  const groups = groupsOf(b);
  const raw = b.homeOrder ?? [];
  if (raw.length === 0 && groups.length === 0) return [];
  const ids = [...homeThemesOf(b).map((t) => t.sectionId), ...groups];
  const kept = [...new Set(raw)].filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
};
const withOrder = (b: Body): Body => ({
  ...b,
  banners: (b.banners ?? []).map((x, i) => ({ ...x, sortOrder: i })),
  themes: (b.themes ?? []).map((x, i) => ({ ...x, sortOrder: i })),
  tabs: (b.tabs ?? []).map((x, i) => ({ ...x, sortOrder: i })),
  homeOrder: homeOrderOf(b),
});

/** datetime-local(서울 시각) ↔ ISO */
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

/** 422 LAYOUT_INVALID details → 칸별 까닭. field: banners[0].altText · themes[1].title · 상품 ID(PRODUCT_NOT_PUBLISHED) */
/** field = 카드 안 칸 이름(title·altText·linkRef·endsAt·imageId·productIds…), 빈 문자열이면 카드 전체 */
interface Why {
  readonly field: string;
  readonly text: string;
}
/** 그 칸의 까닭만 — 칸 바로 아래에 보인다(2026-11-20 "칸 옆에") */
const whyOf = (why: readonly Why[], ...fields: string[]) => why.filter((w) => fields.includes(w.field)).map((w) => w.text);
/** 칸에 붙이지 못한 까닭(같은 ID 두 번 등) — 카드 맨 아래 */
const whyRest = (why: readonly Why[], known: readonly string[]) => why.filter((w) => !known.includes(w.field)).map((w) => w.text);
const BANNER_FIELDS = ['imageId', 'altText', 'linkRef', 'startsAt', 'endsAt', 'placement', 'groupId'];
const NEW_GROUP = '__new';
const THEME_FIELDS = ['title', 'subtitle', 'startsAt', 'endsAt', 'productIds', 'autoSize', 'showTimer', 'timerStyle', 'kind'];
const TAB_FIELDS = ['title', 'sectionIds', 'startsAt', 'endsAt', 'showTimer'];

interface Problems {
  readonly at: (prefix: string) => readonly Why[];
  readonly product: (productId: string) => string | null;
  readonly count: number;
  /** 칸에 붙이지 못한 것이 있다 — 그때는 실패 알림도 같이 보인다(안 보이는 오류가 없게) */
  readonly unplaced: boolean;
}
type Detail = { readonly field?: string | undefined; readonly reason?: string | undefined };
/** 서버 오류 → 칸별 까닭. 422 LAYOUT_INVALID 와 400 VALIDATION_FAILED(계약 minLength 등 — 앞의 "body." 는 뗀다) */
function serverDetails(failure: PmartFailure | null): readonly Detail[] {
  if (!(failure instanceof ProblemFailure)) return [];
  const code = failure.problem.code;
  if (code !== 'LAYOUT_INVALID' && code !== 'VALIDATION_FAILED') return [];
  return (failure.problem.details ?? []).map((d) => ({ field: d.field?.replace(/^body\./, ''), reason: d.reason }));
}
/** 보내기 전에 화면이 먼저 막는 빈 칸(2026-11-21 점검 — 계약 minLength·minItems, 서버면 400). 승인 요청이면 그림 없는 배너도 */
function localDetails(body: Body, forSubmit: boolean): readonly Detail[] {
  const out: Detail[] = [];
  (body.banners ?? []).forEach((b, i) => {
    if (forSubmit && !b.imageId) out.push({ field: `banners[${i}].imageId`, reason: 'IMAGE_MISSING' });
    if (!b.altText.trim()) out.push({ field: `banners[${i}].altText`, reason: 'ALT_REQUIRED' });
  });
  (body.themes ?? []).forEach((t, i) => {
    if (!t.title.trim()) out.push({ field: `themes[${i}].title`, reason: 'TITLE_REQUIRED' });
  });
  (body.tabs ?? []).forEach((t, i) => {
    if (!t.title.trim()) out.push({ field: `tabs[${i}].title`, reason: 'TAB_TITLE_REQUIRED' });
    if (t.sectionIds.length === 0) out.push({ field: `tabs[${i}].sectionIds`, reason: 'TAB_EMPTY' });
  });
  return out;
}
const PLACED = /^(banners|themes|tabs)\[\d+\]|^homeOrder|^bannerIntervalSeconds$/;
function problemsOf(details: readonly Detail[]): Problems {
  const text = (r: string | undefined) => (r && m.reason[r]) || m.reason['VALUE_INVALID'] || '';
  return {
    count: details.length,
    unplaced: details.some((d) => d.reason !== 'PRODUCT_NOT_PUBLISHED' && !PLACED.test(d.field ?? '')),
    at: (prefix) =>
      details
        .filter((d) => d.field === prefix || d.field?.startsWith(`${prefix}.`) || d.field?.startsWith(`${prefix}[`))
        .map((d) => ({ field: (d.field ?? '').slice(prefix.length + 1).replace(/\[.*$/, ''), text: text(d.reason) })),
    product: (id) => {
      const d = details.find((x) => x.field === id && x.reason === 'PRODUCT_NOT_PUBLISHED');
      return d ? text(d.reason) : null;
    },
  };
}

function WhyText({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-error" data-testid="layout-problem">
      {[...new Set(items)].map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function Field({ label, children, className = '' }: { readonly label: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-base-content/60">{label}</span>
      {children}
    </label>
  );
}

/** 배너 그림 — 게시 전 그림은 운영자 토큰으로만 열린다(<img src> 는 토큰을 못 보내 blob URL) */
function BannerImage({ imageId, alt, className }: { readonly imageId: string; readonly alt: string; readonly className?: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['storefront', 'banner-image', imageId],
    enabled: imageId !== '',
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => URL.createObjectURL(await request('GET', api.storefront.GET('/storefront/banner-images/{imageId}', { params: { path: { imageId } }, parseAs: 'blob' }))),
  });
  if (!imageId) return <div className={`grid place-items-center bg-base-200 text-xs text-base-content/50 ${className ?? ''}`}>{m.noImage}</div>;
  if (q.isPending) return <div className={`skeleton ${className ?? ''}`} />;
  if (q.isError) return <div className={`grid place-items-center bg-base-200 text-xs text-error ${className ?? ''}`}>{m.imageUnavailable}</div>;
  return <img src={q.data} alt={alt} className={`object-cover ${className ?? ''}`} />;
}

function ProductName({ id }: { readonly id: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['product', 'detail', id], queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId: id } } })) });
  return <>{q.data?.internalName ?? (q.isError ? '?' : '…')}</>;
}

function CategoryPick({ value, onChange }: { readonly value: string; readonly onChange: (id: string) => void }) {
  const api = useApi();
  const tree = useQuery({ queryKey: ['product', 'category-tree'], queryFn: () => request('GET', api.product.GET('/categories/tree', {})) });
  const options = (tree.data?.nodes ?? []).map((n) => ({ value: n.categoryId, label: n.path ?? n.name }));
  return <SearchSelect label={m.linkCategory} value={value} options={options} loading={tree.isPending} loadingText={messages.loading} onChange={onChange} />;
}

function Mover({ i, n, onMove, onRemove, disabled }: { readonly i: number; readonly n: number; readonly onMove: (to: number) => void; readonly onRemove: () => void; readonly disabled: boolean }) {
  // 고칠 수 없으면(게시·승인 대기·요청 뒤) 순서·빼기 단추를 그리지 않는다
  if (disabled) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button type="button" className="btn btn-ghost btn-xs" aria-label={m.up} disabled={disabled || i === 0} onClick={() => onMove(i - 1)}>
        ↑
      </button>
      <button type="button" className="btn btn-ghost btn-xs" aria-label={m.down} disabled={disabled || i === n - 1} onClick={() => onMove(i + 1)}>
        ↓
      </button>
      <button type="button" className="btn btn-ghost btn-xs text-error" disabled={disabled} onClick={onRemove}>
        {m.remove}
      </button>
    </span>
  );
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  if (x !== undefined) next.splice(to, 0, x);
  return next;
};

function Period({ startsAt, endsAt, onChange, disabled }: { readonly startsAt: string | null | undefined; readonly endsAt: string | null | undefined; readonly onChange: (s: string | null, e: string | null) => void; readonly disabled: boolean }) {
  return (
    <fieldset className="flex flex-wrap items-end gap-2" disabled={disabled}>
      <legend className="mb-1 text-xs font-medium text-base-content/60">
        {m.period} <span className="font-normal text-base-content/45">· {m.periodHint}</span>
      </legend>
      <input type="datetime-local" aria-label={m.startsAt} className="input input-sm w-52" value={toLocal(startsAt)} onChange={(e) => onChange(fromLocal(e.target.value), endsAt ?? null)} />
      <span className="pb-1 text-base-content/40">~</span>
      <input type="datetime-local" aria-label={m.endsAt} className="input input-sm w-52" value={toLocal(endsAt)} onChange={(e) => onChange(startsAt ?? null, fromLocal(e.target.value))} />
    </fieldset>
  );
}

/** 남은 시간 표시(0.9.0 showTimer) — 켜면 끝 시각 필수(서버 TIMER_NEEDS_END) */
function TimerToggle({ checked, disabled, onChange }: { readonly checked: boolean; readonly disabled: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="checkbox checkbox-sm" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {m.showTimer}
        <span className="block text-xs text-base-content/55">{m.showTimerHint}</span>
      </span>
    </label>
  );
}

/** 남은 시간 머리 모양(storefront 0.12.0 BR-84 timerStyle) — 켰을 때만. LABEL 제목 위 분홍 글자(기본)·BAND 연분홍 띠 + 시·분·초 칸 */
function TimerStylePick({ value, disabled, onChange }: { readonly value: 'LABEL' | 'BAND'; readonly disabled: boolean; readonly onChange: (v: 'LABEL' | 'BAND') => void }) {
  const name = useId();
  return (
    <fieldset className="ml-6 flex flex-wrap items-center gap-4 text-sm" data-testid="timer-style">
      <legend className="sr-only">{m.timerStyle}</legend>
      <span className="text-xs text-base-content/60" aria-hidden="true">
        {m.timerStyle}
      </span>
      {(['LABEL', 'BAND'] as const).map((s) => (
        <label key={s} className="flex items-center gap-1.5">
          <input type="radio" className="radio radio-xs" name={name} checked={value === s} disabled={disabled} onChange={() => onChange(s)} />
          {m.timerStyleName[s]}
        </label>
      ))}
    </fieldset>
  );
}

/** 미리보기 남은 시간(표시만 — 지금 시각과 끝 시각의 차, 서버 판정 아님). 끝 시각이 없으면 칸만 */
function remainParts(endsAt: string | null | undefined): readonly [string, string, string] {
  const ms = endsAt ? Date.parse(endsAt) - Date.now() : NaN;
  if (Number.isNaN(ms)) return ['--', '--', '--'];
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return [p(Math.min(99, Math.floor(s / 3600))), p(Math.floor((s % 3600) / 60)), p(s % 60)];
}

function BannerCard({
  b,
  i,
  n,
  themes,
  groups,
  locked,
  why,
  onChange,
  onMove,
  onRemove,
}: {
  readonly b: Banner;
  readonly i: number;
  readonly n: number;
  readonly themes: readonly Theme[];
  /** 지금 있는 홈 중간 배너 묶음 groupId(순서대로) */
  readonly groups: readonly string[];
  readonly locked: boolean;
  readonly why: readonly Why[];
  readonly onChange: (b: Banner) => void;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const api = useApi();
  // 홈 중간 묶음이면 묶음 하나에 넣는다(없으면 새 묶음), 다른 자리면 groupId 를 비운다(INVALID_GROUP)
  const setPlacement = (placement: Banner['placement']) =>
    onChange(placement === 'HOME_INLINE' ? { ...b, placement, groupId: b.groupId ?? groups[0] ?? `G-${shortId()}` } : { ...b, placement, groupId: null });
  const upload = useCommand((file: File, key) =>
    request('POST', api.storefront.POST('/storefront/banner-images', { ...commandParams(key), body: { file: '' }, ...multipart({ file }) })),
  );
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const r = await upload.run(file);
    if (r.kind === 'done') onChange({ ...b, imageId: r.result.imageId });
  };
  const setLink = (linkType: Banner['linkType']) => onChange({ ...b, linkType, linkRef: linkType === 'SECTION' ? (themes[0]?.sectionId ?? '') : linkType === 'NONE' ? null : '' });

  return (
    <li className={`space-y-3 rounded-box border p-3 ${why.length ? 'border-error/50' : 'border-base-300'}`} data-testid="layout-banner">
      <div className="flex items-start gap-3">
        <BannerImage imageId={b.imageId} alt={b.altText} className="h-20 w-60 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <label className={`btn btn-sm ${locked || upload.busy ? 'btn-disabled' : ''}`}>
              {upload.busy ? m.uploading : b.imageId ? m.change : m.upload}
              <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" aria-label={m.image} disabled={locked || upload.busy} onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            <Mover i={i} n={n} onMove={onMove} onRemove={onRemove} disabled={locked} />
          </div>
          <span className="text-xs text-base-content/50">{m.imageHint}</span>
          <WhyText items={whyOf(why, 'imageId')} />
          {upload.phase.kind === 'rejected' &&
            (upload.phase.failure instanceof ProblemFailure && upload.phase.failure.problem.code === 'IMAGE_INVALID' ? <p className="text-xs text-error">{m.imageInvalid}</p> : <FailureAlert failure={upload.phase.failure} />)}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={m.placement}>
          <select className="select select-sm" disabled={locked} value={b.placement} onChange={(e) => setPlacement(e.target.value as Banner['placement'])}>
            {(['HOME_TOP', 'HOME_MIDDLE', 'HOME_INLINE', 'CATEGORY', 'POPUP', 'SPLASH'] as const).map((p) => (
              <option key={p} value={p}>
                {m.placementName[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.altText}>
          <input className="input input-sm w-full" maxLength={100} disabled={locked} value={b.altText} onChange={(e) => onChange({ ...b, altText: e.target.value })} />
          <WhyText items={whyOf(why, 'altText')} />
        </Field>
      </div>
      {m.placementHint[b.placement] && <p className="-mt-1 text-xs text-base-content/55">{m.placementHint[b.placement]}</p>}
      {b.placement === 'HOME_INLINE' && (
        <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label={m.group}>
            <select
              className="select select-sm"
              disabled={locked}
              value={b.groupId ?? ''}
              onChange={(e) => onChange({ ...b, groupId: e.target.value === NEW_GROUP ? `G-${shortId()}` : e.target.value })}
            >
              {groups.map((g, k) => (
                <option key={g} value={g}>
                  {m.groupName(k + 1)}
                </option>
              ))}
              <option value={NEW_GROUP}>{m.newGroup}</option>
            </select>
          </Field>
          <p className="self-end pb-1 text-xs text-base-content/55">{m.groupHint}</p>
          <WhyText items={whyOf(why, 'groupId')} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={m.link}>
          <select className="select select-sm" disabled={locked} value={b.linkType} onChange={(e) => setLink(e.target.value as Banner['linkType'])}>
            {(['SECTION', 'PRODUCT', 'CATEGORY', 'NONE'] as const).map((t) => (
              <option key={t} value={t}>
                {m.linkName[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col justify-end">
          {b.linkType === 'SECTION' &&
            (themes.length === 0 ? (
              <span className="text-sm text-base-content/55">{m.noThemeYet}</span>
            ) : (
              <select className="select select-sm w-full" aria-label={m.linkSection} disabled={locked} value={b.linkRef ?? ''} onChange={(e) => onChange({ ...b, linkRef: e.target.value })}>
                {themes.map((t) => (
                  <option key={t.sectionId} value={t.sectionId}>
                    {t.title || m.untitledTheme}
                  </option>
                ))}
              </select>
            ))}
          {b.linkType === 'PRODUCT' && !locked && <ProductPicker label={m.linkProduct} value={b.linkRef ?? ''} onChange={(id) => onChange({ ...b, linkRef: id })} />}
          {b.linkType === 'PRODUCT' && locked && b.linkRef && <ProductName id={b.linkRef} />}
          {b.linkType === 'CATEGORY' && <CategoryPick value={b.linkRef ?? ''} onChange={(id) => onChange({ ...b, linkRef: id })} />}
          <WhyText items={whyOf(why, 'linkRef')} />
        </div>
      </div>
      <Period startsAt={b.startsAt} endsAt={b.endsAt} disabled={locked} onChange={(s, e) => onChange({ ...b, startsAt: s, endsAt: e })} />
      <WhyText items={whyOf(why, 'startsAt', 'endsAt')} />
      <WhyText items={whyRest(why, BANNER_FIELDS)} />
    </li>
  );
}

function ThemeCard({
  t,
  i,
  n,
  locked,
  why,
  productWhy,
  inTab,
  onChange,
  onMove,
  onRemove,
}: {
  readonly t: Theme;
  readonly i: number;
  readonly n: number;
  readonly locked: boolean;
  readonly why: readonly Why[];
  readonly productWhy: (id: string) => string | null;
  /** 이 테마를 넣은 MD 탭 이름 — 있으면 홈에는 안 보인다 */
  readonly inTab: string | null;
  readonly onChange: (t: Theme) => void;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const [adding, setAdding] = useState('');
  const ids = t.productIds ?? [];
  const bad = why.length > 0 || ids.some((p) => productWhy(p));
  const auto = t.kind === 'RANKING_AUTO';
  // 자동 랭킹은 상품 없이 상위 몇 개만(INVALID_AUTO_THEME) — 바꾸면 상품을 비우고, 돌아가면 autoSize 를 비운다
  const setKind = (kind: Theme['kind']) =>
    onChange(kind === 'RANKING_AUTO' ? { ...t, kind, productIds: [], autoSize: t.autoSize ?? 10 } : { ...t, kind, autoSize: null });
  return (
    <li className={`space-y-3 rounded-box border p-3 ${bad ? 'border-error/50' : 'border-base-300'}`} data-testid="layout-theme">
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <Field label={m.kind}>
          <select className="select select-sm" disabled={locked} value={t.kind} onChange={(e) => setKind(e.target.value as Theme['kind'])}>
            {(['THEME', 'SEASON', 'WEEKLY_PICK', 'RANKING_AUTO'] as const).map((k) => (
              <option key={k} value={k}>
                {m.kindName[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.themeTitle}>
          <input className="input input-sm w-full" maxLength={40} disabled={locked} value={t.title} onChange={(e) => onChange({ ...t, title: e.target.value })} />
          <WhyText items={whyOf(why, 'title')} />
        </Field>
        <div className="flex items-end pb-0.5">
          <Mover i={i} n={n} onMove={onMove} onRemove={onRemove} disabled={locked} />
        </div>
      </div>
      <Field label={m.subtitle}>
        <input className="input input-sm w-full" maxLength={80} disabled={locked} value={t.subtitle ?? ''} onChange={(e) => onChange({ ...t, subtitle: e.target.value || null })} />
        <WhyText items={whyOf(why, 'subtitle')} />
      </Field>
      {inTab !== null && (
        <p className="text-xs text-info" data-testid="layout-theme-in-tab">
          {m.inTab(inTab)}
        </p>
      )}
      {auto ? (
        <div className="space-y-1">
          <Field label={m.autoSize} className="w-40">
            <input
              type="number"
              className="input input-sm w-full"
              min={1}
              max={30}
              disabled={locked}
              value={t.autoSize ?? ''}
              onChange={(e) => onChange({ ...t, autoSize: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <p className="text-xs text-base-content/55">{m.autoSizeHint}</p>
          <WhyText items={whyOf(why, 'autoSize', 'productIds', 'kind')} />
        </div>
      ) : (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-base-content/60">{m.products(ids.length)}</p>
        {ids.length === 0 ? (
          <p className="text-sm text-warning">{m.noProducts}</p>
        ) : (
          <ol className="divide-y divide-base-300 rounded-box border border-base-300">
            {ids.map((p, j) => (
              <li key={p} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid="layout-theme-product">
                <span className="w-5 text-right tabular-nums text-base-content/45">{j + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  <ProductName id={p} />
                  {productWhy(p) && <span className="ml-2 text-xs text-error">{productWhy(p)}</span>}
                </span>
                <Mover
                  i={j}
                  n={ids.length}
                  disabled={locked}
                  onMove={(to) => onChange({ ...t, productIds: move(ids, j, to) })}
                  onRemove={() => onChange({ ...t, productIds: ids.filter((x) => x !== p) })}
                />
              </li>
            ))}
          </ol>
        )}
        {!locked && ids.length < 50 && (
          <ProductPicker
            key={ids.length}
            label={m.addProduct}
            value={adding}
            onChange={(id) => {
              setAdding('');
              if (id && !ids.includes(id)) onChange({ ...t, productIds: [...ids, id] });
            }}
          />
        )}
        <WhyText items={whyOf(why, 'productIds', 'autoSize', 'kind')} />
      </div>
      )}
      <Period startsAt={t.startsAt} endsAt={t.endsAt} disabled={locked} onChange={(s, e) => onChange({ ...t, startsAt: s, endsAt: e })} />
      {/* 켜면 모양 기본 라벨형, 끄면 모양 비움(서버도 null 로 저장 — BR-84) */}
      <TimerToggle checked={t.showTimer ?? false} disabled={locked} onChange={(on) => onChange({ ...t, showTimer: on, timerStyle: on ? (t.timerStyle ?? 'LABEL') : null })} />
      {t.showTimer && <TimerStylePick value={t.timerStyle ?? 'LABEL'} disabled={locked} onChange={(v) => onChange({ ...t, timerStyle: v })} />}
      <WhyText items={whyOf(why, 'startsAt', 'endsAt', 'showTimer', 'timerStyle')} />
      <WhyText items={whyRest(why, THEME_FIELDS)} />
    </li>
  );
}

/** MD 탭(0.9.0) — 이름·넣을 테마(다른 탭에 들어간 테마는 고를 수 없음)·기간·남은 시간 표시 */
function TabCard({
  tab,
  i,
  n,
  themes,
  taken,
  locked,
  why,
  onChange,
  onMove,
  onRemove,
}: {
  readonly tab: Tab;
  readonly i: number;
  readonly n: number;
  readonly themes: readonly Theme[];
  /** 다른 탭에 들어간 테마 sectionId → 그 탭 이름 */
  readonly taken: ReadonlyMap<string, string>;
  readonly locked: boolean;
  readonly why: readonly Why[];
  readonly onChange: (t: Tab) => void;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const toggle = (id: string) => onChange({ ...tab, sectionIds: tab.sectionIds.includes(id) ? tab.sectionIds.filter((x) => x !== id) : [...tab.sectionIds, id] });
  return (
    <li className={`space-y-3 rounded-box border p-3 ${why.length ? 'border-error/50' : 'border-base-300'}`} data-testid="layout-tab">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label={m.tabTitle}>
          <input className="input input-sm w-full" maxLength={20} disabled={locked} value={tab.title} onChange={(e) => onChange({ ...tab, title: e.target.value })} />
          <WhyText items={whyOf(why, 'title')} />
        </Field>
        <div className="flex items-end pb-0.5">
          <Mover i={i} n={n} onMove={onMove} onRemove={onRemove} disabled={locked} />
        </div>
      </div>
      <fieldset className="space-y-1.5" disabled={locked}>
        <legend className="mb-1 text-xs font-medium text-base-content/60">{m.tabThemes(tab.sectionIds.length)}</legend>
        {themes.length === 0 ? (
          <p className="text-sm text-base-content/55">{m.noThemeYet}</p>
        ) : (
          <ul className="space-y-1">
            {themes.map((t) => {
              const other = taken.get(t.sectionId);
              const at = tab.sectionIds.indexOf(t.sectionId);
              return (
                <li key={t.sectionId}>
                  <label className={`flex items-center gap-2 text-sm ${other !== undefined ? 'text-base-content/45' : ''}`}>
                    <input type="checkbox" className="checkbox checkbox-sm" checked={at >= 0} disabled={other !== undefined} onChange={() => toggle(t.sectionId)} />
                    <span>{t.title || m.untitledTheme}</span>
                    {at >= 0 && <span className="badge badge-ghost badge-sm tabular-nums">{at + 1}</span>}
                    {other !== undefined && <span className="text-xs">{m.inOtherTab(other || m.untitledTab)}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <WhyText items={whyOf(why, 'sectionIds')} />
      </fieldset>
      <Period startsAt={tab.startsAt} endsAt={tab.endsAt} disabled={locked} onChange={(s, e) => onChange({ ...tab, startsAt: s, endsAt: e })} />
      <TimerToggle checked={tab.showTimer ?? false} disabled={locked} onChange={(on) => onChange({ ...tab, showTimer: on })} />
      <WhyText items={whyOf(why, 'startsAt', 'endsAt', 'showTimer')} />
      <WhyText items={whyRest(why, TAB_FIELDS)} />
    </li>
  );
}

/** 고객 홈 미리보기(초안 본문) — 탭 줄 → 맨 위 배너 → 테마 순서대로, 가운데 배너는 첫 테마 뒤. 탭에 넣은 테마는 홈에서 빠진다. 카테고리 화면·팝업·로딩 화면 배너는 아래에 따로 */
function Preview({ body, sticky = true }: { readonly body: Body; readonly sticky?: boolean }) {
  const banners = body.banners ?? [];
  const tabs = body.tabs ?? [];
  const tabbed = new Set(tabs.flatMap((t) => t.sectionIds));
  const themes = (body.themes ?? []).filter((t) => !tabbed.has(t.sectionId));
  const popups = banners.filter((b) => b.placement === 'POPUP');
  const splashes = banners.filter((b) => b.placement === 'SPLASH');
  // 0.11.0 카테고리 화면 맨 위 — 홈에는 안 나오므로 휴대폰 홈 그림 밖에 따로
  const category = banners.filter((b) => b.placement === 'CATEGORY');
  const top = banners.filter((b) => b.placement === 'HOME_TOP');
  const middle = banners.filter((b) => b.placement === 'HOME_MIDDLE');
  const strip = (list: readonly Banner[]) =>
    list.map((b) => <BannerImage key={b.bannerId} imageId={b.imageId} alt={b.altText} className="aspect-[3/1] w-full rounded-lg" />);
  // 넘기는 배너(맨 위·묶음) — 첫 장과 "1/n · n초마다"(배너가 1개면 넘기지 않는다)
  const interval = body.bannerIntervalSeconds;
  const carousel = (list: readonly Banner[], key: string, testId?: string) =>
    list.length > 0 && (
      <div key={key} className="space-y-0.5" data-testid={testId}>
        <BannerImage imageId={list[0]!.imageId} alt={list[0]!.altText} className="aspect-[3/1] w-full rounded-lg" />
        {list.length > 1 && <p className="text-right text-[10px] text-base-content/50">{m.carousel(list.length, interval ?? null)}</p>}
      </div>
    );
  // 홈 순서(0.10.0) — 있으면 그 순서로 묶음·테마, 없으면 테마 순서
  const order = homeOrderOf(body);
  type Slot = { readonly group: string } | { readonly theme: Theme };
  const seq: readonly Slot[] =
    order.length > 0
      ? order.flatMap((id): Slot[] => {
          if (id.startsWith('G-')) return [{ group: id }];
          const t = themes.find((x) => x.sectionId === id);
          return t ? [{ theme: t }] : [];
        })
      : themes.map((t) => ({ theme: t }));
  const firstTheme = seq.findIndex((x) => 'theme' in x);
  // 남은 시간 머리(BR-84) — 고객 앱과 같은 색(팔레트 tertiary, PC 1 2026-11-23): 라벨형 = 제목 위 분홍 시계 글자(바탕 없음),
  // 띠형 = 연분홍 띠 안에 제목과 "남은 시간" + 흰 칸 분홍 숫자(시·분·초)
  const band = (t: Theme) => t.showTimer && (t.timerStyle ?? 'LABEL') === 'BAND';
  const timerHead = (t: Theme) => {
    if (!t.showTimer) return null;
    const [h, mi, se] = remainParts(t.endsAt);
    return band(t) ? (
      <div className="space-y-1 rounded-md bg-app-tertiary-container px-2 py-1.5 text-app-on-tertiary-container" data-testid="preview-timer-band">
        <p className="text-sm font-bold">{t.title || m.untitledTheme}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold">{m.timerLeft}</span>
          <span className="flex items-center gap-0.5 font-mono text-[11px] font-bold">
            {[h, mi, se].map((x, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <span className="text-app-tertiary">:</span>}
                <span className="rounded-md bg-white px-1 text-app-tertiary">{x}</span>
              </span>
            ))}
          </span>
        </div>
      </div>
    ) : (
      <p className="text-[13px] font-bold text-app-tertiary" data-testid="preview-timer-label">
        {m.timerLabel(`${h}:${mi}:${se}`)}
      </p>
    );
  };
  const themeBlock = (t: Theme) => (
    <div key={t.sectionId} className="space-y-1.5">
      {timerHead(t)}
      {!band(t) && <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">{t.title || m.untitledTheme}</p>}
      {t.subtitle && <p className="text-xs text-base-content/55">{t.subtitle}</p>}
      {t.kind === 'RANKING_AUTO' ? (
        <p className="rounded-md bg-base-200 px-2 py-3 text-center text-xs text-base-content/60">{m.autoPreview(t.autoSize ?? 0)}</p>
      ) : (
      <div className="flex gap-2 overflow-hidden">
        {(t.productIds ?? []).slice(0, 6).map((p) => (
          <div key={p} className="w-20 shrink-0 space-y-1">
            <div className="aspect-square rounded-md bg-base-200" />
            <p className="line-clamp-2 text-[11px] leading-tight">
              <ProductName id={p} />
            </p>
          </div>
        ))}
      </div>
      )}
    </div>
  );
  // 팝업·로딩 화면 — 휴대폰 전체 화면 비율
  const fullScreen = (label: string, list: readonly Banner[], testId: string) =>
    list.length > 0 && (
      <div className="space-y-1" data-testid={testId}>
        <p className="text-xs text-base-content/55">{label}</p>
        {list.map((b) => (
          <BannerImage key={b.bannerId} imageId={b.imageId} alt={b.altText} className="aspect-[9/16] w-28 rounded-lg border-2 border-base-300" />
        ))}
      </div>
    );
  return (
    <aside className={`${sticky ? 'sticky top-16 ' : ''}space-y-2`} aria-label={m.preview} data-testid="layout-preview">
      <p className="text-sm font-semibold">
        {m.preview} <span className="text-xs font-normal text-base-content/50">· {m.previewHint}</span>
      </p>
      <div className="mx-auto w-[300px] space-y-3 rounded-[1.5rem] border-4 border-base-300 bg-base-100 p-3 shadow-sm">
        {banners.length === 0 && themes.length === 0 ? (
          <p className="py-16 text-center text-xs text-base-content/50">{m.previewEmpty}</p>
        ) : (
          <>
            {tabs.length > 0 && (
              <div className="flex gap-3 overflow-hidden border-b border-base-300 pb-1 text-xs" data-testid="layout-preview-tabs">
                <span className="font-bold">{m.previewHome}</span>
                {tabs.map((t) => (
                  <span key={t.tabKey} className="whitespace-nowrap text-base-content/60">
                    {t.title || m.untitledTab}
                  </span>
                ))}
              </div>
            )}
            {carousel(top, 'top')}
            {seq.map((x, k) => (
              <div key={'group' in x ? x.group : x.theme.sectionId} className="space-y-3">
                {'group' in x
                  ? carousel(
                      banners.filter((b) => b.placement === 'HOME_INLINE' && b.groupId === x.group),
                      x.group,
                      'layout-preview-group',
                    )
                  : themeBlock(x.theme)}
                {k === firstTheme && strip(middle)}
              </div>
            ))}
            {firstTheme < 0 && strip(middle)}
          </>
        )}
      </div>
      {category.length > 0 && (
        <div className="mx-auto w-[300px] space-y-1" data-testid="layout-preview-category">
          <p className="text-xs text-base-content/55">{m.placementName['CATEGORY']}</p>
          {carousel(category, 'category')}
        </div>
      )}
      {(popups.length > 0 || splashes.length > 0) && (
        <div className="flex flex-wrap justify-center gap-4">
          {fullScreen(m.placementName['POPUP'] ?? '', popups, 'layout-preview-popup')}
          {fullScreen(m.placementName['SPLASH'] ?? '', splashes, 'layout-preview-splash')}
        </div>
      )}
    </aside>
  );
}

/**
 * 승인 상세의 편성 초안 미리보기(2026-11-20 — 백엔드 회신: DISPLAY_APPROVER 도 layout-drafts·banner-images 를 읽음, storefront 0.7.1).
 * 보기만 — 고치기·제출은 편성 화면(MD·OPERATOR_ADMIN). 못 읽으면 QueryState 가 실패로 보인다(빈 편성으로 보이지 않게).
 */
export function LayoutDraftPreview({ draftId }: { readonly draftId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['storefront', 'layout-draft', draftId],
    queryFn: () => request('GET', api.storefront.GET('/storefront/layout-drafts/{draftId}', { params: { path: { draftId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(d) => <Preview body={bodyOf(d)} sticky={false} />}
    </QueryState>
  );
}

export function HomeLayoutDraftPage() {
  const { draftId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['storefront', 'layout-draft', draftId],
    queryFn: () => request('GET', api.storefront.GET('/storefront/layout-drafts/{draftId}', { params: { path: { draftId } } })),
  });
  return (
    <section className="max-w-7xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => <Editor key={d.draftId} draft={d} />}
      </QueryState>
    </section>
  );
}

interface SubmitResult {
  readonly approvalId: string | null;
  /** 제출(잠금)은 됐는데 승인 요청이 실패했으면 그 본문 — 그 단계만 다시 */
  readonly retry: ApprovalRequestBody | null;
  readonly failure: PmartFailure | null;
}

function Editor({ draft }: { readonly draft: Draft }) {
  const api = useApi();
  const qc = useQueryClient();
  const [body, setBody] = useState<Body>(() => bodyOf(draft));
  // 마지막으로 서버에 저장한 본문·버전 — 제출이 검사에 걸려도 저장은 이미 됐으니, 다음 저장은 그 버전으로(옛 버전이면 409)
  const [base, setBase] = useState(() => ({ version: draft.version, body: withOrder(bodyOf(draft)) }));
  const editable = draft.state === 'DRAFT' || draft.state === 'REJECTED';
  const dirty = useMemo(() => JSON.stringify(withOrder(body)) !== JSON.stringify(base.body), [body, base]);
  const banners = body.banners ?? [];
  const themes = body.themes ?? [];
  const tabs = body.tabs ?? [];
  /** 테마 sectionId → 넣은 탭(순서) */
  const tabOf = new Map(tabs.flatMap((t, ti) => t.sectionIds.map((id) => [id, ti] as const)));
  const groups = groupsOf(body);
  // 홈 순서 목록 — 보낼 순서, 비었으면(옮긴 적 없고 묶음 없음) 테마 순서 그대로 보여 준다
  const sentOrder = homeOrderOf(body);
  const orderList = sentOrder.length > 0 ? sentOrder : homeThemesOf(body).map((t) => t.sectionId);
  const moveOrder = (from: number, to: number) => setBody((x) => ({ ...x, homeOrder: move(orderList, from, to) }));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['storefront'] });
  };
  const put = async (key: IdempotencyKey) => {
    const sent = withOrder(body);
    const saved = await request('PUT', api.storefront.PUT('/storefront/layout-drafts/{draftId}', { ...commandParams(key, { path: { draftId: draft.draftId }, version: base.version }), body: sent }));
    setBase({ version: saved.version, body: sent });
    void qc.invalidateQueries({ queryKey: ['storefront', 'layout-drafts'] });
  };
  // 저장도 명령 — 다시 누르기(같은 시도)는 같은 키(PR #282 검토 댓글)
  const save = useCommand((_: void, key) => put(key));

  // 한 번 누르면: (바뀐 게 있으면) 저장 → 제출(검사·잠금) → 승인 요청. 키 하나에서 단계별 키를 만든다(다시 누르면 같은 키)
  const submit = useCommand(async (_: void, key): Promise<SubmitResult> => {
    if (dirty) await put(new IdempotencyKey(`${key.value}:save`));
    const sub = await request(
      'POST',
      api.storefront.POST('/storefront/layout-drafts/{draftId}/submissions', { ...commandParams(new IdempotencyKey(`${key.value}:submit`), { path: { draftId: draft.draftId } }) }),
    );
    const ap = sub.approvalRequest as unknown as ApprovalRequestBody;
    try {
      const r = await requestApproval(api, ap, new IdempotencyKey(`${key.value}:approval`));
      return { approvalId: r.approvalId, retry: null, failure: null };
    } catch (e) {
      return { approvalId: null, retry: ap, failure: e instanceof PmartFailure ? e : null };
    }
  });
  const result = submit.phase.kind === 'done' ? submit.phase.result : null;
  // 빈 칸은 보내기 전에 막는다(누른 뒤부터 칸 옆에 — 고치면 바로 사라짐). 없으면 마지막 서버 오류(저장·제출)
  const [checked, setChecked] = useState<'save' | 'submit' | null>(null);
  const local = checked ? localDetails(body, checked === 'submit') : [];
  const lastFailure = submit.phase.kind === 'rejected' ? submit.phase.failure : save.phase.kind === 'rejected' ? save.phase.failure : null;
  const problems = problemsOf(local.length > 0 ? local : serverDetails(lastFailure));
  const problemKey = `${problems.count}:${local.length > 0 ? 'local' : submit.phase.kind + save.phase.kind}`;
  // 고칠 곳이 생기면 첫 칸으로 데려간다(2026-11-21 점검 — 아래 줄에만 "N군데"가 떠서 칸이 화면 밖에 있었다)
  const goFirst = () => document.querySelector('[data-testid=layout-problem]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  useEffect(() => {
    if (problems.count > 0) requestAnimationFrame(goFirst);
  }, [problemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runSave = () => {
    if (localDetails(body, false).length > 0) return setChecked('save');
    setChecked(null);
    void save.run();
  };
  const runSubmit = () => {
    if (localDetails(body, true).length > 0) return setChecked('submit');
    setChecked(null);
    void submit.run();
  };
  const locked = !editable || submit.busy || result !== null || save.busy;
  const orderWhy = problems.at('homeOrder').map((w) => w.text);
  const intervalWhy = problems.at('bannerIntervalSeconds').map((w) => w.text);

  const setBanner = (i: number, b: Banner) => setBody((x) => ({ ...x, banners: (x.banners ?? []).map((y, j) => (j === i ? b : y)) }));
  const setTheme = (i: number, t: Theme) => setBody((x) => ({ ...x, themes: (x.themes ?? []).map((y, j) => (j === i ? t : y)) }));
  const setTab = (i: number, t: Tab) => setBody((x) => ({ ...x, tabs: (x.tabs ?? []).map((y, j) => (j === i ? t : y)) }));
  const addTab = () => setBody((x) => ({ ...x, tabs: [...(x.tabs ?? []), { tabKey: `X-${shortId()}`, title: '', sectionIds: [], sortOrder: 0, startsAt: null, endsAt: null, showTimer: false }] }));
  const addBanner = () =>
    setBody((x) => ({
      ...x,
      banners: [...(x.banners ?? []), { bannerId: `B-${shortId()}`, placement: 'HOME_TOP', imageId: '', altText: '', linkType: themes[0] ? 'SECTION' : 'NONE', linkRef: themes[0]?.sectionId ?? null, sortOrder: 0, startsAt: null, endsAt: null }],
    }));
  const addTheme = () => setBody((x) => ({ ...x, themes: [...(x.themes ?? []), { sectionId: `T-${shortId()}`, kind: 'THEME', title: '', subtitle: null, productIds: [], sortOrder: 0, startsAt: null, endsAt: null, showTimer: false }] }));
  const removeTheme = (i: number) =>
    setBody((x) => {
      const gone = (x.themes ?? [])[i]?.sectionId;
      // 그 테마로 가던 배너는 "아무 데도 안 감"으로(남겨 두면 INVALID_LINK)
      return {
        ...x,
        themes: (x.themes ?? []).filter((_, j) => j !== i),
        banners: (x.banners ?? []).map((b) => (b.linkType === 'SECTION' && b.linkRef === gone ? { ...b, linkType: 'NONE', linkRef: null } : b)),
        // 탭에서도 뺀다(남겨 두면 UNKNOWN_SECTION)
        tabs: (x.tabs ?? []).map((t) => ({ ...t, sectionIds: t.sectionIds.filter((id) => id !== gone) })),
      };
    });

  return (
    <>
      <LeaveGuard when={editable && dirty && result === null} />
      <PageHeader
        back={{ to: '/display/home', label: m.back }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {titleOf(body)}
            <StatusBadge tone={TONE[draft.state]} testId="layout-state">
              {m.state[draft.state]}
            </StatusBadge>
          </span>
        }
        actions={
          draft.approvalId ? (
            <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(draft.approvalId)}`}>
              {m.openApproval}
            </Link>
          ) : undefined
        }
      />

      {draft.state === 'PUBLISHED' && draft.layoutVersion != null && (
        <div className="alert alert-success alert-soft text-sm" role="status">
          <span>
            {m.published(draft.layoutVersion)} · {m.readOnly}
          </span>
        </div>
      )}
      {draft.state === 'SUBMITTED' && result === null && (
        <div className="alert alert-warning alert-soft text-sm" role="status" data-testid="layout-submitted">
          {m.submitted}
        </div>
      )}
      {draft.state === 'REJECTED' && (
        <div className="alert alert-error alert-soft flex-col items-start gap-0.5 text-sm" role="status" data-testid="layout-rejected">
          <span className="font-semibold">{m.rejected}</span>
          {draft.rejectionReason && <span>{m.rejectedWhy(draft.rejectionReason)}</span>}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" aria-label={m.banners}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {m.banners} <span className="text-sm font-normal text-base-content/50">{banners.length}</span>
              </h2>
              {!locked && (
                <button type="button" className="btn btn-sm btn-outline btn-primary" data-testid="layout-add-banner" onClick={addBanner}>
                  {m.addBanner}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={m.interval} className="w-36">
                <input
                  type="number"
                  className="input input-sm w-full"
                  min={2}
                  max={30}
                  disabled={locked}
                  value={body.bannerIntervalSeconds ?? ''}
                  onChange={(e) => setBody((x) => ({ ...x, bannerIntervalSeconds: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </Field>
              <p className="pb-1 text-xs text-base-content/55">{m.intervalHint}</p>
            </div>
            <WhyText items={intervalWhy} />
            {banners.length === 0 ? (
              <p className="text-sm text-base-content/55">{m.noBanners}</p>
            ) : (
              <ul className="space-y-3">
                {banners.map((b, i) => (
                  <BannerCard
                    key={b.bannerId}
                    b={b}
                    i={i}
                    n={banners.length}
                    themes={themes}
                    groups={groups}
                    locked={locked}
                    why={problems.at(`banners[${i}]`)}
                    onChange={(x) => setBanner(i, x)}
                    onMove={(to) => setBody((x) => ({ ...x, banners: move(x.banners ?? [], i, to) }))}
                    onRemove={() => setBody((x) => ({ ...x, banners: (x.banners ?? []).filter((_, j) => j !== i) }))}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" aria-label={m.themes}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {m.themes} <span className="text-sm font-normal text-base-content/50">{themes.length}</span>
              </h2>
              {!locked && (
                <button type="button" className="btn btn-sm btn-outline btn-primary" data-testid="layout-add-theme" onClick={addTheme}>
                  {m.addTheme}
                </button>
              )}
            </div>
            {themes.length === 0 ? (
              <p className="text-sm text-base-content/55">{m.noThemes}</p>
            ) : (
              <ul className="space-y-3">
                {themes.map((t, i) => (
                  <ThemeCard
                    key={t.sectionId}
                    t={t}
                    i={i}
                    n={themes.length}
                    locked={locked}
                    why={problems.at(`themes[${i}]`)}
                    productWhy={problems.product}
                    inTab={tabOf.has(t.sectionId) ? tabs[tabOf.get(t.sectionId) ?? 0]?.title || m.untitledTab : null}
                    onChange={(x) => setTheme(i, x)}
                    onMove={(to) => setBody((x) => ({ ...x, themes: move(x.themes ?? [], i, to) }))}
                    onRemove={() => removeTheme(i)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" aria-label={m.tabsTitle}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {m.tabsTitle} <span className="text-sm font-normal text-base-content/50">{tabs.length}</span>
              </h2>
              {!locked && tabs.length < 5 && (
                <button type="button" className="btn btn-sm btn-outline btn-primary" data-testid="layout-add-tab" onClick={addTab}>
                  {m.addTab}
                </button>
              )}
            </div>
            <p className="text-xs text-base-content/55">{m.tabsHint}</p>
            {tabs.length === 0 ? (
              <p className="text-sm text-base-content/55">{m.noTabs}</p>
            ) : (
              <ul className="space-y-3">
                {tabs.map((t, i) => (
                  <TabCard
                    key={t.tabKey}
                    tab={t}
                    i={i}
                    n={tabs.length}
                    themes={themes}
                    taken={new Map([...tabOf].filter(([, ti]) => ti !== i).map(([id, ti]) => [id, tabs[ti]?.title ?? '']))}
                    locked={locked}
                    why={problems.at(`tabs[${i}]`)}
                    onChange={(x) => setTab(i, x)}
                    onMove={(to) => setBody((x) => ({ ...x, tabs: move(x.tabs ?? [], i, to) }))}
                    onRemove={() => setBody((x) => ({ ...x, tabs: (x.tabs ?? []).filter((_, j) => j !== i) }))}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className={`space-y-3 rounded-box border bg-base-100 p-4 shadow-sm ${orderWhy.length ? 'border-error/50' : 'border-base-300'}`} aria-label={m.homeOrder}>
            <h2 className="font-bold">
              {m.homeOrder} <span className="text-sm font-normal text-base-content/50">{orderList.length}</span>
            </h2>
            <p className="text-xs text-base-content/55">{m.homeOrderHint}</p>
            {orderList.length === 0 ? (
              <p className="text-sm text-base-content/55">{m.homeOrderEmpty}</p>
            ) : (
              <ol className="divide-y divide-base-300 rounded-box border border-base-300">
                {orderList.map((id, k) => {
                  const g = groups.indexOf(id);
                  const t = themes.find((x) => x.sectionId === id);
                  const count = banners.filter((b) => b.placement === 'HOME_INLINE' && b.groupId === id).length;
                  return (
                    <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid="layout-order-item">
                      <span className="w-5 text-right tabular-nums text-base-content/45">{k + 1}</span>
                      <span className={`badge badge-sm ${g >= 0 ? 'badge-primary badge-soft' : 'badge-ghost'}`}>{g >= 0 ? m.orderBanner : m.orderTheme}</span>
                      <span className="min-w-0 flex-1 truncate">{g >= 0 ? `${m.groupName(g + 1)} · ${m.groupCount(count)}` : t?.title || m.untitledTheme}</span>
                      {!locked && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button type="button" className="btn btn-ghost btn-xs" aria-label={m.up} disabled={k === 0} onClick={() => moveOrder(k, k - 1)}>
                            ↑
                          </button>
                          <button type="button" className="btn btn-ghost btn-xs" aria-label={m.down} disabled={k === orderList.length - 1} onClick={() => moveOrder(k, k + 1)}>
                            ↓
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <WhyText items={orderWhy} />
          </section>

          <section className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
            <Field label={m.note}>
              <input className="input input-sm w-full" maxLength={200} disabled={locked} value={body.note ?? ''} onChange={(e) => setBody((x) => ({ ...x, note: e.target.value || null }))} />
            </Field>
          </section>

          {editable && (
            <div className="sticky bottom-0 z-10 space-y-2 rounded-box border border-base-300 bg-base-100/95 px-4 py-3 shadow-md backdrop-blur">
              {result === null && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {problems.count > 0 && (
                    <span className="mr-auto flex flex-wrap items-center gap-2 text-sm text-error" data-testid="layout-invalid">
                      {m.invalid(problems.count)}
                      <button type="button" className="link text-xs" onClick={goFirst}>
                        {m.goFirst}
                      </button>
                    </span>
                  )}
                  {dirty && problems.count === 0 && <span className="mr-auto text-xs text-base-content/55">{m.unsaved}</span>}
                  <button type="button" className="btn btn-sm" disabled={!dirty || locked} data-testid="layout-save" onClick={runSave}>
                    {m.save}
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={locked} data-testid="layout-submit" onClick={runSubmit}>
                    {dirty ? m.saveAndSubmit : m.submit}
                  </button>
                </div>
              )}
              {local.length === 0 && (problems.count === 0 || problems.unplaced) && (save.phase.kind === 'rejected' || save.phase.kind === 'unknown') && <FailureAlert failure={save.phase.failure} />}
              {/* 승인 요청은 반영이 아니다 — 성공 알림 대신 아래 상자, 실패만 */}
              {local.length === 0 && (problems.count === 0 || problems.unplaced) && (submit.phase.kind === 'rejected' || submit.phase.kind === 'unknown') && <FailureAlert failure={submit.phase.failure} />}
              {result?.approvalId && (
                <div className="alert alert-success alert-soft text-sm" role="status" data-testid="layout-requested">
                  <span>{m.requested}</span>
                  <Link className="link" to={`/approvals/${encodeURIComponent(result.approvalId)}`} onClick={refresh}>
                    {m.openApproval}
                  </Link>
                </div>
              )}
              {result?.retry && (
                <div className="space-y-2">
                  <p className="text-sm text-warning">{m.requestAgain}</p>
                  {result.failure && <FailureAlert failure={result.failure} />}
                  <RequestApproval body={result.retry} onRequested={refresh} />
                </div>
              )}
            </div>
          )}
        </div>
        <Preview body={body} />
      </div>
    </>
  );
}
