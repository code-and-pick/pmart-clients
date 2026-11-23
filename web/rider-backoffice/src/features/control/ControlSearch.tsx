// 관제 찾기 — 주문번호(8자리)·배송 번호(D74939255·D74939255-2, ADR-0085)면 D·순번을 떼고 execution 직원용 배송 찾기
// (`orderNumber` 완전 일치 — 배정된 배송만 번호가 있다)로 배송·라이더·센터를 찾아 그 라이더를 바로 연다(순번을 적었으면 그 순번의 배송).
// 라이더 번호(R4785·4785, ADR-0085)면 rider `GET /riders?riderNumber=`(서버가 R 유무를 같게 봄)로 라이더 ID 를 찾는다.
// 그 밖 글자는 라이더 ID 로 본다(이 센터 운행 목록에서 고름). 찾은 결과·실패는 칸 아래 한 줄로.
// 2026-11-19: 머리줄 통합 찾기(compact)로도 쓴다 — 카페24 관리자 머리줄 검색처럼 어느 화면에서나 관제로 간다.
import { useState, type FormEvent } from 'react';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { RIDER_NUMBER, parseDeliveryNumber } from '../../shared/displayNumbers';
import { Icon } from '../../shared/icons';
import { messages } from '../../shared/messages';
import { label } from '../../shared/opsUi';

export const searchMessages = {
  label: '주문번호·라이더 찾기',
  headerLabel: '통합 찾기',
  headerGo: '통합 찾기로 관제에서 열기',
  headerOpen: '통합 찾기 열기',
  placeholder: '주문·배송 번호(D74939255) · 라이더 번호(R4785) · 라이더 ID',
  // 머리줄 찾기 칸은 좁아 긴 안내가 잘렸다(2026-11-23 사용자 "상단바 검색창에 이렇게 뜨는 거 바꿔") — 짧게, 자세한 형식은 마우스를 올리면
  // 2026-11-24 사용자 "검색창에 적힌 거 너무 길어 … 라이더·주문 번호로 찾기 이 정도로만" (배송 번호도 그대로 찾아진다)
  headerPlaceholder: '라이더·주문 번호로 찾기',
  headerTitle: '주문번호 8자리 · 배송 번호 D74939255 · 라이더 번호 R4785 · 라이더 ID',
  go: '찾기',
  notFound: (no: string) => `주문번호 ${no} 로 배정된 배송이 없어요(배정 전 배송은 번호로 찾을 수 없어요).`,
  riderNotFound: (no: string) => `라이더 번호 ${no} 인 라이더가 없어요.`,
  unassigned: (state: string) => `이 주문의 배송은 아직 라이더가 없어요(${state}).`,
  failed: '찾지 못했어요 — 잠시 뒤 다시 해 주세요.',
  opened: (no: string, rider: string) => `주문 ${no} → 라이더 ${rider}`,
} as const;
const s = searchMessages;

export interface SearchHit {
  readonly riderId: string;
  readonly mfcId?: string | null;
  readonly deliveryId?: string;
}

export function ControlSearch({ onFound, compact = false }: { readonly onFound: (hit: SearchHit) => void; readonly compact?: boolean }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ readonly tone: 'info' | 'error'; readonly text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setNote(null);
    if (RIDER_NUMBER.test(q)) {
      setBusy(true);
      try {
        const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber: q, size: 1 } } }));
        const hit = r.items?.[0];
        if (!hit?.riderId) setNote({ tone: 'error', text: s.riderNotFound(q) });
        else onFound({ riderId: hit.riderId });
      } catch {
        setNote({ tone: 'error', text: s.failed });
      } finally {
        setBusy(false);
      }
      return;
    }
    const want = parseDeliveryNumber(q);
    if (!want) {
      onFound({ riderId: q });
      return;
    }
    const seqGiven = /-\d+$/.test(q);
    setBusy(true);
    try {
      const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: want.orderNumber, size: 10 } } }));
      const all = r.items ?? [];
      // 순번을 적었으면(D74939255-2) 그 배송만. 아니면 진행 중(라이더 있음) 배송을 먼저 — 반납·재발송이 같은 주문번호로 함께 있을 수 있다
      const items = seqGiven ? all.filter((d) => d.deliveryNumber && parseDeliveryNumber(d.deliveryNumber)?.seq === want.seq) : all;
      const hit = items.find((d) => d.riderId) ?? items[0];
      if (!hit) setNote({ tone: 'error', text: s.notFound(q) });
      else if (!hit.riderId) setNote({ tone: 'error', text: s.unassigned(label(messages.names.executionState, hit.state)) });
      else {
        onFound({ riderId: hit.riderId, mfcId: hit.mfcId ?? null, ...(hit.deliveryId ? { deliveryId: hit.deliveryId } : {}) });
        setNote({ tone: 'info', text: s.opened(q, hit.riderId) });
      }
    } catch {
      setNote({ tone: 'error', text: s.failed });
    } finally {
      setBusy(false);
    }
  };

  const noteEl = note && (
    <span
      role="status"
      className={`text-xs ${note.tone === 'error' ? 'text-error' : 'text-base-content/60'} ${compact ? 'absolute left-0 top-full z-30 mt-1 w-max max-w-md rounded-box border border-base-300 bg-base-100 px-3 py-2 shadow' : ''}`}
      data-testid="control-search-note"
    >
      {note.text}
    </span>
  );

  if (compact) {
    // 좁은 화면(640px 미만, 2026-11-23 — 390px 에서 머리줄이 넘침)에서는 돋보기 단추만, 누르면 머리줄 아래에 찾기 칸
    return (
      <div className="sm:relative sm:w-full sm:max-w-md">
        <button type="button" className="btn btn-ghost btn-xs btn-square sm:hidden" aria-label={s.headerOpen} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="header-search-toggle">
          <Icon name="search" className="h-4 w-4" />
        </button>
      <form className={`${open ? 'absolute inset-x-2 top-full z-30 mt-1' : 'hidden'} sm:relative sm:inset-auto sm:mt-0 sm:block sm:w-full`} onSubmit={(e) => void submit(e)} role="search" aria-label={s.headerLabel}>
        <label className="input input-sm flex w-full items-center gap-2 bg-base-200/70">
          <Icon name="search" className="h-4 w-4 opacity-50" />
          <input className="grow" value={text} placeholder={s.headerPlaceholder} title={s.headerTitle} aria-label={s.headerLabel} maxLength={64} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-xs" aria-label={s.headerGo} disabled={busy || !text.trim()}>
            {s.go}
          </button>
        </label>
        {noteEl}
      </form>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-1 text-sm" onSubmit={(e) => void submit(e)} role="search" aria-label={s.label}>
      <span>{s.label}</span>
      <span className="flex gap-1">
        <input className="input input-sm w-72" value={text} placeholder={s.placeholder} aria-label={s.label} maxLength={64} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !text.trim()}>
          {s.go}
        </button>
      </span>
      {noteEl}
    </form>
  );
}
