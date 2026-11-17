// 도움요청 상세 보탬(PC 5, 2026-11-17 — #88 위). 모두 execution 계약 그대로:
// - 증빙 사진 `GET /deliveries/{deliveryId}/evidence-photos/{photoRef}` — 토큰이 필요해 받아서 blob → object URL, 화면을 떠나면 해제(no-store, 캐시 안 함).
//   못 받으면 빈칸이 아니라 "불러오지 못함". 사진 내용·URL 은 로그에 남기지 않는다.
// - 처리함 `POST …/resolutions` — OPEN·IN_PROGRESS → RESOLVED. 접수 건(caseId)이 붙은 건 서버가 409 HELP_REQUEST_HAS_CASE 이므로 버튼 대신 접수 건 링크.
//   "닫았어요"는 서버가 돌려준 resolvedAt 으로만. 메모에는 개인정보를 적지 않는다(안내).
// - 가리기 `POST …/messages/{messageId}/maskings` — OPERATOR_ADMIN 만(그 밖 403), 사유 2~500자. 가린 뒤 대화를 다시 읽는다.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { when } from '../../shared/opsUi';

type HelpRequest = components['schemas']['HelpRequest'];

export const helpExtrasMessages = {
  photos: {
    title: (n: number) => `증빙 사진 ${n}장`,
    none: '라이더가 올린 사진이 없어요.',
    unavailable: '사진을 불러오지 못했어요',
    retry: '다시 불러오기',
    alt: (i: number) => `증빙 사진 ${i}`,
    open: (i: number) => `증빙 사진 ${i} 크게 보기`,
    close: '작게',
  },
  resolve: {
    title: '처리',
    button: '처리함으로 닫기',
    hasCase: '접수 건이 붙은 도움요청은 접수 건에서 닫아요.',
    resolved: '이미 처리했어요.',
    confirmTitle: '처리함으로 닫을까요?',
    confirmBody: '이 도움요청을 처리함으로 닫아요. 배송 상태는 바뀌지 않아요. 라이더 앱에는 처리함으로 보여요.',
    noteLabel: '처리 메모(선택, 300자까지)',
    piiHint: '메모에 고객 전화번호·주소·출입 비밀번호를 적지 마세요.',
    cancel: '취소',
    confirm: '닫기',
    done: (at: string) => `닫았어요 · ${at}`,
  },
  mask: {
    button: '가리기',
    reason: '가리는 사유(2~500자)',
    cancel: '취소',
    done: '가렸어요',
    adminOnly: '대화 가리기는 관리자(OPERATOR_ADMIN)만 할 수 있어요.',
  },
} as const;

const m = helpExtrasMessages;
const NOTE_MAX = 300;

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly url: string } | { readonly kind: 'error' };

function usePhotoUrl(deliveryId: string, photoRef: string): readonly [Loaded, () => void] {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ readonly attempt: number; readonly loaded: Loaded } | null>(null);
  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    request('GET', api.execution.GET('/deliveries/{deliveryId}/evidence-photos/{photoRef}', { params: { path: { deliveryId, photoRef } }, parseAs: 'blob' })).then(
      (blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setResult({ attempt, loaded: { kind: 'ready', url } });
      },
      () => {
        if (alive) setResult({ attempt, loaded: { kind: 'error' } });
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, deliveryId, photoRef, attempt]);
  const state: Loaded = result?.attempt === attempt ? result.loaded : { kind: 'loading' };
  return [state, () => setAttempt((n) => n + 1)] as const;
}

function Photo({ deliveryId, photoRef, index }: { readonly deliveryId: string; readonly photoRef: string; readonly index: number }) {
  const [state, retry] = usePhotoUrl(deliveryId, photoRef);
  const [big, setBig] = useState(false);
  if (state.kind === 'loading') return <span className="loading loading-spinner loading-sm" />;
  if (state.kind === 'error')
    return (
      <span className="flex flex-col items-start gap-1 text-xs text-error" data-testid="evidence-photo-error">
        {m.photos.unavailable}
        <button type="button" className="btn btn-ghost btn-xs" onClick={retry}>
          {m.photos.retry}
        </button>
      </span>
    );
  if (big)
    return (
      <figure className="space-y-2 rounded-box bg-base-200 p-3" data-testid="evidence-photo-large">
        <img src={state.url} alt={m.photos.alt(index + 1)} className="max-h-[70vh] max-w-full object-contain" />
        <figcaption className="flex items-center gap-2 text-xs opacity-70">
          {m.photos.alt(index + 1)}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setBig(false)}>
            {m.photos.close}
          </button>
        </figcaption>
      </figure>
    );
  return (
    <button type="button" className="rounded-box border border-base-300" aria-label={m.photos.open(index + 1)} onClick={() => setBig(true)}>
      <img src={state.url} alt={m.photos.alt(index + 1)} className="h-24 w-24 rounded-box object-cover" />
    </button>
  );
}

