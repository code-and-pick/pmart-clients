// 문서 보기·고치기(초안)·승인 요청(ai-assistant 1.4.0 + approval 0.7.0 RAG_DOCUMENT, ADR-0092 — 요청서 §화면 2·3·4).
// - 보기: 지금 판 또는 고른 판 본문 + 판 이력. "이 판으로 되돌리기" = 옛 본문으로 새 초안(바로 되돌리지 않는다 — 다시 승인).
// - 고치기: 편집기(마크다운 원문) + 미리 보기. 처음 저장 = POST 초안(기준 판 = 본 판), 그 뒤 PUT. 형식 오류는 서버 details 그대로.
// - 승인 요청: 초안 응답의 approvalRequest 를 그대로 approval 에. 요청 뒤 고치면 본문 해시가 달라 반영되지 않는다 → 다시 요청.
// - 서버가 반영하기 전에는 "반영됨"을 보이지 않는다(초안 state·반영 기록이 정본).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, useCommand, type Command } from '@pmart/web-ui';
import { requestApproval } from '../../api/approvalFlow';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { NextAction, PageHeader, Section, StatusBadge } from '../../shared/admin';
import { CommandFeedback } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { Markdown } from '../../shared/Markdown';
import { messages } from '../../shared/messages';
import { StaffName } from '../lookup/parts';
import {
  approvalBodyOf,
  canEditKnowledge,
  contentProblems,
  createDraft,
  discardDraft,
  docLink,
  docParts,
  draftLink,
  knowledgeKeys,
  updateDraft,
  useKnowledgeDocument,
  useKnowledgeDraft,
  type KnowledgeDraft,
} from './knowledgeApi';
import { INDEX_TONE, UpdatedBy } from './KnowledgeDocumentsPage';
import { draftOpLabel, ProblemDetails } from './KnowledgeParts';

const m = messages.knowledge;
const BACK = { to: '/assistant/documents', label: m.title };

const isNotFound = (e: unknown) => e instanceof ProblemFailure && e.problem.status === 404;
const isStale = (e: unknown) => e instanceof ProblemFailure && e.problem.code === 'STALE_VERSION';

