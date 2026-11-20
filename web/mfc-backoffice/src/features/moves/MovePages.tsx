// 이동·보충 — mfc-inbound-service 0.9.0 `/move-orders*`(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "이동 지시 만들기·취소, 목록").
// - 목록 `GET /move-orders?mfcId=&state=` — state 를 비우면 서버 기본(진행 중 = ACTIVE·CANCEL_PENDING). 상태 거르기는 URL 쿼리. 쪽 나누기 없음(계약).
// - 지시 `POST /move-orders`(MFC_SUPERVISOR, 201 MoveOrder). 같은 Idempotency-Key = 같은 이동(서버). 거절 코드는 mfc-inventory 이동 배정 그대로.
// - 취소 `POST …/cancellations`(사유 필수, 200 MoveOrder) — 집지 않은 몫만 풀리고, 카트에 남으면 CANCEL_PENDING.
// - 집어 올리기·내려놓기는 현장(PDA) 일이라 이 화면에 없다.
// - 출발·도착 고르기는 돕기만: mfc-inventory `GET /mfcs/{id}/stock?sku=`(위치·LOT 별), mfc-location `GET /putaway-candidates`. 판정은 서버.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation as useRouterLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-inbound';
import type { components as InventorySchemas } from '../../api/generated/mfc-inventory';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { LotLabel } from '../../shared/LotLabel';
import { messages } from '../../shared/messages';
import { SystemNumbers } from '../../shared/displayNumber';
import { GuideBox, SearchBar, StatCard, StatStrip } from '../../shared/listParts';
import { useNewIds } from '../../shared/motion';
import { Who } from '../../shared/OperatorLabel';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';
import { useRecordRecent, useSeenIds } from '../../shared/recentViews';
import { SavedViews } from '../../shared/SavedViews';
import { SeenMark } from '../../shared/SeenMark';
import { StickyTitle, useScrolledPast } from '../../shared/StickyTitle';
import { QueueNav, useRememberQueue } from '../../shared/workQueue';

const m = messages.moves;

export type MoveOrder = components['schemas']['MoveOrder'];
type MoveState = NonNullable<MoveOrder['state']>;

const STATES: readonly MoveState[] = ['ACTIVE', 'CANCEL_PENDING', 'COMPLETED', 'CANCELLED'];
const isState = (v: string | null): v is MoveState => !!v && (STATES as readonly string[]).includes(v);

const movesPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `moves/${rest}` : 'moves');

/** `/c/:mfcId/moves/*` */
export function MovesMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<MoveListPage mfcId={mfcId} />} />
      <Route path="new" element={<MoveCreatePage mfcId={mfcId} />} />
      <Route path=":moveId" element={<MoveDetailPage mfcId={mfcId} />} />
    </Routes>
  );
}

const product = (o: MoveOrder) => (o.productName ? `${o.productName} (${o.sku ?? ''})` : (o.sku ?? messages.none));

