// 콘텐츠 일괄 등록(seed-v1 zip) → 상품별 결과 → 제출 가능한 초안 제출 준비 → DISPLAY 승인.
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
import { BatchApprovals, multipart, ZipUpload } from '../products/ProductImportPage';
import { ContentRegistration } from './ContentRegistration';
import { type ImportItem, rowStatus, type RowStatus, rowSummary } from './importRowStatus';
import { DataTable, PageHeader } from '../../shared/admin';

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
      <ZipUpload
        busy={upload.busy}
        onUpload={(file) => void upload.run(file)}
      />
      <CommandFeedback command={upload} />
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
      <PageHeader title={m.products.batch(batchId)} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(b) => (
          <>
            <p className="text-sm">{`${b.state} · ${b.productCount}`}</p>
            <p role="status" data-testid="row-summary" className="text-sm">
              {rowSummary(b.items ?? [])}
            </p>
            <DataTable>
              <thead>
                <tr>
                  <th>{m.contents.rowHead.draft}</th>
                  <th>{m.contents.rowHead.sourceKey}</th>
                  <th>{m.contents.rowHead.outcome}</th>
                  <th>{m.contents.rowHead.registration}</th>
                  <th>{m.contents.rowHead.name}</th>
                  <th>{m.contents.rowHead.status}</th>
                </tr>
              </thead>
              <tbody>
                {(b.items ?? []).map((it, i) => {
                  const st = rowStatus(it);
                  return (
                    <tr key={it.draftId ?? i} data-row-kind={st.kind}>
                      <td>
                        {it.draftId ? (
                          <Link className="link" to={`/contents/drafts/${encodeURIComponent(it.draftId)}`}>
                            {it.draftId}
                          </Link>
                        ) : (
                          m.none
                        )}
                      </td>
                      <td>{it.sourceKey ?? m.none}</td>
                      <td>{it.outcome ? m.contents.outcome[it.outcome] : m.none}</td>
                      <td>
                        <ContentRegistration value={it.draft ?? {}} />
                      </td>
                      <td>{it.draft?.input?.name ?? m.none}</td>
                      <td>
                        <RowStatusView status={st} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            {b.state === 'UPLOADED' && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={submit.busy || submit.phase.kind === 'done'}
                onClick={() => void submit.run(null)}
              >
                {m.products.submitBatch}
              </button>
            )}
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

const KIND_CLASS: Record<RowStatus['kind'], string> = {
  ready: 'text-success',
  problems: 'text-error',
  rejected: 'text-error',
  none: 'text-error',
  published: 'opacity-70',
  locked: 'text-warning',
};

function RowStatusView({ status }: { readonly status: RowStatus }) {
  return (
    <div className="text-sm">
      <span className={KIND_CLASS[status.kind]}>{status.text}</span>
      {status.reasons.length > 0 && (
        <ul className="list-disc pl-5">
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
    <div className="space-y-1 text-sm" aria-label={m.contents.excludedTitle(ids.length)}>
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