/** 문서 보기 /assistant/documents/view?documentId=&version= */
export function KnowledgeDocumentPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session } = useSession();
  const editor = canEditKnowledge(session?.roles ?? []);
  const [params] = useSearchParams();
  const documentId = params.get('documentId') ?? '';
  const version = Number(params.get('version')) || null;
  const q = useKnowledgeDocument(documentId, version);
  const [raw, setRaw] = useState(false);
  const retire = useCommand(async (base: number, key) => {
    const d = await createDraft(api, { documentId, op: 'RETIRE', baseVersion: base }, key);
    void navigate(draftLink(d.draftId));
    return d;
  });

  return (
    <section className="space-y-4">
      <PageHeader title={q.data?.document.title || docParts(documentId).file || m.title} back={BACK} />
      <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
        {(d) => {
          const doc = d.document;
          const old = d.shownVersion !== doc.version;
          const canChange = editor && !doc.readOnly && !doc.retired;
          return (
            <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              <div className="space-y-4 lg:col-span-2">
                {old && (
                  <NextAction tone="info" title={m.oldVersionTitle(d.shownVersion, doc.version)} body={m.oldVersionBody} testId="knowledge-old-version">
                    <Link className="btn btn-sm" to={docLink(documentId)}>
                      {m.seeCurrent}
                    </Link>
                    {canChange && (
                      <Link className="btn btn-sm btn-primary" data-testid="knowledge-revert" to={`/assistant/documents/new?documentId=${encodeURIComponent(documentId)}&from=${d.shownVersion}`}>
                        {m.revert}
                      </Link>
                    )}
                  </NextAction>
                )}
                <Section
                  title={m.contentTitle(d.shownVersion)}
                  aside={
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRaw((x) => !x)}>
                      {raw ? m.showPreview : m.showRaw}
                    </button>
                  }
                  testId="knowledge-content"
                >
                  {raw ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{d.content}</pre> : <Markdown source={d.content} />}
                </Section>
              </div>
              <aside className="space-y-4">
                <Section title={m.summaryTitle}>
                  <dl className="space-y-2 text-sm">
                    <Row label={m.head.domain}>{m.domainName[doc.domain] ?? doc.domain}</Row>
                    <Row label={m.head.file}>
                      <span className="break-all font-mono text-xs">{doc.documentId}</span>
                    </Row>
                    <Row label={m.head.version}>{m.version(doc.version)}</Row>
                    <Row label={m.head.index}>
                      <StatusBadge tone={doc.retired ? 'ghost' : INDEX_TONE[doc.indexState]}>{doc.retired ? m.retired : m.indexState[doc.indexState]}</StatusBadge>
                    </Row>
                    <Row label={m.head.updated}>
                      <UpdatedBy id={doc.updatedBy} /> · {formatSeoul(doc.updatedAt)}
                    </Row>
                  </dl>
                  {doc.readOnly && <p className="mt-3 text-xs text-base-content/60" data-testid="knowledge-readonly">{m.readOnlyBody}</p>}
                  {canChange && !old && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-base-200 pt-3">
                      <Link className="btn btn-primary btn-sm" data-testid="knowledge-edit" to={`/assistant/documents/new?documentId=${encodeURIComponent(documentId)}&from=${doc.version}`}>
                        {m.edit}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-testid="knowledge-retire"
                        disabled={retire.busy}
                        onClick={() => {
                          if (window.confirm(m.retireConfirm)) void retire.run(doc.version);
                        }}
                      >
                        {m.retire}
                      </button>
                    </div>
                  )}
                  <div className="mt-2">
                    <CommandFeedback command={retire}>{() => null}</CommandFeedback>
                    {retire.phase.kind === 'rejected' && isStale(retire.phase.failure) && <p className="text-xs text-error">{m.stale}</p>}
                  </div>
                </Section>
                <Section title={m.versionsTitle(d.versions.length)} testId="knowledge-versions">
                  <ul className="divide-y divide-base-300 text-sm">
                    {d.versions.map((v) => (
                      <li key={v.version} className={`space-y-0.5 py-2 ${v.version === d.shownVersion ? 'font-medium' : ''}`} data-testid="knowledge-version">
                        <p className="flex items-center gap-2">
                          {v.version === d.shownVersion ? <span>{m.version(v.version)}</span> : (
                            <Link className="link" to={docLink(documentId, v.version)}>
                              {m.version(v.version)}
                            </Link>
                          )}
                          <StatusBadge tone={v.op === 'RETIRE' ? 'error' : v.op === 'IMPORT' ? 'ghost' : 'info'}>{m.versionOp[v.op]}</StatusBadge>
                          {v.version === doc.version && <span className="text-xs text-primary">{m.currentMark}</span>}
                        </p>
                        <p className="text-xs text-base-content/60">
                          <UpdatedBy id={v.createdBy} /> · {formatSeoul(v.createdAt)}
                          {v.approvalId && (
                            <>
                              {' · '}
                              <Link className="link" to={`/approvals/${encodeURIComponent(v.approvalId)}`}>
                                {m.openApproval}
                              </Link>
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              </aside>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-xs text-base-content/55">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** 새 초안 /assistant/documents/new?documentId=&from=<판> — from 없이 없는 문서면 새 문서(기준 판 0) */
export function NewKnowledgeDraftPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const documentId = params.get('documentId') ?? '';
  const from = Number(params.get('from')) || null;
  const src = useKnowledgeDocument(documentId, from);
  const missing = src.isError && isNotFound(src.error) && from === null;
  const save = useCommand(async (body: { content: string; baseVersion: number }, key) => {
    const d = await createDraft(api, { documentId, op: 'UPSERT', baseVersion: body.baseVersion, content: body.content }, key);
    void qc.invalidateQueries({ queryKey: knowledgeKeys.drafts });
    void navigate(draftLink(d.draftId), { replace: true });
    return d;
  });

  if (!missing && (src.isPending || src.isError)) {
    return (
      <section className="space-y-4">
        <PageHeader title={m.editTitle} back={BACK} />
        <QueryState state={toUiState(src)} onRetry={() => void src.refetch()}>
          {() => null}
        </QueryState>
      </section>
    );
  }
  const base = missing ? 0 : (src.data?.document.version ?? 0);
  const initial = missing ? m.newTemplate : (src.data?.content ?? '');
  const revertFrom = !missing && src.data && src.data.shownVersion !== src.data.document.version ? src.data.shownVersion : null;
  return (
    <DraftEditor
      key={`${documentId}:${from ?? ''}:${missing}`}
      title={missing ? m.newDocTitle : revertFrom ? m.revertTitle(revertFrom) : m.editTitle}
      documentId={documentId}
      baseVersion={base}
      initial={initial}
      // 새 문서·되돌리기는 바로 저장할 수 있게, 그냥 고치기는 바꿔야 저장
      saved={missing || revertFrom !== null ? null : initial}
      leavesOnSave
      command={save}
      onSave={(content) => void save.run({ content, baseVersion: base })}
    />
  );
}

/** 초안 /assistant/documents/drafts/:draftId — 열린 내 초안이면 고치기·버리기·승인 요청, 아니면 읽기만 */
export function KnowledgeDraftPage() {
  const { draftId = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { session } = useSession();
  const q = useKnowledgeDraft(draftId);
  const save = useCommand(async (content: string, key) => {
    const d = await updateDraft(api, draftId, content, key);
    qc.setQueryData(knowledgeKeys.draft(draftId), d);
    void qc.invalidateQueries({ queryKey: knowledgeKeys.drafts });
    return d;
  });
  const discard = useCommand(async (_: null, key) => {
    await discardDraft(api, draftId, key);
    void qc.invalidateQueries({ queryKey: knowledgeKeys.all });
    void navigate('/assistant/documents');
    return true;
  });

  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(d) => {
        const mine = d.authorId === session?.subject;
        const editable = d.state === 'OPEN' && mine && d.op === 'UPSERT' && canEditKnowledge(session?.roles ?? []);
        const side = (
          <>
            <DraftStatus draft={d} />
            {d.state === 'OPEN' && mine && (
              <ApprovalBox draft={d} />
            )}
            {d.state === 'OPEN' && mine && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  data-testid="knowledge-discard"
                  disabled={discard.busy}
                  onClick={() => {
                    if (window.confirm(m.discardConfirm)) void discard.run(null);
                  }}
                >
                  {m.discard}
                </button>
              </div>
            )}
            <CommandFeedback command={discard}>{() => null}</CommandFeedback>
          </>
        );
        if (editable)
          return (
            <DraftEditor
              key={d.draftId}
              title={m.draftTitle(d.title ?? docParts(d.documentId).file)}
              documentId={d.documentId}
              baseVersion={d.baseVersion}
              initial={d.content ?? ''}
              saved={d.content ?? ''}
              command={save}
              onSave={(content) => void save.run(content)}
              side={side}
            />
          );
        return (
          <section className="space-y-4">
            <PageHeader title={m.draftTitle(d.title ?? docParts(d.documentId).file)} back={BACK} />
            <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              <div className="lg:col-span-2">
                <Section title={d.op === 'RETIRE' ? m.retireBodyTitle : m.contentDraft}>
                  {d.op === 'RETIRE' ? <p className="text-sm text-error">{m.retireBody}</p> : <Markdown source={d.content ?? ''} />}
                </Section>
              </div>
              <aside className="space-y-4">{side}</aside>
            </div>
          </section>
        );
      }}
    </QueryState>
  );
}

function DraftStatus({ draft: d }: { readonly draft: KnowledgeDraft }) {
  return (
    <Section title={m.draftStatusTitle} testId="knowledge-draft-status">
      <dl className="space-y-2 text-sm">
        <Row label={m.head.op}>
          <StatusBadge tone={d.op === 'RETIRE' ? 'error' : d.baseVersion === 0 ? 'success' : 'info'}>{draftOpLabel(d)}</StatusBadge>
        </Row>
        <Row label={m.head.file}>
          <Link className="link break-all font-mono text-xs" to={docLink(d.documentId)}>
            {d.documentId}
          </Link>
        </Row>
        <Row label={m.head.base}>{d.baseVersion === 0 ? m.baseNew : m.version(d.baseVersion)}</Row>
        <Row label={m.head.state}>
          <span data-testid="knowledge-draft-state" data-state={d.state}>
            <StatusBadge tone={d.state === 'APPLIED' ? 'success' : d.state === 'REJECTED' ? 'error' : d.state === 'DISCARDED' ? 'ghost' : 'info'}>{m.draftState[d.state]}</StatusBadge>
          </span>
        </Row>
        {d.resultReason && (
          <Row label={m.head.reason}>
            <span className="text-error" data-testid="knowledge-draft-reason">{m.reason[d.resultReason] ?? d.resultReason}</span>
          </Row>
        )}
        <Row label={m.author}>
          <StaffName id={d.authorId} />
        </Row>
        <Row label={m.head.updated}>{formatSeoul(d.updatedAt)}</Row>
        {d.approvalId && (
          <Row label={m.head.approval}>
            <Link className="link" to={`/approvals/${encodeURIComponent(d.approvalId)}`}>
              {m.openApproval}
            </Link>
          </Row>
        )}
      </dl>
    </Section>
  );
}

/** 이 초안의 심사 중 승인 + 그 승인이 잠근 본문 해시(행 attributes.contentSha256) */
function usePendingApproval(draftId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['approvals', 'rag-document', draftId],
    queryFn: async () => {
      const list = await request('GET', api.approval.GET('/approvals', { params: { query: { type: 'RAG_DOCUMENT', targetRef: draftId, reviewState: 'REVIEW_PENDING', size: 1 } } }));
      const id = list.items?.[0]?.approvalId;
      if (!id) return null;
      const a = await request('GET', api.approval.GET('/approvals/{approvalId}', { params: { path: { approvalId: id } } }));
      const sha = a.lines?.[0]?.attributes?.['contentSha256'];
      return { approvalId: id, contentSha256: typeof sha === 'string' ? sha : null };
    },
  });
}

function ApprovalBox({ draft: d }: { readonly draft: KnowledgeDraft }) {
  const api = useApi();
  const qc = useQueryClient();
  const pending = usePendingApproval(d.draftId);
  const sha = d.contentSha256 ?? null;
  // 보낸 본문 해시를 결과에 같이 — 본문을 고쳐 저장하면(해시가 바뀜) 다시 요청할 수 있다
  const send = useCommand(async (body: { sha: string | null }, key) => {
    const r = await requestApproval(api, approvalBodyOf(d), key);
    void qc.invalidateQueries({ queryKey: ['approvals', 'rag-document', d.draftId] });
    return { ...r, sha: body.sha };
  });
  const sentNow = send.phase.kind === 'done' && send.phase.result.sha === sha;

  const p = pending.data ?? null;
  const changedAfter = p !== null && d.op === 'UPSERT' && p.contentSha256 !== sha;
  return (
    <Section title={m.approvalTitle} testId="knowledge-approval">
      <div className="space-y-3 text-sm">
        {sentNow ? null : pending.isError ? (
          <p className="text-xs text-warning">{m.pendingFailed}</p>
        ) : p && !changedAfter ? (
          <div role="status" className="space-y-2" data-testid="knowledge-pending">
            <p className="font-medium">{m.pendingNow}</p>
            <p className="text-xs text-warning">{m.pendingWarn}</p>
            <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(p.approvalId)}`}>
              {m.openApproval}
            </Link>
          </div>
        ) : (
          <>
            {changedAfter && (
              <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="knowledge-changed-after">
                {m.changedAfter}
                <Link className="link" to={`/approvals/${encodeURIComponent(p.approvalId)}`}>
                  {m.openApproval}
                </Link>
              </p>
            )}
            <p className="text-xs text-base-content/65">{m.approvalHint}</p>
            {!sentNow && (
              <button type="button" className="btn btn-primary btn-sm" data-testid="knowledge-request" disabled={send.busy || pending.isPending} onClick={() => void send.run({ sha })}>
                {m.request}
              </button>
            )}
          </>
        )}
        <CommandFeedback command={send}>
          {(r) => sentNow && (
            <div role="status" className="space-y-2 rounded-box border border-success/30 bg-success/10 px-3 py-2.5" data-testid="knowledge-requested">
              <p className="font-medium text-success">{r.approvalId ? m.requested : m.requestedNoId}</p>
              <p className="text-xs text-warning">{m.pendingWarn}</p>
              {r.approvalId && (
                <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(r.approvalId)}`}>
                  {m.openApproval}
                </Link>
              )}
            </div>
          )}
        </CommandFeedback>
        {send.phase.kind === 'rejected' && send.phase.failure instanceof ProblemFailure && send.phase.failure.problem.code === 'DUPLICATE_APPROVAL' && (
          <p className="text-xs text-error">{m.duplicate}</p>
        )}
      </div>
    </Section>
  );
}

