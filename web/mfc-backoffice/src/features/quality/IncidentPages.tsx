// 품질 사고(MB-2 1차 — mfc-quality 0.6.0, 백엔드 회신 clients/mfc-backoffice/2026-11-19-reply-quality-incidents.md). 품질 메뉴의 "품질 사고" 탭.
// 사용자 결정(2026-11-19): 자동(결품 보고 중 파손 DAMAGED 만) + 센터 관리자 직접 등록, 영향 LOT 을 모두 처리한 뒤 관리자가 사유를 적고 닫는다.
// - 목록 `GET /quality-incidents?mfcId=&state=`(비우면 OPEN·DECIDED, 오래된 순) — 열기 = 쿼리 `incidentId`.
// - 직접 등록 `POST /quality-incidents` {kind, description 1~300, affectedLots 1~50}(201) — 이 센터에 재고가 남은 LOT 만(422 LOT_NOT_IN_CENTER).
//   등록은 격리를 걸지 않는다 → 상세에서 LOT 마다 "격리 요청"(격리·해제 탭에 incidentId·LOT 을 채워 보낸다)·"폐기 요청"(같은 LOT 이면 서버가 잇는다).
// - 상태(OPEN → DECIDED → CLOSED)와 남은 LOT 수는 서버 값만(`remainingLotCount`·`affectedLots[].resolved`) — 화면이 세지 않는다.
// - 닫기 `POST …/{id}/closures` {reason}(X-Expected-Version = 사고 version) — 남은 LOT 이면 409 LOTS_NOT_RESOLVED, 버전 다름 409 VERSION_CONFLICT.
// - 고객 영향 case 자동(R6)은 2차 — caseId·affectedOrderCount 가 오면 보이기만.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-quality';
import { useApi } from '../../app/ApiContext';
import { CursorList, useQueryParam } from '../../shared/CursorList';
import { SystemNumbers } from '../../shared/displayNumber';
import { countCell, StatCard, StatStrip } from '../../shared/listParts';
import { LotLabel } from '../../shared/LotLabel';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';

const q = messages.quality;
const m = q.incidents;
const l = messages.lists;
const when = (t: string | null | undefined) => (t ? formatSeoul(t) : messages.none);

type Incident = components['schemas']['QualityIncident'];
type Kind = components['schemas']['IncidentKind'];
const KINDS: readonly Kind[] = ['DAMAGE', 'SPOILAGE', 'CONTAMINATION', 'EXPIRY', 'TEMPERATURE_EXCURSION', 'RECALL', 'OTHER'];
const STATES = ['OPEN', 'DECIDED', 'CLOSED'] as const;
type IncidentState = (typeof STATES)[number];
const MAX_LOTS = 50;

/** 품질 메뉴 "품질 사고" 탭 */
export function IncidentsTab({ mfcId }: { readonly mfcId: string }) {
  const [openId, setOpenId] = useQueryParam('incidentId');
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="opacity-70">{m.intro}</p>
      <IncidentCounts mfcId={mfcId} />
      <IncidentList mfcId={mfcId} />
      <CreateIncident mfcId={mfcId} onCreated={setOpenId} />
      {openId && <IncidentView key={openId} id={openId} />}
    </div>
  );
}

