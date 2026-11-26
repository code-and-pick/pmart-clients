// 출하·운송 — 차량·기사 탭(fleet 0.2.0: 운송사·차량·기사 등록·조회·차량 바꾸기)과 노선 등록·정규차 지정(transport-planning 0.2.0).
// 모두 Idempotency-Key. 차량 바꾸기는 X-Expected-Version. 적격 판정(정규차·온도대·사용 중·07:30·같은 MFC)은 서버 — 화면은 고를 수 있는 것만 보이고 서버 거절을 그대로 알린다.
// 기사는 표시 이름만(계약 — 실명·연락처·면허 번호를 받지 않는다).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components as F } from '../../api/generated/fleet';
import type { components as P } from '../../api/generated/transport-planning';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { tempLabel } from './TransportPage';

const t = messages.transport;
type Fleet = F['schemas'];
type Temp = Fleet['TempClass'];
type Route = P['schemas']['Route'];
const TEMPS: readonly Temp[] = ['AMBIENT', 'CHILLED', 'FROZEN'];
const fleetKey = ['fleet'] as const;
const toInt = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

function Ok({ text }: { readonly text: string }) {
  return (
    <p role="status" className="alert alert-info py-1 text-sm">
      {text}
    </p>
  );
}

function useFleet() {
  const api = useApi();
  const carriers = useQuery({ queryKey: [...fleetKey, 'carriers'], queryFn: () => request('GET', api.fleet.GET('/carriers')) });
  const vehicles = useQuery({ queryKey: [...fleetKey, 'vehicles'], queryFn: () => request('GET', api.fleet.GET('/vehicles')) });
  const drivers = useQuery({ queryKey: [...fleetKey, 'drivers'], queryFn: () => request('GET', api.fleet.GET('/drivers')) });
  return { carriers, vehicles, drivers };
}

/** 등록 명령 — 끝나면 fleet 목록을 다시 읽는다 */
function useFleetCommand<V, T>(send: (v: V, key: Parameters<typeof commandParams>[0]) => Promise<T>) {
  const qc = useQueryClient();
  const cmd = useCommand(send);
  const run = (v: V) =>
    cmd.run(v).then((p) => {
      if (p.kind === 'done') void qc.invalidateQueries({ queryKey: fleetKey });
      return p;
    });
  return { cmd, run };
}

