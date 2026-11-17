// 운영 제한 — mfc-capacity-service 0.14.0 `/operation-restrictions*`(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "접수 중지·수용 축소 등록·해제").
// - 목록 `GET /operation-restrictions?mfcId=&activeOnly=`(기본 활성만 — 서버 기본과 같음). 거르기는 URL 쿼리(`all=1` 이면 activeOnly=false).
// - 등록 `POST /operation-restrictions`(MFC_SUPERVISOR, approvalRef 필수, CAPACITY_REDUCE 는 reducedCapacityUnits 필수) → 201 CommandResponse.
// - 해제 `DELETE /operation-restrictions/{id}?approvalRef=` + X-Expected-Version → 202 CommandResponse. 시간이 지나도 자동 해제 없음.
// 승인 근거(approvalRef)는 화면에서 직접 입력(사용자 2026-11-16 — 승인 서비스가 없어 서버는 기록만). 시각 입력은 한국 시간 + "+09:00".
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { CommandRejectedFailure, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const m = messages.restrictions;

type Restriction = components['schemas']['OperationRestriction'];
type RestrictionType = NonNullable<Restriction['restrictionType']>;

const seoulInput = (v: string) => `${v}:00+09:00`;

function checkCommand(r: CommandResponse): CommandResponse {
  if (r.status === 'REJECTED') throw new CommandRejectedFailure(r.nextAction, r.requestId);
  if (r.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(r.status, r.requestId);
  return r;
}

/** `/c/:mfcId/restrictions/*` */
export function RestrictionsMenu({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const all = params.get('all') === '1';
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['restrictions', mfcId, all],
    queryFn: async () =>
      (await request('GET', api.capacity.GET('/operation-restrictions', { params: { query: { mfcId, ...(all ? { activeOnly: false } : {}) } } }))).items ?? [],
  });
  return (
    <section className="max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">{messages.menus.restrictions}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      {notice && (
        <p role="status" className="text-success text-sm">
          {notice}
        </p>
      )}
      <label className="flex w-fit flex-col gap-1 rounded-box bg-base-100 p-3 text-sm">
        {m.filter}
        <select className="select select-sm w-40" value={all ? '1' : ''} onChange={(e) => setParams(e.target.value ? { all: '1' } : {}, { replace: true })}>
          <option value="">{m.activeOnly}</option>
          <option value="1">{m.all}</option>
        </select>
      </label>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(rows) => (
          <div className="space-y-2">
            {rows.map((r) => (
              <RestrictionCard key={`${r.restrictionId ?? ''}-${r.version ?? 0}`} mfcId={mfcId} restriction={r} onDone={setNotice} />
            ))}
          </div>
        )}
      </QueryState>
      <CreateRestriction mfcId={mfcId} onDone={setNotice} />
    </section>
  );
}

