// 승인함 일괄 심사(2026-11-26 사용자 "하나하나 보고 승인하기 귀찮으니까").
// 계약에 여러 건을 한 번에 결정하는 API 는 없다 → 고른 건마다 기존 결정 명령(POST /approvals/{id}/decisions)을 차례로 보낸다.
// 건마다: 상세를 다시 읽어(최신 version·viewerCanDecide) → 심사 중이고 내가 결정할 수 있을 때만 보냄 → 결과를 건별로(서버 확정만 확정).
// 키는 묶음 키 + 승인 ID — "안 된 것 다시"는 같은 키라 이미 들어간 결정이 두 번 되지 않는다. 결과 불명·시간 초과는 상세 짝 조회로 해소.
// 승인·반려만(부분 승인·자료 요청은 건마다 값이 달라 상세에서).
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { CommandRejectedFailure, IdempotencyKey, PmartFailure, pollUntil, ProblemFailure, request } from '@pmart/web-core';
import { failureCode, useUiText } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/approval';
import type { ReviewState } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { hideIds } from '../../shared/hideIds';
import { messages as m } from '../../shared/messages';

type Summary = components['schemas']['ApprovalSummary'];
type Decision = 'APPROVE' | 'REJECT';
const t = m.approvals.inbox.batch;
const OPEN_REVIEW: readonly ReviewState[] = ['REVIEW_PENDING', 'EVIDENCE_REQUIRED'];

type ItemResult =
  | { readonly kind: 'decided' }
  | { readonly kind: 'accepted' }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: PmartFailure | null }
  | { readonly kind: 'unknown' };

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm'; readonly decision: Decision }
  | { readonly kind: 'running' | 'done'; readonly decision: Decision; readonly ids: readonly string[]; readonly results: ReadonlyMap<string, ItemResult> };

const keyFor = (batch: IdempotencyKey, id: string) => new IdempotencyKey(`${batch.value}:${id}`.slice(0, IdempotencyKey.maxLength));
const settled = (r: ItemResult | undefined) => r?.kind === 'decided' || r?.kind === 'accepted' || r?.kind === 'skipped';

