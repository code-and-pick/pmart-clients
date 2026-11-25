// 기준정보 — [상품 취급 | 로케이션 | 통로 피킹 방식] 탭(?tab=). 백엔드 계획서 §2 #2.
// - 상품 취급: cdc-inventory `GET /cdcs/{cdcId}/sku-handlings?enabled=&cursor=&size=`, 켜기·끄기 `POST …/sku-handlings`(X-Expected-Version = 취급 version, 없음 0).
//   서버가 changed=false 면 "이미 그 값". 비활성 SKU 켜기는 422 SKU_INACTIVE(서버 판정).
// - 로케이션: cdc-location `GET /cdcs/{cdcId}/locations?temperatureZone=&area=&floor=&locationType=&state=&cursor=`, 상세 `…/{locationCode}`,
//   상태 바꾸기 `POST …/state-changes`(202 CommandResponse — ACCEPTED 는 접수만, 다시 읽어 바뀐 상태만 보인다. 폐기는 승인 번호 필수).
//   점유(occupiedQty)를 서버가 아직 모르면 null — 0 으로 보이지 않고 "모름".
// - 통로 피킹 방식: `GET /cdcs/{cdcId}/aisle-pick-methods`(보기만 — 설정은 다음 차례).
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Fragment, useMemo, useState, type FormEvent } from "react";
import { Link, Route, Routes, useParams, useSearchParams } from "react-router";

import { request } from "@pmart/web-core";
import {
  CommandFeedback,
  formatSeoul,
  QueryState,
  toUiState,
  useCommand,
} from "@pmart/web-ui";
import { DetailHeader, FieldList } from "@pmart/web-ui/standard";
import { commandParams } from "../../api/command";
import type { components as InvSchemas } from "../../api/generated/cdc-inventory";
import type { components as LocSchemas } from "../../api/generated/cdc-location";
import { useApi } from "../../app/ApiContext";
import { centerPath } from "../../app/nav";
import { messages } from "../../shared/messages";
import { Who } from "../../shared/OperatorLabel";
import { LocationStockTable } from "../inventory/LocationStock";
import { SkuInfo } from "../../shared/SkuInfo";

const t = messages.master;
type Tab = keyof typeof t.tabs;
const TABS = Object.keys(t.tabs) as Tab[];

type SkuHandling = InvSchemas["schemas"]["SkuHandling"];
type Location = LocSchemas["schemas"]["Location"];
type LocationState = LocSchemas["schemas"]["LocationState"];
type LocationType = LocSchemas["schemas"]["LocationType"];
type TemperatureZone = LocSchemas["schemas"]["TemperatureZone"];

const LOC_STATES: readonly LocationState[] = [
  "DRAFT",
  "ACTIVE",
  "BLOCKED",
  "INACTIVE",
  "RETIRED",
];
const LOC_TYPES: readonly LocationType[] = [
  "RESERVE",
  "PICK_FACE",
  "STAGING",
  "DOCK",
  "QUARANTINE",
  "TEMPORARY",
];
const ZONES: readonly TemperatureZone[] = ["AMBIENT", "CHILLED", "FROZEN"];
/** 칠곡 구역 글자·층(계약 LocationCode 설명) */
const AREAS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const FLOORS = ["5", "6", "7", "B1"] as const;
/** 지금 상태에서 할 수 있는 전환(계약 state-changes 설명) */
const ACTIONS: Readonly<Record<LocationState, readonly string[]>> = {
  DRAFT: ["ACTIVATE", "RETIRE"],
  ACTIVE: ["BLOCK", "DEACTIVATE"],
  BLOCKED: ["UNBLOCK", "DEACTIVATE"],
  INACTIVE: ["ACTIVATE", "RETIRE"],
  RETIRED: [],
};

const masterPath = (cdcId: string, rest = "") =>
  centerPath(cdcId, rest ? `master/${rest}` : "master");
const pick = <T extends string>(
  v: string | null,
  all: readonly T[],
): T | undefined =>
  v && (all as readonly string[]).includes(v) ? (v as T) : undefined;

/** `/c/:cdcId/master/*` */
export function MasterMenu({ cdcId }: { readonly cdcId: string }) {
  return (
    <Routes>
      <Route index element={<MasterHome cdcId={cdcId} />} />
      <Route
        path="locations/:code"
        element={<LocationDetailPage cdcId={cdcId} />}
      />
    </Routes>
  );
}

