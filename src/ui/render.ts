import type { Gel } from '../core/types';
import type { ProcessedGel } from '../engine/engine';
import { gaussianBlur, percentile } from '../core/image/preprocess';

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

/** 측정용 값(밴드가 클수록 큰 값)을 원본과 같은 극성으로 되돌린 값. 어두운 밴드는 `최대값 − signal`이 곧 보정된 회색값이다. */
const restoredCache = new WeakMap<Float32Array, Float32Array>();
function restoredValues(data: ProcessedGel): Float32Array {
  const hit = restoredCache.get(data.signal);
  if (hit) return hit;
  const out = new Float32Array(data.signal.length);
  for (let i = 0; i < out.length; i++) out[i] = data.maxValue - data.signal[i];
  restoredCache.set(data.signal, out);
  return out;
}

/**
 * 배경 제거를 켜면 배경이 0으로 내려가서, 되돌린 값에서는 배경이 가장 밝은 값(예: 255)이 된다.
 * 원본의 밝기 범위(예: 102~221)를 그대로 쓰면 배경과 흐린 밴드가 모두 흰색으로 잘려 보이므로,
 * 배경 제거 후에는 보정된 값 자체에서 범위를 다시 잡는다. (측정값은 영향받지 않는 표시 문제)
 */
const rangeCache = new WeakMap<Float32Array, [number, number]>();
function autoRange(values: Float32Array): [number, number] {
  const hit = rangeCache.get(values);
  if (hit) return hit;
  const [lo, hi] = percentile(values, 0.05, 99.95);
  const r: [number, number] = [lo, hi > lo ? hi : lo + 1];
  rangeCache.set(values, r);
  return r;
}

/** 원본 이미지: 올린 그대로. 화면 밝기 범위만 적용한다. */
export function originalSource(gel: Gel, data: ProcessedGel): RenderSource {
  const d = gel.display;
  return { width: data.width, height: data.height, values: data.raw, min: d.min, max: d.max > d.min ? d.max : d.min + 1, gamma: 1, invert: false };
}

/**
 * 보정 후 이미지: 실제 측정에 쓰이는 값에 감마·부드럽게·배경 제거 등이 반영된 모습을 원본과 같은 극성·같은 밝기 범위로 그린다.
 * 보정을 하나도 하지 않으면 원본과 똑같이 보여야 한다(tests/core.test.ts에서 확인).
 * 측정에 적용하지 않기로 한 보정(감마·부드럽게)은 화면에만 덧입힌다.
 */
export function correctedSource(gel: Gel, data: ProcessedGel): RenderSource {
  const d = gel.display;
  const sigma = d.smooth ?? 0;
  const p = gel.preprocess.polarity;
  const gammaBaked = d.applyToData && d.gamma !== 1;
  const smoothBaked = (d.smoothApply ?? true) && sigma > 0;
  // OD는 로그 변환이라 되돌릴 수 없으므로 원본 값에 화면용 보정만 얹는다(이 경우 배경 제거는 화면에 안 보임)
  const values = p === 'dark-bands' ? restoredValues(data) : p === 'light-bands' ? data.signal : data.raw;
  const baked = p === 'dark-bands' || p === 'light-bands';
  const shown = sigma > 0 && !(baked && smoothBaked) ? smoothed(values, data.width, data.height, sigma) : values;
  const bgRemoved = baked && gel.background.method !== 'none';
  const [min, max] = bgRemoved ? autoRange(restoredValues(data)) : [d.min, d.max > d.min ? d.max : d.min + 1];
  return {
    width: data.width, height: data.height, values: shown,
    min, max,
    gamma: baked && gammaBaked ? 1 : d.gamma, invert: false,
  };
}

/** 화면에 그릴 소스. 기본은 보정 후 이미지이고, 'original'이면 올린 그대로. */
export function sourceFor(gel: Gel, data: ProcessedGel, mode: 'corrected' | 'original' = 'corrected'): RenderSource {
  return mode === 'original' ? originalSource(gel, data) : correctedSource(gel, data);
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
