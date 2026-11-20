// 재고 — mfc-inventory-service 0.16.0(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "센터 재고 조회, 위치·LOT 정정, 순환 실사, 보충 기준, 출하 부적격 LOT, 상품 취급").
// 탭(URL 쿼리 `tab`): 상품별 재고(기본) · 순환 실사 · 출하 부적격 LOT · 보충 기준 · 상품 취급.
// - 센터 전체 재고 `GET /mfcs/{id}/stock-units`(inventory 0.26.0, MB-1 — 품질·위치 거르기, 열기 = 상품별 재고). 상품별 재고 `GET /mfcs/{id}/stock?sku=`. 단위 행마다 정정 `POST …/stock-corrections`(201 CommandResponse, approvalRef 선택 — 없으면 422 APPROVAL_REQUIRED 흐름).
// - 실사: 시작 `POST …/count-sessions`(실사 잠금 칸만 — 409 LOCATION_NOT_LOCKED), 목록 `GET …/count-sessions?state=`(기본 승인 대기, MB-1)·조회 `GET …/count-sessions/{id}`,
//   승인·반려 `POST …/approvals`(APPROVE 는 approvalRef 필수, 시작·계수한 사람 불가 — 422 SELF_APPROVAL). 계수는 PDA.
// - 출하 부적격 LOT `GET …/unshippable-lots` → 이동 지시로(이동 메뉴에 값을 채워 연다).
// - 보충 기준 `GET/PUT/DELETE …/replenishment-policies`(고회전 선반만, min ≤ target).
// - 상품 취급 `GET/POST …/sku-handlings`(X-Expected-Version = 취급 레코드 version, 없으면 0). 권한 = 그 센터 관리자·그 센터 권한 MD(지금대로, 사용자 2026-11-19).
//   0.27.0: 본사 단종(offReason DISCONTINUED)은 모든 센터에서 꺼지고 켜기 막힘(409 SKU_DISCONTINUED), 신상품(정한 적 없음)은 맨 위 배너로 안내(자동으로 켜지 않음).
// 본사 승인 번호(approvalRef)는 선택(AP-1, 0.22.0) — 기준 이상이면 422 APPROVAL_REQUIRED(shared/approval.tsx). 정정은 승인 뒤 같은 Idempotency-Key 로 다시.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { CommandRejectedFailure, type IdempotencyKey, request, requestNoContent, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-inventory';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { ApprovalAwareFeedback, ApprovalRefInput, approvalRequired } from '../../shared/approval';
import { LotLabel } from '../../shared/LotLabel';
import { SystemNumbers } from '../../shared/displayNumber';
import { GuideBox } from '../../shared/listParts';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { CountSessionList, StockUnitList } from '../lists/CenterLists';

const m = messages.inventory;
const mv = messages.moves;

type Inv = components['schemas'];
type StockUnit = Inv['CenterStock']['units'][number];
type CountSession = Inv['CountSession'];
type SkuHandling = Inv['SkuHandling'];

type Tab = 'stock' | 'counts' | 'unshippable' | 'policies' | 'handlings';
const TABS: readonly Tab[] = ['stock', 'counts', 'unshippable', 'policies', 'handlings'];

/** CommandResponse 를 확정으로: REJECTED 는 거절, UNKNOWN_RESULT 는 결과 불명(같은 키) */
function checkCommand(r: CommandResponse): CommandResponse {
  if (r.status === 'REJECTED') throw new CommandRejectedFailure(r.nextAction, r.requestId);
  if (r.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(r.status, r.requestId);
  return r;
}

/** `/c/:mfcId/inventory/*` */
export function InventoryMenu({ mfcId }: { readonly mfcId: string }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'stock';
  return (
    <section className="space-y-4">
      <h1>{messages.menus.inventory}</h1>
      <GuideBox title={messages.listParts.guideOf(messages.menus.inventory)} storeKey="inventory" items={[m.intro]} />
      <div role="tablist" className="tabs tabs-box w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'tab-active' : ''}`}
            onClick={() => setParams(t === 'stock' ? {} : { tab: t }, { replace: true })}
          >
            {m.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'stock' && <StockTab mfcId={mfcId} />}
      {tab === 'counts' && <CountsTab mfcId={mfcId} />}
      {tab === 'unshippable' && <UnshippableTab mfcId={mfcId} />}
      {tab === 'policies' && <PoliciesTab mfcId={mfcId} />}
      {tab === 'handlings' && <HandlingsTab mfcId={mfcId} />}
    </section>
  );
}

function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get(key) ?? '',
    (v) => {
      const next = new URLSearchParams(params);
      if (v) next.set(key, v);
      else next.delete(key);
      setParams(next, { replace: true });
    },
  ];
}

