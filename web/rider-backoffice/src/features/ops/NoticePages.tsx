// 라이더 공지 보내기(2026-11-18, PC 5 — 백엔드 notification 0.5.0 `POST·GET /rider-notices`, 사용자 결정 "대상 고르기 + 알림함·푸시").
// - 쓰기: 제목 1~40자, 본문 1~500자, 대상 = 전체 라이더 또는 한 센터(배달지역에 그 센터가 있는 라이더). 보내기 전에 한 번 더 확인.
// - 받은 수(recipientCount)는 서버가 보낸 뒤 알려 준다 — 보내기 전에 지어내지 않는다.
// - 보낸 목록: 제목·대상·보낸 사람·받은 수·시각(최근 순, 커서).
// 받는 라이더 쪽은 알림함(templateKey RIDER_NOTICE)·푸시 — 라이더 앱 알림함에 그대로 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { CursorPager, DataTable, PageHeader, ResultBar, Section } from '../../shared/admin';
import { CenterPicker, when } from '../../shared/opsUi';

export const noticeText = {
  title: '공지 보내기',
  intro: '라이더 앱 알림함과 휴대폰 푸시로 보내요. 보낸 공지는 거둘 수 없어요.',
  write: '새 공지',
  subject: '제목',
  body: '내용',
  target: '받는 라이더',
  all: '전체 라이더',
  center: '한 센터 라이더',
  centerHint: '배달지역에 이 센터가 있는 라이더에게 보내요.',
  count: (n: number, max: number) => `${n}/${max}`,
  send: '보내기',
  confirmTitle: '이 공지를 보낼까요?',
  confirmTarget: (t: string) => `받는 라이더: ${t}`,
  confirmNote: '보내면 거둘 수 없어요. 받는 라이더 수는 보낸 뒤에 알려 드려요.',
  confirmSend: '보내기',
  cancel: '고치기',
  sent: (n: number) => `${n}명에게 보냈어요.`,
  writeAnother: '새 공지 쓰기',
  list: '보낸 공지',
  empty: '보낸 공지가 없어요.',
  col: { at: '보낸 시각', subject: '제목', target: '받는 라이더', by: '보낸 사람', count: '받은 수' },
  targetLine: (type: string, mfcId: string | null | undefined) => (type === 'MFC' ? `센터 ${mfcId ?? '—'}` : '전체'),
  people: (n: number) => `${n.toLocaleString('ko-KR')}명`,
} as const;

const TITLE_MAX = 40;
const BODY_MAX = 500;

type Target = { readonly type: 'ALL' } | { readonly type: 'MFC'; readonly mfcId: string };

export function NoticesMenu() {
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={noticeText.title} description={noticeText.intro} />
      <NoticeForm />
      <SentNotices />
    </section>
  );
}

