// Wave 조작(cdc-outbound 0.22.0 — 사용자 2026-11-26 "바로 할 수 있는 것부터"): 보류·보류 풀기·취소·합치기·나누기 + 조작 이력.
// - `POST /waves/{waveId}/holds {reason}`(PLANNED·RELEASED·IN_PROGRESS — 보류 중엔 릴리스·다음 작업 받기 막음, 받은·시작한 작업은 그대로)
// - `…/resumptions`, `…/cancellations {reason}`(PLANNED 또는 시작·실적 없는 RELEASED — 실적 있으면 409 PICKING_STARTED)
// - `…/merges {sourceWaveId}`(둘 다 PLANNED·같은 온도대 — 원 Wave CANCELLED), `…/splits {trfIds}`(PLANNED, 하나 이상 남김 — 201 새 Wave)
// - `GET …/adjustments`(이력). 모두 X-Expected-Version. 결과는 Wave 를 다시 읽어 서버 상태로 보인다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';

const c = messages.waveOps;
type Wave = components['schemas']['Wave'];
type Action = 'hold' | 'resume' | 'cancel' | 'merge' | 'split';

const waveLabel = (x: { readonly waveId?: string; readonly waveNumber?: string | null }) => x.waveNumber ?? x.waveId ?? '';

/** 이 Wave 상태에서 할 수 있는 조작(판정은 서버 — 버튼은 계약 조건만) */
export function allowed(v: Wave): readonly Action[] {
  const st = v.state ?? '';
  const out: Action[] = [];
  if (v.hold) out.push('resume');
  else if (['PLANNED', 'RELEASED', 'IN_PROGRESS'].includes(st)) out.push('hold');
  if (st === 'PLANNED' || st === 'RELEASED') out.push('cancel');
  if (st === 'PLANNED') out.push('merge');
  if (st === 'PLANNED' && (v.trfIds ?? []).length > 1) out.push('split');
  return out;
}