export function FleetView() {
  const { carriers, vehicles, drivers } = useFleet();
  const carrierName = (id: string) => carriers.data?.items.find((c) => c.carrierId === id)?.name ?? id;
  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-sm text-base-content/60">{t.fleetLead}</p>

      <section className="space-y-2" data-testid="fleet-vehicles">
        <h2 className="text-base font-semibold">{t.vehicles}</h2>
        <NewVehicle carriers={carriers.data?.items ?? []} />
        <QueryState state={toUiState(vehicles, (d) => d.items.length === 0)} onRetry={() => void vehicles.refetch()} emptyText={t.noVehicles}>
          {(data) => (
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>{t.vehicleId}</th>
                    <th>{t.plate}</th>
                    <th>{t.carriers}</th>
                    <th>{t.contractLabel}</th>
                    <th>{t.tempLabel}</th>
                    <th className="text-right">{t.tonnage}</th>
                    <th className="text-right">{t.maxRtLabel}</th>
                    <th className="text-right">{t.maxKg}</th>
                    <th>{t.activeLabel}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <VehicleRow key={v.vehicleId} v={v} carrier={carrierName(v.carrierId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
        <p className="text-xs text-base-content/55">{t.vehicleHint}</p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-2" data-testid="fleet-drivers">
          <h2 className="text-base font-semibold">{t.drivers}</h2>
          <NewDriver carriers={carriers.data?.items ?? []} />
          <QueryState state={toUiState(drivers, (d) => d.items.length === 0)} onRetry={() => void drivers.refetch()} emptyText={t.noDrivers}>
            {(data) => (
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>{t.driverId}</th>
                      <th>{t.displayName}</th>
                      <th>{t.carriers}</th>
                      <th>{t.activeLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((d) => (
                      <tr key={d.driverId} data-testid="driver-row">
                        <td className="font-mono text-xs">{d.driverId}</td>
                        <td>{d.displayName}</td>
                        <td>{carrierName(d.carrierId)}</td>
                        <td>{d.active ? t.active : <span className="text-base-content/50">{t.stopped}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </section>

        <section className="space-y-2" data-testid="fleet-carriers">
          <h2 className="text-base font-semibold">{t.carriers}</h2>
          <NewCarrier />
          <QueryState state={toUiState(carriers, (d) => d.items.length === 0)} onRetry={() => void carriers.refetch()} emptyText={t.noCarriers}>
            {(data) => (
              <ul className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100 text-sm">
                {data.items.map((c) => (
                  <li key={c.carrierId} className="flex justify-between px-3 py-2" data-testid="carrier-row">
                    <span>{c.name}</span>
                    <span className="font-mono text-xs text-base-content/60">{c.carrierId}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </section>
      </div>
    </div>
  );
}

function VehicleRow({ v, carrier }: { readonly v: Fleet['Vehicle']; readonly carrier: string }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ plateNo: v.plateNo ?? '', maxRt: String(v.maxRt), maxWeightKg: String(v.maxWeightKg), active: v.active });
  const c = useFleetCommand((body: { plateNo?: string; maxRt?: number; maxWeightKg?: number; active?: boolean }, key) =>
    request('POST', api.fleet.POST('/vehicles/{vehicleId}/changes', { ...commandParams(key, { path: { vehicleId: v.vehicleId }, version: v.version }), body })),
  );
  const rt = toInt(f.maxRt);
  const kg = toInt(f.maxWeightKg);
  if (!editing)
    return (
      <tr data-testid="vehicle-row">
        <td className="font-mono text-xs">{v.vehicleId}</td>
        <td className="whitespace-nowrap">{v.plateNo ?? messages.none}</td>
        <td className="whitespace-nowrap">{carrier}</td>
        <td>{t.contract[v.contractType] ?? v.contractType}</td>
        <td>{tempLabel(v.tempClass)}</td>
        <td className="text-right">{v.tonnage}</td>
        <td className="text-right">{v.maxRt}</td>
        <td className="text-right">{v.maxWeightKg.toLocaleString('ko-KR')}</td>
        <td>{v.active ? t.active : <span className="text-base-content/50">{t.stopped}</span>}</td>
        <td className="text-right">
          <button type="button" className="btn btn-xs" onClick={() => setEditing(true)} data-testid="vehicle-edit">
            {t.edit}
          </button>
        </td>
      </tr>
    );
  return (
    <tr data-testid="vehicle-row">
      <td className="font-mono text-xs">{v.vehicleId}</td>
      <td>
        <input className="input input-xs w-32" maxLength={20} value={f.plateNo} onChange={(e) => setF({ ...f, plateNo: e.target.value })} />
      </td>
      <td className="whitespace-nowrap">{carrier}</td>
      <td>{t.contract[v.contractType] ?? v.contractType}</td>
      <td>{tempLabel(v.tempClass)}</td>
      <td className="text-right">{v.tonnage}</td>
      <td className="text-right">
        <input className="input input-xs w-14 text-right" inputMode="numeric" value={f.maxRt} onChange={(e) => setF({ ...f, maxRt: e.target.value })} data-testid="vehicle-maxrt" />
      </td>
      <td className="text-right">
        <input className="input input-xs w-20 text-right" inputMode="numeric" value={f.maxWeightKg} onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })} />
      </td>
      <td>
        <input type="checkbox" className="toggle toggle-xs" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} aria-label={t.activeLabel} />
      </td>
      <td className="whitespace-nowrap text-right">
        <button
          type="button"
          className="btn btn-xs btn-primary"
          disabled={rt === null || rt < 1 || rt > 60 || kg === null || kg < 1 || c.cmd.busy}
          data-testid="vehicle-save"
          onClick={() =>
            void c.run({ ...(f.plateNo.trim() ? { plateNo: f.plateNo.trim() } : {}), maxRt: rt ?? v.maxRt, maxWeightKg: kg ?? v.maxWeightKg, active: f.active }).then((p) => {
              if (p.kind === 'done') setEditing(false);
            })
          }
        >
          {t.save}
        </button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditing(false)}>
          {t.close}
        </button>
        <CommandFeedback command={c.cmd}>{() => null}</CommandFeedback>
      </td>
    </tr>
  );
}

function NewVehicle({ carriers }: { readonly carriers: readonly Fleet['Carrier'][] }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vehicleId: 'VH-', carrierId: '', plateNo: '', contractType: 'REGULAR' as Fleet['ContractType'], tempClass: 'CHILLED' as Temp, tonnage: '5', maxRt: '20', maxWeightKg: '5000' });
  const c = useFleetCommand((body: Fleet['VehicleInput'], key) => request('POST', api.fleet.POST('/vehicles', { ...commandParams(key, {}), body })));
  const carrierId = f.carrierId || carriers[0]?.carrierId || '';
  const tonnage = Number(f.tonnage);
  const rt = toInt(f.maxRt);
  const kg = toInt(f.maxWeightKg);
  const valid = /^VH-[A-Z0-9-]{1,24}$/.test(f.vehicleId) && carrierId && tonnage >= 0.5 && tonnage <= 25 && rt !== null && rt >= 1 && rt <= 60 && kg !== null && kg >= 1;
  if (!open)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} data-testid="vehicle-new">
        {t.vehicles} {t.register}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3"
      data-testid="vehicle-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void c.run({ vehicleId: f.vehicleId, carrierId, contractType: f.contractType, tempClass: f.tempClass, tonnage, maxRt: rt, maxWeightKg: kg, ...(f.plateNo.trim() ? { plateNo: f.plateNo.trim() } : {}) });
      }}
    >
      <Field label={t.vehicleId}>
        <input className="input input-sm w-32 font-mono" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value.toUpperCase() })} data-testid="vehicle-id" />
      </Field>
      <Field label={t.carriers}>
        <select className="select select-sm w-32" value={carrierId} onChange={(e) => setF({ ...f, carrierId: e.target.value })}>
          {carriers.map((x) => (
            <option key={x.carrierId} value={x.carrierId}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.plate}>
        <input className="input input-sm w-32" maxLength={20} value={f.plateNo} onChange={(e) => setF({ ...f, plateNo: e.target.value })} />
      </Field>
      <Field label={t.contractLabel}>
        <select className="select select-sm w-24" value={f.contractType} onChange={(e) => setF({ ...f, contractType: e.target.value as Fleet['ContractType'] })}>
          <option value="REGULAR">{t.contract.REGULAR}</option>
          <option value="SPOT">{t.contract.SPOT}</option>
        </select>
      </Field>
      <Field label={t.tempLabel}>
        <select className="select select-sm w-24" value={f.tempClass} onChange={(e) => setF({ ...f, tempClass: e.target.value as Temp })} data-testid="vehicle-temp">
          {TEMPS.map((x) => (
            <option key={x} value={x}>
              {tempLabel(x)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.tonnage}>
        <input className="input input-sm w-16" inputMode="decimal" value={f.tonnage} onChange={(e) => setF({ ...f, tonnage: e.target.value })} />
      </Field>
      <Field label={t.maxRtLabel}>
        <input className="input input-sm w-16" inputMode="numeric" value={f.maxRt} onChange={(e) => setF({ ...f, maxRt: e.target.value })} />
      </Field>
      <Field label={t.maxKg}>
        <input className="input input-sm w-20" inputMode="numeric" value={f.maxWeightKg} onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })} />
      </Field>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || c.cmd.busy} data-testid="vehicle-go">
        {t.register}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>{() => <Ok text={t.registered} />}</CommandFeedback>
      </div>
    </form>
  );
}

