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
import { SystemNumbers } from '../../shared/displayNumber';
import { label, text, when } from '../../shared/ops';
import { DeliveriesOf } from '../deliveries/DeliveryPages';
import { RiderPerformance } from '../deliveryStats/DeliveryStatsPage';
import { RiderComplaintTable } from '../riderComplaints/RiderComplaintPages';
import { RESTRICTION_TONE } from './RiderCard';
import { CodeLabel, FieldList, Notice, PageHeader, Section, StatusBadge } from '../../shared/admin';
import { CenterName } from '../../shared/centerScope';

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
    // 보기 전용 상세 카드(2026-11-18): 왼쪽 = 기본 정보, 오른쪽 = 지금 상태 요약 + 원문 열람
    <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      <div className="min-w-0 lg:col-span-2">
        <Section title={m.riders.basic} aside={<span className="text-xs text-base-content/55">{m.riders.pii.note}</span>}>
          <FieldList
            testId="rider-basic"
            rows={[
              [m.riders.name, <span key="n" data-testid="rider-name" data-masked={!isOpen('NAME')}>{isOpen('NAME') ? text(opened?.name) : text(rider.nameMasked)}</span>],
              [m.orders.phone, <span key="p" className="font-mono" data-testid="rider-phone" data-masked={!isOpen('PHONE')}>{isOpen('PHONE') ? text(opened?.phone) : text(rider.phoneMasked)}</span>],
              [m.riders.vehicle, rider.vehicleType ? <CodeLabel key="v" code={rider.vehicleType} names={m.riders.vehicleName} /> : m.none],
              [m.riders.operating, <span key="op">{label(m.riders.operatingName, op?.status)}{op?.mfcId ? <> · <CenterName id={op.mfcId} /></> : null}</span>],
              [m.riders.newDispatch, op?.newDispatchEnabled === undefined ? m.none : op.newDispatchEnabled ? m.riders.newDispatchOn : m.riders.newDispatchOff],
              [m.riders.activeDeliveries, text(op?.activeDeliveryCount)],
              [m.riders.areas, (rider.deliveryAreas ?? []).length > 0 ? <span key="a">{(rider.deliveryAreas ?? []).map((a, i) => <span key={i}>{i > 0 ? ', ' : ''}<CenterName id={a.mfcId} />{a.zoneId ? ` · ${a.zoneId}` : ''}</span>)}</span> : m.none],
              [m.riders.dispatchMode, rider.settings?.dispatchMode ? <CodeLabel key="d" code={rider.settings.dispatchMode} names={m.riders.dispatchModeName} /> : m.none],
              [m.riders.restriction, `${label(m.riders.restrictionName, rider.restriction?.state)}${rider.restriction?.until ? ` ~ ${when(rider.restriction.until)}` : ''}`],
              [m.riders.lastHeartbeat, when(rider.lastHeartbeatAt)],
              [m.riders.joinedAt, when(rider.joinedAt)],
            ]}
          />
        </Section>
      </div>

      <aside className="min-w-0 space-y-4">
        {/* 지금 상태 — 서버 값 그대로(제한·운행 이름표가 있을 때만 색) */}
        <div className="rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <p className="text-xs text-base-content/55">{m.riders.statusNow}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rider.restriction?.state && m.riders.restrictionName[rider.restriction.state] ? (
              <StatusBadge tone={RESTRICTION_TONE[rider.restriction.state] ?? 'ghost'}>
                <CodeLabel code={rider.restriction.state} names={m.riders.restrictionName} />
              </StatusBadge>
            ) : null}
            {op?.status && m.riders.operatingName[op.status] ? <StatusBadge tone={op.status === 'ON_DUTY' ? 'success' : 'ghost'}>
                <CodeLabel code={op.status} names={m.riders.operatingName} />
              </StatusBadge> : null}
          </div>
          <p className="mt-3 text-xs text-base-content/55">{m.riders.activeDeliveries}</p>
          <p className="text-2xl font-bold">{text(op?.activeDeliveryCount)}</p>
        </div>

        {opened ? (
          <div role="status" className="space-y-2 rounded-box border border-warning/40 bg-warning/5 p-4 text-xs">
            <p>{m.riders.pii.opened(text(opened.piiAccessLogId), when(opened.recordedAt))}</p>
            <button type="button" className="btn btn-xs" onClick={() => reveal.reset()}>
              {m.riders.pii.hide}
            </button>
          </div>
        ) : (
          <form
            className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-sm"
            aria-label={m.riders.pii.title}
            onSubmit={(e) => {
              e.preventDefault();
              if (!reasonOk || fields.length === 0) return;
              if (reveal.phase.kind === 'rejected') reveal.reset();
              void reveal.run({ reason: reason.trim(), fields });
            }}
          >
            <h3 className="flex items-center gap-2 font-semibold">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current text-warning" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              </svg>
              {m.riders.pii.title}
            </h3>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs text-base-content/60">{m.riders.pii.fields}</legend>
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
            <label className="flex flex-col gap-1 text-xs text-base-content/60">
              {m.riders.pii.reason}
              <input className="input input-sm w-full" maxLength={200} autoComplete="off" placeholder={m.riders.pii.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-sm btn-warning btn-outline w-full" disabled={!reasonOk || fields.length === 0 || reveal.busy}>
              {m.riders.pii.open}
            </button>
            <CommandFeedback command={reveal} />
          </form>
        )}
      </aside>
    </div>
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
    <section className="space-y-4">
      <PageHeader
        // 제목은 (서버가 가린) 이름 먼저, 번호는 작게(2026-11-18 "제목이 번호뿐") — 원문 이름은 제목에 쓰지 않는다
        title={
          <>
            {detail.data?.nameMasked ? detail.data.nameMasked : m.riders.detailTitle}
            {/* 번호는 라이더 번호(rider riderNumber) — 시스템 ID(RD-…)는 아래 시스템 번호 칸에만(2026-11-20) */}
            {detail.data?.riderNumber && <span className="ml-2 font-mono text-xs font-normal text-base-content/45">{detail.data.riderNumber}</span>}
          </>
        }
        nav={<SystemNumbers ids={[{ label: m.riders.detailTitle, id: riderId }]} />}
        actions={
          <a className="btn btn-sm border-base-300 bg-base-100" href={riderOpsUrl(riderId)}>
            {m.riders.openInRiderOps}
          </a>
        }
      />
      <Notice>
        <span data-testid="rider-ops-moved">{m.riders.moved}</span>
      </Notice>
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(r) => <RiderBasic key={r.riderId} rider={r} />}
      </QueryState>
      {/* 최근 30일 성과(execution 0.38.0 delivery-metrics?riderId=, 2026-11-23) */}
      <RiderPerformance riderId={riderId} />
      <Section title={m.riders.deliveries}>
        <DeliveriesOf riderId={riderId} />
      </Section>
      <Section title={m.riders.complaints}>
        <RiderComplaintTable riderId={riderId} />
      </Section>
    </section>
  );
}

/** 옛 주소(/riders 찾기·/riders/restriction-reviews 제한 검토) — 북마크로 들어오면 라이더 백오피스로 안내 */
export function RiderOpsMovedPage({ path }: { readonly path: 'riders' | 'restriction-reviews' }) {
  return (
    <section className="max-w-3xl space-y-4" data-testid="rider-ops-moved-page">
      <PageHeader title={m.riders.movedTitle} />
      {/* 옮겨 간 곳 안내 상자(2026-11-18) — 그림 + 한 줄 + 버튼 */}
      <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </span>
        <p className="max-w-md text-sm text-base-content/70">{m.riders.moved}</p>
        <a className="btn btn-primary btn-sm" href={`${staffAppUrl('rider-backoffice', globalThis.location)}${path}`}>
          {m.riders.openRiderOps}
        </a>
      </div>
    </section>
  );
}
