import type { Band, BaselineMethod, BaselineSpec } from '../types';
import {
  differenceGram, gaussianSmooth, minMax, movingAverage, polyFit, relativeDifference,
  slidingExtreme, slidingMedian, solveWhittaker, std,
} from '../math';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  hint?: string;
  /** 선택형 파라미터 */
  options?: { value: number; label: string }[];
}

export type BaselineGroup = 'basic' | 'geometric' | 'morphological' | 'smoothing' | 'whittaker' | 'polynomial';

export interface BaselineDef {
  method: BaselineMethod;
  label: string;
  group: BaselineGroup;
  /** 한 줄 설명 */
  summary: string;
  /** 언제 쓰면 좋은지 */
  when: string;
  caution?: string;
  params: ParamDef[];
  /** 밴드 경계를 사용하는지 (valley) */
  usesBands?: boolean;
  source?: string;
}

export const GROUP_LABELS: Record<BaselineGroup, string> = {
  basic: '기본',
  geometric: '기하학',
  morphological: '롤링볼 계열',
  smoothing: '평활 기반',
  whittaker: 'Whittaker (penalized least squares)',
  polynomial: '다항식',
};

const lamParam = (d: number): ParamDef => ({
  key: 'logLam', label: '평활도 log₁₀ λ', min: 1, max: 10, step: 0.25, default: d,
  hint: '클수록 베이스라인이 곧고 뻣뻣해집니다. 프로파일 길이 1000점 기준으로 환산해 해상도가 달라도 같은 값이 비슷하게 동작합니다.',
});

