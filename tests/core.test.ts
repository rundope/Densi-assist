import { describe, expect, it } from 'vitest';
import { BASELINES, computeBaseline, makeSpec } from '../src/core/baseline/registry';
import { detectBands, measureBand } from '../src/core/bands';
import { fitCalibration } from '../src/core/calibration';
import { differenceGram, solveWhittaker } from '../src/core/math';
import { estimateBackground2D } from '../src/core/image/background2d';
import { synthesizeGel } from '../src/core/synthetic';
import { gaussianBlur, suggestPolarity, toGray, toSignal } from '../src/core/image/preprocess';
import { decodeImage, sha256 } from '../src/core/io/decode';
import { existsSync, readFileSync } from 'node:fs';
import { extractProfile } from '../src/core/profile';
import { detectLanes } from '../src/core/lanes';
import { summarize, type BandRow } from '../src/core/results';
import { newBand } from '../src/state/project';
import { correctedSource, originalSource } from '../src/ui/render';
import type { Gel } from '../src/core/types';
import type { ProcessedGel } from '../src/engine/engine';

function gaussProfile(n: number, peaks: { c: number; s: number; a: number }[], bg: (i: number) => number) {
  const y = new Float64Array(n);
  const truth: number[] = peaks.map(() => 0);
  for (let i = 0; i < n; i++) {
    y[i] = bg(i);
    peaks.forEach((p, k) => {
      const v = p.a * Math.exp(-0.5 * ((i - p.c) / p.s) ** 2);
      y[i] += v;
      truth[k] += v;
    });
  }
  return { y, truth };
}

describe('Whittaker solver', () => {
  it('matches dense solve for small system', () => {
    const n = 12;
    const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i) * 3 + i);
    const w = Float64Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 0.2 : 1));
    const lam = 5;
    const z = solveWhittaker(w, y, lam, differenceGram(n, 2));
    // 잔차 확인: (W + lam DᵀD) z − W y = 0
    const D: number[][] = [];
    for (let r = 0; r < n - 2; r++) { const row = new Array(n).fill(0); row[r] = 1; row[r + 1] = -2; row[r + 2] = 1; D.push(row); }
    for (let i = 0; i < n; i++) {
      let s = w[i] * z[i];
      for (let j = 0; j < n; j++) {
        let dtd = 0;
        for (const row of D) dtd += row[i] * row[j];
        s += lam * dtd * z[j];
      }
      expect(s).toBeCloseTo(w[i] * y[i], 8);
    }
  });
});

