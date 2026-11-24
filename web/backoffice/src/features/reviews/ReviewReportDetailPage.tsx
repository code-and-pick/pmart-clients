// 신고된 리뷰 상세(review 0.8.0 `GET /review-reports/{reviewId}` — 2026-11-24 사용자 "보이는데 눌러서 상세확인 같은걸 할 수 없다고",
// 백엔드 알림 backoffice/2026-11-24-notice-review-report-detail, 서버 PR #430 병합 전이라 목으로 먼저).
// - 리뷰 글 전체·사진·별점·작성자 가린 이름·지금 숨김/작성자 삭제와 그 리뷰의 신고 한 건 한 건(최근 순, 처리 전·끝 모두).
// - 신고자(고객)는 서버가 싣지 않는다(사용자 "안 보여 줌") — 화면도 자리를 두지 않는다.
// - openReportCount 가 0 이면 처리(숨김·문제없음) 단추를 두지 않는다. 처리는 목록과 같은 `Resolve`(처리 전 신고를 모두 닫는다).
// - 사진 본문 `GET /review-photos/{photoId}` — 숨긴 리뷰 사진은 직원 토큰이 있어야 열려 <img src> 로는 못 연다 → 토큰을 붙여 받아 blob URL.
//   공개 리뷰 사진도 같은 길로 받는다(토큰이 있어도 열린다 — 한 길로). 못 열면(작성자가 지운 리뷰 404 등) "불러오지 못함" — 빈칸으로 두지 않는다.
// - 없는 리뷰·신고 없는 리뷰는 404 REVIEW_NOT_FOUND → 다시 시도 대신 "찾을 수 없어요" + 목록으로.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/review';
import { useApi } from '../../app/ApiContext';
import { FieldList, Notice, PageHeader, Section, StatusBadge } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { StaffName } from '../lookup/parts';
import { Resolve, stars } from './ReviewReportPage';

const m = messages.reviewReports;
type Detail = components['schemas']['ReviewReportDetail'];
type Report = components['schemas']['ReviewReportItem'];
type Photo = Detail['photos'][number];

const isNotFound = (e: unknown) => e instanceof ProblemFailure && (e.problem.code === 'REVIEW_NOT_FOUND' || e.problem.status === 404);

function usePhoto(photoId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['review-reports', 'photo', photoId],
    // 같은 photoId 의 본문은 바뀌지 않는다 — blob URL 을 다시 쓴다(탭을 닫으면 해제)
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => URL.createObjectURL(await request('GET', api.review.GET('/review-photos/{photoId}', { params: { path: { photoId } }, parseAs: 'blob' }))),
  });
}

function Thumb({ photo, index, onOpen }: { readonly photo: Photo; readonly index: number; readonly onOpen: () => void }) {
  const q = usePhoto(photo.photoId);
  if (q.isPending) return <span className="loading loading-spinner loading-sm" />;
  if (q.isError)
    return (
      <span className="flex h-20 w-28 flex-col items-start justify-center gap-1 text-xs text-error" data-testid="review-photo-error">
        {m.photoUnavailable}
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void q.refetch()}>
          {messages.retry}
        </button>
      </span>
    );
  return (
    <button type="button" className="overflow-hidden rounded-lg border border-base-300 transition hover:ring-2 hover:ring-primary/40" aria-label={m.photoOpen(index + 1)} onClick={onOpen}>
      <img src={q.data} alt={m.photoAlt(index + 1)} className="h-20 w-20 object-cover" />
    </button>
  );
}

function Large({ photo, index, onClose }: { readonly photo: Photo; readonly index: number; readonly onClose: () => void }) {
  const q = usePhoto(photo.photoId);
  return (
    <figure className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="review-photo-large">
      {q.data && <img src={q.data} alt={m.photoAlt(index + 1)} className="max-h-[70vh] max-w-full object-contain" />}
      <figcaption className="flex items-center gap-2 text-xs opacity-70">
        {m.photoAlt(index + 1)}
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {m.photoClose}
        </button>
      </figcaption>
    </figure>
  );
}

