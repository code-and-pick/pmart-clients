// 목 모드 전용 — 대리 서버(MSW 서비스 워커)가 깨어난 뒤 요청을 놓치던 것(2026-11-20 화면 점검).
// 원인: 탭을 몇 분 두면 브라우저가 서비스 워커를 재웠다 다시 띄우는데, MSW 워커는 "목을 켠 탭" 목록(activeClientIds)을
// 메모리에만 들고 있어 다시 뜨면 비어 있다 → 모든 요청을 그냥 흘려보내고, /api 요청이 개발 서버로 가서 index.html(text/html)을 받는다
// → 화면은 "정보를 불러오지 못했어요"·대시보드 "?"·로그인 단추 무반응.
// 고침: ① 탭이 다시 보이거나 초점을 받으면 워커에 MOCK_ACTIVATE 를 다시 보낸다(같은 탭을 목록에 다시 넣음, 여러 번 보내도 같음)
//       ② 그래도 /api 응답이 HTML 이면 다시 켜고 같은 요청을 한 번만 다시 보낸다.
// 실서버 모드(dev:local·LAN)에서는 부르지 않는다(main.tsx 의 목 갈래에서만).

const ENABLED_WAIT_MS = 800;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 워커에 "이 탭은 목을 쓴다"를 다시 알리고, 켜졌다는 답(MOCKING_ENABLED)이나 잠깐을 기다린다 */
function reactivate(): Promise<void> {
  const sw = navigator.serviceWorker;
  const controller = sw?.controller;
  if (!sw || !controller) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      sw.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve();
    };
    const onMessage = (e: MessageEvent<unknown>) => {
      const type = typeof e.data === 'object' && e.data !== null && 'type' in e.data ? (e.data as { type?: unknown }).type : undefined;
      if (type === 'MOCKING_ENABLED') done();
    };
    const timer = setTimeout(done, ENABLED_WAIT_MS);
    sw.addEventListener('message', onMessage);
    controller.postMessage('MOCK_ACTIVATE');
  });
}

export function keepMocking(apiPath: string): void {
  const again = () => void reactivate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') again();
  });
  window.addEventListener('focus', again);

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const isApi = urlOf(input).includes(apiPath);
    // 다시 보낼 때 본문을 또 읽을 수 있게 미리 복사(목 모드에서만이라 비용은 상관없음)
    const copy = isApi && input instanceof Request ? input.clone() : null;
    const res = await original(input, init);
    // 목을 지나친 표시: 개발 서버의 index.html(GET) 또는 JSON 아닌 404(POST 등). 목의 404 는 늘 problem+json 이라 섞이지 않는다
    const type = res.headers.get('content-type') ?? '';
    const missed = type.includes('text/html') || (res.status === 404 && !type.includes('json'));
    if (!isApi || !missed) return res;
    await reactivate();
    return original(copy ?? input, init);
  };
}
