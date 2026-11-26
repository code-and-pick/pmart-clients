// 센터 평면도(2D) — MFC 백오피스 센터 도면처럼(사용자 2026-11-26 "MFC 백오피스처럼 DC 시뮬레이션을 2D 평면도로").
// ⚠ 도면은 서버 API 가 아니다 — 백엔드(cdc-location)에는 좌표가 없고(칸 코드·parts 만), 좌표 정본은 CDC 시뮬레이터 배치(PC 1 회신 2026-11-26).
//   layouts/CDC01.json = 시뮬레이터 `buildLayout()` 을 tools/floors/run.mjs 로 뽑은 것(실측 도면 아님 — 화면에 적는다, R-25 배치 5f87f4c). 실제 도면(R-05)이 나오면 바꾼다.
// - 층(5·6·7F) 탭, 온도대 방·보관 구역·랙 줄·피킹 선반 줄·통로 번호판·승강기·작업 자리 이름.
// - 통로를 누르면 오른쪽에 그 통로 칸 재고(cdc-inventory location-stocks?locationPrefix=CDC01-{구역}-{층}-{통로}-)와 로케이션 목록 링크.
// - 설비 상태·표시등·로봇은 그리지 않는다(사용자 "설비센서자산 같은 건 제외") — 작업 자리는 이름만.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { centerPath } from "../../app/nav";
import { messages } from "../../shared/messages";
import { aisleOf, useWorkers, WorkerDot, WorkerList, type WorkerLocation } from './FloorWorkers';
import { LocationStockTable } from "../inventory/LocationStock";
import { aisleKey, useFloorStock, type FloorStock } from "./FloorStock";
import plan from "./layouts/CDC01.json";

const t = messages.floor;
type R4 = readonly [number, number, number, number];
type Temp = "AMBIENT" | "CHILLED" | "FROZEN";

interface PlanAisle {
  readonly zone: string;
  readonly temp: string;
  readonly no: number;
  readonly plate: string;
  readonly cx: number;
  readonly z0: number;
  readonly z1: number;
  readonly kind: "RACK" | "SHELF";
}
interface PlanFloor {
  readonly floor: string;
  readonly label: string;
  readonly zones: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly temp: string | null;
    readonly kind: string;
    readonly rect: R4;
  }>;
  readonly coldRooms: ReadonlyArray<{
    readonly temp: string;
    readonly label: string;
    readonly rects: readonly R4[];
  }>;
  readonly rows: ReadonlyArray<{
    readonly zone: string;
    readonly aisle: number;
    readonly cx: number;
    readonly z0: number;
    readonly z1: number;
    readonly temp: string;
  }>;
  readonly shelfRows: ReadonlyArray<{
    readonly zone: string;
    readonly aisle: number;
    readonly cx: number;
    readonly z0: number;
    readonly z1: number;
    readonly temp: string;
  }>;
  readonly aisles: readonly PlanAisle[];
  readonly lifts: ReadonlyArray<{
    readonly no: number;
    readonly code: string;
    readonly rect: R4;
  }>;
  readonly areas: ReadonlyArray<{ readonly label: string; readonly rect: R4 }>;
}
interface Plan {
  readonly centerId: string;
  readonly source: string;
  readonly width: number;
  readonly depth: number;
  readonly floors: readonly PlanFloor[];
}

const PLANS: Readonly<Record<string, Plan>> = {
  CDC01: plan as unknown as Plan,
};

/** 온도대 색 — 테마 변수만(밝은·어두운 화면 둘 다) */
const TEMP_COLOR: Readonly<Record<Temp, string>> = {
  FROZEN: "var(--color-info)",
  CHILLED: "var(--color-success)",
  AMBIENT: "var(--color-warning)",
};
const tempColor = (temp: string | null | undefined) =>
  temp && temp in TEMP_COLOR
    ? TEMP_COLOR[temp as Temp]
    : "var(--color-base-content)";
const RACK_W = 1.1;

