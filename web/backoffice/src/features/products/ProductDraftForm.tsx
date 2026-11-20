// 상품 초안 입력(계약 ProductDraftInput). 카테고리는 발효된 트리에서 고르고(대표 1·노출 여러 개), 대표 카테고리의 필터 옵션을
// 고르며, SKU 는 여러 개(물류 규격 포함). seed-v1 product.json 으로 채울 수 있다. 빈 칸은 보내지 않는다(0 으로 채우지 않음).
import { SearchSelect } from '../../shared/SearchSelect';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { PmartFailure } from '@pmart/web-core';
import { STORAGE_TYPES, type CategoryNode, type ProductDraftInput, type SaleUnitType, type StorageType } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { FailureAlert } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages as m } from '../../shared/messages';
import { MultiSelectDropdown } from '@pmart/web-ui';
import { gs1CheckDigitProblem } from './barcode';
import { Card } from './parts';
import { parseProductJson, ProductJsonError, type SkuJson } from './productJson';

const fieldLabel = 'text-sm font-semibold text-base-content/85'; // 2026-11-20 AWS 개편

type DraftSku = ProductDraftInput['skus'][number];
type DimensionsSource = NonNullable<DraftSku['dimensionsSource']>;

type NetUnit = 'G' | 'KG' | 'ML' | 'L';
const NET_UNITS: readonly NetUnit[] = ['G', 'KG', 'ML', 'L'];
/** 화면 값 → 계약 값(g·mL 정수 1~1,000,000). 비었으면 null(보내지 않음), 잘못이면 'invalid' — 판정은 서버(NET_CONTENT_INVALID)도 한다 */
export function netContentOf(amount: string, unit: NetUnit): { amount: number; unit: 'G' | 'ML' } | null | 'invalid' {
  const t = amount.trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid';
  const big = unit === 'KG' || unit === 'L';
  const n = Math.round(Number(t) * (big ? 1000 : 1) * 1000) / 1000;
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return 'invalid';
  return { amount: n, unit: unit === 'G' || unit === 'KG' ? 'G' : 'ML' };
}

interface SkuRow {
  unitType: SaleUnitType;
  unitsPerSku: string;
  weightG: string;
  volumeMl: string;
  // 내용량(product 0.4.0 — 고객 앱 "100g당 가격"). 화면은 g·kg·mL·L 로 받고 보낼 때 g·mL 정수로(kg·L ×1000)
  netAmount: string;
  netUnit: NetUnit;
  storageType: StorageType | '';
  alcohol: boolean;
  barcodes: string;
  unitsPerBox: string;
  ti: string;
  hi: string;
  boxesPerPallet: string;
  // 소비기한 보장·실물 치수 — 수정 초안(product 0.3.0)은 현재 값이 들어 있고, 빠뜨리면 승인 때 지워진다.
  minRemainingDays: string;
  maxDaysSinceManufacture: string;
  widthMm: string;
  depthMm: string;
  heightMm: string;
  dimensionsSource: DimensionsSource | '';
}

interface FormValues {
  internalName: string;
  primaryCategoryId: string;
  categoryIds: string[];
  /** 트리에서 못 찾은 이름 경로(JSON). 서버가 이름으로 매핑한다(계약 categoryPaths). */
  categoryPaths: string[];
  /** filterGroupId → 고른 옵션 */
  filterOptions: Record<string, string[]>;
  skus: SkuRow[];
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
const int = (s: string): number | undefined => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined);
const numText = (n: number | undefined | null) => (n === undefined || n === null ? '' : String(n));

const emptySku = (): SkuRow => ({
  unitType: 'E',
  unitsPerSku: '1',
  weightG: '',
  volumeMl: '',
  netAmount: '',
  netUnit: 'G',
  storageType: '',
  alcohol: false,
  barcodes: '',
  unitsPerBox: '',
  ti: '',
  hi: '',
  boxesPerPallet: '',
  minRemainingDays: '',
  maxDaysSinceManufacture: '',
  widthMm: '',
  depthMm: '',
  heightMm: '',
  dimensionsSource: '',
});

