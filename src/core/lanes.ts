import { gaussianSmooth, slidingExtreme } from './math';

export interface LaneGuess {
  cx: number;
  width: number;
  top: number;
  bottom: number;
}

/**
 * 신호 이미지(밴드가 밝음)에서 세로 레인을 추정한다.
 *
 * 1) 열마다 "밴드다움" 점수를 만든다 (행 배경 제거 → 상위 신호 + 평균 → √ 압축)
 * 2) 점수가 문턱을 넘는 구간을 레인 덩어리로 보고, 레인 사이 골짜기에서 나눈다
 *    (레인이 붙어 있어 점수가 평평한 겔에서도 동작한다)
 * 3) 레인 세로 범위는 행 방향 신호로 정한다
 */
export function detectLanes(data: Float32Array, w: number, h: number, expected?: number): LaneGuess[] {
  const score = columnScore(data, w, h);
  const smooth = gaussianSmooth(score, Math.max(1, w / 200));
  // 1) 가로 방향의 완만한 밝기 변화(비네팅 등)를 뺀다 — 이런 변화는 신호에 더해지는 성분이다
  const floor = slidingExtreme(smooth, Math.max(5, Math.round(w / 8)), 'min');
  const d = new Float64Array(w);
  for (let x = 0; x < w; x++) d[x] = Math.max(0, smooth[x] - floor[x]);

  const sorted = Float64Array.from(d).sort();
  const strong = sorted[Math.round(0.97 * (w - 1))];
  if (strong < 1e-9) return [];

  // 2) 로그로 압축해 진한 레인과 흐린 레인을 비슷한 크기로 만든다 (0~1)
  const K = 100;
  const s = new Float64Array(w);
  for (let x = 0; x < w; x++) s[x] = Math.log1p(Math.min(d[x] / strong, 1.2) * K) / Math.log1p(K);

  // 3) 봉우리(=레인)를 prominence로 고른다. 레인이 붙어 평평해도 골짜기만 뚜렷하면 나뉜다
  let peaks = findPeaks(s, 0.15, 0.2, Math.max(3, Math.round(w / 150)));
  if (!peaks.length) return [];

  if (expected && expected !== peaks.length) {
    if (expected < peaks.length) {
      peaks = peaks.slice().sort((a, b) => b.prominence - a.prominence).slice(0, expected).sort((a, b) => a.x - b.x);
    } else {
      // 더 찾아야 하면 문턱을 낮춰 다시 고른다
      for (const prom of [0.1, 0.06, 0.03, 0.015]) {
        const more = findPeaks(s, prom, 0.12, Math.max(3, Math.round(w / 200)));
        if (more.length >= expected) {
          peaks = more.slice().sort((a, b) => b.prominence - a.prominence).slice(0, expected).sort((a, b) => a.x - b.x);
          break;
        }
        peaks = more;
      }
    }
  }

  // 4) 이웃 봉우리 사이의 최솟값을 경계로 삼아 레인 폭을 정한다
  const cuts: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    let m = peaks[i - 1].x;
    for (let x = peaks[i - 1].x; x <= peaks[i].x; x++) if (s[x] < s[m]) m = x;
    cuts.push(m);
  }
  // 폭과 중심은 압축 전 값(d)의 반치 구간으로 잡는다 (압축된 곡선은 골짜기가 덜 내려가 폭이 커진다)
  const halfWidths: number[] = [];
  const centers = peaks.map((p, i) => {
    const lo = i === 0 ? 0 : cuts[i - 1];
    const hi2 = i === peaks.length - 1 ? w - 1 : cuts[i];
    const half = d[p.x] / 2;
    let a = p.x, b = p.x;
    while (a > lo && d[a - 1] > half) a--;
    while (b < hi2 && d[b + 1] > half) b++;
    halfWidths.push(b - a + 1);
    return (a + b) / 2;
  });
  halfWidths.sort((a, b) => a - b);
  const medSpan = halfWidths[Math.floor(halfWidths.length / 2)];
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  gaps.sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : medSpan;
  const width = Math.max(4, Math.round(Math.min(medSpan, pitch * 0.92)));
  const { top, bottom } = verticalSpan(data, w, h, centers, width);
  return centers.map((cx) => ({ cx: Math.round(cx), width, top, bottom }));
}

interface Peak { x: number; value: number; prominence: number }

