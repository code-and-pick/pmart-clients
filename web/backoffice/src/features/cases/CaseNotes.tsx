// 접수 건 메모(case 0.10.0 — 백엔드 요청 backoffice/2026-11-16-request-case-notes, PR #43).
// - `GET /cases/{id}/notes`(오래된 것부터, 가린 메모는 text null·masked true), `POST /cases/{id}/notes` {text 1~500} — 볼 수 있는 본사 직원(관리자·지원센터·상담원).
//   처리 끝난 접수 건에도 남길 수 있다(상태 그대로). 고치기·지우기 없음.
// - 가림 `POST …/notes/{noteId}/maskings` {reason} — 관리자만(버튼도 관리자에게만). 가린 메모는 내용 없이 "가린 메모"·가린 사람·사유.
// - 메모는 직원이 쓴 글 — 화면에만(로그 없음). 입력란에 "개인정보(전화번호·주소)는 쓰지 마세요"(요청서).
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
  const cmd = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/notes/{noteId}/maskings', { ...commandParams(key, { path: { caseId, noteId: note.noteId ?? '' } }), body: { reason: reason.trim() } }),
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
        void cmd.run(null);
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
  const add = useCommand(async (_v: null, k) => {
    const r = await request('POST', api.cases.POST('/cases/{caseId}/notes', { ...commandParams(k, { path: { caseId } }), body: { text: draft.trim() } }));
    setDraft('');
    refresh();
    return r;
  });
  const ok = draft.trim().length >= 1 && draft.trim().length <= 500;
  return (
    <section className="space-y-2" aria-label={m.title}>
      <h2 className="font-bold">{m.title}</h2>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => (
          <ul className="space-y-1 text-sm">
            {(r.items ?? []).map((n) => (
              <li key={n.noteId} className="space-y-1 rounded-box border border-base-300 bg-base-100 p-2" data-testid="case-note" data-masked={n.masked ? 'true' : 'false'}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
                  <span>{when(n.createdAt)}</span>
                  <span className="font-mono">{text(n.authorId)}</span>
                </div>
                {n.masked ? (
                  <p className="italic text-base-content/60">{m.maskedLine(text(n.maskedBy), text(n.maskReason))}</p>
                ) : (
                  <p className="whitespace-pre-wrap">{n.text}</p>
                )}
                {admin && !n.masked && <MaskForm caseId={caseId} note={n} onDone={refresh} />}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {canWrite && (
        <form
          className="space-y-1"
          aria-label={m.add}
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            if (add.phase.kind === 'rejected' || add.phase.kind === 'done') add.reset();
            void add.run(null);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {m.newNote}
            <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <p className="text-xs text-warning">{m.piiHint}</p>
          <p className="text-xs text-base-content/60">{m.noEdit}</p>
          <button type="submit" className="btn btn-sm" disabled={!ok || add.busy}>
            {m.add}
          </button>
          <CommandFeedback command={add}>{() => <span className="text-xs text-success">{m.added}</span>}</CommandFeedback>
        </form>
      )}
    </section>
  );
}
