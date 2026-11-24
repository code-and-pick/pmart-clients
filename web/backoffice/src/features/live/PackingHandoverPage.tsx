// 포장 인계 현황(bff 0.11.0 `GET /backoffice/views/packing-handover` — 백엔드 요청 all/2026-11-17-request-packing-handover, 배송 원문 §10.1·§3.1·§3.4·§3.7).
// 본사 역할(OPERATOR_ADMIN·CS_AGENT·RIDER_OPS) — 센터 필수(비우면 400). 센터 관리자 화면(mfc-backoffice)은 PC 3.
// - 단계(stage)는 bff 가 정한다 — 화면에서 다시 계산하지 않는다. null 이면 "—" + 원천 값(출고·피킹·패킹 상태)을 작게.
//   PACKING 인데 패킹이 아직 시작 전(WAITING·READY·ASSIGNED·없음)이면 "패킹 대기", BLOCKED 면 막힌 이유(백엔드 알림 — 사용자 "(가)", bff 0.11.1 #140).
// - 수량은 "포장 N · 인계 M · 남음 K"(§3.7). 펼치면 포장별 상태·인계 허가·스캔·인계 시각·받은 라이더.
// - 화면 번호(bff 0.14.0, ADR-0070): 주문 orderNumber·배송 deliveryNumber·라이더(가린 이름 + 번호, 배정 라이더 rider·포장 받은 라이더 packages[].rider).
//   링크는 시스템 ID 로. 번호가 null 이면 ID 끝 8자리 회색 + "번호 없음", rider-service 실패면 라이더 "번호 확인 불가".
// - unavailableSources: mfc-fulfillment-service = 목록 전체를 못 읽음(0건 아님), delivery-execution-service = 배송 칸만 "—".
// - 새로고침은 30초(한 번 부를 때 MFC 1회 + 출고 수만큼 배송 조회 — 백엔드 권고). 개인정보·QR 없음.
import { blockReasonLabel } from '../../shared/blockReason';
import { SearchSelect } from '../../shared/SearchSelect';
import { useNewIds } from '../../shared/motion';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, uiStateFromError, type UiState } from '@pmart/web-ui';
import type { operations } from '../../api/generated/backoffice-bff';
import { useCenterScope, useScopeCenters, useSetCenterScope } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { CodeLabel, DataTable, NextAction, PageHeader, StatusBadge } from '../../shared/admin';
import { executionTone } from '../deliveries/DeliveryPages';
import { EmptyBox, Icon, KindChip, Kpi, UnderlineTabs } from '../lookup/parts';
import { DisplayNumber, RiderLabel, riderSourceFailed } from '../../shared/displayNumber';

const m = messages.packing;
type View = operations['getPackingHandoverView']['responses'][200]['content']['application/json'];
type Item = NonNullable<View['items']>[number];

const MFC = 'mfc-fulfillment-service';
const DELIVERY = 'delivery-execution-service';
const REFRESH_MS = 30_000;
const STATES = ['PREPARING', 'READY', 'PARTIALLY_HANDED_OVER', 'HANDED_OVER', 'CANCELLED', 'CLOSED_PARTIAL'] as const;
const PACK_NOT_STARTED = ['WAITING', 'READY', 'ASSIGNED'];

/** 막힌 출고 — 숫자 카드·다음 할 일·단계 칸이 같은 판정(서버 원천 값 BLOCKED)을 쓴다 */
const isBlocked = (it: Item) => (it.stage === 'PACKING' && it.pack?.state === 'BLOCKED') || it.pick?.state === 'BLOCKED';

/** 원천 상태 하나 — 한국어 이름, 코드는 마우스를 올리면. 없으면 "-" */
const Code = ({ code, names }: { readonly code: string | null | undefined; readonly names: Readonly<Record<string, string>> }) => (code ? <CodeLabel code={code} names={names} /> : <>{messages.none}</>);

