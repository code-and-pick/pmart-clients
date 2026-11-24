// 라이더 공지 보내기(2026-11-18, PC 5 — 백엔드 notification 0.5.0 `POST·GET /rider-notices`, 사용자 결정 "대상 고르기 + 알림함·푸시").
// - 쓰기: 제목 1~40자, 본문 1~500자, 대상 = 전체 라이더 또는 한 센터(배달지역에 그 센터가 있는 라이더). 보내기 전에 한 번 더 확인.
// - 받은 수(recipientCount)는 서버가 보낸 뒤 알려 준다 — 보내기 전에 지어내지 않는다.
// - 보낸 목록: 제목·대상·보낸 사람·받은 수·시각(최근 순, 커서).
// 받는 라이더 쪽은 알림함(templateKey RIDER_NOTICE)·푸시 — 라이더 앱 알림함에 그대로 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { CursorPager, DataTable, PageHeader, ResultBar, Section } from '../../shared/admin';
import { CenterPicker, useAreaName, when } from '../../shared/opsUi';
import { StaffName } from '../../shared/displayNumbers';
import { useSession } from '../../app/SessionContext';

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
  confirmNote: '보내면 거둘 수 없어요.',
  confirmSend: '보내기',
  cancel: '고치기',
  sent: (n: number) => `${n}명에게 보냈어요.`,
  writeAnother: '새 공지 쓰기',
  list: '보낸 공지',
  empty: '보낸 공지가 없어요.',
  col: { at: '보낸 시각', subject: '제목', target: '받는 라이더', by: '보낸 사람', count: '받은 수' },
  targetLine: (type: string, center: string | null | undefined) => (type === 'MFC' ? `센터 ${center ?? '—'}` : '전체'),
  people: (n: number) => `${n.toLocaleString('ko-KR')}명`,
  // 2026-11-24 사용자 "공지 보내기 기능이 너무 간단한데" → A1·3·4·5 고름
  templates: '자주 쓰는 문구',
  preview: '라이더 휴대폰에서',
  previewPush: '푸시',
  previewInbox: '알림함',
  previewEmptyTitle: '제목',
  previewEmptyBody: '내용을 쓰면 여기에 보여요.',
  appName: 'PMart 라이더',
  now: '지금',
  reuse: '다시 쓰기',
  reuseDone: '위 칸에 채웠어요. 고쳐서 보내세요.',
} as const;

/** 자주 쓰는 문구(고른 뒤 고쳐 쓴다 — 보내기 전 확인은 그대로) */
const TEMPLATES: readonly { readonly name: string; readonly title: string; readonly body: string }[] = [
  { name: '기상 악화', title: '기상 악화 — 안전 운행해 주세요', body: '비·눈으로 길이 미끄러워요. 속도를 줄이고 안전하게 운행해 주세요.' },
  { name: '시스템 점검', title: '앱 점검 안내', body: '오늘 밤 0시부터 2시까지 앱을 점검해요. 그동안 배차가 잠시 멈춰요.' },
  { name: '지급 안내', title: '수행료 지급 안내', body: '이번 지급일 수행료를 지급했어요. 앱 정산 내역에서 확인해 주세요.' },
  { name: '센터 안내', title: '센터 이용 안내', body: '픽업할 때 센터 출입구 앞에서 기다려 주세요. 혼잡할 때는 점원 안내를 따라 주세요.' },
];

/** 공지 쓰기 칸 값(보낸 목록의 "다시 쓰기"가 채운다) */
export interface NoticeDraft {
  readonly subject: string;
  readonly body: string;
  readonly type: 'ALL' | 'MFC';
  readonly mfcId: string;
}
const EMPTY_DRAFT: NoticeDraft = { subject: '', body: '', type: 'ALL', mfcId: '' };

const TITLE_MAX = 40;
const BODY_MAX = 500;

type Target = { readonly type: 'ALL' } | { readonly type: 'MFC'; readonly mfcId: string };