function StateBadge({ state }: { readonly state: MoveState | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'ACTIVE' ? 'badge-info' : state === 'CANCEL_PENDING' ? 'badge-warning' : state === 'COMPLETED' ? 'badge-success' : 'badge-ghost';
  return <span className={`badge badge-sm ${tone}`}>{m.state[state] ?? state}</span>;
}

// ---------------------------------------------------------------- 목록

function MoveListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = isState(raw) ? raw : undefined;
  const query = useQuery({
    queryKey: ['moves', mfcId, state ?? 'IN_PROGRESS'],
    queryFn: async () =>
      (await request('GET', api.inbound.GET('/move-orders', { params: { query: { mfcId, ...(state ? { state } : {}) } } }))).items ?? [],
  });
  // 숫자 카드: 서버 기본 목록(진행 중 = ACTIVE·CANCEL_PENDING, 쪽 나눔 없이 전부)에서 센다 — 거르기와 상관없이 같은 숫자
  const open = useQuery({
    queryKey: ['moves', mfcId, 'IN_PROGRESS'],
    queryFn: async () => (await request('GET', api.inbound.GET('/move-orders', { params: { query: { mfcId } } }))).items ?? [],
  });
  const cell = (pick: (o: MoveOrder) => boolean) => (open.data ? m.ui.count(open.data.filter(pick).length) : open.isError ? '?' : '…');
  const has = (pick: (o: MoveOrder) => boolean) => (open.data ?? []).some(pick);
  const { pathname, search } = useRouterLocation();
  const setState = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set('state', v);
    else next.delete('state');
    setParams(next, { replace: true });
  };
  const ids = (query.data ?? []).map((o) => o.moveId ?? '').filter(Boolean);
  const fresh = useNewIds(query.data ? ids : undefined, state ?? '');
  const seen = useSeenIds('move', mfcId);
  useRememberQueue('move', mfcId, query.data ? ids : undefined, `${pathname}${search}`);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{messages.menus.moves}</h1>
        <Link to={movesPath(mfcId, 'new')} className="btn btn-sm btn-primary">
          {m.create}
        </Link>
      </div>
      <GuideBox title={m.ui.guideTitle} storeKey="moves" items={[m.intro, m.ui.countNote]} />
      <StatStrip label={m.ui.countsLabel} testId="move-counts">
        <StatCard testId="count-ACTIVE" label={m.state.ACTIVE} value={cell((o) => o.state === 'ACTIVE')} tone="info" active={state === 'ACTIVE'} onClick={() => setState(state === 'ACTIVE' ? '' : 'ACTIVE')} />
        <StatCard
          testId="count-CANCEL_PENDING"
          label={m.state.CANCEL_PENDING}
          value={cell((o) => o.state === 'CANCEL_PENDING')}
          tone={has((o) => o.state === 'CANCEL_PENDING') ? 'warning' : undefined}
          active={state === 'CANCEL_PENDING'}
          onClick={() => setState(state === 'CANCEL_PENDING' ? '' : 'CANCEL_PENDING')}
        />
        <StatCard testId="count-urgent" label={m.fields.urgent} value={cell((o) => !!o.urgent)} tone={has((o) => !!o.urgent) ? 'error' : undefined} hint={m.ui.urgentHint} />
      </StatStrip>
      <SearchBar summary={[[m.stateFilter, state ? (m.state[state] ?? state) : m.inProgress]]} startOpen={!state}>
        <label className="flex flex-col gap-1">
        {m.stateFilter}
        <select className="select select-sm w-44" value={state ?? ''} onChange={(e) => setState(e.target.value)}>
          <option value="">{m.inProgress}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {m.state[s]}
            </option>
          ))}
        </select>
        </label>
      </SearchBar>
      <SavedViews listKey={`moves.${mfcId}`} />
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(rows) => (
          // 좁은 폭(1024px)에서 화면 밖으로 넘쳐 가로 스크롤 상자에(2026-11-20 점검)
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{m.fields.kind}</th>
                <th>{m.fields.product}</th>
                <th>{m.fields.lotId}</th>
                <th>{`${m.fields.from} → ${m.fields.to}`}</th>
                <th>{m.fields.qty}</th>
                <th>{m.fields.progress}</th>
                <th>{m.fields.state}</th>
                <th>{m.fields.assignee}</th>
                <th>{m.fields.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.moveId} data-testid="move-row" className={fresh.has(o.moveId ?? '') ? 'row-new' : undefined}>
                  <td>
                    <Link className="link" to={movesPath(mfcId, encodeURIComponent(o.moveId ?? ''))}>
                      {m.kind[o.kind ?? ''] ?? o.kind}
                    </Link>
                    {o.urgent && <span className="badge badge-sm badge-error ml-1">{m.fields.urgent}</span>}
                    <SeenMark seen={seen.has(o.moveId ?? '')} />
                  </td>
                  <td>{product(o)}</td>
                  <td>
                    <LotLabel lotId={o.lotId} />
                  </td>
                  <td className="font-mono text-xs">{`${o.fromLocation ?? ''} → ${o.toLocation ?? ''}`}</td>
                  <td>{o.qty}</td>
                  <td>{m.progress(o.pickedQty ?? 0, o.droppedQty ?? 0, o.onCartQty ?? 0)}</td>
                  <td>
                    <StateBadge state={o.state} />
                  </td>
                  <td>
                  <Who id={o.assigneeId} />
                </td>
                  <td>{o.createdAt ? formatSeoul(o.createdAt) : messages.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------- 상세·취소

function MoveDetailPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { moveId = '' } = useParams();
  const routerLocation = useRouterLocation();
  const [notice, setNotice] = useState<string | null>((routerLocation.state as { created?: boolean } | null)?.created ? m.created : null);
  const query = useQuery({
    queryKey: ['move', moveId],
    queryFn: () => request('GET', api.inbound.GET('/move-orders/{moveId}', { params: { path: { moveId } } })),
  });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const past = useScrolledPast(titleRef);
  useRecordRecent('move', mfcId, moveId, query.data ? moveTitle(query.data) : null);
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={movesPath(mfcId)} className="link text-sm">
          {m.back}
        </Link>
        <div className="ml-auto">
          <QueueNav kind="move" mfcId={mfcId} id={moveId} />
        </div>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(o) => (
          <>
            <h1 ref={titleRef} className="flex flex-wrap items-center gap-2">
              {moveTitle(o)}
              <StateBadge state={o.state} />
              {o.urgent && <span className="badge badge-sm badge-error">{m.fields.urgent}</span>}
            </h1>
            <StickyTitle show={past} title={moveTitle(o)} badges={<StateBadge state={o.state} />} />
            <ProgressSteps
              steps={m.ui.steps}
              place={movePlace(o.state)}
              ended={o.state === 'CANCELLED' ? m.state.CANCELLED : undefined}
              unknownText={o.state ? m.ui.unknownStep(o.state) : undefined}
              label={m.ui.stepsLabel}
              testId="move-steps"
              endedTestId="move-ended"
            />
            {notice && (
              <p role="status" className="text-success text-sm">
                {notice}
              </p>
            )}
            {o.state === 'CANCEL_PENDING' && <p className="alert alert-warning text-sm">{m.cancelPendingNote}</p>}
            <MoveFacts order={o} />
            {o.state === 'ACTIVE' && <CancelMove mfcId={mfcId} order={o} onDone={setNotice} />}
            <SystemNumbers ids={[{ label: m.ui.move, id: o.moveId }]} />
          </>
        )}
      </QueryState>
    </section>
  );
}

