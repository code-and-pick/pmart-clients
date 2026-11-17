// 승인 상세·결정. 5축(요청·심사·실행·전달·사건)을 한 상태로 합치지 않는다.
// 결정은 APPROVE·REJECT 만(나머지는 백엔드 미지원 → 버튼 없음). 결정 뒤 정본 반영은 비동기라 짧게 폴링한다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { commandParams } from '../../api/command';
import { CommandRejectedFailure, UnknownResultFailure } from '@pmart/web-core';
import type { ApprovalDetail, ApprovalLine, ExecutionState, ReviewState, SupportedDecision } from '../../api/models';
import { request } from '@pmart/web-core';
import { pollConfig, pollUntil } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { ContentRegistration } from '../contents/ContentRegistration';
import { DataTable, PageHeader } from '../../shared/admin';

const OPEN_REVIEW: readonly ReviewState[] = ['REVIEW_PENDING', 'EVIDENCE_REQUIRED'];
const FINAL_EXECUTION: readonly ExecutionState[] = ['APPLIED', 'PARTIAL', 'REJECTED'];

const isWatching = (a: ApprovalDetail) =>
  (a.reviewState === 'APPROVED' || a.reviewState === 'PARTIALLY_APPROVED') &&
  !FINAL_EXECUTION.includes(a.executionState ?? 'NOT_REQUESTED');

/** 상품 행 attributes {registration, existingProductId, existingSkus, internalName}: 재업로드(UPDATE)면 기존 상품 갱신임을 보인다. */
function ProductLineAttributes({ attributes }: { readonly attributes: Record<string, unknown> | undefined }) {
  if (!attributes || !('registration' in attributes)) return null;
  const registration = attributes['registration'];
  const name = typeof attributes['internalName'] === 'string' ? attributes['internalName'] : null;
  if (registration !== 'UPDATE') {
    return <p className="text-sm">{`${name ?? ''} ${m.products.registrationName.NEW}`.trim()}</p>;
  }
  const productId = typeof attributes['existingProductId'] === 'string' ? attributes['existingProductId'] : m.none;
  const skus = Array.isArray(attributes['existingSkus']) ? (attributes['existingSkus'] as unknown[]).filter((s) => typeof s === 'string').join(', ') : '';
  return (
    <p className="text-sm">
      <span className="badge badge-warning badge-sm mr-1">{m.products.registrationName.UPDATE}</span>
      {`${name ? `${name} · ` : ''}${productId}${skus ? ` · ${m.products.existingSkus(skus)}` : ''}`}
    </p>
  );
}

/** 가격 행 attributes {previousPrice, basePrice, changeType, productName} 가 있으면 읽기 쉽게. 없는 값은 "-"(0 으로 바꾸지 않는다). */
function PriceLineAttributes({ attributes }: { readonly attributes: Record<string, unknown> | undefined }) {
  if (!attributes || !('changeType' in attributes || 'previousPrice' in attributes)) return null;
  const amount = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? formatKrw(v) : m.none);
  const changeType = typeof attributes['changeType'] === 'string' ? attributes['changeType'] : '';
  const changeName = (m.prices.changeTypeName as Readonly<Record<string, string>>)[changeType] ?? changeType;
  const name = typeof attributes['productName'] === 'string' ? attributes['productName'] : m.none;
  return (
    <p className="text-sm" data-testid="price-line">
      {`${name} · ${amount(attributes['previousPrice'])} → ${amount(attributes['basePrice'])}${changeName ? ` · ${changeName}` : ''}`}
    </p>
  );
}

/**
 * 직원 권한 요청(GRANT) 행 attributes {role, centers, validFrom, validTo, reason, employee{operatorId, employeeNo, mailAddress, affiliation{type, code}}}
 * — 백엔드 handoff 2026-11-13 reply-hr-backoffice-questions Q6. 이름은 오지 않는다. 없는 값은 "-"(무기한·전체로 바꾸지 않는다).
 */