export function NoticesMenu() {
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY_DRAFT);
  const [reused, setReused] = useState(false);
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={noticeText.title} description={noticeText.intro} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <NoticeForm draft={draft} setDraft={(d) => { setDraft(d); setReused(false); }} reused={reused} />
        <NoticePreview subject={draft.subject} body={draft.body} />
      </div>
      <SentNotices
        onReuse={(d) => {
          setDraft(d);
          setReused(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </section>
  );
}

/** 미리보기 — 라이더 휴대폰의 푸시 한 줄과 알림함 한 칸(글자는 쓰는 대로) */
function NoticePreview({ subject, body }: { readonly subject: string; readonly body: string }) {
  const t = noticeText;
  const title = subject.trim() || t.previewEmptyTitle;
  const text = body.trim() || t.previewEmptyBody;
  return (
    <Section title={t.preview} testId="notice-preview">
      <div className="mx-auto w-full max-w-[17rem] rounded-[2rem] border-4 border-base-content/80 bg-base-200 p-3 shadow-sm">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-base-content/30" aria-hidden />
        <p className="mb-1 text-[11px] font-semibold text-base-content/50">{t.previewPush}</p>
        <div className="mb-4 rounded-2xl bg-base-100 p-3 shadow" data-testid="notice-preview-push">
          <p className="flex justify-between text-[11px] text-base-content/50">
            <span>{t.appName}</span>
            <span>{t.now}</span>
          </p>
          <p className="mt-0.5 truncate text-sm font-bold">{title}</p>
          <p className="line-clamp-2 text-xs text-base-content/75">{text}</p>
        </div>
        <p className="mb-1 text-[11px] font-semibold text-base-content/50">{t.previewInbox}</p>
        <div className="rounded-2xl bg-base-100 p-3" data-testid="notice-preview-inbox">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-base-content/80">{text}</p>
          <p className="mt-2 text-[11px] text-base-content/45">{t.now}</p>
        </div>
      </div>
    </Section>
  );
}

function NoticeForm({ draft, setDraft, reused }: { readonly draft: NoticeDraft; readonly setDraft: (d: NoticeDraft) => void; readonly reused: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = noticeText;
  const { subject, body, type, mfcId } = draft;
  const setSubject = (v: string) => setDraft({ ...draft, subject: v });
  const setBody = (v: string) => setDraft({ ...draft, body: v });
  const setType = (v: 'ALL' | 'MFC') => setDraft({ ...draft, type: v });
  const setMfcId = (v: string) => setDraft({ ...draft, mfcId: v });
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
    setDraft(EMPTY_DRAFT);
    setConfirming(false);
    send.reset();
  };
  return (
    <Section action title={t.write} testId="notice-form">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        {reused && (
          <p role="status" className="text-sm font-medium text-primary" data-testid="notice-reused">
            {t.reuseDone}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="notice-templates">
          <span className="text-base-content/60">{t.templates}</span>
          {TEMPLATES.map((tp) => (
            <button
              key={tp.name}
              type="button"
              className="btn btn-xs rounded-full border-base-300 bg-base-100 font-medium"
              disabled={locked || confirming}
              onClick={() => setDraft({ ...draft, subject: tp.title, body: tp.body })}
            >
              {tp.name}
            </button>
          ))}
        </div>
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

function SentNotices({ onReuse }: { readonly onReuse: (d: NoticeDraft) => void }) {
  const api = useApi();
  const [open, setOpen] = useState('');
  const areaName = useAreaName();
  const t = noticeText;
  const me = useSession().session?.subject;
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
                {x.items.map((n) => {
                  const isOpen = open === n.noticeId;
                  return (
                    <Fragment key={n.noticeId}>
                      <tr data-testid="notice-row" className="cursor-pointer hover:bg-base-200/50" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : n.noticeId)}>
                        <td className="whitespace-nowrap">{when(n.sentAt)}</td>
                        <td>
                          <p className="font-medium">{n.title}</p>
                          {!isOpen && <p className="line-clamp-1 text-xs text-base-content/60">{n.body}</p>}
                        </td>
                        <td className="whitespace-nowrap">{t.targetLine(n.targetType, areaName(n.mfcId))}</td>
                        <td><StaffName operatorId={n.sentBy} me={me} /></td>
                        <td className="text-right font-semibold tabular-nums">{t.people(n.recipientCount)}</td>
                      </tr>
                      {isOpen && (
                        <tr data-testid="notice-row-open">
                          <td />
                          <td colSpan={4}>
                            <div className="flex flex-wrap items-start justify-between gap-3 rounded-box bg-base-200/50 p-3">
                              <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{n.body}</p>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                data-testid="notice-reuse"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReuse({ subject: n.title, body: n.body, type: n.targetType === 'MFC' ? 'MFC' : 'ALL', mfcId: n.mfcId ?? '' });
                                }}
                              >
                                {t.reuse}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </DataTable>
            <CursorPager hasPrev={!!cursor} nextCursor={x.nextCursor} onFirst={() => go('')} onNext={go} />
          </div>
        )}
      </QueryState>
    </Section>
  );
}
