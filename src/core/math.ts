// 수치 유틸: 평활, 대칭 밴드 행렬 Cholesky, 다항식 적합, 통계

export function gaussianSmooth(y: ArrayLike<number>, sigma: number): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  if (sigma <= 0.25) {
    for (let i = 0; i < n; i++) out[i] = y[i];
    return out;
  }
  const r = Math.ceil(sigma * 3);
  const k = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let j = -r; j <= r; j++) {
      const t = i + j;
      if (t < 0 || t >= n) continue;
      s += y[t] * k[j + r];
      ws += k[j + r];
    }
    out[i] = s / ws;
  }
  return out;
}

export function movingAverage(y: ArrayLike<number>, half: number): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  if (half < 1) {
    for (let i = 0; i < n; i++) out[i] = y[i];
    return out;
  }
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + y[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

/** 슬라이딩 최솟값/최댓값 (van Herk / deque) */
export function slidingExtreme(y: ArrayLike<number>, half: number, kind: 'min' | 'max'): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  const better = kind === 'min' ? (a: number, b: number) => a <= b : (a: number, b: number) => a >= b;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + half);
    while (next <= hi) {
      while (tail > head && better(y[next], y[dq[tail - 1]])) tail--;
      dq[tail++] = next++;
    }
    while (dq[head] < i - half) head++;
    out[i] = y[dq[head]];
  }
  return out;
}

export function slidingMedian(y: ArrayLike<number>, half: number): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  const win: number[] = [];
  const insert = (v: number) => {
    let lo = 0, hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
    win.splice(lo, 0, v);
  };
  const remove = (v: number) => {
    let lo = 0, hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
    win.splice(lo, 1);
  };
  let a = 0, b = -1;
  for (let i = 0; i < n; i++) {
    const na = Math.max(0, i - half), nb = Math.min(n - 1, i + half);
    while (b < nb) insert(y[++b]);
    while (a < na) remove(y[a++]);
    const m = win.length;
    out[i] = m % 2 ? win[m >> 1] : 0.5 * (win[m / 2 - 1] + win[m / 2]);
  }
  return out;
}

/** DᵀD (차분 차수 d)의 대칭 밴드 표현: bands[k][i] = A[i, i+k] */
export function differenceGram(n: number, d: number): Float64Array[] {
  const coef = diffCoefficients(d);
  const bands = Array.from({ length: d + 1 }, () => new Float64Array(n));
  for (let r = 0; r + d < n; r++) {
    for (let a = 0; a <= d; a++) {
      for (let b = a; b <= d; b++) bands[b - a][r + a] += coef[a] * coef[b];
    }
  }
  return bands;
}

function diffCoefficients(d: number): number[] {
  let c = [1];
  for (let k = 0; k < d; k++) {
    const next = new Array(c.length + 1).fill(0);
    for (let i = 0; i < c.length; i++) { next[i] -= c[i]; next[i + 1] += c[i]; }
    c = next;
  }
  return c;
}

/**
 * (diag(w) + lam·DᵀD) z = w·y 를 밴드 Cholesky로 O(n·d²)에 푼다.
 * extraDiag/extraBands로 추가 항을 더할 수 있다.
 */
export function solveWhittaker(w: ArrayLike<number>, rhs: ArrayLike<number>, lam: number, gram: Float64Array[]): Float64Array {
  const n = rhs.length;
  const p = gram.length - 1;
  const bw = p + 1;
  // L을 행 우선으로 저장: L[i, i-p..i] → Lb[i*bw + (j - i + p)]
  const L = new Float64Array(n * bw);
  const A = (i: number, j: number) => {
    // j <= i
    const k = i - j;
    const v = lam * gram[k][j];
    return k === 0 ? v + w[i] + 1e-12 : v;
  };
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - p);
    for (let j = j0; j <= i; j++) {
      let s = A(i, j);
      const k0 = Math.max(j0, j - p);
      for (let k = k0; k < j; k++) s -= L[i * bw + (k - i + p)] * L[j * bw + (k - j + p)];
      if (j === i) {
        L[i * bw + p] = Math.sqrt(Math.max(s, 1e-300));
      } else {
        L[i * bw + (j - i + p)] = s / L[j * bw + p];
      }
    }
  }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = w[i] * rhs[i];
    for (let k = Math.max(0, i - p); k < i; k++) s -= L[i * bw + (k - i + p)] * z[k];
    z[i] = s / L[i * bw + p];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k <= Math.min(n - 1, i + p); k++) s -= L[k * bw + (i - k + p)] * z[k];
    z[i] = s / L[i * bw + p];
  }
  return z;
}

/** 가중 다항식 최소제곱. x는 [-1, 1]로 스케일해 조건수를 낮춘다 */
export function polyFit(x: ArrayLike<number>, y: ArrayLike<number>, order: number, w?: ArrayLike<number>) {
  const n = y.length;
  let xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < n; i++) { if (x[i] < xmin) xmin = x[i]; if (x[i] > xmax) xmax = x[i]; }
  const mid = (xmin + xmax) / 2;
  const half = (xmax - xmin) / 2 || 1;
  const m = order + 1;
  const G = new Float64Array(m * m);
  const b = new Float64Array(m);
  const pw = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const t = (x[i] - mid) / half;
    const wi = w ? w[i] : 1;
    pw[0] = 1;
    for (let k = 1; k < m; k++) pw[k] = pw[k - 1] * t;
    for (let r = 0; r < m; r++) {
      b[r] += wi * pw[r] * y[i];
      for (let c = 0; c < m; c++) G[r * m + c] += wi * pw[r] * pw[c];
    }
  }
  const coef = solveDense(G, b, m);
  return {
    coef,
    evaluate: (xv: number) => {
      const t = (xv - mid) / half;
      let s = 0;
      for (let k = m - 1; k >= 0; k--) s = s * t + coef[k];
      return s;
    },
  };
}

/** 부분 피벗 가우스 소거 */
export function solveDense(A: Float64Array, b: Float64Array, m: number): Float64Array {
  const M = new Float64Array(A);
  const v = new Float64Array(b);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r * m + c]) > Math.abs(M[piv * m + c])) piv = r;
    if (piv !== c) {
      for (let k = 0; k < m; k++) { const t = M[c * m + k]; M[c * m + k] = M[piv * m + k]; M[piv * m + k] = t; }
      const t = v[c]; v[c] = v[piv]; v[piv] = t;
    }
    const d = M[c * m + c] || 1e-300;
    for (let r = c + 1; r < m; r++) {
      const f = M[r * m + c] / d;
      if (!f) continue;
      for (let k = c; k < m; k++) M[r * m + k] -= f * M[c * m + k];
      v[r] -= f * v[c];
    }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = v[r];
    for (let k = r + 1; k < m; k++) s -= M[r * m + k] * x[k];
    x[r] = s / (M[r * m + r] || 1e-300);
  }
  return x;
}

export function mean(a: ArrayLike<number>): number {
  if (!a.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

export function std(a: ArrayLike<number>, ddof = 1): number {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - ddof));
}

export function minMax(a: ArrayLike<number>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

export function relativeDifference(oldA: ArrayLike<number>, newA: ArrayLike<number>): number {
  let num = 0, den = 0;
  for (let i = 0; i < oldA.length; i++) { num += (newA[i] - oldA[i]) ** 2; den += oldA[i] ** 2; }
  return Math.sqrt(num) / Math.max(Math.sqrt(den), 1e-300);
}