export const BASELINES: BaselineDef[] = [
  {
    method: 'none', label: '없음', group: 'basic',
    summary: '베이스라인을 0으로 둡니다.',
    when: '2D 배경 제거를 이미 충분히 했거나, 배경이 사실상 0인 형광 이미지.',
    params: [],
  },
  {
    method: 'manual', label: '수동 (밴드 시작·끝점)', group: 'basic', usesBands: true,
    summary: '밴드마다 시작점과 끝점을 직선으로 이어 바닥선을 만듭니다. 아래 그래프의 동그라미를 끌어 시작·끝 위치와 높이를 직접 정합니다.',
    when: '자동 방법이 특정 밴드에서 어긋날 때, 바닥선을 직접 정하고 싶을 때.',
    caution: '사람마다 달라질 수 있으니 점 위치가 프로젝트에 저장되어 재현됩니다.',
    params: [],
  },
  {
    method: 'valley', label: 'Valley-to-valley (밴드별 직선)', group: 'geometric', usesBands: true,
    summary: '각 밴드의 시작점과 끝점을 직선으로 잇습니다. ImageJ에서 손으로 긋는 직선을 자동화한 방식.',
    when: '밴드가 서로 떨어져 있고 밴드 사이 골짜기가 배경 수준까지 내려올 때. ImageJ 결과와 비교할 때.',
    caution: '밴드 경계를 어디에 두느냐에 따라 면적이 달라집니다.',
    params: [
      { key: 'avg', label: '끝점 평균 폭', min: 0, max: 10, step: 1, default: 2, unit: 'px', hint: '끝점 값을 ±n px 평균으로 잡아 노이즈 영향을 줄입니다.' },
    ],
  },
  {
    method: 'minimum', label: '프로파일 최솟값 (수평선)', group: 'geometric',
    summary: '프로파일의 하위 백분위수 값으로 수평선을 긋습니다.',
    when: '배경이 레인 전체에서 평평할 때.',
    caution: '레인 끝을 어디까지 잡았는지에 민감합니다 (TotalLab).',
    params: [
      { key: 'percentile', label: '백분위수', min: 0, max: 30, step: 1, default: 2, unit: '%' },
    ],
  },
  {
    method: 'lane-edge', label: '레인 가장자리 (Lane edge)', group: 'geometric',
    summary: '레인 바로 바깥 좌우 띠의 값 중 작은 쪽을 각 위치의 배경으로 씁니다 (TotalLab 방식).',
    when: '밴드가 촘촘하게 붙어 있어 프로파일만으로는 배경을 알 수 없을 때. 레인을 따라 번진 신호(smear)를 뺄 때.',
    caution: '레인 사이 간격이 좁아 옆 레인의 밴드가 가장자리 띠에 걸리면 밴드를 과소평가합니다.',
    params: [
      { key: 'smooth', label: '평활 σ', min: 0, max: 20, step: 0.5, default: 2, unit: 'px' },
    ],
  },
  {
    method: 'rolling-ball', label: 'Rolling ball / disk (1D)', group: 'morphological',
    summary: '프로파일 아래에서 원을 굴려 닿는 궤적을 배경으로 씁니다 (Bio-Rad Image Lab의 rolling disk).',
    when: '가장 범용적인 기본 선택. 배경이 완만하게 변할 때.',
    caution: '반경이 너무 작으면 밴드 신호까지 깎고, 너무 크면 배경이 덜 빠집니다. 가장 넓은 밴드 폭보다 크게 잡으세요.',
    source: 'Sternberg 1983; Bio-Rad Image Lab',
    params: [
      { key: 'radiusPct', label: '공 크기 (반경)', min: 1, max: 60, step: 0.5, default: 12, unit: '% 레인 길이',
        hint: '그래프 아래에서 굴리는 공의 크기입니다. 공이 밴드 봉우리 속으로 들어가지 못할 만큼, 가장 넓은 밴드보다 크게 잡으세요. 작으면 밴드까지 깎이고, 너무 크면 배경이 덜 빠집니다.' },
    ],
  },
  {
    method: 'tophat', label: 'Top-hat (평평한 구조요소 opening)', group: 'morphological',
    summary: '최솟값 필터 후 최댓값 필터(opening)로 좁은 봉우리를 제거하고, 이동평균으로 다듬습니다.',
    when: '밴드 폭이 비슷하고 배경이 거의 평평하거나 계단식으로 변할 때.',
    caution: '배경 기울기가 급하면 밴드 옆 배경을 끌어올려 면적을 과소평가합니다. 이럴 때는 Rolling ball이나 AsLS를 쓰세요.',
    params: [
      { key: 'windowPct', label: '창 절반 폭', min: 1, max: 50, step: 0.5, default: 8, unit: '% 레인 길이' },
      { key: 'smoothPct', label: '평활 절반 폭', min: 0, max: 20, step: 0.5, default: 1, unit: '% 레인 길이' },
    ],
  },
  {
    method: 'rubber-band', label: 'Rubber band (볼록 껍질)', group: 'morphological',
    summary: '프로파일 아래에 고무줄을 당겨 건 모양, 즉 아래쪽 볼록 껍질을 베이스라인으로 씁니다.',
    when: '밴드가 적당히 떨어져 있고 배경이 아래로 볼록하거나 직선에 가까울 때.',
    caution: '프로파일 양 끝이 가운데보다 낮으면 가운데 배경을 과소추정합니다. 이때 굽힘 값을 올리세요.',
    params: [
      { key: 'bend', label: '굽힘', min: 0, max: 2, step: 0.05, default: 0, hint: '0보다 크면 가운데로 휘어진 배경을 따라갑니다.' },
    ],
  },
  {
    method: 'snip', label: 'SNIP', group: 'smoothing',
    summary: '창 크기를 늘려가며 각 점을 좌우 평균과 비교해 봉우리를 깎아냅니다.',
    when: '밴드가 많고 폭이 제각각일 때. 반복이 적어 빠르고 안정적입니다.',
    source: 'Ryan et al. 1988; Morháč 1997',
    params: [
      { key: 'halfWindowPct', label: '최대 창 절반', min: 0.5, max: 30, step: 0.5, default: 5, unit: '% 레인 길이', hint: '가장 넓은 밴드 폭의 절반 정도.' },
      { key: 'order', label: '필터 차수', min: 2, max: 8, step: 2, default: 2, options: [{ value: 2, label: '2 (직선)' }, { value: 4, label: '4' }, { value: 6, label: '6' }, { value: 8, label: '8' }] },
      { key: 'lls', label: 'LLS 변환', min: 0, max: 1, step: 1, default: 0, options: [{ value: 0, label: '끔' }, { value: 1, label: '켬 (신호 범위가 넓을 때)' }] },
      { key: 'decreasing', label: '창 순서', min: 0, max: 1, step: 1, default: 0, options: [{ value: 0, label: '작은 창 → 큰 창' }, { value: 1, label: '큰 창 → 작은 창' }] },
    ],
  },
  {
    method: 'median', label: '이동 중앙값 + Gaussian', group: 'smoothing',
    summary: '넓은 창의 이동 중앙값으로 배경을 추정한 뒤 Gaussian으로 평활합니다.',
    when: '밴드가 드문드문 있고 배경이 노이즈가 많을 때.',
    caution: '밴드가 창의 절반 이상을 차지하거나 배경 기울기가 급하면 배경이 밴드 쪽으로 끌려 올라갑니다.',
    params: [
      { key: 'halfWindowPct', label: '창 절반 폭', min: 2, max: 50, step: 0.5, default: 15, unit: '% 레인 길이' },
      { key: 'sigmaPct', label: '평활 σ', min: 0, max: 20, step: 0.5, default: 3, unit: '% 레인 길이' },
    ],
  },
  {
    method: 'asls', label: 'AsLS (비대칭 최소제곱)', group: 'whittaker',
    summary: '부드러운 곡선을 적합하되 곡선 위쪽 점(밴드)에는 작은 가중치 p를 줍니다.',
    when: '배경이 곡선으로 휘어 있을 때의 대표적인 자동 방법.',
    source: 'Eilers & Boelens 2005',
    params: [
      lamParam(6),
      { key: 'p', label: '비대칭 p', min: 0.0001, max: 0.2, step: 0.0001, default: 0.01, hint: '작을수록 베이스라인이 더 아래쪽에 붙습니다.' },
    ],
  },
  {
    method: 'airpls', label: 'airPLS', group: 'whittaker',
    summary: '반복하면서 베이스라인 위 점의 가중치를 0으로, 아래 점은 잔차 크기에 따라 키웁니다. p 파라미터가 필요 없습니다.',
    when: '파라미터를 적게 만지고 싶을 때. 밴드가 크고 배경이 휘었을 때.',
    source: 'Zhang et al. 2010',
    params: [lamParam(6)],
  },
  {
    method: 'arpls', label: 'arPLS', group: 'whittaker',
    summary: '음의 잔차 분포(노이즈 수준)를 추정해 로지스틱 함수로 가중치를 줍니다. 노이즈가 있는 평평한 구간을 잘 따라갑니다.',
    when: '노이즈가 큰 이미지. AsLS가 배경을 너무 낮게 잡을 때.',
    source: 'Baek et al. 2015',
    params: [lamParam(5)],
  },
  {
    method: 'psalsa', label: 'psalsa', group: 'whittaker',
    summary: 'AsLS의 가중치를 봉우리 높이에 따라 지수적으로 줄여, 큰 밴드는 확실히 배제하고 작은 요철은 따라갑니다.',
    when: '밴드 높이 차이가 크고 배경에 작은 요철이 있을 때.',
    source: 'Oller-Moreno et al. 2014',
    params: [
      lamParam(5),
      { key: 'p', label: 'p', min: 0.01, max: 0.9, step: 0.01, default: 0.5 },
      { key: 'k', label: 'k (× 표준편차)', min: 0.01, max: 2, step: 0.01, default: 0.1, hint: '밴드 높이 척도. 기본은 std(y)/10.' },
    ],
  },
  {
    method: 'modpoly', label: 'ModPoly', group: 'polynomial',
    summary: '다항식을 적합하고, 적합선보다 위에 있는 점을 적합선으로 끌어내리기를 반복합니다.',
    when: '배경이 레인 전체에서 매끄러운 곡선(기울기, 휨)일 때.',
    caution: '차수가 높으면 레인 끝에서 휘어집니다.',
    source: 'Lieber & Mahadevan-Jansen 2003',
    params: [
      { key: 'order', label: '차수', min: 1, max: 6, step: 1, default: 2 },
    ],
  },
  {
    method: 'imodpoly', label: 'IModPoly', group: 'polynomial',
    summary: 'ModPoly에 잔차 표준편차를 더해 노이즈에 덜 끌려 내려가게 개선한 방법.',
    when: '노이즈가 있는 이미지에서 ModPoly가 베이스라인을 너무 낮게 잡을 때.',
    source: 'Zhao et al. 2007',
    params: [
      { key: 'order', label: '차수', min: 1, max: 6, step: 1, default: 2 },
      { key: 'numStd', label: '표준편차 배수', min: 0, max: 3, step: 0.1, default: 1 },
    ],
  },
];

