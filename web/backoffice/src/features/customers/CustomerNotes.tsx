// 고객 상담 메모(case 0.34.0 R-13, 2026-11-23 — 사용자 "상담메모는 상담사가 쓸 수 있겠지. 수정은 적은 사람만 가능하고 삭제도 적은 사람만 가능함").
// - 목록 `GET /customer-notes?customerId=`(최근 것부터, 지운 것 빼고) — 상담원·관리자(그 밖 403). 고친 메모는 editedAt.
// - 쓰기 `POST /customer-notes` {customerId, text 1~1000} — 상담원(CS_AGENT)만. 관리자는 보기만.
// - 고치기 `POST /customer-notes/{id}/revisions`·지우기 `…/deletions` — 쓴 사람만(관리자도 403). 단추는 authorId = 내 운영자 ID 인 줄에만(판단은 서버).
//   지우기는 브라우저 확인 창 대신 줄 안에서 한 번 더 묻는다. 지운 메모는 목록에서 빠진다.
// - 메모는 직원이 쓴 글 — 화면에만(로그 없음). 입력란에 "개인정보는 쓰지 마세요".
// bff 0.26.0 customerNotes(백엔드 PR #372)가 들어오면 상세 응답 칸으로 바꿀 수 있다 — 지금은 case 를 바로 부른다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { StaffName } from '../lookup/parts';
import { messages } from '../../shared/messages';
import { when } from '../../shared/ops';

const m = messages.customerNotes;
type Note = components['schemas']['CustomerNote'];
const MAX = 1000;
const okText = (s: string) => s.trim().length >= 1 && s.trim().length <= MAX;

function NoteRow({ note, mine, onChanged }: { readonly note: Note; readonly mine: boolean; readonly onChanged: () => void }) {
  const api = useApi();
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const [draft, setDraft] = useState(note.text ?? '');
  const revise = useCommand(async (_v: null, key) => {
    const r = await request('POST', api.cases.POST('/customer-notes/{noteId}/revisions', { ...commandParams(key, { path: { noteId: note.noteId } }), body: { text: draft.trim() } }));
    setMode('view');
    onChanged();
    return r;
  });
  const remove = useCommand(async (_v: null, key) => {
    const r = await request('POST', api.cases.POST('/customer-notes/{noteId}/deletions', { ...commandParams(key, { path: { noteId: note.noteId } }) }));
    onChanged();
    return r;
  });
  return (
    <li className="space-y-1" data-testid="customer-note" data-mine={mine ? 'true' : 'false'}>
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-semibold text-base-content/80">
          <StaffName id={note.authorId} />
        </span>
        <span className="text-base-content/50">{when(note.createdAt)}</span>
        {note.editedAt && <span className="text-base-content/50" title={when(note.editedAt)}>{m.edited}</span>}
        {mine && mode === 'view' && (
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setDraft(note.text ?? '');
                revise.reset();
                setMode('edit');
              }}
            >
              {m.edit}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => {
                remove.reset();
                setMode('delete');
              }}
            >
              {m.remove}
            </button>
          </span>
        )}
      </div>
      {mode === 'edit' ? (
        <form
          className="space-y-2"
          aria-label={m.edit}
          onSubmit={(e) => {
            e.preventDefault();
            if (!okText(draft)) return;
            if (revise.phase.kind === 'rejected') revise.reset();
            void revise.run(null);
          }}
        >
          <textarea className="textarea textarea-sm w-full" rows={3} maxLength={MAX} aria-label={m.editLabel} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-sm btn-primary" disabled={!okText(draft) || revise.busy}>
              {m.save}
            </button>
            <button type="button" className="btn btn-sm" disabled={revise.busy} onClick={() => setMode('view')}>
              {m.cancel}
            </button>
          </div>
          <CommandFeedback command={revise} />
        </form>
      ) : (
        <p className="whitespace-pre-wrap rounded-box rounded-tl-none bg-base-200/70 px-3 py-2 text-sm">{note.text}</p>
      )}
      {mode === 'delete' && (
        <div className="flex flex-wrap items-center gap-2 rounded-box border border-error/30 bg-error/5 px-3 py-2 text-xs" role="group" aria-label={m.remove}>
          <span>{m.removeAsk}</span>
          <button type="button" className="btn btn-xs btn-error" disabled={remove.busy} onClick={() => void remove.run(null)}>
            {m.removeConfirm}
          </button>
          <button type="button" className="btn btn-xs" disabled={remove.busy} onClick={() => setMode('view')}>
            {m.cancel}
          </button>
          <CommandFeedback command={remove} />
        </div>
      )}
    </li>
  );
}

/** 고객 상세의 "상담 메모" 칸 — 고객 상세는 상담원·관리자만 연다 */
export function CustomerNotes({ customerId }: { readonly customerId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const canWrite = session?.roles.includes('CS_AGENT') ?? false;
  const key = ['customers', 'notes', customerId];
  const query = useQuery({ queryKey: key, queryFn: () => request('GET', api.cases.GET('/customer-notes', { params: { query: { customerId, size: 50 } } })) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const [draft, setDraft] = useState('');
  const add = useCommand(async (_v: null, k) => {
    const r = await request('POST', api.cases.POST('/customer-notes', { ...commandParams(k), body: { customerId, text: draft.trim() } }));
    setDraft('');
    refresh();
    return r;
  });
  const items = query.data?.items ?? [];
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.title} data-testid="customer-notes">
      <div className="flex items-center gap-2 border-b border-base-300 px-5 py-3">
        <h2 className="font-semibold">{m.title}</h2>
        {query.data && (
          <span className="badge badge-ghost badge-sm">
            {items.length}
            {query.data.page?.nextCursor ? '+' : ''}
          </span>
        )}
        {query.data?.page?.nextCursor && <span className="ml-auto text-xs text-base-content/60">{m.recentOnly}</span>}
      </div>
      <div className="space-y-4 px-5 py-4">
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
          {(r) => (
            <ul className="space-y-4">
              {(r.items ?? []).map((n) => (
                <NoteRow key={n.noteId} note={n} mine={!!session && n.authorId === session.subject} onChanged={refresh} />
              ))}
            </ul>
          )}
        </QueryState>
        {canWrite ? (
          <form
            className="space-y-2 border-t border-base-300 pt-4"
            aria-label={m.add}
            onSubmit={(e) => {
              e.preventDefault();
              if (!okText(draft)) return;
              if (add.phase.kind === 'rejected' || add.phase.kind === 'done') add.reset();
              void add.run(null);
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-base-content/60">
              {m.newNote}
              <textarea className="textarea textarea-sm w-full" rows={3} maxLength={MAX} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-warning">{m.piiHint}</p>
              <p className="text-xs text-base-content/55">{m.ownOnly}</p>
              <button type="submit" className="btn btn-sm btn-primary ml-auto" disabled={!okText(draft) || add.busy}>
                {m.add}
              </button>
            </div>
            <CommandFeedback command={add}>{() => <span className="text-xs text-success">{m.added}</span>}</CommandFeedback>
          </form>
        ) : (
          <p className="border-t border-base-300 pt-3 text-xs text-base-content/55" data-testid="customer-notes-readonly">
            {m.readOnly}
          </p>
        )}
      </div>
    </section>
  );
}