/** 칸 코드 앞부분 — 계약 LocationCode 7구간 {센터}-{구역}-{층}-{통로}- */
export const aislePrefix = (
  centerId: string,
  floor: string,
  a: { readonly zone: string; readonly no: number },
) => `${centerId}-${a.zone}-${floor}-${String(a.no).padStart(2, "0")}-`;

/** `/c/:cdcId/floor` */
export function FloorMenu({ cdcId }: { readonly cdcId: string }) {
  const p = PLANS[cdcId];
  const [params, setParams] = useSearchParams();
  const floors = p?.floors ?? [];
  const floorNo = floors.some((f) => f.floor === params.get("f"))
    ? params.get("f")!
    : (floors[0]?.floor ?? "");
  const floor = floors.find((f) => f.floor === floorNo);
  const picked = params.get("aisle");
  const workers = useWorkers(cdcId);
  const aisle =
    floor?.aisles.find((a) => `${a.zone}${a.no}` === picked) ?? null;
  const zones = [...new Set((floor?.aisles ?? []).map((a) => a.zone))];
  const stock = useFloorStock(cdcId, p?.centerId ?? cdcId, floor?.floor ?? "", zones);
  const set = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
  };
  if (!p || !floor) {
    return (
      <section className="space-y-4">
        <h1>{messages.menus.floor}</h1>
        <p role="status" className="alert text-sm" data-testid="floor-none">
          {t.none}
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>{messages.menus.floor}</h1>
          <p className="text-xs text-base-content/55">{t.source(p.source)}</p>
        </div>
        <div
          role="tablist"
          className="tabs tabs-box w-fit"
          data-testid="floor-tabs"
        >
          {floors.map((f) => (
            <button
              key={f.floor}
              type="button"
              role="tab"
              aria-selected={f.floor === floorNo}
              className={`tab ${f.floor === floorNo ? "tab-active" : ""}`}
              onClick={() => set({ f: f.floor, aisle: "" })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <Legend />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 p-2">
          <FloorSvg
            plan={p}
            floor={floor}
            picked={aisle}
            onPick={(a) => set({ aisle: a ? `${a.zone}${a.no}` : "" })}
            workers={workers.data?.workers ?? []}
            stock={stock}
          />
        </div>
        <aside className="space-y-3" data-testid="floor-side">
          {aisle ? (
            <AislePanel
              cdcId={cdcId}
              centerId={p.centerId}
              floor={floor}
              aisle={aisle}
              onClose={() => set({ aisle: "" })}
              stock={stock}
              onPick={(a) => set({ aisle: `${a.zone}${a.no}` })}
            />
          ) : (
            <div className="space-y-2 rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/70">
              <p>{t.pickHint}</p>
              <StockedList floor={floor} stock={stock} onPick={(a) => set({ aisle: `${a.zone}${a.no}` })} />
            </div>
          )}
          <WorkerList query={workers} floor={floor.floor} />
        </aside>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap items-center gap-4 text-xs text-base-content/70"
      data-testid="floor-legend"
    >
      {(["FROZEN", "CHILLED", "AMBIENT"] as const).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{
              background: `color-mix(in oklab, ${TEMP_COLOR[k]} 35%, transparent)`,
              border: `1px solid ${TEMP_COLOR[k]}`,
            }}
          />
          {messages.master.loc.zones[k]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-1.5 bg-base-content/60" />
        {t.rack}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-1.5 bg-base-content/30" />
        {t.shelf}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-base-content/40" />
        {t.area}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="text-[11px] font-bold text-primary">G01</span>
        {t.stockedLegend}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-grid h-3.5 w-3.5 place-items-center rounded-sm bg-neutral text-[9px] font-bold text-neutral-content">
          1
        </span>
        {t.liftLegend}
      </li>
    </ul>
  );
}

function FloorSvg({
  plan: p,
  floor,
  picked,
  onPick,
  workers,
  stock,
}: {
  readonly plan: Plan;
  readonly floor: PlanFloor;
  readonly picked: PlanAisle | null;
  readonly onPick: (a: PlanAisle | null) => void;
  readonly workers: readonly WorkerLocation[];
  readonly stock: FloorStock;
}) {
  // FRESH 작업자만 그 통로 가운데에 — 같은 통로 여럿이면 세로로 비켜 찍는다
  const dots = useMemo(() => {
    const seen = new Map<string, number>();
    return workers.flatMap((w) => {
      if (w.locationState !== "FRESH") return [];
      const at = aisleOf(w.locationCode);
      if (!at || at.floor !== floor.floor) return [];
      const a = floor.aisles.find((x) => x.zone === at.zone && x.no === at.no);
      if (!a) return [];
      const k = `${a.zone}-${a.no}`;
      const i = seen.get(k) ?? 0;
      seen.set(k, i + 1);
      return [{ w, x: a.cx, y: (a.z0 + a.z1) / 2 + i * 2.6 }];
    });
  }, [workers, floor]);
  const pad = 2;
  const vb = `${-pad} ${-pad} ${p.width + pad * 2} ${p.depth + pad * 2}`;
  const storage = useMemo(
    () => floor.zones.filter((z) => z.kind === "RACK" || z.kind === "SHELF"),
    [floor],
  );
  // 랙·선반 줄 → 그 줄이 속한 통로(같은 구역·통로 번호)
  const pickRow = (r: { readonly zone: string; readonly aisle: number }) => {
    const a = floor.aisles.find((x) => x.zone === r.zone && x.no === r.aisle);
    if (a) onPick(a);
  };
  const has = (a: { readonly zone: string; readonly no: number }) => (stock.byAisle.get(aisleKey(a.zone, a.no))?.qty ?? 0) > 0;
  return (
    <svg
      viewBox={vb}
      className="h-auto w-full select-none"
      role="img"
      aria-label={t.svgLabel(floor.label)}
      data-testid="floor-svg"
    >
      {/* 건물 바닥 */}
      <rect
        x={0}
        y={0}
        width={p.width}
        height={p.depth}
        fill="var(--color-base-200)"
        stroke="var(--color-base-content)"
        strokeOpacity={0.5}
        strokeWidth={0.3}
        rx={0.4}
      />
      {/* 온도 관리 방(냉동·냉장) */}
      {floor.coldRooms.flatMap((c, i) =>
        c.rects.map((r, j) => (
          <rect
            key={`cold-${i}-${j}`}
            x={r[0]}
            y={r[1]}
            width={r[2] - r[0]}
            height={r[3] - r[1]}
            fill={tempColor(c.temp)}
            fillOpacity={0.08}
            stroke="none"
          />
        )),
      )}
      {/* 보관 구역(온도대 색) */}
      {storage.map((z) => (
        <g key={z.id}>
          <rect
            x={z.rect[0]}
            y={z.rect[1]}
            width={z.rect[2] - z.rect[0]}
            height={z.rect[3] - z.rect[1]}
            fill={tempColor(z.temp)}
            fillOpacity={0.12}
            stroke={tempColor(z.temp)}
            strokeOpacity={0.6}
            strokeWidth={0.2}
          />
        </g>
      ))}
      {/* 작업 자리(설비는 이름만) */}
      {floor.areas.map((a, i) => (
        <g key={`area-${i}`}>
          <rect
            x={a.rect[0]}
            y={a.rect[1]}
            width={a.rect[2] - a.rect[0]}
            height={a.rect[3] - a.rect[1]}
            fill="var(--color-base-300)"
            fillOpacity={0.5}
            stroke="var(--color-base-content)"
            strokeOpacity={0.35}
            strokeWidth={0.15}
            strokeDasharray="0.6 0.4"
          >
            {/* 얇은 자리(휠소터·컨베이어 줄)는 글씨 없이 — 마우스를 올리면 이름 */}
            <title>{a.label}</title>
          </rect>
        </g>
      ))}
      {/* 랙 줄·선반 줄 */}
      {floor.rows.map((r, i) => (
        <rect
          key={`row-${i}`}
          className="cursor-pointer"
          onClick={() => pickRow(r)}
          data-testid={`rack-${r.zone}${r.aisle}-${i}`}
          x={r.cx - RACK_W / 2}
          y={r.z0}
          width={RACK_W}
          height={r.z1 - r.z0}
          fill="var(--color-base-content)"
          fillOpacity={0.55}
        />
      ))}
      {floor.shelfRows.map((r, i) => (
        <rect
          key={`shelf-${i}`}
          className="cursor-pointer"
          onClick={() => pickRow(r)}
          x={r.cx - 0.3}
          y={r.z0}
          width={0.6}
          height={r.z1 - r.z0}
          fill="var(--color-base-content)"
          fillOpacity={0.3}
        />
      ))}
      {/* 승강기 */}
      {floor.lifts.map((l) => (
        <g key={l.code}>
          <rect
            x={l.rect[0]}
            y={l.rect[1]}
            width={l.rect[2] - l.rect[0]}
            height={l.rect[3] - l.rect[1]}
            fill="var(--color-neutral)"
            fillOpacity={0.85}
            stroke="var(--color-base-content)"
            strokeOpacity={0.4}
            strokeWidth={0.1}
          >
            <title>{t.lift(l.no)}</title>
          </rect>
          <text
            x={(l.rect[0] + l.rect[2]) / 2}
            y={(l.rect[1] + l.rect[3]) / 2 + 0.5}
            textAnchor="middle"
            fontSize={1.3}
            fontWeight={700}
            fill="var(--color-neutral-content)"
          >
            {l.no}
          </text>
        </g>
      ))}
      {/* 통로 — 누르면 그 통로 칸 재고 */}
      {floor.aisles.map((a) => {
        const on = picked?.zone === a.zone && picked.no === a.no;
        const w = a.kind === "RACK" ? 2.6 : 1.6;
        return (
          <g
            key={`${a.zone}-${a.no}`}
            role="button"
            tabIndex={0}
            aria-label={t.aisleLabel(a.plate)}
            aria-pressed={on}
            className="cursor-pointer"
            onClick={() => onPick(on ? null : a)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(on ? null : a);
              }
            }}
            data-testid={`aisle-${a.plate}`}
          >
            <rect
              x={a.cx - w / 2}
              y={a.z0}
              width={w}
              height={a.z1 - a.z0}
              fill={on || has(a) ? "var(--color-primary)" : "transparent"}
              fillOpacity={on ? 0.35 : has(a) ? 0.14 : 0}
              className="hover:fill-[var(--color-primary)] hover:[fill-opacity:0.15]"
            />
            <text
              x={a.cx}
              y={a.z0 - 0.4}
              textAnchor="middle"
              fontSize={a.kind === "RACK" ? 1.5 : 1.1}
              fontWeight={on || has(a) ? 700 : 500}
              fill={on || has(a) ? "var(--color-primary)" : "var(--color-base-content)"}
              fillOpacity={on || has(a) ? 1 : stock.loading ? 0.75 : 0.4}
            >
              {a.plate}
            </text>
          </g>
        );
      })}
      {dots.map((d) => (
        <WorkerDot key={d.w.workerId} w={d.w} x={d.x} y={d.y} />
      ))}
      {/* 이름(맨 위) — 보관 구역·작업 자리 */}
      {storage.map((z) => (
        <text
          key={`zl-${z.id}`}
          x={(z.rect[0] + z.rect[2]) / 2}
          y={z.rect[3] - 1.2}
          textAnchor="middle"
          fontSize={1.5}
          fontWeight={700}
          fill={tempColor(z.temp)}
          style={{ paintOrder: "stroke" }}
          stroke="var(--color-base-100)"
          strokeWidth={0.5}
        >
          {shortLabel(z.label)}
        </text>
      ))}
      {floor.areas
        .filter((a) => a.rect[3] - a.rect[1] >= 2.5)
        .map((a, i) => (
          <text
            key={`al-${i}`}
            x={(a.rect[0] + a.rect[2]) / 2}
            y={(a.rect[1] + a.rect[3]) / 2 + 0.4}
            textAnchor="middle"
            fontSize={1.5}
            fill="var(--color-base-content)"
            fillOpacity={0.85}
            style={{ paintOrder: "stroke" }}
            stroke="var(--color-base-100)"
            strokeWidth={0.35}
          >
            {shortLabel(a.label)}
          </text>
        ))}
    </svg>
  );
}

/** 작업 자리 이름은 괄호 앞만(그림 안이 좁다 — 전체는 시뮬레이터) */
const shortLabel = (s: string) => s.split(" (")[0] ?? s;

function AislePanel({
  cdcId,
  centerId,
  floor,
  aisle,
  onClose,
  stock,
  onPick,
}: {
  readonly cdcId: string;
  readonly centerId: string;
  readonly floor: PlanFloor;
  readonly aisle: PlanAisle;
  readonly onClose: () => void;
  readonly stock: FloorStock;
  readonly onPick: (a: PlanAisle) => void;
}) {
  const prefix = aislePrefix(centerId, floor.floor, aisle);
  return (
    <div
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4"
      data-testid="aisle-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{aisle.plate}</h2>
          <p className="text-xs text-base-content/60">
            {[
              floor.label,
              messages.master.loc.zones[aisle.temp] ?? aisle.temp,
              aisle.kind === "RACK" ? t.rack : t.shelf,
            ].join(" · ")}
          </p>
          <p className="mt-1 font-mono text-xs text-base-content/55">
            {prefix}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
          aria-label={t.close}
        >
          ✕
        </button>
      </div>
      <Link
        className="link block text-sm"
        to={`${centerPath(cdcId, "master")}?tab=locations&area=${aisle.zone}&floor=${floor.floor}`}
      >
        {t.toLocations}
      </Link>
      <h3 className="text-sm font-semibold">{t.stock}</h3>
      <LocationStockTable cdcId={cdcId} prefix={prefix} />
      {!stock.loading && !stock.byAisle.has(aisleKey(aisle.zone, aisle.no)) && (
        <div className="space-y-1 rounded-box border border-dashed border-base-300 p-3 text-xs" data-testid="aisle-empty">
          <p>{t.aisleEmptyGo}</p>
          <StockedList floor={floor} stock={stock} onPick={onPick} />
        </div>
      )}
    </div>
  );
}


/** 이 층에서 재고가 있는 통로 — 많은 순, 누르면 그 통로 */
function StockedList({ floor, stock, onPick }: { readonly floor: PlanFloor; readonly stock: FloorStock; readonly onPick: (a: PlanAisle) => void }) {
  if (stock.loading) return <p className="text-xs text-base-content/55">…</p>;
  if (stock.failed) return <p className="text-xs text-error">{messages.loadFailed}</p>;
  const list = floor.aisles
    .map((a) => ({ a, s: stock.byAisle.get(aisleKey(a.zone, a.no)) }))
    .filter((x): x is { a: PlanAisle; s: { qty: number; lines: number } } => !!x.s && x.s.qty > 0)
    .sort((x, y) => y.s.qty - x.s.qty);
  if (list.length === 0) return <p className="text-xs text-base-content/60">{t.floorEmpty}</p>;
  return (
    <div className="space-y-1" data-testid="stocked-aisles">
      <p className="text-xs text-base-content/60">{t.stockedTitle(list.length)}</p>
      <div className="flex flex-wrap gap-1">
        {list.slice(0, 24).map(({ a, s: st }) => (
          <button key={aisleKey(a.zone, a.no)} type="button" className="btn btn-xs" onClick={() => onPick(a)}>
            {a.plate} <span className="text-base-content/60">{st.qty.toLocaleString("ko-KR")}</span>
          </button>
        ))}
      </div>
      {stock.truncated && <p className="text-xs text-warning">{t.stockTruncated}</p>}
    </div>
  );
}