export const BASELINE_MAP = Object.fromEntries(BASELINES.map((d) => [d.method, d])) as Record<BaselineMethod, BaselineDef>;

/**
 * 화면에서 고를 수 있는 방법 (범용적인 것만). 나머지 알고리즘은 코드에 남겨 두고,
 * 예전 프로젝트가 쓰던 방법이면 목록에 함께 보여준다.
 */
export const VISIBLE_BASELINES: BaselineMethod[] = ['none', 'manual', 'rolling-ball', 'tophat', 'rubber-band', 'snip', 'median'];

export function defaultParams(method: BaselineMethod): Record<string, number> {
  return Object.fromEntries(BASELINE_MAP[method].params.map((p) => [p.key, p.default]));
}

/**
 * 베이스라인 설정 복사. immer draft(Proxy)는 structuredClone으로 복사할 수 없어
 * (DataCloneError로 변경 전체가 무시됨) 필드를 직접 옮겨 담는다.
 */
export function cloneSpec(s: BaselineSpec): BaselineSpec {
  return {
    method: s.method,
    params: { ...s.params },
    points: s.points ? s.points.map((p) => [p[0], p[1]] as [number, number]) : undefined,
  };
}

export function makeSpec(method: BaselineMethod, prev?: BaselineSpec): BaselineSpec {
  return { method, params: defaultParams(method), points: method === 'manual' ? prev?.points ?? [] : undefined };
}

