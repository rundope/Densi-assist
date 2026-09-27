import type { CalibrationModel, CalibrationWeighting } from './types';
import { solveDense } from './math';

export interface FitResult {
  model: CalibrationModel;
  params: number[];
  n: number;
  r2: number;
  adjR2: number;
  rmse: number;
  /** 잔차 표준편차 기반 검출/정량 한계 (선형 계열만) */
  lod: number | null;
  loq: number | null;
  xmin: number;
  xmax: number;
  predict: (x: number) => number;
  inverse: (y: number) => number | null;
  equation: string;
}

export const MODEL_INFO: Record<CalibrationModel, { label: string; formula: string; minPoints: number; note: string }> = {
  linear: { label: '선형', formula: 'y = a + b·x', minPoints: 2, note: '선형 범위 안에서 가장 기본적인 모델.' },
  'linear-origin': { label: '선형 (원점 통과)', formula: 'y = b·x', minPoints: 1, note: '양이 0일 때 신호가 0이라고 확신할 수 있을 때.' },
  quadratic: { label: '2차', formula: 'y = a + b·x + c·x²', minPoints: 3, note: '높은 농도에서 신호가 약간 둔화될 때.' },
  power: { label: '거듭제곱 (log–log 선형)', formula: 'y = a·xᵇ', minPoints: 2, note: '범위가 여러 자릿수에 걸칠 때. x, y > 0 필요.' },
  log: { label: '로그', formula: 'y = a + b·ln x', minPoints: 2, note: '신호가 로그 형태로 포화될 때 (GelAnalyzer linear-log).' },
  '4pl': { label: '4-parameter logistic', formula: 'y = d + (a − d) / (1 + (x/c)ᵇ)', minPoints: 4, note: 'S자 곡선. 넓은 범위와 상·하한 포화를 모두 설명. 점 5개 이상 권장.' },
};

function weightsFor(x: number[], weighting: CalibrationWeighting) {
  return x.map((v) => (weighting === '1/x' ? 1 / Math.max(Math.abs(v), 1e-12) : weighting === '1/x2' ? 1 / Math.max(v * v, 1e-24) : 1));
}

function wls(X: number[][], y: number[], w: number[]): number[] {
  const m = X[0].length;
  const G = new Float64Array(m * m);
  const b = new Float64Array(m);
  for (let i = 0; i < y.length; i++) {
    for (let r = 0; r < m; r++) {
      b[r] += w[i] * X[i][r] * y[i];
      for (let c = 0; c < m; c++) G[r * m + c] += w[i] * X[i][r] * X[i][c];
    }
  }
  return Array.from(solveDense(G, b, m));
}

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(4) : Number(v.toPrecision(5)).toString();
};