describe('baselines recover peak areas on sloped background', () => {
  const n = 600;
  const peaks = [{ c: 120, s: 8, a: 400 }, { c: 300, s: 10, a: 900 }, { c: 470, s: 7, a: 250 }];
  const bg = (i: number) => 1000 + 0.8 * i + 150 * Math.sin(i / 190);
  const { y, truth } = gaussProfile(n, peaks, bg);
  const trueBg = Float64Array.from({ length: n }, (_, i) => bg(i));

  const methods = ['rolling-ball', 'snip', 'asls', 'airpls', 'arpls', 'psalsa', 'imodpoly'] as const;

  // 평평한 구조요소/중앙값 계열은 급한 기울기에 약하므로(문서화된 한계) 완만한 배경에서 확인
  for (const m of ['tophat', 'median'] as const) {
    it(`${m} keeps areas on a gentle background`, () => {
      const lin = gaussProfile(n, peaks, (i) => 1000 + 0.1 * i + 20 * Math.sin(i / 190));
      const base = computeBaseline(makeSpec(m), { y: lin.y });
      peaks.forEach((p, k) => {
        const band = { id: 'b', start: Math.round(p.c - 4 * p.s), end: Math.round(p.c + 4 * p.s), targetId: null, tilt: 0 };
        const meas = measureBand(band, lin.y, base, new Uint16Array(n), 1, 'allow');
        expect(Math.abs(meas.area - lin.truth[k]) / lin.truth[k]).toBeLessThan(0.15);
      });
    });
  }
  for (const m of methods) {
    it(`${m} keeps each area within 15%`, () => {
      const base = computeBaseline(makeSpec(m), { y });
      peaks.forEach((p, k) => {
        const band = { id: 'b', start: Math.round(p.c - 4 * p.s), end: Math.round(p.c + 4 * p.s), targetId: null, tilt: 0 };
        const meas = measureBand(band, y, base, new Uint16Array(n), 1, 'allow');
        expect(Math.abs(meas.area - truth[k]) / truth[k]).toBeLessThan(0.15);
      });
    });
  }

  it('every registered method returns finite baseline of right length', () => {
    for (const def of BASELINES) {
      const b = computeBaseline(makeSpec(def.method), { y, left: trueBg, right: trueBg, bands: [] });
      expect(b.length).toBe(n);
      expect(b.every(Number.isFinite)).toBe(true);
    }
  });

  it('lane-edge with true edges is exact', () => {
    const b = computeBaseline({ method: 'lane-edge', params: { smooth: 0 } }, { y, left: trueBg, right: trueBg });
    for (let i = 0; i < n; i++) expect(b[i]).toBeCloseTo(trueBg[i], 6);
  });

  it('manual baseline joins each band start/end anchor', () => {
    const yy = Float64Array.from({ length: 101 }, (_, i) => 5 + (i >= 40 && i <= 60 ? 50 : 0));
    // 끝점 높이를 지정하지 않으면 그 위치의 프로파일 값(골짜기)
    const auto = computeBaseline({ method: 'manual', params: {} }, { y: yy, bands: [newBand(30, 70)] });
    expect(auto[50]).toBeCloseTo(5);
    expect(auto[10]).toBe(yy[10]); // 밴드 밖은 프로파일 그대로 → 면적 0
    // 사용자가 끝점 높이를 정하면 그 직선이 바닥선
    const set = computeBaseline({ method: 'manual', params: {} }, { y: yy, bands: [newBand(30, 70, { baseStart: 0, baseEnd: 20 })] });
    expect(set[30]).toBeCloseTo(0);
    expect(set[50]).toBeCloseTo(10);
    expect(set[70]).toBeCloseTo(20);
  });

  it('detects the three bands', () => {
    const base = computeBaseline(makeSpec('asls'), { y });
    const sig = y.map((v, i) => v - base[i]);
    const found = detectBands(sig, { minProminencePct: 5, edgePct: 3, smoothing: 1.5 });
    expect(found.length).toBe(3);
    found.forEach((f, k) => expect(Math.abs(f.peak - peaks[k].c)).toBeLessThan(3));
  });
});

describe('2D background', () => {
  it('rolling ball removes smooth background but keeps small spots', () => {
    const w = 120, h = 80;
    const img = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = 100 + x * 0.5 + y * 0.3;
    img[40 * w + 60] += 500;
    const bg = estimateBackground2D(img, w, h, { method: 'rolling-ball', radius: 20, presmooth: false });
    expect(Math.abs(img[20 * w + 20] - bg[20 * w + 20])).toBeLessThan(5);
    expect(img[40 * w + 60] - bg[40 * w + 60]).toBeGreaterThan(450);
  });
  it('paraboloid behaves similarly', () => {
    const w = 100, h = 60;
    const img = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = 200 + 0.2 * x;
    img[30 * w + 50] += 300;
    const bg = estimateBackground2D(img, w, h, { method: 'paraboloid', radius: 15, presmooth: false });
    expect(Math.abs(img[10 * w + 10] - bg[10 * w + 10])).toBeLessThan(3);
    expect(img[30 * w + 50] - bg[30 * w + 50]).toBeGreaterThan(250);
  });
});