const emptyValues = (): FormValues => ({
  internalName: '',
  primaryCategoryId: '',
  categoryIds: [],
  categoryPaths: [],
  filterOptions: {},
  skus: [emptySku()],
});

function skuRowOf(s: DraftSku | SkuJson): SkuRow {
  const l = 'logistics' in s ? s.logistics : undefined;
  const j = s as Partial<SkuJson>;
  const d = s as Partial<DraftSku>;
  return {
    unitType: s.unitType,
    unitsPerSku: String(s.unitsPerSku),
    weightG: numText(s.weightG),
    volumeMl: numText(s.volumeMl),
    netAmount: numText(d.netContent?.amount),
    netUnit: d.netContent?.unit === 'ML' ? 'ML' : 'G',
    storageType: s.storageType ?? l?.storageType ?? '',
    alcohol: s.alcohol ?? false,
    barcodes: (s.barcodes ?? []).join(', '),
    unitsPerBox: numText(l?.unitsPerBox ?? j.unitsPerBox),
    ti: numText(l?.ti ?? j.ti),
    hi: numText(l?.hi ?? j.hi),
    boxesPerPallet: numText(l?.boxesPerPallet ?? j.boxesPerPallet),
    minRemainingDays: numText(d.shelfLifeGuarantee?.minRemainingDays),
    maxDaysSinceManufacture: numText(d.shelfLifeGuarantee?.maxDaysSinceManufacture),
    widthMm: numText(d.dimensions?.widthMm),
    depthMm: numText(d.dimensions?.depthMm),
    heightMm: numText(d.dimensions?.heightMm),
    dimensionsSource: d.dimensionsSource ?? '',
  };
}

function toValues(input: ProductDraftInput | undefined): FormValues {
  if (!input) return emptyValues();
  const filterOptions: Record<string, string[]> = {};
  for (const f of input.filterOptions ?? []) (filterOptions[f.filterGroupId] ??= []).push(f.option);
  return {
    internalName: input.product.internalName,
    primaryCategoryId: input.product.primaryCategoryId ?? '',
    categoryIds: input.product.categoryIds ?? [],
    categoryPaths: input.product.categoryPaths ?? [],
    filterOptions,
    skus: input.skus.length > 0 ? input.skus.map(skuRowOf) : [emptySku()],
  };
}