function NewDriver({ carriers }: { readonly carriers: readonly Fleet['Carrier'][] }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ driverId: 'DR-', carrierId: '', displayName: '' });
  const c = useFleetCommand((body: Fleet['DriverInput'], key) => request('POST', api.fleet.POST('/drivers', { ...commandParams(key, {}), body })));
  const carrierId = f.carrierId || carriers[0]?.carrierId || '';
  const valid = /^DR-[A-Z0-9-]{1,24}$/.test(f.driverId) && carrierId && f.displayName.trim();
  if (!open)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} data-testid="driver-new">
        {t.drivers} {t.register}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3"
      data-testid="driver-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void c.run({ driverId: f.driverId, carrierId, displayName: f.displayName.trim() });
      }}
    >
      <Field label={t.driverId}>
        <input className="input input-sm w-28 font-mono" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value.toUpperCase() })} data-testid="driver-id" />
      </Field>
      <Field label={t.carriers}>
        <select className="select select-sm w-32" value={carrierId} onChange={(e) => setF({ ...f, carrierId: e.target.value })}>
          {carriers.map((x) => (
            <option key={x.carrierId} value={x.carrierId}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.displayName}>
        <input className="input input-sm w-40" maxLength={30} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} data-testid="driver-name" />
      </Field>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || c.cmd.busy} data-testid="driver-go">
        {t.register}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>{() => <Ok text={t.registered} />}</CommandFeedback>
      </div>
    </form>
  );
}

