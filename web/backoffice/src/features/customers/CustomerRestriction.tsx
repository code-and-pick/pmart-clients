// 고객 계정 제한(customer 0.16.0 CU-7, 2026-11-23 — 사용자 결정: 이용제한 = 문의·리뷰 작성 막기, 정지 = 주문·로그인까지 막기, 7일 뒤 자동 해제, 영구 정지 없음).
// - 지금 상태·이력 `GET /customers/{id}/restrictions`(최근 50개, 자동 정지는 source AUTO_PROFANITY·actor system:…) — 상태·기한은 서버 값 그대로(화면이 기한을 계산하지 않음).
// - 걸기 `POST …/restrictions` {restriction: RESTRICTED|SUSPENDED, reason 2~200} — 지금부터 7일(기한은 서버가 정함). 이미 제한 중이면 새 값·새 기한으로 바뀐다.
// - 풀기 `POST …/restriction-releases` {reason} — 오인식 등. 제한이 없으면 409 NOT_RESTRICTED. 탈퇴 완료 고객은 409 INVALID_STATE(그래서 단추를 숨긴다).
// - 사유는 화면에만(로그 없음). 보낼 값은 누른 때 명령 값으로(결과 불명 뒤 같은 키로 다시 확인할 때 처음 값). 역할 CS_AGENT·OPERATOR_ADMIN(고객 메뉴와 같음).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/customer';
import { useApi } from '../../app/ApiContext';
import { DataTable, Section, StatusBadge, type Tone } from '../../shared/admin';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { StaffName } from '../lookup/parts';

const m = messages.customerRestriction;
type Restriction = components['schemas']['AccountRestriction'];
type Level = 'RESTRICTED' | 'SUSPENDED';
const LEVELS: readonly Level[] = ['RESTRICTED', 'SUSPENDED'];
const TONE: Readonly<Record<string, Tone>> = { NONE: 'success', RESTRICTED: 'warning', SUSPENDED: 'error' };
const reasonOk = (r: string) => r.trim().length >= 2 && r.trim().length <= 200;

function Restrict({ customerId, current, onDone }: { readonly customerId: string; readonly current: Restriction; readonly onDone: () => void }) {
  const api = useApi();
  const [level, setLevel] = useState<Level>('RESTRICTED');
  const [reason, setReason] = useState('');
  const [ask, setAsk] = useState(false);
  const cmd = useCommand(async (v: { readonly restriction: Level; readonly reason: string }, key) => {
    const r = await request('POST', api.customer.POST('/customers/{customerId}/restrictions', { ...commandParams(key, { path: { customerId } }), body: v }));
    setReason('');
    setAsk(false);
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 p-3 text-sm"
      aria-label={m.restrictTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (reasonOk(reason)) setAsk(true);
      }}
    >
      <p className="font-semibold">{current === 'NONE' ? m.restrictTitle : m.changeTitle}</p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">{m.level}</legend>
        {LEVELS.map((l) => (
          <label key={l} className="flex items-start gap-1.5">
            <input type="radio" className="radio radio-xs mt-0.5" name={`restriction-${customerId}`} checked={level === l} onChange={() => setLevel(l)} disabled={cmd.busy} />
            <span>
              {m.levelName[l]}
              <span className="block text-xs text-base-content/55">{m.levelHint[l]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.reason}
        <input className="input input-sm w-full" maxLength={200} autoComplete="off" placeholder={m.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} disabled={cmd.busy} />
      </label>
      {ask ? (
        // 브라우저 확인 창 대신 줄 안에서 한 번 더 묻기
        <div className="flex flex-wrap items-center gap-2 rounded-box border border-warning/40 bg-warning/5 px-3 py-2 text-xs" role="group" aria-label={m.confirm}>
          <span>{m.ask(m.levelName[level])}</span>
          <button
            type="button"
            className={`btn btn-xs ${level === 'SUSPENDED' ? 'btn-error' : 'btn-warning'}`}
            disabled={cmd.busy}
            onClick={() => {
              if (cmd.phase.kind === 'rejected') cmd.reset();
              void cmd.run({ restriction: level, reason: reason.trim() });
            }}
          >
            {m.apply(m.levelName[level])}
          </button>
          <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={() => setAsk(false)}>
            {m.cancel}
          </button>
        </div>
      ) : (
        <button type="submit" className="btn btn-sm btn-outline" disabled={!reasonOk(reason) || cmd.busy}>
          {m.next}
        </button>
      )}
      <CommandFeedback command={cmd} />
    </form>
  );
}

function Release({ customerId, onDone }: { readonly customerId: string; readonly onDone: () => void }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (why: string, key) => {
    const r = await request('POST', api.customer.POST('/customers/{customerId}/restriction-releases', { ...commandParams(key, { path: { customerId } }), body: { reason: why } }));
    setReason('');
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 p-3 text-sm"
      aria-label={m.releaseTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reasonOk(reason)) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run(reason.trim());
      }}
    >
      <p className="font-semibold">{m.releaseTitle}</p>
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.reason}
        <input className="input input-sm w-full" maxLength={200} autoComplete="off" placeholder={m.releaseHint} value={reason} onChange={(e) => setReason(e.target.value)} disabled={cmd.busy} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!reasonOk(reason) || cmd.busy}>
        {m.release}
      </button>
      <CommandFeedback command={cmd} />
    </form>
  );
}