describe('synthetic gel end-to-end', () => {
  const amounts = [1, 2, 4, 8, 16];
  const gel = synthesizeGel({
    width: 500, height: 300, seed: 3,
    lanes: amounts.map((a) => ({ sample: `S${a}`, bands: [{ y: 0.4, amount: a }] })),
  });
  const raw = { width: 500, height: 300, data: Float32Array.from(gel.data), bitDepth: 16 as const, maxValue: 65535 };
  const signal = toSignal(raw, 'dark-bands');

  it('suggests dark-band polarity despite vignetting, and light for inverted', () => {
    expect(suggestPolarity(raw)).toBe('dark-bands');
    const inv = { ...raw, data: raw.data.map((v) => 65535 - v) };
    expect(suggestPolarity(inv)).toBe('light-bands');
  });

  it('detects all lanes', () => {
    const lanes = detectLanes(signal, 500, 300);
    expect(lanes.length).toBe(5);
    lanes.forEach((l, i) => expect(Math.abs(l.cx - gel.laneCenters[i])).toBeLessThan(6));
  });

  it('area is linear in amount', () => {
    const areas = gel.laneCenters.map((cx) => {
      const lane = { id: 'l', sample: '', cx, top: 20, bottom: 280, width: gel.laneWidth, baseline: null, bands: [], excluded: false };
      const p = extractProfile({ width: 500, height: 300, data: signal }, raw, 65535, lane, { aggregate: 'mean', edgeTrimPct: 10 });
      const base = computeBaseline(makeSpec('rolling-ball'), { y: p.values });
      const sig = p.values.map((v, i) => v - base[i]);
      const found = detectBands(sig, { minProminencePct: 10, edgePct: 2, smoothing: 1.5 });
      const main = found.reduce((a, b) => (sig[b.peak] > sig[a.peak] ? b : a));
      return measureBand({ id: 'b', start: main.start, end: main.end, targetId: null, tilt: 0 }, p.values, base, p.saturated, p.columns, 'clip').area;
    });
    const fit = fitCalibration(amounts, areas, 'linear');
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.r2).toBeGreaterThan(0.99);
  });
});

describe('sha256 fallback (HTTP 서버용)', () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  it('matches the standard test vectors', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // 두 블록에 걸치는 입력
    const long = new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
    expect(hex(sha256(long))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('agrees with WebCrypto on a real file', async () => {
    const file = readFileSync(new URL('./fixtures/gel16.tif', import.meta.url));
    const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    const web = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    expect(hex(sha256(bytes))).toBe(hex(web));
  });
});

describe('band factory', () => {
  it('always assigns an id, and keeps an explicit one', () => {
    const a = newBand(10, 20);
    const b = newBand(10, 20, { id: undefined, targetId: 'T' });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(b.id).not.toBe(a.id);
    expect(b.targetId).toBe('T');
    expect(newBand(1, 2, { id: 'keep' }).id).toBe('keep');
  });
});

// 실제 실험 이미지는 보안상 저장소에 올리지 않으므로(.gitignore), 파일이 있을 때만 확인한다
const REAL_GEL = new URL('./fixtures/real-gel.png', import.meta.url);
describe('real gel image', () => {
  it.skipIf(!existsSync(REAL_GEL))('finds the ladder plus six evenly spaced lanes', async () => {
    const file = readFileSync(REAL_GEL);
    const img = await decodeImage(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), 'real-gel.png');
    const gray = toGray(img, 'luminance');
    expect(suggestPolarity(gray)).toBe('dark-bands');
    const lanes = detectLanes(toSignal(gray, 'dark-bands'), img.width, img.height);
    expect(lanes.length).toBe(7);
    // 레인 간격이 고르게 나와야 한다
    const gaps = lanes.slice(1).map((l, i) => l.cx - lanes[i].cx);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean)).toBeLessThan(mean * 0.15);
    expect(lanes[0].width).toBeGreaterThan(mean * 0.6);
    expect(lanes[0].width).toBeLessThan(mean);
  });
});