function NewCarrier() {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ carrierId: 'CR-', name: '' });
  const c = useFleetCommand((body: Fleet['CarrierInput'], key) => request('POST', api.fleet.POST('/carriers', { ...commandParams(key, {}), body })));
  const valid = /^CR-[A-Z0-9-]{1,20}$/.test(f.carrierId) && f.name.trim();
  if (!open)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} data-testid="carrier-new">
        {t.carriers} {t.register}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void c.run({ carrierId: f.carrierId, name: f.name.trim() });
      }}
    >
      <Field label={t.carrierId}>
        <input className="input input-sm w-32 font-mono" value={f.carrierId} onChange={(e) => setF({ ...f, carrierId: e.target.value.toUpperCase() })} />
      </Field>
      <Field label={t.carrierName}>
        <input className="input input-sm w-40" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || c.cmd.busy}>
        {t.register}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>{() => <Ok text={t.registered} />}</CommandFeedback>
      </div>
    </form>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- 노선 등록·정규차 지정

const routesKey = (cdcId: string) => ['cdc', cdcId, 'routes'] as const;

export function NewRouteForm({ cdcId, onClose }: { readonly cdcId: string; readonly onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [f, setF] = useState({ routeId: 'RT-', name: '', departureTime: '22:00', returnMinutes: '90' });
  const [stops, setStops] = useState([{ mfcId: '', legMinutes: '60' }]);
  const cmd = useCommand(async (body: P['schemas']['RouteInput'], key) => request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/routes', { ...commandParams(key, { path: { cdcId } }), body })));
  const ret = toInt(f.returnMinutes);
  const legs = stops.map((s) => toInt(s.legMinutes));
  const valid =
    /^RT-[0-9]{2,3}$/.test(f.routeId) &&
    f.name.trim() &&
    /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(f.departureTime) &&
    ret !== null &&
    ret >= 1 &&
    ret <= 900 &&
    stops.every((s, i) => s.mfcId.trim() && legs[i] !== null && legs[i]! >= 1 && legs[i]! <= 900);
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      data-testid="route-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void cmd
          .run({ routeId: f.routeId, name: f.name.trim(), departureTime: f.departureTime, returnMinutes: ret, stops: stops.map((s, i) => ({ mfcId: s.mfcId.trim(), legMinutes: legs[i]! })) })
          .then((p) => {
            if (p.kind === 'done') void qc.invalidateQueries({ queryKey: routesKey(cdcId) });
          });
      }}
    >
      <p className="text-xs text-base-content/60">{t.routeHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t.routeId}>
          <input className="input input-sm w-28 font-mono" value={f.routeId} onChange={(e) => setF({ ...f, routeId: e.target.value.toUpperCase() })} data-testid="route-id" />
        </Field>
        <Field label={t.routeName}>
          <input className="input input-sm w-36" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="route-name" />
        </Field>
        <Field label={t.depTime}>
          <input className="input input-sm w-24 font-mono" value={f.departureTime} onChange={(e) => setF({ ...f, departureTime: e.target.value })} data-testid="route-dep" />
        </Field>
        <Field label={t.returnMin}>
          <input className="input input-sm w-20" inputMode="numeric" value={f.returnMinutes} onChange={(e) => setF({ ...f, returnMinutes: e.target.value })} />
        </Field>
      </div>
      <ol className="space-y-1">
        {stops.map((s, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <Field label={t.stopMfc(i + 1)}>
              <input className="input input-sm w-40 font-mono" value={s.mfcId} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, mfcId: e.target.value.toUpperCase() } : x)))} data-testid={`route-mfc-${i}`} />
            </Field>
            <Field label={t.legMin}>
              <input className="input input-sm w-20" inputMode="numeric" value={s.legMinutes} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, legMinutes: e.target.value } : x)))} data-testid={`route-leg-${i}`} />
            </Field>
            {stops.length > 1 && (
              <button type="button" className="btn btn-xs btn-ghost" onClick={() => setStops(stops.filter((_, j) => j !== i))}>
                {t.removeStop}
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {stops.length < 3 && (
          <button type="button" className="btn btn-sm" onClick={() => setStops([...stops, { mfcId: '', legMinutes: '30' }])} data-testid="route-add-stop">
            {t.addStop}
          </button>
        )}
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || cmd.busy} data-testid="route-go">
          {t.newRoute}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={cmd}>{(r) => <Ok text={t.routeCreated(r.routeId)} />}</CommandFeedback>
    </form>
  );
}

