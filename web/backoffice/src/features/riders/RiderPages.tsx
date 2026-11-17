// 라이더 찾기·계정 제한(라이더 운영).
// - 찾기 `GET /riders`·상세 `GET /riders/{id}`(rider 0.4.0, BOD-3 — BR-54 끝): 라이더 ID·전화 완전 일치(이름 검색 없음), 이름·전화는 가린 값.
//   원문은 사유 + `POST /riders/{id}/pii-reveals`(주문 원문 열람과 같은 방식, ADR-0062).
// - 계정 제한 이력·걸기·바꾸기·풀기: `GET/POST /riders/{riderId}/restrictions`(X-Expected-Version = 상세의 라이더 version — BOD-6).
// - 이 라이더의 배송: execution 0.4.0 `GET /deliveries?riderId=`.
//   바꾸면 픽업 전 배정은 풀리고 다시 배차, 픽업한 배송은 끝까지 전달(서버). 지금 서버 권한은 OPERATOR_ADMIN 만(RIDER_OPS 는 PC 5 반영 뒤).
// 전화번호·이름은 개인정보 — 목록은 가린 값, 상세는 기본 가림. 로그 금지. 제한 사유에는 개인정보를 적지 않는다(계약 설명).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { Facts, label, text, when } from '../../shared/ops';
import { DeliveriesOf } from '../deliveries/DeliveryPages';
import { RiderComplaintTable } from '../riderComplaints/RiderComplaintPages';
import { ReviewTable } from './RestrictionReviewPage';
import { DataTable, PageHeader } from '../../shared/admin';


type Restriction = components['schemas']['AccountRestriction'];
type VehicleType = components['schemas']['VehicleType'];
type OperatingStatus = components['schemas']['OperatingStatus'];
type Sort = keyof typeof m.riders.sortName;
type PiiField = components['schemas']['RiderPiiField'];
type StaffRiderDetail = components['schemas']['StaffRiderDetail'];
type RestrictionRecord = components['schemas']['RiderRestrictionRecord'];
type RestrictionChange = components['schemas']['RiderRestrictionChange'];

const RESTRICTIONS = Object.keys(m.riders.restrictionName) as Restriction[];
const VEHICLES = Object.keys(m.riders.vehicleName) as VehicleType[];
const OPERATING = Object.keys(m.riders.operatingName) as OperatingStatus[];
const SORTS = Object.keys(m.riders.sortName) as Sort[];
const MAX_REASON = 500;
const PAGE_SIZE = 20;
const digits = (v: string) => v.replace(/\D/g, '');

interface Filter {
  readonly riderId: string;
  readonly phone: string;
  readonly restriction: string;
  readonly operatingStatus: string;
  readonly vehicleType: string;
  readonly sort: Sort;
}

