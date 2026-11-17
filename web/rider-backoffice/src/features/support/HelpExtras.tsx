// 도움요청 상세 보탬(PC 5, 2026-11-17 — #88 위). 모두 execution 계약 그대로:
// - 증빙 사진 `GET /deliveries/{deliveryId}/evidence-photos/{photoRef}` — 공통 AuthedPhotos(토큰 붙여 받기·해제·못 받으면 "불러오지 못함").
// - 처리함 `POST …/resolutions` — OPEN·IN_PROGRESS → RESOLVED. 접수 건(caseId)이 붙은 건 서버가 409 HELP_REQUEST_HAS_CASE 이므로 버튼 대신 접수 건 링크.
//   "닫았어요"는 서버가 돌려준 resolvedAt 으로만. 메모에는 개인정보를 적지 않는다(안내).
// - 가리기 `POST …/messages/{messageId}/maskings` — OPERATOR_ADMIN 만(그 밖 403), 사유 2~500자. 가린 뒤 대화를 다시 읽는다.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { useEvidenceLoader } from '../../shared/evidenceLoader';
import { when } from '../../shared/opsUi';

type HelpRequest = components['schemas']['HelpRequest'];

export const helpExtrasMessages = {
  photos: { label: '증빙 사진', inquiryLabel: '문의 사진' },
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

export function EvidencePhotos({ deliveryId, refs }: { readonly deliveryId: string; readonly refs: readonly string[] }) {
  const load = useEvidenceLoader(deliveryId);
  return <AuthedPhotos refs={refs} load={load} label={m.photos.label} />;
}

/** 라이더 문의 사진(case 0.14.0) — `GET /inquiry-photos/{photoId}`(RIDER_OPS·OPERATOR_ADMIN 은 라이더 문의 사진을 본다, 공유 캐시 금지) */
export function InquiryPhotos({ photoIds }: { readonly photoIds: readonly string[] }) {
  const api = useApi();
  const load = useCallback(
    (photoId: string) => request('GET', api.cases.GET('/inquiry-photos/{photoId}', { params: { path: { photoId } }, parseAs: 'blob' })),
    [api],
  );
  return <AuthedPhotos refs={photoIds} load={load} label={m.photos.inquiryLabel} />;
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