function LookupForm({ label, value, button, onSubmit }: { readonly label: string; readonly value: string; readonly button: string; readonly onSubmit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v.trim().toUpperCase());
      }}
    >
      <label className="flex flex-col gap-1">
        {label}
        <input className="input input-sm w-48 font-mono" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!v.trim()}>
        {button}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- 상품별 재고 + 정정

function StockTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [sku, setSku] = useParam('sku');
  const [editing, setEditing] = useState<StockUnit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['stock', mfcId, sku],
    enabled: !!sku,
    queryFn: () => request('GET', api.inventory.GET('/mfcs/{mfcId}/stock', { params: { path: { mfcId }, query: { sku } } })),
  });
  const l = m.lot;
  const u = m.unit;
  return (
    <div className="space-y-3 text-sm">
      <StockUnitList mfcId={mfcId} />
      <LookupForm key={sku} label={m.sku} value={sku} button={m.lookup} onSubmit={setSku} />
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      {sku && (
        <QueryState state={toUiState(query, (s) => s.units.length === 0 && s.lots.length === 0)} onRetry={() => void query.refetch()} emptyText={m.stockEmpty}>
          {(s) => (
            <div className="space-y-3">
              <div className="rounded-box bg-base-100 p-4">
                <h2 className="mb-2 font-semibold">{m.lots}</h2>
                <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      {[l.lotId, l.tracking, l.expiry, l.manufacture, l.onHand, l.quarantined, l.sellable, l.reserved, l.available].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.lots.map((lot) => (
                      <tr key={lot.lotId} data-testid="lot-row">
                        <td>
                    <LotLabel lotId={lot.lotId} />
                  </td>
                        <td>{m.tracking[lot.tracking ?? ''] ?? lot.tracking}</td>
                        <td>{lot.expiryDate ?? messages.none}</td>
                        <td>{lot.manufactureDate ?? messages.none}</td>
                        <td>{lot.onHand}</td>
                        <td>{lot.quarantined}</td>
                        <td>{lot.sellable}</td>
                        <td>{lot.reserved}</td>
                        <td>{lot.available}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
              <div className="rounded-box bg-base-100 p-4">
                <h2 className="mb-2 font-semibold">{m.units}</h2>
                <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>{u.location}</th>
                      <th>{u.lotId}</th>
                      <th>{u.quality}</th>
                      <th>{u.work}</th>
                      <th>{u.qty}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.units.map((unit, i) => (
                      <tr key={`${unit.locationCode ?? ''}-${unit.lotId ?? ''}-${unit.qualityState ?? ''}-${i}`} data-testid="unit-row">
                        <td className="font-mono">{unit.locationCode}</td>
                        <td>
                    <LotLabel lotId={unit.lotId} />
                  </td>
                        <td>{mv.quality[unit.qualityState ?? ''] ?? unit.qualityState}</td>
                        <td>{mv.work[unit.workState ?? ''] ?? unit.workState}</td>
                        <td>{unit.qty}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => {
                              setNotice(null);
                              setEditing(unit);
                            }}
                          >
                            {m.correct}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
              {editing && (
                <CorrectionForm
                  key={`${editing.locationCode ?? ''}-${editing.lotId ?? ''}-${editing.qualityState ?? ''}`}
                  mfcId={mfcId}
                  sku={sku}
                  unit={editing}
                  onClose={() => setEditing(null)}
                  onDone={(text) => {
                    setNotice(text);
                    setEditing(null);
                  }}
                />
              )}
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

function CorrectionForm({
  mfcId,
  sku,
  unit,
  onClose,
  onDone,
}: {
  readonly mfcId: string;
  readonly sku: string;
  readonly unit: StockUnit;
  readonly onClose: () => void;
  readonly onDone: (text: string) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(String(unit.qty ?? ''));
  const [toLocation, setToLocation] = useState('');
  const [toSourceLotRef, setLotRef] = useState('');
  const [toExpiryDate, setExpiry] = useState('');
  const [toManufactureDate, setManufacture] = useState('');
  const [reason, setReason] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const n = Number(qty);
  const changesSomething = !!toLocation.trim() || !!toSourceLotRef.trim() || !!toExpiryDate || !!toManufactureDate;
  const valid = Number.isInteger(n) && n >= 1 && n <= (unit.qty ?? 0) && !!reason.trim() && changesSomething;
  // 승인 대상 = 이 요청의 키(targetRef <mfcId>:CORRECTION:<키>) — 422 APPROVAL_REQUIRED 뒤 다시 보낼 때는 같은 키(422 는 기록되지 않음).
  const approvalKey = useRef<IdempotencyKey | null>(null);
  const correct = useCommand(async (_: null, fresh) => {
    const key = approvalKey.current ?? fresh;
    approvalKey.current = key;
    const r = checkCommand(
      await request(
        'POST',
        api.inventory.POST('/mfcs/{mfcId}/stock-corrections', {
          ...commandParams(key, { path: { mfcId } }),
          body: {
            reason: reason.trim(),
            ...(approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}),
            lines: [
              {
                sku,
                lotId: unit.lotId ?? '',
                fromLocation: unit.locationCode ?? '',
                qualityState: unit.qualityState ?? 'NORMAL',
                workState: unit.workState ?? 'STORED',
                qty: n,
                ...(toLocation.trim() ? { toLocation: toLocation.trim() } : {}),
                ...(toSourceLotRef.trim() ? { toSourceLotRef: toSourceLotRef.trim() } : {}),
                ...(toExpiryDate ? { toExpiryDate } : {}),
                ...(toManufactureDate ? { toManufactureDate } : {}),
              },
            ],
          },
        }),
      ),
    );
    approvalKey.current = null;
    await queryClient.invalidateQueries({ queryKey: ['stock', mfcId, sku] });
    onDone(m.corrected);
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4"
      aria-label={m.correct}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        // 승인 기다림이 아닌 거절이면 새 요청(새 키)
        if (correct.phase.kind === 'rejected' && !approvalRequired(correct.phase.failure)) approvalKey.current = null;
        if (correct.phase.kind === 'rejected') correct.reset();
        void correct.run(null);
      }}
    >
      <h2 className="font-semibold">{m.correctTitle(unit.locationCode ?? '', unit.lotId ?? '')}</h2>
      <p className="text-xs opacity-70">{m.correctHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.qty}
          <input className="input input-sm w-20" type="number" min={1} max={unit.qty} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.toLocation}
          <input className="input input-sm w-40 font-mono" value={toLocation} onChange={(e) => setToLocation(e.target.value.toUpperCase())} />
        </label>
        <label className="flex flex-col gap-1">
          {m.toSourceLotRef}
          <input className="input input-sm w-36" maxLength={128} value={toSourceLotRef} onChange={(e) => setLotRef(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.toExpiryDate}
          <input className="input input-sm w-36" type="date" value={toExpiryDate} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.toManufactureDate}
          <input className="input input-sm w-36" type="date" value={toManufactureDate} onChange={(e) => setManufacture(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.reason}
          <input className="input input-sm w-72" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ApprovalRefInput value={approvalRef} onChange={setApprovalRef} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || correct.busy}>
          {m.submitCorrect}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose} disabled={correct.busy}>
          {m.cancel}
        </button>
      </div>
      <ApprovalAwareFeedback command={correct} onApprovalId={setApprovalRef} />
      {correct.phase.kind === 'rejected' && approvalRequired(correct.phase.failure) && <p className="text-xs opacity-70">{messages.approval.sameKeyNote}</p>}
    </form>
  );
}

// ---------------------------------------------------------------- 순환 실사

function CountsTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useParam('sessionId');
  const [codes, setCodes] = useState('');
  const [reason, setReason] = useState('');
  const locationCodes = [...new Set(codes.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const tooMany = locationCodes.length > 50;
  const start = useCommand(async (_: null, key) => {
    const s = await request(
      'POST',
      api.inventory.POST('/mfcs/{mfcId}/count-sessions', {
        ...commandParams(key, { path: { mfcId } }),
        body: { locationCodes, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    );
    if (s.sessionId) {
      queryClient.setQueryData(['count-session', mfcId, s.sessionId], s);
      setOpenId(s.sessionId);
    }
    setCodes('');
    setReason('');
    return s;
  });
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <CountSessionList mfcId={mfcId} />
      <p className="text-xs opacity-70">{m.countsHint}</p>
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.startCount}
        onSubmit={(e) => {
          e.preventDefault();
          if (locationCodes.length === 0 || tooMany) return;
          if (start.phase.kind === 'rejected' || start.phase.kind === 'done') start.reset();
          void start.run(null);
        }}
      >
        <label className="flex flex-col gap-1">
          {m.locationCodes}
          <textarea className="textarea textarea-sm w-96 max-w-full font-mono" rows={2} value={codes} onChange={(e) => setCodes(e.target.value)} />
        </label>
        {tooMany && <p className="text-error text-xs">{m.tooMany}</p>}
        <label className="flex flex-col gap-1">
          {m.countReason}
          <input className="input input-sm w-72" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={locationCodes.length === 0 || tooMany || start.busy}>
          {m.startCount}
        </button>
        <CommandFeedback command={start} />
      </form>
      <LookupForm key={openId} label={m.countId} value={openId} button={m.open} onSubmit={setOpenId} />
      {openId && <CountSessionView mfcId={mfcId} sessionId={openId} />}
    </div>
  );
}

function CountSessionView({ mfcId, sessionId }: { readonly mfcId: string; readonly sessionId: string }) {
  const api = useApi();
  // 결정 문구는 여기서 들고 있는다 — 결정 뒤 상태가 바뀌면 결정 영역이 사라진다
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['count-session', mfcId, sessionId],
    queryFn: () => request('GET', api.inventory.GET('/mfcs/{mfcId}/count-sessions/{sessionId}', { params: { path: { mfcId, sessionId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(s) => (
        <>
          {notice && (
            <p role="status" className="text-success text-sm">
              {notice}
            </p>
          )}
          <CountSessionCard mfcId={mfcId} session={s} onDecided={setNotice} />
        </>
      )}
    </QueryState>
  );
}

function CountSessionCard({ mfcId, session: s, onDecided }: { readonly mfcId: string; readonly session: CountSession; readonly onDecided: (t: string | null) => void }) {
  const f = m.countFacts;
  const d = m.diffCols;
  return (
    <div className="space-y-3 rounded-box bg-base-100 p-4" data-testid="count-session">
      <p className="flex flex-wrap items-center gap-2">
        <span className="badge badge-sm">{m.countState[s.state ?? ''] ?? s.state}</span>
        <span className="opacity-70">{(s.locationCodes ?? []).join(', ')}</span>
      </p>
      <SystemNumbers ids={[{ label: m.sys.session, id: s.sessionId }]} />
      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1">
        <dt className="opacity-70">{f.created}</dt>
        <dd>
          <Who id={s.createdBy} />
        </dd>
        <dt className="opacity-70">{f.first}</dt>
        <dd>
          <Who id={s.firstCounter} />
        </dd>
        <dt className="opacity-70">{f.recount}</dt>
        <dd>
          <Who id={s.recounter} />
        </dd>
        <dt className="opacity-70">{f.approver}</dt>
        <dd>
          <Who id={s.approverId} />
        </dd>
        <dt className="opacity-70">{f.ref}</dt>
        <dd>{s.approvalRef ?? messages.none}</dd>
        <dt className="opacity-70">{f.baseline}</dt>
        <dd>{s.baselineAt ? formatSeoul(s.baselineAt) : messages.none}</dd>
      </dl>
      <div>
        <h3 className="mb-1 font-semibold">{m.diffs}</h3>
        {s.differences == null ? (
          <p className="opacity-70">{m.diffHidden}</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>{m.unit.location}</th>
                <th>{m.sku}</th>
                <th>{m.unit.lotId}</th>
                <th>{d.book}</th>
                <th>{d.held}</th>
                <th>{d.counted}</th>
                <th>{d.delta}</th>
              </tr>
            </thead>
            <tbody>
              {s.differences.map((x, i) => (
                <tr key={`${x.locationCode ?? ''}-${x.lotId ?? ''}-${i}`} data-testid="diff-row">
                  <td className="font-mono">{x.locationCode}</td>
                  <td className="font-mono">{x.sku}</td>
                  <td>
                    <LotLabel lotId={x.lotId} />
                  </td>
                  <td>{x.bookQty}</td>
                  <td>{x.heldQty}</td>
                  <td>{x.countedQty}</td>
                  <td className={(x.deltaQty ?? 0) < 0 ? 'text-error' : ''}>{x.deltaQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {s.state === 'PENDING_APPROVAL' && <DecideCount key={s.version} mfcId={mfcId} session={s} onDecided={onDecided} />}
    </div>
  );
}

function DecideCount({ mfcId, session, onDecided: setNotice }: { readonly mfcId: string; readonly session: CountSession; readonly onDecided: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const sessionId = session.sessionId ?? '';
  const [approvalRef, setApprovalRef] = useState('');
  const [note, setNote] = useState('');
  const decide = useCommand(async (action: 'APPROVE' | 'REJECT', key) => {
    setNotice(null);
    const s = await request(
      'POST',
      api.inventory.POST('/mfcs/{mfcId}/count-sessions/{sessionId}/approvals', {
        ...commandParams(key, { path: { mfcId, sessionId } }),
        body: { action, ...(action === 'APPROVE' && approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    );
    if (s.state === 'ADJUSTED') setNotice(m.approved);
    if (s.state === 'REJECTED') setNotice(m.rejected);
    queryClient.setQueryData(['count-session', mfcId, sessionId], s);
    return s;
  });
  const run = (action: 'APPROVE' | 'REJECT') => {
    if (decide.phase.kind === 'rejected') decide.reset();
    void decide.run(action);
  };
  return (
    <div className="space-y-2 border-t border-base-200 pt-3" aria-label={m.approve}>
      <p className="text-xs opacity-70">{m.decideHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <ApprovalRefInput value={approvalRef} onChange={setApprovalRef} />
        <label className="flex flex-col gap-1">
          {m.note}
          <input className="input input-sm w-64" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={decide.busy} onClick={() => run('APPROVE')}>
          {m.approve}
        </button>
        <button type="button" className="btn btn-sm" disabled={decide.busy} onClick={() => run('REJECT')}>
          {m.reject}
        </button>
      </div>
      <ApprovalAwareFeedback command={decide} onApprovalId={setApprovalRef} />
    </div>
  );
}

// ---------------------------------------------------------------- 출하 부적격 LOT

function UnshippableTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['unshippable', mfcId],
    queryFn: async () => (await request('GET', api.inventory.GET('/mfcs/{mfcId}/unshippable-lots', { params: { path: { mfcId } } }))).items ?? [],
  });
  const l = m.lot;
  const u = m.unit;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.unshippableHint}</p>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.unshippableEmpty}>
        {(rows) => (
          <div className="overflow-x-auto rounded-box bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{m.sku}</th>
                <th>{u.lotId}</th>
                <th>{l.expiry}</th>
                <th>{u.location}</th>
                <th>{m.category}</th>
                <th>{u.qty}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.lotId ?? ''}-${r.locationCode ?? ''}-${i}`} data-testid="unshippable-row">
                  <td className="font-mono">{r.sku}</td>
                  <td>
                    <LotLabel lotId={r.lotId} />
                  </td>
                  <td>{r.expiryDate ?? messages.none}</td>
                  <td className="font-mono">{r.locationCode}</td>
                  <td>{r.onMiscShelf ? m.onMisc : (r.locationCategoryId ?? messages.none)}</td>
                  <td>{r.qty}</td>
                  <td>
                    {!r.onMiscShelf && (
                      <Link
                        className="btn btn-xs"
                        to={`${centerPath(mfcId, 'moves/new')}?${new URLSearchParams({ sku: r.sku ?? '', lotId: r.lotId ?? '', fromLocation: r.locationCode ?? '', qty: String(r.qty ?? '') }).toString()}`}
                      >
                        {m.moveIt}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------- 보충 기준

function PoliciesTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['policies', mfcId],
    queryFn: async () => (await request('GET', api.inventory.GET('/mfcs/{mfcId}/replenishment-policies', { params: { path: { mfcId } } }))).items ?? [],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['policies', mfcId] });
  const [form, setForm] = useState({ locationCode: '', sku: '', minQty: '', targetQty: '', unitQty: '' });
  const nums = { minQty: Number(form.minQty), targetQty: Number(form.targetQty), unitQty: Number(form.unitQty) };
  const filled = !!form.locationCode.trim() && !!form.sku.trim() && form.minQty !== '' && form.targetQty !== '' && form.unitQty !== '';
  const minOver = filled && nums.minQty > nums.targetQty;
  const valid = filled && !minOver && nums.unitQty >= 1 && nums.minQty >= 0;
  const save = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = await request(
      'PUT',
      api.inventory.PUT('/mfcs/{mfcId}/replenishment-policies', {
        ...commandParams(key, { path: { mfcId } }),
        body: { locationCode: form.locationCode.trim(), sku: form.sku.trim(), ...nums },
      }),
    );
    setNotice(m.policySaved);
    await refresh();
    return r;
  });
  const remove = useCommand(async (p: { locationCode: string; sku: string }, key) => {
    setNotice(null);
    const { params } = commandParams(key, { path: { mfcId } });
    await requestNoContent('DELETE', api.inventory.DELETE('/mfcs/{mfcId}/replenishment-policies', { params: { ...params, query: p } }));
    setNotice(m.policyDeleted);
    await refresh();
    return true;
  });
  const c = m.policyCols;
  const field = (k: keyof typeof form, label: string, numeric = false) => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className={`input input-sm ${numeric ? 'w-20' : 'w-36 font-mono'}`}
        type={numeric ? 'number' : 'text'}
        min={numeric ? 0 : undefined}
        step={numeric ? 1 : undefined}
        value={form[k]}
        onChange={(e) => setForm((prev) => ({ ...prev, [k]: numeric ? e.target.value : e.target.value.toUpperCase() }))}
      />
    </label>
  );
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.policiesHint}</p>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.policiesEmpty}>
        {(rows) => (
          <div className="overflow-x-auto rounded-box bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{c.location}</th>
                <th>{c.sku}</th>
                <th>{c.min}</th>
                <th>{c.target}</th>
                <th>{c.unit}</th>
                <th>{c.updated}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.locationCode ?? ''}-${p.sku ?? ''}`} data-testid="policy-row">
                  <td className="font-mono">{p.locationCode}</td>
                  <td className="font-mono">{p.sku}</td>
                  <td>{p.minQty}</td>
                  <td>{p.targetQty}</td>
                  <td>{p.unitQty}</td>
                  <td>{p.updatedAt ? formatSeoul(p.updatedAt) : messages.none}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-xs"
                      disabled={remove.busy}
                      onClick={() => {
                        if (remove.phase.kind === 'rejected' || remove.phase.kind === 'done') remove.reset();
                        void remove.run({ locationCode: p.locationCode ?? '', sku: p.sku ?? '' });
                      }}
                    >
                      {m.deletePolicy}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </QueryState>
      <CommandFeedback command={remove} />
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.savePolicy}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (save.phase.kind === 'rejected' || save.phase.kind === 'done') save.reset();
          void save.run(null);
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          {field('locationCode', c.location)}
          {field('sku', c.sku)}
          {field('minQty', c.min, true)}
          {field('targetQty', c.target, true)}
          {field('unitQty', c.unit, true)}
          <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || save.busy}>
            {m.savePolicy}
          </button>
        </div>
        {minOver && <p className="text-error text-xs">{m.minOverTarget}</p>}
        <CommandFeedback command={save} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- 상품 취급

/**
 * 신상품 배너(0.27.0 R8, 사용자 2026-11-19 "신상품은 도입 말고 상단 배너로 안내"): 이 센터가 한 번도 정하지 않은 상품(`undecided=true`, 단종 제외).
 * `introducedSince` 를 주면 생긴 시각을 모르는 예전 상품(이번 배포 전 — introducedAt null)이 빠진다 → 배포 뒤 생긴 상품 전부를 보려고 아주 이른 시각을 준다.
 * 숫자는 서버 `totalCount` 그대로. 못 읽으면 0 으로 보이지 않고 "못 읽음".
 */
const NEW_SINCE = '2000-01-01T00:00:00Z';

function NewProductsBanner({ mfcId, onShow }: { readonly mfcId: string; readonly onShow: () => void }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['handlings-new-count', mfcId],
    queryFn: () =>
      request('GET', api.inventory.GET('/mfcs/{mfcId}/sku-handlings', { params: { path: { mfcId }, query: { undecided: true, introducedSince: NEW_SINCE, size: 1 } } })),
  });
  if (query.isError)
    return (
      <p role="alert" className="text-xs text-warning" data-testid="new-products-banner">
        {m.newProductsFailed}
      </p>
    );
  const n = query.data?.totalCount ?? 0;
  if (!query.isSuccess || n === 0) return null;
  return (
    <div role="status" className="alert alert-info flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="new-products-banner">
      <span>{m.newProducts(n)}</span>
      <button type="button" className="btn btn-sm" onClick={onShow}>
        {m.newProductsShow}
      </button>
    </div>
  );
}

function HandlingsTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [enabledRaw, setEnabled] = useParam('enabled');
  /** `enabled=new` = 신상품(정한 적 없음)만 */
  const onlyNew = enabledRaw === 'new';
  const enabled = enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : undefined;
  const [notice, setNotice] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['handlings', mfcId, enabledRaw],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.inventory.GET('/mfcs/{mfcId}/sku-handlings', {
          params: {
            path: { mfcId },
            query: {
              ...(onlyNew ? { undecided: true, introducedSince: NEW_SINCE } : enabled === undefined ? {} : { enabled }),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const rows = (query.data?.pages ?? []).flatMap((p) => p.items ?? []);
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <NewProductsBanner mfcId={mfcId} onShow={() => setEnabled('new')} />
      <p className="text-xs opacity-70">{m.handlingsHint}</p>
      <label className="flex w-fit flex-col gap-1 rounded-box bg-base-100 p-3">
        {m.enabledFilter}
        <select className="select select-sm w-36" value={enabledRaw} onChange={(e) => setEnabled(e.target.value)}>
          <option value="">{m.all}</option>
          <option value="true">{m.on}</option>
          <option value="false">{m.off}</option>
          <option value="new">{m.newOnly}</option>
        </select>
      </label>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <QueryState state={toUiState(query, () => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.handlingsEmpty}>
        {() => (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-box bg-base-100">
            <table className="table table-sm">
              <tbody>
                {rows.map((h) => (
                  <HandlingRow key={`${h.sku}-${h.version}`} mfcId={mfcId} handling={h} onDone={setNotice} />
                ))}
              </tbody>
            </table>
            </div>
            {query.hasNextPage && (
              <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {m.more}
              </button>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function HandlingRow({ mfcId, handling: h, onDone }: { readonly mfcId: string; readonly handling: SkuHandling; readonly onDone: (t: string | null) => void }) {
  const { sku, version, skuState } = h;
  const enabled = h.handlingEnabled;
  // 본사 단종(0.27.0 R7): 모든 센터에서 꺼지고 켤 수 없다(서버도 409 SKU_DISCONTINUED)
  const discontinued = h.offReason === 'DISCONTINUED' || h.saleState === 'DISCONTINUED';
  const api = useApi();
  const queryClient = useQueryClient();
  const toggle = useCommand(async (next: boolean, key) => {
    onDone(null);
    const r = await request('POST', api.inventory.POST('/mfcs/{mfcId}/sku-handlings', { ...commandParams(key, { path: { mfcId }, version }), body: { sku, enabled: next } }));
    onDone(r.changed ? m.toggled(sku, r.handling.handlingEnabled) : m.unchanged);
    await queryClient.invalidateQueries({ queryKey: ['handlings', mfcId] });
    await queryClient.invalidateQueries({ queryKey: ['handlings-new-count', mfcId] });
    return r;
  });
  return (
    <tr data-testid="handling-row">
      <td className="font-mono">{sku}</td>
      <td>
        <span className={`badge badge-sm ${enabled ? 'badge-success' : 'badge-ghost'}`}>{enabled ? m.on : m.off}</span>
      </td>
      <td>
        {m.skuState[skuState ?? ''] ?? skuState ?? messages.none}
        {discontinued && <span className="badge badge-sm badge-error ml-1">{m.discontinued}</span>}
        {!discontinued && h.offReason === 'CENTER' && <span className="ml-1 text-xs opacity-70">{m.offByCenter}</span>}
        {h.introducedAt && <span className="ml-1 text-xs opacity-70">{m.introducedAt(formatSeoul(h.introducedAt))}</span>}
      </td>
      <td>
        {discontinued && !enabled && <p className="text-xs opacity-70">{m.discontinuedNote}</p>}
        <button
          type="button"
          className="btn btn-xs"
          disabled={toggle.busy || (discontinued && !enabled)}
          onClick={() => {
            if (toggle.phase.kind === 'rejected') toggle.reset();
            void toggle.run(!enabled);
          }}
        >
          {enabled ? m.turnOff : m.turnOn}
        </button>
        <CommandFeedback command={toggle} />
      </td>
    </tr>
  );
}