/** GRANT 행이 권한을 줄 직원 ID(attributes.employee.operatorId) — 없으면 null */
function grantEmployeeId(attributes: Record<string, unknown> | undefined): string | null {
  const emp = attributes?.['employee'];
  if (typeof emp !== 'object' || emp === null) return null;
  const id = (emp as Record<string, unknown>)['operatorId'];
  return typeof id === 'string' ? id : null;
}

function GrantLineAttributes({ attributes }: { readonly attributes: Record<string, unknown> | undefined }) {
  if (!attributes || typeof attributes['role'] !== 'string') return null;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : m.none);
  const centers = Array.isArray(attributes['centers']) ? (attributes['centers'] as unknown[]).filter((c) => typeof c === 'string').join(', ') : '';
  const emp = typeof attributes['employee'] === 'object' && attributes['employee'] !== null ? (attributes['employee'] as Record<string, unknown>) : null;
  const aff = emp && typeof emp['affiliation'] === 'object' && emp['affiliation'] !== null ? (emp['affiliation'] as Record<string, unknown>) : null;
  const g = m.approvals.grant;
  return (
    <dl className="grid grid-cols-[5rem_1fr] gap-x-2 text-sm" data-testid="grant-line">
      <dt>{g.role}</dt>
      <dd>{attributes['role']}</dd>
      <dt>{g.centers}</dt>
      <dd>{centers || m.none}</dd>
      <dt>{g.period}</dt>
      <dd>{`${text(attributes['validFrom'])} ~ ${text(attributes['validTo'])}`}</dd>
      <dt>{g.reason}</dt>
      <dd>{text(attributes['reason'])}</dd>
      {emp && (
        <>
          <dt>{g.employee}</dt>
          <dd>
            {`${text(emp['employeeNo'])} · ${text(emp['mailAddress'])}`}
            {aff && ` · ${g.affiliationType[text(aff['type'])] ?? text(aff['type'])} ${text(aff['code'])}`}
          </dd>
        </>
      )}
    </dl>
  );
}

type Line = ApprovalLine;

/** 금액(원)으로 읽는 승인 유형. 그 밖(재고·상품·콘텐츠 등)의 숫자는 돈이 아니므로 "원"을 붙이지 않는다. */
const MONEY_TYPES: ReadonlySet<string> = new Set(['PRICE', 'REFUND_CLAIM']);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 수량: 계약 requestedQty, 없으면 행 attributes.qty(초기 보유·재고 행). 없으면 빈칸(0 으로 채우지 않는다). */
function lineQtyText(l: Line): string {
  const q = isCount(l.requestedQty) ? l.requestedQty : isCount(l.attributes?.['qty']) ? l.attributes['qty'] : null;
  return q === null ? '' : m.approvals.qtyUnit(q);
}

/** 금액: 금액 유형만 원으로. 다른 유형에 숫자가 오면 단위 없이 그대로(돈으로 단정하지 않음). 금액 없는 행은 서버가 null 로 준다. */
function lineAmountText(type: string | undefined, l: Line): string {
  const v = l.requestedAmount;
  if (v === undefined || v === null) return '';
  if (type && MONEY_TYPES.has(type)) return formatKrw(v);
  return lineQtyText(l) === '' ? String(v) : '';
}

