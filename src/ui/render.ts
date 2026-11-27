import type { Gel } from '../core/types';
import type { ProcessedGel } from '../engine/engine';
import { gaussianBlur } from '../core/image/preprocess';

const LUT_SIZE = 4096;

function buildLut(gamma: number, invert: boolean) {
  const lut = new Uint8ClampedArray(LUT_SIZE);
  const g = 1 / Math.max(gamma, 0.01);
  for (let i = 0; i < LUT_SIZE; i++) {
    const v = Math.pow(i / (LUT_SIZE - 1), g);
    lut[i] = Math.round((invert ? 1 - v : v) * 255);
  }
  return lut;
}

export interface RenderSource {
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
  gamma: number;
  invert: boolean;
}

/** 블러 결과는 (원본 배열, 강도)별로 한 번만 계산한다. 슬라이더를 움직여도 이전 결과는 배열이 사라지면 함께 정리된다. */
const blurCache = new WeakMap<Float32Array, { sigma: number; out: Float32Array }>();
function smoothed(values: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (!(sigma > 0)) return values;
  const hit = blurCache.get(values);
  if (hit && hit.sigma === sigma) return hit.out;
  const out = gaussianBlur(values, w, h, sigma);
  blurCache.set(values, { sigma, out });
  return out;
}

export function sourceFor(gel: Gel, data: ProcessedGel): RenderSource {
  const d = gel.display;
  const sigma = d.smooth ?? 0;
  if (d.showCorrected) {
    const [lo, hi] = data.signalRange;
    return {
      width: data.width, height: data.height, values: smoothed(data.signal, data.width, data.height, sigma),
      min: Math.min(lo, 0), max: hi > lo ? hi : lo + 1, gamma: d.gamma,
      invert: gel.preprocess.polarity !== 'light-bands',
    };
  }
  return {
    width: data.width, height: data.height, values: smoothed(data.raw, data.width, data.height, sigma),
    min: d.min, max: d.max > d.min ? d.max : d.min + 1, gamma: d.gamma, invert: false,
  };
}

export function renderToImageData(src: RenderSource, target?: ImageData): ImageData {
  const { width: w, height: h, values, min, max } = src;
  const img = target && target.width === w && target.height === h ? target : new ImageData(w, h);
  const px = img.data;
  const lut = buildLut(src.gamma, src.invert);
  const scale = (LUT_SIZE - 1) / (max - min);
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    let k = ((values[i] - min) * scale) | 0;
    if (k < 0) k = 0; else if (k >= LUT_SIZE) k = LUT_SIZE - 1;
    const g = lut[k];
    px[p] = g; px[p + 1] = g; px[p + 2] = g; px[p + 3] = 255;
  }
  return img;
}

const thumbCache = new Map<string, string>();

export function thumbnailUrl(gel: Gel, data: ProcessedGel, maxSize = 360): string {
  const key = `${data.key}|${JSON.stringify(gel.display)}|${maxSize}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const src = sourceFor(gel, data);
  const s = Math.min(1, maxSize / Math.max(src.width, src.height));
  const tw = Math.max(1, Math.round(src.width * s));
  const th = Math.max(1, Math.round(src.height * s));
  // 최근접 다운샘플
  const vals = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / s));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / s));
      vals[y * tw + x] = src.values[sy * src.width + sx];
    }
  }
  const img = renderToImageData({ ...src, width: tw, height: th, values: vals });
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (thumbCache.size > 60) thumbCache.delete(thumbCache.keys().next().value!);
  thumbCache.set(key, url);
  return url;
}

// ---------------- 숫자 표시 ----------------

export function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2);
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  return Number(v.toPrecision(digits)).toString();
}

export function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v.toFixed(1)}%`;
}
