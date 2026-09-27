import type { Band, BandDetection, NegativeHandling } from './types';
import { gaussianSmooth } from './math';

export interface PeakRange {
  start: number;
  end: number;
  peak: number;
}

/** (프로파일 − 베이스라인) 신호에서 밴드 후보를 찾는다 */
export function detectBands(signal: Float64Array, opts: BandDetection): PeakRange[] {
  const n = signal.length;
  if (n < 5) return [];
  const s = gaussianSmooth(signal, opts.smoothing);
  let max = 0;
  for (let i = 0; i < n; i++) if (s[i] > max) max = s[i];
  if (max <= 0) return [];
  const minProm = (opts.minProminencePct / 100) * max;

  const peaks: { i: number; prom: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(s[i] > s[i - 1] && s[i] >= s[i + 1])) continue;
    // plateau 처리: 같은 값이 이어지면 가운데를 피크로
    let j = i;
    while (j + 1 < n && s[j + 1] === s[i]) j++;
    const center = (i + j) >> 1;
    let lmin = s[i];
    for (let k = i - 1; k >= 0 && s[k] <= s[i]; k--) if (s[k] < lmin) lmin = s[k];
    let rmin = s[i];
    for (let k = j + 1; k < n && s[k] <= s[i]; k++) if (s[k] < rmin) rmin = s[k];
    const prom = s[i] - Math.max(lmin, rmin);
    if (prom >= minProm && s[i] > 0) peaks.push({ i: center, prom });
    i = j;
  }

  const ranges: PeakRange[] = peaks.map(({ i }) => {
    const thr = (opts.edgePct / 100) * s[i];
    let a = i;
    while (a > 0 && s[a - 1] > thr && s[a - 1] <= s[a] + 1e-12) a--;
    let b = i;
    while (b < n - 1 && s[b + 1] > thr && s[b + 1] <= s[b] + 1e-12) b++;
    return { start: a, end: b, peak: i };
  });

  // 겹치는 구간은 두 피크 사이 최솟값 위치에서 나눈다
  ranges.sort((p, q) => p.peak - q.peak);
  for (let k = 0; k < ranges.length - 1; k++) {
    const A = ranges[k], B = ranges[k + 1];
    if (A.end >= B.start) {
      let m = A.peak;
      for (let t = A.peak; t <= B.peak; t++) if (s[t] < s[m]) m = t;
      A.end = Math.max(A.peak, m - 1);
      B.start = Math.min(B.peak, m);
    }
  }
  return ranges.filter((r) => r.end - r.start >= 2);
}

export interface BandMeasure {
  bandId: string;
  start: number;
  end: number;
  /** 프로파일 인덱스 기준 신호 최대 위치 */
  peak: number;
  height: number;
  /** Σ(profile − baseline). 평균 프로파일 기준 */
  area: number;
  /** area × 사용한 열 수 = 적분 밀도 (Image Lab의 volume과 같은 개념) */
  volume: number;
  /** 음수 신호 비율 (베이스라인이 프로파일 위로 올라간 정도) */
  negativeFraction: number;
  saturatedPixels: number;
}

export function measureBand(
  band: Band,
  profile: Float64Array,
  baseline: Float64Array,
  saturated: Uint16Array,
  columns: number,
  negative: NegativeHandling,
): BandMeasure {
  const n = profile.length;
  const s = Math.max(0, Math.min(n - 1, Math.round(band.start)));
  const e = Math.max(s, Math.min(n - 1, Math.round(band.end)));
  let area = 0, neg = 0, posSum = 0, height = -Infinity, peak = s, sat = 0;
  for (let i = s; i <= e; i++) {
    const v = profile[i] - baseline[i];
    if (v < 0) neg += -v; else posSum += v;
    area += negative === 'clip' && v < 0 ? 0 : v;
    if (v > height) { height = v; peak = i; }
    sat += saturated[i] ?? 0;
  }
  return {
    bandId: band.id, start: s, end: e, peak, height,
    area, volume: area * columns,
    negativeFraction: neg / Math.max(neg + posSum, 1e-12),
    saturatedPixels: sat,
  };
}