/** 상태 숫자 카드(2026-11-19) — 상태마다 서버 목록 한 쪽(50건)으로 센다, 넘치면 "50건 이상", 실패 "?". 누르면 그 상태로 */
function IncidentCounts({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [state, setState] = useQueryParam('incidentState');
  const count = (s: IncidentState) => ({
    queryKey: ['list', 'quality-incidents', mfcId, 'count', s],
    queryFn: async () => {
      const r = await request('GET', api.quality.GET('/quality-incidents', { params: { query: { mfcId, state: [s], size: 50 } } }));
      return { n: (r.items ?? []).length, more: !!r.nextCursor };
    },
  });
  const open = useQuery(count('OPEN'));
  const decided = useQuery(count('DECIDED'));
  return (
    <StatStrip label={m.countsLabel} testId="incident-counts">
      <StatCard testId="count-OPEN" label={m.state.OPEN} value={countCell(open)} tone={(open.data?.n ?? 0) > 0 ? 'warning' : undefined} hint={m.countHint} active={state === 'OPEN'} onClick={() => setState(state === 'OPEN' ? '' : 'OPEN')} />
      <StatCard testId="count-DECIDED" label={m.state.DECIDED} value={countCell(decided)} tone="info" hint={m.countHint} active={state === 'DECIDED'} onClick={() => setState(state === 'DECIDED' ? '' : 'DECIDED')} />
    </StatStrip>
  );
}

/** 화면 표기(ADR-0070 덧붙임) = 종류 · 연 시각 — 사고 번호(시스템 ID)는 상세의 시스템 번호 칸 */
const incidentTitle = (i: Incident) => `${m.kind[i.kind ?? ''] ?? i.kind ?? messages.none} · ${when(i.openedAt)}`;

function IncidentList({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [state, setState] = useQueryParam('incidentState');
  const [, open] = useQueryParam('incidentId');
  return (
    <CursorList
      title={m.list}
      testId="list-incidents"
      queryKey={['list', 'quality-incidents', mfcId, state]}
      fetchPage={(cursor) =>
        request(
          'GET',
          api.quality.GET('/quality-incidents', { params: { query: { mfcId, ...(state ? { state: [state as IncidentState] } : {}), ...(cursor ? { cursor } : {}) } } }),
        )
      }
      head={[m.col.kind, m.col.state, m.col.origin, m.col.remaining, m.col.openedAt]}
      cells={(i) => [
        m.kind[i.kind ?? ''] ?? i.kind ?? messages.none,
        m.state[i.state ?? ''] ?? i.state ?? messages.none,
        m.origin[i.origin ?? ''] ?? i.origin ?? messages.none,
        i.remainingLotCount === undefined ? messages.none : m.remaining(i.remainingLotCount),
        when(i.openedAt),
      ]}
      rowKey={(i) => i.incidentId ?? ''}
      onOpen={(i) => i.incidentId && open(i.incidentId)}
      emptyText={l.empty}
      states={STATES}
      stateLabels={m.state}
      state={state}
      onState={setState}
    />
  );
}

interface LotInput {
  readonly lotId: string;
  readonly qty: string;
}
const emptyLot: LotInput = { lotId: '', qty: '' };
const lotsValid = (lots: readonly LotInput[]) => lots.length > 0 && lots.length <= MAX_LOTS && lots.every((x) => !!x.lotId.trim() && Number.isInteger(Number(x.qty)) && Number(x.qty) >= 1);

function CreateIncident({ mfcId, onCreated }: { readonly mfcId: string; readonly onCreated: (id: string) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>('DAMAGE');
  const [description, setDescription] = useState('');
  const [lots, setLots] = useState<LotInput[]>([emptyLot]);
  const ok = !!description.trim() && description.trim().length <= 300 && lotsValid(lots);
  const create = useCommand(async (_: null, key) => {
    const r = await request(
      'POST',
      api.quality.POST('/quality-incidents', {
        ...commandParams(key),
        body: { mfcId, kind, description: description.trim(), affectedLots: lots.map((x) => ({ lotId: x.lotId.trim(), qty: Number(x.qty) })) },
      }),
    );
    await queryClient.invalidateQueries({ queryKey: ['list', 'quality-incidents', mfcId] });
    setDescription('');
    setLots([emptyLot]);
    if (r.incidentId) onCreated(r.incidentId);
    return r;
  });
  const set = (i: number, patch: Partial<LotInput>) => setLots(lots.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4"
      aria-label={m.create}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
        void create.run(null);
      }}
    >
      <h2 className="font-semibold">{m.create}</h2>
      <p className="text-xs opacity-70">{m.createHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.col.kind}
          <select className="select select-sm w-32" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {m.kind[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex grow flex-col gap-1">
          {m.description}
          <input className="input input-sm w-full" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {lots.map((x, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={`${m.lots} ${i + 1}`}>
          <label className="flex flex-col gap-1">
            {m.lotId}
            <input className="input input-sm w-40 font-mono" value={x.lotId} onChange={(e) => set(i, { lotId: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.qty}
            <input className="input input-sm w-20" type="number" min={1} step={1} value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          </label>
          {lots.length > 1 && (
            <button type="button" className="btn btn-xs" onClick={() => setLots(lots.filter((_, j) => j !== i))}>
              {m.removeLot}
            </button>
          )}
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn btn-xs" disabled={lots.length >= MAX_LOTS} onClick={() => setLots([...lots, emptyLot])}>
          {m.addLot}
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || create.busy}>
          {m.submit}
        </button>
      </div>
      <CommandFeedback command={create}>{() => <p role="status">{m.created}</p>}</CommandFeedback>
    </form>
  );
}

function IncidentView({ id }: { readonly id: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['quality-incident', id],
    queryFn: () => request('GET', api.quality.GET('/quality-incidents/{incidentId}', { params: { path: { incidentId: id } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(i) => <IncidentDetail incident={i} />}
    </QueryState>
  );
}

function IncidentDetail({ incident: i }: { readonly incident: Incident }) {
  const [params, setParams] = useSearchParams();
  /** 격리·해제 탭으로 — 사고 번호와 LOT 을 채워 판정을 이 사고에 잇는다 */
  const toDecision = (lot: NonNullable<Incident['affectedLots']>[number]) => {
    const next = new URLSearchParams();
    next.set('incidentId', i.incidentId ?? '');
    next.set('lotId', lot.lotId ?? '');
    if (lot.sku) next.set('sku', lot.sku);
    if (lot.qty) next.set('qty', String(lot.qty));
    setParams(next, { replace: true });
  };
  const toDisposal = () => {
    const next = new URLSearchParams(params);
    next.set('tab', 'disposals');
    setParams(next, { replace: true });
  };
  const remaining = i.remainingLotCount ?? 0;
  return (
    <div className="space-y-3 rounded-box bg-base-100 p-4" data-testid="incident">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{incidentTitle(i)}</span>
        <span className={`badge badge-sm ${i.state === 'OPEN' ? 'badge-warning' : i.state === 'DECIDED' ? 'badge-info' : 'badge-ghost'}`}>{m.state[i.state ?? ''] ?? i.state}</span>
        <span className="opacity-70">{m.origin[i.origin ?? ''] ?? i.origin}</span>
      </p>
      {i.description && <p>{i.description}</p>}
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1">
        <dt className="opacity-70">{m.openedAt}</dt>
        <dd>{when(i.openedAt)}</dd>
        {i.origin === 'MANUAL' ? (
          <>
            <dt className="opacity-70">{m.openedBy}</dt>
            <dd>
              <Who id={i.openedBy} />
            </dd>
          </>
        ) : (
          <>
            <dt className="opacity-70">{m.source}</dt>
            <dd className="font-mono text-xs">{[i.sourceEvent, i.sourceRef].filter(Boolean).join(' · ') || messages.none}</dd>
          </>
        )}
        {i.state === 'CLOSED' && (
          <>
            <dt className="opacity-70">{m.closedBy}</dt>
            <dd>
              <Who id={i.closedBy} />
              {` · ${when(i.closedAt)}${i.closeReason ? ` — ${i.closeReason}` : ''}`}
            </dd>
          </>
        )}
        <dt className="opacity-70">{m.caseLabel}</dt>
        <dd>
          {i.caseId ? <span className="font-mono">{i.caseId}</span> : <span className="opacity-70">{m.customerLater}</span>}
          {i.affectedOrderCount != null && ` · ${m.affectedOrders(i.affectedOrderCount)}`}
        </dd>
      </dl>

      <div>
        <h3 className="mb-1 font-semibold">{m.lots}</h3>
        <div className="overflow-x-auto">
        <table className="table table-xs" data-testid="incident-lots">
          <thead>
            <tr>
              <th>{m.lotCol.sku}</th>
              <th>{m.lotCol.lotId}</th>
              <th>{m.lotCol.qty}</th>
              <th>{m.lotCol.resolved}</th>
              <th>{m.lotCol.by}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(i.affectedLots ?? []).map((lot, n) => (
              <tr key={`${lot.lotId ?? ''}-${n}`} data-testid="incident-lot">
                <td className="font-mono">{lot.sku ?? messages.none}</td>
                <td>
                    <LotLabel lotId={lot.lotId} />
                  </td>
                <td>{lot.qty ?? messages.none}</td>
                <td>{lot.resolved ? <span className="text-success">{m.resolved}</span> : <span className="text-warning">{m.unresolved}</span>}</td>
                <td className="font-mono text-xs">{lot.resolvedBy ?? ''}</td>
                <td>
                  {!lot.resolved && i.state !== 'CLOSED' && (
                    <span className="flex gap-1">
                      <button type="button" className="btn btn-xs" onClick={() => toDecision(lot)}>
                        {m.quarantine}
                      </button>
                      <button type="button" className="btn btn-xs" onClick={toDisposal}>
                        {m.disposal}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {(i.decisionIds ?? []).length > 0 && <p className="text-xs">{`${m.decisions}: ${i.decisionIds!.join(', ')}`}</p>}

      {i.state !== 'CLOSED' && (remaining > 0 ? <p className="text-warning">{m.remainingNote(remaining)}</p> : <CloseIncident key={i.version} incident={i} />)}
      <SystemNumbers ids={[{ label: m.col.id, id: i.incidentId }]} />
    </div>
  );
}

function CloseIncident({ incident: i }: { readonly incident: Incident }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const id = i.incidentId ?? '';
  const close = useCommand(async (_: null, key) => {
    const r = await request(
      'POST',
      api.quality.POST('/quality-incidents/{incidentId}/closures', {
        ...commandParams(key, { path: { incidentId: id }, ...(i.version !== undefined ? { version: i.version } : {}) }),
        body: { reason: reason.trim() },
      }),
    );
    await queryClient.invalidateQueries({ queryKey: ['quality-incident', id] });
    await queryClient.invalidateQueries({ queryKey: ['list', 'quality-incidents'] });
    return r;
  });
  const ok = !!reason.trim() && reason.trim().length <= 300;
  return (
    <div className="space-y-2 border-t border-base-200 pt-3">
      <label className="flex flex-col gap-1">
        {m.closeReason}
        <input className="input input-sm w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {confirming ? (
        <div role="alertdialog" aria-label={m.close} className="space-y-1 rounded-box bg-base-200 p-2">
          <p>{m.closeConfirm}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-xs btn-primary"
              onClick={() => {
                setConfirming(false);
                if (close.phase.kind === 'rejected' || close.phase.kind === 'done') close.reset();
                void close.run(null);
              }}
            >
              {m.closeOk}
            </button>
            <button type="button" className="btn btn-xs" onClick={() => setConfirming(false)}>
              {m.closeCancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sm" disabled={!ok || close.busy || close.phase.kind === 'unknown'} onClick={() => setConfirming(true)}>
          {m.close}
        </button>
      )}
      <CommandFeedback command={close}>{() => <p role="status">{m.closed}</p>}</CommandFeedback>
    </div>
  );
}