describe('tilted bands', () => {
  it('following the tilt sharpens the peak and recovers the same area', () => {
    const w = 200, h = 200, tilt = 12; // 레인 폭 전체에서 12px 내려가는 밴드
    const lane = { id: 'l', sample: '', cx: 100, top: 20, bottom: 180, width: 80, baseline: null, bands: [], excluded: false };
    const data = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      const cy = 100 + (tilt * (x - lane.cx)) / lane.width;
      for (let y = 0; y < h; y++) data[y * w + x] = 500 * Math.exp(-0.5 * ((y - cy) / 4) ** 2);
    }
    const img = { width: w, height: h, data };
    const settings = { aggregate: 'mean' as const, edgeTrimPct: 0 };
    const flat = extractProfile(img, img, Infinity, lane, settings, 0);
    const tilted = extractProfile(img, img, Infinity, lane, settings, tilt);
    const peak = (p: { values: Float64Array }) => Math.max(...p.values);
    const area = (p: { values: Float64Array }) => p.values.reduce((s, v) => s + v, 0);
    // 기울기를 따라가면 봉우리가 번지지 않는다
    expect(peak(tilted)).toBeGreaterThan(peak(flat) * 1.3);
    expect(peak(tilted)).toBeGreaterThan(490); // 원래 밴드 높이 500 회복
    expect(area(tilted) / area(flat)).toBeCloseTo(1, 1);
  });
});

describe('image decoding', () => {
  it('reads 16-bit TIFF with original values', async () => {
    const file = readFileSync(new URL('./fixtures/gel16.tif', import.meta.url));
    const img = await decodeImage(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), 'gel16.tif');
    expect([img.width, img.height, img.bitDepth, img.maxValue, img.channels.length]).toEqual([640, 400, 16, 65535, 1]);
    const lanes = detectLanes(toSignal({ ...img, data: img.channels[0] }, suggestPolarity({ ...img, data: img.channels[0] })), 640, 400);
    expect(lanes.length).toBe(6);
  });
});

describe('calibration', () => {
  const x = [1, 2, 4, 8, 16, 32];
  it('linear recovers parameters and inverse', () => {
    const f = fitCalibration(x, x.map((v) => 3 + 2 * v), 'linear');
    if ('error' in f) throw new Error(f.error);
    expect(f.params[0]).toBeCloseTo(3);
    expect(f.params[1]).toBeCloseTo(2);
    expect(f.inverse(23)).toBeCloseTo(10);
    expect(f.r2).toBeCloseTo(1);
  });
  it('power', () => {
    const f = fitCalibration(x, x.map((v) => 5 * v ** 0.8), 'power');
    if ('error' in f) throw new Error(f.error);
    expect(f.params[1]).toBeCloseTo(0.8, 5);
    expect(f.inverse(5 * 10 ** 0.8)).toBeCloseTo(10, 4);
  });
  it('4PL', () => {
    const xs = [0.5, 1, 2, 4, 8, 16, 32, 64];
    const A = 100, B = 1.3, C = 6, D = 5000;
    const ys = xs.map((v) => D + (A - D) / (1 + (v / C) ** B));
    const f = fitCalibration(xs, ys, '4pl');
    if ('error' in f) throw new Error(f.error);
    expect(f.r2).toBeGreaterThan(0.9999);
    expect(f.inverse(ys[3])!).toBeCloseTo(4, 1);
  });
  it('quadratic inverse picks root in range', () => {
    const f = fitCalibration(x, x.map((v) => 10 + 5 * v - 0.05 * v * v), 'quadratic');
    if ('error' in f) throw new Error(f.error);
    expect(f.inverse(10 + 5 * 12 - 0.05 * 144)!).toBeCloseTo(12, 4);
  });
});

