// 문서 관리 공용 조각: 줄 비교(지금 판 ↔ 초안), 서버 400 details, 승인함 RAG_DOCUMENT 상세(ADR-0092 §화면 5).
import { useState } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, type PmartFailure } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { StatusBadge } from '../../shared/admin';
import { foldDiff, lineDiff } from '../../shared/lineDiff';
import { Markdown } from '../../shared/Markdown';
import { messages } from '../../shared/messages';
import { StaffName } from '../lookup/parts';
import { docLink, docParts, draftLink, useKnowledgeDraft, type KnowledgeDraft } from './knowledgeApi';

const m = messages.knowledge;

/** 서버 400 의 details(field·reason)를 그대로 — 화면이 말을 지어내지 않는다 */
export function ProblemDetails({ failure }: { readonly failure: PmartFailure | null }) {
  if (!(failure instanceof ProblemFailure) || failure.problem.details.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-xs text-error" data-testid="knowledge-problem-details">
      {failure.problem.details.map((d, i) => (
        <li key={i}>{[d.field ? m.field[d.field] ?? d.field : null, d.reason].filter(Boolean).join(': ')}</li>
      ))}
    </ul>
  );
}

/** 지금 판 ↔ 초안 줄 비교. 같은 줄 묶음은 접는다 */
export function DiffView({ before, after }: { readonly before: string; readonly after: string }) {
  const [all, setAll] = useState(false);
  const lines = lineDiff(before, after);
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  const rows = all ? lines : foldDiff(lines);
  return (
    <div className="space-y-2" data-testid="knowledge-diff">
      <p className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-success" data-testid="diff-added">{m.diffAdded(added)}</span>
        <span className="text-error" data-testid="diff-removed">{m.diffRemoved(removed)}</span>
        {added + removed === 0 && <span className="text-base-content/60">{m.diffSame}</span>}
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => setAll((x) => !x)}>
          {all ? m.diffFold : m.diffAll}
        </button>
      </p>
      <div className="overflow-x-auto rounded-box border border-base-300 font-mono text-xs">
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((r, i) =>
              r.kind === 'gap' ? (
                <tr key={i} className="bg-base-200/60 text-base-content/50">
                  <td colSpan={3} className="px-2 py-0.5 text-center">
                    {m.diffGap(r.count)}
                  </td>
                </tr>
              ) : (
                <tr key={i} className={r.kind === 'add' ? 'bg-success/10' : r.kind === 'del' ? 'bg-error/10' : ''} data-kind={r.kind}>
                  <td className="w-10 select-none px-2 text-right text-base-content/40">{r.oldNo ?? ''}</td>
                  <td className="w-10 select-none px-2 text-right text-base-content/40">{r.newNo ?? ''}</td>
                  <td className="whitespace-pre-wrap break-all px-2">
                    <span className="select-none text-base-content/50">{r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}</span>
                    {r.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function draftOpLabel(d: Pick<KnowledgeDraft, 'op' | 'baseVersion'>) {
  return d.op === 'RETIRE' ? m.op.RETIRE : d.baseVersion === 0 ? m.op.NEW : m.op.UPSERT;
}

/** 승인함 상세(종류 RAG_DOCUMENT): targetRef(초안 ID)로 초안 + 지금 판을 받아 나란히 비교 */
export function KnowledgeDraftReview({ draftId }: { readonly draftId: string }) {
  const q = useKnowledgeDraft(draftId);
  const [mode, setMode] = useState<'diff' | 'preview'>('diff');
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(d) => {
        const current = d.current ?? null;
        const stale = current !== null && current.version !== undefined && current.version !== d.baseVersion;
        return (
          <div className="space-y-3 text-sm" data-testid="knowledge-review">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={d.op === 'RETIRE' ? 'error' : d.baseVersion === 0 ? 'success' : 'info'}>{draftOpLabel(d)}</StatusBadge>
              <Link className="link font-medium" to={docLink(d.documentId)}>
                {d.title ?? docParts(d.documentId).file}
              </Link>
              <span className="font-mono text-xs text-base-content/50">{d.documentId}</span>
            </p>
            <p className="text-xs text-base-content/65">
              {m.reviewMeta(d.baseVersion, current?.version ?? null)} · {m.author} <StaffName id={d.authorId} /> ·{' '}
              <Link className="link" to={draftLink(d.draftId)}>
                {m.openDraft}
              </Link>
            </p>
            {stale && (
              <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="knowledge-review-stale">
                {m.reviewStale}
              </p>
            )}
            {d.state !== 'OPEN' && (
              <p className="text-xs text-base-content/65" data-testid="knowledge-review-state">
                {m.draftState[d.state]}
                {d.resultReason ? ` · ${m.reason[d.resultReason] ?? d.resultReason}` : ''}
              </p>
            )}
            {d.op === 'RETIRE' ? (
              <div className="space-y-2">
                <p className="font-medium text-error">{m.reviewRetire}</p>
                {current && <Markdown source={current.content ?? ''} className="rounded-box border border-base-300 p-3" />}
              </div>
            ) : (
              <>
                <div role="tablist" className="tabs tabs-border tabs-sm">
                  <button type="button" role="tab" className={`tab ${mode === 'diff' ? 'tab-active' : ''}`} aria-selected={mode === 'diff'} onClick={() => setMode('diff')}>
                    {current ? m.tabDiff : m.tabNewDoc}
                  </button>
                  <button type="button" role="tab" className={`tab ${mode === 'preview' ? 'tab-active' : ''}`} aria-selected={mode === 'preview'} onClick={() => setMode('preview')}>
                    {m.tabPreview}
                  </button>
                </div>
                {mode === 'diff' ? (
                  <DiffView before={current?.content ?? ''} after={d.content ?? ''} />
                ) : (
                  <Markdown source={d.content ?? ''} className="rounded-box border border-base-300 p-3" />
                )}
              </>
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
