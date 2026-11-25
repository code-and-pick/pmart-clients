// 오배송 차감(2026-11-24, PC 5 — 백엔드 execution 0.41.0 DE-9, ADR-0086. 사용자 "PR이 합쳐지면 라이더 앱과 라이더 백오피스 화면 만들어").
// - 보기: `GET /rider-deductions?riderId&state&caseId`(RIDER_OPS·OPERATOR_ADMIN·CS_AGENT). 최근 순 200건. riderId 를 주면 remainingTotal·pendingTotal.
// - 이의 결정: `POST /rider-deductions/{id}/decisions`(OBJECTED 만, RIDER_OPS·OPERATOR_ADMIN) — ACCEPT = 차감 취소, REJECT = 확정. 메모 2~500자(라이더도 본다).
// 금액·기한·남은 금액은 서버 값을 그대로 보인다(클라이언트 계산 없음).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { AllDone, ChipGroup, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { DeliveryRef, resolveDeliveryId, resolveRiderId, RiderRef, searchHint, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { when, won } from '../../shared/opsUi';
import { ui } from '../../shared/uiMessages';
import { caseDetailPath } from '../cases/CasePages';

export type DeductionState = 'PENDING_OBJECTION' | 'OBJECTED' | 'CONFIRMED' | 'CANCELLED';
const STATES: readonly DeductionState[] = ['OBJECTED', 'PENDING_OBJECTION', 'CONFIRMED', 'CANCELLED'];

export const deductionText = {
  title: '오배송 차감',
  state: '상태',
  all: '전체',
  stateName: { PENDING_OBJECTION: '이의 기간', OBJECTED: '이의 결정 대기', CONFIRMED: '확정', CANCELLED: '취소' } as Readonly<Record<string, string>>,
  rider: searchHint.rider,
  search: '조회',
  reset: '지우기',
  empty: '이 조건의 차감이 없어요.',
  allDone: '결정할 차감 이의가 없어요.',
  onlyCase: '이 사건의 차감만 보는 중',
  showAll: '전체 보기',
  remainingTotal: '앞으로 뺄 금액',
  pendingTotal: '확정 전 금액',
  col: { rider: '라이더', amount: '차감 금액', remaining: '남은 금액', objection: '라이더 이의', applied: '정산에서 뺀 기록', recovery: '회수 배송', case: '오배송 사건' },
  caseLink: '사건 보기',
  createdAt: '생김',
  applied: (date: string, amount: string) => `${date.slice(5).replace('-', '/')} 지급 −${amount}`,
  waitObjection: (deadline: string) => `${deadline}까지 라이더 이의를 기다려요 — 이의가 없으면 확정돼요`,
  confirmedNoObjection: (at: string) => `이의 없이 확정 · ${at}`,
  decisionName: { ACCEPT: '이의 받아들임(차감 취소)', REJECT: '이의 거절(차감 확정)' } as Readonly<Record<string, string>>,
  decidedLine: (d: string, at: string) => `${d} · ${at} ·`,
  note: '결정 메모(라이더도 봐요, 개인정보 금지)',
  accept: '이의 받아들임',
  reject: '이의 거절',
  decided: '결정했어요.',
  doneLine: (rider: string, amount: string, state: string) => `${rider} · −${amount} 차감을 ${state}(으)로 결정했어요.`,
  opsOnly: '라이더 운영·관리자만 결정할 수 있어요',
  sys: { deduction: '차감', delivery: '배송', order: '주문', rider: '라이더', case: '사건' },
  // 0.43.0 직원 직접 차감
  manualTag: '직접 차감',
  manualReason: '차감 사유',
  manualBy: '만든 직원',
  create: {
    open: '직접 차감',
    close: '닫기',
    title: '직접 차감',
    // 사용자 결정: 회수품이 상해 폐기돼도 자동 차감은 없다 — 필요하면 여기서(라이더 백엔드 2026-11-24)
    hint: '자동 차감이 안 생긴 오배송(회수품 폐기 등)에 써요. 라이더는 5일 안에 이의할 수 있어요.',
    delivery: searchHint.delivery,
    caseId: '오배송 사건 번호',
    amount: '금액(원) — 비우면 결제 금액 − 배달비',
    reason: '차감 사유(라이더도 봐요, 개인정보 금지)',
    submit: '차감 만들기',
    noDelivery: '이 번호의 배송을 찾지 못했어요.',
    done: (amount: string) => `직접 차감 −${amount} 을 만들었어요. 라이더 이의 기간(5일)이 시작돼요.`,
  },
} as const;

const tone = (s: string): Tone => (s === 'OBJECTED' ? 'warning' : s === 'PENDING_OBJECTION' ? 'info' : s === 'CONFIRMED' ? 'error' : 'ghost');

