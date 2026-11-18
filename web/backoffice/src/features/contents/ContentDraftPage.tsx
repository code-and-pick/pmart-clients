// 콘텐츠 초안 1건(고객용 상품명·설명·안내) + 이미지 → 제출 준비 → DISPLAY 승인 요청.
// 상품 승인으로 productId 가 생긴 뒤에만 제출할 수 있다(PRODUCT_NOT_LINKED).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { commandParams } from '../../api/command';
import { ProblemFailure } from '@pmart/web-core';
import type { ContentDraft, ContentDraftInput, ProductSummary } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback, reasonText } from '../../shared/Feedback';
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
import { PageHeader } from '../../shared/admin';

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
  type Key = keyof typeof v;
  const field = (k: Key, label: string, multiline = false) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
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

  return (
    <form
      className="grid gap-3 rounded-box border border-base-300 bg-base-100 shadow-sm p-4 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const notices = v.notices
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
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
      <div className="flex flex-col gap-1 md:col-span-2">
        <ProductPicker label={m.contents.productId} value={v.productId} onChange={(id, product) => void pickProduct(id, product)} onClear={clearAll} />
        {pickNote && (
          <span role="status" className={`text-sm ${pickNote.ok ? 'text-success' : 'text-error'}`}>
            {pickNote.text}
          </span>
        )}
      </div>
      {field('name', m.contents.name)}
      {field('description', m.contents.description, true)}
      {field('notices', m.contents.notices, true)}
      <div className="flex flex-col gap-1 text-sm md:col-span-2">
        <label className="flex flex-wrap items-center gap-2">
          {m.contents.noticesJson}
          <input
            type="file"
            accept="application/json,.json"
            aria-label={m.contents.noticesJson}
            className="file-input file-input-sm"
            onChange={(e) => {
              void fillFromJson(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-xs text-base-content/60">{m.contents.noticesJsonHint}</span>
        {jsonNote && (
          <span role="status" className={jsonNote.ok ? 'text-success' : 'text-error'}>
            {jsonNote.text}
          </span>
        )}
      </div>
      {field('storageGuide', m.contents.storageGuide)}
      {field('returnGuide', m.contents.returnGuide)}
      <div className="md:col-span-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
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
  const [openId, setOpenId] = useState('');
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
      <PageHeader title={m.contents.draftTitle} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (openId.trim()) void navigate(`/contents/drafts/${encodeURIComponent(openId.trim())}`);
        }}
      >
        {/* BR-26: 초안 목록 API 가 없어 ID 로 연다 */}
        <input
          aria-label={m.products.openDraft}
          placeholder={m.products.openDraft}
          className="input input-sm"
          value={openId}
          onChange={(e) => setOpenId(e.target.value)}
        />
        <button type="submit" className="btn btn-sm">
          {m.search}
        </button>
      </form>
      <ContentForm
        {...(productId ? { initial: { productId } } : {})}
        submitLabel={m.products.create}
        busy={create.busy}
        onSubmit={(input) => void create.run(input)}
      />
      <div className="space-y-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-4">
        <h2 className="font-bold">{m.contents.images}</h2>
        <p className="text-sm opacity-80">{m.contents.imageAfterSave}</p>
        <ImagePicker pending={pending} onChange={setPending} disabled={create.busy} />
        {pending.length > 0 && !create.busy && <p className="text-sm">{m.contents.imagesPending(pending.length)}</p>}
        {progress && (
          <p role="status" className="text-sm">
            {m.contents.imageUploading(progress.done, progress.total)}
          </p>
        )}
      </div>
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
      <PageHeader title={m.contents.draftDetail(draftId)} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            <p className="text-sm">
              {`${m.products.state}: ${d.state} · ${d.productId ? `${m.products.productId} ${d.productId}` : m.reason.PRODUCT_NOT_LINKED} · `}
              <span className={d.submittable ? 'text-success' : 'text-warning'}>
                {d.submittable ? m.contents.submittable : m.contents.notSubmittable}
              </span>
            </p>
            {(d.problems?.length ?? 0) > 0 && (
              <ul className="list-disc pl-5 text-sm" aria-label={m.products.problems}>
                {(d.problems ?? []).map((p, i) => (
                  <li key={`${p.code}-${i}`}>{reasonText(p.code)}</li>
                ))}
              </ul>
            )}
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

            <div className="space-y-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-4">
              <h2 className="font-bold">{m.contents.images}</h2>
              {d.state === 'DRAFT' ? (
                <DraftImages key={d.images?.length ?? 0} draft={d} />
              ) : (
                <div className="flex flex-wrap gap-3">
                  {(d.images ?? []).map((img) => (
                    <figure key={img.imageId} className="w-32 text-xs">
                      <AuthedImage imageId={img.imageId} alt={`${m.contents.imageRole[img.role]} ${img.sortOrder}`} className="h-32 w-32 object-contain" />
                      <figcaption>{`${m.contents.imageRole[img.role]} · ${img.sortOrder}`}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>

            {d.state === 'DRAFT' && (
              <button type="button" className="btn btn-sm" disabled={submit.busy || !d.submittable} onClick={() => void submit.run(null)}>
                {m.products.submit}
              </button>
            )}
            <CommandFeedback command={submit}>
              {(r) => <RequestApproval body={r.approvalRequest} />}
            </CommandFeedback>
            {d.approvalId && (
              <Link className="link text-sm" to={`/approvals/${encodeURIComponent(d.approvalId)}`}>
                {`${m.approvals.open} (${d.approvalId})`}
              </Link>
            )}
            {d.state === 'PUBLISHED' && (
              <p className="text-success text-sm">{`${m.contents.published} v${d.contentVersion ?? m.none}`}</p>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