function Photos({ photos }: { readonly photos: readonly Photo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const big = open === null ? undefined : photos[open];
  return (
    <div className="space-y-2" aria-label={m.photos(photos.length)} role="group">
      <p className="text-xs font-semibold text-base-content/60">{m.photos(photos.length)}</p>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.photoId} data-testid="review-photo">
            <Thumb photo={p} index={i} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>
      {big && open !== null && <Large photo={big} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReportRow({ r }: { readonly r: Report }) {
  return (
    <li className="grid gap-x-6 gap-y-2 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)]" data-testid="review-report-item" data-state={r.state}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{label(m.reasonName, r.reason)}</span>
          <StatusBadge tone={r.state === 'OPEN' ? 'info' : 'ghost'}>{label(m.reportState, r.state)}</StatusBadge>
          <span className="text-xs text-base-content/55">
            {m.reportedAt} {when(r.reportedAt)}
          </span>
        </div>
        {r.detail && <p className="whitespace-pre-wrap text-base-content/75">{r.detail}</p>}
      </div>
      <div className="min-w-0 space-y-1 text-xs">
        {r.state === 'RESOLVED' && (
          <>
            <StatusBadge tone={r.resolution === 'HIDE' ? 'warning' : 'success'}>{label(m.resolutionName, r.resolution ?? null)}</StatusBadge>
            <p className="text-base-content/60">
              <StaffName id={r.resolvedBy} /> · {when(r.resolvedAt)}
            </p>
            {r.resolutionNote && (
              <p className="whitespace-pre-wrap text-base-content/75">
                <span className="text-base-content/50">{m.resolutionNote} </span>
                {r.resolutionNote}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function DetailBody({ d, onDone }: { readonly d: Detail; readonly onDone: () => void }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0" data-testid="review-report-detail">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Section title={m.reviewSection}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
              <span className="text-warning" aria-label={m.rating(d.rating)}>
                {stars(d.rating)}
              </span>
              <span>{text(d.authorMasked)}</span>
              <Link className="link link-hover" to={`/products/${encodeURIComponent(d.productId)}`}>
                {d.sku ?? m.product}
              </Link>
              {d.reviewHidden && <StatusBadge tone="warning">{m.hidden}</StatusBadge>}
              {d.reviewDeleted && <StatusBadge tone="ghost">{m.deleted}</StatusBadge>}
            </div>
            <p className="whitespace-pre-wrap rounded-box bg-base-200/60 px-3 py-2 text-sm" data-testid="review-report-full-text">
              {d.text ? d.text : <span className="text-base-content/50">{m.noText}</span>}
            </p>
            <Photos photos={d.photos} />
          </div>
        </Section>
        <Section title={m.reportsSection(d.reports.length)}>
          <p className="mb-2 text-xs text-base-content/55">{m.reporterHidden}</p>
          <ul className="-mx-5 divide-y divide-base-300/70 border-t border-base-300/70">
            {d.reports.map((r) => (
              <ReportRow key={r.reportId} r={r} />
            ))}
          </ul>
        </Section>
      </div>
      <aside className="min-w-0 space-y-4">
        <Section title={m.resolveSection}>
          {d.openReportCount > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold" data-testid="review-report-open-count">
                {m.openCount(d.openReportCount)}
              </p>
              <Resolve g={d} onDone={onDone} />
            </div>
          ) : (
            <p className="text-sm text-base-content/60" data-testid="review-report-nothing-open">
              {m.nothingOpen}
            </p>
          )}
        </Section>
        <Section title={m.reviewSection}>
          <FieldList
            columns={2}
            rows={[
              [m.writtenAt, when(d.reviewCreatedAt)],
              [m.updatedAt, d.reviewUpdatedAt ? when(d.reviewUpdatedAt) : messages.none],
            ]}
          />
        </Section>
      </aside>
    </div>
  );
}

export function ReviewReportDetailPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { reviewId = '' } = useParams();
  const query = useQuery({
    queryKey: ['review-reports', 'detail', reviewId],
    retry: (n, e) => !isNotFound(e) && n < 2,
    queryFn: () => request('GET', api.review.GET('/review-reports/{reviewId}', { params: { path: { reviewId } } })),
  });
  // 처리 뒤 상세와 목록을 함께 다시 읽는다(목록 키 ['review-reports', state] 도 같은 앞머리)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['review-reports'] });
  const notFound = query.isError && isNotFound(query.error);
  return (
    <section className="space-y-4">
      <PageHeader title={query.data ? m.detailHeadline(query.data.authorMasked, query.data.reports.length) : m.detailTitle} back={{ to: '/review-reports', label: m.back }} />
      {notFound ? (
        <Notice tone="warning">{m.notFound}</Notice>
      ) : (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(d) => <DetailBody d={d} onDone={refresh} />}
        </QueryState>
      )}
    </section>
  );
}