export interface BaselineInput {
  y: Float64Array;
  left?: Float64Array;
  right?: Float64Array;
  bands?: Band[];
}

export function computeBaseline(spec: BaselineSpec, input: BaselineInput): Float64Array {
  const { y } = input;
  const n = y.length;
  const P = { ...defaultParams(spec.method), ...spec.params };
  const pctToPx = (pct: number) => Math.max(1, Math.round((pct / 100) * n));
  switch (spec.method) {
    case 'none': return new Float64Array(n);
    case 'manual': return manualBandBaseline(y, input.bands ?? []);
    case 'valley': return valleyBaseline(y, input.bands ?? [], Math.round(P.avg));
    case 'minimum': {
      const s = Array.from(y).sort((a, b) => a - b);
      const v = s[Math.min(n - 1, Math.floor((P.percentile / 100) * (n - 1)))];
      return new Float64Array(n).fill(v);
    }
    case 'lane-edge': {
      const out = new Float64Array(n);
      const l = input.left, r = input.right;
      for (let i = 0; i < n; i++) {
        const a = l ? l[i] : NaN, b = r ? r[i] : NaN;
        out[i] = Number.isNaN(a) ? (Number.isNaN(b) ? y[i] : b) : Number.isNaN(b) ? a : Math.min(a, b);
      }
      return gaussianSmooth(out, P.smooth);
    }
    case 'rolling-ball': return rollingBall1D(y, pctToPx(P.radiusPct), P.scale === 1);
    case 'tophat': {
      const half = pctToPx(P.windowPct);
      const opened = slidingExtreme(slidingExtreme(y, half, 'min'), half, 'max');
      const sm = P.smoothPct > 0 ? movingAverage(opened, pctToPx(P.smoothPct)) : opened;
      for (let i = 0; i < n; i++) if (sm[i] > y[i]) sm[i] = y[i];
      return sm;
    }
    case 'rubber-band': return rubberBand(y, P.bend);
    case 'snip': return snip(y, pctToPx(P.halfWindowPct), P.order, P.lls === 1, P.decreasing === 1);
    case 'median': return gaussianSmooth(slidingMedian(y, pctToPx(P.halfWindowPct)), (P.sigmaPct / 100) * n);
    case 'asls': return asls(y, scaledLam(P.logLam, n), P.p);
    case 'airpls': return airpls(y, scaledLam(P.logLam, n));
    case 'arpls': return arpls(y, scaledLam(P.logLam, n));
    case 'psalsa': return psalsa(y, scaledLam(P.logLam, n), P.p, P.k * (std(y) || 1));
    case 'modpoly': return modpoly(y, Math.round(P.order), 0);
    case 'imodpoly': return modpoly(y, Math.round(P.order), P.numStd, true);
  }
}

/** λ를 길이 1000점 기준으로 환산 (2차 차분에서 λ ∝ n⁴) */
export function scaledLam(logLam: number, n: number) {
  return Math.pow(10, logLam) * Math.pow(n / 1000, 4);
}