/** 단계 칸 — bff 단계 그대로, "패킹 대기"·막힘·null 만 원천 값으로 거든다 */
function StageCell({ it }: { readonly it: Item }) {
  const packState = it.pack?.state ?? null;
  if (!it.stage)
    return (
      <span data-testid="packing-stage">
        {messages.none}
        {/* 규칙에 없는 조합 — 출고·피킹·패킹 원천 상태를 이름으로(2026-11-18 "직관적이지 않다") */}
        <span className="block text-xs text-base-content/60">
          {`${m.shipmentLabel} `}
          <Code code={it.shipment?.state} names={m.stateName} />
          {` · ${m.pick} `}
          <Code code={it.pick?.state} names={m.taskStateName} />
          {` · ${m.pack} `}
          <Code code={packState} names={m.taskStateName} />
        </span>
      </span>
    );
  const waiting = it.stage === 'PACKING' && (packState === null || PACK_NOT_STARTED.includes(packState));
  const blocked = isBlocked(it);
  const reason = it.pack?.blockReason ?? it.pick?.blockReason ?? null;
  return (
    <span data-testid="packing-stage">
      <span className={`badge badge-sm ${it.stage === 'HANDED_OVER' ? 'badge-success' : it.stage === 'READY_FOR_HANDOVER' ? 'badge-info' : 'badge-ghost'}`}>
        {waiting ? m.packWaiting : label(m.stageName, it.stage)}
      </span>
      {blocked && <span className="block text-xs font-bold text-error">{m.blocked(reason ? blockReasonLabel(reason) : text(reason))}</span>}
    </span>
  );
}

