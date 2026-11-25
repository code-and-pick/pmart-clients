import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

const PING = '/__pmart_mock_ping';
export const worker = setupWorker(http.get(PING, () => HttpResponse.json({ mocked: true })), ...handlers);

/**
 * 목 연결 지키기(2026-11-21 "목 웹이 간헐적으로 끊기고 조회 실패가 많이 뜬다").
 * 원인: 브라우저는 한가한 서비스 워커를 멈춘다(뒤로 간 탭은 MSW 의 5초 keepalive 타이머도 느려진다). 다시 깨어난 워커는
 * "목을 쓰는 탭" 목록(메모리)을 잃어 모든 /api 요청을 그대로 보내고, 미리보기 서버가 HTML 을 돌려줘 화면마다 "조회 실패"가 된다.
 * 그래서 탭이 다시 보일 때·초점을 받을 때·20초마다 목 핑을 보내 보고, 목이 답하지 않으면 워커를 다시 켜서 이 탭을 다시 등록한다.
 */
export function keepMocking(options: Parameters<typeof worker.start>[0]) {
  let busy = false;
  const check = async () => {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(PING, { cache: 'no-store' }).catch(() => null);
      const ok = !!res && (res.headers.get('content-type') ?? '').includes('json') && ((await res.json().catch(() => null)) as { mocked?: boolean } | null)?.mocked === true;
      if (!ok) {
        await worker.stop();
        await worker.start({ ...options, quiet: true });
        console.info('[목] 서비스 워커가 멈췄다 깨어나 목 연결을 다시 켰어요.');
      }
    } finally {
      busy = false;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.addEventListener('focus', () => void check());
  window.setInterval(() => void check(), 20_000);
}