// ---------------- 개별 알고리즘 ----------------

/**
 * 수동 베이스라인: 밴드마다 (시작, baseStart) — (끝, baseEnd)를 직선으로 잇는다.
 * 높이를 지정하지 않은 끝점은 그 위치의 프로파일 값(골짜기)을 쓴다.
 * 밴드 밖은 프로파일과 같게 두어 면적에 영향이 없다.
 */
export function manualBandBaseline(y: Float64Array, bands: Band[]): Float64Array {
  const n = y.length;
  const out = new Float64Array(y);
  for (const b of bands) {
    const s = Math.max(0, Math.min(n - 1, Math.round(b.start)));
    const e = Math.max(s, Math.min(n - 1, Math.round(b.end)));
    const ys = b.baseStart ?? y[s];
    const ye = b.baseEnd ?? y[e];
    for (let i = s; i <= e; i++) out[i] = ys + ((ye - ys) * (i - s)) / Math.max(1, e - s);
  }
  return out;
}

export function manualBaseline(y: Float64Array, points: [number, number][], smooth: boolean): Float64Array {
  const n = y.length;
  const pts = [...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return linearEnds(y);
  if (pts.length === 1) return new Float64Array(n).fill(pts[0][1]);
  const out = new Float64Array(n);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const slopes = smooth ? pchipSlopes(xs, ys) : null;
  let seg = 0;
  for (let i = 0; i < n; i++) {
    if (i <= xs[0]) { out[i] = ys[0]; continue; }
    if (i >= xs[xs.length - 1]) { out[i] = ys[ys.length - 1]; continue; }
    while (seg < xs.length - 2 && i > xs[seg + 1]) seg++;
    const x0 = xs[seg], x1 = xs[seg + 1];
    const h = x1 - x0 || 1;
    const t = (i - x0) / h;
    if (!slopes) {
      out[i] = ys[seg] + (ys[seg + 1] - ys[seg]) * t;
    } else {
      const t2 = t * t, t3 = t2 * t;
      out[i] = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * slopes[seg]
        + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * slopes[seg + 1];
    }
  }
  return out;
}

/** Fritsch–Carlson 단조 3차 보간 기울기 */
function pchipSlopes(xs: number[], ys: number[]): number[] {
  const m = xs.length;
  const d: number[] = [];
  for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
  const s = new Array(m).fill(0);
  s[0] = d[0];
  s[m - 1] = d[m - 2];
  for (let i = 1; i < m - 1; i++) {
    if (d[i - 1] * d[i] <= 0) s[i] = 0;
    else {
      const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
      s[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return s;
}

function linearEnds(y: Float64Array): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = y[0] + ((y[n - 1] - y[0]) * i) / Math.max(1, n - 1);
  return out;
}

function avgAt(y: Float64Array, i: number, half: number) {
  let s = 0, c = 0;
  for (let k = Math.max(0, i - half); k <= Math.min(y.length - 1, i + half); k++) { s += y[k]; c++; }
  return s / c;
}

export function valleyBaseline(y: Float64Array, bands: Band[], half: number): Float64Array {
  const n = y.length;
  if (!bands.length) return rubberBand(y, 0);
  const out = new Float64Array(y);
  for (const b of bands) {
    const s = Math.max(0, Math.min(n - 1, b.start));
    const e = Math.max(s, Math.min(n - 1, b.end));
    const ys = avgAt(y, s, half), ye = avgAt(y, e, half);
    for (let i = s; i <= e; i++) out[i] = ys + ((ye - ys) * (i - s)) / Math.max(1, e - s);
  }
  return out;
}

export function rollingBall1D(y: Float64Array, radius: number, raw: boolean): Float64Array {
  const n = y.length;
  const [lo, hi] = minMax(y);
  const k = raw ? 1 : n / Math.max(hi - lo, 1e-12);
  const r = Math.max(1, radius);
  const s = new Float64Array(2 * r + 1);
  for (let j = -r; j <= r; j++) s[j + r] = Math.sqrt(Math.max(0, r * r - j * j));
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) ys[i] = (y[i] - lo) * k;
  // opening: 공 중심 높이 = min(y − s), 배경 = max(중심 + s)
  const center = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = -r; j <= r; j++) {
      const t = i + j;
      if (t < 0 || t >= n) continue;
      const v = ys[t] - s[j + r];
      if (v < m) m = v;
    }
    center[i] = m;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = -r; j <= r; j++) {
      const t = i + j;
      if (t < 0 || t >= n) continue;
      const v = center[t] + s[j + r];
      if (v > m) m = v;
    }
    out[i] = Math.min(m, ys[i]) / k + lo;
  }
  return out;
}

