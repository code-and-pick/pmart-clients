// 콘텐츠 초안 1건(고객용 상품명·설명·안내) + 이미지 → 제출 준비 → DISPLAY 승인 요청.
// 상품 승인으로 productId 가 생긴 뒤에만 제출할 수 있다(PRODUCT_NOT_LINKED).
// 화면(2026-11-18 사용자 "밋밋하다"): 머리·단계 표시 아래 두 칸 — 왼쪽 폼(카드 묶음)·이미지, 오른쪽 상태 카드·다음 단계 카드.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { commandParams } from '../../api/command';
import { ProblemFailure } from '@pmart/web-core';
import type { ContentDraft, ContentDraftInput, ProductSummary } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, reasonText } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { RequestApproval } from '../approvals/RequestApproval';
import { AuthedImage } from './AuthedImage';
import { ImagePicker, type PendingImage } from './ImagePicker';
import { uploadPendingImages, type UploadOutcome } from './imageUpload';
import { NoticesJsonError, parseNoticesJson } from './noticesJson';
import { ProductPicker } from './ProductPicker';
import { CodeLabel, NextAction, PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { Card, EmptyState, JumpLink, Steps, TitleWithId } from '../products/parts';
import { OpenById } from '../products/ProductDraftPage';

function ContentForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
}: {
  readonly initial?: ContentDraftInput;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: (input: ContentDraftInput) => void;
}) {
  const [v, setV] = useState({
    productId: initial?.productId ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    storageGuide: initial?.storageGuide ?? '',
    returnGuide: initial?.returnGuide ?? '',
    notices: (initial?.notices ?? []).join('\n'),
  });
  // 떠날 때 경고(2026-11-18): 연 값과 다르면 "작성 중" — 저장을 누르면 그 값이 새 기준
  const [baseline, setBaseline] = useState(() => JSON.stringify(v));
  const dirty = JSON.stringify(v) !== baseline;
  type Key = keyof typeof v;
  const field =(k: Key, label: string, multiline = false) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-base-content/60">{label}</span>
      {multiline ? (
        <textarea className="textarea textarea-sm w-full" rows={3} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      ) : (
        <input className="input input-sm w-full" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      )}
    </label>
  );
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  const [jsonNote, setJsonNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickNote, setPickNote] = useState<{ ok: boolean; text: string } | null>(null);
  const api = useApi();

  /** 상품을 고르면 게시된 콘텐츠(GET /product-contents/{productId})로 다섯 칸을 채운다. 없으면(404) 관리용 명칭만. */
  const pickProduct = async (productId: string, product?: ProductSummary) => {
    setPickNote(null);
    if (!productId) {
      setV({ ...v, productId: '' });
      return;
    }
    const base = { ...v, productId };
    try {
      const c = await request('GET', api.content.GET('/product-contents/{productId}', { params: { path: { productId } } }));
      setV({
        ...base,
        name: c.name ?? base.name,
        description: c.description ?? base.description,
        storageGuide: c.storageGuide ?? base.storageGuide,
        returnGuide: c.returnGuide ?? base.returnGuide,
        notices: (c.notices ?? []).join('\n') || base.notices,
      });
      setPickNote({ ok: true, text: m.contents.autoFilled });
    } catch (e) {
      if (e instanceof ProblemFailure && e.problem.status === 404) {
        setV({ ...base, name: base.name.trim() ? base.name : (product?.internalName ?? '') });
        setPickNote({ ok: true, text: m.contents.autoFilledNameOnly });
      } else {
        // 조회 실패는 "게시된 콘텐츠 없음"이 아니다. 상품 ID 만 두고 알린다.
        setV(base);
        setPickNote({ ok: false, text: m.contents.autoFillFailed });
      }
    }
  };

  const clearAll = () => {
    setV({ productId: '', name: '', description: '', storageGuide: '', returnGuide: '', notices: '' });
    setPickNote(null);
    setJsonNote(null);
  };

  /** 고시 정보 JSON 파일로 채운다. notices 는 바꿔 넣고, 상품명·설명·안내는 빈 칸만 채운다. */
  const fillFromJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseNoticesJson(await file.text());
      const next = { ...v, notices: parsed.notices.join('\n') };
      let extra = 0;
      for (const k of ['name', 'description', 'storageGuide', 'returnGuide'] as const) {
        const value = parsed.fields[k];
        if (value && !v[k].trim()) {
          next[k] = value;
          extra += 1;
        }
      }
      setV(next);
      setJsonNote({ ok: true, text: m.contents.noticesJsonFilled(parsed.notices.length, extra) });
    } catch (e) {
      setJsonNote({ ok: false, text: m.contents.noticesJsonInvalid(e instanceof NoticesJsonError ? e.message : String(e)) });
    }
  };

  // 화면(2026-11-18 사용자 "밋밋하다"): 제목 있는 카드로 묶는다 — 연결 상품 → 고객에게 보이는 정보 → 고시 정보·안내, 저장은 아래 오른쪽.
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const notices = v.notices
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
        setBaseline(JSON.stringify(v));
        onSubmit({
          ...(initial?.sourceSystem ? { sourceSystem: initial.sourceSystem } : {}),
          ...(initial?.sourceKey ? { sourceKey: initial.sourceKey } : {}),
          ...(initial?.options ? { options: initial.options } : {}),
          ...(v.productId.trim() ? { productId: v.productId.trim() } : {}),
          ...(v.name.trim() ? { name: v.name.trim() } : {}),
          description: opt(v.description),
          storageGuide: opt(v.storageGuide),
          returnGuide: opt(v.returnGuide),
          ...(notices.length > 0 ? { notices } : {}),
        });
      }}
    >
      <LeaveGuard when={dirty} />
      <Card title={m.contents.formProduct}>
        <ProductPicker label={m.contents.productId} value={v.productId} onChange={(id, product) => void pickProduct(id, product)} onClear={clearAll} />
        {pickNote && (
          <span role="status" className={`text-sm ${pickNote.ok ? 'text-success' : 'text-error'}`}>
            {pickNote.text}
          </span>
        )}
      </Card>
      <Card title={m.contents.formCustomer}>
        {field('name', m.contents.name)}
        {field('description', m.contents.description, true)}
      </Card>
      <Card title={m.contents.formGuide}>
        {field('notices', m.contents.notices, true)}
        <label className="flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed border-base-300 px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-base-200/60">
          <span className="font-medium">{m.contents.noticesJson}</span>
          <input
            type="file"
            accept="application/json,.json"
            aria-label={m.contents.noticesJson}
            className="file-input file-input-sm w-full max-w-sm"
            onChange={(e) => {
              void fillFromJson(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="text-xs text-base-content/60">{m.contents.noticesJsonHint}</span>
        </label>
        {jsonNote && (
          <span role="status" className={`text-sm ${jsonNote.ok ? 'text-success' : 'text-error'}`}>
            {jsonNote.text}
          </span>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {field('storageGuide', m.contents.storageGuide)}
          {field('returnGuide', m.contents.returnGuide)}
        </div>
      </Card>
      <div className="flex justify-end rounded-box border border-base-300 bg-base-100 px-5 py-3 shadow-sm">
        <button type="submit" className="btn btn-primary btn-sm min-w-28" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function NewContentDraftPage() {
  const api = useApi();
  const navigate = useNavigate();
  // 상품 상세의 "콘텐츠·이미지 등록"에서 오면 상품 ID 를 채운다.
  const productId = useSearchParams()[0].get('productId') ?? '';
  // 폼에서 고른 이미지. 초안이 만들어진 뒤(ID 가 생긴 뒤) 차례로 올린다(계약: 이미지는 초안에 붙는다).
  const [pending, setPending] = useState<readonly PendingImage[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const create = useCommand(async (body: ContentDraftInput, key) => {
    const d = await request('POST', api.content.POST('/content-drafts', { ...commandParams(key), body }));
    let outcome: UploadOutcome = { uploaded: [], failed: [] };
    if (pending.length > 0) {
      outcome = await uploadPendingImages(api, d.draftId, pending, d.images ?? [], (done, total) => setProgress({ done, total }));
      setProgress(null);
      setPending(outcome.failed.map((f) => f.image));
    }
    // 전부 올라갔으면 초안 화면으로. 일부 실패면 이 화면에 남아 알리고, 초안 화면 링크를 보인다.
    if (outcome.failed.length === 0) void navigate(`/contents/drafts/${encodeURIComponent(d.draftId)}`);
    return { draft: d, ...outcome };
  });
  return (
    <section className="space-y-4">
      <PageHeader title={m.contents.draftTitle} actions={<OpenById base="/contents/drafts" />} />
      <Steps steps={m.contents.draftSteps} now={0} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ContentForm
            {...(productId ? { initial: { productId } } : {})}
            submitLabel={m.products.create}
            busy={create.busy}
            onSubmit={(input) => void create.run(input)}
          />
          <CommandFeedback command={create}>
            {(r) =>
              r.failed.length > 0 ? (
                <p role="status" className="text-warning text-sm">
                  {m.contents.imageUploadPartial(r.uploaded.length, r.failed.length)}{' '}
                  <Link className="link" to={`/contents/drafts/${encodeURIComponent(r.draft.draftId)}`}>
                    {m.contents.openDraft}
                  </Link>
                </p>
              ) : null
            }
          </CommandFeedback>
        </div>
        <Card title={m.contents.images} hint={m.contents.imageAfterSave}>
          <ImagePicker pending={pending} onChange={setPending} disabled={create.busy} />
          {pending.length > 0 && !create.busy && <p className="text-sm">{m.contents.imagesPending(pending.length)}</p>}
          {progress && (
            <p role="status" className="text-sm">
              {m.contents.imageUploading(progress.done, progress.total)}
            </p>
          )}
        </Card>
      </div>
    </section>
  );
}

/** 기존 초안의 이미지. 고르는 즉시 한 장씩 올리고(Eum 방식) 초안을 다시 읽는다. */
function DraftImages({ draft }: { readonly draft: ContentDraft }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<readonly PendingImage[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const upload = useCommand(async (images: readonly PendingImage[]) => {
    const outcome = await uploadPendingImages(api, draft.draftId, images, draft.images ?? [], (done, total) => setProgress({ done, total }));
    setProgress(null);
    await queryClient.invalidateQueries({ queryKey: ['content', 'draft', draft.draftId] });
    setPending(outcome.failed.map((f) => f.image));
    return outcome;
  });
  const onChange = (next: readonly PendingImage[]) => {
    setPending(next);
    const added = next.filter((p) => !pending.some((q) => q.id === p.id));
    if (added.length > 0 && !upload.busy) void upload.run(added);
  };

  return (
    <div className="space-y-2">
      <ImagePicker pending={pending} onChange={onChange} existing={draft.images ?? []} disabled={upload.busy} />
      {progress && (
        <p role="status" className="text-sm">
          {m.contents.imageUploading(progress.done, progress.total)}
        </p>
      )}
      <CommandFeedback command={upload}>
        {(r) => (
          <p role="status" className={`text-sm ${r.failed.length > 0 ? 'text-warning' : 'text-success'}`}>
            {r.failed.length > 0 ? m.contents.imageUploadPartial(r.uploaded.length, r.failed.length) : m.contents.imageUploaded(r.uploaded.length)}
          </p>
        )}
      </CommandFeedback>
    </div>
  );
}

const CONTENT_TONE: Readonly<Record<ContentDraft['state'], Tone>> = { DRAFT: 'neutral', SUBMITTED: 'warning', PUBLISHED: 'success', REJECTED: 'error' };

/**
 * 다음 할 일(2026-11-18 사용자 "직관적이지 않다") — 서버 초안 state·submittable·productId·approvalId 만으로 하나를 고른다.
 * 버튼은 이 쪽의 구역(폼·다음 단계 카드)이나 승인 링크로만 간다.
 */
function ContentNextAction({ draft: d }: { readonly draft: ContentDraft }) {
  const approval = d.approvalId ? (
    <Link className="btn btn-sm" to={`/approvals/${encodeURIComponent(d.approvalId)}`}>
      {m.products.openApproval}
    </Link>
  ) : null;
  switch (d.state) {
    case 'DRAFT':
      return d.submittable ? (
        <NextAction title={m.contents.next.submit} body={m.products.next.submitBody}>
          <JumpLink to="draft-next">{m.products.go.next}</JumpLink>
        </NextAction>
      ) : (
        <NextAction tone="warning" title={m.contents.next.fix} body={d.productId ? undefined : m.reason.PRODUCT_NOT_LINKED}>
          <JumpLink to="draft-form">{m.products.go.form}</JumpLink>
        </NextAction>
      );
    case 'SUBMITTED':
      return approval ? (
        <NextAction title={m.products.next.waitApproval}>{approval}</NextAction>
      ) : (
        <NextAction title={m.products.next.requestApproval}>
          <JumpLink to="draft-next">{m.products.go.next}</JumpLink>
        </NextAction>
      );
    case 'PUBLISHED':
      return <NextAction tone="success" title={m.contents.next.published(`v${d.contentVersion ?? m.none}`)} />;
    default:
      return (
        <NextAction tone="error" title={m.products.next.rejected}>
          {approval}
        </NextAction>
      );
  }
}

export function ContentDraftPage() {
  const { draftId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['content', 'draft', draftId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => request('GET', api.content.GET('/content-drafts/{draftId}', { params: { path: { draftId } } })),
  });
  const update = useCommand(async ({ body, version }: { body: ContentDraftInput; version: number }, k) => {
    const d = await request(
      'PUT',
      api.content.PUT('/content-drafts/{draftId}', { ...commandParams(k, { path: { draftId }, version: version }), body }),
    );
    queryClient.setQueryData(key, d);
    return d;
  });
  const submit = useCommand(async (_: null, k) => {
    const r = await request(
      'POST',
      api.content.POST('/content-drafts/{draftId}/submissions', { ...commandParams(k, { path: { draftId } }) }),
    );
    await queryClient.invalidateQueries({ queryKey: key });
    return r;
  });

  return (
    <section className="space-y-4">
      <PageHeader title={<TitleWithId title={query.data ? query.data.input?.name || m.products.unnamed : ''} id={m.contents.draftDetail(draftId)} />} actions={<OpenById base="/contents/drafts" />} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            <Steps steps={m.contents.draftSteps} now={d.state === 'PUBLISHED' ? 4 : d.state === 'SUBMITTED' ? 3 : d.submittable ? 2 : 1} />
            <ContentNextAction draft={d} />
            <div className="grid items-start gap-4 lg:grid-cols-3">
              <div id="draft-form" className="scroll-mt-4 space-y-4 lg:col-span-2">
                {d.state === 'DRAFT' && (
                  <ContentForm
                    key={d.version}
                    {...(d.input ? { initial: d.input } : {})}
                    submitLabel={m.products.update}
                    busy={update.busy}
                    onSubmit={(body) => void update.run({ body, version: d.version })}
                  />
                )}
                <CommandFeedback command={update} />

                <Card title={m.contents.images}>
                  {d.state === 'DRAFT' ? (
                    <DraftImages key={d.images?.length ?? 0} draft={d} />
                  ) : (d.images ?? []).length === 0 ? (
                    <EmptyState icon="image">{m.contents.noImages}</EmptyState>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {(d.images ?? []).map((img) => (
                        <figure key={img.imageId} className="w-32 overflow-hidden rounded-lg border border-base-300 text-xs">
                          <AuthedImage imageId={img.imageId} alt={`${m.contents.imageRole[img.role]} ${img.sortOrder}`} className="h-32 w-32 bg-base-200 object-contain" />
                          <figcaption className="px-2 py-1">{`${m.contents.imageRole[img.role]} · ${img.sortOrder}`}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="space-y-4">
                <Card title={m.products.state}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={CONTENT_TONE[d.state] ?? 'ghost'}>
                      <CodeLabel code={d.state} names={m.contents.draftStateName} />
                    </StatusBadge>
                    <span className={`badge badge-sm badge-soft ${d.submittable ? 'badge-success' : 'badge-warning'}`}>
                      {d.submittable ? m.contents.submittable : m.contents.notSubmittable}
                    </span>
                  </div>
                  <div className="space-y-0.5 text-sm">
                    <p className="text-xs text-base-content/50">{m.products.productId}</p>
                    {d.productId ? (
                      <Link className="link link-primary font-mono" to={`/products/${encodeURIComponent(d.productId)}`}>
                        {d.productId}
                      </Link>
                    ) : (
                      <p className="text-warning">{m.reason.PRODUCT_NOT_LINKED}</p>
                    )}
                  </div>
                  {(d.problems?.length ?? 0) > 0 && (
                    <ul className="space-y-1 rounded-lg bg-error/5 px-3 py-2 text-sm text-error" aria-label={m.products.problems}>
                      {(d.problems ?? []).map((p, i) => (
                        <li key={`${p.code}-${i}`} className="flex gap-1.5">
                          <span aria-hidden="true">•</span>
                          <span>{reasonText(p.code)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.state === 'PUBLISHED' && (
                    <p className="text-success text-sm">{`${m.contents.published} v${d.contentVersion ?? m.none}`}</p>
                  )}
                </Card>
                <Card id="draft-next" title={m.products.nextTitle}>
                  {d.state === 'DRAFT' && (
                    <button type="button" className="btn btn-primary btn-sm btn-block" disabled={submit.busy || !d.submittable} onClick={() => void submit.run(null)}>
                      {m.products.submit}
                    </button>
                  )}
                  <CommandFeedback command={submit}>
                    {(r) => <RequestApproval body={r.approvalRequest} />}
                  </CommandFeedback>
                  {d.approvalId && (
                    <Link className="link link-primary text-sm" to={`/approvals/${encodeURIComponent(d.approvalId)}`}>
                      {m.approvals.open}
                    </Link>
                  )}
                  {d.state !== 'DRAFT' && !d.approvalId && <p className="text-sm text-base-content/55">{m.none}</p>}
                </Card>
              </div>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}