/** 화면 표기(ADR-0070 덧붙임) — 시스템 ID 는 시스템 번호 칸에만 */
// 백엔드 요청 2026-11-19 request-display-numbers: 이동 = "종류 · 상품 · 시각"(상품명이 없으면 SKU)
const moveTitle = (o: MoveOrder) =>
  m.ui.title(`${m.kind[o.kind ?? ''] ?? o.kind ?? m.ui.move}${o.productName || o.sku ? ` · ${o.productName ?? o.sku}` : ''}`, o.createdAt ? formatSeoul(o.createdAt) : messages.none);

/** 이동 상태 → 진행 단계(지시 → 옮기는 중 → 끝남). 취소 대기는 옮기는 중에서 주의(카트에 남은 것 정리) */
function movePlace(s: MoveState | undefined): StepPlace | null {
  switch (s) {
    case 'ACTIVE':
      return { step: 1, done: false };
    case 'CANCEL_PENDING':
      return { step: 1, done: false, warn: true, note: m.state.CANCEL_PENDING ?? 'CANCEL_PENDING' };
    case 'COMPLETED':
      return { step: 2, done: true };
    default:
      return null;
  }
}

function MoveFacts({ order: o }: { readonly order: MoveOrder }) {
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [m.fields.product, product(o)],
    [m.fields.barcodes, o.barcodes?.length ? o.barcodes.join(', ') : messages.none],
    [m.fields.lotId, <LotLabel lotId={o.lotId} />],
    [m.fields.from, o.fromLocation ?? messages.none],
    [m.fields.to, o.toLocation ?? messages.none],
    [m.fields.cart, o.cartLocation ?? messages.none],
    [m.fields.qty, o.qty ?? messages.none],
    [m.fields.progress, m.progress(o.pickedQty ?? 0, o.droppedQty ?? 0, o.onCartQty ?? 0)],
    [m.fields.reason, o.reason ?? messages.none],
    [m.fields.assignee, <Who id={o.assigneeId} />],
    [m.fields.pickedBy, <Who id={o.pickedBy} />],
    [m.fields.createdBy, o.createdBy === 'SYSTEM' ? m.system : <Who id={o.createdBy} />],
    [m.fields.createdAt, o.createdAt ? formatSeoul(o.createdAt) : messages.none],
    [m.fields.updatedAt, o.updatedAt ? formatSeoul(o.updatedAt) : messages.none],
  ];
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CancelMove({ mfcId, order, onDone }: { readonly mfcId: string; readonly order: MoveOrder; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const moveId = order.moveId ?? '';
  const [reason, setReason] = useState('');
  const cancel = useCommand(async (v: { reason: string }, key) => {
    onDone(null);
    const next = await request(
      'POST',
      api.inbound.POST('/move-orders/{moveId}/cancellations', { ...commandParams(key, { path: { moveId } }), body: { reason: v.reason } }),
    );
    // 서버가 돌려준 상태만 반영한다(CANCELLED 또는 카트 정리 대기)
    onDone(next.state === 'CANCEL_PENDING' ? m.cancelledPending : next.state === 'CANCELLED' ? m.cancelled : null);
    queryClient.setQueryData(['move', moveId], next);
    await queryClient.invalidateQueries({ queryKey: ['moves', mfcId] });
    return next;
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.cancel}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (cancel.phase.kind === 'rejected') cancel.reset();
        void cancel.run({ reason: reason.trim() });
      }}
    >
      <p className="text-xs opacity-70">{m.cancelHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.cancelReason}
          <input className="input input-sm w-72" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-warning" disabled={!reason.trim() || cancel.busy}>
          {m.cancel}
        </button>
      </div>
      <CommandFeedback command={cancel} />
    </form>
  );
}