function toInput(v: FormValues, base: ProductDraftInput | undefined): ProductDraftInput {
  const categoryIds = v.categoryIds.filter((id) => id !== v.primaryCategoryId);
  const filterOptions = Object.entries(v.filterOptions).flatMap(([filterGroupId, options]) => options.map((option) => ({ filterGroupId, option })));
  // 원천 정보(baseProductKey·saleState 등)는 두고, 카테고리는 폼 값으로 다시 정한다.
  const baseProduct = { ...(base?.product ?? { internalName: '' }) };
  delete baseProduct.primaryCategoryId;
  delete baseProduct.categoryIds;
  delete baseProduct.categoryPaths;
  return {
    ...(base?.targetProductId ? { targetProductId: base.targetProductId } : {}),
    ...(base?.sourceSystem ? { sourceSystem: base.sourceSystem } : {}),
    ...(base?.sourceKey ? { sourceKey: base.sourceKey } : {}),
    ...(base?.derivedFields ? { derivedFields: base.derivedFields } : {}),
    product: {
      ...baseProduct,
      internalName: v.internalName.trim(),
      ...(v.primaryCategoryId ? { primaryCategoryId: v.primaryCategoryId } : {}),
      ...(categoryIds.length > 0 ? { categoryIds } : {}),
      // ID 를 하나도 못 정했을 때만 이름 경로를 보낸다(서버 매핑).
      ...(!v.primaryCategoryId && categoryIds.length === 0 && v.categoryPaths.length > 0 ? { categoryPaths: v.categoryPaths } : {}),
    },
    skus: v.skus.map((s) => {
      const weightG = int(s.weightG);
      const volumeMl = int(s.volumeMl);
      const net = netContentOf(s.netAmount, s.netUnit);
      const barcodes = list(s.barcodes);
      const logistics: Record<'unitsPerBox' | 'ti' | 'hi' | 'boxesPerPallet', number> = {} as never;
      for (const k of ['unitsPerBox', 'ti', 'hi', 'boxesPerPallet'] as const) {
        const n = int(s[k]);
        if (n !== undefined) logistics[k] = n;
      }
      const minRemainingDays = int(s.minRemainingDays);
      const maxDaysSinceManufacture = int(s.maxDaysSinceManufacture);
      const shelfLifeGuarantee = {
        ...(minRemainingDays === undefined ? {} : { minRemainingDays }),
        ...(maxDaysSinceManufacture === undefined ? {} : { maxDaysSinceManufacture }),
      };
      const [widthMm, depthMm, heightMm] = [int(s.widthMm), int(s.depthMm), int(s.heightMm)];
      const dimensions = widthMm !== undefined && depthMm !== undefined && heightMm !== undefined ? { widthMm, depthMm, heightMm } : undefined;
      return {
        unitType: s.unitType,
        unitsPerSku: int(s.unitsPerSku) ?? 1,
        ...(weightG === undefined ? {} : { weightG }),
        ...(volumeMl === undefined ? {} : { volumeMl }),
        ...(net && net !== 'invalid' ? { netContent: net } : {}),
        ...(s.storageType ? { storageType: s.storageType } : {}),
        alcohol: s.alcohol,
        ...(barcodes.length > 0 ? { barcodes } : {}),
        ...(Object.keys(logistics).length > 0 ? { logistics } : {}),
        ...(Object.keys(shelfLifeGuarantee).length > 0 ? { shelfLifeGuarantee } : {}),
        ...(dimensions ? { dimensions, ...(s.dimensionsSource ? { dimensionsSource: s.dimensionsSource } : {}) } : {}),
      };
    }),
    ...(filterOptions.length > 0 ? { filterOptions } : {}),
  };
}

const byPath = (a: CategoryNode, b: CategoryNode) => (a.path ?? a.name).localeCompare(b.path ?? b.name, 'ko');