/** 고객 상세 "계정 제한" 칸 — withdrawn(탈퇴 완료)면 걸기·풀기 없이 보기만 */
export function CustomerRestriction({ customerId, withdrawn }: { readonly customerId: string; readonly withdrawn: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const key = ['customers', 'restrictions', customerId];
  const q = useQuery({ queryKey: key, queryFn: () => request('GET', api.customer.GET('/customers/{customerId}/restrictions', { params: { path: { customerId } } })) });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  return (
    <Section title={m.title} testId="customer-restriction">
      <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
        {(r) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="customer-restriction-now">
              <StatusBadge tone={TONE[r.restriction] ?? 'ghost'}>{label(m.levelName, r.restriction)}</StatusBadge>
              {r.restriction !== 'NONE' && r.restrictedUntil && <span className="text-base-content/70">{m.until(when(r.restrictedUntil))}</span>}
              {r.restriction !== 'NONE' && <span className="text-xs text-base-content/55">{m.levelHint[r.restriction] ?? ''}</span>}
            </div>
            {withdrawn ? (
              <p className="text-xs text-base-content/60">{m.withdrawn}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <Restrict customerId={customerId} current={r.restriction} onDone={refresh} />
                {r.restriction !== 'NONE' && <Release customerId={customerId} onDone={refresh} />}
              </div>
            )}
            {r.items.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-base-content/60">{m.history}</p>
                <DataTable>
                  <thead>
                    <tr>
                      <th>{m.col.at}</th>
                      <th>{m.col.change}</th>
                      <th>{m.col.until}</th>
                      <th>{m.col.by}</th>
                      <th>{m.col.reason}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((x) => (
                      <tr key={x.recordId} data-testid="customer-restriction-row">
                        <td className="whitespace-nowrap">{when(x.createdAt)}</td>
                        <td className="whitespace-nowrap">
                          {label(m.levelName, x.previous)} → {label(m.levelName, x.restriction)}
                        </td>
                        <td className="whitespace-nowrap">{x.restriction === 'NONE' ? messages.none : when(x.restrictedUntil)}</td>
                        <td className="whitespace-nowrap">{x.source === 'AUTO_PROFANITY' ? m.auto : <StaffName id={x.actor} />}</td>
                        <td className="max-w-[24rem] truncate" title={x.reason ?? undefined}>
                          {text(x.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </div>
        )}
      </QueryState>
    </Section>
  );
}
