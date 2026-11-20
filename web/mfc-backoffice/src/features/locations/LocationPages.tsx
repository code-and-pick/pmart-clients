// 위치(칸) — mfc-location-service 0.7.1(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "칸 등록·수정·닫기·폐지, 도면 좌표·치수").
// - 목록 `GET /locations?mfcId=&zone=&temperatureZone=&state=`(커서 "더 보기"). 거르기는 URL 쿼리에.
// - 등록 `POST /locations`(201 Location), 속성 변경 `PUT /locations/{id}`(전체 교체 + X-Expected-Version — 보내지 않은 값은 지워진다, 코드는 못 바꿈).
// - 닫기·다시 열기 `POST …/state-changes`(사유 필수) → CommandResponse, ACCEPTED·결과 불명은 짝 조회 `GET …/state-changes/{requestId}`.
// - 폐지 `DELETE /locations/{id}`(CLOSED·재고 0 만, 되돌릴 수 없음) → CommandResponse. 짝 조회가 없어 결과가 확정되지 않으면 칸을 다시 읽어 RETIRED 인지 본다.
// - COUNT_LOCKED 는 실사 잠금(실사 세션이 건다) — 이 화면에서 걸거나 풀지 않는다.
// 권한 판정은 서버(그 센터 centers — 403 은 "이 센터 권한이 없습니다").
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation as useRouterLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { CommandRejectedFailure, request, settleCommand, UnknownResultFailure, type CommandResponse, type IdempotencyKey } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-location';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { GuideBox, SearchBar } from '../../shared/listParts';
import { SavedViews } from '../../shared/SavedViews';
import { SystemNumbers } from '../../shared/displayNumber';
import { messages } from '../../shared/messages';
import { useRecordRecent, useSeenIds } from '../../shared/recentViews';
import { SeenMark } from '../../shared/SeenMark';
import { StickyTitle, useScrolledPast } from '../../shared/StickyTitle';
import { QueueNav, useRememberQueue } from '../../shared/workQueue';

const m = messages.locations;

export type Location = components['schemas']['Location'];
type LocationBody = components['schemas']['LocationBody'];
type Zone = components['schemas']['ZoneKind'];
type Temperature = components['schemas']['TemperatureZone'];
type LocationState = components['schemas']['LocationState'];

const ZONES: readonly Zone[] = ['RECEIVING', 'STORAGE', 'PICKING', 'PACKING', 'QUARANTINE', 'DISPATCH_STAGING', 'RETURN', 'DISPOSAL', 'CART'];
const TEMPERATURES: readonly Temperature[] = ['AMBIENT', 'CHILLED', 'FROZEN'];
const STATES: readonly LocationState[] = ['ACTIVE', 'CLOSED', 'COUNT_LOCKED', 'RETIRED'];

/** 한 번에 받는 칸 수(계약 PageSize 기본값) */
export const LOCATION_PAGE_SIZE = 50;

const isZone = (v: string | null): v is Zone => !!v && (ZONES as readonly string[]).includes(v);
const isTemperature = (v: string | null): v is Temperature => !!v && (TEMPERATURES as readonly string[]).includes(v);
const isState = (v: string | null): v is LocationState => !!v && (STATES as readonly string[]).includes(v);

const locationsPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `locations/${rest}` : 'locations');

/** `/c/:mfcId/locations/*` */
export function LocationsMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<LocationListPage mfcId={mfcId} />} />
      <Route path="new" element={<LocationRegisterPage mfcId={mfcId} />} />
      <Route path=":locationId" element={<LocationDetailPage mfcId={mfcId} />} />
    </Routes>
  );
}

// ---------------------------------------------------------------- 목록

function LocationListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const zone = params.get('zone');
  const temperatureZone = params.get('temperatureZone');
  const state = params.get('state');
  const filter = {
    ...(isZone(zone) ? { zone } : {}),
    ...(isTemperature(temperatureZone) ? { temperatureZone } : {}),
    ...(isState(state) ? { state } : {}),
  };
  const query = useInfiniteQuery({
    queryKey: ['locations', mfcId, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.location.GET('/locations', {
          params: { query: { mfcId, ...filter, size: LOCATION_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const rows = (query.data?.pages ?? []).flatMap((p) => p.items ?? []);
  const state$ = toUiState(query, () => rows.length === 0);
  const seen = useSeenIds('location', mfcId);
  const { pathname, search } = useRouterLocation();
  useRememberQueue('location', mfcId, query.data ? rows.map((l) => l.locationId ?? '').filter(Boolean) : undefined, `${pathname}${search}`);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{messages.menus.locations}</h1>
        <Link to={locationsPath(mfcId, 'new')} className="btn btn-sm btn-primary">
          {m.register}
        </Link>
      </div>
      <GuideBox title={messages.listParts.guideOf(messages.menus.locations)} storeKey="locations" items={[m.intro]} />
      <SearchBar
        label={m.filter}
        summary={[
          [m.fields.zone, zone ? (m.zone[zone] ?? zone) : ''],
          [m.fields.temperatureZone, temperatureZone ? (m.temperature[temperatureZone] ?? temperatureZone) : ''],
          [m.fields.state, state ? (m.state[state] ?? state) : ''],
        ]}
      >
        <FilterSelect label={m.fields.zone} value={zone ?? ''} options={ZONES} names={m.zone} onChange={(v) => setFilter('zone', v)} />
        <FilterSelect label={m.fields.temperatureZone} value={temperatureZone ?? ''} options={TEMPERATURES} names={m.temperature} onChange={(v) => setFilter('temperatureZone', v)} />
        <FilterSelect label={m.fields.state} value={state ?? ''} options={STATES} names={m.state} onChange={(v) => setFilter('state', v)} />
      </SearchBar>
      <SavedViews listKey={`locations.${mfcId}`} />
      <QueryState state={state$} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {() => (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-box bg-base-100">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{m.fields.code}</th>
                  <th>{m.fields.zone}</th>
                  <th>{m.fields.temperatureZone}</th>
                  <th>{m.fields.areaCode}</th>
                  <th>{m.fields.state}</th>
                  <th>{m.fields.pickSequence}</th>
                  <th>{m.fields.highTurnover}</th>
                  <th>{m.fields.updatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.locationId} data-testid="location-row">
                    <td>
                      <Link className="link font-mono" to={locationsPath(mfcId, encodeURIComponent(l.locationId ?? ''))}>
                        {l.locationCode}
                      </Link>
                      <SeenMark seen={seen.has(l.locationId ?? '')} />
                    </td>
                    <td>{m.zone[l.zone] ?? l.zone}</td>
                    <td>{m.temperature[l.temperatureZone] ?? l.temperatureZone}</td>
                    <td>{l.areaCode ?? messages.none}</td>
                    <td>
                      <StateBadge state={l.state} />
                      {l.stateReason && <span className="ml-1 text-xs opacity-70">{l.stateReason}</span>}
                    </td>
                    <td>{l.pickSequence ?? messages.none}</td>
                    <td>{l.highTurnover ? m.yes : messages.none}</td>
                    <td>{l.updatedAt ? formatSeoul(l.updatedAt) : messages.none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {query.hasNextPage && (
              <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {m.more}
              </button>
            )}
            {/* 다음 쪽을 못 받으면 받은 것까지만 보이고 실패를 알린다(빈 목록으로 바꾸지 않는다) */}
            {query.isFetchNextPageError && (
              <p role="alert" className="text-error text-sm">
                {messages.errorTitle}
              </p>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  names,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly names: Readonly<Record<string, string>>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <select className="select select-sm w-36" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{m.all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {names[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

function StateBadge({ state }: { readonly state: LocationState | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'ACTIVE' ? 'badge-success' : state === 'RETIRED' ? 'badge-ghost' : 'badge-warning';
  return <span className={`badge badge-sm ${tone}`}>{m.state[state] ?? state}</span>;
}

// ---------------------------------------------------------------- 입력 양식(등록·속성 변경 공용)

interface FormValues {
  readonly locationCode: string;
  readonly zone: Zone;
  readonly temperatureZone: Temperature;
  readonly areaCode: string;
  readonly widthMm: string;
  readonly depthMm: string;
  readonly heightMm: string;
  readonly slotCount: string;
  readonly maxWeightG: string;
  readonly pickSequence: string;
  readonly categoryId: string;
  readonly positionX: string;
  readonly positionZ: string;
  readonly highTurnover: boolean;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function formFrom(l: Location | undefined): FormValues {
  return {
    locationCode: l?.locationCode ?? '',
    zone: l?.zone ?? 'STORAGE',
    temperatureZone: l?.temperatureZone ?? 'AMBIENT',
    areaCode: l?.areaCode ?? '',
    widthMm: str(l?.dimensions?.widthMm),
    depthMm: str(l?.dimensions?.depthMm),
    heightMm: str(l?.dimensions?.heightMm),
    slotCount: str(l?.dimensions?.slotCount),
    maxWeightG: str(l?.dimensions?.maxWeightG),
    pickSequence: str(l?.pickSequence),
    categoryId: l?.categoryId ?? '',
    positionX: str(l?.position?.xM),
    positionZ: str(l?.position?.zM),
    highTurnover: l?.highTurnover ?? false,
  };
}

const int = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** 입력 → 계약 LocationBody. PUT 은 전체 교체라 지금 값 전부를 다시 보낸다(position 을 빼면 지워진다). */
function bodyFrom(mfcId: string, v: FormValues): LocationBody {
  const dimensions = {
    ...(int(v.widthMm) === undefined ? {} : { widthMm: int(v.widthMm)! }),
    ...(int(v.depthMm) === undefined ? {} : { depthMm: int(v.depthMm)! }),
    ...(int(v.heightMm) === undefined ? {} : { heightMm: int(v.heightMm)! }),
    ...(int(v.slotCount) === undefined ? {} : { slotCount: int(v.slotCount)! }),
    ...(int(v.maxWeightG) === undefined ? {} : { maxWeightG: int(v.maxWeightG)! }),
  };
  const x = int(v.positionX);
  const z = int(v.positionZ);
  return {
    mfcId,
    locationCode: v.locationCode.trim(),
    zone: v.zone,
    temperatureZone: v.temperatureZone,
    ...(v.areaCode.trim() ? { areaCode: v.areaCode.trim() } : {}),
    dimensions,
    ...(int(v.pickSequence) === undefined ? {} : { pickSequence: int(v.pickSequence)! }),
    categoryId: v.categoryId.trim() || null,
    position: x === undefined || z === undefined ? null : { xM: x, zM: z },
    highTurnover: v.highTurnover,
  };
}

const positionHalf = (v: FormValues) => (v.positionX.trim() === '') !== (v.positionZ.trim() === '');

function LocationForm({
  initial,
  codeEditable,
  submitLabel,
  busy,
  onSubmit,
  children,
}: {
  readonly initial: FormValues;
  readonly codeEditable: boolean;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: (v: FormValues) => void;
  readonly children?: ReactNode;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const half = positionHalf(v);
  const ok = v.locationCode.trim() !== '' && !half;
  const num = (k: 'widthMm' | 'depthMm' | 'heightMm' | 'slotCount' | 'maxWeightG' | 'pickSequence', label: string) => (
    <label className="flex flex-col gap-1">
      {label}
      <input className="input input-sm w-32" type="number" min={0} step={1} value={v[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const metre = (k: 'positionX' | 'positionZ', label: string) => (
    <label className="flex flex-col gap-1">
      {label}
      <input className="input input-sm w-32" type="number" min={0} max={1000} step={0.1} value={v[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <form
      className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(v);
      }}
    >
      <label className="flex flex-col gap-1">
        {m.fields.code}
        <input
          className="input input-sm w-56 font-mono"
          maxLength={32}
          required
          readOnly={!codeEditable}
          value={v.locationCode}
          onChange={(e) => set('locationCode', e.target.value.toUpperCase())}
        />
        <span className="text-xs opacity-70">{codeEditable ? m.codeHint : m.codeFixed}</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          {m.fields.zone}
          <select className="select select-sm w-36" value={v.zone} onChange={(e) => set('zone', e.target.value as Zone)}>
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {m.zone[z] ?? z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.fields.temperatureZone}
          <select className="select select-sm w-28" value={v.temperatureZone} onChange={(e) => set('temperatureZone', e.target.value as Temperature)}>
            {TEMPERATURES.map((t) => (
              <option key={t} value={t}>
                {m.temperature[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.fields.areaCode}
          <input className="input input-sm w-28" value={v.areaCode} onChange={(e) => set('areaCode', e.target.value.toUpperCase())} />
          <span className="text-xs opacity-70">{m.areaHint}</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        {num('widthMm', m.fields.widthMm)}
        {num('depthMm', m.fields.depthMm)}
        {num('heightMm', m.fields.heightMm)}
        {num('slotCount', m.fields.slotCount)}
        {num('maxWeightG', m.fields.maxWeightG)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {num('pickSequence', m.fields.pickSequence)}
        <label className="flex flex-col gap-1">
          {m.fields.categoryId}
          <input className="input input-sm w-48" maxLength={64} value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} />
          <span className="text-xs opacity-70">{m.categoryHint}</span>
        </label>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-3">
          {metre('positionX', m.fields.positionX)}
          {metre('positionZ', m.fields.positionZ)}
        </div>
        <p className="text-xs opacity-70">{m.positionHint}</p>
        {half && <p className="text-error text-xs">{m.positionPair}</p>}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="checkbox checkbox-sm" checked={v.highTurnover} onChange={(e) => set('highTurnover', e.target.checked)} />
        {m.fields.highTurnover}
        <span className="text-xs opacity-70">{m.highTurnoverHint}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || busy}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- 등록

function LocationRegisterPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useCommand(async (v: FormValues, key) => {
    const created = await request('POST', api.location.POST('/locations', { ...commandParams(key), body: bodyFrom(mfcId, v) }));
    await queryClient.invalidateQueries({ queryKey: ['locations', mfcId] });
    if (created.locationId) {
      queryClient.setQueryData(['location', created.locationId], created);
      void navigate(locationsPath(mfcId, encodeURIComponent(created.locationId)), { state: { created: true } });
    }
    return created;
  });
  return (
    <section className="max-w-3xl space-y-4">
      <Link to={locationsPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <h1>{m.register}</h1>
      <LocationForm
        initial={formFrom(undefined)}
        codeEditable
        submitLabel={m.register}
        busy={create.busy}
        onSubmit={(v) => {
          if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
          void create.run(v);
        }}
      >
        <CommandFeedback command={create}>{() => <span className="text-success text-xs">{m.created}</span>}</CommandFeedback>
      </LocationForm>
    </section>
  );
}

// ---------------------------------------------------------------- 상세

function useLocation(locationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['location', locationId],
    queryFn: () => request('GET', api.location.GET('/locations/{locationId}', { params: { path: { locationId } } })),
  });
}

/** 완료 문구. 성공 뒤 칸을 다시 읽으면 양식이 새 버전으로 다시 그려지므로 문구는 상세 화면이 들고 있는다 */
type Notify = (text: string | null) => void;

function LocationDetailPage({ mfcId }: { readonly mfcId: string }) {
  const { locationId = '' } = useParams();
  const query = useLocation(locationId);
  const location = useRouterLocation();
  const [notice, setNotice] = useState<string | null>((location.state as { created?: boolean } | null)?.created ? m.created : null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const past = useScrolledPast(titleRef);
  // 칸 코드(A-H2-01)가 화면 표기 — 칸 ID 는 시스템 번호 칸에만
  useRecordRecent('location', mfcId, locationId, query.data?.locationCode);
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={locationsPath(mfcId)} className="link text-sm">
          {m.back}
        </Link>
        <div className="ml-auto">
          <QueueNav kind="location" mfcId={mfcId} id={locationId} />
        </div>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(l) => (
          <>
            <h1 ref={titleRef} className="flex items-center gap-2">
              <span className="font-mono">{l.locationCode}</span>
              <StateBadge state={l.state} />
            </h1>
            <StickyTitle show={past} title={l.locationCode} badges={<StateBadge state={l.state} />} />
            {notice && (
              <p role="status" className="text-success text-sm">
                {notice}
              </p>
            )}
            <Attributes location={l} />
            <StateSection mfcId={mfcId} location={l} onDone={setNotice} />
            {l.state !== 'RETIRED' && (
              <details className="rounded-box bg-base-100">
                <summary className="cursor-pointer p-3 font-semibold">{m.edit}</summary>
                {/* 서버 버전이 바뀌면 양식을 새 값으로 다시 연다 */}
                <EditLocation key={l.version} mfcId={mfcId} location={l} onDone={setNotice} />
              </details>
            )}
            <SystemNumbers ids={[{ label: m.locationLabel, id: l.locationId }]} />
          </>
        )}
      </QueryState>
    </section>
  );
}

function Attributes({ location: l }: { readonly location: Location }) {
  const d = l.dimensions ?? {};
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [m.fields.zone, m.zone[l.zone] ?? l.zone],
    [m.fields.temperatureZone, m.temperature[l.temperatureZone] ?? l.temperatureZone],
    [m.fields.areaCode, l.areaCode ?? messages.none],
    [m.fields.stateReason, l.stateReason ?? messages.none],
    [m.fields.widthMm, d.widthMm ?? messages.none],
    [m.fields.depthMm, d.depthMm ?? messages.none],
    [m.fields.heightMm, d.heightMm ?? messages.none],
    [m.fields.slotCount, d.slotCount ?? messages.none],
    [m.fields.maxWeightG, d.maxWeightG ?? messages.none],
    [m.fields.pickSequence, l.pickSequence ?? messages.none],
    [m.fields.categoryId, l.categoryId ?? messages.none],
    [m.fields.positionX, l.position ? l.position.xM : messages.none],
    [m.fields.positionZ, l.position ? l.position.zM : messages.none],
    [m.fields.highTurnover, l.highTurnover ? m.yes : m.no],
    [m.fields.version, l.version ?? messages.none],
    [m.fields.updatedAt, l.updatedAt ? formatSeoul(l.updatedAt) : messages.none],
  ];
  return (
    <div className="rounded-box bg-base-100 p-4">
      <h2 className="mb-2 font-semibold">{m.attributes}</h2>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="opacity-70">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EditLocation({ mfcId, location, onDone }: { readonly mfcId: string; readonly location: Location; readonly onDone: Notify }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const locationId = location.locationId ?? '';
  const save = useCommand(async (v: FormValues, key) => {
    onDone(null);
    const saved = await request(
      'PUT',
      api.location.PUT('/locations/{locationId}', { ...commandParams(key, { path: { locationId }, version: location.version }), body: bodyFrom(mfcId, v) }),
    );
    onDone(m.saved);
    queryClient.setQueryData(['location', locationId], saved);
    await queryClient.invalidateQueries({ queryKey: ['locations', mfcId] });
    return saved;
  });
  return (
    <div className="px-1 pb-1">
      <LocationForm
        initial={formFrom(location)}
        codeEditable={false}
        submitLabel={m.save}
        busy={save.busy}
        onSubmit={(v) => {
          if (save.phase.kind === 'rejected' || save.phase.kind === 'done') save.reset();
          void save.run(v);
        }}
      >
        <CommandFeedback command={save} />
      </LocationForm>
    </div>
  );
}

// ---------------------------------------------------------------- 상태: 닫기·다시 열기·폐지

function StateSection({ mfcId, location, onDone }: { readonly mfcId: string; readonly location: Location; readonly onDone: Notify }) {
  const state = location.state;
  return (
    <div className="space-y-3 rounded-box bg-base-100 p-4 text-sm">
      <h2 className="font-semibold">{m.stateSection}</h2>
      {state === 'RETIRED' && <p>{m.retiredState}</p>}
      {state === 'COUNT_LOCKED' && <p>{m.countLocked}</p>}
      {state === 'ACTIVE' && <ChangeState key={`close-${location.version}`} mfcId={mfcId} location={location} target="CLOSED" onDone={onDone} />}
      {state === 'CLOSED' && (
        <>
          <ChangeState key={`open-${location.version}`} mfcId={mfcId} location={location} target="ACTIVE" onDone={onDone} />
          <Retire key={`retire-${location.version}`} mfcId={mfcId} location={location} onDone={onDone} />
        </>
      )}
    </div>
  );
}

function useRefresh(mfcId: string, locationId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['location', locationId] });
    await queryClient.invalidateQueries({ queryKey: ['locations', mfcId] });
  };
}

function ChangeState({
  mfcId,
  location,
  target,
  onDone,
}: {
  readonly mfcId: string;
  readonly location: Location;
  readonly target: 'ACTIVE' | 'CLOSED';
  readonly onDone: Notify;
}) {
  const api = useApi();
  const locationId = location.locationId ?? '';
  const refresh = useRefresh(mfcId, locationId);
  const [reason, setReason] = useState('');
  const change = useCommand(async (v: { reason: string }, key: IdempotencyKey) => {
    onDone(null);
    const r = await settleCommand(
      key,
      () =>
        request(
          'POST',
          api.location.POST('/locations/{locationId}/state-changes', {
            ...commandParams(key, { path: { locationId }, version: location.version }),
            body: { targetState: target, reason: v.reason },
          }),
        ),
      (requestId) =>
        request('GET', api.location.GET('/locations/{locationId}/state-changes/{requestId}', { params: { path: { locationId, requestId } } })),
    );
    onDone(target === 'CLOSED' ? m.closed : m.opened);
    await refresh();
    return r;
  });
  const label = target === 'CLOSED' ? m.close : m.open;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (change.phase.kind === 'rejected') change.reset();
        void change.run({ reason: reason.trim() });
      }}
    >
      <label className="flex flex-col gap-1">
        {`${label} ${m.reason}`}
        <input className="input input-sm w-72" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className={`btn btn-sm ${target === 'CLOSED' ? 'btn-warning' : ''}`} disabled={!reason.trim() || change.busy}>
        {label}
      </button>
      {target === 'CLOSED' && <p className="w-full text-xs opacity-70">{m.closeHint}</p>}
      <div className="w-full">
        <CommandFeedback command={change} />
      </div>
    </form>
  );
}

function Retire({ mfcId, location, onDone }: { readonly mfcId: string; readonly location: Location; readonly onDone: Notify }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const locationId = location.locationId ?? '';
  const refresh = useRefresh(mfcId, locationId);
  const [confirmed, setConfirmed] = useState(false);
  const retire = useCommand(async (_: null, key: IdempotencyKey) => {
    onDone(null);
    let first: CommandResponse | undefined;
    try {
      first = await request('DELETE', api.location.DELETE('/locations/{locationId}', { ...commandParams(key, { path: { locationId }, version: location.version }) }));
    } catch (e) {
      if (!(e instanceof UnknownResultFailure)) throw e;
    }
    const requestId = first?.requestId;
    if (first?.status === 'REJECTED') throw new CommandRejectedFailure(first.nextAction, requestId);
    if (first?.status !== 'APPLIED') {
      // 접수·결과 불명: 폐지 결과 조회 API 가 없어 칸을 다시 읽는다. RETIRED 가 아니면 불명으로 남긴다(실패로 확정하지 않음).
      const now = await request('GET', api.location.GET('/locations/{locationId}', { params: { path: { locationId } } }));
      queryClient.setQueryData(['location', locationId], now);
      if (now.state !== 'RETIRED') throw new UnknownResultFailure(undefined, requestId ?? key.value);
    }
    onDone(m.retired);
    await refresh();
    return true;
  });
  return (
    <div className="space-y-2 border-t border-base-200 pt-3">
      <p className="text-xs opacity-70">{m.retireHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-sm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {m.retireConfirm}
        </label>
        <button
          type="button"
          className="btn btn-sm btn-error"
          disabled={!confirmed || retire.busy}
          onClick={() => {
            if (retire.phase.kind === 'rejected') retire.reset();
            void retire.run(null);
          }}
        >
          {m.retire}
        </button>
      </div>
      <CommandFeedback command={retire} />
    </div>
  );
}
