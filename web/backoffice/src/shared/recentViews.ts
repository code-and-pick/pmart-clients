// 최근 본 항목(2026-11-18 사용자 "UI 보충 — 추천 다").
// 이 브라우저에만, 로그인한 직원마다 따로(같은 PC 를 여럿이 쓸 수 있다) 8개까지. 저장하는 것: 종류·시스템 ID·화면에 보인 번호(또는 상품 관리용 명칭)·본 시각.
// 이름·전화 같은 개인정보는 넣지 않는다. 저장이 막힌 브라우저(사생활 보호 창 등)에서는 조용히 아무것도 남기지 않는다 — 화면은 그대로 동작.
import { useEffect, useState } from 'react';

import { useSession } from '../app/SessionContext';

export type RecentKind = 'order' | 'delivery' | 'claim' | 'case' | 'inquiry' | 'riderInquiry' | 'product' | 'approval';
export interface RecentEntry {
  readonly kind: RecentKind;
  readonly id: string;
  readonly label: string;
  readonly at: number;
}

const MAX = 8;
const EVENT = 'pmart:recent-views';
const keyOf = (subject: string) => `pmart.backoffice.recent.${subject}`;

export const recentPath: Readonly<Record<RecentKind, (id: string) => string>> = {
  order: (id) => `/orders/${encodeURIComponent(id)}`,
  delivery: (id) => `/deliveries/${encodeURIComponent(id)}`,
  claim: (id) => `/claims/${encodeURIComponent(id)}`,
  case: (id) => `/cases/${encodeURIComponent(id)}`,
  inquiry: (id) => `/inquiries/${encodeURIComponent(id)}`,
  riderInquiry: (id) => `/rider-inquiries/${encodeURIComponent(id)}`,
  product: (id) => `/products/${encodeURIComponent(id)}`,
  approval: (id) => `/approvals/${encodeURIComponent(id)}`,
};

const KINDS = Object.keys(recentPath);

export function readRecent(subject: string): RecentEntry[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(keyOf(subject)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is RecentEntry =>
        typeof e === 'object' && e !== null && KINDS.includes((e as RecentEntry).kind) && typeof (e as RecentEntry).id === 'string' && typeof (e as RecentEntry).label === 'string' && typeof (e as RecentEntry).at === 'number',
    );
  } catch {
    return [];
  }
}

function write(subject: string, list: readonly RecentEntry[]) {
  try {
    window.localStorage.setItem(keyOf(subject), JSON.stringify(list));
  } catch {
    /* 저장이 막힌 브라우저 — 남기지 않는다 */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearRecent(subject: string) {
  try {
    window.localStorage.removeItem(keyOf(subject));
  } catch {
    /* 그대로 */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 상세 화면에서 부른다 — label 이 정해지면(서버 응답 뒤) 한 번 남긴다 */
export function useRecordRecent(kind: RecentKind, id: string, label: string | null | undefined) {
  const subject = useSession().session?.subject;
  useEffect(() => {
    if (!subject || !id || !label) return;
    const rest = readRecent(subject).filter((e) => !(e.kind === kind && e.id === id));
    write(subject, [{ kind, id, label, at: Date.now() }, ...rest].slice(0, MAX));
  }, [subject, kind, id, label]);
}

/** 대시보드에서 읽는다 — 다른 탭·화면에서 바뀌어도 따라간다 */
export function useRecentViews(): { readonly items: readonly RecentEntry[]; readonly clear: () => void } {
  const subject = useSession().session?.subject ?? '';
  const [items, setItems] = useState(() => (subject ? readRecent(subject) : []));
  useEffect(() => {
    const sync = () => setItems(subject ? readRecent(subject) : []);
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [subject]);
  return { items, clear: () => clearRecent(subject) };
}
