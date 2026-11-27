// ImageJ BackgroundSubtracter (rolling ball / sliding paraboloid) 포팅.
// 입력은 "밴드가 밝은(값이 큰)" 신호 이미지. 반환값은 추정 배경.
import type { Background2D } from '../types';
import { gaussianBlur, percentile } from './preprocess';

export interface Bg2DOptions {
  method: 'rolling-ball' | 'paraboloid';
  radius: number;
  presmooth: boolean;
  onProgress?: (fraction: number) => void;
}

export function estimateBackground2D(
  src: Float32Array,
  width: number,
  height: number,
  opts: Bg2DOptions,
): Float32Array {
  const bg = new Float32Array(src);
  let shiftBy = 0;
  if (opts.presmooth) {
    shiftBy = filter3x3(bg, width, height, 'max');
    filter3x3(bg, width, height, 'mean');
  }
  opts.onProgress?.(0.1);
  if (opts.method === 'rolling-ball') {
    rollingBall(bg, width, height, opts.radius, opts.onProgress);
  } else {
    slidingParaboloid(bg, width, height, opts.radius, opts.onProgress);
  }
  if (opts.presmooth) {
    // 최댓값 필터로 올라간 평균량을 되돌리고, 배경이 원본보다 높지 않게 제한
    for (let i = 0; i < bg.length; i++) {
      const v = bg[i] - shiftBy;
      bg[i] = v > src[i] ? src[i] : v;
    }
  }
  opts.onProgress?.(1);
  return bg;
}

/** 3×3 필터를 행, 열 순서로 분리 적용. max일 때 평균 증가량을 반환 */
function filter3x3(px: Float32Array, w: number, h: number, type: 'max' | 'mean'): number {
  const before = type === 'max' ? sum(px) : 0;
  for (let y = 0; y < h; y++) filter3(px, w, y * w, 1, type);
  for (let x = 0; x < w; x++) filter3(px, h, x, w, type);
  return type === 'max' ? (sum(px) - before) / px.length : 0;
}

function sum(a: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

function filter3(px: Float32Array, length: number, p0: number, inc: number, type: 'max' | 'mean') {
  let v3 = px[p0];
  let v2 = v3;
  let v1: number;
  for (let i = 0, p = p0; i < length; i++, p += inc) {
    v1 = v2;
    v2 = v3;
    if (i < length - 1) v3 = px[p + inc];
    if (type === 'max') {
      let m = v1 > v3 ? v1 : v3;
      if (v2 > m) m = v2;
      px[p] = m;
    } else {
      px[p] = (v1 + v2 + v3) / 3;
    }
  }
}

// ---------------- Rolling ball ----------------

export function ballParams(radius: number) {
  if (radius <= 10) return { shrink: 1, arcTrimPer: 24 };
  if (radius <= 30) return { shrink: 2, arcTrimPer: 24 };
  if (radius <= 100) return { shrink: 4, arcTrimPer: 32 };
  return { shrink: 8, arcTrimPer: 40 };
}

function buildBall(radius: number, shrink: number, arcTrimPer: number) {
  let r = radius / shrink;
  if (r < 1) r = 1;
  const r2 = r * r;
  const xtrim = Math.trunc((arcTrimPer * r) / 100);
  const half = Math.round(r - xtrim);
  const width = 2 * half + 1;
  const data = new Float32Array(width * width);
  for (let y = 0, p = 0; y < width; y++) {
    for (let x = 0; x < width; x++, p++) {
      const xv = x - half, yv = y - half;
      const t = r2 - xv * xv - yv * yv;
      data[p] = t > 0 ? Math.sqrt(t) : 0;
    }
  }
  return { data, width };
}

function rollingBall(px: Float32Array, w: number, h: number, radius: number, onProgress?: (f: number) => void) {
  const { shrink: requested, arcTrimPer } = ballParams(radius);
  // 축소 후 크기가 너무 작으면 축소하지 않는다
  const shrink = Math.floor(w / requested) >= 2 && Math.floor(h / requested) >= 2 ? requested : 1;
  const ball = buildBall(radius, shrink, arcTrimPer);
  if (shrink > 1) {
    const sw = Math.ceil(w / shrink), sh = Math.ceil(h / shrink);
    const small = new Float32Array(sw * sh);
    for (let ys = 0; ys < sh; ys++) {
      for (let xs = 0; xs < sw; xs++) {
        let m = Infinity;
        for (let y = ys * shrink, ye = Math.min(h, y + shrink); y < ye; y++) {
          for (let x = xs * shrink, xe = Math.min(w, x + shrink); x < xe; x++) {
            const v = px[y * w + x];
            if (v < m) m = v;
          }
        }
        small[ys * sw + xs] = m;
      }
    }
    rollBall(ball, small, sw, sh, onProgress);
    enlarge(small, sw, sh, px, w, h, shrink);
  } else {
    rollBall(ball, px, w, h, onProgress);
  }
}

function rollBall(ball: { data: Float32Array; width: number }, px: Float32Array, w: number, h: number, onProgress?: (f: number) => void) {
  const zBall = ball.data;
  const bw = ball.width;
  const radius = bw >> 1;
  const cache = new Float32Array(w * bw);
  for (let y = -radius; y < h + radius; y++) {
    const nextLineToWrite = (y + radius) % bw;
    const nextLineToRead = y + radius;
    if (nextLineToRead < h) {
      cache.set(px.subarray(nextLineToRead * w, nextLineToRead * w + w), nextLineToWrite * w);
      px.fill(-Infinity, nextLineToRead * w, nextLineToRead * w + w);
    }
    const y0 = Math.max(0, y - radius);
    const yBall0 = y0 - y + radius;
    const yend = Math.min(h - 1, y + radius);
    for (let x = -radius; x < w + radius; x++) {
      let z = Infinity;
      const x0 = Math.max(0, x - radius);
      const xBall0 = x0 - x + radius;
      const xend = Math.min(w - 1, x + radius);
      for (let yp = y0, yb = yBall0; yp <= yend; yp++, yb++) {
        let cp = (yp % bw) * w + x0;
        for (let xp = x0, bp = xBall0 + yb * bw; xp <= xend; xp++, cp++, bp++) {
          const zr = cache[cp] - zBall[bp];
          if (z > zr) z = zr;
        }
      }
      for (let yp = y0, yb = yBall0; yp <= yend; yp++, yb++) {
        for (let xp = x0, p = xp + yp * w, bp = xBall0 + yb * bw; xp <= xend; xp++, p++, bp++) {
          const zMin = z + zBall[bp];
          if (px[p] < zMin) px[p] = zMin;
        }
      }
    }
    if (onProgress && (y & 31) === 0) onProgress(0.1 + 0.8 * ((y + radius) / (h + 2 * radius)));
  }
}

function interpArrays(length: number, smallLength: number, shrink: number) {
  const idx = new Int32Array(length);
  const wts = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let si = Math.trunc((i - Math.trunc(shrink / 2)) / shrink);
    if (si >= smallLength - 1) si = smallLength - 2;
    if (si < 0) si = 0;
    idx[i] = si;
    const distance = (i + 0.5) / shrink - (si + 0.5);
    wts[i] = 1 - distance;
  }
  return { idx, wts };
}

