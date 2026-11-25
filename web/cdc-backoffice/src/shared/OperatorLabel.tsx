// 사본: web/mfc-backoffice/src/shared/OperatorLabel.tsx(2026-11-26 — DC 백오피스 사용자 "바꾼 사람 OP도 식별값 긴 거 그대로 떠") — 이 앱에서 따로 고친다.
// 운영자 ID → "이름 · 사번"(hr-service 0.8.0 `GET /hr/employee-labels?operatorIds=…` — 직원 토큰이면 누구나, 50개까지).
// 작업자 ID·요청자·결정자·처리자 칸이 OP-… 로만 보이던 것을 사람이 알아보게 한다. 이름은 가리지 않는 값이지만 로그에 남기지 않는다.
// - 한 화면의 여러 칸을 한 번에 묻는다: 같은 틱에 요청된 ID 를 모아 50개씩 한 요청(ID 마다 TanStack Query 캐시 — 다시 묻지 않는다).
// - 모르는 ID 는 응답에서 빠진다(오류 아님) → "직원". 조회가 실패하면 "직원(이름 못 읽음)"(없는 것과 못 읽은 것을 섞지 않는다).
// - 읽는 동안은 "…". 운영자 ID 는 화면 글자로 내지 않고 title 로만 남긴다(대조용, ADR-0070 덧붙임).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import type { Api } from '../api/client';
import type { components } from '../api/generated/hr';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';

type Label = components['schemas']['EmployeeLabel'];

const MAX = 50;

interface Waiter {
  readonly resolve: (v: Label | null) => void;
  readonly reject: (e: unknown) => void;
}

class LabelBatcher {
  private queue = new Map<string, Waiter[]>();
  private scheduled = false;

  constructor(private readonly api: Api) {}

  load(id: string): Promise<Label | null> {
    return new Promise((resolve, reject) => {
      const list = this.queue.get(id) ?? [];
      list.push({ resolve, reject });
      this.queue.set(id, list);
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => void this.flush(), 0);
      }
    });
  }

  private async flush() {
    const batch = this.queue;
    this.queue = new Map();
    this.scheduled = false;
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += MAX) {
      const chunk = ids.slice(i, i + MAX);
      try {
        const r = await request('GET', this.api.hr.GET('/hr/employee-labels', { params: { query: { operatorIds: chunk } } }));
        const byId = new Map((r.items ?? []).map((l) => [l.operatorId, l]));
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.resolve(byId.get(id) ?? null);
      } catch (e) {
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(e);
      }
    }
  }
}

const batchers = new WeakMap<Api, LabelBatcher>();
const batcherOf = (api: Api) => {
  let b = batchers.get(api);
  if (!b) {
    b = new LabelBatcher(api);
    batchers.set(api, b);
  }
  return b;
};

/** 한 운영자의 이름·사번(모르면 null). 문장 안에 넣을 때 쓴다. */
export function useOperatorLabel(id: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['operator-label', id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => batcherOf(api).load(id ?? ''),
  });
}

/** 운영자 한 칸 — "김민수 · P2026-00012". 없으면 [empty](기본 "없음"). */
export function Who({ id, empty }: { readonly id: string | null | undefined; readonly empty?: string }) {
  const q = useOperatorLabel(id);
  if (!id) return <>{empty ?? messages.none}</>;
  if (q.data)
    return (
      <span title={id} data-testid="operator-label">
        {q.data.name}
        <span className="text-base-content/60">{` · ${q.data.employeeNo}`}</span>
      </span>
    );
  // 이름을 모르거나 못 읽어도 운영자 ID 는 화면에 내지 않는다(ADR-0070 덧붙임 2026-11-19 — 모르는 ID 는 "직원"). ID 는 title(대조용)에만
  const note = q.isError ? messages.operator.failed : q.isSuccess ? messages.operator.unknown : '…';
  return (
    <span title={id} data-testid="operator-label" data-fallback={q.isError ? 'failed' : q.isSuccess ? 'unknown' : 'loading'} className={`text-xs ${q.isError ? 'text-warning' : 'text-base-content/60'}`}>
      {note}
    </span>
  );
}

/** "처리자 · 시각" 한 줄(시각이 없으면 처리자만) */
export function WhoAt({ id, at }: { readonly id: string | null | undefined; readonly at: string | null | undefined }) {
  return (
    <>
      <Who id={id} />
      {at ? ` · ${at}` : ''}
    </>
  );
}
