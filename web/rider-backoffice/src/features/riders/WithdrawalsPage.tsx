// 라이더 탈퇴 신청 목록(2026-11-20, PC 5 — 사용자 "라이더 쪽에만 넣어", rider 0.19.0 `GET /riders/withdrawals`).
// 완료(개인정보는 이미 지워져 라이더 번호만)와 거절(막은 것 — 진행 중 배송·확정 전 수행료 등)을 최근 신청 순으로. 통합 백오피스에는 없다.
// 탈퇴한 라이더는 라이더 찾기·상세에서 빠지므로 번호를 링크로 걸지 않는다(거절된 라이더만 상세로 간다).
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CursorPager, DataTable, GuideBox, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { RiderName } from '../../shared/displayNumbers';
import { none, when } from '../../shared/opsUi';
import { ui } from '../../shared/uiMessages';

type Withdrawal = components['schemas']['StaffRiderWithdrawal'];
type Blocker = components['schemas']['WithdrawalBlocker'];
type StateFilter = '' | 'COMPLETED' | 'REJECTED';

export const withdrawalMessages = {
  title: '탈퇴',
  intro:
    '라이더가 앱에서 낸 탈퇴 신청이에요(최근 신청 순). 완료된 라이더는 이름·전화가 이미 지워져 라이더 번호만 남아요. 거절은 탈퇴를 막은 이유와 함께 보여요 — 라이더가 다시 신청하면 다시 검사해요.',
  state: { '': '모두', COMPLETED: '탈퇴 완료', REJECTED: '거절' } as const satisfies Record<StateFilter, string>,
  stateLabel: '결과',
  stateName: { PENDING: '처리 중', COMPLETED: '탈퇴 완료', REJECTED: '거절' } as Readonly<Record<string, string>>,
  blocker: {
    ACTIVE_DELIVERY: '진행 중 배송',
    UNCONFIRMED_EARNING: '확정 전 수행료',
    EARNING_ADJUSTMENT_PENDING: '산정 불가 조정 대기',
    OPEN_HELP_REQUEST: '열린 도움요청',
    RESTRICTION_REVIEW: '제한 검토 중',
  } as const satisfies Record<Blocker, string>,
  riderNumber: '라이더 번호(6자리)',
  findByNumber: '번호로 찾기',
  search: '찾기',
  reset: '초기화',
  empty: '탈퇴 신청이 없어요.',
  col: { rider: '라이더', state: '결과', blockers: '막은 이유', reason: '라이더가 적은 사유', requestedAt: '신청', completedAt: '탈퇴한 때' },
  withdrawnNote: '탈퇴함',
} as const;

const v = withdrawalMessages;
const STATES = Object.keys(v.state) as StateFilter[];
const tone = (s: Withdrawal['state']): Tone => (s === 'COMPLETED' ? 'ghost' : s === 'REJECTED' ? 'warning' : 'info');
const PAGE_SIZE = 20;

export function WithdrawalsMenu() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const rawState = params.get('state') ?? '';
  const state: StateFilter = STATES.find((s) => s === rawState) ?? '';
  const riderNumber = params.get('riderNumber') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const [draft, setDraft] = useState(riderNumber);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, val] of Object.entries(patch)) {
      if (val) next.set(k, val);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ riderNumber: draft });
  };
  const reset = () => {
    setDraft('');
    setParams({});
  };

  const query = useQuery({
    queryKey: ['rider-withdrawals', state, riderNumber, page],
    queryFn: () =>
      request(
        'GET',
        api.riders.GET('/riders/withdrawals', {
          params: { query: { ...(state ? { state } : {}), ...(riderNumber ? { riderNumber } : {}), page, size: PAGE_SIZE } },
        }),
      ),
  });

  return (
    <section className="space-y-4">
      <PageHeader title={v.title} />
      <GuideBox title={ui.guideTitle} items={[v.intro]} storeKey="rider-withdrawals" testId="withdrawals-guide" />
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={v.search}
        resetLabel={v.reset}
        summary={[
          [v.riderNumber, riderNumber],
          [v.stateLabel, state ? v.state[state] : ''],
        ]}
      >
        <SearchRow label={v.findByNumber}>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{v.riderNumber}</span>
            <input
              className="input input-sm w-32 font-mono"
              value={draft}
              maxLength={6}
              inputMode="numeric"
              aria-label={v.riderNumber}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        </SearchRow>
        <SearchRow label={v.stateLabel}>
          <ChipGroup label={v.stateLabel} value={state} options={STATES.map((s) => ({ value: s, label: v.state[s] }))} onChange={(s) => set({ state: s })} />
        </SearchRow>
      </SearchPanel>
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={v.empty}>
        {(x) => {
          const items = x.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!x.hasNext} />
              <DataTable testId="withdrawals-table">
                <thead>
                  <tr>
                    <th>{v.col.rider}</th>
                    <th>{v.col.state}</th>
                    <th>{v.col.blockers}</th>
                    <th>{v.col.reason}</th>
                    <th>{v.col.requestedAt}</th>
                    <th>{v.col.completedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w, i) => (
                    <tr key={`${w.riderId}-${w.requestedAt}-${i}`} data-testid="withdrawal-row">
                      <td className="font-mono font-semibold">
                        {/* 탈퇴 완료도 상세로(rider 0.20.0 includeWithdrawn — 남은 수행료·배정·컴플레인 기록) */}
                        <Link className="hover:underline" to={`/riders/${encodeURIComponent(w.riderId)}`}>
                          <RiderName riderId={w.riderId} riderNumber={w.riderNumber} />
                        </Link>
                        {w.state === 'COMPLETED' && <span className="ml-1 text-xs font-normal text-base-content/50">{v.withdrawnNote}</span>}
                      </td>
                      <td>
                        <StatusBadge tone={tone(w.state)}>{v.stateName[w.state] ?? w.state}</StatusBadge>
                      </td>
                      <td className="text-sm">{w.blockers.length > 0 ? w.blockers.map((b) => v.blocker[b] ?? b).join(', ') : none}</td>
                      <td className="max-w-xs text-sm break-words">{w.reason ?? none}</td>
                      <td className="whitespace-nowrap">{when(w.requestedAt)}</td>
                      <td className="whitespace-nowrap">{w.completedAt ? when(w.completedAt) : none}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager hasPrev={page > 0} nextCursor={x.hasNext ? String(page + 1) : null} page={page + 1} onFirst={() => set({ page: '' })} onNext={(c) => set({ page: c })} />
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