function enlarge(small: Float32Array, sw: number, sh: number, out: Float32Array, w: number, h: number, shrink: number) {
  const xi = interpArrays(w, sw, shrink);
  const yi = interpArrays(h, sh, shrink);
  const rowAt = (sy: number, line: Float32Array) => {
    const base = sy * sw;
    for (let x = 0; x < w; x++) {
      const k = xi.idx[x];
      line[x] = small[base + k] * xi.wts[x] + small[base + k + 1] * (1 - xi.wts[x]);
    }
  };
  const line0 = new Float32Array(w);
  const line1 = new Float32Array(w);
  let cur = -1;
  for (let y = 0; y < h; y++) {
    const sy = yi.idx[y];
    if (sy !== cur) {
      rowAt(sy, line0);
      rowAt(sy + 1, line1);
      cur = sy;
    }
    const wt = yi.wts[y];
    for (let x = 0, p = y * w; x < w; x++, p++) out[p] = line0[x] * wt + line1[x] * (1 - wt);
  }
}

// ---------------- Sliding paraboloid ----------------

function slidingParaboloid(px: Float32Array, w: number, h: number, radius: number, onProgress?: (f: number) => void) {
  const coeff2 = 0.5 / radius;
  const coeff2diag = 1 / radius;
  const maxLen = Math.max(w, h);
  const cache = new Float32Array(maxLen);
  const next = new Int32Array(maxLen);
  const line = new Float32Array(maxLen);
  const idx = new Int32Array(maxLen);

  const passes: Array<[string, number]> = [
    ['x', coeff2], ['y', coeff2], ['x', coeff2],
    ['d1', coeff2diag], ['d2', coeff2diag], ['d1', coeff2diag], ['d2', coeff2diag],
  ];
  passes.forEach(([dir, c], pi) => {
    const run = (count: number) => {
      for (let i = 0; i < count; i++) line[i] = px[idx[i]];
      slideParabola(line, count, c, cache, next);
      for (let i = 0; i < count; i++) px[idx[i]] = line[i];
    };
    if (dir === 'x') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) idx[x] = y * w + x;
        run(w);
      }
    } else if (dir === 'y') {
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) idx[y] = y * w + x;
        run(h);
      }
    } else {
      // 대각선: 시작점을 윗변과 옆변에서 잡는다
      const down = dir === 'd1';
      for (let s = -(h - 1); s < w; s++) {
        let count = 0;
        for (let y = 0; y < h; y++) {
          const x = down ? s + y : w - 1 - s - y;
          if (x >= 0 && x < w) idx[count++] = y * w + x;
        }
        if (count >= 3) run(count);
      }
    }
    onProgress?.(0.1 + 0.8 * ((pi + 1) / passes.length));
  });
}

