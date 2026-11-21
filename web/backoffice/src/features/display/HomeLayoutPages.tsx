// 홈 진열 편성 — 일반 배너·상품 테마(storefront 0.7.0 layouts, ADR-0075 ② BO-05 — PC 1 요청서 2026-11-20 request-home-banners-themes).
// 초안(DRAFT) → 저장(PUT, X-Expected-Version) → 제출(검사·잠금, approvalRequest) → approval DISPLAY → 승인되면 PUBLISHED(새 홈 버전), 반려면 REJECTED(고쳐서 다시).
// 콘텐츠 게시와 같은 모양. 한 번 누르면 저장 → 제출 → 승인 요청까지(승인 요청만 실패하면 그 단계만 다시 올리는 상자).
// 고객 홈은 승인 뒤에만 바뀐다 — 미리보기는 초안 본문으로 그린다. 배너·테마·탭 ID 는 화면이 만들고 보이지 않는다(ADR-0070).
// storefront 0.9.0(2026-11-21 PC 1 요청서 request-home-promotion-extras): 배너 자리 팝업·로딩 화면, 테마 남은 시간 표시(showTimer — endsAt 필수),
// 자동 랭킹 테마(RANKING_AUTO — 상품 대신 autoSize 1~30), MD 탭(tabs — 넣은 테마는 홈에서 빠짐). 할인·특가·쿠폰 문구는 이제 허용, 근거 없는 "최저가"·"신선 보장"만 서버가 막는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
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

const bodyOf = (d: Draft): Body => ({ banners: d.banners ?? [], themes: d.themes ?? [], tabs: d.tabs ?? [], note: d.note ?? null });
const withOrder = (b: Body): Body => ({
  ...b,
  banners: (b.banners ?? []).map((x, i) => ({ ...x, sortOrder: i })),
  themes: (b.themes ?? []).map((x, i) => ({ ...x, sortOrder: i })),
  tabs: (b.tabs ?? []).map((x, i) => ({ ...x, sortOrder: i })),
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
const BANNER_FIELDS = ['imageId', 'altText', 'linkRef', 'startsAt', 'endsAt', 'placement'];
const THEME_FIELDS = ['title', 'subtitle', 'startsAt', 'endsAt', 'productIds', 'autoSize', 'showTimer', 'kind'];
const TAB_FIELDS = ['title', 'sectionIds', 'startsAt', 'endsAt', 'showTimer'];

interface Problems {
  readonly at: (prefix: string) => readonly Why[];
  readonly product: (productId: string) => string | null;
  readonly count: number;
}
function problemsOf(failure: PmartFailure | null): Problems {
  const details = failure instanceof ProblemFailure && failure.problem.code === 'LAYOUT_INVALID' ? (failure.problem.details ?? []) : [];
  const text = (r: string | undefined) => (r && m.reason[r]) || r || '';
  return {
    count: details.length,
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

function BannerCard({
  b,
  i,
  n,
  themes,
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
  readonly locked: boolean;
  readonly why: readonly Why[];
  readonly onChange: (b: Banner) => void;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const api = useApi();
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
          <select className="select select-sm" disabled={locked} value={b.placement} onChange={(e) => onChange({ ...b, placement: e.target.value as Banner['placement'] })}>
            {(['HOME_TOP', 'HOME_MIDDLE', 'POPUP', 'SPLASH'] as const).map((p) => (
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
      <TimerToggle checked={t.showTimer ?? false} disabled={locked} onChange={(on) => onChange({ ...t, showTimer: on })} />
      <WhyText items={whyOf(why, 'startsAt', 'endsAt', 'showTimer')} />
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

/** 고객 홈 미리보기(초안 본문) — 탭 줄 → 맨 위 배너 → 테마 순서대로, 가운데 배너는 첫 테마 뒤. 탭에 넣은 테마는 홈에서 빠진다. 팝업·로딩 화면은 아래에 따로 */
function Preview({ body, sticky = true }: { readonly body: Body; readonly sticky?: boolean }) {
  const banners = body.banners ?? [];
  const tabs = body.tabs ?? [];
  const tabbed = new Set(tabs.flatMap((t) => t.sectionIds));
  const themes = (body.themes ?? []).filter((t) => !tabbed.has(t.sectionId));
  const popups = banners.filter((b) => b.placement === 'POPUP');
  const splashes = banners.filter((b) => b.placement === 'SPLASH');
  const top = banners.filter((b) => b.placement === 'HOME_TOP');
  const middle = banners.filter((b) => b.placement === 'HOME_MIDDLE');
  const strip = (list: readonly Banner[]) =>
    list.map((b) => <BannerImage key={b.bannerId} imageId={b.imageId} alt={b.altText} className="aspect-[3/1] w-full rounded-lg" />);
  const themeBlock = (t: Theme) => (
    <div key={t.sectionId} className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
        {t.title || m.untitledTheme}
        {t.showTimer && t.endsAt && <span className="badge badge-error badge-soft badge-xs font-normal">{m.timerUntil(formatSeoul(t.endsAt))}</span>}
      </p>
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
            {strip(top)}
            {themes.slice(0, 1).map(themeBlock)}
            {strip(middle)}
            {themes.slice(1).map(themeBlock)}
          </>
        )}
      </div>
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
  const problems = problemsOf(submit.phase.kind === 'rejected' ? submit.phase.failure : null);
  const locked = !editable || submit.busy || result !== null || save.busy;

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
                    <span className="mr-auto text-sm text-error" data-testid="layout-invalid">
                      {m.invalid(problems.count)}
                    </span>
                  )}
                  {dirty && problems.count === 0 && <span className="mr-auto text-xs text-base-content/55">{m.unsaved}</span>}
                  <button type="button" className="btn btn-sm" disabled={!dirty || locked} data-testid="layout-save" onClick={() => void save.run()}>
                    {m.save}
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={locked} data-testid="layout-submit" onClick={() => void submit.run()}>
                    {dirty ? m.saveAndSubmit : m.submit}
                  </button>
                </div>
              )}
              {(save.phase.kind === 'rejected' || save.phase.kind === 'unknown') && <FailureAlert failure={save.phase.failure} />}
              {/* 승인 요청은 반영이 아니다 — 성공 알림 대신 아래 상자, 실패만 */}
              {problems.count === 0 && (submit.phase.kind === 'rejected' || submit.phase.kind === 'unknown') && <FailureAlert failure={submit.phase.failure} />}
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
