// 재고 실시간 스트림(mfc-inventory 0.46.0 /stock-stream) — SSE 읽기와 대시보드 품절 칸 다시 읽기(2026-11-24)
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { sseEvent } from '../mocks/pricingHandlers';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';
import { parseSse } from './stockStream';

const NL = String.fromCharCode(10);

describe('parseSse', () => {
  it('빈 줄에서 끊고 heartbeat 주석 줄은 버린다, 끝나지 않은 조각은 rest 로', () => {
    const text = [': hb', '', 'id: EV-1', 'event: summary-changed', 'data: {"mfcId":"M1"}', '', 'event: ready', 'data: {"resumed"'].join(NL);
    const { events, rest } = parseSse(text);
    expect(events).toEqual([{ event: 'summary-changed', data: '{"mfcId":"M1"}', id: 'EV-1' }]);
    expect(parseSse(`${rest}:false}${NL}${NL}`).events).toEqual([{ event: 'ready', data: '{"resumed":false}' }]);
  });

  it('CRLF·여러 data 줄', () => {
    const { events } = parseSse(`event: x\r\ndata: a\r\ndata: b\r\n\r\n`);
    expect(events).toEqual([{ event: 'x', data: `a${NL}b` }]);
  });
});

/** 시험이 이벤트를 밀어 넣을 수 있는 스트림 */
function controllableStream() {
  const sent: Request[] = [];
  let push: (text: string) => void = () => undefined;
  server.use(
    http.get(`${API_BASE}/stock-stream`, ({ request }) => {
      sent.push(request);
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (t) => c.enqueue(enc.encode(t));
          push(sseEvent('ready', { type: 'ready', resumed: false, mfcIds: [] }));
        },
      });
      return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return { sent, push: (t: string) => push(t) };
}

const summaryReads = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/stock-summaries')).length;

describe('대시보드 센터별 품절 — 실시간', () => {
  it('토큰·Accept: text/event-stream 으로 연결, summary-changed 가 오면 품절 수를 다시 읽는다(2초 모아 한 번)', async () => {
    const stream = controllableStream();
    let soldOut = 9;
    server.use(http.get(`${API_BASE}/stock-summaries`, () => HttpResponse.json({ items: [{ mfcId: 'MFC-BSN-01', handledSkuCount: 412, soldOutSkuCount: soldOut }], asOf: new Date().toISOString() })));
    const view = renderAt('/?tab=sales', as.admin);
    const cell = await screen.findByTestId('dash-metric-soldOut');
    expect(await within(cell).findByTestId('dash-soldout-live')).toHaveTextContent('실시간');
    const req = stream.sent[0]!;
    expect(req.headers.get('Accept')).toBe('text/event-stream');
    expect(req.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(new URL(req.url).searchParams.getAll('mfcId')).toEqual([]); // 전체 센터 = mfcId 없이 연결 하나
    await waitFor(() => expect(within(cell).getByText('9개')).toBeInTheDocument());
    const before = summaryReads(view.sent);
    soldOut = 10;
    stream.push(sseEvent('summary-changed', { type: 'summary-changed', eventId: 'EV-1', mfcId: 'MFC-BSN-01', skus: ['E-MILK-1L'] }, 'EV-1'));
    stream.push(sseEvent('summary-changed', { type: 'summary-changed', eventId: 'EV-2', mfcId: 'MFC-BSN-01', skus: ['E-EGG-10'] }, 'EV-2'));
    await waitFor(() => expect(within(cell).getByText('10개')).toBeInTheDocument(), { timeout: 5000 });
    // 첫 ready 뒤 한 번 + 두 이벤트를 모아 한 번 — 이벤트 수만큼 읽지 않는다
    expect(summaryReads(view.sent) - before).toBeLessThanOrEqual(2);
  });

  it('연결이 안 되면 "실시간 끊김" — 품절 수는 그대로 보이고(0 이 아님) 다시 연결한다', async () => {
    let tries = 0;
    server.use(
      http.get(`${API_BASE}/stock-stream`, () => {
        tries += 1;
        return HttpResponse.error();
      }),
    );
    renderAt('/?tab=sales', as.admin);
    const cell = await screen.findByTestId('dash-metric-soldOut');
    expect(await within(cell).findByTestId('dash-soldout-down')).toHaveTextContent('실시간 끊김');
    expect(within(cell).queryByTestId('dash-soldout-live')).not.toBeInTheDocument();
    await waitFor(() => expect(within(cell).getByText('12개')).toBeInTheDocument());
    await waitFor(() => expect(tries).toBeGreaterThan(1), { timeout: 4000 });
  });

  it('머리줄 센터를 고르면 그 센터만(mfcId) 연결', async () => {
    const stream = controllableStream();
    sessionStorage.setItem('pmart.backoffice.centerScope', 'MFC-BSN-02');
    renderAt('/?tab=sales', as.admin);
    await waitFor(() => expect(stream.sent.length).toBeGreaterThan(0));
    const last = stream.sent.at(-1)!;
    expect(new URL(last.url).searchParams.getAll('mfcId')).toEqual(['MFC-BSN-02']);
    sessionStorage.removeItem('pmart.backoffice.centerScope');
  });
});