function Packages({ it, riderFailed }: { readonly it: Item; readonly riderFailed: boolean }) {
  const [open, setOpen] = useState(false);
  const list = it.packages ?? [];
  if (list.length === 0) return null;
  return (
    <div>
      <button type="button" className="btn btn-ghost btn-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? m.hidePackages : m.showPackages(list.length)}
      </button>
      {open && (
        <ul className="space-y-0.5 text-xs" data-testid="packing-packages">
          {list.map((p, n) => (
            <li key={p.packageId ?? n}>
              {/* 포장 라벨 6자리(bff 0.21.0 handoverCode — "305118 인계"), 원천이 아직 안 주면 "포장 n" — 시스템 ID(packageId)는 보이지 않는다(ADR-0070) */}
              <span className="font-mono font-semibold" data-testid="package-label">{p.handoverCode ? m.packageLabel(p.handoverCode) : m.packageNth(n + 1)}</span>
              {' · '}
              <Code code={p.state} names={m.packageStateName} />
              {` · ${m.fence} `}
              <Code code={p.fenceState} names={m.fenceStateName} />
              {` · ${m.scanned} ${when(p.handoverAuthorizedAt)} · ${m.handedOver} ${when(p.handedOverAt)} · ${m.rider} `}
              {p.rider?.riderId || p.riderId ? <RiderLabel rider={p.rider} riderId={p.riderId} failed={riderFailed} /> : messages.none}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PackingHandoverPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  // 센터(2026-11-23): 주소의 mfcId 가 먼저, 없으면 머리줄에서 고른 센터. 이 화면 센터 칸은 머리줄 센터 고르기와 같은 것
  const scope = useCenterScope();
  const setScope = useSetCenterScope();
  const urlMfc = params.get('mfcId') ?? '';
  const mfcId = urlMfc || scope;
  const state = STATES.find((s) => s === params.get('state')) ?? '';
  const set = (next: { mfcId?: string; state?: string }) => {
    const merged = { mfcId: urlMfc, state, ...next };
    setParams({ ...(merged.mfcId ? { mfcId: merged.mfcId } : {}), ...(merged.state ? { state: merged.state } : {}) });
  };
  // 머리줄 센터 고르기와 같은 목록 — 운영 중(ACTIVE) MFC 만(2026-11-24 사용자 "고를 수 있는 센터 수가 다른 이유" — 전에는 준비 중 센터까지)
  const centers = useScopeCenters();
  const query = useInfiniteQuery({
    queryKey: ['bff', 'packing-handover', mfcId, state],
    enabled: mfcId !== '', // 본사 역할은 센터 필수(비우면 400)
    refetchInterval: REFRESH_MS,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.bff.GET('/views/packing-handover', {
          params: { query: { mfcId, ...(state ? { state: [state] } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const first = query.data?.pages[0];
  const failed = new Set(first?.unavailableSources ?? []);
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 새로 들어온 포장 줄 — 5초 동안 강조(2026-11-19). 거르기·더 보기(쪽 수)가 바뀌면 다시 센다
  const fresh = useNewIds(query.data ? items.flatMap((it) => (it.shipmentId ? [it.shipmentId] : [])) : undefined, `${params.toString()}|${query.data?.pages.length ?? 0}`);
  const deliveryFailed = failed.has(DELIVERY);
  const riderFailed = riderSourceFailed(first?.unavailableSources);
  const pageState: UiState<View> = first
    ? failed.has(MFC) || items.length > 0
      ? { kind: 'ready', data: first }
      : { kind: 'empty' }
    : query.isPending
      ? { kind: 'loading' }
      : uiStateFromError(query.error);

  // 화면(2026-11-18): 머리(새로 고침) → 센터 고르기 → 숫자 카드(읽은 줄의 서버 단계를 센 값) → 한 카드(출고 상태 탭 → 표 → 더 보기)
  const mfcOk = !!first && !failed.has(MFC);
  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        actions={
          <>
            <span className={`h-2 w-2 rounded-full ${query.isFetching ? 'animate-pulse bg-info' : 'bg-success'}`} title={m.refreshNote} aria-label={m.refreshNote} role="img" />
            <button type="button" className="btn btn-sm" disabled={!mfcId || query.isFetching} onClick={() => void query.refetch()}>
              {m.refresh}
            </button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 text-sm shadow-sm" role="group" aria-label={m.filters}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <Icon name="store" className="h-4 w-4" />
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-base-content/55">{m.center}</span>
          {/* 쳐서 찾는 고르기(2026-11-19) */}
          <SearchSelect label={m.center} className="w-full sm:w-64" value={mfcId} placeholder={m.pickCenter} options={(centers.data ?? []).flatMap((c) => (c.centerId ? [{ value: c.centerId, label: c.name ?? c.centerId, hint: c.centerId, keywords: c.centerId }] : []))} loading={centers.isPending} onChange={(v) => { setScope(v); set({ mfcId: '' }); }} />
        </div>
        {centers.isError && <p className="text-xs text-warning">{m.centersFailed}</p>}
      </div>

      {!mfcId ? (
        <EmptyBox icon="store" testId="packing-pick-center">
          {m.pickCenterFirst}
        </EmptyBox>
      ) : (
        <>
          {mfcOk && <PackingKpis items={items} />}
          {/* 다음 할 일 — 읽어 온 줄에 막힌 출고가 있으면 첫 막힌 줄로(이 화면은 조회만, 조치는 센터) */}
          {mfcOk && items.some(isBlocked) && (
            <NextAction tone="error" title={m.nextStep.blockedTitle(items.filter(isBlocked).length)} body={m.nextStep.blockedBody}>
              <a className="btn btn-sm" href="#packing-first-blocked">
                {m.nextStep.blockedGo}
              </a>
            </NextAction>
          )}
          <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
            <UnderlineTabs
              label={m.state}
              value={state}
              options={[{ value: '', label: m.openOnly }, ...STATES.map((s) => ({ value: s, label: m.stateName[s] ?? s }))]}
              onChange={(v) => set({ state: v })}
            />
            <div className="p-3">
              <QueryState
                // 다음 쪽 실패는 받은 줄을 가리지 않는다. MFC 원천을 못 읽었으면 0건이 아니라 실패.
                state={pageState}
                onRetry={() => void query.refetch()}
                emptyText={m.empty}
              >
                {(view) => (
                  <div className="space-y-3">
                    <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
                    {failed.has(MFC) ? (
                      <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="packing-mfc-failed">
                        {m.mfcFailed}
                      </p>
                    ) : (
                      <DataTable>
                        <thead>
                          <tr>
                            <th>{m.col.order}</th>
                            <th>{m.col.stage}</th>
                            <th>{m.col.work}</th>
                            <th>{m.col.qty}</th>
                            <th>{m.col.times}</th>
                            <th>{m.col.delivery}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.shipmentId} data-testid="packing-row" id={it === items.find(isBlocked) ? 'packing-first-blocked' : undefined} className={`scroll-mt-12 ${it.shipmentId && fresh.has(it.shipmentId) ? 'row-new' : ''}`} data-new={it.shipmentId && fresh.has(it.shipmentId) ? 'true' : undefined}>
                              {/* 첫 칸: 주문번호 굵게 + 출고 ID 작게 */}
                              <td>
                                {it.orderId ? (
                                  <Link className="font-mono font-semibold text-base-content hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(it.orderId)}`}>
                                    <DisplayNumber number={it.orderNumber} systemId={it.orderId} />
                                  </Link>
                                ) : (
                                  <DisplayNumber number={it.orderNumber} />
                                )}
                                {it.workOrderKind === 'RESHIPMENT' && (
                                  <span className="ml-1.5">
                                    <KindChip tone="warning" icon="return">
                                      {m.reshipment}
                                    </KindChip>
                                  </span>
                                )}
                              </td>
                              <td>
                                <StageCell it={it} />
                                <StageSteps stage={it.stage ?? null} />
                              </td>
                              <td className="text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-8 text-base-content/50">{m.pick}</span>
                                  <span className="font-medium">{it.pick?.state ? <CodeLabel code={it.pick.state} names={m.taskStateName} /> : messages.none}</span>
                                </div>
                                {it.pick?.startedAt && <div className="pl-9.5 text-base-content/45">{when(it.pick.startedAt)}</div>}
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className="w-8 text-base-content/50">{m.pack}</span>
                                  <span className="font-medium">{it.pack?.state ? <CodeLabel code={it.pack.state} names={m.taskStateName} /> : messages.none}</span>
                                </div>
                                {it.pack?.startedAt && <div className="pl-9.5 text-base-content/45">{when(it.pack.startedAt)}</div>}
                              </td>
                              <td data-testid="packing-qty">
                                <span className="font-medium">{m.qty(text(it.packageCount), text(it.handedOverQty?.qty), text(it.remainingPackages))}</span>
                                <Packages it={it} riderFailed={riderFailed} />
                              </td>
                              <td className="text-xs">
                                <div>
                                  <span className="text-base-content/50">{`${m.readyAt} `}</span>
                                  {when(it.readyAt)}
                                </div>
                                <div>
                                  <span className="text-base-content/50">{`${m.dispatchRequestedAt} `}</span>
                                  {when(it.dispatchRequestedAt)}
                                </div>
                              </td>
                              <td className="text-xs" data-testid="packing-delivery">
                                {deliveryFailed || it.delivery?.source?.confidence === 'UNKNOWN' ? (
                                  <span className="text-warning">{messages.none}</span>
                                ) : it.deliveryId ? (
                                  <span className="flex flex-col items-start gap-1">
                                    <Link className="font-mono font-medium text-primary hover:underline" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                                      <DisplayNumber number={it.deliveryNumber} systemId={it.deliveryId} />
                                    </Link>
                                    <StatusBadge tone={executionTone(it.delivery?.state)}>{it.delivery?.state ? <CodeLabel code={it.delivery.state} names={messages.deliveries.executionState} /> : messages.none}</StatusBadge>
                                    <span className="text-base-content/60">
                                      {`${m.rider} `}
                                      {it.rider?.riderId || it.riderId ? <RiderLabel rider={it.rider} riderId={it.riderId} failed={riderFailed} /> : messages.none}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="opacity-70">{m.noDelivery}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </DataTable>
                    )}
                    {query.isFetchNextPageError && <p className="text-sm text-error">{m.moreFailed}</p>}
                    {query.hasNextPage && !failed.has(MFC) && (
                      <div className="flex justify-center">
                        <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                          {messages.more}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </QueryState>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** 서버 단계 순서(그림용) — 단계 값은 bff 가 정한 것을 그대로 쓴다 */
const STAGE_ORDER = ['REQUESTED', 'PICKING', 'PACKING', 'READY_FOR_HANDOVER', 'HANDED_OVER'] as const;

/** 단계 점 줄(출고요청 → 피킹 → 패킹 → 출고대기 → 인계) — 지금 단계까지 칠한다. 단계가 없으면 그리지 않는다 */
function StageSteps({ stage }: { readonly stage: string | null }) {
  const at = stage === 'PARTIALLY_HANDED_OVER' ? 3 : STAGE_ORDER.findIndex((s) => s === stage);
  if (at < 0) return null;
  return (
    <span className="mt-1.5 flex items-center gap-1" aria-hidden="true">
      {STAGE_ORDER.map((s, i) => (
        <span key={s} className={`h-1.5 w-5 rounded-full ${i <= at ? (stage === 'HANDED_OVER' ? 'bg-success' : 'bg-primary') : 'bg-base-300'}`} />
      ))}
    </span>
  );
}

/** 숫자 카드 — 읽어 온 줄의 서버 단계를 센 값(전체 건수 아님). 센터 출고를 못 읽었으면 그리지 않는다 */
function PackingKpis({ items }: { readonly items: readonly Item[] }) {
  const count = (f: (it: Item) => boolean) => items.filter(f).length;
  const ready = count((it) => it.stage === 'READY_FOR_HANDOVER');
  const blocked = count(isBlocked);
  const handed = count((it) => it.stage === 'HANDED_OVER');
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="packing-kpis">
      <Kpi icon="box" label={m.kpi.shown} value={items.length} hint={m.kpi.shownHint} />
      <Kpi icon="clock" tone={ready > 0 ? 'info' : undefined} label={m.kpi.ready} value={ready} />
      <Kpi icon="alert" tone={blocked > 0 ? 'error' : undefined} label={m.kpi.blocked} value={blocked} />
      <Kpi icon="check" tone={handed > 0 ? 'success' : undefined} label={m.kpi.handed} value={handed} />
    </div>
  );
}