// ---------------------------------------------------------------- 지시 만들기

interface CreateValues {
  readonly sku: string;
  readonly lotId: string;
  readonly fromLocation: string;
  readonly toLocation: string;
  readonly qty: string;
  readonly reason: string;
  readonly urgent: boolean;
}

const emptyCreate: CreateValues = { sku: '', lotId: '', fromLocation: '', toLocation: '', qty: '', reason: '', urgent: false };

function MoveCreatePage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // 다른 화면(재고 > 출하 부적격 LOT)에서 값을 채워 열 수 있다 — 주소 쿼리 sku·lotId·fromLocation·qty
  const [query] = useSearchParams();
  const [v, setV] = useState<CreateValues>(() => ({
    ...emptyCreate,
    sku: query.get('sku') ?? '',
    lotId: query.get('lotId') ?? '',
    fromLocation: query.get('fromLocation') ?? '',
    qty: query.get('qty') ?? '',
  }));
  const set = <K extends keyof CreateValues>(k: K, value: CreateValues[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const qty = Number(v.qty);
  const ok = !!v.sku.trim() && !!v.lotId.trim() && !!v.fromLocation.trim() && !!v.toLocation.trim() && Number.isInteger(qty) && qty >= 1;
  const create = useCommand(async (c: CreateValues, key) => {
    const created = await request(
      'POST',
      api.inbound.POST('/move-orders', {
        ...commandParams(key),
        body: {
          mfcId,
          sku: c.sku.trim(),
          lotId: c.lotId.trim(),
          fromLocation: c.fromLocation.trim(),
          toLocation: c.toLocation.trim(),
          qty: Number(c.qty),
          ...(c.reason.trim() ? { reason: c.reason.trim() } : {}),
          urgent: c.urgent,
        },
      }),
    );
    await queryClient.invalidateQueries({ queryKey: ['moves', mfcId] });
    if (created.moveId) {
      queryClient.setQueryData(['move', created.moveId], created);
      void navigate(movesPath(mfcId, encodeURIComponent(created.moveId)), { state: { created: true } });
    }
    return created;
  });
  // 입력을 바꾸면 새 행위 — 거절 뒤 같은 키를 다시 쓰지 않는다(결과 불명이면 useCommand 가 막는다)
  const edit = <K extends keyof CreateValues>(k: K, value: CreateValues[K]) => {
    if (create.phase.kind === 'rejected') create.reset();
    set(k, value);
  };
  const text = (k: 'sku' | 'lotId' | 'fromLocation' | 'toLocation', label: string, upper = true) => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className="input input-sm w-48 font-mono"
        value={v[k]}
        onChange={(e) => edit(k, upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </label>
  );
  return (
    <section className="max-w-4xl space-y-4">
      <Link to={movesPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <h1 className="text-xl font-bold">{m.create}</h1>
      <form
        className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
          void create.run(v);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">{text('sku', m.fields.sku)}</div>
        {v.sku.trim() && (
          <StockPicker
            mfcId={mfcId}
            sku={v.sku.trim()}
            onPick={(u) => {
              edit('lotId', u.lotId ?? '');
              edit('fromLocation', u.locationCode ?? '');
            }}
          />
        )}
        <div className="flex flex-wrap items-end gap-3">
          {text('lotId', m.fields.lotId)}
          {text('fromLocation', m.fields.from)}
          {text('toLocation', m.fields.to)}
          <label className="flex flex-col gap-1">
            {m.fields.qty}
            <input className="input input-sm w-24" type="number" min={1} step={1} value={v.qty} onChange={(e) => edit('qty', e.target.value)} />
          </label>
        </div>
        {v.sku.trim() && <TargetPicker mfcId={mfcId} sku={v.sku.trim()} onPick={(code) => edit('toLocation', code)} />}
        <p className="text-xs opacity-70">{m.pickNote}</p>
        <label className="flex flex-col gap-1">
          {m.reasonOptional}
          <input className="input input-sm w-96 max-w-full" maxLength={200} value={v.reason} onChange={(e) => edit('reason', e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-sm" checked={v.urgent} onChange={(e) => edit('urgent', e.target.checked)} />
          {m.urgentLabel}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || create.busy}>
            {m.create}
          </button>
        </div>
        <CommandFeedback command={create} />
      </form>
    </section>
  );
}

type StockUnit = InventorySchemas['schemas']['CenterStock']['units'][number];

/** 출발 칸 고르기: 상품의 위치·LOT 별 재고(누를 때만 부른다) */
function StockPicker({ mfcId, sku, onPick }: { readonly mfcId: string; readonly sku: string; readonly onPick: (u: StockUnit) => void }) {
  const api = useApi();
  const [asked, setAsked] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['stock', mfcId, asked],
    enabled: asked !== null,
    queryFn: () => request('GET', api.inventory.GET('/mfcs/{mfcId}/stock', { params: { path: { mfcId }, query: { sku: asked ?? '' } } })),
  });
  return (
    <div className="space-y-2 rounded-box border border-base-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{m.pickStock}</span>
        <button type="button" className="btn btn-xs" onClick={() => setAsked(sku)}>
          {m.showStock}
        </button>
      </div>
      {asked !== null && (
        <QueryState state={toUiState(query, (s) => s.units.length === 0)} onRetry={() => void query.refetch()} emptyText={m.stockEmpty}>
          {(s) => (
            <table className="table table-xs" aria-label={m.pickStock}>
              <thead>
                <tr>
                  <th>{m.fields.from}</th>
                  <th>{m.fields.lotId}</th>
                  <th>{m.qualityState}</th>
                  <th>{m.workState}</th>
                  <th>{m.fields.qty}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.units.map((u, i) => (
                  <tr key={`${u.locationCode ?? ''}-${u.lotId ?? ''}-${i}`} data-testid="stock-row">
                    <td className="font-mono">{u.locationCode}</td>
                    <td>
                    <LotLabel lotId={u.lotId} />
                  </td>
                    <td>{m.quality[u.qualityState ?? ''] ?? u.qualityState}</td>
                    <td>{m.work[u.workState ?? ''] ?? u.workState}</td>
                    <td>{u.qty}</td>
                    <td>
                      <button type="button" className="btn btn-xs" onClick={() => onPick(u)}>
                        {m.useAsFrom}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      )}
    </div>
  );
}

/** 도착 칸 후보(mfc-location 적치 후보 — 남은 공간은 사본, null 은 모름) */
function TargetPicker({ mfcId, sku, onPick }: { readonly mfcId: string; readonly sku: string; readonly onPick: (code: string) => void }) {
  const api = useApi();
  const [asked, setAsked] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['putaway-candidates', mfcId, asked],
    enabled: asked !== null,
    queryFn: () => request('GET', api.location.GET('/putaway-candidates', { params: { query: { mfcId, sku: asked ?? '' } } })),
  });
  return (
    <div className="space-y-2 rounded-box border border-base-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{m.pickTarget}</span>
        <button type="button" className="btn btn-xs" onClick={() => setAsked(sku)}>
          {m.showCandidates}
        </button>
        {query.data?.asOf?.asOf && <span className="text-xs opacity-70">{m.asOf(formatSeoul(query.data.asOf.asOf))}</span>}
      </div>
      {asked !== null && (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.candidatesEmpty}>
          {(r) => (
            <ul className="flex flex-wrap gap-2" aria-label={m.pickTarget}>
              {(r.items ?? []).map((c) => (
                <li key={c.locationId}>
                  <button type="button" className="btn btn-xs btn-outline" onClick={() => onPick(c.locationCode ?? '')}>
                    <span className="font-mono">{c.locationCode}</span>
                    <span className="opacity-70">{m.remaining(c.remainingSpace)}</span>
                    <span>{m.useAsTo}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      )}
    </div>
  );
}
