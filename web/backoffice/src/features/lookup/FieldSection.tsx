// 통합 조회 "현장(MFC)" 칸(bff 0.9.0 — 백엔드 요청 backoffice/2026-11-17-request-lookup-fulfillment, F-3).
// 원천 mfc-fulfillment-service 의 모양 그대로 옮긴다(합치거나 계산하지 않음):
// - FULFILLMENT(작업 지시): 수락·거절, 출고별 피킹 → 포장 → 인계 한 줄, BLOCKED 사유 빨강, 점원 결품 보고, 포장의 인계 거절 사유.
// - MFC_STOP(중지 요청): 범위·상태·마지막 오류 — PENDING + 오류면 관리자에게 처리 대기 링크.
// 작업자는 ID 그대로(이름 없음 — LAN 은 운영자 ID OP-…). 원천 실패는 "조회 실패"(0건 아님), 404 는 칸 없음(현장 기록 없음).
import { Link } from 'react-router';

import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';

const m = messages.lookup.fieldWork;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** 피킹 → 포장 → 인계(→ 반납) 순서 */
const TASK_ORDER = ['PICK', 'PACK', 'DISPATCH', 'RETURN'];

function Task({ t }: { readonly t: Obj }) {
  const state = str(t['state']);
  const blocked = state === 'BLOCKED';
  const planned = num(t['plannedQty']);
  const done = num(t['completedQty']);
  const cancelled = num(t['cancelledQty']);
  return (
    <li className={`rounded-lg border px-2.5 py-1.5 text-xs ${blocked ? 'border-error bg-error/5 text-error' : 'border-base-300 bg-base-100'}`} data-testid="field-task" data-type={str(t['taskType']) ?? ''} data-state={state ?? ''}>
      <span className="font-semibold">{label(m.taskName, str(t['taskType']))}</span> {text(state)}
      {planned !== null && <span className="ml-1 opacity-80">{m.qty(done ?? 0, planned, cancelled ?? 0)}</span>}
      {str(t['workerId']) && <span className="ml-1 font-mono text-base-content/60">{m.worker(str(t['workerId'])!)}</span>}
      {blocked && str(t['blockReason']) && <span className="block font-bold">{m.blocked(str(t['blockReason'])!)}</span>}
    </li>
  );
}

function Shipment({ s }: { readonly s: Obj }) {
  const tasks = arr(s['tasks']).sort((a, b) => TASK_ORDER.indexOf(str(a['taskType']) ?? '') - TASK_ORDER.indexOf(str(b['taskType']) ?? ''));
  const shortages = arr(s['shortages']);
  const packages = arr(s['packages']);
  return (
    <div className="space-y-1 border-t border-base-200 pt-2" data-testid="field-shipment">
      <p className="text-sm">
        <span className="font-mono">{text(str(s['shipmentId']))}</span> · {text(str(s['state']))}
        {str(s['readyAt']) && <span className="opacity-70">{` · ${m.readyAt} ${when(str(s['readyAt']))}`}</span>}
      </p>
      {tasks.length > 0 && <ol className="flex flex-wrap items-start gap-1">{tasks.map((t, i) => <Task key={`${str(t['taskType']) ?? ''}-${i}`} t={t} />)}</ol>}
      {shortages.length > 0 && (
        <div className="text-xs text-warning" data-testid="field-shortages">
          {m.shortages(shortages.length)}
          <ul className="ml-4 list-disc">
            {shortages.map((x, i) => (
              <li key={i}>{`${text(str(x['sku']))} · ${text(num(x['qty']))} · ${text(str(x['reason']))}${str(x['reportedAt']) ? ` · ${when(str(x['reportedAt']))}` : ''}`}</li>
            ))}
          </ul>
        </div>
      )}
      {packages.map((p, i) => {
        const rejected = str(p['handoverRejectReason']);
        return (
          <p key={i} className={`text-xs ${rejected ? 'text-error' : 'opacity-80'}`} data-testid="field-package">
            {`${m.package} ${text(str(p['state']))}`}
            {str(p['handoverStatus']) && ` · ${m.handover} ${str(p['handoverStatus'])}`}
            {str(p['handedOverAt']) && ` · ${when(str(p['handedOverAt']))}`}
            {rejected && <span className="block font-bold">{m.handoverRejected(rejected)}</span>}
          </p>
        );
      })}
    </div>
  );
}

function FulfillmentCard({ id, summary }: { readonly id: string; readonly summary: Obj }) {
  const rejected = str(summary['acceptance']) === 'REJECTED';
  return (
    <div className="space-y-2 rounded-box border border-base-300/70 bg-base-200/30 p-3" data-testid="match-FULFILLMENT">
      <p className="text-sm">
        <span className="font-mono">{id}</span> · {label(m.workKind, str(summary['kind']))} · {text(str(summary['mfcId']))}
        {str(summary['preparationStartedAt']) && <span className="opacity-70">{` · ${m.preparationStartedAt} ${when(str(summary['preparationStartedAt']))}`}</span>}
      </p>
      <p className={`text-sm ${rejected ? 'font-bold text-error' : ''}`}>
        {`${m.acceptance} ${label(m.acceptanceName, str(summary['acceptance']))}`}
        {rejected && ` — ${text(str(summary['rejectReason']))}${str(summary['rejectMessage']) ? `: ${str(summary['rejectMessage'])}` : ''}`}
      </p>
      {arr(summary['shipments']).map((s, i) => (
        <Shipment key={str(s['shipmentId']) ?? i} s={s} />
      ))}
    </div>
  );
}

function StopCard({ id, summary }: { readonly id: string; readonly summary: Obj }) {
  const admin = useSession().session?.roles.includes('OPERATOR_ADMIN') ?? false;
  const error = str(summary['lastError']);
  const stuck = str(summary['state']) === 'PENDING' && error !== null;
  return (
    <div className="space-y-1 rounded-box border border-base-300/70 bg-base-200/30 p-3 text-sm" data-testid="match-MFC_STOP">
      <p>
        <span className="font-mono">{id}</span> · {m.stop} {text(str(summary['scope']))} · {text(str(summary['state']))}
        {str(summary['requestedAt']) && <span className="opacity-70">{` · ${when(str(summary['requestedAt']))}`}</span>}
      </p>
      {error && <p className="text-error">{m.lastError(error)}</p>}
      {stuck && admin && (
        <Link className="link text-xs" to="/pending">
          {m.toPending}
        </Link>
      )}
    </div>
  );
}

export function FieldWork({ matches }: { readonly matches: ReadonlyArray<{ readonly kind?: string; readonly id?: string; readonly summary?: Obj }> }) {
  const fulfillments = matches.filter((x) => x.kind === 'FULFILLMENT');
  const stops = matches.filter((x) => x.kind === 'MFC_STOP');
  if (fulfillments.length === 0 && stops.length === 0) return <p className="opacity-70">{m.none}</p>;
  return (
    <div className="space-y-3">
      {fulfillments.map((f) => (
        <FulfillmentCard key={f.id} id={f.id ?? ''} summary={obj(f.summary)} />
      ))}
      {stops.map((s) => (
        <StopCard key={s.id} id={s.id ?? ''} summary={obj(s.summary)} />
      ))}
      <p className="text-xs text-base-content/60">{m.note}</p>
    </div>
  );
}
