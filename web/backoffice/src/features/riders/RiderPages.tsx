// 라이더 상세(보기만) — 2026-11-18 라이더 운영 묶음을 라이더 백오피스로 옮김(ADR-0068, 사용자 지적 "같은 이름 메뉴가 두 앱에",
// 백엔드 백오피스 세션 알림 — 라이더 백오피스 PR #115 병합 뒤).
// - 라이더 찾기·계정 제한 걸기/풀기·제한 검토는 라이더 백오피스에서 한다(이 화면은 안내 + 그 앱의 같은 라이더 상세로 가는 링크).
// - 남긴 것: 기본 정보(rider 0.4.0 `GET /riders/{id}`, 이름·전화는 가린 값), 개인정보 보기(`POST /riders/{id}/pii-reveals` — 서버가
//   CS_AGENT·RIDER_OPS·OPERATOR_ADMIN 허용, 사유 2~200자, 열람 기록이 남은 뒤에만 원문, 기록 실패 503), 이 라이더의 배송
//   (execution `GET /deliveries?riderId=`), 컴플레인.
// - 배송·컴플레인·접수 건·라이더 문의·열람 기록 화면이 이 주소(/riders/:riderId)로 연결한다.
// 전화번호·이름은 개인정보 — 기본 가림, 로그 금지.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, staffAppUrl, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { Facts, label, text, when } from '../../shared/ops';
import { DeliveriesOf } from '../deliveries/DeliveryPages';
import { RiderComplaintTable } from '../riderComplaints/RiderComplaintPages';
import { Notice, PageHeader } from '../../shared/admin';

type PiiField = components['schemas']['RiderPiiField'];
type StaffRiderDetail = components['schemas']['StaffRiderDetail'];

const PII_FIELDS: readonly PiiField[] = ['NAME', 'PHONE'];

/**
 * 기본 정보(rider 0.4.0 `GET /riders/{id}`): 이름·전화는 서버가 가린 값. 원문은 사유 + `POST …/pii-reveals`(열람 기록이 남은 뒤 고른 항목만).
 * 받은 원문은 이 컴포넌트 메모리에만(저장·로그 없음) — "다시 가리기"·화면 이동이면 사라진다. 503·결과 불명은 같은 키 재전송.
 */
