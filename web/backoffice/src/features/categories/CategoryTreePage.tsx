// 카테고리 트리 조회(4단계)·노드 필터 패널·트리 초안 등록 → PRODUCT 승인 요청.
// 화면(2026-11-18 사용자 "밋밋하다 — 참고 사이트(카페24·Shopify 분류 관리)처럼"): 위 숫자 카드, 왼쪽 접고 펴는 트리(찾기·하위 개수),
// 오른쪽 고른 분류 상세(경로·단계·노출·하위·필터 카드), 아래 등록 두 카드(단계 표시·점선 파일 상자). 동작은 그대로.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { commandParams } from '../../api/command';
import { ProblemFailure } from '@pmart/web-core';
import type { CategoryAdditionRequest, CategoryNode, CategoryTreeDraftRequest } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { multipart } from '../products/ProductImportPage';
import { CodeLabel, PageHeader, StatusBadge } from '../../shared/admin';

const NOT_EFFECTIVE = 'CATEGORY_TREE_NOT_EFFECTIVE';

function ordered(nodes: readonly CategoryNode[]): Array<CategoryNode & { depth: number }> {
  const children = new Map<string | null, CategoryNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const out: Array<CategoryNode & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const n of list) {
      out.push({ ...n, depth });
      walk(n.categoryId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

const LEVEL_DEPTH_NAME = ['대분류', '중분류', '소분류', '세분류'] as const;

function FolderIcon({ open }: { readonly open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {open ? <path d="M3 7.5V6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v1.5M3 7.5h18l-2 11H5l-2-11Z" /> : <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />}
    </svg>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 fill-none stroke-current transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Stat({ label, value, tone }: { readonly label: string; readonly value: number; readonly tone?: 'muted' }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
      <p className="text-xs text-base-content/55">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone === 'muted' ? 'text-base-content/50' : ''}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-base-content/55">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200 text-base-content/40">
        <FolderIcon open={false} />
      </span>
      {children}
    </div>
  );
}


function TreeView() {
  const api = useApi();
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [find, setFind] = useState('');
  const tree = useQuery({
    queryKey: ['product', 'category-tree'],
    queryFn: () => request('GET', api.product.GET('/categories/tree', {})),
  });
  const filters = useQuery({
    queryKey: ['product', 'category-filters', selected],
    enabled: selected !== null,
    queryFn: () =>
      request('GET', api.product.GET('/categories/{categoryId}/filters', { params: { path: { categoryId: selected ?? '' } } })),
  });
  const rows = useMemo(() => ordered(tree.data?.nodes ?? []), [tree.data]);

  if (tree.error instanceof ProblemFailure && tree.error.problem.code === NOT_EFFECTIVE) {
    return (
      <div role="status" data-state="not-effective" className="alert alert-warning alert-soft">
        {m.categories.notEffective}
      </div>
    );
  }

  return (
    <QueryState state={toUiState(tree)} onRetry={() => void tree.refetch()}>
      {(t) => {
        const byId = new Map(rows.map((n) => [n.categoryId, n]));
        const childCount = new Map<string, number>();
        for (const n of rows) if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
        const pathOf = (id: string) => {
          const out: Array<(typeof rows)[number]> = [];
          for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.unshift(cur);
          return out;
        };
        // 찾기: 이름·ID 가 맞는 줄과 그 위 경로만. 접힘은 찾는 동안 무시.
        const q = find.trim().toLowerCase();
        const hit = new Set<string>();
        if (q) for (const n of rows) if (n.name.toLowerCase().includes(q) || n.categoryId.toLowerCase().includes(q)) for (const p of pathOf(n.categoryId)) hit.add(p.categoryId);
        const hiddenByParent = (n: (typeof rows)[number]) => {
          if (q) return !hit.has(n.categoryId);
          for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (closed.has(p.categoryId)) return true;
          return false;
        };
        const toggle = (id: string) => setClosed((c) => { const next = new Set(c); if (next.has(id)) next.delete(id); else next.add(id); return next; });
        const counts = [0, 1, 2].map((d) => rows.filter((n) => n.depth === d).length);
        const hiddenCount = rows.filter((n) => n.exposed === false).length;
        const sel = selected ? byId.get(selected) : undefined;
        const kids = sel ? rows.filter((n) => n.parentId === sel.categoryId) : [];

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="category-stats">
              <Stat label={m.categories.depthCount(LEVEL_DEPTH_NAME[0])} value={counts[0] ?? 0} />
              <Stat label={m.categories.depthCount(LEVEL_DEPTH_NAME[1])} value={counts[1] ?? 0} />
              <Stat label={m.categories.depthCount(LEVEL_DEPTH_NAME[2])} value={counts[2] ?? 0} />
              <Stat label={m.categories.hiddenCount} value={hiddenCount} tone="muted" />
            </div>
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                  <h2 className="font-bold">{m.categories.treeTitle}</h2>
                  <span className="text-xs text-base-content/50" data-testid="category-version">
                    {`${t.version === undefined ? '' : m.categories.version(t.version)}${t.effectiveFrom ? ` · ${formatSeoul(t.effectiveFrom)}` : ''}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 border-b border-base-300 px-4 py-2">
                  <input aria-label={m.categories.find} placeholder={m.categories.findHint} className="input input-sm w-full" value={find} onChange={(e) => setFind(e.target.value)} />
                  <button type="button" className="btn btn-ghost btn-xs whitespace-nowrap" onClick={() => setClosed(new Set())}>
                    {m.categories.expandAll}
                  </button>
                  <button type="button" className="btn btn-ghost btn-xs whitespace-nowrap" onClick={() => setClosed(new Set(rows.filter((n) => childCount.has(n.categoryId)).map((n) => n.categoryId)))}>
                    {m.categories.collapseAll}
                  </button>
                </div>
                <ul className="max-h-[60vh] overflow-auto px-2 py-2 text-sm" data-testid="category-tree">
                  {rows.filter((n) => !hiddenByParent(n)).map((n) => {
                    const has = childCount.has(n.categoryId);
                    const open = q ? true : !closed.has(n.categoryId);
                    const on = selected === n.categoryId;
                    return (
                      <li key={n.categoryId} className="flex items-center gap-0.5" style={{ paddingLeft: `${n.depth * 1.1}rem` }}>
                        {has ? (
                          <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={`${open ? m.categories.collapse : m.categories.expand} ${n.name}`} aria-expanded={open} onClick={() => toggle(n.categoryId)}>
                            <Chevron open={open} />
                          </button>
                        ) : (
                          <span className="w-6" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left transition-colors ${on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-transparent hover:bg-base-200'}`}
                          aria-pressed={on}
                          onClick={() => setSelected(n.categoryId)}
                        >
                          <FolderIcon open={has && open} />
                          <span className="truncate">{n.name}</span> <span className="font-mono text-xs text-base-content/45">({n.categoryId})</span>
                          {has && <span className="ml-auto rounded-full bg-base-200 px-1.5 text-[11px] text-base-content/60" aria-hidden="true">{childCount.get(n.categoryId)}</span>}
                        </button>
                        {n.exposed === false && <span className="badge badge-ghost badge-xs">{m.categories.hidden}</span>}
                      </li>
                    );
                  })}
                  {q && hit.size === 0 && <li className="px-2 py-6 text-center text-sm text-base-content/50">{m.categories.noMatch}</li>}
                </ul>
              </div>

              <div className="rounded-box border border-base-300 bg-base-100 shadow-sm lg:col-span-3" data-testid="category-detail">
                {!sel ? (
                  <Empty>
                    <p>{m.categories.pickNode}</p>
                  </Empty>
                ) : (
                  <div className="divide-y divide-base-300">
                    <div className="space-y-2 px-5 py-4">
                      <p className="text-xs text-base-content/50">{pathOf(sel.categoryId).map((p) => p.name).join(' › ')}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold">{sel.name}</h2>
                        <span className="font-mono text-xs text-base-content/50">{sel.categoryId}</span>
                        <StatusBadge tone="info">{LEVEL_DEPTH_NAME[sel.depth] ?? m.categories.depthN(sel.depth + 1)}</StatusBadge>
                        <StatusBadge tone={sel.exposed === false ? 'ghost' : 'success'}>{sel.exposed === false ? m.categories.hidden : m.categories.exposed}</StatusBadge>
                      </div>
                      {kids.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-xs text-base-content/55">{m.categories.children(kids.length)}</span>
                          {kids.map((k) => (
                            <button key={k.categoryId} type="button" className="badge badge-outline badge-sm hover:bg-base-200" onClick={() => setSelected(k.categoryId)}>
                              {k.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 px-5 py-4">
                      <h3 className="font-bold">{m.categories.filters}</h3>
                      <QueryState state={toUiState(filters, (d) => (d.groups?.length ?? 0) === 0)} onRetry={() => void filters.refetch()} emptyText={m.categories.noFilters}>
                        {(f) => (
                          <ul className="grid gap-3 md:grid-cols-2">
                            {(f.groups ?? []).map((g) => (
                              <li key={g.filterGroupId} className="space-y-2 rounded-lg border border-base-300 p-3" data-testid="filter-group">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">{g.name}</span>
                                  <span className="badge badge-sm badge-soft badge-info"><CodeLabel code={g.selectionMode} names={m.categories.selectionModeName} /></span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {g.options.map((o) => (
                                    <span key={o} className="rounded-full bg-base-200 px-2 py-0.5 text-xs">
                                      {o}
                                    </span>
                                  ))}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </QueryState>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

/** 등록 카드 위 단계(① 파일 → ② 초안 → ③ 승인 요청 → ④ 발효) — now = 지금 단계(0부터) */
function Steps({ now }: { readonly now: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={m.categories.stepsLabel}>
      {m.categories.steps.map((st, i) => (
        <li key={st} className="flex items-center gap-1">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${i <= now ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/50'}`}>{i + 1}</span>
          <span className={i <= now ? 'font-medium' : 'text-base-content/50'}>{st}</span>
          {i < m.categories.steps.length - 1 && <span className="px-1 text-base-content/30">→</span>}
        </li>
      ))}
    </ol>
  );
}

/** 점선 파일 상자(안의 input 은 그대로 — 이름표·aria-label 유지) */
function FileBox({ label, file, children }: { readonly label: string; readonly file: File | null; readonly children: ReactNode }) {
  return (
    <label className={`flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed px-4 py-4 text-sm transition-colors ${file ? 'border-primary/40 bg-primary/5' : 'border-base-300 hover:border-primary/40 hover:bg-base-200/60'}`}>
      <span className="font-medium">{label}</span>
      {children}
      <span className="text-xs text-base-content/50">{file ? m.categories.fileChosen(file.name) : null}</span>
    </label>
  );
}

function DraftUpload() {
  const api = useApi();
  const [categoriesFile, setCategoriesFile] = useState<File | null>(null);
  const [filtersFile, setFiltersFile] = useState<File | null>(null);
  const [formatError, setFormatError] = useState(false);

  const create = useCommand((body: CategoryTreeDraftRequest, key) =>
    request('POST', api.product.POST('/category-tree-versions', { ...commandParams(key), body })),
  );
  const version = create.phase.kind === 'done' ? create.phase.result.version : null;
  const status = useQuery({
    queryKey: ['product', 'category-tree-version', version],
    enabled: version !== null,
    queryFn: () =>
      request('GET', api.product.GET('/category-tree-versions/{version}', { params: { path: { version: version ?? 0 } } })),
  });

  const onSubmit = async () => {
    if (!categoriesFile || !filtersFile) return;
    try {
      const c = (await readJson(categoriesFile)) as { categories?: unknown };
      const f = (await readJson(filtersFile)) as { definitions?: unknown };
      if (!Array.isArray(c.categories) || !Array.isArray(f.definitions)) throw new Error('format');
      setFormatError(false);
      await create.run({
        categories: c.categories as CategoryTreeDraftRequest['categories'],
        filters: f.definitions as CategoryTreeDraftRequest['filters'],
        sourceNote: `${categoriesFile.name} + ${filtersFile.name}`,
      });
    } catch {
      setFormatError(true);
    }
  };

  return (
    <div className="space-y-4 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm" data-testid="draft-upload">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{m.categories.upload}</h2>
      </div>
      <Steps now={create.phase.kind === 'done' ? (create.phase.result.approvalRequest ? 2 : 1) : 0} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FileBox label={m.categories.categoriesFile} file={categoriesFile}>
          <input
            type="file"
            accept="application/json,.json"
            aria-label={m.categories.categoriesFile}
            className="file-input file-input-sm w-full"
            onChange={(e) => setCategoriesFile(e.target.files?.[0] ?? null)}
          />
        </FileBox>
        <FileBox label={m.categories.filtersFile} file={filtersFile}>
          <input
            type="file"
            accept="application/json,.json"
            aria-label={m.categories.filtersFile}
            className="file-input file-input-sm w-full"
            onChange={(e) => setFiltersFile(e.target.files?.[0] ?? null)}
          />
        </FileBox>
      </div>
      {formatError && <p className="text-error text-sm">{m.categories.fileInvalid}</p>}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!categoriesFile || !filtersFile || create.busy || create.phase.kind === 'done'}
        onClick={() => void onSubmit()}
      >
        {m.categories.upload}
      </button>
      <CommandFeedback command={create}>
        {(v) => (
          <div className="space-y-2">
            <p role="status" className="text-sm">
              {`${m.categories.draftCreated(v.version)} ${m.categories.nodeCount} ${v.nodeCount} · ${m.categories.filterGroupCount} ${v.filterGroupCount}`}
            </p>
            {status.data && (
              <p className="text-sm">
                {`${m.categories.state}: `}
                    <CodeLabel code={status.data.state} names={m.categories.treeStateName} />
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => void status.refetch()}>
                  {m.checkAgain}
                </button>
              </p>
            )}
            {v.approvalRequest && <RequestApproval body={v.approvalRequest} />}
          </div>
        )}
      </CommandFeedback>
    </div>
  );
}

/** seed-v1 기준파일의 categories.json 으로 "없는 카테고리만" 더하는 트리 초안(백엔드 요청 2026-11-02 §3-1). */
function AdditionUpload() {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [formatError, setFormatError] = useState(false);
  const tree = useQuery({
    queryKey: ['product', 'category-tree'],
    queryFn: () => request('GET', api.product.GET('/categories/tree', {})),
  });
  // JSON 본문(categories.json) 또는 seed-v1 zip(백엔드 회신 2026-11-03 §3: 서버가 묶음의 categories.json 을 꺼내 같은 규칙으로 처리).
  const create = useCommand((arg: CategoryAdditionRequest | File, key) =>
    arg instanceof File
      ? request(
          'POST',
          api.product.POST('/category-tree-addition-uploads', { ...commandParams(key), body: { file: '' }, ...multipart({ file: arg }) }),
        )
      : request('POST', api.product.POST('/category-tree-additions', { ...commandParams(key), body: arg })),
  );
  const version = create.phase.kind === 'done' ? create.phase.result.version : null;
  const status = useQuery({
    queryKey: ['product', 'category-tree-version', version],
    enabled: version !== null,
    queryFn: () =>
      request('GET', api.product.GET('/category-tree-versions/{version}', { params: { path: { version: version ?? 0 } } })),
  });
  const nothingToAdd = create.phase.kind === 'rejected' && create.phase.failure instanceof ProblemFailure && create.phase.failure.problem.code === 'NOTHING_TO_ADD';
  const conflict = create.phase.kind === 'rejected' && create.phase.failure instanceof ProblemFailure && create.phase.failure.problem.code === 'CATEGORY_CONFLICT';
  // 이미 있는 카테고리만 올리면 계약상 422 NOTHING_TO_ADD 인데 LAN 서버가 500 INTERNAL_ERROR 를 준다(BR-48). 원인 단정 없이 서버 오류로 안내한다.
  const serverError =
    create.phase.kind === 'rejected' && create.phase.failure instanceof ProblemFailure && create.phase.failure.problem.code === 'INTERNAL_ERROR'
      ? create.phase.failure
      : null;

  const onSubmit = async () => {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      setFormatError(false);
      await create.run(file);
      return;
    }
    try {
      const c = (await readJson(file)) as { categories?: unknown };
      if (!Array.isArray(c.categories)) throw new Error('format');
      setFormatError(false);
      // 묶음 본문을 그대로 보낸다(백엔드가 pmartCategoryIdLevels·bmartPath 를 읽는다).
      await create.run({ categories: c.categories as CategoryAdditionRequest['categories'] });
    } catch {
      setFormatError(true);
    }
  };

  return (
    <div className="space-y-4 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm" data-testid="addition-upload">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{m.categories.additionTitle}</h2>
          <span className="badge badge-sm badge-soft badge-accent">{m.categories.recommended}</span>
        </div>
      </div>
      <Steps now={create.phase.kind === 'done' ? (create.phase.result.approvalRequest ? 2 : 1) : 0} />
      <FileBox label={m.categories.additionFile} file={file}>
        <input
          type="file"
          accept="application/json,.json,application/zip,.zip"
          aria-label={m.categories.additionFile}
          className="file-input file-input-sm w-full"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            if (create.phase.kind !== 'running') create.reset();
          }}
        />
      </FileBox>
      {formatError && <p className="text-error text-sm">{m.categories.additionInvalid}</p>}
      <button type="button" className="btn btn-primary btn-sm" disabled={!file || create.busy || create.phase.kind === 'done'} onClick={() => void onSubmit()}>
        {m.categories.additionSubmit}
      </button>
      {nothingToAdd ? (
        <p role="status" className="alert alert-info alert-soft text-sm">
          {m.categories.additionNothing}
        </p>
      ) : conflict ? (
        <p role="alert" className="alert alert-error text-sm">
          {m.categories.additionConflict}
        </p>
      ) : serverError ? (
        <div role="alert" data-code="INTERNAL_ERROR" className="alert alert-warning alert-soft flex-col items-start text-sm">
          <span>{m.categories.additionServerError}</span>
          {serverError.requestId && <span className="text-xs opacity-70 select-all">{m.requestId(serverError.requestId)}</span>}
        </div>
      ) : (
        <CommandFeedback command={create}>
          {(v) => {
            const current = tree.data?.version;
            const stale = v.baseVersion != null && current !== undefined && current !== v.baseVersion;
            return (
              <div className="space-y-2 text-sm">
                <p role="status">{m.categories.additionCreated(v.version, v.baseVersion ?? null)}</p>
                <p>
                  {m.categories.additionAdded(v.addedCategoryIds?.length ?? 0)}
                  {(v.addedCategoryIds?.length ?? 0) > 0 && <span className="ml-2 text-base-content/60">{(v.addedCategoryIds ?? []).join(', ')}</span>}
                </p>
                {(v.skippedPaths?.length ?? 0) > 0 && (
                  <p className="text-warning">{`${m.categories.additionSkipped(v.skippedPaths?.length ?? 0)}: ${(v.skippedPaths ?? []).join(' / ')}`}</p>
                )}
                {stale && <p className="text-warning">{m.categories.additionStale(v.baseVersion ?? 0, current ?? 0)}</p>}
                {status.data && (
                  <p>
                    {`${m.categories.state}: `}
                    <CodeLabel code={status.data.state} names={m.categories.treeStateName} />
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => void status.refetch()}>
                      {m.checkAgain}
                    </button>
                  </p>
                )}
                {v.approvalRequest && <RequestApproval body={v.approvalRequest} />}
              </div>
            );
          }}
        </CommandFeedback>
      )}
    </div>
  );
}

export function CategoryTreePage() {
  return (
    <section className="space-y-5">
      <PageHeader title={m.categories.title} />
      <TreeView />
      <div>
        <h2 className="mb-1 text-base font-bold">{m.categories.changeTitle}</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <AdditionUpload />
          <DraftUpload />
        </div>
      </div>
    </section>
  );
}