/** 라이더 찾기(rider 0.4.0 `GET /riders`): 라이더 ID·전화번호 완전 일치 + 제한·운행·수단 거르기, 쪽(page 0부터·hasNext). 조건은 URL 쿼리. */
function RiderSearch() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const applied: Filter = {
    riderId: params.get('riderId') ?? '',
    phone: params.get('phone') ?? '',
    restriction: params.get('restriction') ?? '',
    operatingStatus: params.get('operatingStatus') ?? '',
    vehicleType: params.get('vehicleType') ?? '',
    sort: SORTS.find((s) => s === params.get('sort')) ?? 'JOINED_DESC',
  };
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const searched = params.has('q');
  const [draft, setDraft] = useState<Filter>(applied);
  const phoneBad = draft.phone !== '' && (digits(draft.phone).length < 10 || digits(draft.phone).length > 11);
  const query = useQuery({
    queryKey: ['riders', 'search', applied, page],
    enabled: searched,
    queryFn: () =>
      request(
        'GET',
        api.riders.GET('/riders', {
          params: {
            query: {
              size: PAGE_SIZE,
              page,
              sort: applied.sort,
              ...(applied.riderId ? { riderId: applied.riderId } : {}),
              ...(applied.phone ? { phone: digits(applied.phone) } : {}),
              ...(applied.restriction ? { restriction: applied.restriction as Restriction } : {}),
              ...(applied.operatingStatus ? { operatingStatus: applied.operatingStatus as OperatingStatus } : {}),
              ...(applied.vehicleType ? { vehicleType: applied.vehicleType as VehicleType } : {}),
            },
          },
        }),
      ),
  });
  const go = (f: Filter, p: number) =>
    setParams({
      q: '1',
      sort: f.sort,
      page: String(p),
      ...(f.riderId.trim() ? { riderId: f.riderId.trim() } : {}),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      ...(f.restriction ? { restriction: f.restriction } : {}),
      ...(f.operatingStatus ? { operatingStatus: f.operatingStatus } : {}),
      ...(f.vehicleType ? { vehicleType: f.vehicleType } : {}),
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!phoneBad) go(draft, 0);
  };
  const select = (key: keyof Filter, labelText: string, options: readonly string[], names: Readonly<Record<string, string>>, withAny = true) => (
    <label className="text-sm">
      {labelText}
      <select className="select select-sm mt-1 block" value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}>
        {withAny && <option value="">{m.riders.any}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {names[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <form className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-4" onSubmit={submit} aria-label={m.riders.search}>
        <label className="text-sm">
          {m.riders.riderId}
          <input className="input input-sm mt-1 block" autoComplete="off" value={draft.riderId} onChange={(e) => setDraft((d) => ({ ...d, riderId: e.target.value }))} />
        </label>
        <label className="text-sm">
          {m.riders.phone}
          <input className="input input-sm mt-1 block" inputMode="numeric" autoComplete="off" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
        </label>
        {select('restriction', m.riders.restriction, RESTRICTIONS, m.riders.restrictionName)}
        {select('operatingStatus', m.riders.operatingStatus, OPERATING, m.riders.operatingName)}
        {select('vehicleType', m.riders.vehicle, VEHICLES, m.riders.vehicleName)}
        {select('sort', m.riders.sort, SORTS, m.riders.sortName, false)}
        <button type="submit" className="btn btn-sm" disabled={phoneBad}>
          {m.riders.search}
        </button>
        {phoneBad && <p className="w-full text-xs text-error">{m.orders.phoneInvalid}</p>}
      </form>
      {searched && (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.riders.empty}>
          {(r) => (
            <>
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.riders.riderId}</th>
                    <th>{m.riders.name}</th>
                    <th>{m.riders.phone}</th>
                    <th>{m.riders.vehicle}</th>
                    <th>{m.riders.operating}</th>
                    <th>{m.riders.mfc}</th>
                    <th>{m.riders.restriction}</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.items ?? []).map((x, i) => (
                    <tr key={x.riderId ?? `rider-${i}`} data-testid="rider-row">
                      <td>
                        <Link className="link" to={`/riders/${encodeURIComponent(x.riderId ?? '')}`}>
                          {text(x.riderId)}
                        </Link>
                      </td>
                      <td>{text(x.nameMasked)}</td>
                      <td>{text(x.phoneMasked)}</td>
                      <td>{label(m.riders.vehicleName, x.vehicleType)}</td>
                      <td>{label(m.riders.operatingName, x.operatingStatus)}</td>
                      <td>{text(x.operatingMfcId)}</td>
                      <td>
                        {label(m.riders.restrictionName, x.restriction)}
                        {x.restrictionUntil && <span className="text-xs text-base-content/60">{` ~ ${when(x.restrictionUntil)}`}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <div className="join">
                <button type="button" className="btn join-item btn-sm" disabled={page === 0} onClick={() => go(applied, page - 1)}>
                  {m.riders.prev}
                </button>
                <span className="btn join-item btn-sm btn-disabled">{page + 1}</span>
                <button type="button" className="btn join-item btn-sm" disabled={!r.hasNext} onClick={() => go(applied, page + 1)}>
                  {m.riders.next}
                </button>
              </div>
            </>
          )}
        </QueryState>
      )}
    </>
  );
}

export function RiderSearchPage() {
  return (
    <section className="space-y-4">
      <PageHeader title={m.riders.title} description={m.riders.intro} />
      <RiderSearch />
    </section>
  );
}

const PII_FIELDS: readonly PiiField[] = ['NAME', 'PHONE'];

/**
 * 기본 정보(rider 0.4.0 `GET /riders/{id}`): 이름·전화는 서버가 가린 값. 원문은 사유 + `POST …/pii-reveals`(열람 기록이 남은 뒤 고른 항목만).
 * 받은 원문은 이 컴포넌트 메모리에만(저장·로그 없음) — "다시 가리기"·화면 이동이면 사라진다. 503·결과 불명은 같은 키 재전송.
 */
function RiderBasic({ rider }: { readonly rider: StaffRiderDetail }) {
  const api = useApi();
  const [fields, setFields] = useState<readonly PiiField[]>(PII_FIELDS);
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (v: { reason: string; fields: readonly PiiField[] }, key) =>
    request('POST', api.riders.POST('/riders/{riderId}/pii-reveals', { ...commandParams(key, { path: { riderId: rider.riderId ?? '' } }), body: { reason: v.reason, fields: [...v.fields] } })),
  );
  const opened = reveal.phase.kind === 'done' ? reveal.phase.result : null;
  const isOpen = (f: PiiField) => opened?.fields?.includes(f) ?? false;
  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 200;
  const op = rider.operating;
  return (
    <>
      <p className="text-xs opacity-60">{m.riders.pii.note}</p>
      <Facts
        testId="rider-basic"
        rows={[
          [m.riders.name, <span key="n" data-testid="rider-name" data-masked={!isOpen('NAME')}>{isOpen('NAME') ? text(opened?.name) : text(rider.nameMasked)}</span>],
          [m.orders.phone, <span key="p" data-testid="rider-phone" data-masked={!isOpen('PHONE')}>{isOpen('PHONE') ? text(opened?.phone) : text(rider.phoneMasked)}</span>],
          [m.riders.vehicle, label(m.riders.vehicleName, rider.vehicleType)],
          [m.riders.operating, `${label(m.riders.operatingName, op?.status)}${op?.mfcId ? ` · ${op.mfcId}` : ''}`],
          [m.riders.newDispatch, op?.newDispatchEnabled === undefined ? m.none : op.newDispatchEnabled ? 'O' : 'X'],
          [m.riders.activeDeliveries, text(op?.activeDeliveryCount)],
          [m.riders.areas, (rider.deliveryAreas ?? []).map((a) => `${a.mfcId ?? ''}${a.zoneId ? `/${a.zoneId}` : ''}`).join(', ') || m.none],
          [m.riders.dispatchMode, label(m.riders.dispatchModeName, rider.settings?.dispatchMode)],
          [m.riders.restriction, `${label(m.riders.restrictionName, rider.restriction?.state)}${rider.restriction?.until ? ` ~ ${when(rider.restriction.until)}` : ''}`],
          [m.riders.lastHeartbeat, when(rider.lastHeartbeatAt)],
          [m.riders.joinedAt, when(rider.joinedAt)],
        ]}
      />
      {opened ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{m.riders.pii.opened(text(opened.piiAccessLogId), when(opened.recordedAt))}</span>
          <button type="button" className="btn btn-xs" onClick={() => reveal.reset()}>
            {m.riders.pii.hide}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm"
          aria-label={m.riders.pii.title}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonOk || fields.length === 0) return;
            if (reveal.phase.kind === 'rejected') reveal.reset();
            void reveal.run({ reason: reason.trim(), fields });
          }}
        >
          <h3 className="font-semibold">{m.riders.pii.title}</h3>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="text-xs text-base-content/60">{m.riders.pii.fields}</legend>
            {PII_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={fields.includes(f)}
                  onChange={(e) => setFields((cur) => (e.target.checked ? PII_FIELDS.filter((x) => x === f || cur.includes(x)) : cur.filter((x) => x !== f)))}
                />
                {m.riders.pii.fieldName[f]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            {m.riders.pii.reason}
            <input className="input input-sm w-full max-w-md" maxLength={200} autoComplete="off" placeholder={m.riders.pii.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm" disabled={!reasonOk || fields.length === 0 || reveal.busy}>
            {m.riders.pii.open}
          </button>
          <CommandFeedback command={reveal} />
        </form>
      )}
    </>
  );
}