export function BatchDecide({ rows, picked, me, onClear, onDecided }: {
  /** 화면에 보이는 줄(고른 것의 이름을 보여 주려고) */
  readonly rows: readonly Summary[];
  readonly picked: readonly string[];
  readonly me: string | null;
  readonly onClear: () => void;
  /** 처리가 끝난(결정·접수·건너뜀) ID — 고르기에서 뺀다 */
  readonly onDecided: (ids: readonly string[]) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { problem } = useUiText();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [comment, setComment] = useState('');
  const [batchKey, setBatchKey] = useState(() => IdempotencyKey.generate());
  // 보내기 시작할 때 이름을 붙잡아 둔다 — 처리된 건은 목록을 다시 읽으면 빠져 이름을 잃는다
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map());

  if (phase.kind === 'idle' && picked.length === 0) return null;

  const byId = new Map(rows.flatMap((r) => (r.approvalId ? [[r.approvalId, r] as const] : [])));
  const nameOf = (id: string) => {
    const r = byId.get(id);
    return names.get(id) ?? (r ? hideIds(r.summary) || m.approvals.untitled : m.approvals.untitled);
  };

  const getOne = (id: string) => request('GET', api.approval.GET('/approvals/{approvalId}', { params: { path: { approvalId: id } } }));

  /** 결정이 들어갔는지 짝 조회 — 심사가 끝났고 마지막 결정이 나의 이 결정이면 들어간 것 */
  const mineDecided = (a: Awaited<ReturnType<typeof getOne>>, decision: Decision) =>
    !OPEN_REVIEW.includes(a.reviewState ?? 'REVIEW_PENDING') && (a.decisions ?? []).some((d) => d.decision === decision && (me === null || d.approverId === me));

  const decideOne = async (id: string, decision: Decision, key: IdempotencyKey): Promise<ItemResult> => {
    let a;
    try {
      a = await getOne(id);
    } catch (e) {
      return { kind: 'failed', failure: e instanceof PmartFailure ? e : null };
    }
    if (!OPEN_REVIEW.includes(a.reviewState ?? 'REVIEW_PENDING')) return mineDecided(a, decision) ? { kind: 'decided' } : { kind: 'skipped', reason: 'NOT_PENDING' };
    if (a.viewerCanDecide === false) return { kind: 'skipped', reason: a.viewerDecideBlockedReason ?? 'NO_ROLE' };
    const resolve = async (): Promise<ItemResult> => {
      const outcome = await pollUntil(() => getOne(id), (x) => !OPEN_REVIEW.includes(x.reviewState ?? 'REVIEW_PENDING'));
      return outcome.kind === 'done' && mineDecided(outcome.value, decision) ? { kind: 'decided' } : { kind: 'unknown' };
    };
    try {
      const res = await request(
        'POST',
        api.approval.POST('/approvals/{approvalId}/decisions', {
          ...commandParams(key, { path: { approvalId: id }, version: a.version }),
          body: { decision, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      );
      if (res.status === 'REJECTED') return { kind: 'failed', failure: new CommandRejectedFailure(res.nextAction, res.requestId) };
      if (res.status === 'UNKNOWN_RESULT') return await resolve();
      if (res.status === 'APPLIED') return { kind: 'decided' };
      // ACCEPTED 는 완료가 아니다 — 한 번 다시 읽어 심사가 끝났고 나의 결정이 있으면 확정, 아니면 "접수됨"
      try {
        return mineDecided(await getOne(id), decision) ? { kind: 'decided' } : { kind: 'accepted' };
      } catch {
        return { kind: 'accepted' };
      }
    } catch (e) {
      // 서버가 거절 사유를 준 것(Problem·명령 거절)만 실패. 시간 초과·5xx 등은 실패로 확정하지 않고 짝 조회
      if (e instanceof ProblemFailure || e instanceof CommandRejectedFailure) return { kind: 'failed', failure: e };
      return await resolve();
    }
  };

  const run = async (decision: Decision, ids: readonly string[], before: ReadonlyMap<string, ItemResult>) => {
    setNames((x) => new Map([...x, ...ids.map((id) => [id, nameOf(id)] as const)]));
    let results = new Map(before);
    setPhase({ kind: 'running', decision, ids, results });
    for (const id of ids) {
      if (settled(results.get(id))) continue;
      const r = await decideOne(id, decision, keyFor(batchKey, id));
      results = new Map(results).set(id, r);
      setPhase({ kind: 'running', decision, ids, results });
    }
    setPhase({ kind: 'done', decision, ids, results });
    onDecided(ids.filter((id) => settled(results.get(id))));
    void qc.invalidateQueries({ queryKey: ['approval'] });
  };

  const resultText = (decision: Decision, r: ItemResult | undefined): { text: string; tone: string } => {
    if (!r) return { text: t.waiting, tone: 'text-base-content/50' };
    switch (r.kind) {
      case 'decided':
        return { text: t.result[decision], tone: decision === 'APPROVE' ? 'text-success' : 'text-error' };
      case 'accepted':
        return { text: t.result.accepted, tone: 'text-info' };
      case 'skipped':
        return { text: r.reason === 'NOT_PENDING' ? t.result.notPending : t.result.blocked(m.approvals.inbox.blocked[r.reason] ?? r.reason), tone: 'text-base-content/60' };
      case 'unknown':
        return { text: t.result.unknown, tone: 'text-warning' };
      case 'failed': {
        const code = r.failure ? failureCode(r.failure) : undefined;
        return { text: t.result.failed(code ? (problem[code] ?? code) : null), tone: 'text-error' };
      }
    }
  };

  // ── 결과(보내는 중·끝) ──
  if (phase.kind === 'running' || phase.kind === 'done') {
    const done = phase.ids.filter((id) => phase.results.has(id)).length;
    const ok = phase.ids.filter((id) => {
      const k = phase.results.get(id)?.kind;
      return k === 'decided' || k === 'accepted';
    }).length;
    const left = phase.ids.filter((id) => !settled(phase.results.get(id)));
    return (
      <div className="space-y-3 border-b border-base-300 bg-base-200/40 px-4 py-3" data-testid="batch-results" aria-live="polite">
        <p className="text-sm font-semibold">{phase.kind === 'running' ? t.running(done, phase.ids.length) : t.doneTitle(ok, phase.ids.length)}</p>
        <ul className="space-y-1 text-sm">
          {phase.ids.map((id) => {
            const r = resultText(phase.decision, phase.results.get(id));
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-3" data-testid="batch-result">
                <Link className="min-w-0 truncate underline decoration-dotted underline-offset-2 hover:text-primary" to={`/approvals/${encodeURIComponent(id)}`}>
                  {nameOf(id)}
                </Link>
                <span className={`text-xs font-medium ${r.tone}`}>{r.text}</span>
              </li>
            );
          })}
        </ul>
        {phase.kind === 'done' && (
          <div className="flex flex-wrap gap-2">
            {left.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => void run(phase.decision, phase.ids, phase.results)}>
                {t.retry(left.length)}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPhase({ kind: 'idle' });
                setComment('');
                setNames(new Map());
                setBatchKey(IdempotencyKey.generate());
              }}
            >
              {t.close}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── 확인(무엇을 결정하는지 목록으로 한 번 더) ──
  if (phase.kind === 'confirm') {
    const d = phase.decision;
    return (
      <div className="space-y-3 border-b border-base-300 bg-base-200/40 px-4 py-3" data-testid="batch-confirm" role="group" aria-label={t.confirmTitle[d](picked.length)}>
        <p className="text-sm font-semibold">{t.confirmTitle[d](picked.length)}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {picked.map((id) => (
            <li key={id}>{nameOf(id)}</li>
          ))}
        </ul>
        <p className="text-xs text-base-content/60">{t.confirmNote}</p>
        <label className="flex max-w-xl flex-col gap-1 text-sm">
          {t.comment}
          <textarea className="textarea textarea-sm w-full" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn btn-sm ${d === 'APPROVE' ? 'btn-primary' : 'btn-error'}`} onClick={() => void run(d, picked, new Map())}>
            {t.go[d](picked.length)}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase({ kind: 'idle' })}>
            {t.cancel}
          </button>
        </div>
      </div>
    );
  }

  // ── 고른 뒤 띠 ──
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-primary/5 px-4 py-2" data-testid="batch-bar">
      <span className="text-sm font-medium">{t.picked(picked.length)}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setPhase({ kind: 'confirm', decision: 'APPROVE' })}>
        {t.approve}
      </button>
      <button type="button" className="btn btn-outline btn-error btn-sm" onClick={() => setPhase({ kind: 'confirm', decision: 'REJECT' })}>
        {t.reject}
      </button>
      <button type="button" className="pm-fbar-reset" onClick={onClear}>
        {t.clear}
      </button>
    </div>
  );
}
