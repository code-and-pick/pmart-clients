// 검색 동의어 관리(search 0.5.0 + approval 0.5.0 SEARCH_SYNONYM, ADR-0073 단계 B — PC 1 요청서 2026-11-20 request-search-synonym-screen).
// 지금 규칙(GET /search/synonym-rules) → 화면에서 바꿀 것 모으기(서버 초안 없음) → approval 변경 요청 한 번(기준 버전 = 지금 version).
// 승인(운영 관리자)되면 search-service 가 재색인 없이 다음 검색부터 반영 — 반영 결과는 /search/synonym-rule-applications 로 본다(반려는 승인함).
// 화면은 규칙 ID(lineKey)를 보이지 않는다(ADR-0070) — 새 묶음 ID 는 화면이 만든다(syn-<난수>).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { randomUuid, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { requestApproval } from '../../api/approvalFlow';
import type { components } from '../../api/generated/search';
import { useApi } from '../../app/ApiContext';
import { PageHeader, StatusBadge } from '../../shared/admin';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';

const m = messages.synonyms;
type RuleSet = components['schemas']['SynonymRuleSet'];
const TARGET_REF = 'pmart-product-synonyms';

type Op = 'ADD' | 'EDIT' | 'DELETE';
interface Change {
  readonly ruleId: string;
  readonly op: Op;
  readonly text: string;
  readonly before: readonly string[];
}

const termsOf = (text: string) => text.split(',').map((t) => t.trim()).filter(Boolean);

/** 서버 형식(approval SEARCH_SYNONYM 설명)과 같은 검사 — 걸리면 그 줄 옆에 */
export function termsProblem(text: string): string | null {
  const terms = termsOf(text);
  if (terms.length < 2 || terms.length > 20) return m.problem.count;
  if (terms.some((t) => t.length > 30)) return m.problem.length;
  if (terms.some((t) => t.includes('=>') || t.includes('#'))) return m.problem.chars;
  if (new Set(terms.map((t) => t.toLowerCase())).size !== terms.length) return m.problem.dup;
  return null;
}

const newRuleId = () => `syn-${randomUuid().replace(/-/g, '').slice(0, 10)}`;

function Terms({ terms }: { readonly terms: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {terms.map((t) => (
        <span key={t} className="rounded-md bg-base-200 px-2 py-0.5 text-sm">
          {t}
        </span>
      ))}
    </span>
  );
}

