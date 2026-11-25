import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// DC 백오피스(백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice — 칠곡 DC CDC01). 로그인은 모든 모드에서 employee-auth-service(app=cdc-backoffice).
// mode: `mock`(MSW — 로그인은 목 계정 버튼, Keycloak 없음) / `local`(게이트웨이 프록시) / `lan`(게이트웨이 주소로 직접, CORS).
// 주소(백엔드 확정): 개발 http://localhost:5177, LAN https://192.168.0.40:8447 — 복귀 주소 <출처>/auth/callback 이 백엔드 허용 목록에 있다.

export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_PMART_ENV': JSON.stringify(mode === 'mock' || mode === 'test' ? 'mock' : 'local'),
      // 비밀값이 아니라 주소라 여기 둔다(다른 백오피스와 같은 게이트웨이). 화면이 HTTPS 라 HTTPS 게이트웨이(8443).
      ...(lan ? { 'import.meta.env.VITE_PMART_API_BASE': JSON.stringify('https://192.168.0.40:8443/api/v1') } : {}),
    },
    server: {
      port: 5177,
      strictPort: true,
      proxy: mode === 'local' ? { '/api': 'http://localhost:8080' } : undefined,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // 화면 흐름 시험(입력 여러 칸·여러 요청)이 전체를 함께 돌릴 때 5초 기본을 무작위로 넘긴다 — 실패를 숨기지 않게 시간만 넉넉히
      testTimeout: 15_000,
    },
  };
});