export function RegularVehicleForm({ cdcId, route, onClose }: { readonly cdcId: string; readonly route: Route; readonly onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { vehicles, drivers } = useFleet();
  const [temp, setTemp] = useState<Temp>('CHILLED');
  const current = route.regularVehicles.find((x) => x.tempClass === temp);
  const eligible = (vehicles.data?.items ?? []).filter((v) => v.active && v.contractType === 'REGULAR' && v.tempClass === temp);
  const activeDrivers = (drivers.data?.items ?? []).filter((d) => d.active);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const v = eligible.some((x) => x.vehicleId === vehicleId) ? vehicleId : (eligible.find((x) => x.vehicleId === current?.vehicleId) ?? eligible[0])?.vehicleId ?? '';
  const d = activeDrivers.some((x) => x.driverId === driverId) ? driverId : (activeDrivers.find((x) => x.driverId === current?.driverId) ?? activeDrivers[0])?.driverId ?? '';
  const cmd = useCommand(async (body: { tempClass: Temp; vehicleId: string; driverId: string }, key) =>
    request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/routes/{routeId}/regular-vehicles', { ...commandParams(key, { path: { cdcId, routeId: route.routeId } }), body })),
  );
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 p-2"
      data-testid="regular-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v || !d) return;
        void cmd.run({ tempClass: temp, vehicleId: v, driverId: d }).then((p) => {
          if (p.kind === 'done') void qc.invalidateQueries({ queryKey: routesKey(cdcId) });
        });
      }}
    >
      <p className="text-xs text-base-content/60">{t.regularHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t.tempLabel}>
          <select className="select select-sm w-24" value={temp} onChange={(e) => setTemp(e.target.value as Temp)} data-testid="regular-temp">
            {TEMPS.map((x) => (
              <option key={x} value={x}>
                {tempLabel(x)}
              </option>
            ))}
          </select>
        </Field>
        {eligible.length === 0 ? (
          <p className="text-sm text-warning">{t.noEligible}</p>
        ) : (
          <>
            <Field label={t.pickVehicle}>
              <select className="select select-sm w-52" value={v} onChange={(e) => setVehicleId(e.target.value)} data-testid="regular-vehicle">
                {eligible.map((x) => (
                  <option key={x.vehicleId} value={x.vehicleId}>
                    {x.vehicleId} · {x.plateNo ?? ''} · R/T {x.maxRt}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.pickDriver}>
              <select className="select select-sm w-36" value={d} onChange={(e) => setDriverId(e.target.value)} data-testid="regular-driver">
                {activeDrivers.map((x) => (
                  <option key={x.driverId} value={x.driverId}>
                    {x.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!v || !d || cmd.busy} data-testid="regular-go">
              {t.setRegular}
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={cmd}>{() => <Ok text={t.regularSet} />}</CommandFeedback>
    </form>
  );
}
