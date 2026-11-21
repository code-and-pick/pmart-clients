// 답변 표시. 서버 답변·근거 청크·절 제목은 신뢰할 수 없는 텍스트 — React 텍스트 노드로만 그린다(HTML·마크다운 해석, 링크 생성 없음).
// 인용의 지위(authority)·생애(lifecycleStatus)·구현 기록은 서로 다른 축이라 각각 보인다(계약 1.1.0).
import { Link } from 'react-router';

import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { type AnswerState, type AssistantAnswer, type Authority, type Citation, isBaseline, isDisplayablePath } from './model';

const AUTHORITY_TONE: Record<Authority, string> = {
  CONFIRMED: 'badge-success',
  ADOPTED_DESIGN: 'badge-info',
  PROPOSAL: 'badge-warning',
  ASSUMPTION: 'badge-warning',
  UNDECIDED: 'badge-error',
  EXTERNAL_REFERENCE: 'badge-ghost',
};

/** 근거 문서 카드(2026-11-18 "직관적이지 않다"): 제목 = 절 제목(없으면 경로), 경로는 작게. 문서 버전·색인 시점은 접어 둔다 */
function CitationItem({ c }: { readonly c: Citation }) {
  const shown = isDisplayablePath(c.path);
  const path = shown ? <code className="text-xs break-all text-base-content/55">{c.path}</code> : <span className="text-xs text-warning">{m.assistant.hiddenPath}</span>;
  return (
    <li className="rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-sm" data-testid="citation">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${AUTHORITY_TONE[c.authority]}`} data-authority={c.authority} title={c.authority}>
          {m.assistant.authority[c.authority]}
        </span>
        {c.lifecycleStatus !== 'ACTIVE' && (
          <span className="badge badge-sm badge-outline" data-lifecycle={c.lifecycleStatus} title={c.lifecycleStatus}>
            {m.assistant.lifecycle[c.lifecycleStatus]}
          </span>
        )}
        {c.section ? <span className="font-medium">{c.section}</span> : path}
      </div>
      {c.section && <div className="mt-0.5">{path}</div>}
      <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 text-xs opacity-80">
        <dt>{m.assistant.effectiveDate}</dt>
        <dd>{c.effectiveDate ?? m.none}</dd>
        {c.supersededBy && (
          <>
            <dt>{m.assistant.supersededBy}</dt>
            <dd className="break-all">{c.supersededBy}</dd>
          </>
        )}
        {c.proposedSupersededBy.length > 0 && (
          <>
            <dt>{m.assistant.proposedSupersededBy}</dt>
            <dd className="break-all">{c.proposedSupersededBy.join(', ')}</dd>
          </>
        )}
        {c.implementationEvidence && (
          <>
            <dt>{m.assistant.implementationEvidence}</dt>
            <dd>
              {m.assistant.implementationEvidenceAt(c.implementationEvidence.recordDate)}
              {c.implementationEvidence.note ? ` · ${c.implementationEvidence.note}` : ''}
            </dd>
          </>
        )}
        {c.asOf.sourceDirty && (
          <>
            <dt>{m.assistant.asOf}</dt>
            <dd className="text-warning">{m.assistant.sourceDirty}</dd>
          </>
        )}
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs">{m.assistant.excerpt}</summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs" data-testid="excerpt">
          {c.excerpt}
        </p>
      </details>
      {/* 문서 버전·색인 시점(스냅숏·리비전)은 확인할 때만 펼친다 */}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-base-content/55">{m.assistant.docInfo}</summary>
        <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 text-xs opacity-80">
          <dt>{m.assistant.docVersion}</dt>
          <dd>{c.documentVersion ?? m.none}</dd>
          <dt>{m.assistant.asOf}</dt>
          <dd className="break-all">{`${formatSeoul(c.asOf.indexedAt)} · ${c.asOf.snapshotId}${c.asOf.sourceRevision ? ` · ${c.asOf.sourceRevision}` : ''}`}</dd>
        </dl>
      </details>
    </li>
  );
}

/** 답이 아닌 정상 결과(근거 없음·실시간 조회 필요·실행 요청·권한 범위 밖). 서버 안내 문장이 있으면 함께 보인다. */
const NOTICE_STATES: Partial<Record<AnswerState, { readonly key: string; readonly tone: string }>> = {
  NO_GROUNDING: { key: 'no-grounding', tone: 'alert-warning' },
  REALTIME_DATA_REQUIRED: { key: 'realtime-required', tone: 'alert-info' },
  OUT_OF_SCOPE: { key: 'out-of-scope', tone: 'alert-info' },
  FORBIDDEN_SCOPE: { key: 'forbidden-scope', tone: '' },
};

export function AnswerView({
  answer,
  question,
  linkToDetail = false,
  onRecheck,
}: {
  readonly answer: AssistantAnswer;
  /** 이 화면에서 보낸 질문(서버는 질문 원문을 돌려주지 않는다). */
  readonly question?: string;
  readonly linkToDetail?: boolean;
  /** 처리 중(PROCESSING)일 때 다시 확인. */
  readonly onRecheck?: () => void;
}) {
  const idLine = linkToDetail ? (
    <Link className="link text-xs" to={`/assistant/answers/${encodeURIComponent(answer.answerId)}`}>
      {m.assistant.answerId(answer.answerId)}
    </Link>
  ) : (
    <span className="text-xs opacity-70 select-all">{m.assistant.answerId(answer.answerId)}</span>
  );

  if (answer.state === 'PROCESSING') {
    return (
      <div role="status" data-state="processing" className="alert flex flex-col items-start gap-1">
        <span className="font-bold">{m.assistant.processingTitle}</span>
        <span>{m.assistant.processingBody}</span>
        {idLine}
        {onRecheck && (
          <button type="button" className="btn btn-sm" onClick={onRecheck}>
            {m.assistant.recheck}
          </button>
        )}
      </div>
    );
  }

  const notice = NOTICE_STATES[answer.state];
  if (notice) {
    const copy = m.assistant.notice[answer.state as keyof typeof m.assistant.notice];
    return (
      <div role="status" data-state={notice.key} className={`alert flex flex-col items-start gap-1 ${notice.tone}`}>
        <span className="font-bold">{copy.title}</span>
        <span className="whitespace-pre-wrap">{answer.answer.trim() ? answer.answer : copy.body}</span>
        {idLine}
      </div>
    );
  }

  return (
    // 대화 말풍선(2026-11-18): 오른쪽 = 이 화면에서 보낸 질문, 왼쪽 = 도우미 머리글자 + 답변 상자, 그 아래 근거 문서 카드
    <article data-state="answered" className="space-y-4">
      {question && (
        <div className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-wrap rounded-box rounded-br-none bg-primary px-4 py-2.5 text-sm text-primary-content shadow-sm">{`Q. ${question}`}</p>
        </div>
      )}
      <div className="flex items-start gap-3">
        <BotAvatar />
        <div className="min-w-0 flex-1 space-y-3 rounded-box rounded-tl-none border border-base-300 bg-base-100 p-4 shadow-sm">
          {isBaseline(answer) && (
            <p role="note" data-testid="baseline" className="alert alert-warning alert-soft text-xs">
              {m.assistant.baseline}
            </p>
          )}
          {answer.state === 'PRODUCT_INFO' && (
            <p role="note" data-testid="product-info" className="alert alert-info alert-soft text-xs">
              {m.assistant.productInfo}
            </p>
          )}
          {answer.answerMode === 'GENERATIVE' && (
            <p role="note" data-testid="generative" className="alert alert-info alert-soft text-xs">
              {m.assistant.generative}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words leading-relaxed" data-testid="answer-text">
            {answer.answer}
          </p>
          <div className="flex flex-wrap gap-3 border-t border-base-300 pt-2 text-xs text-base-content/60">
            {idLine}
            {/* 색인 번호는 마우스를 올리면(2026-11-18 개발 용어 줄이기) */}
            <span title={answer.indexSnapshotId ? m.assistant.indexSnapshot(answer.indexSnapshotId) : undefined}>{formatSeoul(answer.askedAt)}</span>
          </div>
        </div>
      </div>
      {answer.state === 'PRODUCT_INFO' && answer.citations.length === 0 ? null : (
      <div className="space-y-2 pl-11">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {m.assistant.citations}
          <span className="badge badge-ghost badge-sm">{answer.citations.length}</span>
        </h2>
        {answer.citations.length === 0 ? (
          <p role="alert" className="alert alert-warning alert-soft text-sm">
            {m.assistant.ungroundedAnswer}
          </p>
        ) : (
          <ul className="grid gap-2">
            {answer.citations.map((c) => (
              <CitationItem key={c.chunkId} c={c} />
            ))}
          </ul>
        )}
      </div>
      )}
    </article>
  );
}

/** 도우미 동그라미(대화 말풍선 왼쪽) */
export function BotAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3m-6 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm3 4h.01M15 14h.01" />
      </svg>
    </span>
  );
}