describe('summary normalization', () => {
  const row = (p: Partial<BandRow>): BandRow => ({
    gelId: 'g', gelName: 'g', laneId: 'l', laneIndex: 0, sample: 's', bandId: Math.random().toString(), bandIndex: 0,
    targetId: 't', position: 0, rf: 0, height: 0, area: 0, volume: 0, pctLane: 0, saturatedPixels: 0,
    negativeFraction: 0, amount: null, amountStatus: null, tilt: 0, ...p,
  });
  it('uses same-lane loading control and reference sample', () => {
    const rows = [
      row({ laneId: 'a', sample: 'ctrl', targetId: 'T', area: 100 }),
      row({ laneId: 'a', sample: 'ctrl', targetId: 'LC', area: 50 }),
      row({ laneId: 'b', sample: 'drug', targetId: 'T', area: 300 }),
      row({ laneId: 'b', sample: 'drug', targetId: 'LC', area: 75 }),
    ];
    const s = summarize(rows, 'area', 'LC', 'ctrl');
    const drug = s.cells.find((c) => c.sample === 'drug' && c.targetId === 'T')!;
    expect(drug.normalized!.mean).toBeCloseTo(4);
    expect(drug.normalized!.method).toBe('lane');
    expect(drug.relative!.mean).toBeCloseTo(2);
  });
  it('falls back to sample mean across gels', () => {
    const rows = [
      row({ gelId: 'g1', laneId: 'a', sample: 'ctrl', targetId: 'T', area: 100 }),
      row({ gelId: 'g2', laneId: 'x', sample: 'ctrl', targetId: 'LC', area: 20 }),
    ];
    const s = summarize(rows, 'area', 'LC', null);
    const c = s.cells.find((q) => q.targetId === 'T')!;
    expect(c.normalized!.method).toBe('sample');
    expect(c.normalized!.mean).toBeCloseTo(5);
  });
});

describe('화면용 가우시안 블러', () => {
  const w = 40, h = 30;
  it('sigma 0이면 원본 배열을 그대로 돌려준다', () => {
    const v = new Float32Array(w * h).fill(5);
    expect(gaussianBlur(v, w, h, 0)).toBe(v);
  });
  it('균일한 이미지는 그대로이고, 전체 합(총 신호량)이 보존된다', () => {
    const flat = new Float32Array(w * h).fill(7);
    const o = gaussianBlur(flat, w, h, 1.5);
    expect(Math.max(...Array.from(o).map((x) => Math.abs(x - 7)))).toBeLessThan(1e-4);
    const v = new Float32Array(w * h);
    v[15 * w + 20] = 1000; // 가장자리에서 멀리 떨어진 점 하나
    const b = gaussianBlur(v, w, h, 1.5);
    expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(1000, 1);
  });
  it('한 픽셀 단위 점무늬(디더링)를 크게 줄인다', () => {
    const v = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[y * w + x] = 100 + ((x + y) % 2 ? 8 : -8);
    const b = gaussianBlur(v, w, h, 1.5);
    const sd = (a: Float32Array) => { const m = a.reduce((s2, x) => s2 + x, 0) / a.length; return Math.sqrt(a.reduce((s2, x) => s2 + (x - m) ** 2, 0) / a.length); };
    expect(sd(b)).toBeLessThan(sd(v) * 0.1);
  });
});

