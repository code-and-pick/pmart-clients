// 운영자 RAG 문서 관리(ai-assistant 1.4.0 knowledge + approval 0.7.0 RAG_DOCUMENT, ADR-0092 — 요청서 2026-11-28-request-rag-document-admin)
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE } from '../../api/client';
import { setKnowledgeSource } from '../../mocks/knowledgeHandlers';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const CANCEL = 'docs/rag/rag-docs/order_claim/03-cancel.md';
const view = (id: string, v?: number) => `/assistant/documents/view?documentId=${encodeURIComponent(id)}${v ? `&version=${v}` : ''}`;

afterEach(() => {
  vi.restoreAllMocks();
  setKnowledgeSource('db');
});

describe('업무 도우미 문서 관리', () => {
  it('목록: 영역별로 묶고 판·색인 상태, 고객 앱 문서는 "저장소에서 고침", 상담원에게는 새 문서 버튼이 없다', async () => {
    renderAt('/assistant/documents', as.cs);
    const order = await screen.findByTestId('knowledge-domain-order_claim');
    expect(within(order).getByText('주문 취소')).toBeInTheDocument();
    expect(within(order).getByText('1판')).toBeInTheDocument();
    expect(within(order).getByText('반영됨')).toBeInTheDocument();
    expect(within(screen.getByTestId('knowledge-domain-delivery')).getByText('아직 색인 안 함')).toBeInTheDocument();
    expect(within(screen.getByTestId('knowledge-domain-customer_app')).getByTestId('knowledge-readonly')).toHaveTextContent('저장소에서 고침');
    expect(screen.getByTestId('knowledge-reindex')).toHaveTextContent('마지막 재색인');
    expect(screen.queryByTestId('knowledge-new')).not.toBeInTheDocument();
  });

  it('source=files 면 "문서 관리가 아직 켜지지 않았어요"', async () => {
    setKnowledgeSource('files');
    renderAt('/assistant/documents', as.admin);
    expect(await screen.findByTestId('knowledge-files')).toHaveTextContent('문서 관리가 아직 켜지지 않았어요');
  });

  it('목록 조회 실패는 빈 목록으로 보이지 않는다', async () => {
    server.use(http.get(`${API_BASE}/assistant/knowledge-documents`, () => HttpResponse.json({ code: 'INTERNAL', status: 500 }, { status: 500 })));
    renderAt('/assistant/documents', as.admin);
    expect(await screen.findByText('정보를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('문서가 없어요.')).not.toBeInTheDocument();
  });

  it('고치기 → 초안 저장(기준 판·본문) → 승인 요청(approvalRequest 그대로) → 다른 관리자 승인 → 2판·반영 결과', async () => {
    const user = userEvent.setup();
    const first = renderAt(view(CANCEL), as.admin);
    expect(await screen.findByTestId('knowledge-content')).toHaveTextContent('제3조 (고객 취소)');
    await user.click(screen.getByTestId('knowledge-edit'));

    const editor = await screen.findByLabelText('마크다운 원문');
    expect(screen.getByTestId('knowledge-save')).toBeDisabled(); // 안 바꾸면 저장 못 함
    await user.type(editor, '\n## 제5조 (예약 주문 취소)\n1. 예약 주문은 배달 1시간 전까지 취소한다.');
    expect(screen.getByTestId('knowledge-preview')).toHaveTextContent('제5조 (예약 주문 취소)');
    await user.click(screen.getByTestId('knowledge-save'));

    const req = await screen.findByTestId('knowledge-request');
    const created = first.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/assistant/knowledge-drafts'))!;
    expect(created.headers.get('Idempotency-Key')).toBeTruthy();
    expect(created.headers.get('X-Source-System')).toBe('backoffice-web');
    const body = (await created.clone().json()) as { documentId: string; op: string; baseVersion: number; content: string };
    expect(body).toMatchObject({ documentId: CANCEL, op: 'UPSERT', baseVersion: 1 });
    expect(body.content).toContain('제5조 (예약 주문 취소)');
    expect(screen.getByTestId('knowledge-draft-state')).toHaveTextContent('작성 중');

    await user.click(req);
    expect(await screen.findByTestId('knowledge-requested')).toHaveTextContent('승인 요청을 올렸어요');
    const cr = first.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/change-requests'))!;
    const crBody = (await cr.clone().json()) as { type: string; targetService: string; targetRef: string; targetExpectedVersion: number; lines: { lineKey: string; attributes: Record<string, unknown> }[] };
    expect(crBody).toMatchObject({ type: 'RAG_DOCUMENT', targetService: 'ai-assistant-service', targetExpectedVersion: 1, allowedActions: ['APPLY_KNOWLEDGE_DOCUMENT'] });
    expect(crBody.targetRef).toMatch(/^KDR-/);
    expect(crBody.lines[0]).toMatchObject({ lineKey: CANCEL, attributes: { op: 'UPSERT', draftId: crBody.targetRef } });

    // 요청한 관리자는 자기 요청을 승인하지 못한다 — 다른 관리자가 승인함에서
    await user.click(within(screen.getByTestId('knowledge-requested')).getByRole('link', { name: '승인 보기' }));
    const review = await screen.findByTestId('knowledge-review');
    expect(within(review).getByTestId('diff-added')).toHaveTextContent('+2줄');
    expect(within(review).getByTestId('knowledge-diff')).toHaveTextContent('제5조 (예약 주문 취소)');
    const approvalLink = first.sent.find((r) => /\/approvals\/apv-/.test(new URL(r.url).pathname))!;
    const approvalId = new URL(approvalLink.url).pathname.split('/').pop()!;
    first.stop();
    cleanup();

    renderAt(`/approvals/${approvalId}`, as.admin2);
    expect(await screen.findByTestId('knowledge-review')).toHaveTextContent('기준 1판 · 지금 1판');
    await user.click(screen.getByRole('button', { name: '승인' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '승인' })).toBeDisabled());
    cleanup();

    renderAt('/assistant/documents', as.admin);
    const app = await screen.findByTestId('knowledge-application');
    expect(app).toHaveTextContent('반영');
    expect(app).toHaveTextContent('2판으로');
    expect(within(screen.getByTestId('knowledge-domain-order_claim')).getByText('2판')).toBeInTheDocument();
    cleanup();

    // 판 이력: 2판(고침)·1판(가져옴), 옛 판을 보면 되돌리기
    renderAt(view(CANCEL, 1), as.admin);
    expect(await screen.findByTestId('knowledge-old-version')).toHaveTextContent('옛 판(1판)을 보고 있어요 — 지금은 2판');
    expect(screen.getAllByTestId('knowledge-version')).toHaveLength(2);
    await user.click(screen.getByTestId('knowledge-revert'));
    expect(await screen.findByRole('heading', { name: '1판으로 되돌리기(새 초안)' })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>('마크다운 원문').value).not.toContain('제5조');
    expect(screen.getByTestId('knowledge-save')).toBeEnabled();
  });

  it('승인 요청 뒤 고쳐 저장하면 "다시 요청" 안내 — 승인돼도 반영되지 않는다(DRAFT_CHANGED)', async () => {
    const user = userEvent.setup();
    renderAt(view(CANCEL), as.admin);
    await user.click(await screen.findByTestId('knowledge-edit'));
    await user.type(await screen.findByLabelText('마크다운 원문'), '\n추가 한 줄');
    await user.click(screen.getByTestId('knowledge-save'));
    await user.click(await screen.findByTestId('knowledge-request'));
    await screen.findByTestId('knowledge-requested');

    await user.type(screen.getByLabelText('마크다운 원문'), '\n또 한 줄');
    await user.click(screen.getByTestId('knowledge-save'));
    expect(await screen.findByTestId('knowledge-changed-after')).toHaveTextContent('다시 요청해 주세요');
    expect(screen.getByTestId('knowledge-request')).toBeEnabled();
  });

  it('형식 오류: 첫 줄이 "# 제목"이 아니거나 금지 표현이면 저장을 막고, 서버 400 details 는 그대로', async () => {
    const user = userEvent.setup();
    renderAt(view(CANCEL), as.admin);
    await user.click(await screen.findByTestId('knowledge-edit'));
    const editor = await screen.findByLabelText('마크다운 원문');
    await user.type(editor, '\n이 절은 설계안이다');
    expect(screen.getByTestId('knowledge-problems')).toHaveTextContent('쓸 수 없는 표현 "설계안"');
    expect(screen.getByTestId('knowledge-save')).toBeDisabled();

    await user.clear(editor);
    await user.type(editor, '제목 없음');
    expect(screen.getByTestId('knowledge-problems')).toHaveTextContent('첫 줄은 "# 제목"');

    server.use(
      http.post(`${API_BASE}/assistant/knowledge-drafts`, () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', status: 400, details: [{ field: 'content', reason: '절 제목 형식이 아닙니다' }] }, { status: 400, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    await user.clear(editor);
    await user.type(editor, '# 주문 취소\n본문');
    await user.click(screen.getByTestId('knowledge-save'));
    expect(await screen.findByTestId('knowledge-problem-details')).toHaveTextContent('본문: 절 제목 형식이 아닙니다');
  });

  it('409 STALE_VERSION 이면 "문서가 바뀌었어요. 다시 열어 주세요."', async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API_BASE}/assistant/knowledge-drafts`, () => HttpResponse.json({ code: 'STALE_VERSION', status: 409 }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    renderAt(view(CANCEL), as.admin);
    await user.click(await screen.findByTestId('knowledge-edit'));
    await user.type(await screen.findByLabelText('마크다운 원문'), '\n추가');
    await user.click(screen.getByTestId('knowledge-save'));
    expect(await screen.findByTestId('knowledge-stale')).toHaveTextContent('문서가 바뀌었어요. 다시 열어 주세요.');
  });

  it('내리기: 확인하면 RETIRE 초안(본문 없음)', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const v = renderAt(view(CANCEL), as.admin);
    await user.click(await screen.findByTestId('knowledge-retire'));
    expect(await screen.findByTestId('knowledge-draft-status')).toHaveTextContent('내리기');
    const created = v.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/assistant/knowledge-drafts'))!;
    expect(await created.clone().json()).toEqual({ documentId: CANCEL, op: 'RETIRE', baseVersion: 1 });
  });

  it('새 문서: 영역·이름 → 기준 판 0 으로 초안, 상담원은 고치기·내리기 버튼이 없다', async () => {
    const user = userEvent.setup();
    const v = renderAt('/assistant/documents', as.admin);
    await user.click(await screen.findByTestId('knowledge-new'));
    await user.selectOptions(screen.getByLabelText('영역'), 'delivery');
    await user.type(screen.getByLabelText('파일 이름(영문·숫자·_-)'), '09-night');
    await user.click(screen.getByRole('button', { name: '본문 쓰기' }));
    const editor = await screen.findByLabelText('마크다운 원문');
    await user.clear(editor);
    await user.type(editor, '# 야간 배송\n\n## 제1조 (시간)\n1. 밤 10시까지 받는다.');
    await user.click(screen.getByTestId('knowledge-save'));
    await screen.findByTestId('knowledge-request');
    const created = v.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/assistant/knowledge-drafts'))!;
    expect(await created.clone().json()).toMatchObject({ documentId: 'docs/rag/rag-docs/delivery/09-night.md', op: 'UPSERT', baseVersion: 0 });
    cleanup();

    renderAt(view(CANCEL), as.cs);
    await screen.findByTestId('knowledge-content');
    expect(screen.queryByTestId('knowledge-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-retire')).not.toBeInTheDocument();
  });
});
