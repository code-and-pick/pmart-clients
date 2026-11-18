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

function CitationItem({ c }: { readonly c: Citation }) {
  const shown = isDisplayablePath(c.path);
  return (
    <li className="rounded-box bg-base-200 p-3 text-sm" data-testid="citation">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${AUTHORITY_TONE[c.authority]}`} data-authority={c.authority}>
          {m.assistant.authority[c.authority]}
        </span>
        {c.lifecycleStatus !== 'ACTIVE' && (
          <span className="badge badge-sm badge-outline" data-lifecycle={c.lifecycleStatus}>
            {m.assistant.lifecycle[c.lifecycleStatus]}
          </span>
        )}
        {shown ? (
          <code className="text-xs break-all">{c.path}</code>
        ) : (
          <span className="text-xs text-warning">{m.assistant.hiddenPath}</span>
        )}
      </div>
      <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 text-xs opacity-80">
        <dt>{m.assistant.section}</dt>
        <dd>{c.section ?? m.none}</dd>
        <dt>{m.assistant.docVersion}</dt>
        <dd>{c.documentVersion ?? m.none}</dd>
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
        <dt>{m.assistant.asOf}</dt>
        <dd>
          {`${formatSeoul(c.asOf.indexedAt)} · ${c.asOf.snapshotId}${c.asOf.sourceRevision ? ` · ${c.asOf.sourceRevision}` : ''}`}
          {c.asOf.sourceDirty && <span className="ml-1 text-warning">{m.assistant.sourceDirty}</span>}
        </dd>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs">{m.assistant.excerpt}</summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs" data-testid="excerpt">
          {c.excerpt}
        </p>
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
      <div role="status" data-state="processing" className="alert flex-col items-start">
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
      <div role="status" data-state={notice.key} className={`alert flex-col items-start ${notice.tone}`}>
        <span className="font-bold">{copy.title}</span>
        <span className="whitespace-pre-wrap">{answer.answer.trim() ? answer.answer : copy.body}</span>
        {idLine}
      </div>
    );
  }

  return (
    <article data-state="answered" className="space-y-3 rounded-box border border-base-300 bg-base-100 shadow-sm p-4">
      {question && <p className="text-sm opacity-70 whitespace-pre-wrap">{`Q. ${question}`}</p>}
      {isBaseline(answer) && (
        <p role="note" data-testid="baseline" className="alert alert-warning alert-soft text-xs">
          {m.assistant.baseline}
        </p>
      )}
      {answer.answerMode === 'GENERATIVE' && (
        <p role="note" data-testid="generative" className="alert alert-info alert-soft text-xs">
          {m.assistant.generative}
        </p>
      )}
      <p className="whitespace-pre-wrap break-words" data-testid="answer-text">
        {answer.answer}
      </p>
      <div className="flex flex-wrap gap-3 text-xs text-base-content/60">
        {idLine}
        <span>{formatSeoul(answer.askedAt)}</span>
        {answer.indexSnapshotId && <span>{m.assistant.indexSnapshot(answer.indexSnapshotId)}</span>}
      </div>
      <h2 className="font-bold">{m.assistant.citations}</h2>
      {answer.citations.length === 0 ? (
        <p role="alert" className="alert alert-warning alert-soft text-sm">
          {m.assistant.ungroundedAnswer}
        </p>
      ) : (
        <ul className="space-y-2">
          {answer.citations.map((c) => (
            <CitationItem key={c.chunkId} c={c} />
          ))}
        </ul>
      )}
    </article>
  );
}
