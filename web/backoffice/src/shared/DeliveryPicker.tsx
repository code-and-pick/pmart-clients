// 배송 고르기(2026-11-19 사용자 "배송 번호가 길어 사람이 기억할 수 없다 — 시스템적으로 해결").
// 번호를 외우거나 옮겨 적지 않고 사람이 아는 것으로 찾아 고른다 — 새 API 없이 계약에 있는 조회만:
//   - 최근 본 배송(이 브라우저·이 직원, recentViews)
//   - 고객 연락처 → order `GET /orders/lookups?receiverPhone=` → 주문마다 execution `GET /deliveries?orderId=`
//   - 라이더 전화 → rider `GET /riders?phone=` → execution `GET /deliveries?riderId=`
// 연락처는 이 칸 안에서만 쓴다(주소창·저장소·로그에 남기지 않는다). 고르면 칸에 화면 번호(없으면 ID)를 넣고, 칸은 그 번호를 서버에서 다시 찾아 확인한다(RefStatus).
// 역할로 못 쓰는 조회(403)·실패는 "못 찾음"이 아니라 그렇다고 보인다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';
import { addSeoulDays, label, seoulDayEnd, seoulDayStart, seoulToday } from './ops';
import { useRecentViews } from './recentViews';

const m = messages.deliveryPicker;
const digits = (v: string) => v.replace(/\D/g, '');
const PHONE_OK = (v: string) => digits(v).length >= 9 && digits(v).length <= 11;

type Way = 'recent' | 'customer' | 'rider';
interface Row {
  readonly deliveryId: string;
  readonly deliveryNumber?: string | null;
  readonly state?: string | null;
  readonly mfcId?: string | null;
}