export function WaveControls({ cdcId, wave, onChanged, newWavePath }: { readonly cdcId: string; readonly wave: Wave; readonly onChanged: () => void; readonly newWavePath: (waveId: string) => string }) {
  const api = useApi();
  const waveId = wave.waveId ?? '';
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const acts = allowed(wave);
  const planned = useQuery({
    enabled: action === 'merge',
    queryKey: ['cdc', cdcId, 'waves', 'PLANNED', 'merge'],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { state: 'PLANNED', size: 100 } } })),
  });
  const cmd = useCommand(async (v: { readonly action: Action; readonly version: number | undefined }, key) => {
    const p = commandParams(key, { path: { waveId }, version: v.version });
    const r = reason.trim();
    switch (v.action) {
      case 'hold':
        return request('POST', api.outbound.POST('/waves/{waveId}/holds', { ...p, body: { reason: r } }));
      case 'resume':
        return request('POST', api.outbound.POST('/waves/{waveId}/resumptions', { ...p, body: r ? { reason: r } : {} }));
      case 'cancel':
        return request('POST', api.outbound.POST('/waves/{waveId}/cancellations', { ...p, body: { reason: r } }));
      case 'merge':
        return request('POST', api.outbound.POST('/waves/{waveId}/merges', { ...p, body: { sourceWaveId: source, ...(r ? { reason: r } : {}) } }));
      case 'split':
        return request('POST', api.outbound.POST('/waves/{waveId}/splits', { ...p, body: { trfIds: [...picked], ...(r ? { reason: r } : {}) } }));
    }
  });
  const needReason = action === 'hold' || action === 'cancel';
  const trfIds = wave.trfIds ?? [];
  const ready =
    action !== null &&
    (!needReason || reason.trim().length > 0) &&
    (action !== 'merge' || source !== '') &&
    (action !== 'split' || (picked.length > 0 && picked.length < trfIds.length));
  const open = (a: Action) => {
    setAction(action === a ? null : a);
    setReason('');
    setSource('');
    setPicked([]);
  };
  return (
    <div className="space-y-3" data-testid="wave-controls">
      {wave.hold && (
        <div role="note" className="alert alert-warning text-sm" data-testid="wave-held">
          <span>
            {c.heldNote(wave.hold.reason, formatSeoul(wave.hold.heldAt))} <Who id={wave.hold.heldBy} />
          </span>
        </div>
      )}
      {acts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {acts.map((a) => (
            <button key={a} type="button" className={`btn btn-sm ${action === a ? (a === 'cancel' ? 'btn-error' : 'btn-primary') : ''}`} onClick={() => open(a)} data-testid={`wave-op-${a}`}>
              {c.actions[a]}
            </button>
          ))}
        </div>
      )}
      {action && (
        <form
          className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void cmd.run({ action, version: wave.version }).then((phase) => {
              if (phase.kind === 'done') {
                setAction(null);
                onChanged();
              }
            });
          }}
          data-testid="wave-op-form"
        >
          <p className="text-sm">{c.hint[action]}</p>
          {action === 'merge' && (
            <label className="flex flex-col gap-1 text-sm">
              {c.mergeFrom}
              <select className="select select-sm w-80" value={source} onChange={(e) => setSource(e.target.value)} data-testid="wave-merge-source">
                <option value="">{c.choose}</option>
                {(planned.data?.items ?? [])
                  .filter((x) => x.waveId !== waveId)
                  .map((x) => (
                    <option key={x.waveId} value={x.waveId}>
                      {`${waveLabel(x)} · TRF ${(x.trfIds ?? []).length}${x.createdAt ? ` · ${formatSeoul(x.createdAt)}` : ''}`}
                    </option>
                  ))}
              </select>
              {planned.isError && <span className="text-xs text-error">{messages.loadFailed}</span>}
              {planned.data && planned.data.items.filter((x) => x.waveId !== waveId).length === 0 && <span className="text-xs text-base-content/60">{c.noOther}</span>}
            </label>
          )}
          {action === 'split' && (
            <fieldset className="space-y-1">
              <legend className="text-sm">{c.splitPick}</legend>
              {trfIds.map((id, i) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={picked.includes(id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))}
                    data-testid={`wave-split-${id}`}
                  />
                  <span className="font-mono text-xs">{wave.trfNumbers?.[i] ?? id}</span>
                </label>
              ))}
              {picked.length >= trfIds.length && <p className="text-xs text-error">{c.splitKeepOne}</p>}
            </fieldset>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {needReason ? c.reasonRequired : c.reason}
            <input className="input input-sm w-full max-w-md" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="wave-op-reason" />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={`btn btn-sm ${action === 'cancel' ? 'btn-error' : 'btn-primary'}`} disabled={!ready || cmd.busy} data-testid="wave-op-go">
              {c.actions[action]}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction(null)}>
              {messages.wave.cancel}
            </button>
          </div>
        </form>
      )}
      <CommandFeedback command={cmd}>
        {(r) =>
          r.waveId && r.waveId !== waveId ? (
            <p role="status" className="alert alert-success text-sm">
              {c.splitDone} <Link className="link" to={newWavePath(r.waveId)}>{waveLabel(r)}</Link>
            </p>
          ) : (
            <p role="status" className="alert alert-info text-sm">
              {c.done}
            </p>
          )
        }
      </CommandFeedback>
      <WaveHistory waveId={waveId} />
    </div>
  );
}

function WaveHistory({ waveId }: { readonly waveId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    enabled: open,
    queryKey: ['cdc', 'wave', waveId, 'adjustments'],
    queryFn: () => request('GET', api.outbound.GET('/waves/{waveId}/adjustments', { params: { path: { waveId } } })),
  });
  return (
    <details className="text-sm" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="wave-history">
      <summary className="cursor-pointer text-xs text-base-content/60">{c.history}</summary>
      {open && (
        <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={c.historyEmpty}>
          {(d) => (
            <ul className="mt-2 space-y-1 text-xs">
              {d.items.map((a) => (
                <li key={a.adjustmentId} className="flex flex-wrap gap-2">
                  <span className="text-base-content/60">{formatSeoul(a.adjustedAt)}</span>
                  <span className="font-semibold">{c.historyAction[a.action] ?? a.action}</span>
                  <span>{`${messages.wave.state[a.fromState] ?? a.fromState} → ${messages.wave.state[a.toState] ?? a.toState}`}</span>
                  {a.otherWaveId && <span className="font-mono">{a.otherWaveId}</span>}
                  {a.reason && <span>{a.reason}</span>}
                  <Who id={a.actorId} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      )}
    </details>
  );
}
