// 사람 입력 칸 — 사번으로 운영자 찾기(hr 0.10.0 HR-5, 2026-11-24 — 교대 인계 "후임"·접수 건 "다른 사람에게 배정" 이 OP-… 를 직접 쳐 넣게 하던 것).
// - 사번(P<연도 4>-<5자리>, 계약 pattern 과 같게 — 소문자 p 도 받아 대문자로 보낸다)을 넣으면 `GET /hr/employee-labels?employeeNos=` 로 운영자 ID·이름.
// - 사번 모양이 아니면 넣은 값을 운영자 ID 로 그대로(붙여 넣기·예전 입력).
// - 재직자만(hr 0.11.0 activeOnly=true — 퇴사자 LEFT 는 빠짐, 사용자 결정 2026-11-24). 정지(SUSPENDED)는 재직이라 남는다(응답에 상태가 없어 화면이 구분 못 함).
//   서버(case)는 맡기기·인계 작성 때 재직 여부를 보지 않으므로 "[이름] · 사번 에게 …" 확인 줄이 사람이 보는 확인 — 찾지 못했거나 찾는 중·실패면 보내지 못하게 한다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';

export const isEmployeeNo = (v: string) => /^[Pp]\d{4}-\d{5}$/.test(v.trim());

export function useOperatorRef(input: string) {
  const api = useApi();
  const value = input.trim();
  const no = value.toUpperCase();
  const byNo = isEmployeeNo(value);
  const q = useQuery({
    queryKey: ['hr', 'employee-by-no', no, 'active'],
    enabled: byNo,
    staleTime: 60_000,
    queryFn: () => request('GET', api.hr.GET('/hr/employee-labels', { params: { query: { employeeNos: [no], activeOnly: true } } })),
  });
  if (value === '') return { id: null, state: 'empty' as const, label: null };
  // 사번처럼 시작했는데(P + 숫자) 모양이 아직 아니면 ID 로 보내지 않고 "사번 모양" 안내(쓰는 중일 수 있어 경고가 아니라 회색 — 2026-11-24 점검, P2 만 쳐도 "없어요"가 뜨던 것)
  if (!byNo && /^[Pp]\d/.test(value)) return { id: null, state: 'badFormat' as const, label: null };
  if (!byNo) return { id: value, state: 'id' as const, label: null };
  if (q.isPending) return { id: null, state: 'loading' as const, label: null };
  if (q.isError) return { id: null, state: 'failed' as const, label: null };
  const e = q.data.items?.[0];
  return e?.operatorId ? { id: e.operatorId, state: 'found' as const, label: `${e.name ?? ''} · ${e.employeeNo ?? no}` } : { id: null, state: 'notFound' as const, label: null };
}

/** 찾는 중·없음·실패면 보내지 못한다(사번을 넣었는데 확인이 안 된 상태) */
export const operatorRefBlocked = (r: ReturnType<typeof useOperatorRef>) => r.state === 'loading' || r.state === 'badFormat' || r.state === 'notFound' || r.state === 'failed';

/** 칸 아래 한 줄 — 찾음(누구에게)·찾는 중·없음·실패 */
export function OperatorRefStatus({ r, foundText, testId }: { readonly r: ReturnType<typeof useOperatorRef>; readonly foundText: (label: string) => string; readonly testId: string }) {
  if (r.state === 'empty' || r.state === 'id') return null;
  const m = messages.operatorRef;
  const tone = r.state === 'found' ? 'text-success' : r.state === 'loading' || r.state === 'badFormat' ? 'text-base-content/50' : 'text-warning';
  const text = r.state === 'found' ? foundText(r.label ?? '') : r.state === 'loading' ? m.loading : r.state === 'badFormat' ? m.badFormat : r.state === 'notFound' ? m.notFound : m.failed;
  // 한 줄씩(옆 안내와 붙지 않게)
  return (
    <span className={`block break-keep text-xs ${tone}`} role="status" data-testid={testId} data-state={r.state}>
      {text}
    </span>
  );
}
