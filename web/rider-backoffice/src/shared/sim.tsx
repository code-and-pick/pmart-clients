// 시뮬레이션 웹(pmart-rider-simulation)과 이어지는 곳(2026-11-18 — 사용자 "라이더 백오피스에서 시뮬레이션 웹으로 이어지게").
// - 시뮬레이터는 개발 도구다: 직원 앱 안에 넣지 않고 새 탭으로 연다. 운영(LAN) 빌드에서는 주소를 따로 줄 때만 보인다.
// - 시뮬레이터 라이더는 ID 가 `RD-sim-` 로 시작한다(백엔드 RR-01 회신 — 시뮬레이터 라이더 접두어). 실서버에서는 실제로 가입된 라이더라
//   관제·라이더 찾기·배송에 그대로 보인다 — 구분해서 보이게 꼬리표만 붙인다(서버 값은 그대로).
import { env } from '../env';
import { StatusBadge } from './admin';

export const SIM_RIDER_PREFIX = 'RD-sim-';
export const isSimRider = (riderId: string | null | undefined) => !!riderId && riderId.startsWith(SIM_RIDER_PREFIX);

/**
 * 시뮬레이터 주소: `VITE_SIM_URL`(.env.local 등 — LAN 빌드는 이것이 있어야 보임) → 목 모드면 시뮬레이터 MOCK,
 * 게이트웨이 프록시(local) 모드면 시뮬레이터 실서버 모드. LAN 빌드(다른 PC 에서 연다)는 기본으로 숨긴다 — 시뮬레이터는 PC 5 의 개발 서버(5181)에서만 돈다.
 */
export function simulatorUrl(): string | null {
  const configured = import.meta.env.VITE_SIM_URL;
  if (configured) return configured;
  if (env.isMock) return 'http://localhost:5181/';
  if (!import.meta.env.VITE_PMART_API_BASE) return 'http://localhost:5181/?mode=http';
  return null;
}

export function SimulatorLink() {
  const url = simulatorUrl();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-ghost btn-xs gap-1"
      title={env.isMock ? '시뮬레이션 웹(MOCK — 이 화면의 목 데이터와는 따로)을 새 탭으로' : '시뮬레이션 웹(실서버 모드)을 새 탭으로 — 시뮬 라이더 운행이 이 화면 관제에 그대로 보여요'}
      data-testid="simulator-link"
    >
      시뮬레이터 <span aria-hidden>↗</span>
    </a>
  );
}

export function SimBadge({ riderId }: { readonly riderId: string | null | undefined }) {
  return isSimRider(riderId) ? (
    <StatusBadge tone="accent" testId="sim-badge">
      시뮬
    </StatusBadge>
  ) : null;
}
