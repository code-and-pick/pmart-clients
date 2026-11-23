import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// mode: `mock`(MSW, 기본 개발) / `local`(게이트웨이 프록시, 로컬 백엔드 필요) / `lan`(.env.lan 의 게이트웨이 주소로 직접, CORS)
// 로그인(ADR-0056, 백엔드 handoff 2026-11-12): 모든 모드에서 employee-auth-service(게이트웨이 로그인 시작 → Keycloak 화면 → 티켓 교환).
// 백오피스는 Keycloak 주소·client_id 를 갖지 않는다(게이트웨이 주소만). mock 은 Keycloak 이 없어 로그인 화면의 목 계정 버튼이 목 티켓으로 복귀 주소를 연다.

export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // mock·test 모드만 MSW. 그 외(local, production 빌드)는 실제 API 경로를 쓴다(배포 환경은 [결정 필요]).
      'import.meta.env.VITE_PMART_ENV': JSON.stringify(mode === 'mock' || mode === 'test' ? 'mock' : 'local'),
      // lan: 게이트웨이가 다른 출처(PC4). 브라우저는 https://192.168.0.40 으로 연다(백엔드 handoff 2026-11-13 backoffice-https-csp-logout).
      // 화면이 HTTPS 라 API 도 HTTPS 게이트웨이(8443)여야 한다 — http://…:8080 은 혼합 콘텐츠로 막힌다.
      // 이름(d603-16)은 다른 PC 에서 IPv6 링크 로컬로 먼저 풀려 응답이 없어 IP 를 쓴다(2026-11-06 백엔드 요청).
      // 비밀값이 아니라 주소라 여기 둔다. pc4 IP(백엔드 deploy/lan/placement.conf)가 바뀌면
      // pmart-config api-gateway-lan.yml 의 pmart.gateway.cors.allowed-origins 와 함께 고친다.
      ...(lan ? { 'import.meta.env.VITE_PMART_API_BASE': JSON.stringify('https://192.168.0.40:8443/api/v1') } : {}),
    },
    server: {
      port: 5173,
      // local 모드에서만 게이트웨이로 넘긴다. 쿠키·CORS 방식은 BR-03·BR-04 결정 대기.
      proxy: mode === 'local' ? { '/api': 'http://localhost:8080' } : undefined,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // 시험 하나 제한 시간(기본 5초) — 첫 기다림 8초보다 길게(2026-11-24, MFC 백오피스 15초와 같은 까닭)
      testTimeout: 30_000,
    },
  };
});
