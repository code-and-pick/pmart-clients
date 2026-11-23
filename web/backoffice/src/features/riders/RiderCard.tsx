// 배송 상세의 라이더 카드(2026-11-18 Refine 주문 상세의 배달원 카드 참고 — 사용자 "전부 시작 해").
// rider 0.4.0+ `GET /riders/{riderId}`(OPERATOR_ADMIN·RIDER_OPS·CS_AGENT, 그 밖 403) — 라이더 상세와 같은 쿼리 키라 한 번만 읽는다.
// 서버가 가린 이름·전화만 보여 준다. 원문 열람(사유 + 기록)은 라이더 상세 화면에서만 — 이 카드에 열람 버튼을 두지 않는다.
// 정산 계좌·동의 내역은 배송 확인에 필요 없어 넣지 않는다.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { request } from "@pmart/web-core";
import { QueryState, toUiState } from "@pmart/web-ui";
import { useApi } from "../../app/ApiContext";
import { FieldList, Section, StatusBadge, type Tone } from "../../shared/admin";
import { messages as m } from "../../shared/messages";
import { label } from "../../shared/ops";
import { CenterName } from '../../shared/centerScope';

export const RESTRICTION_TONE: Readonly<Record<string, Tone>> = {
  NORMAL: "success",
  DISPATCH_RESTRICTED: "warning",
  SUSPENDED: "error",
  TERMINATED: "ghost",
};

export function RiderCard({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const detail = useQuery({
    queryKey: ["riders", "detail", riderId],
    queryFn: () =>
      request(
        "GET",
        api.riders.GET("/riders/{riderId}", { params: { path: { riderId } } }),
      ),
  });
  return (
    <Section title={m.deliveries.riderCard.title} testId="delivery-rider-card">
      <QueryState
        state={toUiState(detail)}
        onRetry={() => void detail.refetch()}
      >
        {(r) => {
          const op = r.operating;
          const restriction = r.restriction?.state;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  aria-hidden="true"
                >
                  {(r.nameMasked ?? "?").slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold" data-testid="rider-card-name">
                    {r.nameMasked ?? m.none}
                    {r.riderNumber && (
                      <span className="ml-2 font-mono text-sm font-normal text-base-content/60">
                        {r.riderNumber}
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-base-content/55">
                    {r.phoneMasked ?? m.none}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {op?.status && (
                    <StatusBadge
                      tone={op.status === "ON_DUTY" ? "success" : "ghost"}
                    >
                      {label(m.riders.operatingName, op.status)}
                    </StatusBadge>
                  )}
                  {restriction && restriction !== "NORMAL" && (
                    <StatusBadge
                      tone={RESTRICTION_TONE[restriction] ?? "ghost"}
                    >
                      {label(m.riders.restrictionName, restriction)}
                    </StatusBadge>
                  )}
                </div>
              </div>
              <FieldList
                rows={[
                  [
                    m.riders.vehicle,
                    label(m.riders.vehicleName, r.vehicleType),
                  ],
                  [
                    m.riders.newDispatch,
                    op?.newDispatchEnabled === undefined
                      ? m.none
                      : op.newDispatchEnabled
                        ? m.riders.newDispatchOn
                        : m.riders.newDispatchOff,
                  ],
                  [m.deliveries.riderCard.mfc, <CenterName key="c" id={op?.mfcId} />],
                  [
                    m.riders.restriction,
                    label(m.riders.restrictionName, restriction),
                  ],
                ]}
              />
              <p className="text-xs text-base-content/55">
                {m.deliveries.riderCard.piiNote}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  className="btn btn-sm"
                  to={`/riders/${encodeURIComponent(riderId)}`}
                >
                  {m.deliveries.riderCard.open}
                </Link>
                <Link
                  className="btn btn-sm btn-ghost"
                  to={`/deliveries?q=1&riderId=${encodeURIComponent(riderId)}`}
                >
                  {m.deliveries.riderCard.deliveries}
                </Link>
              </div>
            </div>
          );
        }}
      </QueryState>
    </Section>
  );
}
