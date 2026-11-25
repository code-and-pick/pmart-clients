import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';
import { applyTheme, readTheme } from './shared/theme';

// 고른 테마를 그리기 전에 붙인다(깜빡임 없이) — 2026-11-20 MFC 백오피스와 같게
applyTheme(readTheme());

async function start() {
  if (import.meta.env.VITE_PMART_ENV !== 'local') {
    const { worker, keepMocking } = await import('./mocks/browser');
    // 목에 없는 경로는 경고만 하고 그대로 보낸다(목 모드에서 실서버를 부르지 않도록 핸들러를 채운다).
    const options = { onUnhandledFrame: 'warn' } as const;
    await worker.start(options);
    // 브라우저가 서비스 워커를 멈췄다 깨우면 목이 끊긴다 — 다시 이어 붙인다
    keepMocking(options);
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('#root 가 없다');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
