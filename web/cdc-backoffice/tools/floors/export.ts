// CDC 시뮬레이터(pmart-cdc-simulation) 칠곡 배치에서 층별 2D 평면도 JSON 을 뽑는다 — run.mjs 가 rolldown 으로 묶어 부른다.
// `sim` 별칭 = 시뮬레이터 src 폴더(읽기만). 3D·설비 상태·로봇은 뽑지 않는다(사용자 2026-11-25 "설비센서자산 같은 건 제외" — 설비는 자리 이름만).
// 좌표: x 동쪽·z 남쪽 m(원점 북서) — 시뮬레이터·백엔드 칸 좌표(docs/simulator/cdc/layout)와 같은 좌표계.
import { buildLayout } from 'sim/domain/layout';

type R4 = [number, number, number, number];
const r = (n: number) => Math.round(n * 100) / 100;
const rect = (x: { x0: number; z0: number; x1: number; z1: number }): R4 => [r(x.x0), r(x.z0), r(x.x1), r(x.z1)];

export function exportFloors(source: string) {
  const L = buildLayout();
  const floors = L.floors.map((f) => {
    // 통로(랙 줄 둘) — 칸 코드 앞부분 CDC01-{구역}-{층}-{통로} 로 서버 칸 재고를 부른다
    const aisles = f.aisles.map((a) => {
      const rows = f.rows.filter((x) => x.zone === a.zone && x.aisle === a.no);
      const z0 = Math.min(...rows.map((x) => x.z0));
      const z1 = Math.max(...rows.map((x) => x.z1));
      return { zone: a.zone, temp: a.temp, no: a.no, plate: a.plate, cx: r(a.cx), z0: r(z0), z1: r(z1), levels: rows[0]?.levels ?? 0, kind: 'RACK' as const };
    });
    const shelfAisles = f.shelfAisles.map((a) => {
      const rows = f.shelfRows.filter((x) => x.zone === a.zone && x.aisle === a.no);
      const z0 = a.z0 ?? Math.min(...rows.map((x) => x.z0));
      const z1 = a.z1 ?? Math.max(...rows.map((x) => x.z1));
      return { zone: a.zone, temp: a.temp, no: a.no, plate: a.plate, cx: r(a.cx), z0: r(z0), z1: r(z1), levels: 0, kind: 'SHELF' as const };
    });
    return {
      floor: String(f.floor),
      label: f.label,
      zones: f.zones.map((z) => ({ id: z.id, label: z.label, temp: z.temp, kind: z.kind, rect: rect(z.rect) })),
      coldRooms: f.coldRooms.map((c) => ({ temp: c.temp, label: c.label, rects: c.rects.map(rect) })),
      rows: f.rows.map((x) => ({ zone: x.zone, aisle: x.aisle, side: x.side, cx: r(x.cx), z0: r(x.z0), z1: r(x.z1), temp: x.temp })),
      shelfRows: f.shelfRows.map((x) => ({ zone: x.zone, aisle: x.aisle, side: x.side, cx: r(x.cx), z0: r(x.z0), z1: r(x.z1), temp: x.temp })),
      aisles: [...aisles, ...shelfAisles],
      lifts: f.lifts.map((l) => ({ no: l.no, code: l.code, rect: rect(l.rect) })),
      staging: [...new Map(f.staging.map((s) => [`${s.zone}-${s.aisle}`, { zone: s.zone, aisle: s.aisle, code: s.code.split('-').slice(0, 4).join('-') }])).values()],
      areas: f.equipment.map((e) => ({ label: e.label, rect: rect(e.rect) })),
    };
  });
  const json = { centerId: 'CDC01', source, width: r(L.width), depth: r(L.depth), floors };
  return [{ id: 'CDC01', json, summary: `CDC01: 층 ${floors.length} · 통로 ${floors.reduce((a, f) => a + f.aisles.length, 0)} · ${r(L.width)}×${r(L.depth)}m` }];
}