export function EvidencePhotos({ deliveryId, refs }: { readonly deliveryId: string; readonly refs: readonly string[] }) {
  return (
    <section className="space-y-2" aria-label={m.photos.title(refs.length)}>
      <h2 className="font-bold">{m.photos.title(refs.length)}</h2>
      {refs.length === 0 ? (
        <p className="text-sm opacity-70">{m.photos.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {refs.map((ref, i) => (
            <li key={ref} data-testid="evidence-photo">
              <Photo deliveryId={deliveryId} photoRef={ref} index={i} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ResolvePanel({ help, deliveryId, requestId }: { readonly help: HelpRequest; readonly deliveryId: string; readonly requestId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const resolve = useCommand(async (n: string, key) => {
    const r = await request(
      'POST',
      api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/resolutions', {
        ...commandParams(key, { path: { deliveryId, requestId } }),
        body: n ? { note: n } : {},
      }),
    );
    setOpen(false);
    void client.invalidateQueries({ queryKey: ['help', deliveryId, requestId] });
    void client.invalidateQueries({ queryKey: ['help-queue'] });
    void client.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    return r;
  });
  const done = resolve.phase.kind === 'done';
  return (
    <section className="space-y-2" aria-label={m.resolve.title}>
      <h2 className="font-bold">{m.resolve.title}</h2>
      {help.caseId ? (
        <p className="text-sm opacity-70" data-testid="resolve-has-case">
          {m.resolve.hasCase}{' '}
          <Link className="link font-mono" to={`/cases/${encodeURIComponent(help.caseId)}`}>
            {help.caseId}
          </Link>
        </p>
      ) : help.state === 'RESOLVED' && !done ? (
        <p className="text-sm opacity-70" data-testid="resolve-already">
          {m.resolve.resolved}
        </p>
      ) : (
        !done && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={resolve.busy}
            onClick={() => {
              if (resolve.phase.kind === 'rejected') resolve.reset();
              setOpen(true);
            }}
          >
            {m.resolve.button}
          </button>
        )
      )}
      <CommandFeedback command={resolve}>
        {(r) => (
          <p className="text-sm text-success" data-testid="resolve-done">
            {m.resolve.done(when(r.resolvedAt))}
          </p>
        )}
      </CommandFeedback>
      {open && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-label={m.resolve.confirmTitle}>
          <form
            className="modal-box space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void resolve.run(note.trim());
            }}
          >
            <h3 className="font-bold">{m.resolve.confirmTitle}</h3>
            <p className="text-sm">{m.resolve.confirmBody}</p>
            <label className="flex flex-col gap-1 text-sm">
              {m.resolve.noteLabel}
              <textarea className="textarea textarea-sm w-full" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="text-xs text-warning">{m.resolve.piiHint}</p>
            <div className="modal-action">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                {m.resolve.cancel}
              </button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={resolve.busy}>
                {m.resolve.confirm}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export function MaskMessage({ deliveryId, requestId, messageId }: { readonly deliveryId: string; readonly requestId: string; readonly messageId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mask = useCommand(async (r: string, key) => {
    const res = await request(
      'POST',
      api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages/{messageId}/maskings', {
        ...commandParams(key, { path: { deliveryId, requestId, messageId } }),
        body: { reason: r },
      }),
    );
    void client.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    return res;
  });
  const ok = reason.trim().length >= 2 && reason.trim().length <= 500;
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
        {m.mask.button}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-1"
      aria-label={m.mask.button}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (mask.phase.kind === 'rejected') mask.reset();
        void mask.run(reason.trim());
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {m.mask.reason}
        <input className="input input-xs w-56" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-xs btn-warning" disabled={!ok || mask.busy}>
        {m.mask.button}
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
        {m.mask.cancel}
      </button>
      <CommandFeedback command={mask}>{() => <span className="text-xs text-success">{m.mask.done}</span>}</CommandFeedback>
    </form>
  );
}
