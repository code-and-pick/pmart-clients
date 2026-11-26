// 화면 번호(ADR-0070·0085 — T482913·W4821·K20481)로 찾기. cdc-outbound 0.21.0 목록의 `number` 거르기(앞 글자 없이 숫자만도 됨).
// 현장은 번호만 안다 — 시스템 ID(TRF-…·WAVE-…)를 넣으면 그대로 쓴다. 못 찾으면 null(지어내지 않음).
import { request } from '@pmart/web-core';
import type { Api } from '../api/client';

export async function findWaveId(api: Api, cdcId: string, input: string): Promise<string | null> {
  const v = input.trim();
  if (!v) return null;
  if (/^WAVE-/i.test(v)) return v;
  const page = await request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { number: v, size: 1 } } }));
  return page.items[0]?.waveId ?? null;
}

export async function findTrfId(api: Api, cdcId: string, input: string): Promise<string | null> {
  const v = input.trim();
  if (!v) return null;
  if (/^TRF-/i.test(v)) return v;
  const page = await request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { number: v, size: 1 } } }));
  return page.items[0]?.trfId ?? null;
}
