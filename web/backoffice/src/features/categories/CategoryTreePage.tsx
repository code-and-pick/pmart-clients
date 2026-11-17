// 카테고리 트리 조회(4단계)·노드 필터 패널·트리 초안 등록 → PRODUCT 승인 요청.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

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
import { PageHeader } from '../../shared/admin';

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

function TreeView() {
  const api = useApi();
  const [selected, setSelected] = useState<string | null>(null);
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
      <div role="status" data-state="not-effective" className="alert alert-warning">
        {m.categories.notEffective}
      </div>
    );
  }

  return (
    <QueryState state={toUiState(tree)} onRetry={() => void tree.refetch()}>
      {(t) => (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <p className="mb-2 text-sm text-base-content/60">
              {`${t.version === undefined ? '' : m.categories.version(t.version)}${t.effectiveFrom ? ` · ${formatSeoul(t.effectiveFrom)}` : ''}`}
            </p>
            <ul className="max-h-[60vh] overflow-auto text-sm">
              {rows.map((n) => (
                <li key={n.categoryId} style={{ paddingLeft: `${n.depth * 1.25}rem` }}>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-xs ${selected === n.categoryId ? 'btn-active' : ''}`}
                    onClick={() => setSelected(n.categoryId)}
                  >
                    {`${n.name} (${n.categoryId})`}
                  </button>
                  {n.exposed === false && <span className="badge badge-ghost badge-xs">{m.categories.hidden}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <h2 className="mb-2 font-bold">{m.categories.filters}</h2>
            {selected === null ? (
              <p className="text-sm text-base-content/60">{m.categories.pickNode}</p>
            ) : (
              <QueryState state={toUiState(filters, (d) => (d.groups?.length ?? 0) === 0)} onRetry={() => void filters.refetch()}>
                {(f) => (
                  <ul className="space-y-2 text-sm">
                    {(f.groups ?? []).map((g) => (
                      <li key={g.filterGroupId}>
                        <span className="font-semibold">{`${g.name} · ${g.selectionMode}`}</span>
                        <div className="flex flex-wrap gap-1">
                          {g.options.map((o) => (
                            <span key={o} className="badge badge-outline badge-sm">
                              {o}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryState>
            )}
          </div>
        </div>
      )}
    </QueryState>
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
    <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="font-bold">{m.categories.upload}</h2>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col text-sm">
          {m.categories.categoriesFile}
          <input
            type="file"
            accept="application/json,.json"
            className="file-input file-input-sm"
            onChange={(e) => setCategoriesFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex flex-col text-sm">
          {m.categories.filtersFile}
          <input
            type="file"
            accept="application/json,.json"
            className="file-input file-input-sm"
            onChange={(e) => setFiltersFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {formatError && <p className="text-error text-sm">{m.categories.fileInvalid}</p>}
      <button
        type="button"
        className="btn btn-sm"
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
                {`${m.categories.state}: ${status.data.state}`}
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
    <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="font-bold">{m.categories.additionTitle}</h2>
      <p className="text-sm opacity-80">{m.categories.additionHint}</p>
      <label className="flex flex-col text-sm">
        {m.categories.additionFile}
        <input
          type="file"
          accept="application/json,.json,application/zip,.zip"
          aria-label={m.categories.additionFile}
          className="file-input file-input-sm"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            if (create.phase.kind !== 'running') create.reset();
          }}
        />
      </label>
      {formatError && <p className="text-error text-sm">{m.categories.additionInvalid}</p>}
      <button type="button" className="btn btn-sm" disabled={!file || create.busy || create.phase.kind === 'done'} onClick={() => void onSubmit()}>
        {m.categories.additionSubmit}
      </button>
      {nothingToAdd ? (
        <p role="status" className="alert alert-info text-sm">
          {m.categories.additionNothing}
        </p>
      ) : conflict ? (
        <p role="alert" className="alert alert-error text-sm">
          {m.categories.additionConflict}
        </p>
      ) : serverError ? (
        <div role="alert" data-code="INTERNAL_ERROR" className="alert alert-warning flex-col items-start text-sm">
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
                    {`${m.categories.state}: ${status.data.state}`}
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
    <section className="space-y-4">
      <PageHeader title={m.categories.title} />
      <TreeView />
      <AdditionUpload />
      <DraftUpload />
    </section>
  );
}