export function fitCalibration(
  xIn: number[],
  yIn: number[],
  model: CalibrationModel,
  weighting: CalibrationWeighting = 'none',
): FitResult | { error: string } {
  const pairs = xIn.map((x, i) => [x, yIn[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const info = MODEL_INFO[model];
  if (pairs.length < info.minPoints) return { error: `${info.label} 모델은 점이 ${info.minPoints}개 이상 필요합니다.` };
  let x = pairs.map((p) => p[0]);
  let y = pairs.map((p) => p[1]);
  if (model === 'power' || model === 'log' || model === '4pl') {
    const keep = x.map((v, i) => v > 0 && (model !== 'power' || y[i] > 0));
    x = x.filter((_, i) => keep[i]);
    y = y.filter((_, i) => keep[i]);
    if (x.length < info.minPoints) return { error: `${info.label} 모델은 양수 값이 ${info.minPoints}개 이상 필요합니다.` };
  }
  const w = weightsFor(x, weighting);
  let params: number[];
  let predict: (v: number) => number;
  let inverse: (v: number) => number | null;
  let equation: string;
  let k: number;

  switch (model) {
    case 'linear': {
      const [a, b] = wls(x.map((v) => [1, v]), y, w);
      params = [a, b]; k = 2;
      predict = (v) => a + b * v;
      inverse = (v) => (b === 0 ? null : (v - a) / b);
      equation = `y = ${fmt(a)} + ${fmt(b)}·x`;
      break;
    }
    case 'linear-origin': {
      const [b] = wls(x.map((v) => [v]), y, w);
      params = [b]; k = 1;
      predict = (v) => b * v;
      inverse = (v) => (b === 0 ? null : v / b);
      equation = `y = ${fmt(b)}·x`;
      break;
    }
    case 'quadratic': {
      const [a, b, c] = wls(x.map((v) => [1, v, v * v]), y, w);
      params = [a, b, c]; k = 3;
      predict = (v) => a + b * v + c * v * v;
      const lo = Math.min(...x), hi = Math.max(...x);
      inverse = (v) => {
        if (Math.abs(c) < 1e-15) return b === 0 ? null : (v - a) / b;
        const disc = b * b - 4 * c * (a - v);
        if (disc < 0) return null;
        const r1 = (-b + Math.sqrt(disc)) / (2 * c), r2 = (-b - Math.sqrt(disc)) / (2 * c);
        const mid = (lo + hi) / 2;
        // 곡선의 단조 구간(표준 범위)에 가까운 근을 고른다
        const cands = [r1, r2].filter((r) => Number.isFinite(r));
        cands.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
        return cands[0] ?? null;
      };
      equation = `y = ${fmt(a)} + ${fmt(b)}·x + ${fmt(c)}·x²`;
      break;
    }
    case 'power': {
      const [la, b] = wls(x.map((v) => [1, Math.log(v)]), y.map(Math.log), w);
      const a = Math.exp(la);
      params = [a, b]; k = 2;
      predict = (v) => a * Math.pow(v, b);
      inverse = (v) => (v <= 0 || b === 0 ? null : Math.pow(v / a, 1 / b));
      equation = `y = ${fmt(a)}·x^${fmt(b)}`;
      break;
    }
    case 'log': {
      const [a, b] = wls(x.map((v) => [1, Math.log(v)]), y, w);
      params = [a, b]; k = 2;
      predict = (v) => (v > 0 ? a + b * Math.log(v) : NaN);
      inverse = (v) => (b === 0 ? null : Math.exp((v - a) / b));
      equation = `y = ${fmt(a)} + ${fmt(b)}·ln x`;
      break;
    }
    case '4pl': {
      const p = fit4PL(x, y, w);
      const [A, B, C, D] = p;
      params = p; k = 4;
      predict = (v) => D + (A - D) / (1 + Math.pow(Math.max(v, 0) / C, B));
      inverse = (v) => {
        const r = (A - D) / (v - D) - 1;
        if (!(r > 0)) return null;
        return C * Math.pow(r, 1 / B);
      };
      equation = `y = ${fmt(D)} + (${fmt(A)} − ${fmt(D)}) / (1 + (x/${fmt(C)})^${fmt(B)})`;
      break;
    }
  }

  const n = x.length;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - predict(x[i])) ** 2; ssTot += (y[i] - ym) ** 2; }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const adjR2 = n - k > 0 && n > 1 ? 1 - ((1 - r2) * (n - 1)) / (n - k) : NaN;
  const dof = n - k;
  const sres = dof > 0 ? Math.sqrt(ssRes / dof) : NaN;
  let lod: number | null = null, loq: number | null = null;
  const slope = model === 'linear' ? params[1] : model === 'linear-origin' ? params[0] : null;
  if (slope && Number.isFinite(sres) && slope !== 0) {
    lod = (3.3 * sres) / Math.abs(slope);
    loq = (10 * sres) / Math.abs(slope);
  }
  return {
    model, params, n, r2, adjR2, rmse: Math.sqrt(ssRes / n), lod, loq,
    xmin: Math.min(...x), xmax: Math.max(...x), predict, inverse, equation,
  };
}

/** Levenberg–Marquardt 4PL 적합. 반환 [A(하한), B(기울기), C(변곡점), D(상한)] */
function fit4PL(x: number[], y: number[], w: number[]): number[] {
  const n = x.length;
  const ymin = Math.min(...y), ymax = Math.max(...y);
  const sortedX = [...x].sort((a, b) => a - b);
  let p = [ymin, 1, sortedX[sortedX.length >> 1], ymax];
  // 증가/감소 방향에 맞춰 A, D 초기값 교환
  const corr = x.reduce((s, v, i) => s + (Math.log(v) - Math.log(sortedX[n >> 1])) * (y[i] - (ymin + ymax) / 2), 0);
  if (corr < 0) p = [ymax, 1, p[2], ymin];
  const f = (q: number[], v: number) => q[3] + (q[0] - q[3]) / (1 + Math.pow(v / Math.max(q[2], 1e-12), q[1]));
  const sse = (q: number[]) => x.reduce((s, v, i) => s + w[i] * (y[i] - f(q, v)) ** 2, 0);
  let lambda = 1e-2;
  let cur = sse(p);
  for (let it = 0; it < 300; it++) {
    const J: number[][] = [];
    const r: number[] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < 4; j++) {
        const h = Math.max(Math.abs(p[j]) * 1e-6, 1e-9);
        const q = [...p];
        q[j] += h;
        row.push((f(q, x[i]) - f(p, x[i])) / h);
      }
      J.push(row);
      r.push(y[i] - f(p, x[i]));
    }
    const G = new Float64Array(16);
    const g = new Float64Array(4);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 4; a++) {
        g[a] += w[i] * J[i][a] * r[i];
        for (let b = 0; b < 4; b++) G[a * 4 + b] += w[i] * J[i][a] * J[i][b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const M = new Float64Array(G);
      for (let a = 0; a < 4; a++) M[a * 4 + a] *= 1 + lambda;
      const d = solveDense(M, g, 4);
      const q = p.map((v, j) => v + d[j]);
      q[2] = Math.max(q[2], 1e-12);
      const s = sse(q);
      if (Number.isFinite(s) && s < cur) {
        const rel = (cur - s) / Math.max(cur, 1e-300);
        p = q; cur = s; lambda = Math.max(lambda / 3, 1e-12); improved = true;
        if (rel < 1e-10) return p;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return p;
}