/** 한 줄 위에서 아래로부터 포물선을 밀어 올려 닿는 궤적으로 값을 바꾼다 (in-place) */
export function slideParabola(v: Float32Array, length: number, coeff2: number, cache: Float32Array, next: Int32Array) {
  if (length < 3) return;
  let minValue = Infinity;
  let last = 0;
  let p1 = 0, p2 = 0;
  const curvatureTest = 1.999 * coeff2;
  for (let i = 0; i < length; i++) {
    const x = v[i];
    cache[i] = x;
    if (x < minValue) minValue = x;
    if (i >= 2 && p1 + p1 - p2 - x < curvatureTest) {
      next[last] = i - 1;
      last = i - 1;
    }
    p2 = p1;
    p1 = x;
  }
  next[last] = length - 1;
  next[length - 1] = 0x7fffffff;

  let i1 = 0;
  while (i1 < length - 1) {
    const v1 = cache[i1];
    let minSlope = Infinity;
    let i2 = 0;
    let searchTo = length;
    let recalc = 0;
    for (let j = next[i1]; j < searchTo; j = next[j], recalc++) {
      const v2 = cache[j];
      const slope = (v2 - v1) / (j - i1) + coeff2 * (j - i1);
      if (slope < minSlope) {
        minSlope = slope;
        i2 = j;
        recalc = -3;
      }
      if (recalc === 0) {
        const b = (0.5 * minSlope) / coeff2;
        const maxSearch = i1 + Math.trunc(b + Math.sqrt(b * b + (v1 - minValue) / coeff2) + 1);
        if (maxSearch < searchTo && maxSearch > 0) searchTo = maxSearch;
      }
    }
    if (i2 <= i1) i2 = length - 1;
    for (let j = i1 + 1; j < i2; j++) v[j] = v1 + (j - i1) * (minSlope - (j - i1) * coeff2);
    i1 = i2;
  }
}

/**
 * 신호 이미지에서 배경을 빼서 그 자리에서 바꾸고, 실제로 뺀 양을 돌려준다(배경 제거 안 함이면 null).
 * - rolling-ball / paraboloid: ImageJ 방식. 배경 전체를 0으로 맞춘다.
 * - constant: 신호가 낮은 쪽 constantPct %의 값 하나를 통째로 뺀다 (TotalLab의 Constant와 같은 개념). 0 아래로는 내려가지 않는다.
 * - flatten: 롤링볼로 추정한 배경에서 평균 밝기를 뺀 "변동분"만 제거한다. 얼룩은 고르게 하고 전체 배경 밝기는 유지한다.
 * strength(0~100%)는 추정한 배경 중 얼마를 뺄지 정한다.
 */
export function removeBackground(
  signal: Float32Array,
  width: number,
  height: number,
  b: Background2D,
  onProgress?: (fraction: number) => void,
): Float32Array | null {
  if (b.method === 'none') return null;
  const k = Math.min(1, Math.max(0, (b.strength ?? 100) / 100));
  let bg: Float32Array;
  let clampAtZero = false;
  if (b.method === 'constant') {
    const pct = Math.min(100, Math.max(0, b.constantPct ?? 10));
    bg = new Float32Array(signal.length).fill(percentile(signal, pct, pct)[0]);
    clampAtZero = true;
  } else {
    bg = estimateBackground2D(signal, width, height, {
      method: b.method === 'paraboloid' ? 'paraboloid' : 'rolling-ball',
      radius: Math.max(1, b.radius),
      presmooth: b.presmooth,
      onProgress,
    });
    if (b.method === 'flatten') {
      // 롤링볼 배경은 레인 사이 같은 국소 구조를 따라가 얼룩져 보이므로, 크게 뭉갠 매끈한 면으로 바꾼 뒤 평균을 뺀다
      bg = smoothSurface(bg, width, height, Math.max(1, b.radius));
      const mean = sum(bg) / bg.length;
      for (let i = 0; i < bg.length; i++) bg[i] -= mean;
    }
  }
  for (let i = 0; i < signal.length; i++) {
    const applied = bg[i] * k;
    bg[i] = applied;
    const v = signal[i] - applied;
    signal[i] = clampAtZero && v < 0 ? 0 : v;
  }
  return bg;
}

/** 배경 면을 축소 → 가우시안 → 쌍선형 확대로 매끈하게 만든다. sigmaPx는 대략 뭉개는 크기(px). */
function smoothSurface(src: Float32Array, w: number, h: number, sigmaPx: number): Float32Array {
  const s = Math.max(2, Math.min(32, Math.round(sigmaPx / 3)));
  const sw = Math.max(1, Math.ceil(w / s)), sh = Math.max(1, Math.ceil(h / s));
  const small = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / s) * sw;
    for (let x = 0; x < w; x++) { const k = row + Math.floor(x / s); small[k] += src[y * w + x]; cnt[k]++; }
  }
  for (let i = 0; i < small.length; i++) small[i] /= cnt[i] || 1;
  const blurred = gaussianBlur(small, sw, sh, 3);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / s - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / s - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const top = blurred[y0 * sw + x0] * (1 - tx) + blurred[y0 * sw + x1] * tx;
      const bot = blurred[y1 * sw + x0] * (1 - tx) + blurred[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
