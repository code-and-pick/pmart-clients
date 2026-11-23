// 접수 건 메모(case 0.10.0 — 백엔드 요청 backoffice/2026-11-16-request-case-notes, PR #43).
// - `GET /cases/{id}/notes`(오래된 것부터, 가린 메모는 text null·masked true), `POST /cases/{id}/notes` {text 1~500} — 볼 수 있는 본사 직원(관리자·지원센터·상담원).
//   처리 끝난 접수 건에도 남길 수 있다(상태 그대로). 고치기·지우기 없음.
// - 가림 `POST …/notes/{noteId}/maskings` {reason} — 관리자만(버튼도 관리자에게만). 가린 메모는 내용 없이 "가린 메모"·가린 사람·사유.
// - 메모는 직원이 쓴 글 — 화면에만(로그 없음). 입력란에 "개인정보(전화번호·주소)는 쓰지 마세요"(요청서).
import { StaffName } from '../lookup/parts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { text, when } from '../../shared/ops';

const m = messages.caseNotes;
type Note = components['schemas']['CaseNote'];

function MaskForm({ caseId, note, onDone }: { readonly caseId: string; readonly note: Note; readonly onDone: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // 사유·글은 명령 값으로(2026-11-23) — 결과 불명 뒤 같은 키로 다시 보낼 때 처음 값 그대로
  const cmd = useCommand(async (why: string, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/notes/{noteId}/maskings', { ...commandParams(key, { path: { caseId, noteId: note.noteId ?? '' } }), body: { reason: why } }),
    );
    onDone();
    return r;
  });
  if (!open)
    return (
      <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOpen(true)}>
        {m.mask}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-1"
      aria-label={m.mask}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run(reason.trim());
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {m.maskReason}
        <input className="input input-xs w-64" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-xs btn-warning" disabled={!reason.trim() || cmd.busy}>
        {m.mask}
      </button>
      <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={() => setOpen(false)}>
        {m.cancel}
      </button>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{m.masked}</span>}</CommandFeedback>
    </form>
  );
}

/** 접수 건 상세의 "메모" 칸 */
export function CaseNotes({ caseId }: { readonly caseId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const admin = roles.includes('OPERATOR_ADMIN');
  const canWrite = admin || roles.includes('RIDER_OPS') || roles.includes('CS_AGENT');
  const key = ['cases', 'notes', caseId];
  const query = useQuery({ queryKey: key, queryFn: () => request('GET', api.cases.GET('/cases/{caseId}/notes', { params: { path: { caseId } } })) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const [draft, setDraft] = useState('');
  const add = useCommand(async (t: string, k) => {
    const r = await request('POST', api.cases.POST('/cases/{caseId}/notes', { ...commandParams(k, { path: { caseId } }), body: { text: t } }));
    setDraft('');
    refresh();
    return r;
  });
  const ok = draft.trim().length >= 1 && draft.trim().length <= 500;
  return (
    // 대화 줄처럼(2026-11-18): 머리글자 동그라미 + 말풍선, 맨 아래 입력 상자
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.title}>
      <div className="flex items-center gap-2 border-b border-base-300 px-5 py-3">
        <h2 className="font-semibold">{m.title}</h2>
        {query.data && <span className="badge badge-ghost badge-sm">{(query.data.items ?? []).length}</span>}
      </div>
      <div className="space-y-4 px-5 py-4">
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
          {(r) => (
            <ul className="space-y-4 text-sm">
              {(r.items ?? []).map((n) => (
                <li key={n.noteId} className="flex gap-3" data-testid="case-note" data-masked={n.masked ? 'true' : 'false'}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-bold text-base-content/70" aria-hidden="true">
                    {initial(n.authorId)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-semibold text-base-content/80"><StaffName id={n.authorId} /></span>
                      <span className="text-base-content/50">{when(n.createdAt)}</span>
                    </div>
                    {n.masked ? (
                      <p className="rounded-box border border-dashed border-base-300 px-3 py-2 italic text-base-content/60">{m.maskedLine(text(n.maskedBy), text(n.maskReason))}</p>
                    ) : (
                      <p className="whitespace-pre-wrap rounded-box rounded-tl-none bg-base-200/70 px-3 py-2">{n.text}</p>
                    )}
                    {admin && !n.masked && <MaskForm caseId={caseId} note={n} onDone={refresh} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        {canWrite && (
          <form
            className="space-y-2 border-t border-base-300 pt-4"
            aria-label={m.add}
            onSubmit={(e) => {
              e.preventDefault();
              if (!ok) return;
              if (add.phase.kind === 'rejected' || add.phase.kind === 'done') add.reset();
              void add.run(draft.trim());
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-base-content/60">
              {m.newNote}
              <textarea className="textarea textarea-sm w-full" rows={3} maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-warning">{m.piiHint}</p>
              <p className="text-xs text-base-content/55">{m.noEdit}</p>
              <button type="submit" className="btn btn-sm btn-primary ml-auto" disabled={!ok || add.busy}>
                {m.add}
              </button>
            </div>
            <CommandFeedback command={add}>{() => <span className="text-xs text-success">{m.added}</span>}</CommandFeedback>
          </form>
        )}
      </div>
    </section>
  );
}

/** 운영자 ID 머리글자(op- 앞머리는 뺀다) */
const initial = (id: string | null | undefined) => (id ?? '').replace(/^op-/i, '').charAt(0).toUpperCase() || '?';
