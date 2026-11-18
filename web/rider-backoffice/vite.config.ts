import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 라이더 백오피스(백엔드 2026-11-17 — PC 1 이 뼈대·로그인, 메뉴 화면은 PC 5). 로그인은 모든 모드에서 employee-auth-service(app=rider-backoffice).
// mode: `mock`(MSW — 로그인은 목 계정 버튼, Keycloak 없음) / `local`(게이트웨이 프록시) / `lan`(게이트웨이 주소로 직접, CORS).
// 주소(백엔드 확정): 개발 http://localhost:5176, LAN https://192.168.0.40:8446 — 복귀 주소 <출처>/auth/callback 이 백엔드 허용 목록에 있다.

export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_PMART_ENV': JSON.stringify(mode === 'mock' || mode === 'test' ? 'mock' : 'local'),
      // 비밀값이 아니라 주소라 여기 둔다(다른 백오피스와 같은 게이트웨이). 화면이 HTTPS 라 HTTPS 게이트웨이(8443).
      ...(lan ? { 'import.meta.env.VITE_PMART_API_BASE': JSON.stringify('https://192.168.0.40:8443/api/v1') } : {}),
      // 머리줄 "시뮬레이터" 버튼(2026-11-18 사용자 "라이더 백오피스에서 시뮬레이션 서버 볼 수 있게"): 라이더 시뮬레이터는 PC 5(192.168.0.101)
      // 개발 서버 5181 에서 돈다 — 다른 기기에서는 읽기 전용(시뮬레이터 server/lanPolicy.ts). 실서버 모드(?mode=http)로 연다.
      // 주소가 바뀌면 빌드할 때 VITE_SIM_URL 로 덮어쓴다.
      ...(lan ? { 'import.meta.env.VITE_SIM_URL': JSON.stringify(process.env.VITE_SIM_URL ?? 'http://192.168.0.101:5181/?mode=http') } : {}),
    },
    server: {
      port: 5176,
      strictPort: true,
      proxy: mode === 'local' ? { '/api': 'http://localhost:8080' } : undefined,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
