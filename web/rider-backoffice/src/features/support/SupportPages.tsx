// 지원센터(2026-11-17, PC 5 — ADR-0068 로 옮겨 오는 화면): 도움요청 대화(execution), 라이더 문의 대화(case 0.21.0).
// 대화는 몇 초마다 새로 불러온다(도움요청 4초, 문의 5초 — 라이더 앱과 비슷하게). 메시지 내용은 화면에만, 로그 안 함.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when } from '../../shared/opsUi';

const h = ops.help;
const q = ops.inquiries;
const n = messages.names;

// ---------------- 도움요청

export function HelpRequestsMenu() {
  return (
    <Routes>
      <Route index element={<HelpQueuePage />} />
      <Route path=":deliveryId/:requestId" element={<HelpChatPage />} />
    </Routes>
  );
}

function HelpQueuePage() {
  const api = useApi();
  const queue = useQuery({
    queryKey: ['help-queue'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.execution.GET('/delivery-help-requests', { params: { query: { size: 50 } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{h.title}</h1>
      <p className="text-sm opacity-70">{h.intro}</p>
      <QueryState state={toUiState(queue, (x) => (x.items ?? []).length === 0)} onRetry={() => void queue.refetch()} emptyText={h.empty}>
        {(x) => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{h.col.request}</th>
                <th>{h.col.delivery}</th>
                <th>{h.col.rider}</th>
                <th>{h.col.category}</th>
                <th>{h.col.state}</th>
                <th>{h.col.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {(x.items ?? []).map((it) => (
                <tr key={`${it.deliveryId}:${it.requestId}`} data-testid="help-row">
                  <td className="font-mono text-xs">
                    <Link className="link" to={`/help-requests/${encodeURIComponent(it.deliveryId ?? '')}/${encodeURIComponent(it.requestId ?? '')}`}>
                      {it.requestId}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">
                    <Link className="link" to={`/deliveries/${encodeURIComponent(it.deliveryId ?? '')}`}>
                      {it.deliveryId}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{it.riderId ?? none}</td>
                  <td>{label(n.helpCategory, it.category)}</td>
                  <td>{label(n.helpState, it.state)}</td>
                  <td>{when(it.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </section>
  );
}

function HelpChatPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { deliveryId = '', requestId = '' } = useParams();
  const path = { deliveryId, requestId };
  const detail = useQuery({
    queryKey: ['help', deliveryId, requestId],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['help-messages', deliveryId, requestId],
    refetchInterval: 4_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { params: { path } })),
  });
  const [text, setText] = useState('');
  const send = useCommand(async (body: { body: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { ...commandParams(key, { path }), body }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    }
  });
  const closed = chat.data?.helpState === 'RESOLVED';
  return (
    <section className="max-w-3xl space-y-4">
      <Link className="link text-sm" to="/help-requests">
        {h.back}
      </Link>
      <h1 className="text-xl font-bold">{h.chatTitle(requestId)}</h1>
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(d) => (
          <p className="text-sm">
            {`${label(n.helpCategory, d.category)} · ${label(n.helpState, d.state)} · ${when(d.createdAt)}`}
            {d.detail && <span className="mt-1 block whitespace-pre-wrap opacity-80">{d.detail}</span>}
          </p>
        )}
      </QueryState>
      <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
        {(c) => (
          <ol className="space-y-2" data-testid="help-messages">
            {(c.items ?? []).map((msg) => (
              <li key={msg.messageId} className={msg.senderType === 'SUPPORT' ? 'chat chat-end' : 'chat chat-start'}>
                <div className="chat-header text-xs opacity-70">{`${msg.senderType === 'SUPPORT' ? h.support : h.rider} · ${when(msg.createdAt)}`}</div>
                <div className="chat-bubble whitespace-pre-wrap">{msg.masked ? h.masked : (msg.body ?? none)}</div>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
      {closed ? (
        <p className="text-sm opacity-70">{h.closed}</p>
      ) : (
        <form
          className="flex gap-2"
          aria-label={h.write}
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void send.run({ body: text.trim() }).then(() => setText(''));
          }}
        >
          <input className="input input-sm flex-1" aria-label={h.write} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim() || send.busy}>
            {h.send}
          </button>
        </form>
      )}
      <CommandFeedback command={send}>{() => <span className="text-xs text-success">{h.sent}</span>}</CommandFeedback>
    </section>
  );
}

// ---------------- 라이더 문의

type InquiryStatus = 'RECEIVED' | 'ANSWERED' | 'CLOSED';

export function InquiriesMenu() {
  return (
    <Routes>
      <Route index element={<InquiryListPage />} />
      <Route path=":inquiryId" element={<InquiryDetailPage />} />
    </Routes>
  );
}

function InquiryListPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status') ?? 'RECEIVED';
  const status = (['RECEIVED', 'ANSWERED', 'CLOSED'] as const).includes(raw as InquiryStatus) ? (raw as InquiryStatus) : 'RECEIVED';
  const list = useQuery({
    queryKey: ['rider-inquiries', status],
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status, size: 50 } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{q.title}</h1>
      <p className="text-sm opacity-70">{q.intro}</p>
      <div role="tablist" className="tabs tabs-boxed w-fit">
        {(['RECEIVED', 'ANSWERED', 'CLOSED'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={s === status} className={s === status ? 'tab tab-active' : 'tab'} onClick={() => setParams({ status: s })}>
            {q.statusName[s]}
          </button>
        ))}
      </div>
      <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={q.empty}>
        {(x) => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{q.col.inquiry}</th>
                <th>{q.col.category}</th>
                <th>{q.col.title}</th>
                <th>{q.col.status}</th>
                <th>{q.col.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {(x.items ?? []).map((it) => (
                <tr key={it.inquiryId} data-testid="inquiry-row">
                  <td className="font-mono text-xs">
                    <Link className="link" to={`/inquiries/${encodeURIComponent(it.inquiryId ?? '')}`}>
                      {it.inquiryId}
                    </Link>
                  </td>
                  <td>{label(n.inquiryCategory, it.category)}</td>
                  <td>{it.title ?? none}</td>
                  <td>{label(q.statusName, it.status)}</td>
                  <td>{when(it.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </section>
  );
}

function InquiryDetailPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { inquiryId = '' } = useParams();
  const path = { inquiryId };
  const inquiry = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['inquiry-messages', inquiryId],
    refetchInterval: 5_000,
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}/messages', { params: { path } })),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inquiry', inquiryId] });
    void queryClient.invalidateQueries({ queryKey: ['inquiry-messages', inquiryId] });
  };
  const [text, setText] = useState('');
  const reply = useCommand(async (body: { body: string }, key) => {
    try {
      return await request(
        'POST',
        api.cases.POST('/inquiries/{inquiryId}/replies', {
          ...commandParams(key, { path, ...(inquiry.data?.version !== undefined ? { version: inquiry.data.version } : {}) }),
          body,
        }),
      );
    } finally {
      refresh();
    }
  });
  const [closeReason, setCloseReason] = useState('');
  const close = useCommand(async (body: { reason: string }, key) => {
    try {
      return await request('POST', api.cases.POST('/inquiries/{inquiryId}/closures', { ...commandParams(key, { path }), body }));
    } finally {
      refresh();
    }
  });
  const closed = (chat.data?.status ?? inquiry.data?.status) === 'CLOSED';
  return (
    <section className="max-w-3xl space-y-4">
      <Link className="link text-sm" to="/inquiries">
        {q.back}
      </Link>
      <h1 className="text-xl font-bold">{q.detailTitle(inquiryId)}</h1>
      <QueryState state={toUiState(inquiry)} onRetry={() => void inquiry.refetch()}>
        {(d) => (
          <div className="rounded-box bg-base-100 p-4 text-sm">
            <p className="text-xs opacity-70">{`${q.first} · ${label(n.inquiryCategory, d.category)} · ${label(q.statusName, d.status)} · ${when(d.createdAt)}`}</p>
            {d.title && <p className="font-semibold">{d.title}</p>}
            <p className="whitespace-pre-wrap">{d.body}</p>
          </div>
        )}
      </QueryState>
      <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
        {(c) => (
          <ol className="space-y-2" data-testid="inquiry-messages">
            {(c.items ?? []).map((msg) => (
              <li key={msg.messageId} className={msg.senderType === 'SUPPORT' ? 'chat chat-end' : 'chat chat-start'}>
                <div className="chat-header text-xs opacity-70">{`${msg.senderType === 'SUPPORT' ? h.support : h.rider} · ${when(msg.createdAt)}`}</div>
                <div className="chat-bubble whitespace-pre-wrap">{msg.body}</div>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
      {!closed && (
        <>
          <form
            className="flex gap-2"
            aria-label={q.reply}
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void reply.run({ body: text.trim() }).then(() => setText(''));
            }}
          >
            <input className="input input-sm flex-1" aria-label={q.reply} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim() || reply.busy}>
              {q.send}
            </button>
          </form>
          <CommandFeedback command={reply}>{() => <span className="text-xs text-success">{q.sent}</span>}</CommandFeedback>
          <form
            className="flex items-end gap-2 text-sm"
            aria-label={q.close}
            onSubmit={(e) => {
              e.preventDefault();
              if (closeReason.trim().length >= 2) void close.run({ reason: closeReason.trim() });
            }}
          >
            <label className="flex flex-1 flex-col gap-1">
              {q.closeReason}
              <input className="input input-sm" maxLength={500} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-sm" disabled={closeReason.trim().length < 2 || close.busy}>
              {q.close}
            </button>
          </form>
          <CommandFeedback command={close}>{() => <span className="text-xs text-success">{q.closed}</span>}</CommandFeedback>
        </>
      )}
    </section>
  );
}