export function rubberBand(y: Float64Array, bend: number): Float64Array {
  const n = y.length;
  const [lo, hi] = minMax(y);
  const range = hi - lo || 1;
  const c = (n - 1) / 2;
  const add = (i: number) => bend * range * ((i - c) / (c || 1)) ** 2;
  const yb = new Float64Array(n);
  for (let i = 0; i < n; i++) yb[i] = y[i] + add(i);
  // Andrew's monotone chain, 아래쪽 껍질
  const hull: number[] = [];
  for (let i = 0; i < n; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2], b = hull[hull.length - 1];
      const cross = (b - a) * (yb[i] - yb[a]) - (yb[b] - yb[a]) * (i - a);
      if (cross <= 0) hull.pop(); else break;
    }
    hull.push(i);
  }
  const out = new Float64Array(n);
  for (let h = 0; h < hull.length - 1; h++) {
    const a = hull[h], b = hull[h + 1];
    for (let i = a; i <= b; i++) out[i] = yb[a] + ((yb[b] - yb[a]) * (i - a)) / Math.max(1, b - a) - add(i);
  }
  if (hull.length === 1) out[0] = y[0];
  return out;
}

export function snip(y: Float64Array, maxHalf: number, order: number, lls: boolean, decreasing: boolean): Float64Array {
  const n = y.length;
  let offset = 0;
  let z = new Float64Array(n);
  if (lls) {
    const [lo] = minMax(y);
    offset = lo < 0 ? -lo : 0;
    for (let i = 0; i < n; i++) z[i] = Math.log(Math.log(Math.sqrt(y[i] + offset + 1) + 1) + 1);
  } else {
    z.set(y);
  }
  const half = Math.max(1, Math.min(maxHalf, Math.floor((n - 1) / 2)));
  // 가장자리 반사 패딩
  const padded = new Float64Array(n + 2 * half);
  for (let i = 0; i < padded.length; i++) {
    let t = i - half;
    if (t < 0) t = -t;
    if (t >= n) t = 2 * (n - 1) - t;
    padded[i] = z[Math.max(0, Math.min(n - 1, t))];
  }
  let cur = padded;
  const next = new Float64Array(padded.length);
  const windows = Array.from({ length: half }, (_, k) => k + 1);
  if (decreasing) windows.reverse();
  for (const w of windows) {
    next.set(cur);
    for (let i = half; i < half + n; i++) {
      const at = (d: number, sign: number) => cur[Math.max(0, Math.min(cur.length - 1, i + sign * d))];
      let v = (at(w, -1) + at(w, 1)) / 2;
      if (order >= 4) {
        const a = (-(at(w, -1) + at(w, 1)) + 4 * (at(w >> 1, -1) + at(w >> 1, 1))) / 6;
        if (a > v) v = a;
      }
      if (order >= 6) {
        const a = (at(w, -1) + at(w, 1) - 6 * (at(Math.floor((2 * w) / 3), -1) + at(Math.floor((2 * w) / 3), 1))
          + 15 * (at(Math.floor(w / 3), -1) + at(Math.floor(w / 3), 1))) / 20;
        if (a > v) v = a;
      }
      if (order >= 8) {
        const a = (-(at(w, -1) + at(w, 1)) + 8 * (at(Math.floor((3 * w) / 4), -1) + at(Math.floor((3 * w) / 4), 1))
          - 28 * (at(w >> 1, -1) + at(w >> 1, 1)) + 56 * (at(w >> 2, -1) + at(w >> 2, 1))) / 70;
        if (a > v) v = a;
      }
      next[i] = Math.min(cur[i], v);
    }
    cur = new Float64Array(next);
  }
  z = cur.slice(half, half + n);
  if (lls) for (let i = 0; i < n; i++) z[i] = (Math.exp(Math.exp(z[i]) - 1) - 1) ** 2 - 1 - offset;
  return z;
}

const MAX_ITER = 50;
const TOL = 1e-3;