function RestrictionCard({ mfcId, restriction: r, onDone }: { readonly mfcId: string; readonly restriction: Restriction; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = r.restrictionId ?? '';
  const [approvalRef, setApprovalRef] = useState('');
  const lift = useCommand(async (_: null, key) => {
    onDone(null);
    const { params } = commandParams(key, { path: { restrictionId: id }, version: r.version });
    const res = checkCommand(
      await request('DELETE', api.capacity.DELETE('/operation-restrictions/{restrictionId}', { params: { ...params, query: { approvalRef: approvalRef.trim() } } })),
    );
    // 접수(ACCEPTED)면 목록을 다시 읽어 상태로 보인다 — 완료 문구는 APPLIED 일 때만
    if (res.status === 'APPLIED') onDone(m.lifted);
    await queryClient.invalidateQueries({ queryKey: ['restrictions', mfcId] });
    return res;
  });
  const c = m.cols;
  const typeName = m.type[r.restrictionType ?? ''] ?? r.restrictionType ?? '';
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4 text-sm" data-testid="restriction">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{typeName}</span>
        <span className={`badge badge-sm ${r.state === 'ACTIVE' ? 'badge-warning' : 'badge-ghost'}`}>{m.state[r.state ?? ''] ?? r.state}</span>
        <span className="font-mono opacity-70">{r.restrictionId}</span>
      </p>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1">
        <dt className="opacity-70">{c.period}</dt>
        <dd>{m.period(r.effectiveFrom ? formatSeoul(r.effectiveFrom) : messages.none, r.effectiveTo ? formatSeoul(r.effectiveTo) : m.noEnd)}</dd>
        {r.restrictionType === 'CAPACITY_REDUCE' && (
          <>
            <dt className="opacity-70">{c.units}</dt>
            <dd>{r.reducedCapacityUnits ?? messages.none}</dd>
          </>
        )}
        <dt className="opacity-70">{c.reason}</dt>
        <dd>{r.reason || messages.none}</dd>
        <dt className="opacity-70">{c.approval}</dt>
        <dd>{`${r.approvalRef ?? messages.none}${r.liftApprovalRef ? ` / ${r.liftApprovalRef}` : ''}`}</dd>
        <dt className="opacity-70">{c.affected}</dt>
        <dd>{r.affectedOrderIds?.length ? r.affectedOrderIds.join(', ') : messages.none}</dd>
      </dl>
      {r.state === 'ACTIVE' && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-base-200 pt-3"
          aria-label={`${m.lift} ${id}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!approvalRef.trim()) return;
            if (lift.phase.kind === 'rejected') lift.reset();
            void lift.run(null);
          }}
        >
          <label className="flex flex-col gap-1">
            {m.liftRef(typeName)}
            <input className="input input-sm w-56 font-mono" maxLength={128} value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm btn-warning" disabled={!approvalRef.trim() || lift.busy}>
            {m.lift}
          </button>
          <div className="w-full">
            <CommandFeedback command={lift} />
          </div>
        </form>
      )}
    </div>
  );
}

function CreateRestriction({ mfcId, onDone }: { readonly mfcId: string; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [type, setType] = useState<RestrictionType>('INTAKE_STOP');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [units, setUnits] = useState('');
  const [reason, setReason] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const endBeforeStart = !!from && !!to && to <= from;
  const unitsOk = type === 'INTAKE_STOP' || (units !== '' && Number.isInteger(Number(units)) && Number(units) >= 0);
  const valid = !!from && !endBeforeStart && unitsOk && !!approvalRef.trim();
  const create = useCommand(async (_: null, key) => {
    onDone(null);
    const r = checkCommand(
      await request(
        'POST',
        api.capacity.POST('/operation-restrictions', {
          ...commandParams(key),
          body: {
            mfcId,
            restrictionType: type,
            approvalRef: approvalRef.trim(),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            effectiveFrom: seoulInput(from),
            effectiveTo: to ? seoulInput(to) : null,
            ...(type === 'CAPACITY_REDUCE' ? { reducedCapacityUnits: Number(units) } : {}),
          },
        }),
      ),
    );
    if (r.status === 'APPLIED') onDone(m.created);
    await queryClient.invalidateQueries({ queryKey: ['restrictions', mfcId] });
    setFrom('');
    setTo('');
    setUnits('');
    setReason('');
    setApprovalRef('');
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.create}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
        void create.run(null);
      }}
    >
      <h2 className="font-semibold">{m.create}</h2>
      <p className="text-xs opacity-70">{m.createHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.typeLabel}
          <select className="select select-sm w-32" value={type} onChange={(e) => setType(e.target.value as RestrictionType)}>
            <option value="INTAKE_STOP">{m.type.INTAKE_STOP}</option>
            <option value="CAPACITY_REDUCE">{m.type.CAPACITY_REDUCE}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.effectiveFrom}
          <input className="input input-sm w-56" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.effectiveTo}
          <input className="input input-sm w-56" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {type === 'CAPACITY_REDUCE' && (
          <label className="flex flex-col gap-1">
            {m.units}
            <input className="input input-sm w-24" type="number" min={0} step={1} value={units} onChange={(e) => setUnits(e.target.value)} />
          </label>
        )}
      </div>
      {endBeforeStart && <p className="text-error text-xs">{m.endBeforeStart}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.reason}
          <input className="input input-sm w-72" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.approvalRef}
          <input className="input input-sm w-56 font-mono" maxLength={128} value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} />
          <span className="text-xs opacity-70">{m.approvalRefHint}</span>
        </label>
      </div>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || create.busy}>
        {m.create}
      </button>
      <CommandFeedback command={create} />
    </form>
  );
}