/** 편집기 — 왼쪽 원문, 오른쪽 미리 보기. 저장 전 화면 검사(첫 줄 제목·크기·금지 표현), 서버 400 details 는 그 아래 */
function DraftEditor<V>({
  title,
  documentId,
  baseVersion,
  initial,
  saved,
  leavesOnSave = false,
  command,
  onSave,
  side,
}: {
  readonly title: string;
  readonly documentId: string;
  readonly baseVersion: number;
  readonly initial: string;
  /** 서버에 저장된 본문(없으면 null — 새 초안) */
  readonly saved: string | null;
  /** 저장하면 다른 화면(초안)으로 옮긴다 */
  readonly leavesOnSave?: boolean;
  readonly command: Command<V, KnowledgeDraft>;
  readonly onSave: (content: string) => void;
  readonly side?: ReactNode;
}) {
  const [content, setContent] = useState(initial);
  const dirty = content !== saved;
  const problems = contentProblems(content);
  const failure = command.phase.kind === 'rejected' ? command.phase.failure : null;
  return (
    <section className="space-y-4">
      <PageHeader title={title} back={BACK} />
      {/* 새 초안은 저장하면서 초안 화면으로 옮긴다 — 저장 중·저장 뒤에는 떠남 경고를 끈다 */}
      <LeaveGuard when={dirty && !command.busy && !(leavesOnSave && command.phase.kind === 'done')} />
      <p className="font-mono text-xs text-base-content/55">
        {documentId} · {baseVersion === 0 ? m.baseNew : m.baseOf(baseVersion)}
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 xl:grid-cols-2 [&>*]:min-w-0">
            <label className="block">
              <span className="text-xs font-medium text-base-content/60">{m.editorLabel}</span>
              <textarea
                className="textarea mt-1 h-[32rem] w-full font-mono text-xs leading-relaxed"
                aria-label={m.editorLabel}
                spellCheck={false}
                value={content}
                disabled={command.busy}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            <div>
              <span className="text-xs font-medium text-base-content/60">{m.tabPreview}</span>
              <div className="mt-1 h-[32rem] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3" data-testid="knowledge-preview">
                <Markdown source={content} />
              </div>
            </div>
          </div>
          <p className="text-xs text-base-content/55">{m.editorHint}</p>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-4">
          <Section title={m.saveTitle}>
            <div className="space-y-3 text-sm">
              {problems.length > 0 ? (
                <ul className="space-y-1 text-xs text-warning" data-testid="knowledge-problems">
                  {problems.map((p) => (
                    <li key={p.kind + (p.word ?? '')}>{p.kind === 'title' ? m.problem.title : p.kind === 'size' ? m.problem.size : m.problem.word(p.word ?? '')}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-success">{dirty ? m.readyToSave : m.savedState}</p>
              )}
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary btn-sm" data-testid="knowledge-save" disabled={!dirty || problems.length > 0 || command.busy} onClick={() => onSave(content)}>
                  {m.save}
                </button>
              </div>
              <CommandFeedback command={command}>{() => <p role="status" className="text-xs text-success" data-testid="knowledge-saved">{m.saved}</p>}</CommandFeedback>
              {failure && isStale(failure) && <p className="text-xs text-error" data-testid="knowledge-stale">{m.stale}</p>}
              <ProblemDetails failure={failure} />
              {dirty && side && <p className="text-xs text-warning">{m.saveBeforeRequest}</p>}
            </div>
          </Section>
          {!dirty && side}
        </aside>
      </div>
    </section>
  );
}