export function DeductionsMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = deductionText;
  const roles = useSession().session?.roles ?? [];
  const me = useSession().session?.subject;
  const canDecide = roles.includes('RIDER_OPS') || roles.includes('OPERATOR_ADMIN');
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  // 기본은 할 일(이의 결정 대기) — 추가 배달료 "신청"과 같다
  const state: DeductionState | 'ALL' = raw === 'ALL' ? 'ALL' : STATES.find((s) => s === raw) ?? 'OBJECTED';
  const riderId = params.get('riderId') ?? '';
  const caseId = params.get('caseId') ?? '';
  const [riderInput, setRiderInput] = useState(riderId);
  // 결정하면 그 건이 "결정 대기" 목록에서 빠져 줄 안 알림이 사라지므로 위에 남긴다(지급 관리와 같음)
  const [done, setDone] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const patch = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const list = useQuery({
    queryKey: ['rider-deductions', state, riderId, caseId],
    queryFn: async () => {
      // 라이더 번호(R4785)로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [], remainingTotal: null, pendingTotal: null };
      return request(
        'GET',
        api.execution.GET('/rider-deductions', { params: { query: { ...(state === 'ALL' ? {} : { state }), ...(rid ? { riderId: rid } : {}), ...(caseId ? { caseId } : {}) } } }),
      );
    },
  });
  const items = list.data?.items ?? [];
  const deliveryNos = useDeliveryNumbers(items.flatMap((d) => [d.deliveryId, d.recoveryDeliveryId ?? undefined]));
  const riders = useRiderSummaries(items.map((d) => d.riderId));
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    patch({ riderId: riderInput.trim() });
  };
  const reset = () => {
    setRiderInput('');
    setParams({});
  };
  const totals = list.data && riderId ? list.data : null;
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader
        title={t.title}
        actions={
          canDecide && (
            <button type="button" className="btn btn-sm" aria-expanded={creating} onClick={() => setCreating((v) => !v)} data-testid="deduction-create-toggle">
              {creating ? t.create.close : t.create.open}
            </button>
          )
        }
      />
      {creating && (
        <CreateDeductionForm
          onCreated={(r) => {
            setCreating(false);
            setDone(t.create.done(won(r.amount)));
            void queryClient.invalidateQueries({ queryKey: ['rider-deductions'] });
          }}
        />
      )}
      {done && (
        <p role="status" className="alert alert-success text-sm" data-testid="deduction-done">
          {done}
        </p>
      )}
      {caseId && (
        <p role="note" className="alert flex flex-wrap justify-between text-sm" data-testid="deduction-only-case">
          <span>{t.onlyCase}</span>
          <button type="button" className="btn btn-xs" onClick={() => patch({ caseId: '' })}>
            {t.showAll}
          </button>
        </p>
      )}
      {/* 한 라이더를 찾으면 서버가 준 합계(앞으로 뺄 확정 금액 · 확정 전 금액) — 다른 조건이면 서버가 주지 않아 그리지 않는다 */}
      {totals && (totals.remainingTotal != null || totals.pendingTotal != null) && (
        <StatStrip label="차감 합계" testId="deduction-totals">
          <StatCard layout="row" label={t.remainingTotal} value={won(totals.remainingTotal)} tone={(totals.remainingTotal ?? 0) > 0 ? 'error' : undefined} testId="deduction-remaining-total" />
          <StatCard layout="row" label={t.pendingTotal} value={won(totals.pendingTotal)} tone={(totals.pendingTotal ?? 0) > 0 ? 'warning' : undefined} testId="deduction-pending-total" />
        </StatStrip>
      )}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={t.search}
        resetLabel={t.reset}
        summary={[
          [t.state, state === 'OBJECTED' ? '' : state === 'ALL' ? t.all : (t.stateName[state] ?? state), () => patch({ state: '' })],
          ['라이더', riderId && !riderInput.trim() ? '한 라이더' : '', () => {
            setRiderInput('');
            patch({ riderId: '' });
          }],
        ]}
        search={<input type="search" className="input input-sm w-48" maxLength={64} value={riderInput} placeholder={t.rider} aria-label={t.rider} onChange={(ev) => setRiderInput(ev.target.value)} />}
      >
        <SearchRow label={t.state}>
          <ChipGroup
            label={t.state}
            value={state}
            options={[...STATES, 'ALL' as const].map((s) => ({ value: s, label: s === 'ALL' ? t.all : (t.stateName[s] ?? s) }))}
            onChange={(s) => patch({ state: s === 'OBJECTED' ? '' : s })}
          />
        </SearchRow>
      </SearchPanel>

      {state === 'OBJECTED' && !riderId && !caseId && list.isSuccess && items.length === 0 ? (
        <AllDone title={ui.allDone} body={t.allDone} testId="deduction-all-done" />
      ) : (
        <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={t.empty}>
          {(x) => (
            <div className="space-y-3">
              <ResultBar count={(x.items ?? []).length} />
              <ul className="space-y-3">
                {(x.items ?? []).map((d) => (
                  <li key={d.deductionId} className="overflow-hidden rounded-box border border-base-300 bg-base-100 text-sm" data-testid="deduction-row">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={tone(d.state)}>{t.stateName[d.state] ?? d.state}</StatusBadge>
                        <DeliveryRef deliveryId={d.deliveryId} numbers={deliveryNos.get(d.deliveryId)} />
                        {d.source === 'MANUAL' && (
                          <span className="rounded border border-base-300 px-1 py-px text-xs font-semibold" data-testid="deduction-manual">
                            {t.manualTag}
                          </span>
                        )}
                        <span className="text-base font-bold tabular-nums" data-testid="deduction-amount">
                          −{won(d.amount)}
                        </span>
                      </div>
                      <span className="text-xs text-base-content/55">
                        {t.createdAt} {when(d.createdAt)}
                      </span>
                    </div>
                    <div className="space-y-2 px-5 py-3">
                      <FieldList
                        rows={[
                          [t.col.rider, <RiderRef riderId={d.riderId} summary={riders.get(d.riderId)} />],
                          !!d.reason && [t.manualReason, <span className="whitespace-pre-wrap" data-testid="deduction-reason">{d.reason}</span>],
                          !!d.createdBy && [t.manualBy, <StaffName operatorId={d.createdBy} me={me} />],
                          d.state === 'CONFIRMED' && [t.col.remaining, <span className="font-semibold tabular-nums" data-testid="deduction-remaining">{won(d.remaining)}</span>],
                          d.objection && [
                            t.col.objection,
                            <span className="whitespace-pre-wrap" data-testid="deduction-objection">
                              {d.objection.note} <span className="text-xs text-base-content/55">· {when(d.objection.objectedAt)}</span>
                            </span>,
                          ],
                          (d.applications ?? []).length > 0 && [
                            t.col.applied,
                            <span className="flex flex-wrap gap-1" data-testid="deduction-applied">
                              {(d.applications ?? []).map((a) => (
                                <span key={a.payoutDate} className="rounded border border-base-300 px-1 py-px text-xs tabular-nums">
                                  {t.applied(a.payoutDate, won(a.amount))}
                                </span>
                              ))}
                            </span>,
                          ],
                          !!d.recoveryDeliveryId && [t.col.recovery, <DeliveryRef deliveryId={d.recoveryDeliveryId} numbers={deliveryNos.get(d.recoveryDeliveryId)} />],
                          [t.col.case, <Link className="underline decoration-dotted underline-offset-4 hover:text-primary" to={caseDetailPath(d.caseId)} data-testid="deduction-case-link">{t.caseLink}</Link>],
                        ]}
                      />
                      <SystemIds ids={[[t.sys.deduction, d.deductionId], [t.sys.delivery, d.deliveryId], [t.sys.order, d.orderId], [t.sys.rider, d.riderId], [t.sys.case, d.caseId]]} />
                    </div>
                    <div className="border-t border-base-200 bg-base-200/50 px-5 py-3" data-testid="deduction-action">
                      {d.state === 'OBJECTED' ? (
                        canDecide ? (
                          <DeductionDecision
                            deductionId={d.deductionId}
                            onDecided={(r) => setDone(t.doneLine(riders.get(d.riderId)?.riderNumber ?? d.riderId, won(d.amount), t.stateName[r.state] ?? r.state))}
                            onDone={() => void queryClient.invalidateQueries({ queryKey: ['rider-deductions'] })}
                          />
                        ) : (
                          <span className="text-xs text-base-content/55">{t.opsOnly}</span>
                        )
                      ) : d.decision?.result ? (
                        <div data-testid="deduction-decided">
                          <p className="text-base-content/70">
                            <span className="mr-2 font-medium text-base-content">처리</span>
                            {t.decidedLine(t.decisionName[d.decision.result] ?? d.decision.result, when(d.decision.decidedAt))} <StaffName operatorId={d.decision.decidedBy ?? undefined} me={me} />
                          </p>
                          {d.decision.note && <p className="mt-1 whitespace-pre-wrap">{d.decision.note}</p>}
                        </div>
                      ) : d.state === 'PENDING_OBJECTION' ? (
                        <p className="text-base-content/70">{t.waitObjection(when(d.objectionDeadline))}</p>
                      ) : d.state === 'CONFIRMED' ? (
                        <p className="text-base-content/70">{t.confirmedNoObjection(when(d.confirmedAt))}</p>
                      ) : (
                        <p className="text-base-content/70">—</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </QueryState>
      )}
    </section>
  );
}

function DeductionDecision({ deductionId, onDecided, onDone }: { readonly deductionId: string; readonly onDecided: (r: { readonly state: string }) => void; readonly onDone: () => void }) {
  const api = useApi();
  const t = deductionText;
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: { decision: 'ACCEPT' | 'REJECT'; note: string }, key) => {
    try {
      const res = await request('POST', api.execution.POST('/rider-deductions/{deductionId}/decisions', { ...commandParams(key, { path: { deductionId } }), body }));
      onDecided(res);
      return res;
    } finally {
      onDone();
    }
  });
  const locked = decide.busy || decide.phase.kind === 'done';
  const ok = note.trim().length >= 2;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input className="input input-sm min-w-64 flex-1" aria-label={t.note} placeholder={t.note} maxLength={500} value={note} disabled={locked} onChange={(ev) => setNote(ev.target.value)} />
        <button type="button" className="btn btn-sm btn-primary" disabled={!ok || locked} onClick={() => void decide.run({ decision: 'ACCEPT', note: note.trim() })}>
          {t.accept}
        </button>
        <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!ok || locked} onClick={() => void decide.run({ decision: 'REJECT', note: note.trim() })}>
          {t.reject}
        </button>
      </div>
      <CommandFeedback command={decide}>{(r) => <p className="text-success">{`${t.decided} ${t.stateName[r.state] ?? r.state}`}</p>}</CommandFeedback>
    </div>
  );
}

/**
 * 직원 직접 차감(execution 0.43.0 `POST /rider-deductions`, RIDER_OPS·OPERATOR_ADMIN) — 2026-11-24 사용자 "직접 차감하는 API도 만들자".
 * 배송(번호 또는 ID) + 오배송 사건 번호 + 사유(2~300자) + 금액(선택, 비우면 서버가 결제 금액 − 배달비).
 * 409 DEDUCTION_EXISTS·422 NO_RIDER·422 AMOUNT_EXCEEDS_ORDER 는 공통 문구로 알린다. 금액 상한은 서버가 판단한다.
 */
function CreateDeductionForm({ onCreated }: { readonly onCreated: (r: { readonly amount: number }) => void }) {
  const api = useApi();
  const t = deductionText.create;
  const [delivery, setDelivery] = useState('');
  const [caseId, setCaseId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notFound, setNotFound] = useState(false);
  const create = useCommand(async (body: { deliveryText: string; caseId: string; amount?: number; reason: string }, key) => {
    const deliveryId = await resolveDeliveryId(api, body.deliveryText);
    if (deliveryId === null) {
      setNotFound(true);
      throw new Error('delivery not found');
    }
    const res = await request(
      'POST',
      api.execution.POST('/rider-deductions', {
        ...commandParams(key),
        body: { deliveryId, caseId: body.caseId, reason: body.reason, ...(body.amount ? { amount: body.amount } : {}) },
      }),
    );
    onCreated(res);
    return res;
  });
  const amountNum = amount.trim() === '' ? undefined : Number(amount);
  const amountOk = amountNum === undefined || (Number.isInteger(amountNum) && amountNum >= 1);
  const ok = delivery.trim() !== '' && caseId.trim() !== '' && reason.trim().length >= 2 && amountOk;
  const locked = create.busy;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!ok || locked) return;
    setNotFound(false);
    void create.run({ deliveryText: delivery.trim(), caseId: caseId.trim(), reason: reason.trim(), ...(amountNum ? { amount: amountNum } : {}) });
  };
  return (
    <form className="space-y-3 rounded-box border border-base-300 bg-base-100 p-5 text-sm" aria-label={t.title} onSubmit={submit} data-testid="deduction-create">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{t.title}</h2>
        <span className="text-xs text-base-content/60">{t.hint}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <input className="input input-sm w-full" aria-label={t.delivery} placeholder={t.delivery} maxLength={64} value={delivery} disabled={locked} onChange={(ev) => setDelivery(ev.target.value)} />
        <input className="input input-sm w-full" aria-label={t.caseId} placeholder={t.caseId} maxLength={64} value={caseId} disabled={locked} onChange={(ev) => setCaseId(ev.target.value)} />
        <input className="input input-sm w-full" inputMode="numeric" aria-label={t.amount} placeholder={t.amount} value={amount} disabled={locked} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9]/g, ''))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input input-sm min-w-64 flex-1" aria-label={t.reason} placeholder={t.reason} maxLength={300} value={reason} disabled={locked} onChange={(ev) => setReason(ev.target.value)} />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || locked}>
          {t.submit}
        </button>
      </div>
      {notFound ? (
        <p className="text-error" data-testid="deduction-create-not-found">
          {t.noDelivery}
        </p>
      ) : (
        <CommandFeedback command={create}>{() => null}</CommandFeedback>
      )}
    </form>
  );
}
