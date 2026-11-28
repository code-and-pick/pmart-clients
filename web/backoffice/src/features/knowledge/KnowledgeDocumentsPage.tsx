// 운영 도우미 › 문서 관리 — 목록(영역별)·내 초안·반영 결과(ai-assistant 1.4.0, ADR-0092 — 요청서 2026-11-28-request-rag-document-admin §화면 1·6).
// 색인 상태·판·마지막 반영은 서버 값 그대로. source=files 면 "문서 관리가 아직 켜지지 않았어요".
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useSession } from '../../app/SessionContext';
import { NextAction, PageHeader, Section, StatusBadge, type Tone } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { StaffName } from '../lookup/parts';
import {
  canEditKnowledge,
  DOC_PREFIX,
  docLink,
  docParts,
  draftLink,
  isDocumentId,
  useKnowledgeApplications,
  useKnowledgeDocuments,
  useMyDrafts,
  type KnowledgeDocument,
  type KnowledgeIndexState,
} from './knowledgeApi';

const m = messages.knowledge;

export const INDEX_TONE: Readonly<Record<KnowledgeIndexState, Tone>> = { INDEXED: 'success', PENDING: 'info', FAILED: 'error', NOT_INDEXED: 'ghost' };

/** 반영한 사람 — 가져오기(IMPORT)는 글자, 운영자 ID 는 이름으로 */
export function UpdatedBy({ id }: { readonly id: string }) {
  return id === 'IMPORT' ? <span>{m.imported}</span> : <StaffName id={id} />;
}