export function SynonymRulesPage() {
  const api = useApi();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const rules = useQuery({ queryKey: ['search', 'synonym-rules'], queryFn: () => request('GET', api.search.GET('/search/synonym-rules')) });
  const history = useQuery({ queryKey: ['search', 'synonym-applications'], queryFn: () => request('GET', api.search.GET('/search/synonym-rule-applications', { params: { query: { size: 20 } } })) });
  const pending = useQuery({
    queryKey: ['approvals', 'synonym-pending'],
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { type: 'SEARCH_SYNONYM', reviewState: 'REVIEW_PENDING', size: 1 } } })),
  });
  const pendingId = pending.data?.items?.[0]?.approvalId ?? null;

  const send = useCommand((body: Parameters<typeof requestApproval>[1], key) => requestApproval(api, body, key));
  const done = send.phase.kind === 'done' ? send.phase.result : null;

  // "결과 없는 검색어"에서 넘어오면(?add=검색어) 그 낱말을 첫 낱말로 새 묶음 한 줄(한 번만)
  const addWord = params.get('add');
  const [changes, setChanges] = useState<readonly Change[]>(() => (addWord ? [{ ruleId: newRuleId(), op: 'ADD', text: `${addWord}, `, before: [] }] : []));
  useEffect(() => {
    if (!addWord) return;
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('add');
      return n;
    }, { replace: true });
  }, [addWord, setParams]);

  const byRule = useMemo(() => new Map(changes.map((c) => [c.ruleId, c])), [changes]);
  const put = (c: Change) => setChanges((all) => (all.some((x) => x.ruleId === c.ruleId) ? all.map((x) => (x.ruleId === c.ruleId ? c : x)) : [...all, c]));
  const drop = (ruleId: string) => setChanges((all) => all.filter((x) => x.ruleId !== ruleId));

  const problems = changes.map((c) => (c.op === 'DELETE' ? null : termsProblem(c.text)));
  // 쉼표 뒤를 아직 치는 중(낱말 하나 + 쉼표)이면 개수 까닭은 보이지 않는다 — 단추만 꺼 둔다
  const shown = (c: Change, p: string | null) => (p && c.text.trim() && !(p === m.problem.count && termsOf(c.text).length === 1 && c.text.trimEnd().endsWith(',')) ? p : null);
  const ready = changes.length > 0 && problems.every((p) => p === null) && rules.data !== undefined && !pendingId;

  const submit = (set: RuleSet) => {
    const label = (c: Change) => (c.op === 'DELETE' ? c.before : termsOf(c.text)).slice(0, 2).join('·');
    const first = changes[0];
    if (!first) return;
    const head = first.op === 'ADD' ? m.summaryAdd(label(first)) : first.op === 'EDIT' ? m.summaryEdit(label(first)) : m.summaryDelete(label(first));
    void send.run(
      {
        type: 'SEARCH_SYNONYM',
        targetService: 'search-service',
        targetRef: TARGET_REF,
        targetExpectedVersion: set.version,
        allowedActions: ['APPLY_SYNONYM_RULES'], // 확정(백엔드 회신 2026-11-20 — approval·search 계약 설명, 서버 값 검사는 아직 없음)
        summary: m.summary(changes.length, head),
        lines: changes.map((c) => ({
          lineKey: c.ruleId,
          attributes: c.op === 'DELETE' ? { op: 'DELETE', before: c.before } : { op: 'UPSERT', terms: termsOf(c.text), ...(c.before.length ? { before: c.before } : {}) },
        })),
      },
    );
  };

  const again = () => {
    setChanges([]);
    send.reset();
    void qc.invalidateQueries({ queryKey: ['search'] });
    void qc.invalidateQueries({ queryKey: ['approvals', 'synonym-pending'] });
  };

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} />

      {pendingId && !done && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-warning/40 bg-warning/10 px-4 py-3 text-sm" data-testid="synonym-pending">
          <span>{m.pending}</span>
          <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(pendingId)}`}>
            {m.openPending}
          </Link>
        </div>
      )}

      <QueryState state={toUiState(rules)} onRetry={() => void rules.refetch()}>
        {(set) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* 지금 규칙 */}
            <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.rulesTitle}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {m.rulesTitle} <span className="font-normal text-base-content/55">· {m.now(set.rules.length)}</span>
                </h2>
                <span className="text-xs text-base-content/50" data-testid="synonym-version">
                  {m.version(set.version)}
                  {set.updatedAt ? ` · ${m.updatedAt(formatSeoul(set.updatedAt))}` : ''}
                </span>
              </div>
              {set.rules.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-base-content/60">{m.rulesEmpty}</p>
              ) : (
                <ul className="divide-y divide-base-300">
                  {set.rules.map((r) => {
                    const c = byRule.get(r.ruleId);
                    return (
                      <li key={r.ruleId} className={`flex items-center gap-3 px-4 py-2.5 ${c ? 'bg-primary/5' : ''}`} data-testid="synonym-rule">
                        <div className="min-w-0 flex-1">
                          <Terms terms={r.terms} />
                        </div>
                        {c ? (
                          <StatusBadge tone={c.op === 'DELETE' ? 'error' : 'info'}>{m.op[c.op]}</StatusBadge>
                        ) : (
                          <span className="flex shrink-0 gap-1">
                            <button type="button" className="btn btn-ghost btn-xs" disabled={!!done} onClick={() => put({ ruleId: r.ruleId, op: 'EDIT', text: r.terms.join(', '), before: r.terms })}>
                              {m.edit}
                            </button>
                            <button type="button" className="btn btn-ghost btn-xs text-error" disabled={!!done} onClick={() => put({ ruleId: r.ruleId, op: 'DELETE', text: '', before: r.terms })}>
                              {m.remove}
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 바꿀 것 → 승인 요청 */}
            <section className="flex flex-col rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.changesTitle(changes.length)}>
              <div className="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                <h2 className="text-sm font-semibold">{m.changesTitle(changes.length)}</h2>
                <button type="button" className="btn btn-sm btn-outline btn-primary" disabled={!!done} data-testid="synonym-add" onClick={() => put({ ruleId: newRuleId(), op: 'ADD', text: '', before: [] })}>
                  + {m.add}
                </button>
              </div>
              {done ? (
                <div className="m-4 space-y-3 rounded-box border border-success/30 bg-success/10 px-4 py-4" role="status" data-testid="synonym-done">
                  <p className="font-semibold text-success">{m.requested}</p>
                  <div className="flex flex-wrap gap-2">
                    {done.approvalId && (
                      <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(done.approvalId)}`}>
                        {m.openApproval}
                      </Link>
                    )}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={again}>
                      {m.again}
                    </button>
                  </div>
                </div>
              ) : changes.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-base-content/60">{m.changesEmpty}</p>
              ) : (
                <ul className="divide-y divide-base-300">
                  {changes.map((c, i) => (
                    <li key={c.ruleId} className="space-y-1.5 px-4 py-3" data-testid="synonym-change">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge tone={c.op === 'DELETE' ? 'error' : c.op === 'ADD' ? 'success' : 'info'}>{m.op[c.op]}</StatusBadge>
                        <button type="button" className="btn btn-ghost btn-xs" disabled={send.busy} onClick={() => drop(c.ruleId)}>
                          {m.drop}
                        </button>
                      </div>
                      {c.op === 'DELETE' ? (
                        <Terms terms={c.before} />
                      ) : (
                        <>
                          <input
                            className={`input input-sm w-full ${shown(c, problems[i] ?? null) ? 'input-error' : ''}`}
                            // 새 묶음은 바로 칠 수 있게(이 화면에서 연 줄에만)
                            autoFocus={c.op === 'ADD' && i === changes.length - 1}
                            aria-label={m.termsLabel}
                            placeholder={m.termsPlaceholder}
                            disabled={send.busy}
                            value={c.text}
                            onChange={(e) => put({ ...c, text: e.target.value })}
                          />
                          {c.op === 'EDIT' && <p className="text-xs text-base-content/50">{m.before(c.before.join(', '))}</p>}
                          {shown(c, problems[i] ?? null) && (
                            <p className="text-xs text-error" data-testid="synonym-problem">
                              {shown(c, problems[i] ?? null)}
                            </p>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!done && changes.length > 0 && (
                <div className="mt-auto space-y-2 border-t border-base-300 px-4 py-3">
                  <div className="flex justify-end">
                    <button type="button" className="btn btn-primary btn-sm" disabled={!ready || send.busy} data-testid="synonym-submit" onClick={() => submit(set)}>
                      {m.submit(changes.length)}
                    </button>
                  </div>
                  <CommandFeedback command={send}>{() => null}</CommandFeedback>
                </div>
              )}
            </section>
          </div>
        )}
      </QueryState>

      {/* 반영 기록 — 승인된 요청만(반려는 승인함) */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.historyTitle}>
        <h2 className="border-b border-base-300 px-4 py-3 text-sm font-semibold">{m.historyTitle}</h2>
        <QueryState state={toUiState(history)} onRetry={() => void history.refetch()}>
          {(h) =>
            h.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-base-content/60">{m.historyEmpty}</p>
            ) : (
              <ul className="divide-y divide-base-300">
                {h.items.map((x) => (
                  <li key={x.approvalId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" data-testid="synonym-history">
                    <StatusBadge tone={x.result === 'APPLIED' ? 'success' : 'error'}>{m.result[x.result]}</StatusBadge>
                    {x.result === 'APPLIED' ? <span>{m.toVersion(x.version)}</span> : <span className="text-error">{(x.reason && m.reason[x.reason]) ?? x.reason}</span>}
                    {x.lineReasons && Object.keys(x.lineReasons).length > 0 && (
                      <span className="text-xs text-base-content/60">{[...new Set(Object.values(x.lineReasons))].map((r) => m.lineReason[r] ?? r).join(' · ')}</span>
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
      </section>
    </section>
  );
}
