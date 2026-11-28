// 운영자 RAG 문서 관리(ai-assistant-service 1.4.0 태그 knowledge, ADR-0092 — 백엔드 요청서 clients/backoffice/2026-11-28-request-rag-document-admin).
// 보기·초안은 이 서비스, 반영은 approval-service RAG_DOCUMENT 승인 뒤 이 서비스가(새 판 → 1분 주기 재색인). 화면은 서버가 준 판·상태만 보인다.
import { useQuery } from '@tanstack/react-query';

import { request, requestNoContent } from '@pmart/web-core';
import type { Api } from '../../api/client';
import { commandParams, SOURCE_SYSTEM, type IdempotencyKey } from '../../api/command';
import type { components } from '../../api/generated/ai-assistant';
import type { ChangeRequestBody } from '../../api/models';
import { useApi } from '../../app/ApiContext';

type S = components['schemas'];
export type KnowledgeDocument = S['KnowledgeDocumentSummary'];
export type KnowledgeDocumentList = S['KnowledgeDocumentList'];
export type KnowledgeDocumentDetail = S['KnowledgeDocumentDetail'];
export type KnowledgeVersion = S['KnowledgeVersion'];
export type KnowledgeDraft = S['KnowledgeDraft'];
export type KnowledgeApplication = S['KnowledgeApplication'];
export type KnowledgeIndexState = S['KnowledgeIndexState'];
export type DraftCreate = S['KnowledgeDraftCreate'];

const header = { 'X-Source-System': SOURCE_SYSTEM };

/** 초안을 만들고 고칠 수 있는 역할(서버 설정 editor-roles 기본값 — 서버가 403 이면 그게 정본) */
export const canEditKnowledge = (roles: readonly string[]) => roles.includes('OPERATOR_ADMIN');

/** 문서 ID 모양(서버 형식 검사와 같게): docs/rag/rag-docs/<영역>/<영문·숫자·_- 이름>.md, customer_app 은 막힘 */
export const DOC_PREFIX = 'docs/rag/rag-docs/';
export const isDocumentId = (v: string) => /^docs\/rag\/rag-docs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.md$/.test(v) && !v.startsWith(`${DOC_PREFIX}customer_app/`);

/** 본문 화면 검사(서버도 400 — 서버 details 가 정본). 빈 배열이면 보낼 수 있다 */
export const MAX_BYTES = 128 * 1024;
export const FORBIDDEN_WORDS = ['가정', '설계안', '확정 정책'] as const;
export function contentProblems(content: string): { readonly kind: 'title' | 'size' | 'word'; readonly word?: string }[] {
  const out: { kind: 'title' | 'size' | 'word'; word?: string }[] = [];
  const first = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).split(/\r?\n/)[0] ?? '';
  if (!/^#\s+\S/.test(first)) out.push({ kind: 'title' });
  if (new TextEncoder().encode(content).length > MAX_BYTES) out.push({ kind: 'size' });
  for (const w of FORBIDDEN_WORDS) if (content.includes(w)) out.push({ kind: 'word', word: w });
  return out;
}

export const knowledgeKeys = {
  all: ['assistant-knowledge'] as const,
  list: (includeRetired: boolean) => ['assistant-knowledge', 'documents', includeRetired] as const,
  detail: (documentId: string, version: number | null) => ['assistant-knowledge', 'document', documentId, version ?? 'current'] as const,
  drafts: ['assistant-knowledge', 'drafts'] as const,
  draft: (draftId: string) => ['assistant-knowledge', 'draft', draftId] as const,
  applications: ['assistant-knowledge', 'applications'] as const,
};

export function useKnowledgeDocuments(includeRetired: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: knowledgeKeys.list(includeRetired),
    queryFn: () => request('GET', api.assistant.GET('/assistant/knowledge-documents', { params: { header, query: includeRetired ? { includeRetired: true } : {} } })),
  });
}

export function useKnowledgeDocument(documentId: string, version: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: knowledgeKeys.detail(documentId, version),
    enabled: documentId !== '',
    queryFn: () =>
      request('GET', api.assistant.GET('/assistant/knowledge-documents/detail', { params: { header, query: { documentId, ...(version ? { version } : {}) } } })),
  });
}

export function useMyDrafts() {
  const api = useApi();
  return useQuery({ queryKey: knowledgeKeys.drafts, queryFn: () => request('GET', api.assistant.GET('/assistant/knowledge-drafts', { params: { header } })) });
}

export function useKnowledgeDraft(draftId: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: knowledgeKeys.draft(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: () => request('GET', api.assistant.GET('/assistant/knowledge-drafts/{draftId}', { params: { header, path: { draftId: draftId ?? '' } } })),
  });
}

export function useKnowledgeApplications(size = 20) {
  const api = useApi();
  return useQuery({
    queryKey: knowledgeKeys.applications,
    queryFn: () => request('GET', api.assistant.GET('/assistant/knowledge-applications', { params: { header, query: { size } } })),
  });
}

export const createDraft = (api: Api, body: DraftCreate, key: IdempotencyKey) =>
  request('POST', api.assistant.POST('/assistant/knowledge-drafts', { ...commandParams(key), body }));

export const updateDraft = (api: Api, draftId: string, content: string, key: IdempotencyKey) =>
  request('PUT', api.assistant.PUT('/assistant/knowledge-drafts/{draftId}', { ...commandParams(key, { path: { draftId } }), body: { content } }));

export const discardDraft = (api: Api, draftId: string, key: IdempotencyKey) =>
  requestNoContent('DELETE', api.assistant.DELETE('/assistant/knowledge-drafts/{draftId}', { ...commandParams(key, { path: { draftId } }) }));

/** 초안 응답의 approvalRequest 는 approval POST /change-requests 본문 그대로(계약 additionalProperties) — 고치지 않고 보낸다 */
export const approvalBodyOf = (d: KnowledgeDraft) => d.approvalRequest as unknown as ChangeRequestBody;

/** 문서 ID → 영역·파일 이름(보이기용) */
export function docParts(documentId: string): { readonly domain: string; readonly file: string } {
  const rest = documentId.startsWith(DOC_PREFIX) ? documentId.slice(DOC_PREFIX.length) : documentId;
  const i = rest.indexOf('/');
  return i < 0 ? { domain: '', file: rest } : { domain: rest.slice(0, i), file: rest.slice(i + 1) };
}

export const docLink = (documentId: string, version?: number | null) =>
  `/assistant/documents/view?documentId=${encodeURIComponent(documentId)}${version ? `&version=${version}` : ''}`;
export const draftLink = (draftId: string) => `/assistant/documents/drafts/${encodeURIComponent(draftId)}`;
