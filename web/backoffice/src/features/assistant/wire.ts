// 계약(생성 타입, ai-assistant-service 1.3.0) 응답 → 화면 모델. 목과 실서버 어댑터가 같이 쓴다.
// 계약 필수 값이 없거나 enum 밖이면 빈 값으로 메우지 않고 계약 위반으로 던진다(화면은 오류로 보인다).
import { ContractViolationFailure } from '@pmart/web-core';
import type { components } from '../../api/generated/ai-assistant';
import {
  ANSWER_MODES,
  ANSWER_STATES,
  AUTHORITIES,
  LIFECYCLE_STATUSES,
  RETRIEVAL_MODES,
  type AssistantAnswer,
  type ChatPage,
  type ChatSession,
  type ChatSummary,
  type Citation,
} from './model';

type S = components['schemas'];
export type AnswerWire = S['PolicyAnswer'];
export type CitationWire = S['Citation'];
export type ChatPageWire = S['ChatSessionPage'];
export type ChatSessionWire = S['ChatSession'];

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function oneOf<T extends string>(values: readonly T[], v: unknown, field: string, requestId?: string): T {
  if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
  throw new ContractViolationFailure(`${field} 값 이상: ${String(v)}`, requestId);
}

function need(v: unknown, field: string, requestId?: string): string {
  if (text(v)) return v;
  throw new ContractViolationFailure(`${field} 없음`, requestId);
}

function citationFrom(c: CitationWire, requestId?: string): Citation {
  const asOf = c.asOf as Partial<CitationWire['asOf']> | undefined;
  return {
    chunkId: need(c.chunkId, 'citations[].chunkId', requestId),
    documentId: need(c.documentId, 'citations[].documentId', requestId),
    path: need(c.path, 'citations[].path', requestId),
    section: orNull(c.section),
    authority: oneOf(AUTHORITIES, c.authority, 'citations[].authority', requestId),
    lifecycleStatus: oneOf(LIFECYCLE_STATUSES, c.lifecycleStatus, 'citations[].lifecycleStatus', requestId),
    supersededBy: orNull(c.supersededBy),
    proposedSupersededBy: Array.isArray(c.proposedSupersededBy) ? c.proposedSupersededBy.filter(text) : [],
    implementationEvidence:
      c.implementationEvidence && text(c.implementationEvidence.recordDate)
        ? { recordDate: c.implementationEvidence.recordDate, note: orNull(c.implementationEvidence.note) }
        : null,
    documentVersion: orNull(c.documentVersion),
    effectiveDate: orNull(c.effectiveDate),
    asOf: {
      snapshotId: need(asOf?.snapshotId, 'citations[].asOf.snapshotId', requestId),
      sourceRevision: orNull(asOf?.sourceRevision),
      sourceDirty: asOf?.sourceDirty === true,
      indexedAt: need(asOf?.indexedAt, 'citations[].asOf.indexedAt', requestId),
    },
    excerpt: typeof c.excerpt === 'string' ? c.excerpt : '',
  };
}

export function answerFromWire(w: AnswerWire, requestId?: string): AssistantAnswer {
  if (!Array.isArray(w.citations)) throw new ContractViolationFailure('citations 없음', requestId);
  return {
    answerId: need(w.answerId, 'answerId', requestId),
    sessionId: text(w.sessionId) ? w.sessionId : null,
    question: text(w.question) ? w.question : null,
    requestId: need(w.requestId, 'requestId', requestId),
    state: oneOf(ANSWER_STATES, w.state, 'state', requestId),
    answer: typeof w.answer === 'string' ? w.answer : '',
    citations: w.citations.map((c) => citationFrom(c, requestId)),
    answerMode: oneOf(ANSWER_MODES, w.answerMode, 'answerMode', requestId),
    retrievalMode: oneOf(RETRIEVAL_MODES, w.retrievalMode, 'retrievalMode', requestId),
    indexSnapshotId: orNull(w.indexSnapshotId),
    askedAt: need(w.askedAt, 'askedAt', requestId),
  };
}

function count(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new ContractViolationFailure(`items[].questionCount 값 이상: ${String(v)}`);
}

export function chatPageFromWire(w: ChatPageWire): ChatPage {
  if (!Array.isArray(w.items)) throw new ContractViolationFailure('items 없음');
  return {
    items: w.items.map(
      (i): ChatSummary => ({
        sessionId: need(i.sessionId, 'items[].sessionId'),
        title: text(i.title) ? i.title : null,
        questionCount: count(i.questionCount),
        createdAt: need(i.createdAt, 'items[].createdAt'),
        lastAskedAt: need(i.lastAskedAt, 'items[].lastAskedAt'),
      }),
    ),
    nextCursor: text(w.page?.nextCursor) ? w.page.nextCursor : null,
  };
}

export function chatSessionFromWire(w: ChatSessionWire): ChatSession {
  if (!Array.isArray(w.messages)) throw new ContractViolationFailure('messages 없음');
  return {
    sessionId: need(w.sessionId, 'sessionId'),
    createdAt: need(w.createdAt, 'createdAt'),
    lastAskedAt: need(w.lastAskedAt, 'lastAskedAt'),
    messages: w.messages.map((m) => answerFromWire(m)),
  };
}
