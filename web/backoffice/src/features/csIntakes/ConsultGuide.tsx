// 상담 도우미 칸(ai-assistant 1.4.0 GET /assistant/consult-guides, ADR-0093 — 요청서 clients/backoffice/2026-11-28-request-cs-consult-assistant).
// 상담원이 문의 종류를 고르는 순간 ① 본인 확인(운영자 RAG backoffice/05 제15조) ② 그 문의의 정책 근거를 먼저 보인다. 아무것도 실행하지 않는다.
// - 보내는 것: 문의 종류·회원 조회 결과(화면 값)·주문 상태 이름뿐. 고객 ID·주문 번호·전화번호·주소는 보내지 않는다.
// - 403 = 칸을 숨긴다. 503·그 밖 실패 = "지금 안내를 불러오지 못했어요"만 — 접수는 막지 않는다.
// - 본인 확인 표: 서버는 절 전체를 준다 — 지금 문의 종류의 줄과 회원 조회 결과에 맞는 열을 화면이 강조한다.
// - 아래 자유 질문 = 기존 POST /assistant/policy-questions(채팅 sessionId 로 이어 묻기, context screen "cs-intake").
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ProblemFailure, request, type IdempotencyKey } from '@pmart/web-core';
import { useCommand } from '@pmart/web-ui';
import type { components } from '../../api/generated/ai-assistant';
import { SOURCE_SYSTEM } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { Markdown } from '../../shared/Markdown';
import { messages } from '../../shared/messages';
import { Icon, ICON } from '../inquiries/HelpdeskParts';
import { useAssistant } from '../assistant/AssistantContext';
import { AnswerView } from '../assistant/AnswerView';
import type { AssistantAnswer } from '../assistant/model';

const m = messages.consultGuide;
type Guide = components['schemas']['ConsultGuide'];
type Citation = components['schemas']['Citation'];
export type ConsultCategory = 'ORDER' | 'DELIVERY' | 'PAYMENT' | 'REFUND' | 'PRODUCT' | 'ACCOUNT' | 'OTHER';

/** 상담 도우미를 부를 수 있는 역할(서버 설정 consult-guide.roles 기본값 — 그 밖 403 이면 숨김) */
export const canUseConsultGuide = (roles: readonly string[]) => roles.includes('CS_AGENT') || roles.includes('OPERATOR_ADMIN');

/** 절 이름 "문서 제목 > … > 제15조 (…)" → 마지막 마디·첫 마디 */
export const sectionTail = (s: string | null | undefined) => (s ? (s.split('>').at(-1)?.trim() ?? s) : '');
const sectionHead = (s: string | null | undefined) => (s && s.includes('>') ? (s.split('>')[0]?.trim() ?? '') : '');

/** 표 줄 첫 칸이 지금 문의 종류인지(칸 글자를 "·"·"/"로 나눠 낱말 비교) */
export function rowIsCategory(cell: string | undefined, category: ConsultCategory): boolean {
  const parts = (cell ?? '').replace(/\*\*/g, '').split(/[·/,]/).map((x) => x.trim()).filter(Boolean);
  return parts.some((p) => m.rowWords[category].some((w) => p === w || p.startsWith(w)));
}

/** 머리 글자가 회원 조회 결과 열인지 — "조회되지 않을 때" / "조회될 때" */
export function columnIsMember(head: string, memberFound: boolean): boolean {
  const notFound = /않/.test(head) || /없/.test(head);
  return /조회/.test(head) && (memberFound ? !notFound : notFound);
}

export function ConsultGuidePanel({ category, memberFound, orderStatus }: { readonly category: ConsultCategory | ''; readonly memberFound?: boolean | undefined; readonly orderStatus?: string | null }) {
  const api = useApi();
  const { session } = useSession();
  const allowed = canUseConsultGuide(session?.roles ?? []);
  const q = useQuery({
    queryKey: ['assistant-consult', category, memberFound ?? '-', orderStatus ?? '-'],
    enabled: allowed && category !== '',
    staleTime: 60_000,
    queryFn: () =>
      request(
        'GET',
        api.assistant.GET('/assistant/consult-guides', {
          params: {
            header: { 'X-Source-System': SOURCE_SYSTEM },
            query: {
              category: category as ConsultCategory,
              ...(memberFound !== undefined ? { memberFound } : {}),
              ...(orderStatus ? { orderStatus } : {}),
            },
          },
        }),
      ),
  });
  if (!allowed) return null;
  if (q.isError && q.error instanceof ProblemFailure && q.error.problem.status === 403) return null;

  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.title} data-testid="consult-guide">
      <h2 className="flex items-center gap-2 border-b border-base-300 px-4 py-3 text-sm font-semibold">
        <Icon d={ICON.task} className="h-4 w-4 text-base-content/50" />
        {m.title}
      </h2>
      <div className="space-y-3 px-4 py-3.5 text-sm">
        {category === '' ? (
          <p className="text-xs text-base-content/60" data-testid="consult-guide-idle">{m.pickCategory}</p>
        ) : q.isPending ? (
          <p role="status" className="flex items-center gap-2 text-xs text-base-content/60">
            <span className="loading loading-spinner loading-xs" />
            {m.loading}
          </p>
        ) : q.isError ? (
          <div className="flex items-center justify-between gap-2 text-xs text-base-content/70" data-testid="consult-guide-failed">
            <span>{m.failed}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void q.refetch()}>
              {messages.retry}
            </button>
          </div>
        ) : (
          <GuideBody guide={q.data} category={category} />
        )}
        <p className="text-xs text-base-content/50">{m.noRun}</p>
        <ConsultQuestion />
      </div>
    </section>
  );
}

