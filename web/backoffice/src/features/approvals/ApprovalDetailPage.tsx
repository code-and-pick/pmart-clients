// 승인 상세·결정. 5축(요청·심사·실행·전달·사건)을 한 상태로 합치지 않는다.
// 결정은 APPROVE·REJECT 만(나머지는 백엔드 미지원 → 버튼 없음). 결정 뒤 정본 반영은 비동기라 짧게 폴링한다.
import { QueueNav } from '../../shared/workQueue';
import { StaffName } from '../lookup/parts';
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
import { useRecordRecent } from '../../shared/recentViews';
import { ApprovalProgress } from './ApprovalProgress';
import { messages as m } from '../../shared/messages';
import { SystemNumbers } from '../../shared/displayNumber';
import { hideIds, isSystemId } from '../../shared/hideIds';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { ContentRegistration } from '../contents/ContentRegistration';
import { CodeLabel, DataTable, DetailHeader, NextAction, Section, StatusBadge, type Tone } from '../../shared/admin';
import { KindChip, Person, SideFields, Timeline, When } from '../lookup/parts';

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

  // 화면(2026-11-18 Shopify 상세처럼): 상세 머리(번호·유형·심사·반영 꼬리표·요약) → 두 칸
  // 왼쪽(넓게) = 승인 행·결정 이력·반영 확인, 오른쪽 = 심사(승인·반려)·요청 정보. 5축은 꼬리표를 따로 두고 합치지 않는다.
  // 최근 본 항목(2026-11-18) — 서버 응답을 받은 뒤에만 남긴다
  // 최근 본 항목 이름은 화면 번호·종류(2026-11-19 — 시스템 ID 를 이름으로 남기던 것 고침, ADR-0070 덧붙임) — 승인은 번호가 없어 종류
  useRecordRecent('approval', approvalId, query.data ? (query.data.type ? `${m.approvals.typeName[query.data.type] ?? query.data.type} 승인 요청` : m.approvals.detailTitle) : null); // 요약에는 메일 같은 개인정보가 있을 수 있어 종류만
  return (
    <section className="max-w-7xl space-y-4" data-fetched-at={lastFetchedAt}>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(a) => {
          const open = OPEN_REVIEW.includes(a.reviewState ?? 'REVIEW_PENDING');
          // AP-3(approval 0.4.0, 2026-11-18): 서버가 "지금 이 사람이 결정할 수 있나"를 판정해 준다(viewerCanDecide·viewerDecideBlockedReason).
          // 값이 있으면 그것만 따르고, 없으면(옛 서버) 예전처럼 화면이 아는 두 경우(내 요청·내 권한 요청)만 안내한다.
          const serverSays = typeof a.viewerCanDecide === 'boolean';
          const blocked = a.viewerCanDecide === false ? (a.viewerDecideBlockedReason ?? null) : null;
          const own = serverSays ? blocked === 'SELF_APPROVAL' : session !== null && a.requesterId === session.subject;
          // approval-service 2026-11-17 "자기 자신은 안 됨"(백엔드 알림 hr-backoffice/2026-11-17-notice-self-action-rules §2): 권한을 받을 직원 = 나 → 승인·반려 모두 403. 판정은 서버, 화면은 버튼을 끄고 안내
          const grantToSelf = serverSays ? blocked === 'GRANT_TO_SELF' : session !== null && a.type === 'GRANT' && (a.lines ?? []).some((l) => grantEmployeeId(l.attributes) === session.subject);
          // 승인 역할이 없음·설정 없음 — 다른 승인자가 심사(서버 판정일 때만)
          const otherRole = blocked === 'NO_ROLE' || blocked === 'CONFIG_REQUIRED';
          const cannotDecide = serverSays ? a.viewerCanDecide === false : grantToSelf;
          const watching = watchCount !== null && isWatching(a);
          const updatesSinceDecision =
            (queryClient.getQueryState(['approval', 'detail', approvalId])?.dataUpdateCount ?? 0) - (watchCount ?? 0);
          const watchedOut = watching && updatesSinceDecision >= pollConfig.maxAttempts;
          return (
            <>
              <DetailHeader
                back={{ to: '/approvals', label: m.approvals.title }}
                // 제목(2026-11-18 사용자 "직관적이지 않다"): 서버 요약을 앞에, 승인 번호는 옆에 작게. 요약 줄 = 요청자·상신 시각
                title={
                  <>
                    {hideIds(a.summary) || m.approvals.detailTitle}
                  </>
                }
                badges={
                  <>
                    {a.type && (
                      <KindChip tone={TYPE_TONE[a.type] ?? 'ghost'}>
                        <CodeLabel code={a.type} names={TYPE_NAME} />
                      </KindChip>
                    )}
                    <StatusBadge tone={a.reviewState ? (REVIEW_TONE[a.reviewState] ?? 'ghost') : 'ghost'} testId="review-state">
                      {`${m.approvals.review} · ${a.reviewState ? m.approvals.reviewState[a.reviewState] : m.none}`}
                    </StatusBadge>
                    <StatusBadge tone={a.executionState ? (EXEC_TONE[a.executionState] ?? 'ghost') : 'ghost'} testId="execution-state">
                      {`${m.approvals.execution} · ${a.executionState ? m.approvals.executionState[a.executionState] : m.none}`}
                    </StatusBadge>
                  </>
                }
                summary={
                  <>
                    {`${m.approvals.requester} `}
                    <StaffName id={a.requesterId} />
                    {` · ${m.approvals.submittedAt} ${a.submittedAt ? formatSeoul(a.submittedAt) : m.none}`}
                  </>
                }
              />
              {/* 시스템 번호(ADR-0070 덧붙임 — 승인은 화면 번호가 없고 시스템 ID 는 상세에서만) */}
              {/* 보던 목록 순서대로 이전·다음(2026-11-19) */}
              <QueueNav kind="approval" id={approvalId} />
              <SystemNumbers ids={[{ label: m.approvals.detailTitle, id: approvalId }, { label: m.approvals.target, id: a.targetRef }]} />
              {/* 진행 단계(2026-11-18) — 요청·심사·결정·반영 */}
              <ApprovalProgress approval={a} />
              {/* 다음 할 일 — 심사 칸이 열린 서버 상태(REVIEW_PENDING·EVIDENCE_REQUIRED)일 때만. 내 요청·내 권한 요청은 버튼 없이 안내 */}
              {open &&
                (grantToSelf ? (
                  <NextAction tone="info" title={m.approvals.nextStep.grantSelfTitle} body={m.approvals.nextStep.grantSelfBody} />
                ) : otherRole ? (
                  <NextAction tone="info" title={m.approvals.nextStep.otherRoleTitle} body={blocked === 'CONFIG_REQUIRED' ? m.approvals.nextStep.configBody : m.approvals.nextStep.otherRoleBody} />
                ) : own ? (
                  <NextAction tone="info" title={m.approvals.nextStep.ownTitle} body={m.approvals.nextStep.ownBody} />
                ) : (
                  <NextAction tone="warning" title={m.approvals.nextStep.reviewTitle} body={m.approvals.nextStep.reviewBody}>
                    <a className="btn btn-sm btn-warning" href="#approval-decide">
                      {m.approvals.nextStep.reviewGo}
                    </a>
                  </NextAction>
                ))}

              {watching && !watchedOut && (
                <div role="status" className="relative overflow-hidden rounded-box bg-info/10 text-sm text-info" data-testid="execution-waiting">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <span className="loading loading-spinner loading-sm" />
                    {m.approvals.executionWaiting}
                  </div>
                  {/* 반영 중 흐르는 막대(2026-11-19) — 서버가 아직 반영 중일 때만. 끝나거나 기다림이 끝나면 이 상자째 사라진다 */}
                  <span className="flow-bar absolute inset-x-0 bottom-0 h-0.5 text-info" aria-hidden="true" data-testid="flow-bar" />
                </div>
              )}
              {watchedOut && (
                <div role="status" className="alert alert-info alert-soft">
                  <span>{m.approvals.executionTimeout}</span>
                  <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>
                    {m.checkAgain}
                  </button>
                </div>
              )}
              <CommandFeedback command={decide}>
                {() => (
                  <div role="status" className="alert alert-success alert-soft">
                    {m.approvals.decided}
                  </div>
                )}
              </CommandFeedback>

              <div className="grid items-start gap-4 lg:grid-cols-3">
                <div className="min-w-0 space-y-4 lg:col-span-2">
                  <Section title={m.approvals.lines} aside={<span className="text-base-content/55">{m.approvals.lineCount((a.lines ?? []).length)}</span>}>
                    <DataTable>
                      <thead>
                        <tr>
                          <th>{m.approvals.lineHead.key}</th>
                          <th className="text-right">{m.approvals.lineHead.qty}</th>
                          <th className="text-right">{m.approvals.lineHead.amount}</th>
                          <th>{m.approvals.lineHead.detail}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(a.lines ?? []).map((l, i) => (
                          <tr key={l.lineKey}>
                            {/* 항목 키가 시스템 ID(PD-… 초안 등)면 순번만 — 무엇인지는 오른쪽 내용 칸(상품명 등) */}
                            <td className="font-mono" title={l.lineKey}>{isSystemId(l.lineKey) || a.type === 'SEARCH_SYNONYM' ? String(i + 1) : l.lineKey}</td>
                            <td className="text-right tabular-nums" data-testid="line-qty">{lineQtyText(l)}</td>
                            <td className="text-right font-semibold tabular-nums" data-testid="line-amount">{lineAmountText(a.type, l)}</td>
                            <td className="space-y-1">
                              {/* 가격 일괄 등록 행(백엔드 안내 2026-11-03 §1-5): 승인자가 이전 → 새 가격·구분·상품명을 바로 본다 */}
                              <PriceLineAttributes attributes={l.attributes} />
                              {a.type === 'GRANT' && <GrantLineAttributes attributes={l.attributes} />}
                              {/* 검색 동의어 행(approval 0.5.0): 규칙 ID 대신 추가·고침·삭제 + 낱말(바꾸기 전 낱말이 있으면 같이) */}
                              {a.type === 'SEARCH_SYNONYM' && <SynonymLine attributes={l.attributes} />}
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
                              {l.attributes && (
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-base-content/50">{m.approvals.rawAttributes}</summary>
                                  <code className="mt-1 block break-all rounded bg-base-200 p-2">{JSON.stringify(l.attributes)}</code>
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </Section>

                  {(a.decisions?.length ?? 0) > 0 && (
                    <Section title={m.approvals.decisions}>
                      <Timeline
                        items={(a.decisions ?? []).map((d, i) => ({
                          key: d.decisionId ?? String(i),
                          tone: d.decision === 'APPROVE' ? 'success' : d.decision === 'REJECT' ? 'error' : 'neutral',
                          title: `${DECISION_NAME[d.decision ?? ''] ?? d.decision ?? m.none} · ${d.approverId ?? m.none}`,
                          meta: d.decidedAt ? formatSeoul(d.decidedAt) : m.none,
                          body: d.comment || undefined,
                        }))}
                      />
                    </Section>
                  )}
                  {(a.receipts?.length ?? 0) > 0 && (
                    <Section title={m.approvals.receipts}>
                      <Timeline
                        items={(a.receipts ?? []).map((r, i) => ({
                          key: r.receiptId ?? String(i),
                          tone: 'info',
                          title: (
                            <>
                              {r.receiverService ? <CodeLabel code={r.receiverService} names={m.systemName} /> : m.none}
                              {' · '}
                              {r.result ? <CodeLabel code={r.result} names={m.approvals.executionState} /> : m.none}
                            </>
                          ),
                          body: r.reason || undefined,
                        }))}
                      />
                    </Section>
                  )}
                </div>

                <aside className="min-w-0 space-y-4">
                  {open && (
                    <Section id="approval-decide" title={m.approvals.decideTitle}>
                      <div className="space-y-3">
                        {own && <p className="text-sm text-warning">{m.approvals.selfApproval}</p>}
                        {grantToSelf && (
                          <p role="note" className="text-sm text-warning" data-testid="grant-to-self">
                            {m.approvals.grantToSelf}
                          </p>
                        )}
                        {otherRole && (
                          <p role="note" className="text-sm text-warning" data-testid="decide-blocked">
                            {blocked === 'CONFIG_REQUIRED' ? m.approvals.nextStep.configBody : m.approvals.nextStep.otherRoleBody}
                          </p>
                        )}
                        <label className="floating-label block">
                          <span>{m.approvals.commentLabel}</span>
                          <textarea className="textarea textarea-sm w-full" rows={3} maxLength={1000} placeholder={m.approvals.commentLabel} value={comment} onChange={(e) => setComment(e.target.value)} />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={decide.busy || cannotDecide}
                            onClick={() => void decide.run({ decision: 'APPROVE', version: a.version })}
                          >
                            {m.approvals.approve}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline btn-error"
                            disabled={decide.busy || cannotDecide}
                            onClick={() => void decide.run({ decision: 'REJECT', version: a.version })}
                          >
                            {m.approvals.reject}
                          </button>
                        </div>
                      </div>
                    </Section>
                  )}
                  <Section title={m.approvals.requestInfo}>
                    <SideFields
                      rows={[
                        [m.approvals.type, a.type ? <CodeLabel key="y" code={a.type} names={TYPE_NAME} /> : m.none],
                        [
                          m.approvals.target,
                          // 대상 참조(productDraft:PD-… 등)는 아래 접힌 "시스템 번호"에만(2026-11-20, ADR-0070)
                          <span key="t">{a.targetService ? <CodeLabel code={a.targetService} names={m.systemName} /> : m.none}</span>,
                        ],
                        [m.approvals.requester, <Person key="r" id={a.requesterId} />],
                        [m.approvals.delivery, a.deliveryState ? <CodeLabel key="d" code={a.deliveryState} names={m.approvals.deliveryStateName} /> : m.none],
                        [m.approvals.submittedAt, <When key="s" iso={a.submittedAt} />],
                      ]}
                    />
                  </Section>
                </aside>
              </div>
            </>
          );
        }}
      </QueryState>
    </section>
  );
}

const TYPE_TONE: Readonly<Record<string, Tone>> = { PRODUCT: 'info', DISPLAY: 'accent', PRICE: 'warning', GRANT: 'neutral' };
/** 승인 유형 이름 — 거르기 칩 유형 + 그 밖 유형(표시만) */
const TYPE_NAME: Readonly<Record<string, string>> = { ...m.approvals.typeName, ...m.approvals.otherTypeName };
const REVIEW_TONE: Readonly<Record<string, Tone>> = { REVIEW_PENDING: 'warning', EVIDENCE_REQUIRED: 'warning', APPROVED: 'success', PARTIALLY_APPROVED: 'info', REJECTED: 'error' };
const EXEC_TONE: Readonly<Record<string, Tone>> = { VALIDATING: 'info', ACCEPTED: 'info', IN_PROGRESS: 'info', PARTIAL: 'warning', APPLIED: 'success', REJECTED: 'error', UNKNOWN_RESULT: 'warning' };
/** 결정 이력 표시 이름(승인·반려 버튼과 같은 말). 모르는 값은 그대로 */
const DECISION_NAME: Readonly<Record<string, string>> = { APPROVE: m.approvals.approve, REJECT: m.approvals.reject };

/** 검색 동의어 행 — op·terms·before(approval SEARCH_SYNONYM 설명) */
function SynonymLine({ attributes }: { readonly attributes: Readonly<Record<string, unknown>> | undefined }) {
  const words = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const op = attributes?.['op'];
  const terms = words(attributes?.['terms']);
  const before = words(attributes?.['before']);
  const kind = op === 'DELETE' ? m.synonyms.op.DELETE : before.length ? m.synonyms.op.EDIT : m.synonyms.op.ADD;
  return (
    <p className="text-sm" data-testid="synonym-line">
      <span className={`mr-2 font-medium ${op === 'DELETE' ? 'text-error' : 'text-primary'}`}>{kind}</span>
      {(op === 'DELETE' ? before : terms).join(', ')}
      {op !== 'DELETE' && before.length > 0 && <span className="ml-2 text-xs text-base-content/50">{m.synonyms.before(before.join(', '))}</span>}
    </p>
  );
}