function RiderBasic({ rider }: { readonly rider: StaffRiderDetail }) {
  const api = useApi();
  const [fields, setFields] = useState<readonly PiiField[]>(PII_FIELDS);
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (v: { reason: string; fields: readonly PiiField[] }, key) =>
    request('POST', api.riders.POST('/riders/{riderId}/pii-reveals', { ...commandParams(key, { path: { riderId: rider.riderId ?? '' } }), body: { reason: v.reason, fields: [...v.fields] } })),
  );
  const opened = reveal.phase.kind === 'done' ? reveal.phase.result : null;
  const isOpen = (f: PiiField) => opened?.fields?.includes(f) ?? false;
  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 200;
  const op = rider.operating;
  return (
    <>
      <p className="text-xs opacity-60">{m.riders.pii.note}</p>
      <Facts
        testId="rider-basic"
        rows={[
          [m.riders.name, <span key="n" data-testid="rider-name" data-masked={!isOpen('NAME')}>{isOpen('NAME') ? text(opened?.name) : text(rider.nameMasked)}</span>],
          [m.orders.phone, <span key="p" data-testid="rider-phone" data-masked={!isOpen('PHONE')}>{isOpen('PHONE') ? text(opened?.phone) : text(rider.phoneMasked)}</span>],
          [m.riders.vehicle, label(m.riders.vehicleName, rider.vehicleType)],
          [m.riders.operating, `${label(m.riders.operatingName, op?.status)}${op?.mfcId ? ` · ${op.mfcId}` : ''}`],
          [m.riders.newDispatch, op?.newDispatchEnabled === undefined ? m.none : op.newDispatchEnabled ? 'O' : 'X'],
          [m.riders.activeDeliveries, text(op?.activeDeliveryCount)],
          [m.riders.areas, (rider.deliveryAreas ?? []).map((a) => `${a.mfcId ?? ''}${a.zoneId ? `/${a.zoneId}` : ''}`).join(', ') || m.none],
          [m.riders.dispatchMode, label(m.riders.dispatchModeName, rider.settings?.dispatchMode)],
          [m.riders.restriction, `${label(m.riders.restrictionName, rider.restriction?.state)}${rider.restriction?.until ? ` ~ ${when(rider.restriction.until)}` : ''}`],
          [m.riders.lastHeartbeat, when(rider.lastHeartbeatAt)],
          [m.riders.joinedAt, when(rider.joinedAt)],
        ]}
      />
      {opened ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{m.riders.pii.opened(text(opened.piiAccessLogId), when(opened.recordedAt))}</span>
          <button type="button" className="btn btn-xs" onClick={() => reveal.reset()}>
            {m.riders.pii.hide}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm"
          aria-label={m.riders.pii.title}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonOk || fields.length === 0) return;
            if (reveal.phase.kind === 'rejected') reveal.reset();
            void reveal.run({ reason: reason.trim(), fields });
          }}
        >
          <h3 className="font-semibold">{m.riders.pii.title}</h3>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="text-xs text-base-content/60">{m.riders.pii.fields}</legend>
            {PII_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={fields.includes(f)}
                  onChange={(e) => setFields((cur) => (e.target.checked ? PII_FIELDS.filter((x) => x === f || cur.includes(x)) : cur.filter((x) => x !== f)))}
                />
                {m.riders.pii.fieldName[f]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            {m.riders.pii.reason}
            <input className="input input-sm w-full max-w-md" maxLength={200} autoComplete="off" placeholder={m.riders.pii.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm" disabled={!reasonOk || fields.length === 0 || reveal.busy}>
            {m.riders.pii.open}
          </button>
          <CommandFeedback command={reveal} />
        </form>
      )}
    </>
  );
}

/** 라이더 백오피스의 같은 라이더 상세(지금 페이지 호스트 기준 — 앱 바꾸기와 같은 주소 규칙) */
const riderOpsUrl = (riderId: string) => `${staffAppUrl('rider-backoffice', globalThis.location)}riders/${encodeURIComponent(riderId)}`;

export function RiderDetailPage() {
  const { riderId = '' } = useParams();
  const api = useApi();
  const detail = useQuery({
    queryKey: ['riders', 'detail', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}', { params: { path: { riderId } } })),
  });
  return (
    <section className="max-w-5xl space-y-4">
      <PageHeader title={`${m.riders.detailTitle} ${riderId}`} />
      <Notice>
        <span data-testid="rider-ops-moved">{m.riders.moved}</span>{' '}
        <a className="link" href={riderOpsUrl(riderId)}>
          {m.riders.openInRiderOps}
        </a>
      </Notice>
      <h2 className="font-bold">{m.riders.basic}</h2>
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(r) => <RiderBasic key={r.riderId} rider={r} />}
      </QueryState>
      <h2 className="font-bold">{m.riders.deliveries}</h2>
      <DeliveriesOf riderId={riderId} />
      <h2 className="font-bold">{m.riders.complaints}</h2>
      <RiderComplaintTable riderId={riderId} />
    </section>
  );
}

/** 옛 주소(/riders 찾기·/riders/restriction-reviews 제한 검토) — 북마크로 들어오면 라이더 백오피스로 안내 */
export function RiderOpsMovedPage({ path }: { readonly path: 'riders' | 'restriction-reviews' }) {
  return (
    <section className="max-w-3xl space-y-4" data-testid="rider-ops-moved-page">
      <PageHeader title={m.riders.movedTitle} />
      <Notice>{m.riders.moved}</Notice>
      <a className="btn btn-primary btn-sm" href={`${staffAppUrl('rider-backoffice', globalThis.location)}${path}`}>
        {m.riders.openRiderOps}
      </a>
    </section>
  );
}