export function ProductDraftForm({
  initial,
  edit = false,
  submitLabel,
  busy,
  onSubmit,
}: {
  readonly initial?: ProductDraftInput;
  /** 기존 상품 수정 초안(product 0.3.0): SKU 1개 고정, 판매 단위·입수 고정, JSON 채우기 없음 */
  readonly edit?: boolean;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: (input: ProductDraftInput) => void;
}) {
  const api = useApi();
  const [v, setV] = useState<FormValues>(() => toValues(initial));
  // 떠날 때 경고(2026-11-18): 연 값과 다르면 "작성 중" — 저장을 누르면 그 값이 새 기준(저장 뒤 이동은 막지 않는다)
  const [baseline, setBaseline] = useState(() => JSON.stringify(toValues(initial)));
  const dirty = JSON.stringify(v) !== baseline;
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const setSku = (i: number, patch: Partial<SkuRow>) =>
    setV((prev) => ({ ...prev, skus: prev.skus.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const tree = useQuery({
    queryKey: ['product', 'category-tree'],
    queryFn: () => request('GET', api.product.GET('/categories/tree', {})),
  });
  const nodes = useMemo(() => [...(tree.data?.nodes ?? [])].sort(byPath), [tree.data]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.categoryId, n])), [nodes]);
  const label = (id: string) => nodeById.get(id)?.path ?? nodeById.get(id)?.name ?? id;

  const filters = useQuery({
    queryKey: ['product', 'category-filters', v.primaryCategoryId],
    enabled: v.primaryCategoryId !== '',
    queryFn: () =>
      request('GET', api.product.GET('/categories/{categoryId}/filters', { params: { path: { categoryId: v.primaryCategoryId } } })),
  });
  const groups = filters.data?.groups ?? [];

  const toggleFilter = (groupId: string, option: string, on: boolean) =>
    setV((prev) => {
      const cur = prev.filterOptions[groupId] ?? [];
      const next = on ? [...new Set([...cur, option])] : cur.filter((o) => o !== option);
      return { ...prev, filterOptions: { ...prev.filterOptions, [groupId]: next } };
    });

  /** JSON 으로 채운다. 카테고리 이름 경로는 트리에서 같은 path 를 찾고, 없으면 categoryPaths 로 남긴다. */
  const fillFromJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = parseProductJson(await file.text());
      const pathToId = new Map(nodes.filter((n) => n.path).map((n) => [n.path!, n.categoryId]));
      const matched = p.categoryPaths.map((path) => pathToId.get(path)).filter((id): id is string => id !== undefined);
      const pending = p.categoryPaths.filter((path) => !pathToId.has(path));
      const primary = p.primaryCategoryId ?? matched[0] ?? '';
      const ids = [...new Set([...p.categoryIds, ...matched])].filter((id) => id !== primary);
      setV((prev) => ({
        ...prev,
        internalName: p.internalName ?? prev.internalName,
        primaryCategoryId: primary || prev.primaryCategoryId,
        categoryIds: ids.length > 0 ? ids : prev.categoryIds,
        categoryPaths: pending,
        skus: p.skus.length > 0 ? p.skus.map(skuRowOf) : prev.skus,
      }));
      setNote({ ok: true, text: m.products.jsonFilled(p.skus.length, matched.length + (p.primaryCategoryId ? 1 : 0) + p.categoryIds.length, pending.length) });
    } catch (e) {
      setNote({ ok: false, text: m.products.jsonInvalid(e instanceof ProductJsonError ? e.message : String(e)) });
    }
  };

  const clearAll = () => {
    setV(emptyValues());
    setNote(null);
  };

  type NumKey = 'unitsPerSku' | 'weightG' | 'volumeMl' | 'unitsPerBox' | 'ti' | 'hi' | 'boxesPerPallet' | 'minRemainingDays' | 'maxDaysSinceManufacture' | 'widthMm' | 'depthMm' | 'heightMm';
  // 계약상 필수(product-service DraftProblem: WEIGHT_REQUIRED·STORAGE_TYPE_REQUIRED·CATEGORY_NOT_MAPPED, 관리용 명칭) — 표시만, 판정은 서버
  const numField = (i: number, k: NumKey, text: string, disabled = false, required = false) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className={`${fieldLabel} ${required ? 'field-required' : ''}`}>{text}</span>
      <input className="input input-sm w-full" inputMode="numeric" disabled={disabled} value={v.skus[i]![k]} onChange={(e) => setSku(i, { [k]: e.target.value })} />
    </label>
  );

  const missing: string[] = [
    !v.internalName.trim() && m.products.internalName,
    !v.primaryCategoryId && v.categoryPaths.length === 0 && m.products.primaryCategory,
    v.skus.some((sk) => !sk.weightG.trim()) && m.products.weightG,
    v.skus.some((sk) => !sk.storageType) && m.products.storageType,
  ].flatMap((x) => (x ? [x] : []));

  // 화면(2026-11-18 사용자 "밋밋하다"): 제목 있는 카드로 묶는다 — 기본 정보 → 카테고리 → 필터 옵션 → SKU, 저장 버튼은 아래 오른쪽.
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.internalName.trim()) return;
        if (v.skus.some((sk) => netContentOf(sk.netAmount, sk.netUnit) === 'invalid')) return;
        setBaseline(JSON.stringify(v));
        onSubmit(toInput(v, initial));
      }}
    >
      <LeaveGuard when={dirty} />
      <Card
        title={m.products.formBasic}
        aside={
          !edit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
              ✕ {m.products.clearAll}
            </button>
          )
        }
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className={`${fieldLabel} field-required`}>{m.products.internalName}</span>
          <input className="input input-sm w-full md:w-2/3" value={v.internalName} onChange={(e) => set('internalName', e.target.value)} />
        </label>
        {!edit && (
          <label className="flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed border-base-300 px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-base-200/60">
            <span className="font-medium">{m.products.jsonFill}</span>
            <input
              type="file"
              accept="application/json,.json"
              aria-label={m.products.jsonFill}
              className="file-input file-input-sm w-full max-w-sm"
              onChange={(e) => {
                void fillFromJson(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        {note && (
          <p role="status" className={`text-sm ${note.ok ? 'text-success' : 'text-error'}`}>
            {note.text}
          </p>
        )}
      </Card>

      <Card title={m.products.formCategory}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <span className={`${fieldLabel} field-required`}>{m.products.primaryCategory}</span>
            {/* 쳐서 찾는 고르기(2026-11-19 — 카테고리가 많아지면 드롭다운에서 찾기 힘들다). 경로(대분류 > 중분류)로 찾고 초성도 */}
            <SearchSelect
              label={m.products.primaryCategory}
              value={v.primaryCategoryId}
              options={nodes.map((n) => ({ value: n.categoryId, label: n.path ?? n.name }))}
              loading={tree.isPending}
              loadingText={m.loading}
              placeholder={m.products.categorySearch}
              // 대표 카테고리는 노출 카테고리에 자동으로 들어간다(서버도 categoryIds 맨 앞에 대표를 둔다). 따로 고른 목록에서는 뺀다.
              onChange={(id) => setV((prev) => ({ ...prev, primaryCategoryId: id, categoryIds: prev.categoryIds.filter((x) => x !== id) }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <MultiSelectDropdown
              label={m.products.categories}
              options={nodes.map((n) => ({
                value: n.categoryId,
                label: n.categoryId === v.primaryCategoryId ? `${n.path ?? n.name} (${m.products.primaryTag})` : (n.path ?? n.name),
                // 대표 카테고리는 자동으로 들어가므로 따로 고르지 않는다
                disabled: n.categoryId === v.primaryCategoryId,
              }))}
              value={v.categoryIds}
              onChange={(next) => set('categoryIds', next)}
              placeholder={tree.isPending ? m.loading : m.products.categoriesPick}
              selectedText={m.products.categoriesSelected}
              disabled={tree.isPending}
            />
          </div>
          {tree.error instanceof PmartFailure && (
            <div className="md:col-span-2">
              <FailureAlert failure={tree.error} />
              <button type="button" className="btn btn-xs mt-1" onClick={() => void tree.refetch()}>
                {m.retry}
              </button>
            </div>
          )}
          {(v.primaryCategoryId !== '' || v.categoryIds.length > 0) && (
            <ul className="flex flex-wrap gap-1.5 md:col-span-2" aria-label={m.products.selectedCategories}>
              {v.primaryCategoryId !== '' && (
                <li className="badge badge-primary badge-soft gap-1">{`${label(v.primaryCategoryId)} · ${m.products.primaryTag}`}</li>
              )}
              {v.categoryIds.map((id) => (
                <li key={id} className="badge badge-outline gap-1">
                  {label(id)}
                  <button type="button" aria-label={m.products.removeCategory(label(id))} onClick={() => set('categoryIds', v.categoryIds.filter((x) => x !== id))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {v.categoryPaths.length > 0 && (
            <p className="text-warning text-xs md:col-span-2">{`${m.products.categoryPathsPending(v.categoryPaths.length)}: ${v.categoryPaths.join(' / ')}`}</p>
          )}
        </div>

        {/* 필터 옵션 — 대표 카테고리를 고른 뒤 */}
        {v.primaryCategoryId !== '' && (
          <fieldset className="space-y-2 rounded-lg border border-base-300 bg-base-200/30 p-3">
            <legend className="px-1 text-sm font-bold">{m.products.filters}</legend>
            {filters.isPending && <p className="text-sm text-base-content/60">{m.loading}</p>}
            {filters.error instanceof PmartFailure && <FailureAlert failure={filters.error} />}
            {filters.isSuccess && groups.length === 0 && <p className="text-sm text-base-content/60">{m.products.filtersNone}</p>}
            {groups.map((g) => (
              <div key={g.filterGroupId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 shrink-0 font-medium">{g.name}</span>
                {g.options.map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-1 rounded-full border border-base-300 bg-base-100 px-2.5 py-0.5 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      aria-label={m.products.filterOption(g.name, opt)}
                      checked={(v.filterOptions[g.filterGroupId] ?? []).includes(opt)}
                      onChange={(e) => toggleFilter(g.filterGroupId, opt, e.target.checked)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
        )}
      </Card>

      <Card
        title={m.products.skus}
        aside={
          !edit && (
            <button type="button" className="btn btn-outline btn-xs" onClick={() => set('skus', [...v.skus, emptySku()])}>
              {m.products.addSku}
            </button>
          )
        }
      >
        {v.skus.map((s, i) => (
          <section key={i} className="space-y-3 rounded-lg border border-base-300 p-4" aria-label={m.products.skuTitle(i + 1)}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">
                  {i + 1}
                </span>
                {m.products.skuTitle(i + 1)}
              </h3>
              {v.skus.length > 1 && !edit && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label={m.products.removeSku(i + 1)}
                  onClick={() => set('skus', v.skus.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className={fieldLabel}>{m.products.unitType}</span>
                <select className="select select-sm" disabled={edit} value={s.unitType} onChange={(e) => setSku(i, { unitType: e.target.value === 'B' ? 'B' : 'E' })}>
                  <option value="E">{m.products.unitName.E}</option>
                  <option value="B">{m.products.unitName.B}</option>
                </select>
              </label>
              {numField(i, 'unitsPerSku', m.products.unitsPerSku, edit)}
              {numField(i, 'weightG', m.products.weightG, false, true)}
              {numField(i, 'volumeMl', m.products.volumeMl)}
              {/* 내용량(2026-11-19 백엔드 알림 notice-sku-net-content) — 포장 무게와 다른 칸, 개수로만 파는 상품은 비운다 */}
              <div className="flex flex-col gap-1 text-sm" data-testid={`net-content-${i}`}>
                <span className={fieldLabel}>{m.products.net.label}</span>
                <div className="join">
                  <input
                    className={`input input-sm join-item w-full ${netContentOf(s.netAmount, s.netUnit) === 'invalid' ? 'input-error' : ''}`}
                    inputMode="decimal"
                    aria-label={m.products.net.label}
                    placeholder={m.products.net.placeholder}
                    value={s.netAmount}
                    onChange={(e) => setSku(i, { netAmount: e.target.value })}
                  />
                  <select className="select select-sm join-item w-20" aria-label={m.products.net.unit} value={s.netUnit} onChange={(e) => setSku(i, { netUnit: NET_UNITS.find((u) => u === e.target.value) ?? 'G' })}>
                    {NET_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {m.products.net.unitName[u]}
                      </option>
                    ))}
                  </select>
                </div>
                {netContentOf(s.netAmount, s.netUnit) === 'invalid' ? (
                  <span className="text-xs text-error" role="alert">{m.products.net.invalid}</span>
                ) : edit && !s.netAmount.trim() && initial?.skus[i]?.netContent ? (
                  <span className="text-xs text-warning" role="alert" data-testid="net-content-cleared">{m.products.net.cleared}</span>
                ) : (
                  <span className="text-xs text-base-content/50">{m.products.net.hint}</span>
                )}
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className={`${fieldLabel} field-required`}>{m.products.storageType}</span>
                <select
                  className="select select-sm"
                  value={s.storageType}
                  onChange={(e) => setSku(i, { storageType: STORAGE_TYPES.find((t) => t === e.target.value) ?? '' })}
                >
                  <option value="">{m.none}</option>
                  {STORAGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {m.products.storageName[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" checked={s.alcohol} onChange={(e) => setSku(i, { alcohol: e.target.checked })} />
                {m.products.alcohol}
              </label>
              <div className="flex flex-col gap-1 md:col-span-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className={fieldLabel}>{m.products.barcodes}</span>
                  <input
                    className="input input-sm w-full font-mono"
                    placeholder={m.products.barcodeEnterHint}
                    value={s.barcodes}
                    onChange={(e) => setSku(i, { barcodes: e.target.value })}
                    // 스캐너는 끝에 Enter 를 보낸다 — 폼을 저장하지 않고 다음 바코드 자리를 만든다.
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (s.barcodes.trim() && !s.barcodes.trim().endsWith(',')) setSku(i, { barcodes: `${s.barcodes.trim()}, ` });
                    }}
                  />
                </label>
                {list(s.barcodes).flatMap((b) => {
                  const digit = gs1CheckDigitProblem(b);
                  return digit === null
                    ? []
                    : [
                        <span key={b} className="text-xs text-warning" data-testid="barcode-check-digit">
                          {m.products.barcodeCheckDigit(b, digit)}
                        </span>,
                      ];
                })}
              </div>
            </div>
            {edit && <p className="text-xs text-base-content/60">{m.products.editFixedSku}</p>}
            <details className="rounded-lg bg-base-200/40 px-3 py-2 text-sm" open={edit || undefined}>
              <summary className="cursor-pointer font-medium text-base-content/75">{m.products.extra}</summary>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                {numField(i, 'minRemainingDays', m.products.minRemainingDays)}
                {numField(i, 'maxDaysSinceManufacture', m.products.maxDaysSinceManufacture)}
                <span />
                {numField(i, 'widthMm', m.products.widthMm)}
                {numField(i, 'depthMm', m.products.depthMm)}
                {numField(i, 'heightMm', m.products.heightMm)}
                <label className="flex flex-col gap-1 text-sm">
                  <span className={fieldLabel}>{m.products.dimensionsSource}</span>
                  <select
                    className="select select-sm"
                    value={s.dimensionsSource}
                    onChange={(e) => setSku(i, { dimensionsSource: e.target.value === 'MEASURED' || e.target.value === 'ESTIMATED' ? e.target.value : '' })}
                  >
                    <option value="">{m.none}</option>
                    <option value="MEASURED">{m.products.dimensionsSourceName.MEASURED}</option>
                    <option value="ESTIMATED">{m.products.dimensionsSourceName.ESTIMATED}</option>
                  </select>
                </label>
                <span className="text-xs opacity-70 md:col-span-2">{m.products.dimensionsHint}</span>
              </div>
            </details>
            <details className="rounded-lg bg-base-200/40 px-3 py-2 text-sm" open={edit || undefined}>
              <summary className="cursor-pointer font-medium text-base-content/75">{m.products.logistics}</summary>
              <div className="mt-2 grid gap-3 md:grid-cols-4">
                {numField(i, 'unitsPerBox', m.products.unitsPerBox)}
                {numField(i, 'ti', m.products.ti)}
                {numField(i, 'hi', m.products.hi)}
                {numField(i, 'boxesPerPallet', m.products.boxesPerPallet)}
              </div>
            </details>
          </section>
        ))}
      </Card>

      {/* 저장은 아래 오른쪽(Shopify 저장 줄처럼) */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-box border border-base-300 bg-base-100 px-5 py-3 shadow-sm">
        {/* 저장 전 안내(2026-11-19): 비어 있는 필수 칸 — 초안은 비어도 저장되고(검증 오류로), 제출 준비 전에 채워야 한다 */}
        {missing.length > 0 && (
          <p className="mr-auto text-xs text-warning" data-testid="draft-missing">
            {m.products.missingRequired(missing.join(', '))}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-sm min-w-28" disabled={busy || !v.internalName.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
