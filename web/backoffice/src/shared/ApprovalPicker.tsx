// 승인 고르기(2026-11-19 사용자 "배송 번호처럼 입력해야 하는 곳은 전부" + ADR-0070 덧붙임 — 승인은 번호 없이 "종류 · 요청자 · 시각").
// 승인 번호(AP-…)를 옮겨 적지 않고, 이 종류의 승인 난 요청에서 골라 칸에 넣는다. approval `GET /approvals?type=&reviewState=APPROVED`(계약에 있는 조회).
// 줄 글자는 요약 · 요청자(이름 · 사번) · 시각 — 시스템 ID 는 보이지 않는다. 못 읽으면 그렇다고(빈 목록과 구분).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import type { ApprovalType } from '../api/models';
import { useApi } from '../app/ApiContext';
import { StaffName } from '../features/lookup/parts';
import { messages } from './messages';
import { hideIds } from './hideIds';
import { when } from './ops';

const m = messages.approvalPicker;

export function ApprovalPicker({ type, selectedId, onPick }: { readonly type: ApprovalType; readonly selectedId: string; readonly onPick: (approvalId: string) => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['approval', 'picker', type],
    enabled: open,
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { type, reviewState: 'APPROVED', size: 20 } } })),
  });
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-xs self-start text-primary" onClick={() => setOpen(true)} data-testid="approval-picker-open">
        {m.open}
      </button>
    );
  const items = (q.data?.items ?? []).filter((a): a is typeof a & { approvalId: string } => Boolean(a.approvalId));
  return (
    <div className="space-y-1 rounded-box border border-primary/30 bg-base-100 p-2 shadow-sm" data-testid="approval-picker">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-base-content/60">{m.title(messages.approvals.typeName[type] ?? type)}</p>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
          {m.close}
        </button>
      </div>
      {q.isPending ? (
        <p className="px-1 py-2 text-xs text-base-content/55">…</p>
      ) : q.isError ? (
        <p className="px-1 py-2 text-xs text-warning">{m.failed}</p>
      ) : items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-base-content/55">{m.none}</p>
      ) : (
        <ul className="divide-y divide-base-300/70">
          {items.map((a) => (
            <li key={a.approvalId}>
              <button
                type="button"
                className={`flex w-full flex-wrap items-center gap-x-2 px-2 py-2 text-left text-sm hover:bg-primary/5 ${selectedId === a.approvalId ? 'bg-primary/5 font-semibold' : ''}`}
                onClick={() => {
                  onPick(a.approvalId);
                  setOpen(false);
                }}
                data-testid="approval-picker-row"
              >
                <span className="min-w-0 flex-1 truncate">{hideIds(a.summary) || messages.approvals.typeName[type] || type}</span>
                <span className="text-xs text-base-content/55">
                  <StaffName id={a.requesterId} /> · {a.submittedAt ? when(a.submittedAt) : messages.none}
                </span>
                <span className="text-xs font-medium text-primary">{m.pick}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 고른 승인 한 줄(칸 아래) — 번호 없이 요약만(ADR-0070 덧붙임) */
export function ApprovalChosen({ approvalId }: { readonly approvalId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['approval', 'detail', approvalId],
    enabled: approvalId.trim() !== '',
    queryFn: () => request('GET', api.approval.GET('/approvals/{approvalId}', { params: { path: { approvalId: approvalId.trim() } } })),
  });
  if (!approvalId.trim()) return null;
  return (
    <span className={`text-xs ${q.isError ? 'text-warning' : 'text-success'}`} role="status" data-testid="approval-chosen">
      {q.isPending ? '…' : q.isError ? m.notFound : m.chosen(hideIds(q.data.summary) || m.noSummary)}
    </span>
  );
}
