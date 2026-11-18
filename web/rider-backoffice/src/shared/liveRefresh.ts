// 화면 자동 새로 고침 간격(2026-11-18 — 백엔드 delivery 세션 요청, 사용자 "배차 받은 라이더 정보가 바로바로 안 뜨는 것 같아").
// 서버 반영은 0.2~2초라 지연은 화면이 다시 부르지 않아서였다. 탭이 안 보이면 멈춘다(TanStack 기본 refetchIntervalInBackground false).
// 전달지(drop-location)는 열람 기록이 남아 여기 넣지 않는다 — 열 때 한 번(features/control/dropLocation.ts).
import type { components } from '../api/generated/delivery-execution';

type ExecutionState = components['schemas']['ExecutionState'];

export const LIVE = {
  /** 진행 중 배송 상세·배차 조회 */
  delivery: 10_000,
  /** 배송 찾기 목록 */
  deliveryList: 20_000,
  /** 대시보드 숫자 */
  dashboard: 30_000,
  /** 운행 중(ON_DUTY)인 라이더 상세 */
  rider: 15_000,
} as const;

/** 끝난 배송 — 더 바뀌지 않으니 새로 고치지 않는다. */
const FINAL: ReadonlySet<ExecutionState> = new Set<ExecutionState>(['COMPLETED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE']);

/** 상태를 아직 모르면(처음 불러오는 중·실패) 진행 중으로 본다 — 다시 불러 확인한다. */
export const isLiveDelivery = (state: ExecutionState | null | undefined): boolean => !state || !FINAL.has(state);