describe('이미지 준비 화면: 원본과 보정 후 이미지의 표시 일관성', () => {
  const w = 30, h = 20;
  const raw = new Float32Array(w * h).map((_, i) => 120 + ((i * 37) % 90)); // 8-bit 범위의 임의 값
  const mk = (polarity: 'dark-bands' | 'light-bands', display: Partial<Gel['display']> = {}, signalFrom: Float32Array = raw) => {
    const signal = toSignal({ width: w, height: h, data: signalFrom, maxValue: 255, channels: 1 } as never, polarity);
    const data = { width: w, height: h, raw, signal, maxValue: 255 } as unknown as ProcessedGel;
    const gel = {
      preprocess: { polarity },
      background: { method: 'none' },
      display: { min: 100, max: 230, gamma: 1, showCorrected: false, applyToData: true, smooth: 0, smoothApply: true, ...display },
    } as unknown as Gel;
    return { data, gel };
  };
  const same = (a: Float32Array, b: Float32Array) => Math.max(...Array.from(a).map((x, i) => Math.abs(x - b[i])));

  it('보정을 하나도 안 하면 어두운 밴드 이미지도 원본과 똑같이 보인다', () => {
    const { data, gel } = mk('dark-bands');
    const o = originalSource(gel, data), c = correctedSource(gel, data);
    expect(same(c.values, o.values)).toBeLessThan(1e-3);
    expect([c.min, c.max, c.gamma, c.invert]).toEqual([o.min, o.max, o.gamma, o.invert]);
  });
  it('밝은 밴드 이미지도 마찬가지다', () => {
    const { data, gel } = mk('light-bands');
    expect(same(correctedSource(gel, data).values, originalSource(gel, data).values)).toBeLessThan(1e-3);
  });
  it('부드럽게를 측정에 적용하면 보정 후 이미지가 블러된 모습이고, 두 번 블러되지 않는다', () => {
    const blurred = gaussianBlur(raw, w, h, 1.5);
    const { data, gel } = mk('dark-bands', { smooth: 1.5, smoothApply: true }, blurred);
    expect(same(correctedSource(gel, data).values, blurred)).toBeLessThan(1e-3);
  });
  it('부드럽게를 화면에만 적용하면(측정 미적용) 화면만 블러되고 측정용 값은 그대로다', () => {
    const { data, gel } = mk('dark-bands', { smooth: 1.5, smoothApply: false });
    expect(same(correctedSource(gel, data).values, gaussianBlur(raw, w, h, 1.5))).toBeLessThan(1e-3);
    expect(same(Float32Array.from(data.signal, (v) => 255 - v), raw)).toBeLessThan(1e-3);
  });
  it('배경 제거로 배경이 밝게 올라가도 흐린 밴드가 흰색으로 잘리지 않는다', () => {
    // 배경 200, 흐린 밴드 190인 이미지에서 배경 신호(55)를 통째로 빼면, 되돌린 값은 배경 255·밴드 245가 된다.
    const faint = new Float32Array(w * h).fill(200);
    for (let y = 8; y < 12; y++) for (let x = 5; x < 25; x++) faint[y * w + x] = 190;
    const sig = toSignal({ width: w, height: h, data: faint, maxValue: 255, channels: 1 } as never, 'dark-bands').map((v) => v - 55);
    const data = { width: w, height: h, raw: faint, signal: sig, maxValue: 255 } as unknown as ProcessedGel;
    const gel = { preprocess: { polarity: 'dark-bands' }, background: { method: 'rolling-ball' },
      display: { min: 100, max: 230, gamma: 1, showCorrected: false, applyToData: true, smooth: 0, smoothApply: true } } as unknown as Gel;
    const c = correctedSource(gel, data);
    const map = (v: number) => (v - c.min) / (c.max - c.min);
    const band = map(255 - sig[10 * w + 10]), bg = map(255 - sig[1 * w + 1]);
    expect(bg - band).toBeGreaterThan(0.02);   // 배경과 밴드가 구별되어야 함
    expect(band).toBeLessThan(0.999);          // 밴드가 최대 밝기로 잘리면 안 됨
  });
  it('감마: 측정에 적용하면 이미 반영되어 화면 감마는 1, 화면에만이면 화면 감마를 쓴다', () => {
    const baked = mk('dark-bands', { gamma: 2, applyToData: true });
    const displayOnly = mk('dark-bands', { gamma: 2, applyToData: false });
    expect(correctedSource(baked.gel, baked.data).gamma).toBe(1);
    expect(correctedSource(displayOnly.gel, displayOnly.data).gamma).toBe(2);
  });
});
