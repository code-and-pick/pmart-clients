// 라이더 탈퇴 신청 목록(2026-11-20, PC 5 — 사용자 "라이더 쪽에만 넣어", rider 0.19.0 `GET /riders/withdrawals`).
// 완료(개인정보는 이미 지워져 라이더 번호만)와 거절(막은 것 — 진행 중 배송·확정 전 수행료 등)을 최근 신청 순으로. 통합 백오피스에는 없다.
// 탈퇴한 라이더는 라이더 찾기·상세에서 빠지므로 번호를 링크로 걸지 않는다(거절된 라이더만 상세로 간다).
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { useCenterQuery } from '../../app/CenterScope';
import { ChipGroup, CursorPager, DataTable, GuideBox, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { RiderName, riderNumberInput } from '../../shared/displayNumbers';
import { Caret, expandRowProps, InlineDetail, useInlineOpen } from '../../shared/simList';
import { RiderDeliveriesButton, RiderInline } from './RiderPages';
import { none, when } from '../../shared/opsUi';
import { ui } from '../../shared/uiMessages';

type Withdrawal = components['schemas']['StaffRiderWithdrawal'];
type Blocker = components['schemas']['WithdrawalBlocker'];
type StateFilter = '' | 'COMPLETED' | 'REJECTED';

export const withdrawalMessages = {
  title: '탈퇴',
  intro:
    '라이더가 앱에서 낸 탈퇴 신청이에요(최근 신청 순). 완료된 라이더는 이름·전화가 이미 지워져 라이더 번호만 남아요. 탈퇴 불가는 진행 중 배송·확정 전 수행료 등으로 서버가 탈퇴를 막은 신청이에요(이유와 함께) — 라이더가 다시 신청하면 다시 검사해요.',
  // 2026-11-24 사용자 "탈퇴 필터에 거절은 뭐야? 뭘 거절한 거야?" — 서버가 탈퇴를 막은 신청(진행 중 배송·확정 전 수행료 등)이라 "탈퇴 불가"
  state: { '': '모두', COMPLETED: '탈퇴 완료', REJECTED: '탈퇴 불가' } as const satisfies Record<StateFilter, string>,
  stateLabel: '결과',
  stateName: { PENDING: '처리 중', COMPLETED: '탈퇴 완료', REJECTED: '탈퇴 불가' } as Readonly<Record<string, string>>,
  blocker: {
    ACTIVE_DELIVERY: '진행 중 배송',
    UNCONFIRMED_EARNING: '확정 전 수행료',
    EARNING_ADJUSTMENT_PENDING: '산정 불가 조정 대기',
    OPEN_HELP_REQUEST: '열린 도움요청',
    RESTRICTION_REVIEW: '제한 검토 중',
  } as const satisfies Record<Blocker, string>,
  riderNumber: '라이더 번호',
  findByNumber: '번호로 찾기',
  search: '조회',
  reset: '초기화',
  empty: '탈퇴 신청이 없어요.',
  col: { rider: '라이더', state: '결과', blockers: '막은 이유', reason: '라이더가 적은 사유', requestedAt: '신청', completedAt: '탈퇴시점' },
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
  // 줄을 누르면 바로 아래에 라이더 상세를 펼친다(라이더 찾기와 같게 — 전에는 번호 글자만 링크라 줄을 눌러도 아무 일이 없었다, 사용자 2026-11-21)
  const inline = useInlineOpen();

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

  const cq = useCenterQuery(); // 머리줄 센터 고르기(RS-7)
  const query = useQuery({
    queryKey: ['rider-withdrawals', cq.mfcId ?? '', state, riderNumber, page],
    queryFn: () =>
      request(
        'GET',
        api.riders.GET('/riders/withdrawals', {
          params: { query: { ...cq, ...(state ? { state } : {}), ...(riderNumber ? { riderNumber } : {}), page, size: PAGE_SIZE } },
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
          // 2026-11-24 사용자 "이렇게 번호로 검색한 것도 필터로 치나?" — 찾기 칸에 적은 글자는 칸에 그대로 보여 칩·필터 개수에 넣지 않는다(지급 예정일과 같음)
          [v.riderNumber, '', () => {
            setDraft('');
            set({ riderNumber: '' });
          }],
          [v.stateLabel, state ? v.state[state] : '', () => set({ state: '' })],
        ]}
        // 왼쪽 찾기 칸(시뮬레이터처럼) — 라이더 번호(R4785). 결과 거르기는 깔때기 팝업
        search={
          <input
            type="search"
            className="input input-sm w-44 font-mono"
            value={draft}
            maxLength={6}
            placeholder={`${v.riderNumber} R4785`}
            aria-label={v.riderNumber}
            onChange={(e) => setDraft(riderNumberInput(e.target.value))}
          />
        }
      >
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
                  {items.map((w, i) => {
                    const k = `${w.riderId}-${w.requestedAt}-${i}`;
                    const isOpen = inline.isOpen(k);
                    const to = `/riders/${encodeURIComponent(w.riderId)}`;
                    return (
                    <Fragment key={k}>
                    <tr data-testid="withdrawal-row" {...expandRowProps(isOpen, () => inline.toggle(k))}>
                      <td className="font-mono font-semibold">
                        <Caret open={isOpen} />
                        {/* 탈퇴 완료도 상세로(rider 0.20.0 includeWithdrawn — 남은 수행료·배정·컴플레인 기록) */}
                        <Link className="hover:underline" to={to} onClick={(e) => e.stopPropagation()}>
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
                    {isOpen && (
                      <InlineDetail colSpan={6} to={to} testId="withdrawal-inline" actions={<RiderDeliveriesButton riderId={w.riderId} />}>
                        <RiderInline riderId={w.riderId} />
                      </InlineDetail>
                    )}
                    </Fragment>
                    );
                  })}
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