function NoticeForm() {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = noticeText;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<'ALL' | 'MFC'>('ALL');
  const [mfcId, setMfcId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const send = useCommand(async (vars: { title: string; body: string; target: Target }, key) => {
    try {
      return await request('POST', api.notification.POST('/rider-notices', { ...commandParams(key), body: vars }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-notices'] });
    }
  });
  const target: Target | null = type === 'ALL' ? { type: 'ALL' } : mfcId ? { type: 'MFC', mfcId } : null;
  const ready = subject.trim().length >= 1 && body.trim().length >= 1 && target !== null;
  const done = send.phase.kind === 'done';
  const locked = send.busy || done;
  const reset = () => {
    setSubject('');
    setBody('');
    setConfirming(false);
    send.reset();
  };
  return (
    <Section title={t.write} testId="notice-form">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between text-base-content/70">
            {t.subject}
            <span className="text-xs text-base-content/50">{t.count(subject.length, TITLE_MAX)}</span>
          </span>
          <input className="input input-sm w-full" maxLength={TITLE_MAX} value={subject} disabled={locked || confirming} onChange={(ev) => setSubject(ev.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between text-base-content/70">
            {t.body}
            <span className="text-xs text-base-content/50">{t.count(body.length, BODY_MAX)}</span>
          </span>
          <textarea className="textarea textarea-sm h-32 w-full" maxLength={BODY_MAX} value={body} disabled={locked || confirming} onChange={(ev) => setBody(ev.target.value)} />
        </label>
        <fieldset className="space-y-2 text-sm" disabled={locked || confirming}>
          <legend className="mb-1 text-base-content/70">{t.target}</legend>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" className="radio radio-sm" name="notice-target" checked={type === 'ALL'} onChange={() => setType('ALL')} />
              {t.all}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" className="radio radio-sm" name="notice-target" checked={type === 'MFC'} onChange={() => setType('MFC')} />
              {t.center}
            </label>
          </div>
          {type === 'MFC' && (
            <div className="space-y-1">
              <CenterPicker value={mfcId} onChange={setMfcId} />
              <p className="text-xs text-base-content/55">{t.centerHint}</p>
            </div>
          )}
        </fieldset>
        {!confirming && !done && (
          <button type="submit" className="btn btn-sm btn-primary w-24" disabled={!ready}>
            {t.send}
          </button>
        )}
      </form>
      {confirming && !done && target && (
        <div role="alertdialog" aria-label={t.confirmTitle} className="mt-4 space-y-2 rounded-box border border-warning/40 bg-warning/10 p-4 text-sm" data-testid="notice-confirm">
          <p className="font-semibold">{t.confirmTitle}</p>
          <p data-testid="notice-confirm-target">{t.confirmTarget(target.type === 'ALL' ? t.all : t.targetLine('MFC', target.mfcId))}</p>
          <p className="text-base-content/70">{t.confirmNote}</p>
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-sm btn-primary w-24" disabled={send.busy} onClick={() => void send.run({ title: subject.trim(), body: body.trim(), target })}>
              {t.confirmSend}
            </button>
            <button type="button" className="btn btn-sm w-24" disabled={send.busy} onClick={() => setConfirming(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <CommandFeedback command={send}>
          {(notice) => (
            <div className="flex flex-wrap items-center gap-3" data-testid="notice-sent">
              <p className="font-semibold text-success">{t.sent(notice.recipientCount)}</p>
              <button type="button" className="btn btn-sm" onClick={reset}>
                {t.writeAnother}
              </button>
            </div>
          )}
        </CommandFeedback>
      </div>
    </Section>
  );
}

function SentNotices() {
  const api = useApi();
  const t = noticeText;
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') ?? '';
  const list = useQuery({
    queryKey: ['rider-notices', cursor],
    queryFn: () => request('GET', api.notification.GET('/rider-notices', { params: { query: { size: 30, ...(cursor ? { cursor } : {}) } } })),
  });
  const go = (c: string) => {
    const p = new URLSearchParams(params);
    if (c) p.set('cursor', c);
    else p.delete('cursor');
    setParams(p);
  };
  return (
    <Section title={t.list} testId="notice-list">
      <QueryState state={toUiState(list, (x) => x.items.length === 0)} onRetry={() => void list.refetch()} emptyText={t.empty}>
        {(x) => (
          <div className="space-y-3">
            <ResultBar count={x.items.length} more={!!x.nextCursor} />
            <DataTable>
              <thead>
                <tr>
                  <th>{t.col.at}</th>
                  <th>{t.col.subject}</th>
                  <th>{t.col.target}</th>
                  <th>{t.col.by}</th>
                  <th className="text-right">{t.col.count}</th>
                </tr>
              </thead>
              <tbody>
                {x.items.map((n) => (
                  <tr key={n.noticeId} data-testid="notice-row">
                    <td className="whitespace-nowrap">{when(n.sentAt)}</td>
                    <td>
                      <p className="font-medium">{n.title}</p>
                      <p className="line-clamp-2 whitespace-pre-wrap text-xs text-base-content/60">{n.body}</p>
                    </td>
                    <td className="whitespace-nowrap">{t.targetLine(n.targetType, n.mfcId)}</td>
                    <td className="font-mono text-xs">{n.sentBy}</td>
                    <td className="text-right">{t.people(n.recipientCount)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <CursorPager hasPrev={!!cursor} nextCursor={x.nextCursor} onFirst={() => go('')} onNext={go} />
          </div>
        )}
      </QueryState>
    </Section>
  );
}
