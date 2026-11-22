// 머리줄 "번호로 바로 찾기"(2026-11-18 사용자 "UI 보충 — 추천 다"). Ctrl+K(맥 ⌘K) 로 어디서나 연다.
// 번호 모양을 보고 그 화면으로 — 화면 번호(ADR-0070)는 계약에 있는 조회로 시스템 ID 를 찾아서 연다(새 API 없음):
// - 8자리             → 주문(order `GET /orders/lookups?orderNumber=`)
// - D+8자리(-순번)     → 배송(execution `GET /deliveries?orderNumber=` 의 deliveryNumber 일치, ADR-0085 — 예전 8자리-순번도)
// - R+4~5자리(R 없이도) → 라이더(rider `GET /riders?riderNumber=`)
// - ORD-·DLV-·RID-·CLM-·INQ-·CASE- 로 시작 → 그 상세로 바로
// - 그 밖(전화번호·고객 ID 등)  → 통합 조회(`/lookup?q=`)로 넘긴다 — 이 칸이 추측해 고르지 않는다
// 찾지 못하면 "없음", 조회가 실패하면 "확인 못 함"으로 나눠 말한다(못 찾음 ≠ 실패). 입력값은 주소·로그에 남기지 않는다(통합 조회로 넘길 때만 그 화면 규칙대로).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useApi } from './ApiContext';
import { messages as m } from '../shared/messages';
import { deliveryIdOfNumber, isRiderNumber, orderIdOfNumber, parseDeliveryNumber, riderIdOfNumber } from '../shared/numberLookups';

type Jump = { readonly kind: 'go'; readonly to: string } | { readonly kind: 'none'; readonly what: string };

const PREFIX: ReadonlyArray<readonly [RegExp, (id: string) => string]> = [
  [/^ORD-/i, (id) => `/orders/${encodeURIComponent(id)}`],
  [/^DLV-/i, (id) => `/deliveries/${encodeURIComponent(id)}`],
  [/^RID-/i, (id) => `/riders/${encodeURIComponent(id)}`],
  [/^CLM-/i, (id) => `/claims/${encodeURIComponent(id)}`],
  [/^INQ-/i, (id) => `/inquiries/${encodeURIComponent(id)}`],
  [/^CASE-/i, (id) => `/cases/${encodeURIComponent(id)}`],
];

/** 입력 → 갈 곳. 화면 번호는 서버 조회로 ID 를 찾는다 */
export async function resolveJump(api: ReturnType<typeof useApi>, raw: string): Promise<Jump> {
  const v = raw.trim();
  const compact = v.replace(/\s/g, '');
  for (const [re, to] of PREFIX) if (re.test(v)) return { kind: 'go', to: to(v) };
  // 숫자 8자리만이면 주문 — 배송은 D 나 -순번이 붙은 것
  if (parseDeliveryNumber(compact)?.marked) {
    const id = await deliveryIdOfNumber(api, compact);
    return id ? { kind: 'go', to: `/deliveries/${encodeURIComponent(id)}` } : { kind: 'none', what: m.quickJump.kindDelivery };
  }
  if (/^\d{8}$/.test(compact)) {
    const id = await orderIdOfNumber(api, compact);
    return id ? { kind: 'go', to: `/orders/${encodeURIComponent(id)}` } : { kind: 'none', what: m.quickJump.kindOrder };
  }
  if (isRiderNumber(compact)) {
    const id = await riderIdOfNumber(api, compact);
    return id ? { kind: 'go', to: `/riders/${encodeURIComponent(id)}` } : { kind: 'none', what: m.quickJump.kindRider };
  }
  return { kind: 'go', to: `/lookup?${new URLSearchParams({ q: v }).toString()}` };
}

export function QuickJump() {
  const api = useApi();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Ctrl+K / ⌘K — 어디서나 이 칸으로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const j = await resolveJump(api, value);
      if (j.kind === 'go') {
        setValue('');
        input.current?.blur();
        void navigate(j.to);
      } else setNote(m.quickJump.notFound(j.what));
    } catch {
      setNote(m.quickJump.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="relative hidden md:block" role="search" onSubmit={(e) => void submit(e)} data-testid="quick-jump">
      <label className="input input-sm w-72 gap-2 bg-base-200/60">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-50" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          aria-label={m.quickJump.label}
          placeholder={m.quickJump.placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue('');
              setNote(null);
              e.currentTarget.blur();
            }
          }}
        />
        {busy ? <span className="loading loading-spinner loading-xs" aria-label={m.quickJump.busy} /> : <kbd className="kbd kbd-xs">Ctrl K</kbd>}
      </label>
      {note && (
        <p role="status" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow">
          {note}
        </p>
      )}
    </form>
  );
}
