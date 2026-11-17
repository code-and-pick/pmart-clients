/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** vite.config.ts 의 define 이 빌드 때 바꿔 넣는다: mock(MSW) | local(실제 API). */
  readonly VITE_PMART_ENV: 'mock' | 'local';
  /** 게이트웨이 API 기준 주소(다른 출처일 때만). 비우면 같은 출처 /api/v1 */
  readonly VITE_PMART_API_BASE?: string;
  /** 카카오 지도 JavaScript 키(관제 지도). `.env.local` 등 git 밖 — 없으면 지도 없이 표로만. */
  readonly VITE_KAKAO_JS_KEY?: string;
  /** 시뮬레이션 웹 주소(머리줄 '시뮬레이터' 버튼). 없으면 목·local 은 localhost:5181, LAN 빌드는 숨김 */
  readonly VITE_SIM_URL?: string;
}