function Rows({ rows, onPick }: { readonly rows: readonly Row[]; readonly onPick: (v: string) => void }) {
  if (rows.length === 0) return <p className="py-2 text-xs text-base-content/55">{m.none}</p>;
  return (
    <ul className="divide-y divide-base-300/70" data-testid="picker-rows">
      {rows.map((r) => (
        <li key={r.deliveryId}>
          <button type="button" className="flex w-full items-center gap-3 px-2 py-2 text-left text-sm hover:bg-primary/5" onClick={() => onPick(r.deliveryNumber ?? r.deliveryId)} data-testid="picker-row">
            <span className="font-mono font-semibold">{r.deliveryNumber ?? r.deliveryId}</span>
            {r.state && <span className="text-xs text-base-content/60">{label(messages.deliveries.executionState, r.state)}</span>}
            {r.mfcId && <span className="text-xs text-base-content/45">{r.mfcId}</span>}
            <span className="ml-auto text-xs font-medium text-primary">{m.pick}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Failed({ error }: { readonly error: unknown }) {
  const status = typeof error === 'object' && error !== null && 'problem' in error ? (error as { problem?: { status?: number } }).problem?.status : undefined;
  return <p className="py-2 text-xs text-warning">{status === 403 ? m.forbidden : m.failed}</p>;
}

function ByCustomer({ onPick }: { readonly onPick: (v: string) => void }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [asked, setAsked] = useState('');
  const q = useQuery({
    // 연락처는 쿼리 키(메모리)에만 — 주소·저장소에 남기지 않는다
    queryKey: ['picker', 'customer', asked],
    enabled: asked !== '',
    queryFn: async () => {
      // 계약: 주문 ID·고객 ID 가 없으면 기간(31일 이하)이 필요하다 — 오늘까지 최근 31일
      const today = seoulToday();
      const orders = await request('GET', api.orders.GET('/orders/lookups', { params: { query: { receiverPhone: asked, createdFrom: seoulDayStart(addSeoulDays(today, -30)), createdTo: seoulDayEnd(today), page: 0, size: 10 } } }));
      const lists = await Promise.all(orders.items.map((o) => request('GET', api.execution.GET('/deliveries', { params: { query: { orderId: o.orderId, size: 20 } } }))));
      return lists.flatMap((l) => l.items ?? []).filter((d): d is Row & typeof d => Boolean(d.deliveryId));
    },
  });
  return (
    <div className="space-y-2">
      {/* 입력 화면의 <form> 안에 들어가므로 form 을 겹치지 않는다 — 단추·Enter 로 찾기 */}
      <div className="flex gap-2">
        <input className="input input-sm w-56" inputMode="numeric" autoComplete="off" aria-label={m.customerPhone} placeholder={m.customerPhone} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (PHONE_OK(phone)) setAsked(digits(phone));
          }} />
        <button type="button" className="btn btn-sm" disabled={!PHONE_OK(phone)} onClick={() => setAsked(digits(phone))}>
          {m.find}
        </button>
      </div>
      {asked !== '' && (q.isPending ? <p className="py-2 text-xs text-base-content/55">…</p> : q.isError ? <Failed error={q.error} /> : <Rows rows={q.data} onPick={onPick} />)}
    </div>
  );
}

function ByRider({ onPick }: { readonly onPick: (v: string) => void }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [asked, setAsked] = useState('');
  const q = useQuery({
    queryKey: ['picker', 'rider', asked],
    enabled: asked !== '',
    queryFn: async () => {
      const riders = await request('GET', api.riders.GET('/riders', { params: { query: { phone: asked, size: 1 } } }));
      const riderId = riders.items?.[0]?.riderId;
      if (!riderId) return { rider: false as const, rows: [] as Row[] };
      const d = await request('GET', api.execution.GET('/deliveries', { params: { query: { riderId, size: 20 } } }));
      return { rider: true as const, rows: (d.items ?? []).filter((x): x is Row & typeof x => Boolean(x.deliveryId)) };
    },
  });
  return (
    <div className="space-y-2">
      {/* 입력 화면의 <form> 안에 들어가므로 form 을 겹치지 않는다 — 단추·Enter 로 찾기 */}
      <div className="flex gap-2">
        <input className="input input-sm w-56" inputMode="numeric" autoComplete="off" aria-label={m.riderPhone} placeholder={m.riderPhone} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (PHONE_OK(phone)) setAsked(digits(phone));
          }} />
        <button type="button" className="btn btn-sm" disabled={!PHONE_OK(phone)} onClick={() => setAsked(digits(phone))}>
          {m.find}
        </button>
      </div>
      {asked !== '' &&
        (q.isPending ? (
          <p className="py-2 text-xs text-base-content/55">…</p>
        ) : q.isError ? (
          <Failed error={q.error} />
        ) : !q.data.rider ? (
          <p className="py-2 text-xs text-base-content/55">{m.noRider}</p>
        ) : (
          <Rows rows={q.data.rows} onPick={onPick} />
        ))}
    </div>
  );
}

export function DeliveryPicker({ onPick }: { readonly onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [way, setWay] = useState<Way>('recent');
  const recent = useRecentViews().items.filter((e) => e.kind === 'delivery');
  const pick = (v: string) => {
    onPick(v);
    setOpen(false);
  };
  if (!open)
    return (
      <button type="button" className="pm-fbar-reset self-start" onClick={() => setOpen(true)} data-testid="delivery-picker-open">
        {m.open}
      </button>
    );
  const ways: readonly Way[] = ['recent', 'customer', 'rider'];
  return (
    <div className="space-y-2 rounded-box border border-primary/30 bg-base-100 p-3 shadow-sm" data-testid="delivery-picker">
      <div className="flex items-center gap-1">
        <div role="tablist" aria-label={m.title} className="flex gap-1">
          {ways.map((w) => (
            <button key={w} type="button" role="tab" aria-selected={way === w} className={`btn btn-xs ${way === w ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setWay(w)}>
              {m.way[w]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => setOpen(false)}>
          {m.close}
        </button>
      </div>
      {way === 'recent' && <Rows rows={recent.map((e) => ({ deliveryId: e.id, deliveryNumber: e.label === e.id ? null : e.label }))} onPick={pick} />}
      {way === 'customer' && <ByCustomer onPick={pick} />}
      {way === 'rider' && <ByRider onPick={pick} />}
      <p className="text-[11px] text-base-content/45">{m.privacy}</p>
    </div>
  );
}
