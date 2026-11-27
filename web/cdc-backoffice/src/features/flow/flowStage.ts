// DC → MFC 일곱 단계(사용자 2026-11-27 "백오피스로 내용이나 실시간 흐름을 파악하기가 너무 어렵다").
// DC 쪽은 TRF 상태(cdc-outbound), 출발 뒤는 운행 정차(transport-execution — 인계)와 MFC 입고(cdc-inventory transits). 모두 서버 값.
import type { components } from '../../api/generated/cdc-outbound';
import { receiptOf, type CenterTransit } from '../mfc-flow/transits';
import { mfcSideOf, type StopOfTrf } from '../mfc-flow/tripStops';

export const FLOW_STAGES = ['RECEIVED', 'ALLOCATED', 'PICKING', 'PACKING', 'ON_WAY', 'HANDED', 'STOCKED'] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];
type TransferSummary = components['schemas']['TransferSummary'];

/** TRF 한 건 → 단계(취소·변경 보류는 null) */
export function flowStageOf(state: string, at: StopOfTrf | undefined, ct: CenterTransit | undefined): FlowStage | null {
  if (state.startsWith('CANCEL') || state.startsWith('CHANGE')) return null;
  if (state === 'RECEIVED' || state === 'ALLOCATING' || state === 'ALLOCATION_FAILED') return 'RECEIVED';
  if (state === 'ALLOCATED' || state === 'PARTIALLY_ALLOCATED') return 'ALLOCATED';
  if (state === 'IN_WAVE' || state === 'PICKING') return 'PICKING';
  if (state !== 'DEPARTED') return 'PACKING';
  if (ct && receiptOf(ct) !== 'WAITING') return 'STOCKED';
  if (at && mfcSideOf(at.stop) === 'HANDED_OVER') return 'HANDED';
  return 'ON_WAY';
}

/** 눈여겨볼 것(서버 상태·수량에서만) — 없으면 빈 목록 */
export function flagsOf(x: TransferSummary, at: StopOfTrf | undefined, ct: CenterTransit | undefined): readonly ('ALLOCATION_FAILED' | 'PARTIALLY_ALLOCATED' | 'MISMATCHED' | 'short' | 'late' | 'receiptBad')[] {
  const out: ('ALLOCATION_FAILED' | 'PARTIALLY_ALLOCATED' | 'MISMATCHED' | 'short' | 'late' | 'receiptBad')[] = [];
  if (x.state === 'ALLOCATION_FAILED') out.push('ALLOCATION_FAILED');
  if (x.state === 'PARTIALLY_ALLOCATED') out.push('PARTIALLY_ALLOCATED');
  if (x.state === 'MISMATCHED') out.push('MISMATCHED');
  if (x.shortQty > 0) out.push('short');
  if (x.state === 'DEPARTED' && at && mfcSideOf(at.stop) === 'ON_WAY' && at.stop.delayed) out.push('late');
  if (ct && receiptOf(ct) === 'MISMATCH') out.push('receiptBad');
  return out;
}
