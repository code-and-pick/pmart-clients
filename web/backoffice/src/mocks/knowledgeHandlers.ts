// ai-assistant 1.4.0 목 — 운영자 RAG 문서 관리(ADR-0092)·상담 도우미(ADR-0093). 백엔드 요청서 clients/backoffice/2026-11-28-request-*.
// 서버와 같게: 초안은 OPERATOR_ADMIN 만, 승인(RAG_DOCUMENT) 뒤 기준 판·본문 해시가 같을 때만 새 판, 아니면 REJECTED(STALE_VERSION·DRAFT_CHANGED).
// 색인은 반영 직후 PENDING → 다음 목록 조회에서 INDEXED(서버는 1분 주기). 해시는 목 해시(sha256 아님).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { ApprovalDetail } from '../api/models';
import { db, nextId, timestamp } from './db';
import { hash, idempotent, operator, problem, unauthorized } from './support';

type IndexState = 'INDEXED' | 'PENDING' | 'FAILED' | 'NOT_INDEXED';
interface Version {
  version: number;
  op: 'IMPORT' | 'UPSERT' | 'RETIRE';
  title: string;
  content: string;
  contentSha256: string;
  approvalId: string | null;
  draftId: string | null;
  createdBy: string;
  createdAt: string;
}
interface Doc {
  documentId: string;
  retired: boolean;
  indexState: IndexState;
  versions: Version[]; // 오래된 판 먼저
}
interface Draft {
  draftId: string;
  documentId: string;
  op: 'UPSERT' | 'RETIRE';
  baseVersion: number;
  content: string | null;
  authorId: string;
  state: 'OPEN' | 'APPLIED' | 'REJECTED' | 'DISCARDED';
  approvalId: string | null;
  resultReason: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Application {
  approvalId: string;
  draftId: string | null;
  documentId: string | null;
  result: 'APPLIED' | 'REJECTED';
  reason: string | null;
  version: number | null;
  approverId: string | null;
  at: string;
}

const P = 'docs/rag/rag-docs/';
const titleOf = (content: string) => /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? '';

const IDENTITY = `# 고객센터 상담 사례

## 제15조 (상담 본인 확인과 주문 확인)
1. 상담원은 취소·환불·주소 변경을 돕기 전에 아래 표의 순서로 본인을 확인한다.
2. 고객이 말한 전화번호·주소는 접수에 적지 않는다(확인 방법만 남긴다).

| 문의 종류 | 회원이 조회될 때 | 회원이 조회되지 않을 때 |
|---|---|---|
| 주문 | 주문 번호 + 받는 분 이름 대조 | 주문 번호 + 결제 수단 끝 4자리 대조 |
| 배송 | 주문 번호 + 받는 분 이름 대조 | 주문 번호 + 배송지 동 이름 대조 |
| 결제 | 앱 로그인 채팅 또는 결제 수단 끝 4자리 | 결제 승인 번호 대조 |
| 환불 | 주문 번호 + 환불 계좌 은행 이름 | 주문 번호 + 결제 수단 끝 4자리 대조 |
| 계정 | 앱 로그인 채팅만 | 계정 안내는 하지 않는다 |
| 상품·기타 | 확인 없이 안내 | 확인 없이 안내 |

10. 본인 확인 결과는 접수의 확인 방법(identityCheck)으로만 남긴다.
`;

const SEED: ReadonlyArray<readonly [string, string, IndexState]> = [
  [`${P}backoffice/05-customer-center-cases.md`, IDENTITY, 'INDEXED'],
  [
    `${P}order_claim/03-cancel.md`,
    `# 주문 취소

## 제3조 (고객 취소)
1. 고객은 피킹이 시작되기 전까지 앱에서 바로 취소할 수 있다.
2. 피킹이 시작된 뒤에는 상담원이 센터에 확인한 뒤 취소한다.

## 제4조 (상담원 취소 요청)
- 상담원은 본인 확인을 마친 뒤 클레임 메뉴에서 취소를 요청한다.
- 배송이 출발한 주문은 취소 대신 반품으로 안내한다.
`,
    'INDEXED',
  ],
  [
    `${P}delivery/02-delay.md`,
    `# 배송 지연

## 제2조 (지연 안내)
1. 예정 시각보다 15분 넘게 늦으면 고객에게 알림이 간다.
2. 상담원은 라이더 위치를 안내하지 않고 예정 시각만 안내한다.
`,
    'NOT_INDEXED',
  ],
  [
    `${P}customer_app/01-faq.md`,
    `# 고객 앱 자주 묻는 질문

## 배달팁은 얼마인가요
- 주문서에 보이는 금액이 정본이다.
`,
    'INDEXED',
  ],
];

const store = {
  docs: new Map<string, Doc>(),
  drafts: new Map<string, Draft>(),
  applications: [] as Application[],
  reindex: { requestedAt: null as string | null, finishedAt: null as string | null, lastResult: null as string | null, lastSnapshotId: null as string | null },
  source: 'db' as 'db' | 'files',
};

export function resetMockKnowledge(): void {
  store.docs.clear();
  store.drafts.clear();
  store.applications = [];
  const at = '2026-11-27T01:00:00Z';
  for (const [documentId, content, indexState] of SEED)
    store.docs.set(documentId, {
      documentId,
      retired: false,
      indexState,
      versions: [{ version: 1, op: 'IMPORT', title: titleOf(content), content, contentSha256: hash(content), approvalId: null, draftId: null, createdBy: 'IMPORT', createdAt: at }],
    });
  store.reindex = { requestedAt: at, finishedAt: '2026-11-27T01:01:00Z', lastResult: 'OK', lastSnapshotId: 'IDX-20261127-0101' };
  store.source = 'db';
}
resetMockKnowledge();

/** 시험용: 색인 원본을 files 로(가져오기 전) */
export const setKnowledgeSource = (s: 'db' | 'files') => {
  store.source = s;
};

const latest = (d: Doc) => d.versions[d.versions.length - 1]!;
const readOnly = (id: string) => id.startsWith(`${P}customer_app/`);

function summary(d: Doc) {
  const v = latest(d);
  const parts = d.documentId.slice(P.length).split('/');
  return {
    documentId: d.documentId,
    domain: parts[0] ?? '',
    title: v.title,
    version: v.version,
    contentSha256: v.contentSha256,
    retired: d.retired,
    readOnly: readOnly(d.documentId),
    indexState: d.indexState,
    updatedAt: v.createdAt,
    updatedBy: v.createdBy,
  };
}

function draftView(x: Draft) {
  const doc = store.docs.get(x.documentId);
  const cur = doc ? latest(doc) : null;
  const sha = x.content === null ? null : hash(x.content);
  return {
    draftId: x.draftId,
    documentId: x.documentId,
    op: x.op,
    baseVersion: x.baseVersion,
    title: x.content === null ? (cur?.title ?? null) : titleOf(x.content),
    content: x.content,
    contentSha256: sha,
    authorId: x.authorId,
    state: x.state,
    approvalId: x.approvalId,
    resultReason: x.resultReason,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    current: doc ? { version: cur!.version, title: cur!.title, content: cur!.content, retired: doc.retired } : null,
    approvalRequest: {
      type: 'RAG_DOCUMENT',
      targetService: 'ai-assistant-service',
      targetRef: x.draftId,
      targetExpectedVersion: x.baseVersion,
      allowedActions: ['APPLY_KNOWLEDGE_DOCUMENT'],
      summary: `운영자 RAG 문서 ${x.op === 'RETIRE' ? '내리기' : doc ? '고치기' : '새 문서'} — ${x.content === null ? (cur?.title ?? x.documentId) : titleOf(x.content)}`,
      lines: [{ lineKey: x.documentId, attributes: { op: x.op, draftId: x.draftId, ...(sha ? { contentSha256: sha } : {}) } }],
    },
  };
}

function formatProblems(content: string, documentId: string) {
  const details: { field: string; reason: string }[] = [];
  if (!/^#\s+\S/.test(content.split(/\r?\n/)[0] ?? '')) details.push({ field: 'content', reason: '첫 줄은 "# 제목" 이어야 합니다' });
  if (new TextEncoder().encode(content).length > 128 * 1024) details.push({ field: 'content', reason: '128KB 를 넘습니다' });
  for (const w of ['가정', '설계안', '확정 정책']) if (content.includes(w)) details.push({ field: 'content', reason: `금지 표현 "${w}"` });
  if (!/^docs\/rag\/rag-docs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.md$/.test(documentId)) details.push({ field: 'documentId', reason: '문서 ID 형식이 아닙니다' });
  return details;
}

const isEditor = (roles: readonly string[]) => roles.includes('OPERATOR_ADMIN');
const isConsultRole = (roles: readonly string[]) => roles.includes('CS_AGENT') || roles.includes('OPERATOR_ADMIN');

/** approval 결정 직후(effects.decide) — 승인이면 반영 시도, 결과를 반영 기록에 */
export function decideKnowledge(a: ApprovalDetail, approved: boolean): void {
  if (!approved) return; // 반려는 승인함의 일 — 초안은 열린 채
  const cr = db.changeRequests.get(a.changeRequestId ?? '');
  const line = a.lines?.[0];
  const draft = store.drafts.get(a.targetRef ?? '');
  const approverId = a.decisions?.at(-1)?.approverId ?? null;
  const base = { approvalId: a.approvalId ?? '', draftId: draft?.draftId ?? null, documentId: line?.lineKey ?? null, approverId, at: timestamp() };
  const reject = (reason: string) => {
    store.applications.unshift({ ...base, result: 'REJECTED', reason, version: null });
    if (draft && draft.state === 'OPEN') store.drafts.set(draft.draftId, { ...draft, state: 'REJECTED', resultReason: reason, approvalId: base.approvalId });
  };
  if (!draft) return reject('DRAFT_NOT_FOUND');
  if (draft.state !== 'OPEN') return reject('DRAFT_CLOSED');
  if (line?.lineKey !== draft.documentId || line.attributes?.['op'] !== draft.op) return reject('DRAFT_MISMATCH');
  if (readOnly(draft.documentId)) return reject('READ_ONLY_DOCUMENT');
  const doc = store.docs.get(draft.documentId);
  const curVersion = doc ? latest(doc).version : 0;
  if ((cr?.targetExpectedVersion ?? -1) !== curVersion) return reject('STALE_VERSION');
  if (draft.op === 'UPSERT' && line.attributes?.['contentSha256'] !== hash(draft.content ?? '')) return reject('DRAFT_CHANGED');
  const version = curVersion + 1;
  const content = draft.op === 'RETIRE' ? (doc ? latest(doc).content : '') : (draft.content ?? '');
  const v: Version = { version, op: draft.op, title: titleOf(content), content, contentSha256: hash(content), approvalId: base.approvalId, draftId: draft.draftId, createdBy: draft.authorId, createdAt: base.at };
  store.docs.set(draft.documentId, { documentId: draft.documentId, retired: draft.op === 'RETIRE', indexState: 'PENDING', versions: [...(doc?.versions ?? []), v] });
  store.drafts.set(draft.draftId, { ...draft, state: 'APPLIED', approvalId: base.approvalId, updatedAt: base.at });
  store.applications.unshift({ ...base, result: 'APPLIED', reason: null, version });
  store.reindex = { ...store.reindex, requestedAt: base.at };
}

/** 상담 도우미 정책 근거 — 문의 종류별 검색어로 찾은 조각(목: 정해진 조각) */
const POLICY_FOR: Readonly<Record<string, readonly string[]>> = {
  ORDER: [`${P}order_claim/03-cancel.md`],
  DELIVERY: [`${P}delivery/02-delay.md`],
  REFUND: [`${P}order_claim/03-cancel.md`],
  PAYMENT: [],
  PRODUCT: [],
  ACCOUNT: [],
  OTHER: [],
};

function citation(documentId: string, sectionTitle: string, excerpt: string, n: number) {
  const doc = store.docs.get(documentId);
  const v = doc ? latest(doc) : null;
  return {
    chunkId: `${documentId}#${n}`,
    documentId,
    path: documentId,
    section: `${v?.title ?? ''} > ${sectionTitle}`,
    authority: 'CONFIRMED',
    lifecycleStatus: 'ACTIVE',
    supersededBy: null,
    proposedSupersededBy: [],
    implementationEvidence: null,
    documentVersion: v ? String(v.version) : null,
    effectiveDate: null,
    asOf: { snapshotId: store.reindex.lastSnapshotId ?? 'IDX-mock', sourceRevision: null, sourceDirty: false, indexedAt: store.reindex.finishedAt ?? timestamp() },
    excerpt,
  };
}

/** "## 제목" 절 나누기 */
function sections(content: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  for (const part of content.split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    out.push({ title: (head ?? '').trim(), body: rest.join('\n').trim() });
  }
  return out;
}

export const knowledgeHandlers = [
  http.get(`${API_BASE}/assistant/knowledge-documents`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const includeRetired = new URL(request.url).searchParams.get('includeRetired') === 'true';
    const items = [...store.docs.values()]
      .filter((d) => includeRetired || !d.retired)
      .sort((a, b) => a.documentId.localeCompare(b.documentId))
      .map(summary);
    // 다음 조회 때 반영 대기 → 반영됨(서버 1분 주기 재색인 흉내)
    let indexed = false;
    for (const d of store.docs.values())
      if (d.indexState === 'PENDING') {
        d.indexState = 'INDEXED';
        indexed = true;
      }
    if (indexed) store.reindex = { ...store.reindex, finishedAt: timestamp(), lastResult: 'OK', lastSnapshotId: `IDX-${Date.now()}` };
    return HttpResponse.json({ items, source: store.source, reindex: store.reindex });
  }),

  http.get(`${API_BASE}/assistant/knowledge-documents/detail`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const doc = store.docs.get(q.get('documentId') ?? '');
    if (!doc) return problem(404, 'NOT_FOUND');
    const want = q.get('version') ? Number(q.get('version')) : latest(doc).version;
    const shown = doc.versions.find((v) => v.version === want);
    if (!shown) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      document: summary(doc),
      content: shown.content,
      shownVersion: shown.version,
      versions: [...doc.versions].reverse().map((v) => ({ version: v.version, op: v.op, title: v.title, contentSha256: v.contentSha256, approvalId: v.approvalId, draftId: v.draftId, createdBy: v.createdBy, createdAt: v.createdAt })),
    });
  }),

  http.get(`${API_BASE}/assistant/knowledge-applications`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const size = Number(new URL(request.url).searchParams.get('size') ?? 20);
    return HttpResponse.json({ items: store.applications.slice(0, size) });
  }),

  http.get(`${API_BASE}/assistant/knowledge-drafts`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const items = [...store.drafts.values()]
      .filter((x) => x.authorId === who.subject && x.state === 'OPEN')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(draftView);
    return HttpResponse.json({ items });
  }),

  http.post(`${API_BASE}/assistant/knowledge-drafts`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!isEditor(who.roles)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { documentId: string; op: 'UPSERT' | 'RETIRE'; baseVersion?: number | null; content?: string | null };
    return idempotent(request, () => {
      if (readOnly(body.documentId)) return problem(400, 'VALIDATION_FAILED', [{ field: 'documentId', reason: 'customer_app 문서는 저장소에서 고칩니다' }]);
      const doc = store.docs.get(body.documentId);
      const cur = doc ? latest(doc).version : 0;
      if (body.baseVersion !== undefined && body.baseVersion !== null && body.baseVersion !== cur) return problem(409, 'STALE_VERSION');
      if (body.op === 'RETIRE' && (!doc || doc.retired)) return problem(409, 'INVALID_STATE');
      if (body.op === 'UPSERT') {
        const details = formatProblems(body.content ?? '', body.documentId);
        if (details.length) return problem(400, 'VALIDATION_FAILED', details);
      }
      const at = timestamp();
      const draft: Draft = { draftId: nextId('KDR'), documentId: body.documentId, op: body.op, baseVersion: cur, content: body.op === 'RETIRE' ? null : (body.content ?? ''), authorId: who.subject, state: 'OPEN', approvalId: null, resultReason: null, createdAt: at, updatedAt: at };
      store.drafts.set(draft.draftId, draft);
      return { status: 201, body: draftView(draft) };
    });
  }),

  http.get(`${API_BASE}/assistant/knowledge-drafts/:draftId`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const d = store.drafts.get(String(params['draftId']));
    return d ? HttpResponse.json(draftView(d)) : problem(404, 'NOT_FOUND');
  }),

  http.put(`${API_BASE}/assistant/knowledge-drafts/:draftId`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!isEditor(who.roles)) return problem(403, 'FORBIDDEN');
    const { content } = (await request.json()) as { content: string };
    return idempotent(request, () => {
      const d = store.drafts.get(String(params['draftId']));
      if (!d || d.authorId !== who.subject) return problem(404, 'NOT_FOUND');
      if (d.state !== 'OPEN') return problem(409, 'INVALID_STATE');
      if (d.op === 'RETIRE') return problem(400, 'VALIDATION_FAILED', [{ field: 'content', reason: '내리기 초안에는 본문이 없습니다' }]);
      const details = formatProblems(content, d.documentId);
      if (details.length) return problem(400, 'VALIDATION_FAILED', details);
      const next = { ...d, content, updatedAt: timestamp() };
      store.drafts.set(d.draftId, next);
      return { status: 200, body: draftView(next) };
    });
  }),

  http.delete(`${API_BASE}/assistant/knowledge-drafts/:draftId`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const d = store.drafts.get(String(params['draftId']));
    if (d && d.authorId === who.subject && d.state === 'OPEN') store.drafts.set(d.draftId, { ...d, state: 'DISCARDED', updatedAt: timestamp() });
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- 상담 도우미 ----
  http.get(`${API_BASE}/assistant/consult-guides`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!isConsultRole(who.roles)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const category = q.get('category') ?? '';
    if (!(category in POLICY_FOR)) return problem(400, 'VALIDATION_FAILED', [{ field: 'category' }]);
    const memberFound = q.get('memberFound') === null ? null : q.get('memberFound') === 'true';
    const orderStatus = q.get('orderStatus');
    const idDoc = store.docs.get(`${P}backoffice/05-customer-center-cases.md`);
    const idSection = idDoc && !idDoc.retired ? sections(latest(idDoc).content).find((s) => s.title.startsWith('제15조')) : undefined;
    const policies = (POLICY_FOR[category] ?? []).flatMap((id) => {
      const doc = store.docs.get(id);
      if (!doc || doc.retired) return [];
      return sections(latest(doc).content)
        // 배송이 출발한 주문이면 반품 안내 절을 앞에(목: 주문 상태로 순서만)
        .sort((a, b) => (orderStatus === 'IN_DELIVERY' ? Number(b.body.includes('출발')) - Number(a.body.includes('출발')) : 0))
        .map((s, n) => citation(id, s.title, s.body, n + 1));
    });
    return HttpResponse.json({
      category,
      memberFound,
      orderStatus,
      ...(idSection ? { identity: citation(idDoc!.documentId, idSection.title, idSection.body, 15) } : {}),
      policies: policies.slice(0, 6),
      indexSnapshotId: store.reindex.lastSnapshotId ?? 'IDX-mock',
    });
  }),
];