export function KnowledgeDocumentsPage() {
  const { session } = useSession();
  const editor = canEditKnowledge(session?.roles ?? []);
  const [params, setParams] = useSearchParams();
  const includeRetired = params.get('retired') === '1';
  const docs = useKnowledgeDocuments(includeRetired);
  const drafts = useMyDrafts();
  const apps = useKnowledgeApplications();
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        actions={
          editor && (
            <button type="button" className="btn btn-primary btn-sm" data-testid="knowledge-new" onClick={() => setCreating((x) => !x)}>
              {m.newDoc}
            </button>
          )
        }
      />
      {creating && <NewDocumentForm domains={[...new Set((docs.data?.items ?? []).filter((d) => !d.readOnly).map((d) => d.domain))]} onCancel={() => setCreating(false)} />}

      <QueryState state={toUiState(docs)} onRetry={() => void docs.refetch()}>
        {(list) => (
          <>
            {list.source === 'files' && <NextAction tone="warning" title={m.filesTitle} body={m.filesBody} testId="knowledge-files" />}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-base-content/65" data-testid="knowledge-reindex">
                {list.reindex.finishedAt ? m.reindex(formatSeoul(list.reindex.finishedAt), list.reindex.lastResult === 'FAILED' ? m.reindexFailed : m.reindexOk) : m.reindexNever}
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={includeRetired}
                  onChange={(e) =>
                    setParams((p) => {
                      const n = new URLSearchParams(p);
                      if (e.target.checked) n.set('retired', '1');
                      else n.delete('retired');
                      return n;
                    }, { replace: true })
                  }
                />
                {m.showRetired}
              </label>
            </div>
            {list.items.length === 0 ? (
              <p className="rounded-box border border-base-300 bg-base-100 px-4 py-8 text-center text-sm text-base-content/60">{m.empty}</p>
            ) : (
              <DocumentGroups items={list.items} />
            )}
          </>
        )}
      </QueryState>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title={m.myDrafts} testId="knowledge-my-drafts">
          <QueryState state={toUiState(drafts)} onRetry={() => void drafts.refetch()}>
            {(d) =>
              d.items.length === 0 ? (
                <p className="py-3 text-center text-sm text-base-content/55">{m.myDraftsEmpty}</p>
              ) : (
                <ul className="divide-y divide-base-300 text-sm">
                  {d.items.map((x) => (
                    <li key={x.draftId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="knowledge-draft-row">
                      <StatusBadge tone={x.op === 'RETIRE' ? 'error' : x.baseVersion === 0 ? 'success' : 'info'}>{x.op === 'RETIRE' ? m.op.RETIRE : x.baseVersion === 0 ? m.op.NEW : m.op.UPSERT}</StatusBadge>
                      <Link className="link font-medium" to={draftLink(x.draftId)}>
                        {x.title ?? docParts(x.documentId).file}
                      </Link>
                      <span className="ml-auto text-xs text-base-content/50">{formatSeoul(x.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Section>
        <Section title={m.applications} testId="knowledge-applications">
          <QueryState state={toUiState(apps)} onRetry={() => void apps.refetch()}>
            {(a) =>
              a.items.length === 0 ? (
                <p className="py-3 text-center text-sm text-base-content/55">{m.applicationsEmpty}</p>
              ) : (
                <ul className="divide-y divide-base-300 text-sm">
                  {a.items.map((x) => (
                    <li key={x.approvalId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="knowledge-application">
                      <StatusBadge tone={x.result === 'APPLIED' ? 'success' : 'error'}>{m.result[x.result]}</StatusBadge>
                      {x.documentId && <span className="font-medium">{docParts(x.documentId).file}</span>}
                      {x.result === 'APPLIED' ? (
                        x.version !== null && x.version !== undefined && <span>{m.toVersion(x.version)}</span>
                      ) : (
                        <span className="text-error">{(x.reason && m.reason[x.reason]) ?? x.reason ?? messages.none}</span>
                      )}
                      <span className="ml-auto text-xs text-base-content/50">{formatSeoul(x.at)}</span>
                      <Link className="link text-xs" to={`/approvals/${encodeURIComponent(x.approvalId)}`}>
                        {m.openApproval}
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Section>
      </div>
    </section>
  );
}

function DocumentGroups({ items }: { readonly items: readonly KnowledgeDocument[] }) {
  const groups = new Map<string, KnowledgeDocument[]>();
  for (const d of items) groups.set(d.domain, [...(groups.get(d.domain) ?? []), d]);
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([domain, docs]) => (
        <Section key={domain} title={<>{m.domainName[domain] ?? domain} <span className="font-normal text-base-content/55">({docs.length})</span></>} testId={`knowledge-domain-${domain}`}>
          <div className="overflow-x-auto">
            {/* 영역마다 표가 따로라 열 폭을 고정해 줄을 맞춘다 */}
            <table className="table table-sm table-fixed">
              <thead>
                <tr>
                  <th>{m.head.title}</th>
                  <th className="w-20 text-right">{m.head.version}</th>
                  <th className="w-44">{m.head.index}</th>
                  <th className="w-80">{m.head.updated}</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.documentId} data-testid="knowledge-doc" className={d.retired ? 'opacity-60' : ''}>
                    <td>
                      <Link className="link font-medium" to={docLink(d.documentId)}>
                        {d.title || docParts(d.documentId).file}
                      </Link>
                      <p className="font-mono text-xs text-base-content/50">{docParts(d.documentId).file}</p>
                    </td>
                    <td className="text-right tabular-nums">{m.version(d.version)}</td>
                    <td>
                      <StatusBadge tone={d.retired ? 'ghost' : INDEX_TONE[d.indexState]}>{d.retired ? m.retired : m.indexState[d.indexState]}</StatusBadge>
                    </td>
                    <td className="text-xs">
                      <UpdatedBy id={d.updatedBy} /> · {formatSeoul(d.updatedAt)}
                    </td>
                    <td className="text-right text-xs text-base-content/60">{d.readOnly && <span data-testid="knowledge-readonly">{m.readOnly}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </div>
  );
}

/** 새 문서 — 영역(지금 있는 폴더)·파일 이름 → 편집 화면으로(서버에는 저장할 때 보낸다) */
function NewDocumentForm({ domains, onCancel }: { readonly domains: readonly string[]; readonly onCancel: () => void }) {
  const navigate = useNavigate();
  const [domain, setDomain] = useState(domains[0] ?? '');
  const [name, setName] = useState('');
  const file = name.trim().replace(/\.md$/i, '');
  const documentId = `${DOC_PREFIX}${domain}/${file}.md`;
  const ok = domain !== '' && file !== '' && isDocumentId(documentId);
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 text-sm"
      aria-label={m.newDoc}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void navigate(`/assistant/documents/new?documentId=${encodeURIComponent(documentId)}`);
      }}
    >
      <label className="flex flex-col text-xs font-medium text-base-content/60">
        {m.newDomain}
        <select className="select select-sm mt-1 text-base-content" value={domain} onChange={(e) => setDomain(e.target.value)}>
          {domains.map((d) => (
            <option key={d} value={d}>
              {m.domainName[d] ?? d}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs font-medium text-base-content/60">
        {m.newName}
        <input className="input input-sm mt-1 font-mono text-base-content" placeholder="06-new-guide" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <span className="pb-1.5 font-mono text-xs text-base-content/50">{documentId}</span>
      {!ok && name.trim() !== '' && <span className="pb-1.5 text-xs text-error">{m.newNameProblem}</span>}
      <span className="ml-auto flex gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {m.cancel}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ok}>
          {m.newStart}
        </button>
      </span>
    </form>
  );
}