export function asls(y: Float64Array, lam: number, p: number): Float64Array {
  const n = y.length;
  const gram = differenceGram(n, 2);
  let w = new Float64Array(n).fill(1);
  let z = solveWhittaker(w, y, lam, gram);
  for (let it = 0; it < MAX_ITER; it++) {
    const nw = new Float64Array(n);
    for (let i = 0; i < n; i++) nw[i] = y[i] > z[i] ? p : 1 - p;
    const diff = relativeDifference(w, nw);
    w = nw;
    z = solveWhittaker(w, y, lam, gram);
    if (diff < TOL) break;
  }
  return z;
}

export function airpls(y: Float64Array, lam: number): Float64Array {
  const n = y.length;
  const gram = differenceGram(n, 2);
  const w = new Float64Array(n).fill(1);
  let yl1 = 0;
  for (let i = 0; i < n; i++) yl1 += Math.abs(y[i]);
  let z = solveWhittaker(w, y, lam, gram);
  for (let it = 1; it <= MAX_ITER; it++) {
    let negL1 = 0;
    for (let i = 0; i < n; i++) { const r = y[i] - z[i]; if (r < 0) negL1 -= r; }
    if (negL1 === 0 || negL1 < TOL * yl1) break;
    let maxExp = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - z[i];
      if (r >= 0) w[i] = 0;
      else { const e = (it * -r) / negL1; w[i] = e; if (e > maxExp) maxExp = e; }
    }
    // 오버플로 방지: 지수를 최댓값 기준으로 정규화
    for (let i = 0; i < n; i++) if (w[i] > 0) w[i] = Math.exp(w[i] - maxExp);
    z = solveWhittaker(w, y, lam, gram);
  }
  return z;
}

export function arpls(y: Float64Array, lam: number): Float64Array {
  const n = y.length;
  const gram = differenceGram(n, 2);
  let w = new Float64Array(n).fill(1);
  let z = solveWhittaker(w, y, lam, gram);
  for (let it = 0; it < MAX_ITER; it++) {
    const neg: number[] = [];
    for (let i = 0; i < n; i++) { const r = y[i] - z[i]; if (r < 0) neg.push(r); }
    if (neg.length < 2) break;
    const mu = neg.reduce((a, b) => a + b, 0) / neg.length;
    const sd = std(neg) || 1e-12;
    const nw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = y[i] - z[i];
      const e = Math.min(700, (2 * (r - (-mu + 2 * sd))) / sd);
      nw[i] = 1 / (1 + Math.exp(e));
    }
    const diff = relativeDifference(w, nw);
    w = nw;
    z = solveWhittaker(w, y, lam, gram);
    if (diff < TOL) break;
  }
  return z;
}

export function psalsa(y: Float64Array, lam: number, p: number, k: number): Float64Array {
  const n = y.length;
  const gram = differenceGram(n, 2);
  let w = new Float64Array(n).fill(1);
  let z = solveWhittaker(w, y, lam, gram);
  for (let it = 0; it < MAX_ITER; it++) {
    const nw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = y[i] - z[i];
      nw[i] = r > 0 ? p * Math.exp(-r / k) : 1 - p;
    }
    const diff = relativeDifference(w, nw);
    w = nw;
    z = solveWhittaker(w, y, lam, gram);
    if (diff < TOL) break;
  }
  return z;
}

export function modpoly(y: Float64Array, order: number, numStd: number, improved = false): Float64Array {
  const n = y.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = i;
  const work = new Float64Array(y);
  let fit = polyFit(x, work, order);
  let base = new Float64Array(n);
  for (let i = 0; i < n; i++) base[i] = fit.evaluate(i);
  let prevDev = 0;
  for (let it = 0; it < 250; it++) {
    let dev = 0;
    if (improved) {
      const res = new Float64Array(n);
      for (let i = 0; i < n; i++) res[i] = work[i] - base[i];
      dev = std(res);
    }
    for (let i = 0; i < n; i++) {
      const cap = base[i] + numStd * dev;
      if (work[i] > cap) work[i] = cap;
    }
    fit = polyFit(x, work, order);
    const nb = new Float64Array(n);
    for (let i = 0; i < n; i++) nb[i] = fit.evaluate(i);
    const conv = improved ? Math.abs(dev - prevDev) / Math.max(dev, 1e-12) : relativeDifference(base, nb);
    base = nb;
    prevDev = dev;
    if (conv < TOL) break;
  }
  return base;
}