export function ApprovalDetailPage() {
  const { approvalId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [watchCount, setWatchCount] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  const getApproval = () =>
    request('GET', api.approval.GET('/approvals/{approvalId}', { params: { path: { approvalId } } }));

  const query = useQuery({
    queryKey: ['approval', 'detail', approvalId],
    queryFn: getApproval,
    refetchInterval: (q) => {
      const a = q.state.data;
      if (watchCount === null || !a || !isWatching(a) || q.state.dataUpdateCount - watchCount >= pollConfig.maxAttempts) {
        return false;
      }
      return pollConfig.intervalMs;
    },
  });

  const decide = useCommand(async ({ decision, version }: { decision: SupportedDecision; version: number | undefined }, key) => {
    const res = await request(
      'POST',
      api.approval.POST('/approvals/{approvalId}/decisions', {
        ...commandParams(key, { path: { approvalId }, version: version }),
        body: { decision, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      }),
    );
    if (res.status === 'REJECTED') throw new CommandRejectedFailure(res.nextAction, res.requestId);
    if (res.status === 'UNKNOWN_RESULT') {
      // 짝 조회: 심사 축이 열린 상태에서 벗어났으면 결정이 기록된 것이다.
      const outcome = await pollUntil(getApproval, (a) => !OPEN_REVIEW.includes(a.reviewState ?? 'REVIEW_PENDING'));
      if (outcome.kind !== 'done') throw new UnknownResultFailure(undefined, res.requestId);
    }
    await queryClient.invalidateQueries({ queryKey: ['approval'] });
    setWatchCount(queryClient.getQueryState(['approval', 'detail', approvalId])?.dataUpdateCount ?? 0);
    return res;
  });

  // 폴링 응답이 앞과 같으면 data 가 그대로라 다시 그리지 않는다 → 30회가 끝나도 "확인 중"이 계속 돌았다.
  // dataUpdatedAt 은 응답마다 바뀌므로 읽어 두면(관찰 대상) 매 응답 뒤 다시 그려 횟수 초과를 화면에 보인다.
  const lastFetchedAt = query.dataUpdatedAt;

  return (
    <section className="space-y-4" data-fetched-at={lastFetchedAt}>
      <PageHeader title={`${m.approvals.detailTitle} ${approvalId}`} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(a) => {
          const open = OPEN_REVIEW.includes(a.reviewState ?? 'REVIEW_PENDING');
          const own = session !== null && a.requesterId === session.subject;
          // approval-service 2026-11-17 "자기 자신은 안 됨"(백엔드 알림 hr-backoffice/2026-11-17-notice-self-action-rules §2): 권한을 받을 직원 = 나 → 승인·반려 모두 403. 판정은 서버, 화면은 버튼을 끄고 안내
          const grantToSelf = session !== null && a.type === 'GRANT' && (a.lines ?? []).some((l) => grantEmployeeId(l.attributes) === session.subject);
          const watching = watchCount !== null && isWatching(a);
          const updatesSinceDecision =
            (queryClient.getQueryState(['approval', 'detail', approvalId])?.dataUpdateCount ?? 0) - (watchCount ?? 0);
          const watchedOut = watching && updatesSinceDecision >= pollConfig.maxAttempts;
          return (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-1 rounded-box border border-base-300 bg-base-100 p-4 text-sm">
                <dt>{m.approvals.type}</dt>
                <dd>{a.type ?? m.none}</dd>
                <dt>{m.approvals.target}</dt>
                <dd>{`${a.targetService ?? m.none} · ${a.targetRef ?? m.none}`}</dd>
                <dt>{m.approvals.summary}</dt>
                <dd>{a.summary ?? m.none}</dd>
                <dt>{m.approvals.requester}</dt>
                <dd>{a.requesterId ?? m.none}</dd>
                <dt>{m.approvals.review}</dt>
                <dd data-testid="review-state">{a.reviewState ? m.approvals.reviewState[a.reviewState] : m.none}</dd>
                <dt>{m.approvals.execution}</dt>
                <dd data-testid="execution-state">
                  {a.executionState ? m.approvals.executionState[a.executionState] : m.none}
                </dd>
                <dt>{m.approvals.delivery}</dt>
                <dd>{a.deliveryState ?? m.none}</dd>
                <dt>{m.approvals.submittedAt}</dt>
                <dd>{a.submittedAt ? formatSeoul(a.submittedAt) : m.none}</dd>
              </dl>

              {watching && !watchedOut && (
                <div role="status" className="flex items-center gap-2 text-sm">
                  <span className="loading loading-spinner loading-sm" />
                  {m.approvals.executionWaiting}
                </div>
              )}
              {watchedOut && (
                <div role="status" className="alert alert-info">
                  <span>{m.approvals.executionTimeout}</span>
                  <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>
                    {m.checkAgain}
                  </button>
                </div>
              )}

              <h2 className="font-bold">{m.approvals.lines}</h2>
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.approvals.lineHead.key}</th>
                    <th>{m.approvals.lineHead.qty}</th>
                    <th>{m.approvals.lineHead.amount}</th>
                    <th>{m.approvals.lineHead.detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {(a.lines ?? []).map((l) => (
                    <tr key={l.lineKey}>
                      <td>{l.lineKey}</td>
                      <td data-testid="line-qty">{lineQtyText(l)}</td>
                      <td data-testid="line-amount">{lineAmountText(a.type, l)}</td>
                      <td>
                        {/* 가격 일괄 등록 행(백엔드 안내 2026-11-03 §1-5): 승인자가 이전 → 새 가격·구분·상품명을 바로 본다 */}
                        <PriceLineAttributes attributes={l.attributes} />
                        {a.type === 'GRANT' && <GrantLineAttributes attributes={l.attributes} />}
                        {/* 상품 등록 행(BR-39 회신): 재업로드면 "기존 상품 갱신"을 먼저 보인다 */}
                        {/* 콘텐츠 게시 행(BR-44 회신): 이미 게시된 콘텐츠를 바꾸는 건이면 "기존 게시 갱신" + 지금 게시본 버전 */}
                        {a.targetService === 'product-content-service' ? (
                          l.attributes && 'registration' in l.attributes && (
                            <p className="text-sm" data-testid="content-registration">
                              <ContentRegistration
                                value={{
                                  registration: typeof l.attributes['registration'] === 'string' ? l.attributes['registration'] : null,
                                  publishedContentVersion: l.attributes['publishedContentVersion'],
                                }}
                              />
                            </p>
                          )
                        ) : (
                          <ProductLineAttributes attributes={l.attributes} />
                        )}
                        <code className="text-xs break-all">{l.attributes ? JSON.stringify(l.attributes) : ''}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>

              {open && (
                <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4">
                  {own && <p className="text-warning text-sm">{m.approvals.selfApproval}</p>}
                  {grantToSelf && (
                    <p role="note" className="text-warning text-sm" data-testid="grant-to-self">
                      {m.approvals.grantToSelf}
                    </p>
                  )}
                  <label className="floating-label block">
                    <span>{m.approvals.commentLabel}</span>
                    <input
                      className="input input-sm w-full"
                      maxLength={1000}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={decide.busy || grantToSelf}
                      onClick={() => void decide.run({ decision: 'APPROVE', version: a.version })}
                    >
                      {m.approvals.approve}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={decide.busy || grantToSelf}
                      onClick={() => void decide.run({ decision: 'REJECT', version: a.version })}
                    >
                      {m.approvals.reject}
                    </button>
                  </div>
                </div>
              )}
              <CommandFeedback command={decide}>
                {() => (
                  <div role="status" className="alert alert-success">
                    {m.approvals.decided}
                  </div>
                )}
              </CommandFeedback>

              {(a.decisions?.length ?? 0) > 0 && (
                <>
                  <h2 className="font-bold">{m.approvals.decisions}</h2>
                  <ul className="text-sm">
                    {(a.decisions ?? []).map((d, i) => (
                      <li key={d.decisionId ?? i}>
                        {`${d.decision} · ${d.approverId ?? m.none} · ${d.decidedAt ? formatSeoul(d.decidedAt) : m.none}${d.comment ? ` · ${d.comment}` : ''}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(a.receipts?.length ?? 0) > 0 && (
                <>
                  <h2 className="font-bold">{m.approvals.receipts}</h2>
                  <ul className="text-sm">
                    {(a.receipts ?? []).map((r, i) => (
                      <li key={r.receiptId ?? i}>{`${r.receiverService} · ${r.result}${r.reason ? ` · ${r.reason}` : ''}`}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
