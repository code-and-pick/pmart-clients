// 반납 인증번호 — 센터 관리자(delivery-execution 0.28.0, 백엔드 회신 2026-11-18 reply-lists-and-roles 요청 3).
// - `GET /return-handovers?mfcId=<주소의 센터>`: 회수품을 받아 MFC 로 오는 중이거나 전달 실패로 돌아오는 배송과 4자리 번호(번호가 없으면 서버가 이때 만든다).
//   라이더가 MFC 에 오면 이 번호를 알려 주고, 라이더가 앱에 넣으면 반납이 끝난다(그러면 목록에서 빠진다). 30초마다 다시 읽는다.
// - 5번 틀리면 잠김 → `POST /return-handovers/{deliveryId}/code-reissues`(새 번호·틀린 횟수 0·잠김 풀림, 앞 번호는 더 안 맞음). 한 번 더 묻는다.
//   같은 Idempotency-Key 는 같은 결과, 409 = 반납을 기다리는 배송이 아님(이미 끝남). 결과 불명은 같은 키로 다시.
// - 번호는 화면에만 — 로그·주소·저장소에 남기지 않는다. 라이더는 ID 만 온다 — RiderLabel 이 화면의 라이더를 모아 rider display-names(0.18.0) 한 번으로 "김*수 · 482913"(ID 는 보이지 않음).
// - 현장 PDA(mfc_app 반납 인증번호 화면)와 같은 API·같은 번호다.
// - 아래 "도착한 회수품(반입 대기)": mfc-inbound 0.13.0 `GET /return-arrivals?mfcId=&state=WAITING`(백엔드 요청 clients/mfc-app/2026-11-19-request-return-arrivals —
//   백오피스는 보기만, 반입은 PDA). 종류·도착 시각·상품 × 수량·라이더 표기, 시스템 ID 없음(ADR-0070).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { DisplayNumber, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { GuideBox } from '../../shared/listParts';
import { messages } from '../../shared/messages';

const m = messages.returnHandovers;
const ex = messages.centerDelivery;
const sys = messages.displayNumber.system;
const REFRESH_MS = 30_000;

type ReturnHandover = components['schemas']['ReturnHandover'];

/** `/c/:mfcId/return-handovers` */
export function ReturnHandoversMenu({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['return-handovers', mfcId],
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/return-handovers', { params: { query: { mfcId } } })),
  });
  return (
    <section className="space-y-4">
      <h1>{m.title}</h1>
      <GuideBox title={messages.listParts.guideOf(messages.menus.returnHandovers)} storeKey="return-handovers" items={[m.intro]} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {m.refresh}
        </button>
        <span className="text-xs opacity-70">{m.autoRefreshNote}</span>
      </div>
      <QueryState state={toUiState(query, (r) => r.items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {r.items.map((h) => (
              <HandoverCard key={h.deliveryId} mfcId={mfcId} item={h} />
            ))}
          </ul>
        )}
      </QueryState>
      <ArrivalsSection mfcId={mfcId} />
    </section>
  );
}

