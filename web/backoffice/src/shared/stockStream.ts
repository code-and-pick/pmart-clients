// 재고 실시간 스트림(mfc-inventory 0.46.0 `GET /stock-stream`, SSE — 2026-11-24 PC 1 사용자 "실시간 재고 차감 취소 시 증감이 바로바로 백오피스에 반영",
// 요청서 docs/handoff/backoffice/2026-11-24-backend-live-stock-stream.md, bff 중계 없이 mfc-inventory 한 경로 — PC 2 백엔드 회신).
// - 토큰이 메모리라 EventSource(헤더 못 붙임) 대신 fetch 스트림 + Authorization(공용 pmartFetch). Accept: text/event-stream.
// - 화면이 보일 때만 연다(탭을 숨기면 닫고, 다시 보이면 연다). 센터를 고르면 mfcId, "전체 센터"면 mfcId 없이 — 연결 하나.
// - 이벤트: ready(처음·이어 받기 실패면 스냅샷 다시 읽기) · summary-changed(가용 0 경계 — 품절 칸은 이것만) · resync(다시 읽기).
//   stock-changed 는 SKU 상세라 이 화면은 쓰지 않는다. heartbeat 주석 줄(": hb")은 버린다. 품절 수는 화면이 세지 않는다(서버 집계를 다시 읽음).
// - 다시 읽기는 2초 안의 여러 이벤트를 한 번으로 모은다.
// - 끊기면 1초 → 2·4·…·30초 뒤 마지막 id 를 Last-Event-ID 로 다시 연결. 서버가 30분마다 닫는 것은 바로 다시 연결.
//   끊긴 동안은 'down' — 화면은 "실시간 끊김"을 보이고 예전처럼 60초마다 다시 읽는다. 다시 붙으면 한 번 다시 읽는다.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useApi } from '../app/ApiContext';

export type LiveState = 'off' | 'connecting' | 'live' | 'down';

export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

/** SSE 글 조각을 이벤트로 — 빈 줄에서 끊고, ":" 로 시작하는 줄(heartbeat)은 버린다. 남은 조각은 rest 로 돌려준다. */
export function parseSse(buffer: string): { readonly events: SseEvent[]; readonly rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const at = line.indexOf(':');
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    if (data.length === 0 && event === 'message') continue;
    events.push({ event, data: data.join('\n'), ...(id ? { id } : {}) });
  }
  return { events, rest };
}

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};
const pageVisible = () => document.visibilityState !== 'hidden';

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

function isResumed(data: string): boolean {
  try {
    return (JSON.parse(data) as { resumed?: boolean }).resumed === true;
  } catch {
    return false;
  }
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const GATHER_MS = 2_000;

/**
 * 재고 스트림을 열어 두고, 다시 읽을 때가 되면 onRefresh 를 부른다(2초 모아 한 번).
 * mfcIds 가 비면 볼 수 있는 모든 센터.
 */
export function useStockStream(mfcIds: readonly string[], onRefresh: () => void): LiveState {
  const api = useApi();
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible, () => true);
  const [state, setState] = useState<LiveState>('connecting');
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  });
  const key = mfcIds.join(',');

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const ids = key ? key.split(',') : [];
    let gather: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (gather || signal.aborted) return;
      gather = setTimeout(() => {
        gather = null;
        if (!signal.aborted) refreshRef.current();
      }, GATHER_MS);
    };
    let lastId: string | undefined;
    let failures = 0;
    let wasDown = false;

    const connect = async (): Promise<boolean> => {
      const { response } = await api.mfcInventory.GET('/stock-stream', {
        params: { query: ids.length > 0 ? { mfcId: ids } : {}, header: lastId ? { 'Last-Event-ID': lastId } : {} },
        headers: { Accept: 'text/event-stream' },
        parseAs: 'stream',
        signal,
      });
      if (!response.ok || !response.body) return false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ready = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return ready; // 서버가 닫음(최대 30분) — ready 를 받았던 연결이면 바로 다시
        const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.id) lastId = ev.id;
          if (ev.event === 'ready') {
            ready = true;
            failures = 0;
            setState('live');
            const resumed = isResumed(ev.data);
            // 이어 받기가 아니거나 끊겼다 붙었으면 스냅샷을 한 번 다시 읽는다(그 사이 바뀐 것은 스트림에 온다)
            if (!resumed || wasDown) refresh();
            wasDown = false;
          } else if (ev.event === 'summary-changed' || ev.event === 'resync') {
            refresh();
          }
        }
      }
    };

    void (async () => {
      while (!signal.aborted) {
        const ok = await connect().catch(() => false);
        if (signal.aborted) return;
        if (ok) continue;
        wasDown = true;
        setState('down');
        await wait(BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!, signal);
        failures += 1;
      }
    })();

    return () => {
      ctrl.abort();
      if (gather) clearTimeout(gather);
      setState('connecting'); // 다음 연결(센터 바꿈·다시 보임)은 "연결 중"부터
    };
  }, [api, key, visible]);

  return visible ? state : 'off';
}