/** "YYYY-MM-DDTHH:mm"(서울 벽시계) → ISO. */
const seoulLocalToIso = (v: string) => new Date(`${v}:00+09:00`).toISOString();

function RestrictionForm({ riderId, current, version }: { readonly riderId: string; readonly current: Restriction | undefined; readonly version: number | undefined }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [restriction, setRestriction] = useState<Restriction | ''>('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [approvalRef, setApprovalRef] = useState('');

  const change = useCommand(async (body: RestrictionChange, key) => {
    try {
      return await request(
        'POST',
        api.riders.POST('/riders/{riderId}/restrictions', { ...commandParams(key, { path: { riderId }, version }), body }),
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['riders', 'restrictions', riderId] });
      void queryClient.invalidateQueries({ queryKey: ['riders', 'detail', riderId] }); // version 이 올라간다
    }
  });
  const locked = change.busy;
  const ready = restriction !== '' && restriction !== current && reason.trim() !== '';

  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4"
      aria-label={m.riders.changeTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || locked) return;
        const refs = evidence
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        void change.run({
          restriction,
          reason: reason.trim(),
          ...(restriction !== 'NORMAL' && until ? { until: seoulLocalToIso(until) } : {}),
          ...(refs.length > 0 ? { evidenceRefs: refs } : {}),
          ...(approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}),
        });
      }}
    >
      <h2 className="font-bold">{m.riders.changeTitle}</h2>
      <p className="text-xs opacity-60">{m.riders.changeIntro}</p>
      <label className="block text-sm">
        {m.riders.newRestriction}
        <select className="select select-sm mt-1 block" value={restriction} disabled={locked} onChange={(e) => setRestriction(e.target.value as Restriction | '')}>
          <option value="">-</option>
          {RESTRICTIONS.map((r) => (
            <option key={r} value={r} disabled={r === current}>
              {m.riders.restrictionName[r]}
            </option>
          ))}
        </select>
      </label>
      {restriction !== '' && restriction !== 'NORMAL' && (
        <label className="block text-sm">
          {m.riders.untilLabel}
          <input type="datetime-local" className="input input-sm mt-1 block" value={until} disabled={locked} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      <label className="block text-sm">
        {m.riders.reason}
        <textarea className="textarea mt-1 w-full" rows={2} maxLength={MAX_REASON} required value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs opacity-60">{m.riders.reasonHint}</p>
      <label className="block text-sm">
        {m.riders.evidence}
        <input className="input input-sm mt-1 w-full" placeholder={m.riders.evidenceHint} value={evidence} disabled={locked} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <label className="block text-sm">
        {m.riders.approvalRef}
        <input className="input input-sm mt-1 block" value={approvalRef} disabled={locked} onChange={(e) => setApprovalRef(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-warning btn-sm" disabled={!ready || locked}>
        {m.riders.apply}
      </button>
      <CommandFeedback command={change} unknown={{ body: m.riders.unknown }}>
        {(r) => (
          <p role="status" className="text-sm text-success" data-testid="restriction-result">
            {`${m.riders.applied} ${label(m.riders.restrictionName, r.restriction)}`}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function Restrictions({ riderId, version }: { readonly riderId: string; readonly version: number | undefined }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['riders', 'restrictions', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}/restrictions', { params: { path: { riderId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) => {
        const items: RestrictionRecord[] = r.items ?? [];
        const latest = items[0];
        return (
          <>
            <Facts
              testId="rider-restriction"
              rows={[
                [m.riders.current, <span key="c" data-testid="rider-current-restriction">{label(m.riders.restrictionName, r.current)}</span>],
                [m.riders.until, latest && latest.restriction === r.current && r.current !== 'NORMAL' ? (latest.until ? when(latest.until) : m.riders.untilNone) : m.none],
              ]}
            />
            <RestrictionForm riderId={riderId} current={r.current} version={version} />
            <h2 className="font-bold">{m.riders.history}</h2>
            {items.length === 0 ? (
              <p className="text-sm text-base-content/60">{m.riders.noHistory}</p>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.riders.changedAt}</th>
                    <th>{m.riders.previous}</th>
                    <th>{m.riders.restriction}</th>
                    <th>{m.riders.until}</th>
                    <th>{m.riders.reason}</th>
                    <th>{m.riders.evidence}</th>
                    <th>{m.riders.changedBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((h, i) => (
                    <tr key={`${h.changedAt ?? ''}-${i}`} data-testid="restriction-row">
                      <td>{when(h.changedAt)}</td>
                      <td>{label(m.riders.restrictionName, h.previous)}</td>
                      <td>{label(m.riders.restrictionName, h.restriction)}</td>
                      <td>{h.until ? when(h.until) : m.none}</td>
                      <td className="max-w-xs whitespace-pre-wrap">{text(h.reason)}</td>
                      <td>{(h.evidenceRefs ?? []).join(', ') || m.none}</td>
                      <td>{text(h.changedBy)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </>
        );
      }}
    </QueryState>
  );
}

export function RiderDetailPage() {
  const { riderId = '' } = useParams();
  const api = useApi();
  const detail = useQuery({
    queryKey: ['riders', 'detail', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}', { params: { path: { riderId } } })),
  });
  return (
    <section className="max-w-5xl space-y-4">
      <PageHeader title={`${m.riders.detailTitle} ${riderId}`} />
      <h2 className="font-bold">{m.riders.basic}</h2>
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(r) => <RiderBasic key={r.riderId} rider={r} />}
      </QueryState>
      {/* 계정 제한의 X-Expected-Version = 상세의 라이더 version(BOD-6). 상세를 못 읽으면 보내지 않는다(헤더는 선택) */}
      <Restrictions riderId={riderId} version={detail.data?.version} />
      <h2 className="font-bold">{m.riders.deliveries}</h2>
      <DeliveriesOf riderId={riderId} />
      <h2 className="font-bold">{m.riders.reviews}</h2>
      <ReviewTable state="OPEN" riderId={riderId} />
      <h2 className="font-bold">{m.riders.complaints}</h2>
      <RiderComplaintTable riderId={riderId} />
      <Link className="link text-sm" to="/riders">
        {m.riders.back}
      </Link>
    </section>
  );
}