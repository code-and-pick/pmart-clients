// 콘텐츠 일괄 등록(seed-v1 zip) → 상품별 결과 → 제출 가능한 초안 제출 준비 → DISPLAY 승인.
// 화면(2026-11-18 사용자 "밋밋하다"): 올리기는 단계 표시 + 점선 파일 상자, 배치는 머리(상태 배지)·단계·요약 카드 → 한 카드 안 행 표(상품명 굵게·초안 ID 작게, 결과·제출 여부 색 배지) + 아래 제출 줄.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { BATCH_TONE, BatchApprovals, multipart, UploadLayout, ZipUpload } from '../products/ProductImportPage';
import { ContentRegistration } from './ContentRegistration';
import { type ImportItem, rowStatus, type RowStatus, rowSummary } from './importRowStatus';
import { NextAction, PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { JumpLink, MiniStat, Steps, tableClass, TitleWithId } from '../products/parts';

export function NewContentImportPage() {
  const api = useApi();
  const navigate = useNavigate();
  const upload = useCommand((file: File, key) =>
    request(
      'POST',
      api.content.POST('/content-import-batches', { ...commandParams(key), body: { file: '' }, ...multipart({ file }) }),
    ).then((b) => {
      void navigate(`/contents/import/${encodeURIComponent(b.batchId)}`);
      return b;
    }),
  );
  return (
    <section className="space-y-4">
      <PageHeader title={m.contents.importTitle} />
      <UploadLayout steps={m.contents.importSteps}>
        <ZipUpload busy={upload.busy} onUpload={(file) => void upload.run(file)} />
        <CommandFeedback command={upload} />
      </UploadLayout>
    </section>
  );
}

export function ContentImportPage() {
  const { batchId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['content', 'import-batch', batchId],
    queryFn: () => request('GET', api.content.GET('/content-import-batches/{batchId}', { params: { path: { batchId } } })),
  });
  const queryClient = useQueryClient();
  const submit = useCommand(async (_: null, key) => {
    const r = await request(
      'POST',
      api.content.POST('/content-import-batches/{batchId}/submissions', { ...commandParams(key, { path: { batchId } }) }),
    );
    // 배치를 다시 읽으면(SUBMITTED) 서버의 pendingSubmission 으로 승인 요청 현황 영역이 그려진다(BR-41).
    await queryClient.invalidateQueries({ queryKey: ['content', 'import-batch', batchId] });
    return r;
  });

  return (
    <section className="space-y-4">
      <PageHeader
        back={{ to: '/contents/import', label: m.contents.importTitle }}
        title={query.data ? <TitleWithId title={m.contents.batchHeading(query.data.productCount)} id={m.products.batch} /> : m.products.batch}
        actions={query.data ? <StatusBadge tone={BATCH_TONE[query.data.state] ?? 'ghost'}>{m.contents.batchStateName[query.data.state] ?? query.data.state}</StatusBadge> : null}
      />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => (
          <>
            <Steps steps={m.contents.importSteps} now={b.state === 'UPLOADED' ? 1 : 3} />
            <ContentBatchNextAction state={b.state} ready={(b.items ?? []).filter((it) => rowStatus(it).kind === 'ready').length} />
            <div className="pm-stat-strip flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
              <MiniStat label={m.contents.statProducts} value={b.productCount} />
              <div className="flex flex-[3_1_20rem] items-center bg-base-100 px-5 py-4">
                <p role="status" data-testid="row-summary" className="text-sm">
                  {rowSummary(b.items ?? [])}
                </p>
              </div>
            </div>
            <div id="batch-rows" className="scroll-mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>{m.contents.rowHead.name}</th>
                      <th>{m.contents.rowHead.sourceKey}</th>
                      <th>{m.contents.rowHead.outcome}</th>
                      <th>{m.contents.rowHead.registration}</th>
                      <th>{m.contents.rowHead.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(b.items ?? []).map((it, i) => {
                      const st = rowStatus(it);
                      return (
                        <tr key={it.draftId ?? i} data-row-kind={st.kind} className="align-top">
                          <td className="min-w-48">
                            <p className="font-medium">{it.draft?.input?.name ?? m.none}</p>
                            {it.draftId ? (
                              <Link className="text-xs text-primary hover:underline" to={`/contents/drafts/${encodeURIComponent(it.draftId)}`}>
                                {m.products.openDraftShort}
                              </Link>
                            ) : (
                              <span className="text-xs text-base-content/40">{m.none}</span>
                            )}
                          </td>
                          <td className="font-mono text-xs">{it.sourceKey ?? m.none}</td>
                          <td>{it.outcome ? <span className={`badge badge-sm badge-soft ${OUTCOME_CLASS[it.outcome] ?? ''}`}>{m.contents.outcome[it.outcome]}</span> : m.none}</td>
                          <td>
                            <ContentRegistration value={it.draft ?? {}} />
                          </td>
                          <td>
                            <RowStatusView status={st} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {b.state === 'UPLOADED' && (
                <div className="flex justify-end border-t border-base-300 bg-base-200/40 px-5 py-3">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={submit.busy || submit.phase.kind === 'done'}
                    onClick={() => void submit.run(null)}
                  >
                    {m.products.submitBatch}
                  </button>
                </div>
              )}
            </div>
            <CommandFeedback command={submit}>
              {(r) => <ExcludedList ids={r.excludedDraftIds ?? []} items={b.items ?? []} />}
            </CommandFeedback>
            {b.state !== 'UPLOADED' && (
              <BatchApprovals targetRef={`contentImportBatch:${batchId}`} pending={b.pendingSubmission?.approvalRequest} />
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}

/**
 * 다음 할 일(2026-11-18 사용자 "직관적이지 않다") — 서버 배치 state 와 행의 제출 여부(서버 값으로 푼 rowStatus) 수만으로 하나를 고른다.
 * 버튼은 이 쪽의 구역(행 표·승인 현황)으로 내려가기만 한다.
 */
function ContentBatchNextAction({ state, ready }: { readonly state: string; readonly ready: number }) {
  switch (state) {
    case 'UPLOADED':
      return ready > 0 ? (
        <NextAction title={m.contents.next.batchSubmit(ready)}>
          <JumpLink to="batch-rows">{m.products.go.rows}</JumpLink>
        </NextAction>
      ) : (
        <NextAction tone="warning" title={m.products.next.batchNone}>
          <JumpLink to="batch-rows">{m.products.go.rows}</JumpLink>
        </NextAction>
      );
    case 'SUBMITTED':
      return (
        <NextAction title={m.products.next.batchApproval}>
          <JumpLink to="batch-approvals">{m.products.go.approvals}</JumpLink>
        </NextAction>
      );
    case 'PUBLISHED':
      return <NextAction tone="success" title={m.contents.next.batchPublished} />;
    case 'PARTIALLY_PUBLISHED':
      return (
        <NextAction tone="warning" title={m.contents.next.batchPartial}>
          <JumpLink to="batch-approvals">{m.products.go.approvals}</JumpLink>
        </NextAction>
      );
    case 'REJECTED':
      return <NextAction tone="error" title={m.contents.next.batchRejected} />;
    default:
      return null;
  }
}

const KIND_TONE: Record<RowStatus['kind'], Tone> = {
  ready: 'success',
  problems: 'error',
  rejected: 'error',
  none: 'error',
  published: 'ghost',
  locked: 'warning',
};
const OUTCOME_CLASS: Readonly<Record<string, string>> = { CREATED: 'badge-info', UPDATED: 'badge-warning', UNCHANGED: 'badge-ghost', LOCKED: 'badge-neutral' };

function RowStatusView({ status }: { readonly status: RowStatus }) {
  return (
    <div className="space-y-1 text-sm">
      <StatusBadge tone={KIND_TONE[status.kind]}>{status.text}</StatusBadge>
      {status.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-error">
          {status.reasons.map((r, i) => (
            <li key={`${r}-${i}`}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 제출 준비에서 빠진 초안을 ID 만이 아니라 사유와 함께 보인다(사유는 배치 행의 서버 값). */
function ExcludedList({ ids, items }: { readonly ids: readonly string[]; readonly items: readonly ImportItem[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="space-y-1 rounded-box border border-warning/40 bg-warning/5 px-4 py-3 text-sm" aria-label={m.contents.excludedTitle(ids.length)}>
      <p className="font-bold">{m.contents.excludedTitle(ids.length)}</p>
      <ul className="list-disc pl-5">
        {ids.map((id) => {
          const it = items.find((x) => x.draftId === id);
          const st = it ? rowStatus(it) : null;
          return (
            <li key={id}>
              {`${id}${it?.sourceKey ? ` (${it.sourceKey})` : ''}: ${st ? [st.text, ...st.reasons].join(' · ') : m.none}`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