function MasterHome({ cdcId }: { readonly cdcId: string }) {
  const [params] = useSearchParams();
  const tab = pick(params.get("tab"), TABS) ?? "handling";
  return (
    <section className="space-y-4">
      <h1>{messages.menus.master}</h1>
      <div
        role="tablist"
        className="tabs tabs-box w-fit"
        data-testid="master-tabs"
      >
        {TABS.map((k) => (
          <Link
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`tab ${tab === k ? "tab-active" : ""}`}
            to={`${masterPath(cdcId)}?tab=${k}`}
          >
            {t.tabs[k]}
          </Link>
        ))}
      </div>
      {tab === "handling" && <HandlingTab cdcId={cdcId} />}
      {tab === "locations" && <LocationsTab cdcId={cdcId} />}
      {tab === "aisles" && <AislesTab cdcId={cdcId} />}
    </section>
  );
}

// ---------------------------------------------------------------- 상품 취급

function HandlingTab({ cdcId }: { readonly cdcId: string }) {
  const h = t.handling;
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const enabled = params.get("enabled");
  const query = useInfiniteQuery({
    queryKey: ["cdc", cdcId, "sku-handlings", enabled ?? ""],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        "GET",
        api.inventory.GET("/cdcs/{cdcId}/sku-handlings", {
          params: {
            path: { cdcId },
            query: {
              size: 100,
              ...(enabled ? { enabled: enabled === "true" } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const rows = useMemo(
    () => query.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [query.data],
  );
  // SKU 줄을 누르면 아래에 상품 정보(2026-11-26 사용자)
  const [open, setOpen] = useState<string | null>(null);
  const change = useCommand(
    async (v: { readonly row: SkuHandling; readonly on: boolean }, key) =>
      request(
        "POST",
        api.inventory.POST("/cdcs/{cdcId}/sku-handlings", {
          ...commandParams(key, { path: { cdcId }, version: v.row.version }),
          body: { sku: v.row.sku, enabled: v.on },
        }),
      ),
  );
  return (
    <div className="space-y-3">
      <label className="flex w-fit flex-col gap-1 text-sm">
        {h.filter}
        <select
          className="select select-sm w-36"
          value={enabled ?? ""}
          onChange={(e) => {
            const q = new URLSearchParams(params);
            if (e.target.value) q.set("enabled", e.target.value);
            else q.delete("enabled");
            setParams(q, { replace: true });
          }}
          data-testid="handling-filter"
        >
          <option value="">{h.all}</option>
          <option value="true">{h.on}</option>
          <option value="false">{h.off}</option>
        </select>
      </label>
      <CommandFeedback command={change}>
        {(r) => (
          <p role="status" className="alert alert-success text-sm">
            {r.changed === false
              ? h.unchanged
              : h.changed(r.handling.sku, r.handling.handlingEnabled)}
          </p>
        )}
      </CommandFeedback>
      <QueryState
        state={toUiState(query, () => rows.length === 0)}
        onRetry={() => void query.refetch()}
        emptyText={h.empty}
      >
        {() => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="handling-table">
                <thead>
                  <tr>
                    <th>{h.sku}</th>
                    <th>{h.state}</th>
                    <th>{h.handling}</th>
                    <th>{h.changedBy}</th>
                    <th>{h.reason}</th>
                    <th>{h.updatedAt}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.sku}>
                      <tr
                        data-testid="handling-row"
                        className="cursor-pointer hover"
                        aria-expanded={open === r.sku}
                        onClick={() => setOpen(open === r.sku ? null : r.sku)}
                      >
                        <td className="font-mono text-xs">
                          <span
                            aria-hidden
                            className="mr-1 inline-block w-3 text-base-content/50"
                          >
                            {open === r.sku ? "▾" : "▸"}
                          </span>
                          {r.sku}
                        </td>
                        <td>
                          {r.skuState === "INACTIVE" ? (
                            <span className="badge badge-sm badge-ghost">
                              {h.inactive}
                            </span>
                          ) : (
                            h.active
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge badge-sm ${r.handlingEnabled ? "badge-success" : "badge-ghost"}`}
                          >
                            {r.handlingEnabled ? h.on : h.off}
                          </span>
                        </td>
                        <td>
                          <Who id={r.changedBy} />
                        </td>
                        <td className="whitespace-normal">
                          {r.reason ?? messages.none}
                        </td>
                        <td>
                          {r.updatedAt
                            ? formatSeoul(r.updatedAt)
                            : messages.none}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-xs"
                            disabled={change.busy}
                            onClick={(e) => {
                              e.stopPropagation(); // 줄 펼치기와 따로
                              void change
                                .run({ row: r, on: !r.handlingEnabled })
                                .then((phase) => {
                                  if (phase.kind === "done")
                                    void queryClient.invalidateQueries({
                                      queryKey: ["cdc", cdcId, "sku-handlings"],
                                    });
                                });
                            }}
                            data-testid={`handling-toggle-${r.sku}`}
                          >
                            {r.handlingEnabled ? h.turnOff : h.turnOn}
                          </button>
                        </td>
                      </tr>
                      {open === r.sku && (
                        <tr>
                          <td colSpan={7} className="bg-base-200/50">
                            <SkuInfo sku={r.sku} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {query.hasNextPage && (
              <div className="flex justify-center">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {h.more}
                </button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------- 로케이션

export function LocStateBadge({
  state,
}: {
  readonly state: string | undefined;
}) {
  const l = t.loc;
  if (!state) return <>{messages.none}</>;
  const tone =
    state === "ACTIVE"
      ? "badge-success"
      : state === "BLOCKED"
        ? "badge-warning"
        : state === "DRAFT"
          ? "badge-info"
          : "badge-ghost";
  return (
    <span className={`badge badge-sm ${tone}`}>{l.states[state] ?? state}</span>
  );
}

const qtyOrUnknown = (n: number | null | undefined) =>
  n === null || n === undefined ? t.loc.unknown : messages.qty(n);

function LocationsTab({ cdcId }: { readonly cdcId: string }) {
  const l = t.loc;
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const filter = {
    temperatureZone: pick(params.get("zone"), ZONES),
    area: pick(params.get("area"), AREAS),
    floor: pick(params.get("floor"), FLOORS),
    locationType: pick(params.get("type"), LOC_TYPES),
    state: pick(params.get("state"), LOC_STATES),
  };
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(params);
    if (v) q.set(k, v);
    else q.delete(k);
    setParams(q, { replace: true });
  };
  const query = useInfiniteQuery({
    queryKey: ["cdc", cdcId, "locations", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const q = Object.fromEntries(
        Object.entries(filter).filter(([, v]) => v !== undefined),
      );
      return request(
        "GET",
        api.location.GET("/cdcs/{cdcId}/locations", {
          params: {
            path: { cdcId },
            query: {
              ...q,
              size: 100,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      );
    },
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const rows = useMemo(
    () => query.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [query.data],
  );
  const select = (
    key: string,
    label: string,
    value: string | undefined,
    options: ReadonlyArray<readonly [string, string]>,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        className="select select-sm w-32"
        value={value ?? ""}
        onChange={(e) => set(key, e.target.value)}
        data-testid={`loc-${key}`}
      >
        <option value="">{l.all}</option>
        {options.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        data-list-part="top"
      >
        {select(
          "zone",
          l.zone,
          filter.temperatureZone,
          ZONES.map((z) => [z, l.zones[z] ?? z]),
        )}
        {select(
          "area",
          l.area,
          filter.area,
          AREAS.map((a) => [a, a]),
        )}
        {select(
          "floor",
          l.floor,
          filter.floor,
          FLOORS.map((f) => [f, f]),
        )}
        {select(
          "type",
          l.type,
          filter.locationType,
          LOC_TYPES.map((x) => [x, l.types[x] ?? x]),
        )}
        {select(
          "state",
          l.state,
          filter.state,
          LOC_STATES.map((x) => [x, l.states[x] ?? x]),
        )}
      </div>
      <QueryState
        state={toUiState(query, () => rows.length === 0)}
        onRetry={() => void query.refetch()}
        emptyText={l.empty}
      >
        {() => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="loc-table">
                <thead>
                  <tr>
                    <th>{l.code}</th>
                    <th>{l.zone}</th>
                    <th>{l.type}</th>
                    <th>{l.state}</th>
                    <th className="text-right">{l.capacity}</th>
                    <th className="text-right">{l.occupied}</th>
                    <th className="text-right">{l.reserved}</th>
                    <th className="text-right">{l.available}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.locationCode} data-testid="loc-row">
                      <td>
                        <Link
                          className="link font-mono text-xs"
                          to={masterPath(
                            cdcId,
                            `locations/${encodeURIComponent(x.locationCode)}`,
                          )}
                        >
                          {x.locationCode}
                        </Link>
                      </td>
                      <td>{l.zones[x.temperatureZone] ?? x.temperatureZone}</td>
                      <td>{l.types[x.locationType] ?? x.locationType}</td>
                      <td>
                        <LocStateBadge state={x.state} />
                      </td>
                      <td className="text-right tabular-nums">
                        {x.capacity.maxQty !== undefined
                          ? `${messages.qty(x.capacity.maxQty)} ${x.capacity.unit ?? ""}`
                          : messages.none}
                      </td>
                      <td className="text-right tabular-nums">
                        {qtyOrUnknown(x.occupiedQty)}
                      </td>
                      <td className="text-right tabular-nums">
                        {messages.qty(x.openReservedQty ?? 0)}
                      </td>
                      <td className="text-right tabular-nums">
                        {qtyOrUnknown(x.availableQty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {query.hasNextPage && (
              <div className="flex justify-center">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {l.more}
                </button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

function LocationDetailPage({ cdcId }: { readonly cdcId: string }) {
  const l = t.loc;
  const api = useApi();
  const queryClient = useQueryClient();
  const { code = "" } = useParams();
  const [accepted, setAccepted] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["cdc", cdcId, "location", code],
    queryFn: () =>
      request(
        "GET",
        api.location.GET("/cdcs/{cdcId}/locations/{locationCode}", {
          params: { path: { cdcId, locationCode: code } },
        }),
      ),
    // 상태 바꾸기를 접수한 뒤에는 바뀔 때까지 다시 읽는다(서버가 바꾼 상태만 보인다)
    refetchInterval: (q) =>
      accepted && q.state.data?.state === accepted ? 2_000 : false,
  });
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(x) => (
          <>
            <DetailHeader
              back={{
                to: `${masterPath(cdcId)}?tab=locations`,
                label: l.detailBack,
              }}
              title={x.locationCode}
              badges={<LocStateBadge state={x.state} />}
              summary={[
                l.zones[x.temperatureZone] ?? x.temperatureZone,
                l.types[x.locationType] ?? x.locationType,
                x.parts?.floor ? `${x.parts.floor}층` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                testId="loc-fields"
                rows={[
                  [
                    l.capacity,
                    x.capacity.maxQty !== undefined
                      ? `${messages.qty(x.capacity.maxQty)} ${x.capacity.unit ?? ""}`
                      : messages.none,
                  ],
                  [l.occupied, qtyOrUnknown(x.occupiedQty)],
                  [l.reserved, messages.qty(x.openReservedQty ?? 0)],
                  [l.available, qtyOrUnknown(x.availableQty)],
                  [
                    l.restrictions,
                    x.restrictions?.length
                      ? x.restrictions.join(", ")
                      : messages.none,
                  ],
                  x.locationType === "PICK_FACE"
                    ? [
                        l.pickFace,
                        `${x.pickFaceMinQty ?? l.notSet} / ${x.pickFaceTargetQty ?? l.notSet}`,
                      ]
                    : null,
                  [l.version, x.version ?? messages.none],
                  [
                    l.updatedAt,
                    x.updatedAt ? formatSeoul(x.updatedAt) : messages.none,
                  ],
                ]}
              />
            </div>
            {accepted !== null && (
              <p
                role="status"
                className={`alert text-sm ${x.state === accepted ? "alert-info" : "alert-success"}`}
                data-testid="loc-sent"
              >
                {x.state === accepted ? l.accepted : l.applied}
              </p>
            )}
            <h2 className="text-base font-semibold">
              {messages.locStock.title}
            </h2>
            <LocationStockTable cdcId={cdcId} prefix={x.locationCode} single />
            <LocationActions
              cdcId={cdcId}
              loc={x}
              onSent={(from) => {
                setAccepted(from);
                void queryClient.invalidateQueries({
                  queryKey: ["cdc", cdcId, "location", code],
                });
                void queryClient.invalidateQueries({
                  queryKey: ["cdc", cdcId, "locations"],
                });
              }}
              key={`${x.state}-${x.version}`}
              api={api}
            />
          </>
        )}
      </QueryState>
    </section>
  );
}

function LocationActions({
  cdcId,
  loc,
  onSent,
  api,
}: {
  readonly cdcId: string;
  readonly loc: Location;
  readonly onSent: (fromState: string) => void;
  readonly api: ReturnType<typeof useApi>;
}) {
  const l = t.loc;
  const actions = ACTIONS[loc.state ?? "RETIRED"] ?? [];
  const [action, setAction] = useState(actions[0] ?? "");
  const [reason, setReason] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
  const [touched, setTouched] = useState(false);
  const send = useCommand(
    async (
      body: {
        action: "ACTIVATE" | "BLOCK" | "UNBLOCK" | "DEACTIVATE" | "RETIRE";
        reason: string;
        approvalRef?: string;
      },
      key,
    ) =>
      request(
        "POST",
        api.location.POST(
          "/cdcs/{cdcId}/locations/{locationCode}/state-changes",
          {
            ...commandParams(key, {
              path: { cdcId, locationCode: loc.locationCode },
              version: loc.version,
            }),
            body,
          },
        ),
      ),
  );
  if (actions.length === 0) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!reason.trim()) return;
    void send
      .run({
        action: action as "ACTIVATE",
        reason: reason.trim(),
        ...(action === "RETIRE" && approvalRef.trim()
          ? { approvalRef: approvalRef.trim() }
          : {}),
      })
      .then((phase) => {
        if (phase.kind === "done") onSent(loc.state ?? "");
      });
  };
  return (
    <form
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4"
      onSubmit={submit}
      data-testid="loc-actions"
    >
      <h2 className="text-base font-semibold">{l.actionTitle}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="join">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`btn btn-sm join-item ${action === a ? "btn-primary" : ""}`}
              onClick={() => setAction(a)}
              aria-pressed={action === a}
            >
              {l.action[a] ?? a}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {l.reason}
          <input
            className="input input-sm w-72"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            data-testid="loc-reason"
          />
        </label>
        {action === "RETIRE" && (
          <label className="flex flex-col gap-1 text-sm">
            {l.approvalRef}
            <input
              className="input input-sm w-48"
              value={approvalRef}
              onChange={(e) => setApprovalRef(e.target.value)}
              data-testid="loc-approval"
            />
          </label>
        )}
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={send.busy}
          data-testid="loc-send"
        >
          {l.send}
        </button>
      </div>
      {touched && !reason.trim() && (
        <p role="alert" className="text-sm text-error">
          {l.reasonRequired}
        </p>
      )}
      {/* 거절·결과 불명만 여기에 — 접수·바뀜은 위(다시 읽은 서버 상태로) */}
      <CommandFeedback command={send} />
    </form>
  );
}

// ---------------------------------------------------------------- 통로 피킹 방식

function AislesTab({ cdcId }: { readonly cdcId: string }) {
  const a = t.aisles;
  const api = useApi();
  const query = useQuery({
    queryKey: ["cdc", cdcId, "aisle-pick-methods"],
    queryFn: async () =>
      (
        await request(
          "GET",
          api.location.GET("/cdcs/{cdcId}/aisle-pick-methods", {
            params: { path: { cdcId } },
          }),
        )
      ).items ?? [],
  });
  return (
    <QueryState
      state={toUiState(query, (r) => r.length === 0)}
      onRetry={() => void query.refetch()}
      emptyText={a.empty}
    >
      {(rows) => (
        <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table className="table table-sm" data-testid="aisle-table">
            <thead>
              <tr>
                <th>{a.area}</th>
                <th>{a.floor}</th>
                <th>{a.aisle}</th>
                <th>{a.method}</th>
                <th>{a.updatedBy}</th>
                <th>{a.updatedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.area}-${r.floor}-${r.aisle}`}
                  data-testid="aisle-row"
                >
                  <td>{r.area}</td>
                  <td>{r.floor}</td>
                  <td className="font-mono">{r.aisle}</td>
                  <td>
                    {r.pickMethod
                      ? (a.methods[r.pickMethod] ?? r.pickMethod)
                      : messages.none}
                  </td>
                  <td>
                    <Who id={r.updatedBy} />
                  </td>
                  <td>
                    {r.updatedAt ? formatSeoul(r.updatedAt) : messages.none}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryState>
  );
}