/** prominence 기반 봉우리 찾기 (평평한 구간에서는 가운데를 봉우리로) */
function findPeaks(s: Float64Array, minProminence: number, minValue: number, minDistance: number): Peak[] {
  const n = s.length;
  const out: Peak[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(s[i] >= s[i - 1] && s[i] >= s[i + 1])) continue;
    let j = i;
    while (j + 1 < n && s[j + 1] === s[i]) j++;
    if (j + 1 < n && s[j + 1] > s[i]) { i = j; continue; }
    const x = (i + j) >> 1;
    let lmin = s[x];
    for (let k = x - 1; k >= 0 && s[k] <= s[x]; k--) lmin = Math.min(lmin, s[k]);
    let rmin = s[x];
    for (let k = j + 1; k < n && s[k] <= s[x]; k++) rmin = Math.min(rmin, s[k]);
    const prominence = s[x] - Math.max(lmin, rmin);
    if (s[x] >= minValue && prominence >= minProminence) out.push({ x, value: s[x], prominence });
    i = j;
  }
  // 너무 가까운 봉우리는 큰 쪽만 남긴다
  const kept: Peak[] = [];
  for (const p of [...out].sort((a, b) => b.prominence - a.prominence)) {
    if (kept.every((q) => Math.abs(q.x - p.x) >= minDistance)) kept.push(p);
  }
  return kept.sort((a, b) => a.x - b.x);
}

/** 열마다의 "밴드다움" 점수 */
function columnScore(data: Float32Array, w: number, h: number): Float64Array {
  const rowStep = Math.max(1, Math.floor(h / 600));
  const rows: number[] = [];
  for (let y = 0; y < h; y += rowStep) rows.push(y);
  // 행마다 하위 10% 값을 빼서 세로 방향 배경 기울기를 제거
  // (레인이 폭의 절반 이상을 차지하면 중앙값은 밴드 값이 되므로 하위 백분위수를 쓴다)
  const resid = new Float32Array(rows.length * w);
  const tmp = new Float64Array(w);
  rows.forEach((y, r) => {
    for (let x = 0; x < w; x++) tmp[x] = data[y * w + x];
    const sorted = Float64Array.from(tmp).sort();
    const base = sorted[Math.floor(w * 0.1)];
    for (let x = 0; x < w; x++) resid[r * w + x] = tmp[x] - base;
  });
  const score = new Float64Array(w);
  const col = new Float64Array(rows.length);
  const topK = Math.max(1, Math.round(rows.length * 0.04));
  for (let x = 0; x < w; x++) {
    for (let r = 0; r < rows.length; r++) col[r] = resid[r * w + x];
    col.sort();
    let s = 0;
    for (let k = 1; k <= topK; k++) s += col[rows.length - k];
    let m = 0;
    for (let r = 0; r < rows.length; r++) m += col[r];
    // 로그로 압축해 약한 레인도 진한 레인과 함께 잡히게 한다
    score[x] = Math.log1p(Math.max(0, s / topK + m / rows.length));
  }
  return score;
}

/** 레인 세로 범위 */
function verticalSpan(data: Float32Array, w: number, h: number, centers: number[], width: number) {
  const rowScore = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (const c of centers) {
      const a = Math.max(0, Math.round(c - width / 4)), b = Math.min(w - 1, Math.round(c + width / 4));
      for (let x = a; x <= b; x++) s += data[y * w + x];
    }
    rowScore[y] = s;
  }
  const rs = gaussianSmooth(rowScore, Math.max(1, h / 200));
  const rfloor = slidingExtreme(rs, Math.max(3, Math.round(h / 4)), 'min');
  let rmax = 0;
  const rsig = new Float64Array(h);
  for (let y = 0; y < h; y++) { rsig[y] = rs[y] - rfloor[y]; if (rsig[y] > rmax) rmax = rsig[y]; }
  let top = 0, bottom = h;
  if (rmax > 0) {
    while (top < h - 1 && rsig[top] < 0.05 * rmax) top++;
    bottom = h - 1;
    while (bottom > top && rsig[bottom] < 0.05 * rmax) bottom--;
    const pad = Math.round(h * 0.04);
    top = Math.max(0, top - pad);
    bottom = Math.min(h, bottom + pad);
    if (bottom - top < h * 0.15) { top = Math.round(h * 0.02); bottom = Math.round(h * 0.98); }
  }
  return { top, bottom };
}
