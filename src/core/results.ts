import { mean, std } from './math';

export interface BandRow {
  gelId: string;
  gelName: string;
  laneId: string;
  laneIndex: number;
  sample: string;
  bandId: string;
  bandIndex: number;
  targetId: string | null;
  /** 이미지 y 좌표 (전처리 후) */
  position: number;
  /** 레인 top 기준 상대 이동거리 0–1 */
  rf: number;
  height: number;
  area: number;
  volume: number;
  pctLane: number;
  /** 밴드 기울기 (px) */
  tilt: number;
  saturatedPixels: number;
  negativeFraction: number;
  amount: number | null;
  amountStatus: 'ok' | 'extrapolated' | 'invalid' | null;
}

export type SummaryValue = 'area' | 'volume' | 'amount';

export interface Stat {
  values: number[];
  mean: number;
  sd: number;
  n: number;
}

export interface SummaryCell {
  sample: string;
  targetId: string;
  raw: Stat;
  normalized: (Stat & { method: 'lane' | 'sample' }) | null;
  relative: Stat | null;
}

const stat = (values: number[]): Stat => ({ values, mean: mean(values), sd: std(values), n: values.length });

export function valueOf(row: BandRow, kind: SummaryValue): number | null {
  if (kind === 'amount') return row.amount;
  return row[kind];
}

export function summarize(
  rows: BandRow[],
  kind: SummaryValue,
  loadingControlId: string | null,
  referenceSample: string | null,
): { samples: string[]; targets: string[]; cells: SummaryCell[] } {
  const samples: string[] = [];
  const targets: string[] = [];
  for (const r of rows) {
    if (!r.targetId) continue;
    if (!samples.includes(r.sample)) samples.push(r.sample);
    if (!targets.includes(r.targetId)) targets.push(r.targetId);
  }

  // 같은 레인 안에서 같은 타깃 밴드가 여러 개면 합친다 (예: 이중 밴드)
  const laneKey = (r: BandRow) => `${r.gelId}|${r.laneId}`;
  const perLane = new Map<string, { sample: string; targetId: string; value: number; lane: string }>();
  for (const r of rows) {
    if (!r.targetId) continue;
    const v = valueOf(r, kind);
    if (v == null || !Number.isFinite(v)) continue;
    const key = `${laneKey(r)}|${r.targetId}`;
    const cur = perLane.get(key);
    if (cur) cur.value += v;
    else perLane.set(key, { sample: r.sample, targetId: r.targetId, value: v, lane: laneKey(r) });
  }
  const entries = [...perLane.values()];

  const lcByLane = new Map<string, number>();
  const lcBySample = new Map<string, number[]>();
  if (loadingControlId) {
    for (const e of entries) {
      if (e.targetId !== loadingControlId) continue;
      lcByLane.set(e.lane, e.value);
      const arr = lcBySample.get(e.sample) ?? [];
      arr.push(e.value);
      lcBySample.set(e.sample, arr);
    }
  }

  const cells: SummaryCell[] = [];
  for (const t of targets) {
    for (const s of samples) {
      const es = entries.filter((e) => e.targetId === t && e.sample === s);
      if (!es.length) continue;
      const cell: SummaryCell = { sample: s, targetId: t, raw: stat(es.map((e) => e.value)), normalized: null, relative: null };
      if (loadingControlId && t !== loadingControlId) {
        const sameLane = es.every((e) => lcByLane.has(e.lane) && lcByLane.get(e.lane)! > 0);
        if (sameLane) {
          cell.normalized = { ...stat(es.map((e) => e.value / lcByLane.get(e.lane)!)), method: 'lane' };
        } else if (lcBySample.has(s)) {
          const lcm = mean(lcBySample.get(s)!);
          if (lcm > 0) cell.normalized = { ...stat(es.map((e) => e.value / lcm)), method: 'sample' };
        }
      }
      cells.push(cell);
    }
  }

  if (referenceSample) {
    for (const t of targets) {
      const ref = cells.find((c) => c.targetId === t && c.sample === referenceSample);
      if (!ref) continue;
      const useNorm = ref.normalized != null;
      const refMean = useNorm ? ref.normalized!.mean : ref.raw.mean;
      if (!(refMean > 0)) continue;
      for (const c of cells) {
        if (c.targetId !== t) continue;
        const src = useNorm ? c.normalized : c.raw;
        if (!src) continue;
        c.relative = stat(src.values.map((v) => v / refMean));
      }
    }
  }
  return { samples, targets, cells };
}