function GuideBody({ guide, category }: { readonly guide: Guide; readonly category: ConsultCategory }) {
  const memberFound = guide.memberFound;
  return (
    <>
      <div className="space-y-2 rounded-box border border-primary/30 bg-primary/5 px-3 py-2.5" data-testid="consult-identity">
        <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
          {m.identityTitle}
          {guide.identity && <span className="text-xs font-normal text-base-content/55">{sectionTail(guide.identity.section)}</span>}
        </p>
        {memberFound !== null && memberFound !== undefined && (
          <p className="text-xs text-base-content/65" data-testid="consult-member">{memberFound ? m.memberFound : m.memberNotFound}</p>
        )}
        {guide.identity ? (
          <Markdown
            source={guide.identity.excerpt ?? ''}
            className="text-xs"
            mark={{
              row: (cells) => rowIsCategory(cells[0], category),
              ...(memberFound === null || memberFound === undefined ? {} : { column: (head: string) => columnIsMember(head, memberFound) }),
            }}
          />
        ) : (
          <p className="text-xs text-base-content/60">{m.identityMissing}</p>
        )}
      </div>
      <div className="space-y-1.5" data-testid="consult-policies">
        <p className="font-semibold">
          {m.policiesTitle} <span className="font-normal text-base-content/55">({guide.policies.length})</span>
        </p>
        {guide.orderStatus && <p className="text-xs text-base-content/60">{m.forOrderStatus(messages.orders.statusName[guide.orderStatus] ?? guide.orderStatus)}</p>}
        {guide.policies.length === 0 ? (
          <p className="text-xs text-base-content/60">{m.policiesEmpty}</p>
        ) : (
          <ul className="space-y-1.5">
            {guide.policies.map((c) => (
              <PolicyItem key={c.chunkId} c={c} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function PolicyItem({ c }: { readonly c: Citation }) {
  return (
    <li>
      <details className="rounded-box border border-base-300" data-testid="consult-policy">
        <summary className="cursor-pointer px-3 py-2">
          <span className="font-medium">{sectionTail(c.section) || c.path}</span>
          {sectionHead(c.section) && <span className="ml-2 text-xs text-base-content/55">{sectionHead(c.section)}</span>}
        </summary>
        <div className="border-t border-base-300 px-3 py-2">
          <Markdown source={c.excerpt ?? ''} className="text-xs" />
          <p className="mt-2 break-all font-mono text-[11px] text-base-content/45">{c.path}</p>
        </div>
      </details>
    </li>
  );
}

/** 칸 아래 자유 질문 — 같은 칸에서 이어 묻는다(sessionId). 처리 중(PROCESSING)이면 같은 키·같은 질문으로 다시 확인 */
function ConsultQuestion() {
  const { port } = useAssistant();
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [last, setLast] = useState<{ question: string; key: IdempotencyKey } | null>(null);
  const ask = useCommand(async (v: { question: string; key?: IdempotencyKey }, key) => {
    const k = v.key ?? key;
    setLast({ question: v.question, key: k });
    const a: AssistantAnswer = await port.ask(v.question, k, sessionId, { screen: 'cs-intake' });
    if (a.sessionId) setSessionId(a.sessionId);
    return a;
  });
  if (!port.connected) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = text.trim();
    if (!question || ask.busy) return;
    if (ask.phase.kind === 'rejected') ask.reset();
    void ask.run({ question });
  };
  return (
    <form className="space-y-2 border-t border-base-200 pt-3" onSubmit={submit} aria-label={m.askTitle}>
      <label className="block text-xs font-medium text-base-content/60">
        {m.askTitle}
        <textarea className="textarea textarea-sm mt-1 w-full text-sm text-base-content" rows={2} maxLength={500} placeholder={m.askPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-2">
        {sessionId ? <span className="text-xs text-base-content/50">{m.continuing}</span> : <span />}
        <button type="submit" className="btn btn-sm" disabled={!text.trim() || ask.busy}>
          {m.ask}
        </button>
      </div>
      <CommandFeedback command={ask}>
        {(a) => (
          <div data-testid="consult-answer">
            <AnswerView
              answer={a}
              {...(last ? { question: last.question } : {})}
              linkToDetail
              onRecheck={() => {
                if (last) void ask.run({ question: last.question, key: last.key });
              }}
            />
          </div>
        )}
      </CommandFeedback>
    </form>
  );
}