function ArrivalsSection({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const a = m.arrivals;
  const query = useQuery({
    queryKey: ['return-arrivals', mfcId],
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.inbound.GET('/return-arrivals', { params: { query: { mfcId, state: 'WAITING' } } })),
  });
  return (
    <section className="space-y-2" data-testid="return-arrivals">
      <h2 className="text-lg font-semibold">
        {a.title}
        {query.data ? <span className="badge badge-neutral ml-2">{a.count(query.data.items.length)}</span> : null}
      </h2>
      <p className="text-sm opacity-80">{a.intro}</p>
      <QueryState state={toUiState(query, (r) => r.items.length === 0)} onRetry={() => void query.refetch()} emptyText={a.empty}>
        {(r) => (
          <ul className="grid gap-2 md:grid-cols-2">
            {r.items.map((x) => (
              <li key={x.arrivalId} className="rounded-box border border-base-300 p-3" data-testid="return-arrival">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{m.purpose[x.purpose] ?? m.purposeOther}</span>
                  <span className="text-sm">{a.arrivedAt(formatSeoul(x.arrivedAt))}</span>
                </div>
                <ul className="mt-1 text-sm">
                  {x.lines.map((l, i) => (
                    <li key={`${l.sku ?? ''}-${i}`}>{a.line(l.productName ?? l.sku ?? messages.none, l.qty)}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">
                  {`${m.col.rider} `}
                  {x.riderId ? <RiderLabel riderId={x.riderId} /> : messages.none}
                </p>
                {!x.claimId && <p className="mt-1 text-xs text-warning">{a.noClaim}</p>}
                <SystemNumbers
                  ids={[
                    { label: sys.orderId, id: x.orderId },
                    { label: sys.deliveryId, id: x.originDeliveryId },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

function HandoverCard({ mfcId, item }: { readonly mfcId: string; readonly item: ReturnHandover }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const reissue = useCommand(async (_: void, key) => {
    const r = await request(
      'POST',
      api.execution.POST('/return-handovers/{deliveryId}/code-reissues', { ...commandParams(key, { path: { deliveryId: item.deliveryId } }) }),
    );
    await queryClient.invalidateQueries({ queryKey: ['return-handovers', mfcId] });
    return r;
  });
  const send = () => {
    setConfirming(false);
    if (reissue.phase.kind === 'rejected' || reissue.phase.kind === 'done') reissue.reset();
    void reissue.run();
  };
  const purpose = item.purpose ? (m.purpose[item.purpose] ?? m.purposeOther) : m.purposeOther;
  return (
    <li className={`space-y-2 rounded-box border bg-base-100 p-4 text-sm ${item.locked ? 'border-error' : 'border-base-300'}`} data-testid="return-handover">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          <DisplayNumber number={item.deliveryNumber} systemId={item.deliveryId} />
        </span>
        <span className="badge badge-sm">{purpose}</span>
        <span className="text-xs opacity-70">{ex.executionState[item.state] ?? item.state}</span>
      </div>
      <p
        className={`font-mono text-4xl font-bold tracking-[0.4em] ${item.locked ? 'text-base-content/40 line-through' : ''}`}
        aria-label={m.codeAria(item.code)}
        data-testid="return-code"
      >
        {item.code}
      </p>
      {item.locked ? (
        <p role="alert" className="font-semibold text-error">
          {m.locked}
        </p>
      ) : (
        item.failedAttempts > 0 && <p className="text-warning">{m.failedAttempts(item.failedAttempts)}</p>
      )}
      <p className="text-xs opacity-70">
        {`${m.col.rider} `}
        {item.riderId ? <RiderLabel riderId={item.riderId} /> : messages.none}
        {` · ${m.col.issuedAt} ${formatSeoul(item.issuedAt)}`}
      </p>
      {confirming ? (
        <div role="alertdialog" aria-label={m.confirmTitle} className="space-y-1 rounded-box bg-base-200 p-2">
          <p className="font-semibold">{m.confirmTitle}</p>
          <p>{m.confirmBody}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-xs btn-primary" onClick={send}>
              {m.confirmOk}
            </button>
            <button type="button" className="btn btn-xs" onClick={() => setConfirming(false)}>
              {m.confirmCancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`btn btn-sm ${item.locked ? 'btn-error' : ''}`}
          disabled={reissue.busy || reissue.phase.kind === 'unknown'}
          onClick={() => setConfirming(true)}
        >
          {item.locked ? m.reissueUnlock : m.reissue}
        </button>
      )}
      <CommandFeedback command={reissue}>{(r) => <p role="status">{m.done(r.code)}</p>}</CommandFeedback>
      <SystemNumbers ids={[{ label: sys.deliveryId, id: item.deliveryId }]} />
    </li>
  );
}
